import { NextResponse } from "next/server";
import { assertCanSendWhatsApp } from "@/lib/whatsapp/auth";
import {
  WhatsAppError,
  getConfig,
  metaLanguageCode,
  resolveTemplateName,
  sendTemplateMessage,
  sendTextMessage,
} from "@/lib/whatsapp/client";
import { logOutgoingMessage } from "@/lib/whatsapp/log";
import { normalizePhone } from "@/lib/whatsapp/phone";
import { MAX_MESSAGE_LENGTH, isAlertTemplate } from "@/lib/whatsapp/templates";
import type { OutgoingMessage, SendResult } from "@/lib/whatsapp/types";

interface Recipient {
  phone: string;
  /** affiché dans le compte rendu d'envoi côté interface */
  name?: string;
  studentId?: string | null;
  parentId?: string | null;
  /** message propre à ce destinataire ; à défaut, le `message` global s'applique */
  message?: OutgoingMessage;
  /** compat : un texte simple équivaut à { kind: "text", text } */
  text?: string;
}

interface SendBody {
  recipients: Recipient[];
  /** message partagé par tous les destinataires sans message propre */
  message?: OutgoingMessage;
  text?: string;
}

/** Nombre de destinataires acceptés en un appel. Garde-fou contre un envoi massif
 *  accidentel depuis l'interface ; au-delà, découper en plusieurs envois. */
const MAX_RECIPIENTS = 50;

/** Résout le message effectif d'un destinataire (propre, sinon global, sinon
 *  texte de compat), ou `null` si rien n'est fourni. */
function resolveMessage(recipient: Recipient, body: SendBody): OutgoingMessage | null {
  if (recipient.message) return recipient.message;
  if (recipient.text?.trim()) return { kind: "text", text: recipient.text.trim() };
  if (body.message) return body.message;
  if (body.text?.trim()) return { kind: "text", text: body.text.trim() };
  return null;
}

/** Valide un message avant tout envoi : le lot est vérifié en entier d'abord,
 *  pour ne pas partir à moitié puis se bloquer à mi-course. */
function validateMessage(msg: OutgoingMessage): string | null {
  if (msg.kind === "text") {
    if (!msg.text.trim()) return "Le message est vide.";
    if (msg.text.length > MAX_MESSAGE_LENGTH) return `Le message dépasse ${MAX_MESSAGE_LENGTH} caractères.`;
    return null;
  }
  if (!isAlertTemplate(msg.templateId)) return "Modèle inconnu.";
  if (!Array.isArray(msg.variables)) return "Variables de modèle invalides.";
  return null;
}

export async function POST(request: Request) {
  try {
    await assertCanSendWhatsApp();

    // Configuration serveur absente : inutile de tenter 50 envois.
    if (!getConfig()) {
      return NextResponse.json(
        { error: "WhatsApp non configuré. Renseigner les identifiants Meta côté serveur (voir README)." },
        { status: 503 },
      );
    }

    const body = (await request.json()) as SendBody;
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

    const resolved = recipients.map((r) => ({ recipient: r, message: resolveMessage(r, body) }));

    if (resolved.some((r) => !r.message)) {
      return NextResponse.json({ error: "Aucun message à envoyer." }, { status: 400 });
    }
    for (const { message } of resolved) {
      const invalid = validateMessage(message!);
      if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    }

    const results: SendResult[] = [];

    // Séquentiel, sans temporisation artificielle : l'API Cloud de Meta ne
    // demande aucune « cadence humaine » (contrairement à l'ancienne passerelle).
    for (const { recipient, message } of resolved) {
      const msg = message!; // garanti non-null par la validation ci-dessus
      const name = recipient.name?.trim() || recipient.phone;
      const normalized = normalizePhone(recipient.phone);

      // Métadonnées de journalisation communes au succès et à l'échec.
      const logMeta = {
        recipientPhone: normalized?.msisdn ?? recipient.phone,
        recipientName: name,
        studentId: recipient.studentId,
        parentId: recipient.parentId,
        messageType: msg.kind === "template" ? msg.templateId : "text",
        templateName: msg.kind === "template" ? resolveTemplateName(msg.templateId) : null,
        templateLanguage: msg.kind === "template" ? metaLanguageCode(msg.language) : null,
      };

      if (!normalized) {
        results.push({ name, phone: recipient.phone, ok: false, error: "Numéro invalide" });
        void logOutgoingMessage({ ...logMeta, status: "failed", errorMessage: "Numéro invalide" });
        continue;
      }

      try {
        const result = await sendOne(normalized.msisdn, msg);
        results.push({ name, phone: normalized.display, ok: true, messageId: result.messageId, status: "accepted" });
        void logOutgoingMessage({ ...logMeta, messageId: result.messageId, status: "accepted" });
      } catch (err) {
        // Erreurs globales (config absente, jeton invalide, Meta injoignable) :
        // tout le lot échouera pareil — inutile d'enchaîner 50 tentatives.
        if (err instanceof WhatsAppError && (err.status === 503 || err.status === 502)) throw err;

        const errorMessage = err instanceof Error ? err.message : "Échec de l'envoi";
        results.push({ name, phone: normalized.display, ok: false, status: "failed", error: errorMessage });
        void logOutgoingMessage({
          ...logMeta,
          status: "failed",
          errorCode: err instanceof WhatsAppError && err.metaCode ? String(err.metaCode) : null,
          errorMessage,
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

/** Envoie un message unique. Les modèles approuvés partent toujours (message
 *  proactif). Pour un texte libre, c'est Meta qui arbitre la fenêtre de service
 *  client de 24 h : on tente l'envoi et, hors fenêtre, Meta répond 131047,
 *  traduit par le client en une erreur claire. On ne bloque plus localement sur
 *  notre propre suivi des messages entrants, qui peut être incomplet tant que le
 *  webhook n'alimente pas whatsapp_contacts. */
async function sendOne(to: string, message: OutgoingMessage): Promise<{ messageId: string }> {
  if (message.kind === "template") {
    return sendTemplateMessage(to, {
      templateId: message.templateId,
      variables: message.variables,
      language: message.language,
    });
  }
  return sendTextMessage(to, message.text);
}
