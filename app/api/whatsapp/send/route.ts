import { NextResponse } from "next/server";
import { assertCanSendWhatsApp } from "@/lib/whatsapp/auth";
import { WhatsAppError, sendText } from "@/lib/whatsapp/client";
import { normalizePhone } from "@/lib/whatsapp/phone";
import { MAX_MESSAGE_LENGTH } from "@/lib/whatsapp/templates";
import type { SendResult } from "@/lib/whatsapp/types";

interface Recipient {
  phone: string;
  /** affiché dans le compte rendu d'envoi côté interface */
  name?: string;
  /** message propre à ce destinataire ; à défaut, le `text` global s'applique.
   *  Permet d'envoyer un lot d'alertes personnalisées en une seule requête, et
   *  donc de conserver l'espacement entre les messages. */
  text?: string;
}

interface SendBody {
  recipients: Recipient[];
  text?: string;
}

/** Nombre de destinataires acceptés en un appel. WhatsApp restreint les comptes
 *  qui envoient en rafale ; au-delà, il faut passer par plusieurs envois. */
const MAX_RECIPIENTS = 50;

/** Pause entre deux messages d'un même lot : reste sous la limite par défaut de
 *  la passerelle (20/min) et imite un rythme d'envoi humain. */
const DELAY_BETWEEN_SENDS_MS = 1_200;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request) {
  try {
    await assertCanSendWhatsApp();

    const body = (await request.json()) as SendBody;
    const defaultText = body.text?.trim() ?? "";
    const recipients = Array.isArray(body.recipients) ? body.recipients : [];

    if (recipients.length === 0) {
      return NextResponse.json({ error: "Aucun destinataire." }, { status: 400 });
    }
    if (recipients.length > MAX_RECIPIENTS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_RECIPIENTS} destinataires par envoi.` },
        { status: 400 },
      );
    }

    // Les messages sont résolus et validés avant le premier envoi : un lot
    // partiellement parti puis rejeté à mi-course serait ingérable à rattraper.
    const messages = recipients.map((r) => r.text?.trim() || defaultText);

    if (messages.some((m) => !m)) {
      return NextResponse.json({ error: "Le message est vide." }, { status: 400 });
    }
    if (messages.some((m) => m.length > MAX_MESSAGE_LENGTH)) {
      return NextResponse.json(
        { error: `Le message dépasse ${MAX_MESSAGE_LENGTH} caractères.` },
        { status: 400 },
      );
    }

    const results: SendResult[] = [];

    for (const [index, recipient] of recipients.entries()) {
      const name = recipient.name?.trim() || recipient.phone;
      const normalized = normalizePhone(recipient.phone);

      if (!normalized) {
        results.push({ name, phone: recipient.phone, ok: false, error: "Numéro invalide" });
        continue;
      }

      if (index > 0) await sleep(DELAY_BETWEEN_SENDS_MS);

      try {
        const { messageId } = await sendText(normalized.chatId, messages[index]);
        results.push({ name, phone: normalized.display, ok: true, messageId });
      } catch (err) {
        // Une passerelle éteinte ou mal configurée fait échouer tout le lot de la
        // même façon : inutile d'attendre 50 timeouts pour le dire.
        if (err instanceof WhatsAppError && err.status === 503) throw err;
        results.push({
          name,
          phone: normalized.display,
          ok: false,
          error: err instanceof Error ? err.message : "Échec de l'envoi",
        });
      }
    }

    const sent = results.filter((r) => r.ok).length;
    return NextResponse.json({ sent, failed: results.length - sent, results });
  } catch (err) {
    if (err instanceof WhatsAppError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur inattendue lors de l'envoi." },
      { status: 500 },
    );
  }
}
