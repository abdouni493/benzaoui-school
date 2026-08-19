"use client";

import { useCallback } from "react";
import { useData, uid, type ScanResult } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { useToast } from "@/lib/store/toast";
import { formatDA } from "@/lib/utils";
import { studentName } from "@/lib/helpers";
import { speakMessage, speechCaseForScan } from "@/lib/speech";
import { buildBalanceAlert } from "@/lib/whatsapp/alert";
import type { Parent, School, Student } from "@/lib/types";

/** Alertes automatiques déjà parties dans cette session applicative, pour ne pas
 *  renvoyer un WhatsApp si le même scan accepté est traité deux fois (double
 *  déclenchement de l'événement clavier, remontage React). Clé stable = élève +
 *  séance + jour ; côté serveur, le cooldown de 30 min du RPC empêche déjà un
 *  second scan accepté sur le même créneau. */
const sentAlertKeys = new Set<string>();

/** Envoie l'alerte de solde par WhatsApp via /api/whatsapp/send — le seul chemin
 *  qui détient la clé de la passerelle. L'alerte part en TEXTE, construit par
 *  buildBalanceAlert. Volontairement « fire-and-forget » et sans jamais lever
 *  d'exception : une passerelle éteinte ou une session tombée ne doit casser ni
 *  le scan ni la transaction déjà écrite. */
async function sendAutoBalanceAlert(opts: {
  student: Student;
  parent?: Parent | null;
  school?: School | null;
  lang: "fr" | "ar";
  low: boolean;
  dedupKey: string;
}): Promise<void> {
  if (sentAlertKeys.has(opts.dedupKey)) return;

  const payload = buildBalanceAlert({
    student: opts.student,
    parent: opts.parent,
    school: opts.school,
    lang: opts.lang,
    low: opts.low,
  });
  // Aucun numéro exploitable (ni parent ni élève), ou rien à signaler.
  if (!payload) return;

  // Marqué avant l'attente : deux traitements quasi simultanés du même scan ne
  // partent qu'une fois. La clé est relâchée en cas d'échec réseau/passerelle,
  // pour qu'un prochain scan accepté puisse retenter.
  sentAlertKeys.add(opts.dedupKey);

  try {
    const response = await fetch("/api/whatsapp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipients: [payload] }),
    });
    if (!response.ok) {
      sentAlertKeys.delete(opts.dedupKey);
      const info = (await response.json().catch(() => null)) as { error?: string } | null;
      // Jamais la clé ni le corps complet en clair : juste de quoi diagnostiquer.
      console.warn(
        `[whatsapp] alerte automatique non envoyée (${response.status}) : ${info?.error ?? "erreur passerelle"}`,
      );
    }
  } catch (err) {
    sentAlertKeys.delete(opts.dedupKey);
    console.warn(
      `[whatsapp] alerte automatique en échec : ${err instanceof Error ? err.message : "réseau injoignable"}`,
    );
  }
}

/**
 * The single check-in pipeline shared by EVERY entry point — the hardware RFID
 * reader (GlobalRFIDListener, always listening on every page) and the manual
 * scanner of the Étudiants screen. All of them run the same scan_card RPC, the
 * same worker-badge fallback, the same voice announcement, the same toasts and
 * the same automatic low-balance/debt parent alerts, so a manually typed code
 * behaves exactly like a card swipe.
 *
 * The code is trimmed here as well as server-side, and the RPC matches the card
 * without regard to case: a code typed « rfid-0010 » reaches the same student as
 * « RFID-0010 » instead of coming back « carte introuvable ».
 */
