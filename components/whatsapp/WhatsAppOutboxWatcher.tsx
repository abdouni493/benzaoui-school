"use client";

/** Vide la file d'attente WhatsApp en arrière-plan. SANS RIEN AFFICHER.
 *
 *  POURQUOI CE COMPOSANT EXISTE
 *  ----------------------------
 *  La passerelle est auto-hébergée sur un poste de l'école. Quand ce poste est
 *  éteint, les messages approuvés sont mis en file plutôt que perdus — mais il
 *  faut bien quelque chose pour les faire repartir à son retour. Vercel étant
 *  serverless, rien ne tourne côté serveur entre deux requêtes : c'est donc
 *  l'application ouverte dans le navigateur qui déclenche le rattrapage.
 *
 *  Ce n'est pas un pis-aller. Le poste de l'école a l'application ouverte toute
 *  la journée (c'est lui qui scanne les cartes), et c'est le même poste qui
 *  héberge la passerelle : quand il est allumé, quelqu'un regarde l'écran, donc
 *  le rattrapage part.
 *
 *  POURQUOI IL N'AFFICHE PLUS RIEN
 *  -------------------------------
 *  Il posait un bandeau fixe en bas de CHAQUE écran — « N messages en attente,
 *  la passerelle ne répond pas ». Un bandeau permanent, sur toutes les pages,
 *  pour une file qui se vide toute seule : impossible à ignorer, impossible à
 *  refermer, et sans rapport avec ce que l'utilisateur était en train de faire.
 *
 *  L'information n'a pas disparu, elle a un endroit : la carte WhatsApp du
 *  tableau de bord, qui montre les messages, leur texte, et permet de les
 *  envoyer. Ici il ne reste que le travail de fond — le seul morceau qui doive
 *  vraiment tourner sur toutes les pages.
 *
 *  IL NE FAIT PARTIR QUE LES MESSAGES APPROUVÉS. Les brouillons (une alerte de
 *  solde née d'un badge) ne sont jamais touchés : ils attendent qu'on les
 *  relise sur le tableau de bord.
 *
 *  ÉCONOMIE D'APPELS — délibérée
 *  Le sondage interroge `/api/whatsapp/outbox`, qui ne fait que compter des
 *  lignes et ne réveille JAMAIS la passerelle. Le vidage, lui, n'est appelé que
 *  s'il y a réellement quelque chose d'approuvé à envoyer. Un écran ouvert des
 *  heures avec une file vide ne coûte donc qu'une requête très bon marché par
 *  intervalle. */

import { useCallback, useEffect, useRef } from "react";
import { useSession } from "@/lib/store/session";
import { useWhatsAppQueue } from "@/lib/store/whatsappQueue";
import type { FlushOutcome, OutboxResponse } from "@/lib/whatsapp/types";

/** Intervalle de sondage. Assez court pour qu'un retour de la passerelle soit
 *  rattrapé dans la minute, assez long pour ne pas réveiller une fonction
 *  serverless en permanence. */
const POLL_MS = 60_000;

/** Délai avant le tout premier sondage après montage. */
const FIRST_DELAY_MS = 3_000;

/** Seuls ces rôles ont le droit d'envoyer : inutile de sonder pour les autres,
 *  la route répondrait 403 en boucle. */
const SENDER_ROLES = ["admin", "reception"];

export function WhatsAppOutboxWatcher() {
  const role = useSession((s) => s.user?.role);
  const mounted = useRef(true);
  // Empêche deux vidages simultanés : le sondage suivant peut tomber pendant
  // qu'un vidage lent (temporisation anti-bannissement) est encore en cours.
  const busy = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const tick = useCallback(async () => {
    const store = useWhatsAppQueue.getState();
    if (busy.current || store.forbidden) return;
    try {
      const res = await fetch("/api/whatsapp/outbox", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        store.set({ forbidden: true });
        return;
      }
      if (!res.ok) return;

      const data = (await res.json()) as OutboxResponse;
      if (!mounted.current) return;
      store.set({
        pending: data.pending,
        drafts: data.drafts ?? 0,
        entries: data.entries ?? [],
        draftEntries: data.draftEntries ?? [],
      });

      // Rien d'APPROUVÉ à faire partir. Des brouillons peuvent très bien
      // attendre : ce n'est pas à ce composant de les envoyer.
      if (data.pending === 0) return;

      busy.current = true;
      store.set({ flushing: true });
      const flush = await fetch("/api/whatsapp/outbox/flush", { method: "POST" });
      if (flush.ok) {
        const outcome = (await flush.json()) as FlushOutcome;
        if (mounted.current) {
          useWhatsAppQueue.getState().set({
            pending: outcome.remaining,
            reason: outcome.offline ? outcome.reason : undefined,
          });
        }
      }
    } catch {
      // Réseau indisponible : on retentera au prochain intervalle. Silencieux
      // à dessein — c'est une tâche de fond, pas une action de l'utilisateur.
    } finally {
      busy.current = false;
      if (mounted.current) useWhatsAppQueue.getState().set({ flushing: false });
    }
  }, []);

  useEffect(() => {
    if (!role || !SENDER_ROLES.includes(role)) return;
    // Premier passage DIFFÉRÉ, pour deux raisons : laisser la page se peindre
    // avant toute tâche de fond, et éviter une requête à chaque navigation —
    // ce composant est monté dans la coquille, donc remonté au moindre
    // changement de page.
    const first = setTimeout(() => void tick(), FIRST_DELAY_MS);
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [role, tick]);

  // Aucune interface : voir l'en-tête. Le tableau de bord porte l'affichage.
  return null;
}
