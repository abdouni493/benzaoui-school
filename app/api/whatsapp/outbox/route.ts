import { NextResponse } from "next/server";
import { assertCanSendWhatsApp } from "@/lib/whatsapp/auth";
import { WhatsAppError } from "@/lib/whatsapp/client";
import { listPending, pendingCount } from "@/lib/whatsapp/outbox";

/** État de la file d'attente WhatsApp.
 *
 *  Volontairement BON MARCHÉ : cette route est interrogée en boucle par
 *  l'interface pour savoir s'il reste des messages à faire partir. Elle ne
 *  contacte donc JAMAIS la passerelle — deux lectures Supabase, rien de plus.
 *  Un appel qui réveillerait la passerelle à chaque sondage réveillerait aussi
 *  une fonction serverless pour rien. */

export async function GET() {
  try {
    await assertCanSendWhatsApp();
    const [pending, entries] = await Promise.all([pendingCount(), listPending(20)]);
    return NextResponse.json({ pending, entries });
  } catch (err) {
    if (err instanceof WhatsAppError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur inattendue." },
      { status: 500 },
    );
  }
}
