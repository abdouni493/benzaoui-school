import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deletionRefusal } from "@/lib/accountDeletion";

/** The staff account making the call, or `null` when it is not allowed. */
async function staffCaller(): Promise<{ id: string; role: string } | null> {
  const server = await createServerClient();
  const {
    data: { user },
  } = await server.auth.getUser();
  if (!user) return null;

  const { data: profile } = await server.from("profiles").select("role").eq("id", user.id).single();
  const role = profile?.role;
  return role === "admin" || role === "reception" ? { id: user.id, role } : null;
}

async function requireStaffCaller() {
  return (await staffCaller()) !== null;
}

/** Reset a user's password (admin/reception managing teacher/student/parent/
 *  reception credentials, mirrors the old "edit password" fields). */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireStaffCaller())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const { password } = (await request.json()) as { password?: string };
  if (!password || password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

/** Delete a user's login entirely. Cascades to profiles + the role-specific
 *  row (students/teachers/parents) via FK ON DELETE CASCADE.
 *
 *  `?role=` is the kind of account the caller MEANS to delete. A student's
 *  login takes his whole history with it (présences, balance, absences), so a
 *  student account is only ever deleted by a call that says `role=student` —
 *  see lib/accountDeletion.ts for why. */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await staffCaller();
  if (!caller) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const expected = new URL(request.url).searchParams.get("role");
  const admin = createAdminClient();

  const { data: target, error: readError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 400 });
  }
  const refusal = deletionRefusal(target?.role ?? null, expected);
  if (refusal) {
    console.warn(`[admin/users] suppression refusée de ${id} (${target?.role}) demandée comme « ${expected} » par ${caller.id}`);
    return NextResponse.json({ error: refusal }, { status: 409 });
  }

  // A trace of every student removal, with who asked for it: the rows are gone
  // after this call, the platform log is the only place left to read it.
  if (target?.role === "student") {
    const { data: stu } = await admin
      .from("students")
      .select("first_name, last_name, rfid, balance")
      .eq("id", id)
      .maybeSingle();
    console.info(
      `[admin/users] ÉLÈVE SUPPRIMÉ ${id} — ${stu?.first_name ?? "?"} ${stu?.last_name ?? "?"} ` +
        `(carte ${stu?.rfid ?? "-"}, solde ${stu?.balance ?? "?"} DA) par ${caller.role} ${caller.id}`,
    );
  }

  const { error } = await admin.auth.admin.deleteUser(id);
  // Workers (reception_staff) may exist WITHOUT an auth account (Ménage, or
  // Réception/Sécurité created without credentials) — "user not found" just
  // means there was no login to remove.
  if (error && !/not.?found/i.test(error.message)) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // reception_staff and teachers no longer cascade from profiles (their FK was
  // dropped so login-less workers / enseignants passagers can exist) — remove
  // the rows explicitly; this is a no-op for every other role.
  await admin.from("reception_staff").delete().eq("id", id);
  await admin.from("teachers").delete().eq("id", id);

  return NextResponse.json({ ok: true });
}
