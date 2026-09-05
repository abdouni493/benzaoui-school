import { NextResponse } from "next/server";
import { assertCanSendWhatsApp } from "@/lib/whatsapp/auth";
import { WhatsAppError } from "@/lib/whatsapp/client";
import { draftCount, listDrafts, listPending, pendingCount } from "@/lib/whatsapp/outbox";

/** État de la file d'attente WhatsApp.
 *
 *  Volontairement BON MARCHÉ : cette route est interrogée en boucle par
 *  l'interface pour savoir s'il reste des messages à faire partir. Elle ne
 *  contacte donc JAMAIS la passerelle — quelques lectures Supabase, rien de
 *  plus. Un appel qui réveillerait la passerelle à chaque sondage réveillerait
 *  aussi une fonction serverless pour rien.
 *
 *  DEUX FILES, PAS UNE — et la distinction est tout l'objet de cette route :
 *
 *   · `drafts`  — des messages PROPOSÉS (une alerte de solde née d'un badge).
 *     Personne ne les a relus, et ils ne partiront jamais d'eux-mêmes. Le
 *     tableau de bord les montre, texte compris, et c'est l'école qui décide.
 *   · `pending` — des messages APPROUVÉS qui n'attendent plus que la
 *     passerelle. Ceux-là partent tout seuls dès qu'elle répond : il n'y a
 *     rien à faire, et donc rien à annoncer ailleurs que sur le tableau de
 *     bord. */

export async function GET() {
  try {
    await assertCanSendWhatsApp();
    const [pending, drafts, entries, draftEntries] = await Promise.all([
      pendingCount(),
      draftCount(),
      listPending(20),
      listDrafts(50),
    ]);
    return NextResponse.json({ pending, drafts, entries, draftEntries });
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
