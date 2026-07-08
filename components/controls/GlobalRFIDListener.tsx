"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useData, uid } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { useToast, type Toast } from "@/lib/store/toast";
import { X, CheckCircle, AlertTriangle, Info, Bell, Send } from "lucide-react";
import { formatDA } from "@/lib/utils";
import { studentName } from "@/lib/helpers";
import { speakMessage, speechCaseForScan } from "@/lib/speech";

export function GlobalRFIDListener() {
  const { scanCard, students, subscriptions, push } = useData();
  const { language, autoSendWhatsapp, autoSendEmail } = useSettings();
  const { toasts, addToast, removeToast } = useToast();

  const bufferRef = useRef<string>("");
  const lastKeyTimeRef = useRef<number>(0);

  useEffect(() => {
    const runScan = async (code: string) => {
      // Run scanner
      const result = await scanCard(code);
      const student = result.studentId
        ? students.find((s) => s.id === result.studentId)
        : undefined;

      // Voice announcement (Web Speech API) — spoken AFTER the check-in RPC
      // verdict is known: "good"/"low" on an accepted scan, "expired" (with
      // the student's name) when the balance can't cover the séance. Other
      // rejections and the 30-min cooldown stay visual-only.
      const speechCase = speechCaseForScan(result);
      if (speechCase) {
        speakMessage(speechCase, student ? studentName(student) : "", language);
      }

      if (result.messageKey === "scan.cooldown") {
        // Accidental double swipe inside the 30-minute window: ignored
        // completely (no deduction, no presence) — gentle feedback only.
        addToast({
          type: "info",
          title: "Déjà enregistré / تم التسجيل مسبقًا",
          message: "Passage ignoré : moins de 30 minutes depuis le dernier scan accepté. Aucun débit, aucune présence dupliquée.",
          studentName: student ? studentName(student) : undefined,
        });
        return;
      }

      if (result.ok && student) {
        // Low-balance signal comes from the RPC (based on the séance's own
        // price); fall back to a local estimate for older responses.
        const studentSubs = subscriptions.filter((sub) =>
          student.subscriptionIds.includes(sub.id)
        );
        const minCost = studentSubs.length > 0 ? Math.max(...studentSubs.map((s) => s.pricePerSession)) : 500;
        const isLow =
          result.lowBalance ??
          (!student.isFree && result.newBalance !== undefined && result.newBalance < minCost * 2);
        const isDebt = result.debt ?? (result.newBalance !== undefined && result.newBalance < 0);

        let autoSentAlert = false;

        // Send automatic alert if low/debt and toggles are active
        if ((isLow || isDebt) && (autoSendWhatsapp || autoSendEmail)) {
          autoSentAlert = true;

          // Push parent notification
          if (student.parentId) {
            const parentId = student.parentId;
            const newNtf = {
              id: uid("ntf"),
              parentId,
              title: isDebt
                ? "Alerte: solde en dette (Automatique)"
                : "Alerte de solde faible (Automatique)",
              description: `Le solde de votre enfant ${student.firstName} ${student.lastName} est de ${formatDA(result.newBalance ?? 0)}. Veuillez recharger son compte rapidement. L'accès aux cours en dépend.`,
              date: new Date().toISOString(),
              read: false,
              auto: true,
            };
            push("notifications", newNtf);
          }
        }

        const sessionInfo = result.moduleName
          ? `${result.moduleName}${result.sessionStart ? ` (${result.sessionStart} - ${result.sessionEnd})` : ""}`
          : undefined;
        const isLate = result.messageKey === "scan.successLate";
        const isAlready = result.messageKey === "scan.alreadyPresent";

        // Show success toast — with the exact séance the scan was matched to
        addToast({
          type: isDebt ? "warning" : isLate ? "warning" : isAlready ? "info" : "success",
          title: isAlready
            ? "Déjà pointé — aucun débit"
            : isDebt
              ? "Présence enregistrée — SOLDE EN DETTE"
              : isLate
                ? "Présence en Retard"
                : "Présence Enregistrée",
          message: isAlready
            ? `L'élève a déjà pointé pour ${sessionInfo ?? "cette séance"} aujourd'hui.`
            : isDebt
              ? `${sessionInfo ? `Séance ${sessionInfo}. ` : ""}Le solde est passé en dette : l'élève sera bloqué au prochain scan tant que la dette n'est pas réglée.`
              : `${isLate ? "Présence validée avec RETARD" : "Présence enregistrée avec succès"}${sessionInfo ? ` — ${sessionInfo}` : ""}.`,
          studentName: studentName(student),
          cost: result.cost,
          newBalance: result.newBalance,
          autoSentAlert,
        });
      } else {
        // Show failure toast — surface the exact reason so reception sees why
        // the card was rejected (wrong day / too early / séance finished /
        // debt / expired subscription / unknown card).
        const failureMessages: Record<string, string> = {
          "scan.notFound": "Carte RFID introuvable ou non associée.",
          "scan.noSessionToday": "Aucune séance de son niveau/module aujourd'hui — carte refusée.",
          "scan.noSessionNow": "Ce n'est pas l'heure de la séance de cet élève.",
          "scan.tooEarly": `Trop tôt — la séance n'a pas encore commencé.${result.nextStart ? ` Prochaine séance à ${result.nextStart}.` : ""}`,
          "scan.sessionEnded": "Séance déjà terminée — scan refusé, l'élève est compté ABSENT.",
          "scan.subscriptionExpired": "Abonnement expiré pour la séance d'aujourd'hui — carte refusée.",
          "scan.notEligible": "La séance en cours est d'un autre niveau ou d'un module non affecté à cet élève — carte refusée.",
          "scan.expired": `Solde épuisé${result.balance !== undefined ? ` (${formatDA(result.balance)})` : ""} — entrée refusée. Aucune présence ni dette enregistrée : la dette ne peut être créée que manuellement depuis l'écran Présences.`,
          "scan.debtBlocked": `Élève EN DETTE${result.balance !== undefined ? ` (${formatDA(result.balance)})` : ""} — entrée refusée. Veuillez régler la dette à la caisse.`,
          "scan.noSession": "Aucune séance active trouvée pour cet élève en ce moment.",
          "scan.error": "Erreur lors du scan — veuillez réessayer.",
        };
        addToast({
          type: "danger",
          title:
            result.messageKey === "scan.expired"
              ? "Entrée Refusée — SOLDE ÉPUISÉ"
              : result.messageKey === "scan.debtBlocked"
                ? "Entrée Refusée — DETTE"
                : "Échec du Scan",
          message:
            failureMessages[result.messageKey] ??
            "Aucune séance active trouvée pour cet élève en ce moment.",
          studentName: student ? studentName(student) : undefined,
        });
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // If Enter key is pressed, process buffer
      if (e.key === "Enter") {
        const code = bufferRef.current.trim();
        bufferRef.current = "";

        if (code.length >= 4) {
          const activeEl = document.activeElement;
          const isInputField = activeEl && (
            activeEl.tagName === "INPUT" ||
            activeEl.tagName === "TEXTAREA" ||
            (activeEl instanceof HTMLElement && activeEl.contentEditable === "true")
          );

          // We intercept if it looks like an RFID code (e.g. starts with RFID- or STU-)
          // OR if the user is not typing inside a form input field.
          const isRFID = code.toUpperCase().startsWith("RFID-") || code.toUpperCase().startsWith("STU-");

          if (!isInputField || isRFID) {
            e.preventDefault();
            e.stopPropagation();
            runScan(code);
          }
        }
        return;
      }

      // Ignore special control keys
      if (e.key.length > 1) return;

      const now = Date.now();
      const timeDiff = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      const activeEl = document.activeElement;
      const isInputField = activeEl && (
        activeEl.tagName === "INPUT" ||
        activeEl.tagName === "TEXTAREA" ||
        (activeEl instanceof HTMLElement && activeEl.contentEditable === "true")
      );

      // If user typing inside input, require very fast key entry (typical of RFID keyboards)
      // otherwise, accept slower keystrokes (manual input on screen)
      if (isInputField && timeDiff > 80) {
        bufferRef.current = e.key;
      } else {
        bufferRef.current += e.key;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [scanCard, students, subscriptions, language, autoSendWhatsapp, autoSendEmail, addToast, push]);

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

        {toast.autoSentAlert && (
          <div className="flex items-center gap-1.5 text-[10px] text-warning bg-warning/10 border border-warning/20 rounded-lg px-2 py-1 mt-1 font-semibold">
            <Bell className="h-3 w-3" />
            Alerte WhatsApp & Email envoyée automatiquement
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
