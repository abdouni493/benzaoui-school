import { NextResponse } from "next/server";
import { assertCanSendWhatsApp } from "@/lib/whatsapp/auth";
import { WhatsAppError, getConfig, getQrCode, getSession, startSession } from "@/lib/whatsapp/client";
import type { SessionStatePayload } from "@/lib/whatsapp/types";

/** État de la passerelle pour l'écran Paramètres → WhatsApp.
 *  Réservé à l'administration/réception : le QR code lie le compte WhatsApp de
 *  l'école, quiconque le scanne prend la main sur les envois. */
export async function GET() {
  try {
    await assertCanSendWhatsApp();

    if (!getConfig()) {
      return NextResponse.json<SessionStatePayload>({
        configured: false,
        status: null,
        phoneNumber: null,
        qrCode: null,
        lastError: null,
      });
    }

    const session = await getSession();

    // Le QR n'existe qu'entre le démarrage et le scan ; l'endpoint répond 400
    // dans tous les autres cas, ce qui n'est pas une erreur à remonter ici.
    let qrCode: string | null = null;
    if (session.status === "qr_ready") {
      qrCode = await getQrCode()
        .then((r) => r.qrCode)
        .catch(() => null);
    }

    return NextResponse.json<SessionStatePayload>({
      configured: true,
      status: session.status,
      // `phone` arrive en chiffres bruts (ex. "213555123456") une fois le compte lié.
      phoneNumber: session.phone ? `+${session.phone}` : null,
      qrCode,
      lastError: session.lastError ?? null,
    });
  } catch (err) {
    if (err instanceof WhatsAppError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Impossible de lire l'état de la passerelle." }, { status: 500 });
  }
}

/** Relance la session — utile après une déconnexion ou pour régénérer un QR code. */
export async function POST() {
  try {
    await assertCanSendWhatsApp();
    const session = await startSession();
    return NextResponse.json({ status: session.status });
  } catch (err) {
    if (err instanceof WhatsAppError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Impossible de démarrer la session." }, { status: 500 });
  }
}
