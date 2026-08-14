import "server-only";

/** Journalisation des messages WhatsApp et fenêtre de service client.
 *
 *  Écrit dans public.whatsapp_messages (journal d'envoi + statuts) et
 *  public.whatsapp_contacts (dernier message entrant, pour la fenêtre de 24 h).
 *  Utilise le client service_role : ces écritures viennent du serveur (route
 *  d'envoi + webhook), pas d'un utilisateur, et contournent la RLS.
 *
 *  TOUT est best-effort : une panne de journalisation ne doit jamais casser un
 *  envoi ni faire échouer un webhook. Les fonctions n'émettent donc pas
 *  d'exception vers l'appelant — elles avalent et tracent l'erreur. */

import { createAdminClient } from "@/lib/supabase/admin";
import type { MessageStatus } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v: string | null | undefined): string | null => (v && UUID_RE.test(v) ? v : null);

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Rang de progression d'un statut : on ne « recule » jamais (un « sent » en
 *  retard ne doit pas écraser un « read » déjà reçu). `failed` est terminal. */
const STATUS_RANK: Record<MessageStatus, number> = {
  accepted: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

export interface OutgoingLog {
  recipientPhone: string;
  recipientName?: string;
  studentId?: string | null;
  parentId?: string | null;
  /** identifiant local du modèle, ou "text" pour un message libre */
  messageType: string;
  templateName?: string | null;
  templateLanguage?: string | null;
  messageId?: string | null;
  status: MessageStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
}

/** Enregistre un message sortant (accepté ou en échec). Best-effort. */
export async function logOutgoingMessage(entry: OutgoingLog): Promise<void> {
  try {
    const now = new Date().toISOString();
    const admin = createAdminClient();
    await admin.from("whatsapp_messages").insert({
      recipient_phone: entry.recipientPhone,
      recipient_name: entry.recipientName ?? null,
      student_id: asUuid(entry.studentId),
      parent_id: asUuid(entry.parentId),
      message_type: entry.messageType,
      template_name: entry.templateName ?? null,
      template_language: entry.templateLanguage ?? null,
      message_id: entry.messageId ?? null,
      status: entry.status,
      error_code: entry.errorCode ?? null,
      error_message: entry.errorMessage ?? null,
      sent_at: entry.status === "accepted" || entry.status === "sent" ? now : null,
      failed_at: entry.status === "failed" ? now : null,
    });
  } catch (err) {
    console.warn(`[whatsapp] journal d'envoi indisponible : ${errText(err)}`);
  }
}

/** `true` si le numéro a écrit à l'école dans les dernières 24 h — seule
 *  situation où Meta autorise un message texte libre. `false` si inconnu :
 *  on ne suppose jamais une fenêtre ouverte sans message entrant réel. */
export async function isWithinServiceWindow(msisdn: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("whatsapp_contacts")
      .select("last_inbound_at")
      .eq("phone", msisdn)
      .maybeSingle();

    const last = data?.last_inbound_at ? new Date(data.last_inbound_at).getTime() : 0;
    return last > 0 && Date.now() - last < SERVICE_WINDOW_MS;
  } catch (err) {
    console.warn(`[whatsapp] lecture de la fenêtre de service impossible : ${errText(err)}`);
    return false;
  }
}

/** Met à jour le statut d'un message identifié par son wamid Meta. Idempotent :
 *  un même événement rejoué ne change rien, et un statut ne recule jamais.
 *  Best-effort — appelée depuis le webhook. */
export async function updateMessageStatus(
  wamid: string,
  status: MessageStatus,
  opts: { errorCode?: string | null; errorMessage?: string | null; timestamp?: string } = {},
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("whatsapp_messages")
      .select("status")
      .eq("message_id", wamid)
      .maybeSingle();

    // Message inconnu (envoyé hors application, ou journal indisponible à
    // l'envoi) : rien à mettre à jour, on n'invente pas de ligne.
    if (!existing) return;

    const current = (existing.status as MessageStatus) ?? "accepted";
    if (status !== "failed" && STATUS_RANK[status] <= STATUS_RANK[current]) return;

    const at = opts.timestamp ?? new Date().toISOString();
    const patch: Record<string, unknown> = { status };
    if (status === "sent") patch.sent_at = at;
    if (status === "delivered") patch.delivered_at = at;
    if (status === "read") patch.read_at = at;
    if (status === "failed") {
      patch.failed_at = at;
      patch.error_code = opts.errorCode ?? null;
      patch.error_message = opts.errorMessage ?? null;
    }

    await admin.from("whatsapp_messages").update(patch).eq("message_id", wamid);
  } catch (err) {
    console.warn(`[whatsapp] mise à jour de statut impossible : ${errText(err)}`);
  }
}

/** Mémorise un message ENTRANT : ouvre/rafraîchit la fenêtre de service client
 *  pour ce numéro. Best-effort et monotone (ne régresse pas sur un événement
 *  livré dans le désordre). */
export async function recordInboundMessage(
  msisdn: string,
  wamid: string,
  timestampSeconds?: string | number,
): Promise<void> {
  try {
    const at =
      timestampSeconds !== undefined
        ? new Date(Number(timestampSeconds) * 1000).toISOString()
        : new Date().toISOString();

    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("whatsapp_contacts")
      .select("last_inbound_at")
      .eq("phone", msisdn)
      .maybeSingle();

    const prev = existing?.last_inbound_at ? new Date(existing.last_inbound_at).getTime() : 0;
    if (prev >= new Date(at).getTime()) return; // événement plus ancien : on garde le plus récent

    await admin.from("whatsapp_contacts").upsert(
      { phone: msisdn, last_inbound_at: at, last_inbound_wamid: wamid, updated_at: new Date().toISOString() },
      { onConflict: "phone" },
    );
  } catch (err) {
    console.warn(`[whatsapp] enregistrement du message entrant impossible : ${errText(err)}`);
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : "erreur inconnue";
}
