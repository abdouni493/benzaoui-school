import { NextResponse } from "next/server";
import { assertCanSendWhatsApp } from "@/lib/whatsapp/auth";
import {
  WhatsAppError,
  filterWhatsAppNumbers,
  getConfig,
  getConnectionState,
  sendTextMessage,
} from "@/lib/whatsapp/client";
import { logOutgoingMessage } from "@/lib/whatsapp/log";
import { type QueueEntry, queueMessages } from "@/lib/whatsapp/outbox";
import { TYPING_DELAY_MS, randomGap, sleep } from "@/lib/whatsapp/pacing";
import { normalizePhone } from "@/lib/whatsapp/phone";
import { MAX_MESSAGE_LENGTH } from "@/lib/whatsapp/templates";
import type { OutgoingMessage, SendResult } from "@/lib/whatsapp/types";

/** Envoi WhatsApp par la passerelle Evolution.
 *
 *  POURQUOI CETTE ROUTE EST LENTE — ET POURQUOI IL NE FAUT PAS L'ACCÉLÉRER
 *  ----------------------------------------------------------------------
 *  Les messages partent d'une session WhatsApp Web ordinaire, depuis le numéro
 *  de l'école. Envoyer en rafale depuis une telle session est le premier motif
 *  de bannissement d'un numéro par WhatsApp — et un bannissement est sans
 *  recours : ni support, ni appel, ni délai de grâce. On temporise donc
 *  volontairement entre deux destinataires, avec un délai ALÉATOIRE : une
 *  cadence parfaitement régulière est elle-même un signal d'automatisation.
 *
 *  Retirer cette temporisation « pour aller plus vite » ferait perdre le numéro
 *  WhatsApp de l'école. C'est un choix délibéré, pas une maladresse.
 *
 *  Conséquence : un lot est borné par le TEMPS, pas seulement par un nombre. La
 *  route s'arrête d'elle-même avant la limite d'exécution de Vercel et rend les
 *  destinataires non traités dans `remaining` ; l'interface enchaîne alors un
 *  second appel. Être coupé en plein vol laisserait des messages partis sans
 *  trace en base — et l'utilisateur les renverrait en double. */

/** Limite d'exécution de la fonction serverless, en secondes. */
export const maxDuration = 60;

/** Plafond dur de destinataires par appel. L'interface découpe au-delà. */
const MAX_RECIPIENTS = 8;

/** On rend la main avant d'être coupé : ~15 s de marge sous `maxDuration`, de
 *  quoi terminer l'envoi en cours, le journaliser et sérialiser la réponse. */
const TIME_BUDGET_MS = 45_000;

// La temporisation anti-bannissement vit dans `lib/whatsapp/pacing.ts` : le
// vidage de la file d'attente envoie lui aussi, et les deux chemins doivent
// respecter exactement la même cadence.

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

/** Résout le message effectif d'un destinataire (propre, sinon global, sinon
 *  texte de compat), ou `null` si rien n'est fourni. */
function resolveMessage(recipient: Recipient, body: SendBody): OutgoingMessage | null {
  if (recipient.message?.text?.trim()) return recipient.message;
  if (recipient.text?.trim()) return { kind: "text", text: recipient.text.trim() };
  if (body.message?.text?.trim()) return body.message;
  if (body.text?.trim()) return { kind: "text", text: body.text.trim() };
  return null;
}

/** Valide un message avant tout envoi : le lot est vérifié EN ENTIER d'abord,
 *  pour ne pas partir à moitié puis se bloquer à mi-course. */
function validateMessage(msg: OutgoingMessage): string | null {
  if (!msg.text.trim()) return "Le message est vide.";
  if (msg.text.length > MAX_MESSAGE_LENGTH) {
    return `Le message dépasse ${MAX_MESSAGE_LENGTH} caractères.`;
  }
  return null;
}

