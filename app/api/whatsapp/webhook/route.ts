import { NextResponse } from "next/server";
import { verifyWebhookSignature, verifyWebhookToken } from "@/lib/whatsapp/client";
import { recordInboundMessage, updateMessageStatus } from "@/lib/whatsapp/log";
import type { MessageStatus } from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";

/** Vérification d'abonnement du webhook (requête GET de Meta).
 *  Meta appelle `?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` : si le
 *  jeton correspond, on renvoie le challenge tel quel en texte brut. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge") ?? "";

  if (mode === "subscribe" && verifyWebhookToken(token)) {
    return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/** Statuts Meta admis. Tout autre libellé est ignoré sans faire planter le
 *  traitement. */
const KNOWN_STATUSES: MessageStatus[] = ["sent", "delivered", "read", "failed"];

interface MetaStatus {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
}
interface MetaMessage {
  from?: string;
  id?: string;
  timestamp?: string;
}
interface MetaWebhookBody {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      value?: { statuses?: MetaStatus[]; messages?: MetaMessage[] };
    }>;
  }>;
}

/** Réception des événements webhook (POST). On valide d'abord la signature Meta
 *  (HMAC App Secret sur le corps brut) : jamais de confiance à une POST
 *  arbitraire. Le traitement est tolérant (un type d'événement inattendu ne fait
 *  pas planter) et idempotent (un événement livré deux fois n'a aucun effet
 *  supplémentaire). On acquitte vite par un 200. */
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyWebhookSignature(raw, signature)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  let body: MetaWebhookBody;
  try {
    body = JSON.parse(raw) as MetaWebhookBody;
  } catch {
    // Signature valide mais corps illisible : on acquitte pour éviter les
    // relances inutiles de Meta, sans rien traiter.
    return NextResponse.json({ received: true });
  }

  const tasks: Promise<void>[] = [];

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Accusés de statut : accepted -> sent -> delivered -> read | failed.
      for (const s of value.statuses ?? []) {
        if (!s.id || !s.status) continue;
        const status = s.status as MessageStatus;
        if (!KNOWN_STATUSES.includes(status)) continue;

        const firstError = s.errors?.[0];
        tasks.push(
          updateMessageStatus(s.id, status, {
            timestamp: s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : undefined,
            errorCode: firstError?.code != null ? String(firstError.code) : null,
            errorMessage: firstError?.message ?? firstError?.title ?? null,
          }),
        );
      }

      // Messages entrants : ouvrent/rafraîchissent la fenêtre de service client.
      for (const m of value.messages ?? []) {
        if (!m.from || !m.id) continue;
        tasks.push(recordInboundMessage(m.from, m.id, m.timestamp));
      }
    }
  }

  // Écritures courtes et best-effort (chacune avale ses erreurs) : on les
  // termine avant d'acquitter, car en serverless rien ne garantit qu'une
  // promesse survive après la réponse.
  await Promise.allSettled(tasks);

  return NextResponse.json({ received: true });
}
