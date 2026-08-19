import { NextResponse } from "next/server";
import { isKnownServerUrl, mapEvolutionStatus, verifyWebhookToken } from "@/lib/whatsapp/client";
import { recordInboundMessage, updateMessageStatus } from "@/lib/whatsapp/log";

export const dynamic = "force-dynamic";

/** Réception des événements de la passerelle Evolution.
 *
 *  SÉCURITÉ — contrairement au transport précédent, Evolution ne signe PAS ses
 *  webhooks : aucune empreinte HMAC n'accompagne le corps. L'authenticité
 *  repose donc sur deux barrières, vérifiées AVANT tout traitement :
 *    1. un jeton partagé, envoyé par la passerelle dans `Authorization: Bearer`
 *       et comparé en temps constant ;
 *    2. le champ `server_url` du corps, qui doit désigner notre passerelle.
 *  Sans elles, n'importe qui sur Internet pourrait empoisonner le journal. */

interface EvolutionEventBody {
  event?: string;
  instance?: string;
  server_url?: string;
  date_time?: string;
  data?: unknown;
}

interface MessageKey {
  id?: string;
  remoteJid?: string;
  fromMe?: boolean;
}

interface MessageNode {
  key?: MessageKey;
  keyId?: string;
  messageId?: string;
  status?: string | number;
  messageTimestamp?: string | number;
  remoteJid?: string;
  fromMe?: boolean;
}

/** Selon la version, `data` porte un objet ou un tableau d'objets. */
function asNodes(data: unknown): MessageNode[] {
  if (Array.isArray(data)) return data.filter((d): d is MessageNode => Boolean(d) && typeof d === "object");
  if (data && typeof data === "object") return [data as MessageNode];
  return [];
}

/** Identifiant du message, dont l'emplacement varie selon la version. */
function messageIdOf(node: MessageNode): string | null {
  return node.keyId || node.key?.id || node.messageId || null;
}

/** Numéro d'un JID WhatsApp ("213555123456@s.whatsapp.net" → "213555123456").
 *  `null` pour un JID de groupe : une discussion de groupe n'est pas un contact
 *  famille, on ne l'enregistre pas. */
function msisdnFromJid(jid: string | undefined): string | null {
  if (!jid || jid.endsWith("@g.us")) return null;
  const digits = jid.split("@")[0]?.replace(/\D/g, "");
  return digits || null;
}

/** Horodatage de l'événement, en ISO. Priorité au timestamp du message
 *  (secondes Unix), repli sur la date de l'enveloppe. */
function timestampOf(node: MessageNode, body: EvolutionEventBody): string | undefined {
  if (node.messageTimestamp !== undefined) {
    const seconds = Number(node.messageTimestamp);
    if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1000).toISOString();
  }
  if (body.date_time) {
    const parsed = new Date(body.date_time);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return undefined;
}

/** Evolution ne fait aucun handshake de vérification (c'était propre à Meta). */
export async function GET() {
  return new NextResponse("Method Not Allowed", { status: 405 });
}

export async function POST(request: Request) {
  // 1. Jeton partagé — seule preuve d'origine dont on dispose.
  if (!verifyWebhookToken(request.headers.get("authorization"))) {
    console.warn("[whatsapp] webhook refusé : jeton absent ou invalide.");
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let body: EvolutionEventBody;
  try {
    body = (await request.json()) as EvolutionEventBody;
  } catch {
    // Jeton valide mais corps illisible : on acquitte pour éviter les relances,
    // sans rien traiter.
    return NextResponse.json({ received: true });
  }

  // 2. L'événement doit dire venir de NOTRE passerelle.
  if (!isKnownServerUrl(body.server_url)) {
    console.warn("[whatsapp] webhook refusé : server_url inattendu.");
    return new NextResponse("Forbidden", { status: 403 });
  }

  const tasks: Promise<void>[] = [];

  switch (body.event) {
    // Accusés de remise : queued -> sent -> delivered -> read | failed.
    case "MESSAGES_UPDATE": {
      for (const node of asNodes(body.data)) {
        const id = messageIdOf(node);
        if (!id) continue;

        // Libellé inconnu (une version future peut en ajouter) : on ignore
        // sans erreur plutôt que d'écrire n'importe quoi.
        const status = mapEvolutionStatus(node.status);
        if (!status) continue;

        // La non-régression des statuts est garantie par log.ts : on ne la
        // duplique pas ici.
        tasks.push(updateMessageStatus(id, status, { timestamp: timestampOf(node, body) }));
      }
      break;
    }

    // Nouveau message. `fromMe: true` est l'écho de notre propre envoi.
    case "MESSAGES_UPSERT": {
      for (const node of asNodes(body.data)) {
        const fromMe = node.key?.fromMe ?? node.fromMe;
        if (fromMe !== false) continue;

        const msisdn = msisdnFromJid(node.key?.remoteJid ?? node.remoteJid);
        const id = messageIdOf(node);
        if (!msisdn || !id) continue;

        tasks.push(recordInboundMessage(msisdn, id, node.messageTimestamp));
      }
      break;
    }

    // La session est tombée : l'école devra rescanner. Aucune écriture en base.
    case "CONNECTION_UPDATE": {
      const state = asNodes(body.data)[0] as { state?: string } | undefined;
      if (state?.state === "close") {
        console.warn(
          "[whatsapp] session déconnectée : rescanner le QR depuis Paramètres → WhatsApp.",
        );
      }
      break;
    }

    // Tout autre événement : ignoré silencieusement.
    default:
      break;
  }

  // Écritures courtes et best-effort (chacune avale ses erreurs) : on les
  // termine avant d'acquitter, car en serverless rien ne garantit qu'une
  // promesse survive après la réponse.
  await Promise.allSettled(tasks);

  // Toujours 200 quand l'authentification est passée : Evolution réessaie
  // jusqu'à 10 fois en backoff sur un code non-2xx, ce qui créerait des
  // doublons. Les 401/403 sont réservés aux rejets d'authentification.
  return NextResponse.json({ received: true });
}