export async function POST(request: Request) {
  try {
    await assertCanSendWhatsApp();

    const config = getConfig();
    if (!config) {
      return NextResponse.json(
        {
          error:
            "WhatsApp non configuré. Renseigner EVOLUTION_BASE_URL et EVOLUTION_API_KEY côté serveur (voir README).",
        },
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
        {
          error: `Maximum ${MAX_RECIPIENTS} destinataires par envoi. L'interface découpe automatiquement les envois plus grands.`,
        },
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

    /** Met le lot en file d'attente plutôt que de le perdre. Les numéros
     *  invalides sont écartés au passage : les mettre en file reviendrait à
     *  réessayer indéfiniment quelque chose qui ne marchera jamais. */
    async function queueBatch(
      items: { recipient: Recipient; message: OutgoingMessage | null }[],
    ): Promise<{ results: SendResult[]; queued: number; invalid: number }> {
      const results: SendResult[] = [];
      const toQueue: QueueEntry[] = [];

      for (const { recipient, message } of items) {
        const name = recipient.name?.trim() || recipient.phone;
        const normalized = normalizePhone(recipient.phone);

        if (!normalized) {
          const error = "Numéro invalide";
          results.push({ name, phone: recipient.phone, ok: false, status: "failed", error });
          await logOutgoingMessage({
            recipientPhone: recipient.phone,
            recipientName: name,
            studentId: recipient.studentId,
            parentId: recipient.parentId,
            messageType: "text",
            instance: config!.instance,
            status: "failed",
            errorMessage: error,
          });
          continue;
        }

        toQueue.push({
          recipientPhone: normalized.msisdn,
          recipientDisplay: normalized.display,
          recipientName: recipient.name?.trim() || null,
          studentId: recipient.studentId ?? null,
          parentId: recipient.parentId ?? null,
          messageType: "text",
          body: message!.text,
        });
        results.push({ name, phone: normalized.display, ok: false, status: "pending" });
      }

      const queued = await queueMessages(toQueue);
      return { results, queued, invalid: results.length - toQueue.length };
    }

    // Passerelle injoignable (poste éteint, en veille, sans Internet) ou session
    // tombée : le message N'EST PAS PERDU. Il part en file d'attente et repartira
    // seul au retour de la passerelle.
    //
    // C'est le comportement qui compte le plus pour une alerte automatique
    // déclenchée par un scan de carte : personne ne serait jamais revenu la
    // renvoyer à la main.
    let gatewayReady = false;
    try {
      const { state } = await getConnectionState();
      gatewayReady = state === "open";
    } catch {
      gatewayReady = false;
    }

    if (!gatewayReady) {
      const { results, queued, invalid } = await queueBatch(resolved);
      return NextResponse.json({
        sent: 0,
        failed: invalid,
        queued,
        offline: true,
        results,
      });
    }

    // Numéros réellement joignables sur WhatsApp. `null` = vérification
    // indisponible : on tente alors l'envoi pour tout le monde, comme avant.
    const msisdns = resolved
      .map((r) => normalizePhone(r.recipient.phone)?.msisdn)
      .filter((v): v is string => Boolean(v));
    const reachable = await filterWhatsAppNumbers(msisdns);

    const results: SendResult[] = [];
    const remaining: string[] = [];
    const started = Date.now();
    // Renseignés si la passerelle tombe en plein lot (voir plus bas).
    let queuedOffline = 0;
    let wentOffline = false;

    for (let i = 0; i < resolved.length; i++) {
      const { recipient, message } = resolved[i];
      const name = recipient.name?.trim() || recipient.phone;
      const normalized = normalizePhone(recipient.phone);

      // Métadonnées de journalisation communes au succès et à l'échec.
      const logMeta = {
        recipientPhone: normalized?.msisdn ?? recipient.phone,
        recipientName: name,
        studentId: recipient.studentId,
        parentId: recipient.parentId,
        messageType: "text",
        instance: config.instance,
      };

      if (!normalized) {
        const error = "Numéro invalide";
        results.push({ name, phone: recipient.phone, ok: false, status: "failed", error });
        await logOutgoingMessage({ ...logMeta, status: "failed", errorMessage: error });
        continue;
      }

      // Numéro bien formé mais sans compte WhatsApp : la passerelle accepterait
      // l'envoi sans broncher et le message partirait dans le vide. Meta, lui,
      // refusait explicitement — on rétablit ce garde-fou.
      if (reachable && !reachable.has(normalized.msisdn)) {
        const error = "Aucun compte WhatsApp sur ce numéro";
        results.push({ name, phone: normalized.display, ok: false, status: "failed", error });
        await logOutgoingMessage({ ...logMeta, status: "failed", errorMessage: error });
        continue;
      }

      try {
        const { messageId } = await sendTextMessage(normalized.msisdn, message!.text, {
          delayMs: TYPING_DELAY_MS,
        });
        results.push({ name, phone: normalized.display, ok: true, messageId, status: "queued" });
        await logOutgoingMessage({ ...logMeta, messageId, status: "queued" });
      } catch (err) {
        // Passerelle tombée EN COURS de lot : le reste échouerait pareil. On
        // met le reliquat — courant compris — en file d'attente, puis on rend
        // la main. Ce qui était déjà parti reste parti : pas de doublon.
        if (err instanceof WhatsAppError && (err.status === 503 || err.status === 502)) {
          const rest = await queueBatch(resolved.slice(i));
          results.push(...rest.results);
          queuedOffline = rest.queued;
          wentOffline = true;
          break;
        }

        const errorMessage = err instanceof Error ? err.message : "Échec de l'envoi";
        results.push({
          name,
          phone: normalized.display,
          ok: false,
          status: "failed",
          error: errorMessage,
        });
        await logOutgoingMessage({
          ...logMeta,
          status: "failed",
          errorCode:
            err instanceof WhatsAppError && err.providerCode ? String(err.providerCode) : null,
          errorMessage,
        });
      }

      // Pause avant le PROCHAIN destinataire — jamais après le dernier.
      if (i === resolved.length - 1) break;

      const gap = randomGap();
      if (Date.now() - started + gap > TIME_BUDGET_MS) {
        // Plus le temps de traiter la suite sereinement : on rend la main avec
        // le reliquat plutôt que de se faire couper en plein envoi.
        for (let j = i + 1; j < resolved.length; j++) {
          remaining.push(resolved[j].recipient.phone);
        }
        break;
      }
      await sleep(gap);
    }

    const sent = results.filter((r) => r.ok).length;
    // Un message en file n'est ni parti ni en échec : le compter comme un échec
    // ferait afficher une erreur pour quelque chose qui va partir tout seul.
    const pending = results.filter((r) => r.status === "pending").length;
    return NextResponse.json({
      sent,
      failed: results.length - sent - pending,
      results,
      ...(remaining.length > 0 ? { remaining } : {}),
      ...(queuedOffline > 0 ? { queued: queuedOffline } : {}),
      ...(wentOffline ? { offline: true } : {}),
    });
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
