import { NextResponse } from "next/server";
import { assertCanSendWhatsApp } from "@/lib/whatsapp/auth";
import { WhatsAppError } from "@/lib/whatsapp/client";
import { flushOutbox } from "@/lib/whatsapp/outbox";

/** Vide la file d'attente WhatsApp — c'est ce qui fait repartir tout seuls les
 *  messages accumulés pendant que le poste hébergeant la passerelle était
 *  éteint.
 *
 *  POURQUOI CETTE ROUTE EST LENTE, COMME L'ENVOI DIRECT
 *  ----------------------------------------------------
 *  Le vidage respecte la même temporisation aléatoire entre destinataires
 *  (`lib/whatsapp/pacing.ts`). Un rattrapage traite justement des lots
 *  accumulés : c'est le moment où l'on ressemble le plus à un robot, donc le
 *  dernier endroit où accélérer. La route s'arrête d'elle-même avant la limite
 *  d'exécution et laisse le reliquat pour le vidage suivant.
 *
 *  Une passerelle injoignable n'est PAS une erreur ici : c'est le cas nominal.
 *  On répond 200 avec `offline: true`, la file reste intacte, et l'appelant
 *  réessaiera plus tard. */

export const maxDuration = 60;

export async function POST() {
  try {
    await assertCanSendWhatsApp();
    const outcome = await flushOutbox();
    return NextResponse.json(outcome);
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
