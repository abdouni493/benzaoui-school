/** Ce qu'il faut DIRE, et ce qu'il faut FAIRE, quand un message ne part pas.
 *
 *  Trois écrans annonçaient la même phrase — « la passerelle est injoignable,
 *  ils partiront dès son retour » — quelle que soit la cause réelle. Elle est
 *  fausse deux fois sur trois, et coûteuse : la file grossit pendant que
 *  l'école attend le retour d'une passerelle qui n'est jamais partie, alors que
 *  le geste tenait en trente secondes (relier le téléphone au QR).
 *
 *  Ce module est CLIENT-SAFE : il n'importe rien de serveur, seulement le type
 *  partagé. Les quatre écrans qui annoncent une mise en file s'en servent, pour
 *  que la même situation reçoive partout la même phrase.
 */

import type { OfflineReason } from "./types";

export interface OfflineExplanation {
  /** ce qui bloque, en une proposition — se lit à la suite du décompte */
  what: string;
  /** le geste qui débloque, ou la raison pour laquelle il n'y en a pas */
  todo: string;
  /** vrai quand la file repartira TOUTE SEULE, sans intervention */
  selfHealing: boolean;
}

/** Le repli quand le serveur n'a pas dit pourquoi (route d'une version
 *  antérieure) : l'ancienne phrase, qui reste la cause la plus fréquente. */
const UNKNOWN: OfflineExplanation = {
  what: "la passerelle n'a pas répondu",
  todo: "Les messages repartiront automatiquement dès son retour.",
  selfHealing: true,
};

const EXPLANATIONS: Record<OfflineReason, OfflineExplanation> = {
  unconfigured: {
    what: "la passerelle n'est pas configurée sur le serveur",
    todo:
      "Renseigner les variables EVOLUTION_* puis redéployer : sans elles, rien ne partira de lui-même.",
    selfHealing: false,
  },
  unreachable: {
    what: "la passerelle ne répond pas",
    todo:
      "Le poste qui l'héberge est éteint, en veille, ou sans Internet. Les messages repartiront automatiquement dès son retour.",
    selfHealing: true,
  },
  disconnected: {
    what: "la session WhatsApp est fermée",
    todo:
      "La passerelle répond, mais le téléphone s'est délié : attendre n'y changera rien. Ouvrir Paramètres → WhatsApp et scanner le QR pour la relier.",
    selfHealing: false,
  },
};

export function explainOffline(reason?: OfflineReason): OfflineExplanation {
  return reason ? EXPLANATIONS[reason] : UNKNOWN;
}

/** La phrase complète, telle que les toasts l'affichent. */
export function offlineSentence(reason?: OfflineReason): string {
  const e = explainOffline(reason);
  return `${e.what.charAt(0).toUpperCase()}${e.what.slice(1)} : ${e.todo}`;
}
