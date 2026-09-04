import "server-only";

/** File d'attente locale des messages WhatsApp.
 *
 *  RAISON D'ÊTRE
 *  -------------
 *  La passerelle est auto-hébergée sur un poste de l'école. Ce poste éteint, en
 *  veille ou sans Internet, un envoi échouait franchement : l'utilisateur voyait
 *  une erreur et devait penser à recommencer. Pour une alerte de solde
 *  déclenchée par un scan de carte, personne ne recommençait — le message était
 *  perdu sans que quiconque le sache.
 *
 *  Les messages non partis atterrissent donc ici, et repartent tout seuls dès
 *  que la passerelle redevient joignable.
 *
 *  Comme `log.ts`, ce module écrit avec le client service_role : ces écritures
 *  viennent du serveur, pas d'un utilisateur. */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  WhatsAppError,
  getConfig,
  getConnectionState,
  sendTextMessage,
} from "./client";
import { logOutgoingMessage } from "./log";
import { TYPING_DELAY_MS, randomGap, sleep } from "./pacing";
import type { OutboxEntry, FlushOutcome, OfflineReason } from "./types";

/** Au-delà, le message n'est plus tenté : la passerelle le refuse pour une
 *  raison qui ne s'arrangera pas d'elle-même (numéro sans compte WhatsApp…). */
const MAX_ATTEMPTS = 3;

/** Un rappel de solde vieux d'une semaine peut être devenu FAUX — la famille a
 *  pu payer entre-temps. Mieux vaut ne rien envoyer que d'envoyer une
 *  information périmée à un parent. */
const MAX_AGE_DAYS = 7;

/** Borne de temps d'un vidage : la fonction serverless est limitée, et la
 *  temporisation anti-bannissement rend chaque envoi lent. Le reliquat repart
 *  au vidage suivant. */
const FLUSH_TIME_BUDGET_MS = 45_000;

/** Plafond de messages traités par vidage. */
const FLUSH_BATCH = 8;

const errText = (err: unknown): string =>
  err instanceof Error ? err.message : "erreur inconnue";

/** Un message à mettre en file. Le numéro est déjà normalisé par l'appelant. */
export interface QueueEntry {
  recipientPhone: string;
  recipientDisplay?: string | null;
  recipientName?: string | null;
  studentId?: string | null;
  parentId?: string | null;
  messageType?: string;
  body: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v: string | null | undefined): string | null => (v && UUID_RE.test(v) ? v : null);

/** Met des messages en file d'attente. Renvoie le nombre réellement enregistré.
 *
 *  Best-effort comme la journalisation : si même la file est indisponible, on
 *  ne casse pas l'action métier en cours (un scan de carte, un encaissement). */
export async function queueMessages(entries: QueueEntry[]): Promise<number> {
  if (entries.length === 0) return 0;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("whatsapp_outbox")
      .insert(
        entries.map((e) => ({
          recipient_phone: e.recipientPhone,
          recipient_display: e.recipientDisplay ?? null,
          recipient_name: e.recipientName ?? null,
          student_id: asUuid(e.studentId),
          parent_id: asUuid(e.parentId),
          message_type: e.messageType ?? "text",
          body: e.body,
          status: "pending",
        })),
      )
      .select("id");

    if (error) throw new Error(error.message);
    return data?.length ?? 0;
  } catch (err) {
    console.warn(`[whatsapp] mise en file impossible : ${errText(err)}`);
    return 0;
  }
}

/** Nombre de messages en attente. Volontairement bon marché : c'est cette
 *  fonction que l'interface interroge en boucle, elle ne doit jamais appeler la
 *  passerelle. */
export async function pendingCount(): Promise<number> {
  try {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from("whatsapp_outbox")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return count ?? 0;
  } catch (err) {
    console.warn(`[whatsapp] lecture de la file impossible : ${errText(err)}`);
    return 0;
  }
}

/** Les messages en attente les plus anciens d'abord, pour l'interface. */
export async function listPending(limit = 50): Promise<OutboxEntry[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("whatsapp_outbox")
      .select("id, recipient_display, recipient_phone, recipient_name, body, attempts, last_error, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      recipient: (r.recipient_display as string) ?? (r.recipient_phone as string),
      recipientName: (r.recipient_name as string) ?? null,
      body: r.body as string,
      attempts: (r.attempts as number) ?? 0,
      lastError: (r.last_error as string) ?? null,
      createdAt: r.created_at as string,
    }));
  } catch (err) {
    console.warn(`[whatsapp] lecture de la file impossible : ${errText(err)}`);
    return [];
  }
}

