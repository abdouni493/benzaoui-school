import { NextResponse } from "next/server";
import { assertCanSendWhatsApp } from "@/lib/whatsapp/auth";
import {
  WhatsAppError,
  connectInstance,
  createInstance,
  getConfig,
  logoutInstance,
  restartInstance,
  setWebhook,
} from "@/lib/whatsapp/client";
import { resolveWebhookUrl, sessionState } from "@/lib/whatsapp/session";
import type { WhatsAppSessionResponse } from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";
/** Une demande de QR laisse la passerelle réfléchir jusqu'à 30 s. Sans cette
 *  ligne la fonction était coupée par l'hébergeur AVANT son propre délai, et le
 *  navigateur recevait une 504 opaque au lieu du message de la route. */
export const maxDuration = 60;

/** Gestion de la session WhatsApp pour Paramètres → WhatsApp.
 *
 *  GET  : état de la session, sans aucun effet de bord.
 *  POST : actions explicites — initialiser, connecter (QR), redémarrer, délier.
 *
 *  Réservé à l'administration et à la réception (assertCanSendWhatsApp).
 *  Ne renvoie JAMAIS de secret : ni clé API, ni jeton de webhook. */

function failure(err: unknown) {
  if (err instanceof WhatsAppError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json(
    { error: "Impossible de lire ou de modifier la session WhatsApp." },
    { status: 500 },
  );
}

/** État de la session. Volontairement SANS demande de QR : le panneau interroge
 *  cette route toutes les 5 s pendant une connexion, et chaque QR demandé
 *  consomme le quota QRCODE_LIMIT de la passerelle. Le QR s'obtient par un
 *  POST { action: "connect" } explicite. */
export async function GET() {
  try {
    await assertCanSendWhatsApp();
    const state = await sessionState();
    return NextResponse.json<WhatsAppSessionResponse>({
      ...state,
      qrBase64: null,
      pairingCode: null,
    });
  } catch (err) {
    return failure(err);
  }
}

export async function POST(request: Request) {
  try {
    await assertCanSendWhatsApp();

    if (!getConfig()) {
      return NextResponse.json(
        {
          error:
            "WhatsApp non configuré. Renseigner EVOLUTION_BASE_URL et EVOLUTION_API_KEY côté serveur (voir README).",
        },
        { status: 503 },
      );
    }

    const { action } = (await request.json().catch(() => ({}))) as { action?: string };

    switch (action) {
      case "setup": {
        // Crée l'instance si besoin (idempotent) puis y enregistre le webhook.
        const webhookUrl = resolveWebhookUrl();
        await createInstance(webhookUrl);
        await setWebhook(webhookUrl);
        break;
      }

      case "connect": {
        const qr = await connectInstance();
        const state = await sessionState();
        return NextResponse.json<WhatsAppSessionResponse>({
          ...state,
          qrBase64: qr.qrBase64,
          pairingCode: qr.pairingCode,
        });
      }

      case "logout":
        await logoutInstance();
        break;

      case "restart":
        await restartInstance();
        break;

      default:
        return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
    }

    const state = await sessionState();
    return NextResponse.json<WhatsAppSessionResponse>({
      ...state,
      qrBase64: null,
      pairingCode: null,
    });
  } catch (err) {
    return failure(err);
  }
}
