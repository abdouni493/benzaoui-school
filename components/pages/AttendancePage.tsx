"use client";

import { useState, useEffect, useMemo } from "react";
import { useData, uid } from "@/lib/store/data";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Check,
  Clock,
  X,
  AlertTriangle,
  Calendar,
  UserCheck,
  Search,
  Printer,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Gift,
  Play,
  Lock,
  Timer,
} from "lucide-react";
import type { ScheduleSession, AttendanceStatus, Student, Day, FreePeriod } from "@/lib/types";
import { useToast } from "@/lib/store/toast";
import { useSettings, rollCallKey, type AttendanceOpenMode } from "@/lib/store/settings";
import { formatDA } from "@/lib/utils";
import {
  formatDateFr,
  freePeriodCovering,
  netPriceFor,
  rollCallOpensAt,
  isRollCallOpen as isRollCallOpenFor,
  type RollCallPolicy,
} from "@/lib/helpers";
import { printHtmlDocument } from "@/lib/print";
import { FreeBillingBanner } from "@/components/schedule/FreeBillingBanner";

// Human-readable reasons when the server refuses/annotates a manual marking.
const MARK_FAILURE_MESSAGES: Record<string, string> = {
  "scan.debtBlocked":
    "Élève en DETTE — présence refusée. Utilisez « Forcer » pour l'enregistrer malgré tout (la séance s'ajoutera à sa dette).",
  "attendance.notEnrolled": "L'élève n'est pas inscrit à cette séance (ou son abonnement a expiré).",
  "attendance.notScheduledThatDay": "Cette séance n'est pas programmée ce jour-là.",
  "attendance.sessionNotFound": "Séance introuvable.",
  "scan.notFound": "Élève introuvable.",
  "scan.error": "Erreur serveur — veuillez réessayer.",
};

