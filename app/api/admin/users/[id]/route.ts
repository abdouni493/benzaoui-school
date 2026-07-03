import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireStaffCaller() {
  const server = await createServerClient();
  const {
    data: { user },
  } = await server.auth.getUser();
  if (!user) return false;

  const { data: profile } = await server.from("profiles").select("role").eq("id", user.id).single();
  return profile?.role === "admin" || profile?.role === "reception";
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
 *  row (students/teachers/parents/reception_staff) via FK ON DELETE CASCADE. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireStaffCaller())) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
