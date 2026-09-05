"use client";

/** L'état de la file WhatsApp, partagé par les deux morceaux qui s'en servent.
 *
 *  POURQUOI UN STORE PLUTÔT QUE DEUX SONDAGES
 *  ------------------------------------------
 *  Deux choses regardent la file : le vidage de fond, monté dans la coquille de
 *  l'application (il tourne sur toutes les pages), et la carte du tableau de
 *  bord (qui n'existe que là). Les laisser interroger chacun la route de leur
 *  côté doublait les requêtes sur la page qui en a le plus — le tableau de
 *  bord, justement.
 *
 *  Le sondage vit donc ici, en un seul exemplaire, et les deux le lisent. */

import { create } from "zustand";
import type { OutboxEntry, OfflineReason } from "@/lib/whatsapp/types";

interface QueueState {
  /** approuvés, en attente de la passerelle — ils partiront tout seuls */
  pending: number;
  /** proposés, en attente d'une relecture sur le tableau de bord */
  drafts: number;
  /** le détail des brouillons, texte compris */
  draftEntries: OutboxEntry[];
  /** le détail des approuvés encore en file */
  entries: OutboxEntry[];
  /** un vidage est en cours */
  flushing: boolean;
  /** pourquoi le dernier vidage n'a rien pu envoyer ; `undefined` tant qu'aucun
   *  vidage n'a eu lieu — on se tait alors sur la cause plutôt que d'en
   *  inventer une */
  reason: OfflineReason | undefined;
  /** la route a refusé l'accès : inutile d'insister */
  forbidden: boolean;
  set: (patch: Partial<QueueState>) => void;
}

export const useWhatsAppQueue = create<QueueState>((set) => ({
  pending: 0,
  drafts: 0,
  draftEntries: [],
  entries: [],
  flushing: false,
  reason: undefined,
  forbidden: false,
  set: (patch) => set(patch),
}));