/** Marque « abandonné » tout message trop ancien. Renvoie le nombre écarté. */
async function expireStale(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("whatsapp_outbox")
      .update({
        status: "abandoned",
        abandoned_at: new Date().toISOString(),
        abandoned_reason: `Plus de ${MAX_AGE_DAYS} jours en attente : l'information peut avoir change.`,
      })
      .eq("status", "pending")
      .lt("created_at", cutoff)
      .select("id");
    if (error) throw new Error(error.message);
    return data?.length ?? 0;
  } catch (err) {
    console.warn(`[whatsapp] expiration de la file impossible : ${errText(err)}`);
    return 0;
  }
}

/** Tente d'envoyer les messages en attente.
 *
 *  Sans effet et sans erreur si rien ne peut partir : la file reste intacte et
 *  on ressort `offline: true`. `reason` dit LAQUELLE des trois causes bloque —
 *  une passerelle éteinte se rattrape toute seule, une session WhatsApp fermée
 *  jamais (voir `OfflineReason`). */
export async function flushOutbox(): Promise<FlushOutcome> {
  const expired = await expireStale();

  const blocked = async (reason: OfflineReason): Promise<FlushOutcome> => ({
    sent: 0,
    failed: 0,
    remaining: await pendingCount(),
    expired,
    offline: true,
    reason,
  });

  const config = getConfig();
  if (!config) return blocked("unconfigured");

  // La passerelle répond-elle, et la session est-elle ouverte ? Inutile
  // d'enchaîner des échecs identiques pour l'apprendre huit fois. Les deux
  // questions se répondent séparément : une passerelle qui répond « close » est
  // bien vivante, c'est le téléphone qui s'est délié.
  try {
    const { state } = await getConnectionState();
    if (state !== "open") return blocked("disconnected");
  } catch {
    return blocked("unreachable");
  }

  const batch = await listPending(FLUSH_BATCH);
  if (batch.length === 0) return { sent: 0, failed: 0, remaining: 0, expired, offline: false };

  const admin = createAdminClient();
  const started = Date.now();
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < batch.length; i++) {
    const row = batch[i];

    // Le numéro stocké est déjà normalisé à la mise en file.
    const { data: full } = await admin
      .from("whatsapp_outbox")
      .select("recipient_phone, recipient_name, student_id, parent_id, message_type")
      .eq("id", row.id)
      .maybeSingle();
    if (!full) continue;

    const logMeta = {
      recipientPhone: full.recipient_phone as string,
      recipientName: (full.recipient_name as string) ?? row.recipient,
      studentId: (full.student_id as string) ?? null,
      parentId: (full.parent_id as string) ?? null,
      messageType: (full.message_type as string) ?? "text",
      instance: config.instance,
    };

    try {
      const { messageId } = await sendTextMessage(full.recipient_phone as string, row.body, {
        delayMs: TYPING_DELAY_MS,
      });
      await admin
        .from("whatsapp_outbox")
        .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
        .eq("id", row.id);
      // Journalisé comme n'importe quel envoi : le suivi de remise
      // (sent → delivered → read) reste au même endroit.
      await logOutgoingMessage({ ...logMeta, messageId, status: "queued" });
      sent++;
    } catch (err) {
      // Panne globale (passerelle retombée en cours de vidage) : on s'arrête,
      // SANS consommer de tentative — ce n'est pas la faute du message.
      if (err instanceof WhatsAppError && (err.status === 503 || err.status === 502)) {
        return {
          sent,
          failed,
          remaining: await pendingCount(),
          expired,
          offline: true,
          reason: "unreachable",
        };
      }

      const attempts = row.attempts + 1;
      const message = errText(err);
      const giveUp = attempts >= MAX_ATTEMPTS;

      await admin
        .from("whatsapp_outbox")
        .update({
          attempts,
          last_error: message,
          last_attempt_at: new Date().toISOString(),
          ...(giveUp
            ? {
                status: "abandoned",
                abandoned_at: new Date().toISOString(),
                abandoned_reason: `Echec apres ${MAX_ATTEMPTS} tentatives : ${message}`,
              }
            : {}),
        })
        .eq("id", row.id);

      if (giveUp) await logOutgoingMessage({ ...logMeta, status: "failed", errorMessage: message });
      failed++;
    }

    if (i === batch.length - 1) break;

    // Même temporisation que l'envoi direct : un rattrapage est justement le
    // moment où l'on ressemble le plus à un robot.
    const gap = randomGap();
    if (Date.now() - started + gap > FLUSH_TIME_BUDGET_MS) break;
    await sleep(gap);
  }

  return { sent, failed, remaining: await pendingCount(), expired, offline: false };
}
