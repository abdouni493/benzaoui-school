import "server-only";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { WhatsAppError } from "./client";

type Role = "admin" | "reception" | "teacher" | "student" | "parent";

/** Seuls l'administration et la réception peuvent écrire aux familles depuis le
 *  numéro WhatsApp de l'école — un enseignant ou un parent connecté ne doit pas
 *  pouvoir s'en servir comme d'un relais d'envoi. */
const SENDER_ROLES: Role[] = ["admin", "reception"];

export async function assertCanSendWhatsApp(): Promise<void> {
  const server = await createServerClient();
  const {
    data: { user },
  } = await server.auth.getUser();

  if (!user) throw new WhatsAppError("Authentification requise.", 401);

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  const role = (profile?.role as Role) ?? null;

  if (!role || !SENDER_ROLES.includes(role)) {
    throw new WhatsAppError("Seules l'administration et la réception peuvent envoyer des messages WhatsApp.", 403);
  }
}
