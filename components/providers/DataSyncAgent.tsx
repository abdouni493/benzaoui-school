"use client";

import { useEffect } from "react";
import { useData } from "@/lib/store/data";

/** Toutes les 30 s, onglet visible : de quoi voir le scan d'un collègue au
 *  guichet d'à côté sans recharger la page. Une synchronisation sans
 *  changement ne coûte qu'une petite requête et ne redessine rien. */
const SYNC_EVERY_MS = 30_000;

/**
 * Tient le store à jour en arrière-plan, sans rien afficher.
 *
 * Avant, les données n'étaient relues qu'après une écriture faite DEPUIS CE
 * POSTE : le scan fait par la réception n'apparaissait chez l'administrateur
 * qu'au prochain rechargement. La synchronisation par delta coûte si peu
 * qu'elle peut tourner en continu.
 */
export function DataSyncAgent() {
  useEffect(() => {
    const sync = () => void useData.getState().backgroundSync();

    const timer = window.setInterval(sync, SYNC_EVERY_MS);
    // Retour sur l'onglet, réveil du PC, retour du réseau : on rattrape aussitôt.
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", sync);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", sync);
    };
  }, []);

  return null;
}

/** Petit indicateur de la barre du haut : visible seulement pendant un
 *  chargement COMPLET (le premier, ou le filet de sécurité). */
export function SyncIndicator() {
  const syncing = useData((s) => s.syncing);
  const loaded = useData((s) => s.loaded);
  if (!syncing) return null;
  return (
    <span
      className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[10px] font-semibold text-muted"
      title="Chargement des données de l'école"
    >
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-[var(--primary)]" />
      {loaded ? "Actualisation…" : "Chargement des données…"}
    </span>
  );
}