export function useScanProcessor() {
  const { scanCard, scanWorkerCard, students, subscriptions, parents, school, push } = useData();
  const { language, autoSendWhatsapp, autoSendEmail } = useSettings();
  const { addToast } = useToast();

  const processScan = useCallback(
    async (rawCode: string): Promise<ScanResult> => {
      const code = rawCode.trim();
      if (!code) return { ok: false, messageKey: "scan.notFound" };
      const result = await scanCard(code);

      // Same reader for both populations: a badge unknown to the students
      // table is retried against the workers table (pointage arrivée/départ)
      // before it is declared unreadable.
      if (result.messageKey === "scan.notFound") {
        const worker = await scanWorkerCard(code);
        if (worker.ok || worker.messageKey === "worker.frozen") {
          const hours = worker.minutes !== undefined ? (worker.minutes / 60).toFixed(2) : undefined;
          const workerMessages: Record<string, { title: string; message: string; type: "success" | "info" | "warning" }> = {
            "worker.clockIn": {
              title: "Arrivée pointée",
              message: "Début de journée enregistré. Badgez à nouveau en partant pour clôturer la journée.",
              type: "success",
            },
            "worker.clockOut": {
              title: "Départ pointé",
              message: `Journée clôturée — ${hours ?? "0"} h travaillées.`,
              type: "success",
            },
            "worker.alreadyClosed": {
              title: "Journée déjà clôturée",
              message: `La journée est déjà pointée (${hours ?? "0"} h). Aucun changement.`,
              type: "info",
            },
            "worker.frozen": {
              title: "Journée gelée",
              message:
                "Une journée précédente a été ouverte sans pointage de sortie : les heures sont gelées. Corrigez l'heure de fin depuis la fiche du travailleur.",
              type: "warning",
            },
          };
          const info = workerMessages[worker.messageKey];
          addToast({
            type: info?.type ?? "info",
            title: info?.title ?? "Pointage travailleur",
            message: info?.message ?? "",
            studentName: worker.workerName,
          });
          return { ok: worker.ok, messageKey: worker.messageKey };
        }
      }

      const student = result.studentId
        ? students.find((s) => s.id === result.studentId)
        : undefined;

      // Voice announcement (pre-recorded clips in public/speech/) — played
      // AFTER the check-in RPC verdict is known. Five verdicts only: dette,
      // solde insuffisant, bienvenue, déjà scanné, carte introuvable. Every
      // other rejection stays visual-only.
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
          message: "Passage ignoré : moins de 30 minutes depuis le dernier scan accepté sur CE créneau. Aucun débit, aucune présence dupliquée. (Un autre cours ou un autre groupe reste scannable immédiatement.)",
          studentName: student ? studentName(student) : undefined,
        });
        return result;
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

        // Alerte automatique de solde (faible ou en dette).
        if ((isLow || isDebt) && (autoSendWhatsapp || autoSendEmail)) {
          autoSentAlert = true;

          // Notification interne au parent — inchangée : c'est la trace visible
          // dans l'espace parent, indépendante de l'envoi WhatsApp.
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

          // Transport WhatsApp réel — conditionné au seul interrupteur WhatsApp,
          // et non bloquant : le verdict du scan et son toast s'affichent sans
          // attendre la passerelle, et un échec d'envoi reste sans effet sur la
          // présence et le débit déjà écrits. Le parent rattaché est visé en
          // priorité ; à défaut, l'élève lui-même (résolu dans buildBalanceAlert).
          if (autoSendWhatsapp) {
            const parent = student.parentId
              ? parents.find((p) => p.id === student.parentId)
              : undefined;
            void sendAutoBalanceAlert({
              student,
              parent,
              school,
              lang: language === "ar" ? "ar" : "fr",
              low: isLow,
              dedupKey: `${student.id}:${result.sessionId ?? "?"}:${new Date().toLocaleDateString("fr-CA")}`,
            });
          }
        }

        // The séance the badge was matched to — including the GROUP, because a
        // student may follow another group of the same cours (rattrapage).
        const sessionInfo = result.moduleName
          ? `${result.moduleName}${result.groupName ? ` — ${result.groupName}` : ""}${
              result.sessionStart ? ` (${result.sessionStart} - ${result.sessionEnd})` : ""
            }`
          : undefined;
        const isLate = result.messageKey === "scan.successLate";
        const isAlready = result.messageKey === "scan.alreadyPresent";
        // Période gratuite: the presence is written exactly as usual, only the
        // deduction is skipped — so reception sees what was offered, not a bug.
        const isFreePeriod = !!result.free;
        // Deux gratuités distinctes : la PÉRIODE gratuite (toute une classe sur
        // un intervalle de dates) et le CRÉNEAU de séance libre coché
        // « offert » à sa création — ni débit élève, ni encaissement école, ni
        // rémunération enseignant.
        const isFreeSeance = !!result.freeSeance;
        const freeNote = isFreeSeance
          ? " SÉANCE LIBRE OFFERTE : séance offerte, aucun débit sur le solde, aucune rémunération enseignant."
          : isFreePeriod
            ? ` PÉRIODE GRATUITE${result.freePeriodName ? ` « ${result.freePeriodName} »` : ""} : séance offerte, aucun débit sur le solde.`
            : "";
        // Inscription enregistrée avec une date de début future : la présence
        // est écrite exactement comme d'habitude, mais le solde n'est PAS touché
        // tant que l'abonnement n'a pas commencé.
        const isPreStart = !!result.preStart;
        const preStartNote = isPreStart
          ? ` ABONNEMENT PAS ENCORE COMMENCÉ${
              result.enrollmentStart ? ` (début le ${result.enrollmentStart.split("-").reverse().join("/")})` : ""
            } : séance offerte, aucun débit sur le solde.`
          : "";
        const substitution = result.otherGroup
          ? ` Rattrapage : présence enregistrée sur le groupe ${result.groupName ?? "suivi"}${
              result.ownGroupName ? ` (inscrit en ${result.ownGroupName})` : ""
            }.`
          : "";

        // Show success toast — with the exact séance the scan was matched to
        addToast({
          type: isDebt ? "warning" : isLate ? "warning" : isAlready ? "info" : "success",
          title: isAlready
            ? "Déjà pointé — aucun débit"
            : isDebt
              ? "Présence enregistrée — SOLDE EN DETTE"
              : isFreePeriod || isFreeSeance
                ? "Présence Enregistrée — GRATUIT"
                : isPreStart
                  ? "Présence Enregistrée — AVANT LE DÉBUT (aucun débit)"
                  : isLate
                    ? "Présence en Retard"
                    : result.otherGroup
                      ? "Présence Enregistrée — Rattrapage"
                      : "Présence Enregistrée",
          message: isAlready
            ? `L'élève a déjà pointé pour ${sessionInfo ?? "cette séance"} aujourd'hui.${substitution}`
            : isDebt
              ? `${sessionInfo ? `Séance ${sessionInfo}. ` : ""}Le solde est passé en dette : l'élève sera bloqué au prochain scan tant que la dette n'est pas réglée.${substitution}`
              : `${isLate ? "Présence validée avec RETARD" : "Présence enregistrée avec succès"}${sessionInfo ? ` — ${sessionInfo}` : ""}.${substitution}${freeNote}${preStartNote}`,
          studentName: studentName(student),
          cost: result.cost,
          newBalance: result.newBalance,
          autoSentAlert,
          waived: result.waived,
          freePeriodName: isFreeSeance
            ? "séance libre offerte"
            : isFreePeriod
              ? result.freePeriodName ?? "période en cours"
              : undefined,
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

      return result;
    },
    [scanCard, scanWorkerCard, students, subscriptions, parents, school, language, autoSendWhatsapp, autoSendEmail, addToast, push],
  );

  return processScan;
}
