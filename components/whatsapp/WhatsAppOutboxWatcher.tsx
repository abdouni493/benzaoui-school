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
import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";
import { useSession } from "@/lib/store/session";
import { explainOffline } from "@/lib/whatsapp/offline";
import type { FlushOutcome, OfflineReason, OutboxResponse } from "@/lib/whatsapp/types";

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
  // Pourquoi le dernier vidage n'a rien pu envoyer. `undefined` tant qu'aucun
  // vidage n'a eu lieu : la bandeau se tait alors sur la cause plutôt que d'en
  // inventer une.
  const [reason, setReason] = useState<OfflineReason | undefined>(undefined);
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
        if (mounted.current) {
          setPending(outcome.remaining);
          setReason(outcome.offline ? outcome.reason : undefined);
        }
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

  const explanation = explainOffline(reason);
  const plural = pending > 1 ? "s" : "";
  // Une file qui ne repartira pas toute seule n'est pas une attente : c'est une
  // panne, et le bandeau le montre — couleur, icône, et le geste à faire.
  const stuck = !flushing && !explanation.selfHealing;

  const text = flushing
    ? `${pending} message${plural} en attente — envoi en cours…`
    : `${pending} message${plural} en attente — ${explanation.what}`;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 w-[min(92vw,34rem)] -translate-x-1/2">
      {/* Le bandeau MÈNE au seul écran qui répare : Paramètres → WhatsApp,
          onglet ouvert d'office. Sans ce lien il énonçait un problème sans
          jamais dire où le régler — et, quand la session était fermée, il
          conseillait d'attendre un retour qui avait déjà eu lieu. */}
      <Link
        href="/settings?tab=whatsapp"
        className={`flex items-start gap-2 rounded-2xl border px-3 py-2 text-xs shadow-lg backdrop-blur transition-colors ${
          stuck
            ? "border-danger/40 bg-danger/10 text-danger hover:bg-danger/20"
            : "border-warning/30 bg-warning/10 text-warning hover:bg-warning/20"
        }`}
      >
        {stuck ? (
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ) : (
          <Clock className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${flushing ? "animate-spin" : ""}`} />
        )}
        <span>
          <strong className="font-semibold">{text}</strong>
          {!flushing && <span className="block opacity-90">{explanation.todo}</span>}
        </span>
      </Link>
    </div>
  );
}