export function AttendancePage() {
  const data = useData();
  const {
    sessions,
    students,
    subscriptions,
    classes,
    modules,
    teachers,
    salles,
    attendance,
    freePeriods,
    school,
    push,
    markAttendance,
    cancelAttendance,
  } = data;
  const { addToast } = useToast();
  // Politique d'ouverture de la feuille de pointage (réglée sur cet écran).
  const {
    attendanceOpenMode,
    attendanceOpenLead,
    attendanceOpenAt,
    rollCallStarted,
    setAttendanceOpenMode,
    setAttendanceOpenLead,
    setAttendanceOpenAt,
    startRollCall,
    stopRollCall,
  } = useSettings();

  // Active Tab: "sheet" (Roll-call Sheet) or "history" (Attendance History)
  const [activeTab, setActiveTab] = useState<"sheet" | "history">("sheet");

  // Current system date and time (drives the "en cours / terminée" chips)
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // The date the roll-call sheet is shown for (defaults to today). Only the
  // séances scheduled on that weekday exist on the sheet.
  const todayStr = time.toLocaleDateString("fr-CA"); // YYYY-MM-DD, local
  const [sheetDate, setSheetDate] = useState<string>(() => new Date().toLocaleDateString("fr-CA"));

  // Month shown by the calendar picker (1st of the month, local).
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [showCalendar, setShowCalendar] = useState(true);

  // Filtered session selection (for Roll Call sheet)
  const [activeSessionId, setActiveSessionId] = useState<string>("");

  // Track teacher absences locally
  const [absentTeachers, setAbsentTeachers] = useState<Record<string, boolean>>({});

  // Pending manual-marking confirmation (deduction / refund / debt alerts)
  const [confirmMark, setConfirmMark] = useState<{ student: Student; status: AttendanceStatus } | null>(null);
  const [busy, setBusy] = useState(false);

  // History states
  const [histStartDate, setHistStartDate] = useState(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  );
  const [histEndDate, setHistEndDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [histSearch, setHistSearch] = useState("");
  const [histStatus, setHistStatus] = useState<"all" | "present" | "late">("all");

  // Helpers
  const getDayName = (d: Date): string => {
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    return days[d.getDay()];
  };

  const getDayLabel = (dayKey: string): string => {
    const labels: Record<string, string> = {
      sunday: "Dimanche",
      monday: "Lundi",
      tuesday: "Mardi",
      wednesday: "Mercredi",
      thursday: "Jeudi",
      friday: "Vendredi",
      saturday: "Samedi",
    };
    return labels[dayKey] ?? dayKey;
  };

  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };

  /** YYYY-MM-DD of a Date, in local time (never UTC-shifted). */
  const isoOf = (d: Date) => d.toLocaleDateString("fr-CA");

  /** Move the sheet by N days — the "jour précédent / suivant" arrows. */
  const shiftSheetDate = (days: number) => {
    const d = new Date(`${sheetDate}T12:00:00`);
    d.setDate(d.getDate() + days);
    const next = isoOf(d);
    setSheetDate(next);
    setCalendarMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  };

  const goToDate = (iso: string) => {
    setSheetDate(iso);
    const d = new Date(`${iso}T12:00:00`);
    setCalendarMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  };

  /** Séances that really exist on a given day: scheduled on that weekday and,
   *  for a "séance libre", inside its date period. */
  const sessionsOn = (iso: string): ScheduleSession[] => {
    const day = getDayName(new Date(`${iso}T12:00:00`));
    return sessions
      .filter((s) => s.days.includes(day as Day))
      .filter((s) => !s.periodStart || s.periodStart <= iso)
      .filter((s) => !s.periodEnd || s.periodEnd >= iso)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  };

  // Sessions of the selected day — nothing else is shown on the sheet.
  const sheetDay = getDayName(new Date(`${sheetDate}T12:00:00`));
  const sheetSessions = sessionsOn(sheetDate);

  // Presences recorded on the selected day (roll-call counters + calendar dots).
  const attendanceOn = (iso: string) =>
    attendance.filter((a) => new Date(a.timestamp).toLocaleDateString("fr-CA") === iso);
  const sheetAttendance = attendanceOn(sheetDate);

  /** The enrollment the student attends this séance under: his own one on that
   *  timing, else the one on a sibling group of the same cours (rattrapage).
   *  Mirrors exactly what the mark_attendance RPC prices. */
  const enrollmentFor = (stu: Student, ses: ScheduleSession) => {
    const own = subscriptions.find(
      (su) => su.sessionId === ses.id && stu.subscriptionIds.includes(su.id),
    );
    if (own) return own;
    return subscriptions.find((su) => {
      if (!stu.subscriptionIds.includes(su.id)) return false;
      const enr = sessions.find((s) => s.id === su.sessionId);
      return !!enr && enr.moduleId === ses.moduleId && enr.classId === ses.classId;
    });
  };

  /** Net séance price for that student (his reduction included). */
  const priceFor = (stu: Student, ses: ScheduleSession) => {
    const sub = enrollmentFor(stu, ses);
    if (!sub) return subscriptions.find((su) => su.sessionId === ses.id)?.pricePerSession ?? 0;
    return netPriceFor(sub.pricePerSession, stu.subscriptionDiscounts?.[sub.id]);
  };

  /** Start date of the enrollment when billing has NOT opened yet on the sheet
   *  date — the séance is then recorded but never charged. */
  const pendingStartFor = (stu: Student, ses: ScheduleSession): string | undefined => {
    const sub = enrollmentFor(stu, ses);
    const start = sub ? stu.subscriptionDates?.[sub.id]?.startDate : undefined;
    return start && start > sheetDate ? start : undefined;
  };

  /** Free period covering that séance on the sheet date (séance offerte). */
  const freePeriodFor = (ses: ScheduleSession): FreePeriod | undefined =>
    freePeriodCovering(freePeriods, [ses.classId, ...(ses.classIds ?? [])], sheetDate);

  // A sheet in the future can be consulted, but nothing can be marked on it.
  const isFutureSheet = sheetDate > todayStr;

  // Live state of a séance relative to "now" (only meaningful on today's sheet)
  const sessionLiveState = (s: ScheduleSession): "upcoming" | "open" | "running" | "finished" | null => {
    if (sheetDate !== todayStr) return null;
    const nowMin = time.getHours() * 60 + time.getMinutes();
    const start = toMinutes(s.startTime);
    const end = toMinutes(s.endTime);
    if (nowMin < start - 30) return "upcoming";
    if (nowMin < start) return "open"; // badge window open (30 min before start)
    if (nowMin <= end) return "running";
    return "finished";
  };

  // ---- Ouverture de la feuille de pointage ----------------------------------
  // Trois politiques, réglables juste au-dessus de la liste des séances :
  //   · « Avant chaque séance » — la feuille s'ouvre N minutes avant son début ;
  //   · « À heure fixe »        — elle s'ouvre à la même heure pour toute la journée ;
  //   · « Manuelle »            — elle ne s'ouvre que sur clic.
  // Dans TOUS les cas la réception garde le bouton « Démarrer le pointage » :
  // le réglage automatique choisit quand la feuille s'ouvre toute seule, il
  // n'empêche jamais de l'ouvrir plus tôt.

  const rollCallPolicy: RollCallPolicy = {
    mode: attendanceOpenMode,
    leadMinutes: attendanceOpenLead,
    fixedTime: attendanceOpenAt,
  };

  /** Heure à laquelle le pointage de cette séance s'ouvre TOUT SEUL, ou null
   *  en mode manuel (rien ne s'ouvre sans un clic). */
  const openingTimeOf = (s: ScheduleSession) => rollCallOpensAt(s.startTime, rollCallPolicy);

  /** Feuille ouverte à la main par la réception, pour ce jour-là. */
  const isStartedManually = (s: ScheduleSession) =>
    !!rollCallStarted[rollCallKey(sheetDate, s.id)];

  /** Cette séance accepte-t-elle un pointage maintenant ? */
  const isRollCallOpen = (s: ScheduleSession): boolean =>
    isRollCallOpenFor({
      sheetDate,
      today: todayStr,
      sessionStart: s.startTime,
      nowMinutes: time.getHours() * 60 + time.getMinutes(),
      startedManually: isStartedManually(s),
      policy: rollCallPolicy,
    });

  /** Pourquoi le pointage est refusé, ou undefined s'il est ouvert. Sert à la
   *  fois à désactiver les boutons et à dire à la réception quoi faire. */
  const rollCallLockOf = (s?: ScheduleSession): string | undefined => {
    if (!s) return undefined;
    if (isFutureSheet) return "Journée à venir — pointage impossible";
    if (isRollCallOpen(s)) return undefined;
    const opensAt = openingTimeOf(s);
    return opensAt
      ? `Pointage fermé — il s'ouvre à ${opensAt}. Cliquez sur « Démarrer le pointage » pour l'ouvrir tout de suite.`
      : "Pointage fermé — cliquez sur « Démarrer le pointage » pour l'ouvrir.";
  };

  const openModeOptions: { key: AttendanceOpenMode; label: string }[] = [
    { key: "lead", label: "Avant chaque séance" },
    { key: "fixed", label: "À heure fixe" },
    { key: "manual", label: "Manuelle" },
  ];

  // Keep a valid session selected whenever the sheet date changes
  useEffect(() => {
    if (sheetSessions.length === 0) {
      if (activeSessionId) setActiveSessionId("");
      return;
    }
    if (!sheetSessions.some((s) => s.id === activeSessionId)) {
      setActiveSessionId(sheetSessions[0].id);
    }
  }, [sheetSessions, activeSessionId]);

  // Always a séance of the day being displayed: switching the date can never
  // leave the roll-call on a timing that is not scheduled that day.
  const activeSession = sheetSessions.find((s) => s.id === activeSessionId);
  /** Message de verrouillage de la séance affichée (undefined = pointage ouvert). */
  const rollCallLock = rollCallLockOf(activeSession);

  // Students on this séance: the ones enrolled in it, PLUS the ones of another
  // group of the same cours who came to this one (rattrapage) — their badge is
  // accepted, so the roll-call must show them too.
  const getSessionStudents = (sesId: string) => {
    const subIds = subscriptions.filter((su) => su.sessionId === sesId).map((su) => su.id);
    const enrolled = students.filter((stu) => stu.subscriptionIds.some((id) => subIds.includes(id)));
    const enrolledIds = new Set(enrolled.map((s) => s.id));
    const visitorIds = new Set(
      attendance
        .filter(
          (a) =>
            a.sessionId === sesId &&
            new Date(a.timestamp).toLocaleDateString("fr-CA") === sheetDate &&
            !enrolledIds.has(a.studentId),
        )
        .map((a) => a.studentId),
    );
    return [...enrolled, ...students.filter((s) => visitorIds.has(s.id))];
  };

  /** True when the student follows this séance from another group of the same
   *  cours (his own subscription points at a sibling timing). */
  const isVisitingStudent = (stu: Student, sesId: string) => {
    const subIds = subscriptions.filter((su) => su.sessionId === sesId).map((su) => su.id);
    return !stu.subscriptionIds.some((id) => subIds.includes(id));
  };

  // ---- Where the selected day stands ----------------------------------------
  const sheetSessionIds = new Set(sheetSessions.map((s) => s.id));
  const sheetMarks = sheetAttendance.filter((a) => sheetSessionIds.has(a.sessionId));
  const sheetExpected = sheetSessions.reduce((n, s) => n + getSessionStudents(s.id).length, 0);
  const sheetDeducted = sheetMarks.reduce((n, a) => n + a.amountDeducted, 0);

  // ---- Calendar picker -------------------------------------------------------
  // One presence counter per day, computed once: the calendar marks the days
  // that already have a roll-call so past séances are easy to find.
  const presencesByDate = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of attendance) {
      const key = new Date(a.timestamp).toLocaleDateString("fr-CA");
      map[key] = (map[key] ?? 0) + 1;
    }
    return map;
  }, [attendance]);

  const monthLabel = calendarMonth.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  /** Cells of the displayed month, padded so the 1st falls on its weekday. */
  const calendarCells: (string | null)[] = (() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const lead = new Date(year, month, 1).getDay(); // 0 = dimanche
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= daysInMonth; d += 1) cells.push(isoOf(new Date(year, month, d)));
    return cells;
  })();

  const shiftMonth = (months: number) =>
    setCalendarMonth(
      new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + months, 1),
    );

  // Find attendance record for a student in a session on the sheet date
  // (local calendar day — students are ABSENT by default until a record exists)
  const getStudentSheetAttendance = (studentId: string, sesId: string) => {
    return attendance.find(
      (a) =>
        a.studentId === studentId &&
        a.sessionId === sesId &&
        new Date(a.timestamp).toLocaleDateString("fr-CA") === sheetDate
    );
  };

  // Step 1 — the click on Présent / En Retard / Absent. Money never moves
  // directly here: any operation that charges or refunds opens a confirmation
  // modal first; pure status switches (present <-> late) go straight through.
  const requestMark = (stu: Student, status: AttendanceStatus) => {
    if (!activeSession) return;
    // Feuille pas encore ouverte : rien ne doit passer, même par un raccourci
    // clavier ou un double-clic sur un bouton en train d'être désactivé.
    if (!isRollCallOpen(activeSession)) return;
    const existing = getStudentSheetAttendance(stu.id, activeSession.id);

    if (status === "absent") {
      if (!existing) return; // already absent (default state)
      setConfirmMark({ student: stu, status: "absent" });
      return;
    }

    if (existing) {
      if (existing.status === status) return;
      void applyMark(stu, status, false); // status switch only, no deduction
      return;
    }

    setConfirmMark({ student: stu, status });
  };

  // Step 2 — the confirmed (or money-free) marking, executed atomically by the
  // mark_attendance RPC: deduction/refund + attendance + teacher due together.
  const applyMark = async (stu: Student, status: AttendanceStatus, allowDebt: boolean) => {
    if (!activeSession) return;
    setBusy(true);
    const res = await markAttendance(stu.id, activeSession.id, status, {
      date: sheetDate,
      allowDebt,
      skipTeacherDue: absentTeachers[activeSession.id] || false,
    });
    setBusy(false);
    setConfirmMark(null);

    const name = `${stu.firstName} ${stu.lastName}`;
    if (!res.ok) {
      addToast({
        type: "danger",
        title: "Opération refusée",
        message: MARK_FAILURE_MESSAGES[res.messageKey] ?? "Opération impossible.",
        studentName: name,
      });
      return;
    }

    if (status === "absent") {
      addToast({
        type: "info",
        title: "Marqué absent",
        message:
          (res.refunded ?? 0) > 0
            ? `Présence annulée — ${formatDA(res.refunded ?? 0)} remboursés sur le solde.`
            : "Présence annulée (aucun montant à rembourser).",
        studentName: name,
        newBalance: res.newBalance,
      });
      return;
    }

    addToast({
      type: res.debt ? "warning" : status === "late" ? "warning" : "success",
      title: res.debt
        ? "Présence enregistrée — SOLDE EN DETTE"
        : status === "late"
          ? "Présence enregistrée (En Retard)"
          : "Présence enregistrée",
      message: res.debt
        ? "Le solde est passé en dette : l'élève sera bloqué au prochain scan tant que la dette n'est pas réglée."
        : res.lowBalance
          ? "Attention : le solde ne couvre bientôt plus 2 séances."
          : res.messageKey === "attendance.statusUpdated"
            ? "Statut mis à jour (aucune nouvelle déduction)."
            : "Présence validée et solde déduit.",
      studentName: name,
      cost: res.cost,
      newBalance: res.newBalance,
    });
  };

  const handleToggleTeacherAbsent = () => {
    if (!activeSession) return;
    const isCurrentlyAbsent = absentTeachers[activeSession.id] || false;
    setAbsentTeachers({
      ...absentTeachers,
      [activeSession.id]: !isCurrentlyAbsent,
    });

    if (!isCurrentlyAbsent) {
      // If teacher is marked absent, create an absence entry
      const teacher = teachers.find((t) => t.id === activeSession.teacherId);
      if (teacher) {
        push("absences", {
          id: uid("ab"),
          teacherId: teacher.id,
          cost: teacher.paymentType === "monthly" ? 1000 : 0,
          description: `Absence séance ${modules.find((m) => m.id === activeSession.moduleId)?.name} du ${time.toLocaleDateString()}`,
          date: time.toISOString().split("T")[0],
        });
      }
    }
  };

  // Cancel an attendance from the history list — the cancel_attendance RPC
  // refunds the deduction, removes the teacher due and deletes the row, atomically.
  const handleDeleteHistoryAttendance = async (attId: string) => {
    const att = attendance.find((a) => a.id === attId);
    if (!att) return;
    const student = students.find((s) => s.id === att.studentId);
    const res = await cancelAttendance(attId);
    if (res.ok) {
      addToast({
        type: "info",
        title: "Présence annulée",
        message:
          (res.refunded ?? 0) > 0
            ? `${formatDA(res.refunded ?? 0)} remboursés sur le solde de l'élève.`
            : "Présence annulée (aucun montant à rembourser).",
        studentName: student ? `${student.firstName} ${student.lastName}` : undefined,
        newBalance: res.newBalance,
      });
    } else {
      addToast({
        type: "danger",
        title: "Annulation impossible",
        message: "La présence n'a pas pu être annulée — réessayez.",
      });
    }
  };

  const getClassName = (cid: string) => classes.find((c) => c.id === cid)?.name ?? "-";
  const getModuleName = (mid: string) => modules.find((m) => m.id === mid)?.name ?? "-";
  const getTeacherName = (tid: string) => {
    const t = teachers.find((te) => te.id === tid);
    return t ? `${t.firstName} ${t.lastName}` : "-";
  };

  // Get filtered attendance records for History Tab
  const getFilteredHistory = () => {
    return attendance
      .filter((a) => {
        const dateStr = a.timestamp.substring(0, 10);
        const matchesPeriod = dateStr >= histStartDate && dateStr <= histEndDate;
        if (!matchesPeriod) return false;

        const student = students.find((st) => st.id === a.studentId);
        const name = student ? `${student.firstName} ${student.lastName}`.toLowerCase() : "";
        
        const ses = sessions.find((s) => s.id === a.sessionId);
        const modName = ses ? (modules.find((m) => m.id === ses.moduleId)?.name ?? "").toLowerCase() : "";
        const clName = ses ? (classes.find((c) => c.id === ses.classId)?.name ?? "").toLowerCase() : "";

        const matchesSearch =
          name.includes(histSearch.toLowerCase()) ||
          modName.includes(histSearch.toLowerCase()) ||
          clName.includes(histSearch.toLowerCase());
        
        if (!matchesSearch) return false;

        if (histStatus !== "all" && a.status !== histStatus) return false;

        return true;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  };

  const filteredHistory = getFilteredHistory();

  // Print history report helper
  const handlePrintHistory = () => {
    const totalScans = filteredHistory.length;
    const presentsCount = filteredHistory.filter(h => h.status === "present").length;
    const latesCount = filteredHistory.filter(h => h.status === "late").length;
    const totalDeductedSum = filteredHistory.reduce((sum, h) => sum + h.amountDeducted, 0);

    const formatDate = (dateStr: string) => {
      if (!dateStr) return "";
      const d = new Date(dateStr);
      return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
    };

    const formatDateTime = (dateStr: string) => {
      if (!dateStr) return "";
      const d = new Date(dateStr);
      return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    };

    const logoHtml = school.logo
      ? `<img src="${school.logo}" alt="logo" class="school-logo" />`
      : `<div class="school-logo-fallback">🏫</div>`;

    const html = `
      <html>
        <head>
          <title>Registre de Présences - ${school.name}</title>
          <style>
            @media print {
              body { padding: 0; margin: 0; background: #fff; color: #000; font-size: 11px; }
              .no-print { display: none; }
              .page-break { page-break-before: always; }
            }
            * { box-sizing: border-box; }
            body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 25px; color: #1e1b4b; background-color: #faf9ff; }
            
            /* Letterhead Header */
            .letterhead { display: flex; justify-content: space-between; align-items: stretch; border: 1px solid #e8e6f4; background: #fff; padding: 15px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
            .school-identity { display: flex; align-items: center; gap: 15px; }
            .school-logo, .school-logo-fallback { width: 65px; height: 65px; border-radius: 12px; object-fit: cover; }
            .school-logo-fallback { background: #f5f3ff; border: 1px solid #ddd; display: flex; align-items: center; justify-content: center; font-size: 2.2em; }
            .school-details h2 { margin: 0; font-size: 1.4em; color: #7c3aed; font-weight: 800; }
            .school-details p { margin: 2px 0; font-size: 0.85em; color: #5c567a; }
            
            .school-tax-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; border-left: 2px solid #7c3aed; padding-left: 15px; align-items: center; }
            .tax-item { font-size: 0.78em; color: #5c567a; }
            .tax-item strong { color: #1e1b4b; font-family: monospace; }
            
            /* Document title banner */
            .doc-title-banner { background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: #fff; padding: 15px; border-radius: 12px; margin-bottom: 20px; text-align: center; }
            .doc-title-banner h1 { margin: 0; font-size: 1.5em; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
            .doc-title-banner p { margin: 5px 0 0; font-size: 0.9em; opacity: 0.9; }

            /* Summary KPIs Cards Panel */
            .kpis-container { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px; }
            .kpi-card { background: #fff; border: 1px solid #e8e6f4; border-top: 4px solid #7c3aed; padding: 12px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
            .kpi-card-success { border-top-color: #22c55e; }
            .kpi-card-warning { border-top-color: #eab308; }
            .kpi-card-info { border-top-color: #3b82f6; }
            .kpi-card label { display: block; font-size: 0.75em; text-transform: uppercase; color: #5c567a; font-weight: 700; margin-bottom: 4px; }
            .kpi-card strong { font-size: 1.35em; color: #1e1b4b; font-weight: 800; }

            /* Table Frame */
            .frame { border: 1px solid #e8e6f4; border-top: 4px solid #7c3aed; background: #fff; padding: 16px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
            .frame h3 { margin: 0 0 12px; font-size: 1.05em; color: #1e1b4b; border-bottom: 1px dashed #e8e6f4; padding-bottom: 6px; }
            
            table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
            th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #f1f0fb; }
            th { background-color: #fcfbff; font-weight: 700; color: #5c567a; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.3px; }
            tr:last-child td { border-bottom: 0; }
            
            /* Badges */
            .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75em; font-weight: bold; text-align: center; }
            .badge-success { background-color: #dcfce7; color: #15803d; }
            .badge-warning { background-color: #fef9c3; color: #854d0e; }
            
            /* Signatures block */
            .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; }
            .signature-block { border: 1px dashed #c0b6e9; border-radius: 10px; background: #fff; padding: 15px; height: 100px; display: flex; flex-direction: column; justify-content: space-between; }
            .signature-label { font-size: 0.8em; font-weight: bold; text-transform: uppercase; color: #5c567a; text-align: center; }
            
            .meta-text { text-align: center; font-size: 0.75em; color: #999; margin-top: 30px; font-style: italic; }
          </style>
        </head>
        <body>
          <!-- School Letterhead -->
          <div class="letterhead">
            <div class="school-identity">
              ${logoHtml}
              <div class="school-details">
                <h2>${school.name}</h2>
                <p>${school.description}</p>
                <p>📍 ${school.address} | 📞 ${school.phone}</p>
                <p>✉️ ${school.email}</p>
              </div>
            </div>
            <div class="school-tax-grid">
              <div class="tax-item">NIF: <strong>${school.nif || "-"}</strong></div>
              <div class="tax-item">NIS: <strong>${school.nis || "-"}</strong></div>
              <div class="tax-item">RC: <strong>${school.registreCommerce || "-"}</strong></div>
              <div class="tax-item">Art. Fiscal: <strong>${school.articleFiscal || "-"}</strong></div>
            </div>
          </div>

          <!-- Document Title Banner -->
          <div class="doc-title-banner">
            <h1>Registre & Historique des Présences</h1>
            <p>Période du <strong>${formatDate(histStartDate)}</strong> au <strong>${formatDate(histEndDate)}</strong></p>
          </div>

          <!-- Statistics KPIs Panel -->
          <div class="kpis-container">
            <div class="kpi-card">
              <label>Total Scans</label>
              <strong>${totalScans}</strong>
            </div>
            <div class="kpi-card kpi-card-success">
              <label>Présents</label>
              <strong>${presentsCount}</strong>
            </div>
            <div class="kpi-card kpi-card-warning">
              <label>En Retard</label>
              <strong>${latesCount}</strong>
            </div>
            <div class="kpi-card kpi-card-info">
              <label>Recette Cours Déduite</label>
              <strong>${totalDeductedSum} DA</strong>
            </div>
          </div>

          <!-- Detailed attendance logs frame -->
          <div class="frame">
            <h3>Liste des Présences Validées</h3>
            <table>
              <thead>
                <tr>
                  <th>Date & Heure</th>
                  <th>Nom de l'Élève</th>
                  <th>Cours / Séance</th>
                  <th>Enseignant</th>
                  <th style="text-align:center;">Statut</th>
                  <th style="text-align:right;">Montant Déduit</th>
                </tr>
              </thead>
              <tbody>
                ${filteredHistory.length === 0
                  ? `<tr><td colspan="6" style="text-align:center; font-style:italic; color:#999; padding: 20px 0;">Aucune présence à afficher pour les filtres sélectionnés.</td></tr>`
                  : filteredHistory.map((h) => {
                      const s = students.find((st) => st.id === h.studentId);
                      const ses = sessions.find((se) => se.id === h.sessionId);
                      const cl = ses ? classes.find((c) => c.id === ses.classId) : undefined;
                      const mod = ses ? modules.find((m) => m.id === ses.moduleId) : undefined;
                      const t = ses ? teachers.find((te) => te.id === ses.teacherId) : undefined;
                      
                      return `
                        <tr>
                          <td style="font-family:monospace; font-size:0.95em;">${formatDateTime(h.timestamp)}</td>
                          <td style="font-weight:bold;">${s ? `${s.lastName} ${s.firstName}` : "Inconnu"}</td>
                          <td>${mod?.name ?? "-"} <span style="font-size:0.85em; color:#888;">(${cl?.name ?? "-"})</span></td>
                          <td>${t ? `${t.firstName} ${t.lastName}` : "-"}</td>
                          <td style="text-align:center;">
                            <span class="badge ${h.status === "present" ? "badge-success" : "badge-warning"}">
                              ${h.status === "present" ? "Présent" : "En Retard"}
                            </span>
                          </td>
                          <td style="text-align:right; font-weight:bold; color:#b91c1c;">${h.amountDeducted} DA</td>
                        </tr>
                      `;
                    }).join("")
                }
              </tbody>
            </table>
          </div>

          <!-- Signatures block -->
          <div class="signatures">
            <div class="signature-block">
              <span class="signature-label">Le Responsable Pédagogique</span>
            </div>
            <div class="signature-block">
              <span class="signature-label">Le Secrétariat / Caisse</span>
            </div>
          </div>

          <div class="meta-text">
            Registre généré automatiquement par le système centralisé de l'école ${school.name} le ${new Date().toLocaleString("fr-DZ")}
          </div>
        </body>
      </html>
    `;
    printHtmlDocument(html);
  };

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <PageHeader emoji="✅" title="Présences" subtitle="Suivi et historique des feuilles de présence journalières" />

        <div className="flex gap-2">
          {/* Tab Selection buttons */}
          <Button
            variant={activeTab === "sheet" ? "primary" : "outline"}
            onClick={() => setActiveTab("sheet")}
            className="text-xs"
          >
            <UserCheck className="h-4 w-4" /> Feuille du Jour
          </Button>
          <Button
            variant={activeTab === "history" ? "primary" : "outline"}
            onClick={() => setActiveTab("history")}
            className="text-xs"
          >
            <Calendar className="h-4 w-4" /> Historique & Rapports
          </Button>
        </div>
      </div>

      {activeTab === "sheet" ? (
        <div className="space-y-4">
          {/* Sheet date — pick ANY day (past or future) from the date field, the
              day arrows or the calendar; only the séances of that day exist here */}
          <div className="bg-surface border border-line p-4 rounded-2xl space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div>
                <label className="text-[10px] uppercase font-bold text-muted block mb-1">Date de la feuille</label>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-10 w-10 shrink-0"
                    onClick={() => shiftSheetDate(-1)}
                    title="Jour précédent"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Input
                    type="date"
                    value={sheetDate}
                    onChange={(e) => e.target.value && goToDate(e.target.value)}
                    className="w-44"
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-10 w-10 shrink-0"
                    onClick={() => shiftSheetDate(1)}
                    title="Jour suivant"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pb-1">
                <Badge tone="primary">
                  {getDayLabel(sheetDay)} {formatDateFr(sheetDate)}
                </Badge>
                {sheetDate !== todayStr && (
                  <Button size="sm" variant="outline" onClick={() => goToDate(todayStr)}>
                    Revenir à aujourd&apos;hui
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={showCalendar ? "secondary" : "outline"}
                  onClick={() => setShowCalendar((v) => !v)}
                >
                  <Calendar className="h-3.5 w-3.5" />
                  {showCalendar ? "Masquer le calendrier" : "Calendrier"}
                </Button>
              </div>

              {/* Where the day stands: séances, pointages, absents, montant */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:ml-auto">
                <div className="rounded-xl border border-line bg-canvas/40 px-3 py-1.5 text-center">
                  <span className="block text-[9px] uppercase font-bold text-muted">Séances</span>
                  <strong className="text-sm text-ink">{sheetSessions.length}</strong>
                </div>
                <div className="rounded-xl border border-line bg-canvas/40 px-3 py-1.5 text-center">
                  <span className="block text-[9px] uppercase font-bold text-muted">Pointés</span>
                  <strong className="text-sm text-success">{sheetMarks.length}</strong>
                </div>
                <div className="rounded-xl border border-line bg-canvas/40 px-3 py-1.5 text-center">
                  <span className="block text-[9px] uppercase font-bold text-muted">Absents</span>
                  <strong className="text-sm text-danger">
                    {Math.max(0, sheetExpected - sheetMarks.length)}
                  </strong>
                </div>
                <div className="rounded-xl border border-line bg-canvas/40 px-3 py-1.5 text-center">
                  <span className="block text-[9px] uppercase font-bold text-muted">Déduit</span>
                  <strong className="text-sm text-ink">{formatDA(sheetDeducted)}</strong>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-muted">
              Seules les séances programmées le <strong>{getDayLabel(sheetDay).toLowerCase()}</strong> sont affichées.
              Tous les élèves sont <strong>absents par défaut</strong> tant qu&apos;ils n&apos;ont pas scanné leur carte
              ou été marqués présents. Vous pouvez <strong>revenir sur un jour passé</strong> et corriger les présences
              et absences : chaque correction débite ou rembourse le solde en conséquence.
            </p>

            {isFutureSheet && (
              <div className="flex items-center gap-2 rounded-xl border border-warning/20 bg-warning/10 p-2.5 text-[11px] text-warning">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  Journée à venir : la feuille est consultable, mais les présences ne peuvent pas encore être
                  enregistrées.
                </span>
              </div>
            )}

            {/* Une gratuité active met tous les pointages à 0 DA : dit ici pour
                la date affichée, et non seulement dans le toast d'un scan. */}
            <FreeBillingBanner date={sheetDate} />

            {/* Quand la feuille s'ouvre : à l'heure dite, ou sur clic. */}
            <div className="rounded-xl border border-line bg-canvas/40 p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                  <Timer className="h-3.5 w-3.5" /> Ouverture du pointage
                </span>

                <div className="flex flex-wrap gap-1.5">
                  {openModeOptions.map((opt) => {
                    const active = attendanceOpenMode === opt.key;
                    return (
                      <button
                        key={opt.key}
                        onClick={() => setAttendanceOpenMode(opt.key)}
                        className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                          active
                            ? "border-primary bg-primary text-white"
                            : "border-line bg-surface text-ink hover:bg-primary-50"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>

                {attendanceOpenMode === "lead" && (
                  <label className="flex items-center gap-1.5 text-[11px] text-muted">
                    <Input
                      type="number"
                      min={0}
                      max={240}
                      value={attendanceOpenLead}
                      onChange={(e) => setAttendanceOpenLead(Number(e.target.value))}
                      className="h-8 w-20 text-center"
                    />
                    minute(s) avant le début de la séance
                  </label>
                )}

                {attendanceOpenMode === "fixed" && (
                  <label className="flex items-center gap-1.5 text-[11px] text-muted">
                    à partir de
                    <Input
                      type="time"
                      value={attendanceOpenAt}
                      onChange={(e) => setAttendanceOpenAt(e.target.value)}
                      className="h-8 w-28 text-center"
                    />
                  </label>
                )}
              </div>

              <p className="text-[10px] text-muted">
                {attendanceOpenMode === "manual"
                  ? "Aucune feuille ne s'ouvre toute seule : choisissez la séance, puis cliquez sur « Démarrer le pointage »."
                  : attendanceOpenMode === "fixed"
                    ? `Chaque feuille du jour s'ouvre d'elle-même à ${attendanceOpenAt || "00:00"}. Avant cette heure, le bouton « Démarrer le pointage » l'ouvre quand même.`
                    : `Chaque feuille s'ouvre d'elle-même ${attendanceOpenLead} minute(s) avant le début de sa séance. Avant, le bouton « Démarrer le pointage » l'ouvre quand même.`}{" "}
                Les journées passées restent toujours ouvertes pour corriger un oubli. Ce réglage est propre à
                ce poste.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left panel: calendar + the séances of the selected day */}
            <div className="space-y-3">
              {showCalendar && (
                <Card className="bg-surface border border-line p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <button
                      onClick={() => shiftMonth(-1)}
                      className="rounded-lg p-1.5 text-muted transition-colors hover:bg-primary-50 hover:text-ink"
                      title="Mois précédent"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <strong className="text-xs font-bold capitalize text-ink">{monthLabel}</strong>
                    <button
                      onClick={() => shiftMonth(1)}
                      className="rounded-lg p-1.5 text-muted transition-colors hover:bg-primary-50 hover:text-ink"
                      title="Mois suivant"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-bold uppercase text-muted">
                    {["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"].map((d) => (
                      <span key={d}>{d}</span>
                    ))}
                  </div>

                  <div className="mt-1 grid grid-cols-7 gap-1">
                    {calendarCells.map((iso, idx) => {
                      if (!iso) return <span key={`pad-${idx}`} />;
                      const dayNumber = Number(iso.slice(8));
                      const count = sessionsOn(iso).length;
                      const marked = presencesByDate[iso] ?? 0;
                      const isSelected = iso === sheetDate;
                      const isToday = iso === todayStr;
                      const isFuture = iso > todayStr;

                      return (
                        <button
                          key={iso}
                          onClick={() => setSheetDate(iso)}
                          title={`${count} séance(s) · ${marked} pointage(s)`}
                          className={`relative flex h-9 flex-col items-center justify-center rounded-lg border text-[11px] font-semibold transition-colors ${
                            isSelected
                              ? "border-transparent bg-gradient-primary text-white card-shadow"
                              : count > 0
                                ? "border-line bg-canvas/40 text-ink hover:bg-primary-50"
                                : "border-transparent text-muted hover:bg-primary-50/50"
                          } ${isToday && !isSelected ? "ring-1 ring-primary" : ""} ${
                            isFuture && !isSelected ? "opacity-60" : ""
                          }`}
                        >
                          {dayNumber}
                          <span className="mt-0.5 flex h-1 items-center gap-0.5">
                            {count > 0 && (
                              <span
                                className={`h-1 w-1 rounded-full ${isSelected ? "bg-white/70" : "bg-primary/50"}`}
                              />
                            )}
                            {marked > 0 && (
                              <span
                                className={`h-1 w-1 rounded-full ${isSelected ? "bg-white" : "bg-success"}`}
                              />
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-[9px] text-muted">
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary/50" /> séances programmées
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" /> présences enregistrées
                    </span>
                  </div>
                </Card>
              )}

              <h3 className="text-sm font-bold text-ink mb-2">
                Séances du {getDayLabel(sheetDay).toLowerCase()} {formatDateFr(sheetDate)}
              </h3>

              {sheetSessions.length === 0 && (
                <Card className="border border-line bg-canvas/30 p-6 text-center">
                  <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-warning" />
                  <h4 className="text-sm font-bold text-ink">Aucun cours ce jour-là</h4>
                  <p className="mt-1 text-[11px] text-muted">
                    Aucune séance n&apos;est programmée le {getDayLabel(sheetDay).toLowerCase()}{" "}
                    {formatDateFr(sheetDate)}. Choisissez un autre jour dans le calendrier.
                  </p>
                </Card>
              )}

              {sheetSessions.map((s) => {
                const isActive = activeSessionId === s.id;
                const cl = classes.find((c) => c.id === s.classId);
                const isTeacherAbs = absentTeachers[s.id] || false;
                const live = sessionLiveState(s);
                // Roll-call state of THAT séance on the selected day
                const roster = getSessionStudents(s.id).length;
                const marked = sheetAttendance.filter((a) => a.sessionId === s.id).length;

                return (
                  <button
                    key={s.id}
                    onClick={() => setActiveSessionId(s.id)}
                    className={`w-full text-start p-4 rounded-2xl border transition-all text-xs space-y-2 block ${
                      isActive
                        ? "bg-gradient-primary border-transparent text-white card-shadow"
                        : "bg-surface border-line text-ink hover:bg-primary-50"
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <strong className="text-sm font-bold block">{getModuleName(s.moduleId)}</strong>
                        <span className={isActive ? "text-white/80" : "text-muted"}>
                          {cl?.name} ({cl?.type === "cours" ? cl.coursLevel : cl?.formationLevel})
                        </span>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {live === "running" && <Badge tone="success">En cours</Badge>}
                        {live === "open" && <Badge tone="primary">Scan ouvert</Badge>}
                        {live === "upcoming" && <Badge tone="warning">À venir</Badge>}
                        {live === "finished" && <Badge tone="danger">Terminée</Badge>}
                        {isTeacherAbs && <Badge tone="danger">Ens. Absent</Badge>}
                        {!isFutureSheet && sheetDate === todayStr && (
                          <Badge tone={isRollCallOpen(s) ? "success" : "warning"}>
                            {isRollCallOpen(s)
                              ? "Pointage ouvert"
                              : openingTimeOf(s)
                                ? `Pointage à ${openingTimeOf(s)}`
                                : "Pointage fermé"}
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-[10px] pt-1.5 border-t border-white/10">
                      <span className={isActive ? "text-white/80" : "text-muted"}>
                        Salle: {salles.find((sl) => sl.id === s.salleId)?.name}
                      </span>
                      <strong className="font-mono">{s.startTime} - {s.endTime}</strong>
                    </div>

                    <div
                      className={`flex items-center justify-between text-[10px] ${
                        isActive ? "text-white/85" : "text-muted"
                      }`}
                    >
                      <span>
                        Pointés : <strong className={isActive ? "text-white" : "text-success"}>{marked}</strong> /{" "}
                        {roster}
                      </span>
                      <span>
                        Absents :{" "}
                        <strong className={isActive ? "text-white" : "text-danger"}>
                          {Math.max(0, roster - marked)}
                        </strong>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Right panel: Active session presence list */}
            <div className="lg:col-span-2 space-y-4">
              {activeSession ? (
                <Card>
                  <CardBody className="space-y-4">
                    {/* Session details header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-line pb-4 gap-3">
                      <div>
                        <h3 className="text-lg font-bold text-ink">
                          {getModuleName(activeSession.moduleId)} — {getClassName(activeSession.classId)}
                        </h3>
                        <span className="text-xs text-muted block mt-0.5">
                          Enseignant: {getTeacherName(activeSession.teacherId)} | Horaires: {activeSession.startTime} - {activeSession.endTime}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {!isFutureSheet && sheetDate === todayStr && (
                          rollCallLock ? (
                            <Button
                              size="sm"
                              onClick={() => startRollCall(sheetDate, activeSession.id)}
                              className="text-xs"
                            >
                              <Play className="h-3.5 w-3.5" /> Démarrer le pointage
                            </Button>
                          ) : isStartedManually(activeSession) ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => stopRollCall(sheetDate, activeSession.id)}
                              className="text-xs"
                            >
                              <Lock className="h-3.5 w-3.5" /> Fermer le pointage
                            </Button>
                          ) : (
                            <Badge tone="success">Pointage ouvert</Badge>
                          )
                        )}
                        <Button
                          size="sm"
                          variant={absentTeachers[activeSession.id] ? "danger" : "outline"}
                          onClick={handleToggleTeacherAbsent}
                          className="text-xs"
                        >
                          {absentTeachers[activeSession.id] ? "Prof marqué ABSENT" : "Signaler absence prof"}
                        </Button>
                      </div>
                    </div>

                    {absentTeachers[activeSession.id] && (
                      <div className="bg-danger/10 border border-danger/20 rounded-xl p-3 text-xs text-danger flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <div>
                          <strong>Attention :</strong> L'enseignant est marqué comme absent pour cette séance.
                          Les séances validées ne seront pas ajoutées à son historique de rémunération.
                        </div>
                      </div>
                    )}

                    {rollCallLock && !isFutureSheet && (
                      <div className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/10 p-3 text-xs text-warning">
                        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          <strong className="block">Pointage pas encore ouvert</strong>
                          <span className="text-[11px]">{rollCallLock}</span>
                        </div>
                      </div>
                    )}

                    {/* Students table/list */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-ink uppercase tracking-wide">Liste des élèves</h4>

                      {getSessionStudents(activeSession.id).length === 0 ? (
                        <p className="text-xs text-muted italic">Aucun étudiant n'est inscrit dans ce module/emploi du temps.</p>
                      ) : (
                        <div className="space-y-2">
                          {getSessionStudents(activeSession.id).map((stu) => {
                            const attToday = getStudentSheetAttendance(stu.id, activeSession.id);
                            const isFree = stu.isFree;
                            const inDebt = stu.balance < 0;
                            // Enrollment not started yet on that day: the séance
                            // is recorded but never taken off the balance.
                            const pendingStart = pendingStartFor(stu, activeSession);

                            return (
                              <div
                                key={stu.id}
                                className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-canvas/30 border border-line rounded-xl gap-3 text-xs"
                              >
                                <div>
                                  <strong className="text-ink block">
                                    {stu.firstName} {stu.lastName}{" "}
                                    {isFree && <Badge tone="success" className="text-[8px] py-0">Gratuit</Badge>}{" "}
                                    {inDebt && <Badge tone="danger" className="text-[8px] py-0">DETTE</Badge>}{" "}
                                    {isVisitingStudent(stu, activeSession.id) && (
                                      <Badge tone="primary" className="text-[8px] py-0">Rattrapage — autre groupe</Badge>
                                    )}{" "}
                                    {pendingStart && (
                                      <Badge tone="success" className="text-[8px] py-0">
                                        Débute le {formatDateFr(pendingStart)} — séance offerte
                                      </Badge>
                                    )}
                                  </strong>
                                  <span className="text-[10px] text-muted">
                                    Solde:{" "}
                                    <strong className={inDebt ? "text-danger" : "text-success"}>
                                      {formatDA(stu.balance)}
                                    </strong>{" "}
                                    | Carte: {stu.rfid}
                                  </span>
                                  {attToday && (
                                    <span className="text-[10px] text-muted block mt-0.5">
                                      ✓ Pointé à{" "}
                                      <strong className="text-ink font-mono">
                                        {new Date(attToday.timestamp).toLocaleTimeString([], {
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        })}
                                      </strong>
                                      {attToday.amountDeducted > 0 && (
                                        <>
                                          {" "}— <strong className="text-danger">-{formatDA(attToday.amountDeducted)}</strong> déduits
                                        </>
                                      )}
                                      {(attToday.preStart || attToday.freePeriodId) && (
                                        <>
                                          {" "}—{" "}
                                          <strong className="text-success">
                                            offert{attToday.preStart ? " (avant le début)" : " (période gratuite)"}
                                          </strong>
                                          {(attToday.waivedAmount ?? 0) > 0 && ` · ${formatDA(attToday.waivedAmount ?? 0)}`}
                                        </>
                                      )}
                                    </span>
                                  )}
                                </div>

                                {/* Attendance selectors — absent is the default
                                    state, and a future day can't be marked */}
                                <div className="flex items-center gap-1.5 self-end sm:self-center">
                                  <button
                                    onClick={() => requestMark(stu, "present")}
                                    disabled={!!rollCallLock}
                                    title={rollCallLock}
                                    className={`h-8 px-3 rounded-lg font-bold flex items-center gap-1 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                                      attToday?.status === "present"
                                        ? "bg-success text-white shadow-sm"
                                        : "bg-surface border border-line text-muted hover:text-ink"
                                    }`}
                                  >
                                    <Check className="h-3.5 w-3.5" /> Présent
                                  </button>
                                  <button
                                    onClick={() => requestMark(stu, "late")}
                                    disabled={!!rollCallLock}
                                    title={rollCallLock}
                                    className={`h-8 px-3 rounded-lg font-bold flex items-center gap-1 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                                      attToday?.status === "late"
                                        ? "bg-warning text-white shadow-sm"
                                        : "bg-surface border border-line text-muted hover:text-ink"
                                    }`}
                                  >
                                    <Clock className="h-3.5 w-3.5" /> En Retard
                                  </button>
                                  <button
                                    onClick={() => requestMark(stu, "absent")}
                                    disabled={!!rollCallLock}
                                    title={rollCallLock}
                                    className={`h-8 px-3 rounded-lg font-bold flex items-center gap-1 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                                      !attToday
                                        ? "bg-danger text-white shadow-sm"
                                        : "bg-surface border border-line text-muted hover:text-ink"
                                    }`}
                                  >
                                    <X className="h-3.5 w-3.5" /> Absent
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </CardBody>
                </Card>
              ) : (
                <Card className="border border-line bg-canvas/30 p-8 text-center">
                  <Calendar className="mx-auto mb-2 h-10 w-10 text-muted" />
                  <h3 className="text-sm font-bold text-ink">Aucune séance sélectionnée</h3>
                  <p className="mt-1 text-xs text-muted">
                    {sheetSessions.length === 0
                      ? "Aucune séance ce jour-là — choisissez une autre date dans le calendrier pour retrouver ses séances et leurs élèves."
                      : "Sélectionnez une séance à gauche pour afficher la liste des élèves et pointer les présences."}
                  </p>
                </Card>
              )}
            </div>
          </div>
        </div>
      ) : (
        // History tab view
        <div className="space-y-4">
          <div className="bg-surface border border-line p-4 rounded-2xl flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-3">
              {/* Search input */}
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                <Input
                  value={histSearch}
                  onChange={(e) => setHistSearch(e.target.value)}
                  placeholder="Rechercher par élève, module, classe..."
                  className="pl-9 w-full"
                />
              </div>

              {/* Start Date */}
              <div>
                <label className="text-[10px] uppercase font-bold text-muted block mb-1">Date Début</label>
                <Input
                  type="date"
                  value={histStartDate}
                  onChange={(e) => setHistStartDate(e.target.value)}
                  className="w-full"
                />
              </div>

              {/* End Date */}
              <div>
                <label className="text-[10px] uppercase font-bold text-muted block mb-1">Date Fin</label>
                <Input
                  type="date"
                  value={histEndDate}
                  onChange={(e) => setHistEndDate(e.target.value)}
                  className="w-full"
                />
              </div>
            </div>

            <div className="flex gap-2">
              {/* Status Selector */}
              <Select
                value={histStatus}
                onChange={(e) => setHistStatus(e.target.value as any)}
                className="w-32"
              >
                <option value="all">Tous statuts</option>
                <option value="present">Présent</option>
                <option value="late">En Retard</option>
              </Select>

              {/* Print report */}
              <Button onClick={handlePrintHistory} variant="secondary" className="flex items-center gap-2">
                <Printer className="h-4 w-4" /> Imprimer
              </Button>
            </div>
          </div>

          {/* Quick Statistics Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-surface p-4 border border-line">
              <span className="text-[10px] uppercase font-bold text-muted block">Total des Scans</span>
              <strong className="text-2xl text-ink font-extrabold block mt-1">{filteredHistory.length}</strong>
            </Card>
            <Card className="bg-surface p-4 border border-line">
              <span className="text-[10px] uppercase font-bold text-muted block">Présents</span>
              <strong className="text-2xl text-success font-extrabold block mt-1">
                {filteredHistory.filter((h) => h.status === "present").length}
              </strong>
            </Card>
            <Card className="bg-surface p-4 border border-line">
              <span className="text-[10px] uppercase font-bold text-muted block">En Retard</span>
              <strong className="text-2xl text-warning font-extrabold block mt-1">
                {filteredHistory.filter((h) => h.status === "late").length}
              </strong>
            </Card>
            <Card className="bg-surface p-4 border border-line">
              <span className="text-[10px] uppercase font-bold text-muted block">Montant Déduit</span>
              <strong className="text-2xl text-danger font-extrabold block mt-1">
                {formatDA(filteredHistory.reduce((sum, h) => sum + h.amountDeducted, 0))}
              </strong>
            </Card>
          </div>

          {/* History list card */}
          <Card>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-line bg-canvas/30 text-muted uppercase text-[10px] font-bold">
                      <th className="p-4">Date & Heure</th>
                      <th className="p-4">Élève</th>
                      <th className="p-4">Séance</th>
                      <th className="p-4">Statut</th>
                      <th className="p-4">Déduction</th>
                      <th className="p-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {filteredHistory.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-muted italic">
                          Aucun historique de présence trouvé pour cette période.
                        </td>
                      </tr>
                    ) : (
                      filteredHistory.map((h) => {
                        const stu = students.find((s) => s.id === h.studentId);
                        const ses = sessions.find((s) => s.id === h.sessionId);
                        const cl = ses ? classes.find((c) => c.id === ses.classId) : undefined;
                        const mod = ses ? modules.find((m) => m.id === ses.moduleId) : undefined;
                        const dateObj = new Date(h.timestamp);

                        return (
                          <tr key={h.id} className="hover:bg-primary-50/10">
                            <td className="p-4 font-medium text-ink">
                              <span className="block font-bold">{dateObj.toLocaleDateString()}</span>
                              <span className="text-[10px] text-muted font-mono">
                                {dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </span>
                            </td>
                            <td className="p-4">
                              <strong className="text-ink text-sm block">
                                {stu ? `${stu.firstName} ${stu.lastName}` : "Élève Inconnu"}
                              </strong>
                              <span className="text-[10px] text-muted font-mono">{stu?.rfid}</span>
                            </td>
                            <td className="p-4">
                              <strong className="text-ink block">{mod?.name ?? "-"}</strong>
                              <span className="text-[10px] text-muted block mt-0.5">
                                {cl?.name ?? "-"} | {getTeacherName(ses?.teacherId ?? "")}
                              </span>
                            </td>
                            <td className="p-4">
                              <Badge tone={h.status === "present" ? "success" : "warning"}>
                                {h.status === "present" ? "Présent" : "En Retard"}
                              </Badge>
                            </td>
                            <td className="p-4 font-mono font-bold text-danger">
                              {h.freePeriodId || h.preStart ? (
                                <span className="inline-flex flex-col gap-0.5">
                                  <span className="text-success">Offert</span>
                                  <span className="font-sans text-[10px] font-semibold text-muted">
                                    {h.preStart ? "Avant le début de l'abonnement" : "Période gratuite"} (
                                    {formatDA(h.waivedAmount ?? 0)})
                                  </span>
                                </span>
                              ) : (
                                <>-{formatDA(h.amountDeducted)}</>
                              )}
                            </td>
                            <td className="p-4 text-center">
                              <button
                                onClick={() => {
                                  if (confirm("Voulez-vous vraiment annuler cette présence? Le solde de l'élève sera remboursé.")) {
                                    handleDeleteHistoryAttendance(h.id);
                                  }
                                }}
                                className="p-2 text-muted hover:text-danger hover:bg-danger/10 rounded-xl transition-colors inline-flex items-center justify-center"
                                title="Annuler et Rembourser"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Confirmation modal for manual marking — every money detail up front */}
      <Modal
        open={!!confirmMark}
        onClose={() => !busy && setConfirmMark(null)}
        title={confirmMark?.status === "absent" ? "Annuler la présence" : "Confirmer la présence"}
      >
        {confirmMark && activeSession && (() => {
          const stu = confirmMark.student;
          const existing = getStudentSheetAttendance(stu.id, activeSession.id);
          // Same price the server will charge: his own tariff, reduction
          // included. Nothing is charged when the séance is offered — élève
          // gratuit, période gratuite, or enrollment not started yet.
          const price = priceFor(stu, activeSession);
          const pendingStart = pendingStartFor(stu, activeSession);
          const freePeriod = freePeriodFor(activeSession);
          const offered = !!pendingStart || !!freePeriod;
          const cost = stu.isFree || offered ? 0 : price;
          const after = stu.balance - cost;
          const inDebt = cost > 0 && stu.balance < 0;
          const goesDebt = cost > 0 && stu.balance >= 0 && after < 0;
          const low = cost > 0 && after >= 0 && after < price * 2;
          // The mark_attendance RPC refuses any marking the balance can't
          // cover unless reception explicitly forces it — the only flow
          // allowed to create a debt (the RFID scan always refuses these).
          const needsDebtForce = cost > 0 && stu.balance < cost;
          const sessionLabel = `${getModuleName(activeSession.moduleId)} (${activeSession.startTime} - ${activeSession.endTime})`;
          const dateLabel = new Date(`${sheetDate}T12:00:00`).toLocaleDateString("fr-FR");

          if (confirmMark.status === "absent" && existing) {
            return (
              <div className="space-y-4 text-sm">
                <p className="text-xs text-muted">
                  L'élève repassera <strong>absent</strong> pour cette séance : la présence est supprimée, le montant
                  déduit est remboursé sur son solde et la part enseignant correspondante est retirée des séances non
                  payées.
                </p>
                <div className="bg-canvas/30 border border-line rounded-xl p-3 text-xs space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-muted">Élève</span>
                    <strong className="text-ink">{stu.firstName} {stu.lastName}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Séance</span>
                    <strong className="text-ink">{sessionLabel}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Date</span>
                    <strong className="text-ink">{dateLabel}</strong>
                  </div>
                  <div className="flex justify-between border-t border-line pt-1.5">
                    <span className="text-muted">Montant à rembourser</span>
                    <strong className="text-success">+{formatDA(existing.amountDeducted)}</strong>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" disabled={busy} onClick={() => setConfirmMark(null)}>
                    Annuler
                  </Button>
                  <Button variant="danger" disabled={busy} onClick={() => applyMark(stu, "absent", false)}>
                    Marquer absent{existing.amountDeducted > 0 ? ` & rembourser ${formatDA(existing.amountDeducted)}` : ""}
                  </Button>
                </div>
              </div>
            );
          }

          return (
            <div className="space-y-4 text-sm">
              <div className="bg-canvas/30 border border-line rounded-xl p-3 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted">Élève</span>
                  <strong className="text-ink">{stu.firstName} {stu.lastName}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Séance</span>
                  <strong className="text-ink">{sessionLabel}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Date</span>
                  <strong className="text-ink">{dateLabel}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Statut</span>
                  <Badge tone={confirmMark.status === "late" ? "warning" : "success"}>
                    {confirmMark.status === "late" ? "En Retard" : "Présent"}
                  </Badge>
                </div>
              </div>

              <div className="bg-canvas/30 border border-line rounded-xl p-3 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted">Tarif de la séance</span>
                  <strong className={cost > 0 ? "text-danger" : "text-ink"}>
                    {cost > 0 ? `-${formatDA(cost)}` : "0 DA"}
                  </strong>
                </div>
                {offered && price > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted">Montant offert</span>
                    <strong className="text-success">{formatDA(price)}</strong>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted">Solde actuel</span>
                  <strong className={stu.balance < 0 ? "text-danger" : "text-ink"}>{formatDA(stu.balance)}</strong>
                </div>
                <div className="flex justify-between border-t border-line pt-1.5">
                  <span className="text-muted">Solde après validation</span>
                  <strong className={after < 0 ? "text-danger" : "text-success"}>{formatDA(after)}</strong>
                </div>
              </div>

              {stu.isFree && (
                <div className="bg-success/10 border border-success/20 rounded-xl p-3 text-xs text-success flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0" /> Élève gratuit — aucune déduction ne sera effectuée.
                </div>
              )}
              {pendingStart && (
                <div className="bg-success/10 border border-success/20 rounded-xl p-3 text-xs text-success flex items-start gap-2">
                  <Gift className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <strong>Abonnement pas encore commencé</strong> (début le {formatDateFr(pendingStart)}) : la
                    présence est enregistrée normalement, mais <strong>rien n&apos;est retiré du solde</strong>. La
                    facturation démarrera à la date de début, modifiable depuis « Affecter des abonnements ».
                  </div>
                </div>
              )}
              {freePeriod && (
                <div className="bg-success/10 border border-success/20 rounded-xl p-3 text-xs text-success flex items-start gap-2">
                  <Gift className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <strong>Période gratuite{freePeriod.name ? ` « ${freePeriod.name} »` : ""}</strong> : séance
                    offerte ce jour-là, aucun montant n&apos;est débité du solde.
                  </div>
                </div>
              )}
              {inDebt && (
                <div className="bg-danger/10 border border-danger/20 rounded-xl p-3 text-xs text-danger flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <strong>Élève déjà EN DETTE ({formatDA(stu.balance)}).</strong> L'entrée doit normalement être
                    refusée tant que la dette n'est pas réglée. Vous pouvez forcer l'enregistrement : le coût de la
                    séance s'ajoutera à sa dette.
                  </div>
                </div>
              )}
              {goesDebt && (
                <div className="bg-warning/10 border border-warning/20 rounded-xl p-3 text-xs text-warning flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <strong>Le solde ne couvre pas cette séance :</strong> après validation, l'élève passera EN DETTE
                    ({formatDA(after)}). La dette ne peut être créée que par cette action manuelle — sa carte sera
                    refusée au scan tant que le solde ne couvre pas une séance. À la prochaine recharge, la dette sera
                    déduite automatiquement.
                  </div>
                </div>
              )}
              {low && (
                <div className="bg-warning/10 border border-warning/20 rounded-xl p-3 text-xs text-warning flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <strong>Solde bientôt épuisé :</strong> après cette séance il restera {formatDA(after)} (moins de
                    2 séances). Pensez à prévenir le parent / recharger le compte.
                  </div>
                </div>
              )}
              {absentTeachers[activeSession.id] && (
                <div className="bg-danger/10 border border-danger/20 rounded-xl p-3 text-xs text-danger">
                  Enseignant marqué absent : cette présence ne créera pas de part enseignant à payer.
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" disabled={busy} onClick={() => setConfirmMark(null)}>
                  Annuler
                </Button>
                {needsDebtForce ? (
                  <Button variant="danger" disabled={busy} onClick={() => applyMark(stu, confirmMark.status, true)}>
                    Forcer — enregistrer en dette
                  </Button>
                ) : (
                  <Button disabled={busy} onClick={() => applyMark(stu, confirmMark.status, false)}>
                    {cost > 0 ? `Confirmer & déduire ${formatDA(cost)}` : "Confirmer la présence"}
                  </Button>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
