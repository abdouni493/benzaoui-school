"use client";

/** Vide la file d'attente WhatsApp en arrière-plan.
 *
 *  POURQUOI CE COMPOSANT EXISTE
 *  ----------------------------
 *  La passerelle est auto-hébergée sur un poste de l'école. Quand ce poste est
 *  éteint, les messages sont mis en file plutôt que perdus — mais il faut bien
 *  quelque chose pour les faire repartir à son retour. Vercel étant serverless,
 *  rien ne tourne côté serveur entre deux requêtes : c'est donc l'application
 *  ouverte dans le navigateur qui déclenche le rattrapage.
 *
 *  Ce n'est pas un pis-aller. Le poste de l'école a l'application ouverte toute
 *  la journée (c'est lui qui scanne les cartes), et c'est le même poste qui
 *  héberge la passerelle : quand il est allumé, quelqu'un regarde l'écran, donc
 *  le rattrapage part.
 *
 *  ÉCONOMIE D'APPELS — délibérée
 *  Le sondage interroge `/api/whatsapp/outbox`, qui ne fait que compter des
 *  lignes et ne réveille JAMAIS la passerelle. Le vidage, lui, n'est appelé que
 *  s'il y a réellement quelque chose à envoyer. Un écran ouvert des heures avec
 *  une file vide ne coûte donc qu'une requête très bon marché par intervalle. */

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { useSession } from "@/lib/store/session";
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
  const [pending, setPending] = useState(0);
  const [flushing, setFlushing] = useState(false);
  const mounted = useRef(true);
  // Empêche deux vidages simultanés : le sondage suivant peut tomber pendant
  // qu'un vidage lent (temporisation anti-bannissement) est encore en cours.
  const busy = useRef(false);
  // Coupe définitivement le sondage si la route refuse l'accès.
  const forbidden = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const tick = useCallback(async () => {
    if (busy.current || forbidden.current) return;
    try {
      const res = await fetch("/api/whatsapp/outbox", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        forbidden.current = true;
        return;
      }
      if (!res.ok) return;

      const data = (await res.json()) as OutboxResponse;
      if (!mounted.current) return;
      setPending(data.pending);
      if (data.pending === 0) return;

      busy.current = true;
      setFlushing(true);
      const flush = await fetch("/api/whatsapp/outbox/flush", { method: "POST" });
      if (flush.ok) {
        const outcome = (await flush.json()) as FlushOutcome;
        if (mounted.current) setPending(outcome.remaining);
      }
    } catch {
      // Réseau indisponible : on retentera au prochain intervalle. Silencieux
      // à dessein — c'est une tâche de fond, pas une action de l'utilisateur.
    } finally {
      busy.current = false;
      if (mounted.current) setFlushing(false);
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

  if (pending === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-full border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning shadow-lg backdrop-blur">
        <Clock className={`h-3.5 w-3.5 ${flushing ? "animate-spin" : ""}`} />
        <span>
          {pending} message{pending > 1 ? "s" : ""} en attente
          {flushing ? " — envoi en cours…" : " — repartira dès le retour de la passerelle"}
        </span>
      </div>
    </div>
  );
}
