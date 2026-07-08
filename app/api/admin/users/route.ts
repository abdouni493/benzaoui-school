import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type Role = "admin" | "reception" | "teacher" | "student" | "parent";

interface CreateUserBody {
  role: Role;
  email: string;
  password: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  // student
  birthDate?: string;
  rfid?: string;
  isFree?: boolean;
  parentId?: string;
  subscriptionIds?: string[];
  registrationDue?: number;
  // teacher
  paymentType?: string;
  monthlyAmount?: number;
  startDate?: string;
  percentage?: number;
  // reception / workers
  salary?: number;
  workerRole?: string;
}

/** Who is allowed to call this endpoint, per role being created:
 *  - "admin": anyone, but ONLY when no admin exists yet (first-run bootstrap
 *    from the login page's "Créer un compte administrateur"). Otherwise
 *    requires an authenticated admin.
 *  - anything else: requires an authenticated admin or reception caller. */
async function assertAuthorized(admin: ReturnType<typeof createAdminClient>, targetRole: Role) {
  const server = await createServerClient();
  const {
    data: { user },
  } = await server.auth.getUser();

  let callerRole: Role | null = null;
  if (user) {
    const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
    callerRole = (profile?.role as Role) ?? null;
  }

  if (targetRole === "admin") {
    const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
    if ((count ?? 0) === 0) return; // bootstrap: first admin ever, no session required
    if (callerRole === "admin") return;
    throw new Response("Only an existing admin can create another admin account.", { status: 403 });
  }

  if (callerRole === "admin" || callerRole === "reception") return;
  throw new Response("Only admin or reception can create this account.", { status: 403 });
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateUserBody;
  const { role, email, password } = body;

  if (!role || !email || !password) {
    return NextResponse.json({ error: "role, email and password are required" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const admin = createAdminClient();

  try {
    await assertAuthorized(admin, role);
  } catch (res) {
    if (res instanceof Response) return NextResponse.json({ error: await res.text() }, { status: res.status });
    throw res;
  }

  const fullName =
    body.fullName?.trim() || [body.firstName, body.lastName].filter(Boolean).join(" ").trim() || email;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role, phone: body.phone ?? null },
  });

  if (createError || !created.user) {
    return NextResponse.json({ error: createError?.message ?? "Could not create user" }, { status: 400 });
  }

  const userId = created.user.id;

  // The `on_auth_user_created` trigger inserts the `profiles` row synchronously
  // within the same transaction as createUser, so it's already there for the
  // role-specific insert below to FK against.
  const rollback = async (message: string, status = 400) => {
    await admin.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: message }, { status });
  };

  if (role === "teacher") {
    const { error } = await admin.from("teachers").insert({
      id: userId,
      first_name: body.firstName ?? "",
      last_name: body.lastName ?? "",
      phone: body.phone ?? "",
      email,
      payment_type: body.paymentType ?? "monthly",
      monthly_amount: body.monthlyAmount ?? null,
      start_date: body.startDate ?? null,
      percentage: body.percentage ?? null,
    });
    if (error) return rollback(error.message);
  } else if (role === "reception") {
    const { error } = await admin.from("reception_staff").insert({
      id: userId,
      first_name: body.firstName ?? "",
      last_name: body.lastName ?? "",
      phone: body.phone ?? "",
      email,
      payment_type: body.paymentType ?? "monthly",
      start_date: body.startDate ?? new Date().toISOString().slice(0, 10),
      salary: body.salary ?? 0,
      role: body.workerRole ?? "reception",
    });
    if (error) return rollback(error.message);
  } else if (role === "parent") {
    const { error } = await admin.from("parents").insert({
      id: userId,
      first_name: body.firstName ?? "",
      last_name: body.lastName ?? "",
      phone: body.phone ?? "",
      email,
    });
    if (error) return rollback(error.message);
  } else if (role === "student") {
    const { error } = await admin.from("students").insert({
      id: userId,
      first_name: body.firstName ?? "",
      last_name: body.lastName ?? "",
      birth_date: body.birthDate ?? null,
      phone: body.phone ?? "",
      email,
      rfid: body.rfid ?? null,
      is_free: body.isFree ?? false,
      parent_id: body.parentId ?? null,
      registration_due: body.registrationDue ?? 0,
    });
    if (error) return rollback(error.message);

    if (body.subscriptionIds?.length) {
      const rows = body.subscriptionIds.map((subscription_id) => ({ student_id: userId, subscription_id }));
      const { error: subError } = await admin.from("student_subscriptions").insert(rows);
      if (subError) return rollback(subError.message);
    }
  }
  // role === "admin": profiles row from the trigger is sufficient, no entity table.

  return NextResponse.json({ id: userId, role, email, fullName });
}
