"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useToast, type Toast } from "@/lib/store/toast";
import { X, CheckCircle, AlertTriangle, Info, Bell, Gift } from "lucide-react";
import { formatDA } from "@/lib/utils";
import { preloadSpeech } from "@/lib/speech";
import { useScanProcessor } from "@/lib/useScanProcessor";

export function GlobalRFIDListener() {
  const processScan = useScanProcessor();
  const { toasts, removeToast } = useToast();

  const bufferRef = useRef<string>("");
  const lastKeyTimeRef = useRef<number>(0);
  /** Codes en cours de traitement — un même passage ne part jamais deux fois. */
  const inFlightRef = useRef<Set<string>>(new Set());

  // Fetch the announcement clips once on mount so the first scan plays
  // instantly, even on the Vercel-hosted version.
  useEffect(() => {
    preloadSpeech();
  }, []);

  useEffect(() => {
    /** Le champ de saisie qui a le focus, s'il y en a un. */
    const focusedField = (): HTMLElement | null => {
      const el = document.activeElement;
      if (!el) return null;
      const isField =
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        (el instanceof HTMLElement && el.contentEditable === "true");
      return isField ? (el as HTMLElement) : null;
    };

    /** Champ de scan dédié (modale « Scanner RFID », pointage travailleur…).
     *  Il soumet le code lui-même : l'écouteur global doit se taire, sinon le
     *  MÊME passage est traité deux fois et le second renvoie « Échec du scan »
     *  (garde anti double-badge du serveur). */
    const isDedicatedScanField = (el: HTMLElement | null) =>
      !!el && el.dataset.scanInput === "true";

    const handleKeyDown = (e: KeyboardEvent) => {
      // If Enter key is pressed, process buffer
      if (e.key === "Enter") {
        const code = bufferRef.current.trim();
        bufferRef.current = "";

        if (code.length >= 4) {
          const field = focusedField();
          if (isDedicatedScanField(field)) return;

          // We intercept if it looks like an RFID code (e.g. starts with RFID- or STU-)
          // OR if the user is not typing inside a form input field.
          const isRFID = code.toUpperCase().startsWith("RFID-") || code.toUpperCase().startsWith("STU-");

          if (!field || isRFID) {
            e.preventDefault();
            e.stopPropagation();
            // Anti-doublon local : le lecteur émet parfois deux trames pour un
            // seul passage. Tant que le RPC n'a pas répondu, le même code est
            // ignoré — sans quoi le second appel repartirait en « Échec ».
            if (inFlightRef.current.has(code)) return;
            inFlightRef.current.add(code);
            void processScan(code).finally(() => inFlightRef.current.delete(code));
          }
        }
        return;
      }

      // Ignore special control keys
      if (e.key.length > 1) return;

      const now = Date.now();
      const timeDiff = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      const field = focusedField();
      // Un champ de scan dédié gère sa propre saisie : rien à mettre en tampon.
      if (isDedicatedScanField(field)) {
        bufferRef.current = "";
        return;
      }

      // If user typing inside input, require very fast key entry (typical of RFID keyboards)
      // otherwise, accept slower keystrokes (manual input on screen)
      if (field && timeDiff > 80) {
        bufferRef.current = e.key;
      } else {
        bufferRef.current += e.key;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [processScan]);

  return (
    <div className="fixed bottom-5 right-5 z-50 space-y-3 w-96 max-w-[calc(100vw-40px)] no-print pointer-events-none">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onClose={() => removeToast(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const typeStyles = {
    success: {
      bg: "bg-surface border-success/30",
      accent: "bg-success",
      icon: <CheckCircle className="h-5 w-5 text-success" />,
    },
    warning: {
      bg: "bg-surface border-warning/30",
      accent: "bg-warning",
      icon: <AlertTriangle className="h-5 w-5 text-warning" />,
    },
    danger: {
      bg: "bg-surface border-danger/30",
      accent: "bg-danger",
      icon: <X className="h-5 w-5 text-danger" />,
    },
    info: {
      bg: "bg-surface border-primary/30",
      accent: "bg-primary",
      icon: <Info className="h-5 w-5 text-primary" />,
    },
  };

  const style = typeStyles[toast.type];

  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={`pointer-events-auto relative overflow-hidden rounded-2xl border p-4 shadow-2xl flex gap-3 theme-fade ${style.bg}`}
    >
      {/* Side highlight border strip */}
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${style.accent}`} />

      <div className="flex-1 space-y-1.5">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2">
            {style.icon}
            <h4 className="text-sm font-bold text-ink">{toast.title}</h4>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-ink hover:bg-primary-50 p-1 rounded-lg transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-muted leading-relaxed">{toast.message}</p>

        {toast.studentName && (
          <div className="bg-canvas/30 rounded-xl p-2.5 space-y-1 text-xs border border-line mt-2">
            <div className="flex justify-between">
              <span className="text-muted">Élève:</span>
              <strong className="text-ink">{toast.studentName}</strong>
            </div>
            {toast.cost !== undefined && toast.cost > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">Déduit:</span>
                <strong className="text-danger font-semibold">-{formatDA(toast.cost)}</strong>
              </div>
            )}
            {toast.waived !== undefined && toast.waived > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">Offert:</span>
                <strong className="text-success font-semibold">{formatDA(toast.waived)}</strong>
              </div>
            )}
            {toast.newBalance !== undefined && (
              <div className="flex justify-between">
                <span className="text-muted">Nouveau Solde:</span>
                <span className={`font-bold ${toast.newBalance < 0 ? "text-danger" : "text-success"}`}>
                  {formatDA(toast.newBalance)}
                </span>
              </div>
            )}
          </div>
        )}

        {toast.freePeriodName && (
          <div className="mt-1 flex items-center gap-1.5 rounded-lg border border-success/20 bg-success/10 px-2 py-1 text-[10px] font-semibold text-success">
            <Gift className="h-3 w-3" />
            Période gratuite : {toast.freePeriodName}
          </div>
        )}

        {/* Le message n'est PAS parti : il attend sur le tableau de bord qu'on
            le relise. Annoncer « envoyée » ici était faux deux fois — le texte
            n'avait été lu par personne, et il pouvait ne jamais partir. */}
        {toast.autoSentAlert && (
          <div className="flex items-center gap-1.5 text-[10px] text-warning bg-warning/10 border border-warning/20 rounded-lg px-2 py-1 mt-1 font-semibold">
            <Bell className="h-3 w-3" />
            Alerte préparée — à relire et envoyer depuis le tableau de bord
          </div>
        )}
      </div>

      {/* Progress timer bar */}
      <motion.div
        initial={{ width: "100%" }}
        animate={{ width: "0%" }}
        transition={{ duration: 6, ease: "linear" }}
        className={`absolute bottom-0 left-0 right-0 h-1 opacity-40 ${style.accent}`}
      />
    </motion.div>
  );
}
