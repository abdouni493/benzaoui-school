import { NextResponse } from "next/server";
import { assertCanSendWhatsApp } from "@/lib/whatsapp/auth";
import { WhatsAppError } from "@/lib/whatsapp/client";
import { approveDrafts, discardDrafts, flushOutbox, pendingCount } from "@/lib/whatsapp/outbox";
import type { DraftActionResult } from "@/lib/whatsapp/types";

/** Ce que l'école décide de faire des alertes proposées.
 *
 *  POURQUOI CETTE ROUTE EXISTE
 *  ---------------------------
 *  Les alertes de solde partaient toutes seules, au moment du badge. Deux
 *  conséquences, aussi mauvaises l'une que l'autre : un message pouvait partir
 *  chez une famille sans que personne à l'école ne l'ait lu, et quand la
 *  passerelle était éteinte, un bandeau d'échec s'installait sur TOUS les
 *  écrans pour annoncer un problème que personne ne pouvait résoudre depuis la
 *  page où il s'affichait.
 *
 *  Désormais un badge PROPOSE (un brouillon), et cette route est le seul
 *  endroit où l'on DISPOSE :
 *
 *   · "send"    — approuve les brouillons choisis, puis tente de les faire
 *     partir tout de suite. Si la passerelle est joignable, ils partent ; si
 *     elle ne l'est pas, ils RESTENT approuvés et le vidage de fond les fera
 *     partir tout seuls dès son retour. L'utilisateur n'a plus rien à faire
 *     dans les deux cas — c'est la différence avec l'ancien échec sec.
 *   · "discard" — les écarte pour de bon. La ligne reste en base, marquée
 *     « abandonné » : on peut toujours dire ce qui n'est pas parti.
 *
 *  Comme le vidage, elle envoie à la cadence anti-bannissement : lente à
 *  dessein (voir lib/whatsapp/pacing.ts). */

export const maxDuration = 60;

interface Body {
  ids?: unknown;
  action?: unknown;
}

export async function POST(request: Request) {
  try {
    await assertCanSendWhatsApp();

    const body = (await request.json()) as Body;
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((v): v is string => typeof v === "string" && v.length > 0)
      : [];
    const action = body.action === "discard" ? "discard" : "send";

    if (ids.length === 0) {
      return NextResponse.json({ error: "Aucun message sélectionné." }, { status: 400 });
    }

    if (action === "discard") {
      const discarded = await discardDrafts(ids);
      const result: DraftActionResult = {
        approved: 0,
        discarded,
        sent: 0,
        waiting: await pendingCount(),
        offline: false,
      };
      return NextResponse.json(result);
    }

    const approved = await approveDrafts(ids);
    if (approved === 0) {
      // Déjà approuvés (double clic) ou déjà écartés : rien de neuf, et
      // surtout rien à renvoyer en double.
      const result: DraftActionResult = {
        approved: 0,
        discarded: 0,
        sent: 0,
        waiting: await pendingCount(),
        offline: false,
      };
      return NextResponse.json(result);
    }

    // On tente le départ IMMÉDIATEMENT plutôt que d'attendre le prochain
    // sondage : quand la passerelle est là, « Envoyer » doit envoyer.
    const outcome = await flushOutbox();
    const result: DraftActionResult = {
      approved,
      discarded: 0,
      sent: outcome.sent,
      waiting: outcome.remaining,
      offline: outcome.offline,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
    };
    return NextResponse.json(result);
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
