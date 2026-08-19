import { NextResponse } from "next/server";
import { assertCanSendWhatsApp } from "@/lib/whatsapp/auth";
import { WhatsAppError } from "@/lib/whatsapp/client";
import { sessionState } from "@/lib/whatsapp/session";
import type { WhatsAppSessionState } from "@/lib/whatsapp/types";

export const dynamic = "force-dynamic";

/** État de la session WhatsApp pour l'écran Paramètres → WhatsApp.
 *  Réservé à l'administration/réception. Ne renvoie AUCUN secret : ni clé API,
 *  ni jeton de webhook — seulement un identifiant masqué, l'hôte de la
 *  passerelle et un statut de connexion.
 *
 *  Une panne de la passerelle ne fait PAS échouer la route : l'erreur est
 *  rapportée dans le champ `error`, avec `connected: false`. */
export async function GET() {
  try {
    await assertCanSendWhatsApp();
    return NextResponse.json<WhatsAppSessionState>(await sessionState());
  } catch (err) {
    if (err instanceof WhatsAppError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Impossible de lire l'état de la session WhatsApp." },
      { status: 500 },
    );
  }
}
