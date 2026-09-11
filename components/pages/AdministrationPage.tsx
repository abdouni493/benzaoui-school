"use client";

import { useEffect, useMemo, useState } from "react";
import { useData, uid } from "@/lib/store/data";
import { createRoleUser, resetUserPassword } from "@/lib/supabase/createUser";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Trash2,
  Edit,
  Eye,
  Plus,
  MoreVertical,
  DollarSign,
  AlertTriangle,
  Scan,
  Search,
  Printer,
  Clock,
  LogIn,
  LogOut,
  CalendarDays,
  CheckSquare,
  Wallet,
  UserX,
  X,
} from "lucide-react";
import type {
  Day,
  ReceptionPaymentType,
  ReceptionStaff,
  WorkerPayment,
  WorkerRole,
  WorkerShift,
} from "@/lib/types";
import { DAYS } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { DAY_LABELS_FR, formatDateFr, formatDays } from "@/lib/helpers";
import { printHtmlDocument } from "@/lib/print";
import { buildWorkerPaymentReceipt } from "@/lib/reports/workerPayment";
import { useSettings } from "@/lib/store/settings";
import {
  DEFAULT_WORK_DAYS,
  buildPaymentDetails,
  dayKey,
  fmtHours,
  frDate,
  todayKey,
  unpaidPeriodsOf,
  urgencyOf,
  worksOn,
  type WorkerPeriod,
} from "@/lib/workerPay";

const ROLE_LABELS: Record<WorkerRole, string> = {
  reception: "Réception",
  security: "Agent de sécurité",
  menage: "Ménage",
};

const PAYMENT_LABELS: Record<ReceptionPaymentType, string> = {
  monthly: "Mensuel",
  daily: "Journalier",
  half_day: "Demi-journée",
  hourly: "Horaire",
};

const PAYMENT_UNITS: Record<ReceptionPaymentType, string> = {
  monthly: "mois",
  daily: "jour",
  half_day: "½ journée",
  hourly: "heure",
};

/** D'où vient une journée du registre — le badge, le guichet, ou le relevé du
 *  soir. Une paie se discute : savoir qui a écrit la journée coupe court. */
const SOURCE_LABELS: Record<string, { label: string; tone: "success" | "primary" | "warning" }> = {
  scan: { label: "Badge", tone: "success" },
  manual: { label: "Saisie réception", tone: "primary" },
  auto: { label: "Relevé automatique", tone: "warning" },
};

function fmtTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** "2026-08-10T14:35" pour un champ datetime-local, en heure locale. */
function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "2026-09-12" + "08:00" → un ISO local exploitable par la base. */
function isoAt(date: string, time: string): string | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function AdministrationPage() {
  const {
    school,
    reception,
    workerShifts,
    workerPayments,
    acomptes,
    absences,
    push,
    deleteFrom,
    updateItem,
    scanWorkerCard,
    freezeOpenWorkerShifts,
    setWorkerShift,
    endWorkerShift,
    markWorkerAbsences,
    payWorkerPeriod,
    deleteWorkerPayment,
  } = useData();
  const { language } = useSettings();

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isAcompteOpen, setIsAcompteOpen] = useState(false);
  const [isAbsenceOpen, setIsAbsenceOpen] = useState(false);
  const [isPayOpen, setIsPayOpen] = useState(false);
  const [isScanOpen, setIsScanOpen] = useState(false);
  const [isShiftEditOpen, setIsShiftEditOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<ReceptionStaff | null>(null);

  // Form: créer / modifier un travailleur
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<WorkerRole>("reception");
  const [jobTitle, setJobTitle] = useState("");
  const [paymentType, setPaymentType] = useState<ReceptionPaymentType>("monthly");
  const [salary, setSalary] = useState<number>(0);
  const [hourlyRate, setHourlyRate] = useState<number>(0);
  const [rfid, setRfid] = useState("");
  const [startDate, setStartDate] = useState(todayKey());
  const [workDays, setWorkDays] = useState<Day[]>(DEFAULT_WORK_DAYS);
  const [dailyStart, setDailyStart] = useState("08:00");
  const [dailyEnd, setDailyEnd] = useState("16:00");
  const [payAlertDays, setPayAlertDays] = useState<number>(3);

  // Form: acompte / retenue
  const [amount, setAmount] = useState<number>(0);
  const [description, setDescription] = useState("");
  const [actionDate, setActionDate] = useState(todayKey());

  // Règlement
  const [payPeriodKey, setPayPeriodKey] = useState<string>("");
  const [payAmountOverride, setPayAmountOverride] = useState<number | null>(null);
  const [deductAbsences, setDeductAbsences] = useState(false);
  const [deductAcomptes, setDeductAcomptes] = useState(true);
  const [deductRetenues, setDeductRetenues] = useState(true);
  const [payDetailsOpen, setPayDetailsOpen] = useState(false);
  const [savingPay, setSavingPay] = useState(false);

  // Saisie / correction d'une journée
  const [shiftDate, setShiftDate] = useState(todayKey());
  const [shiftStart, setShiftStart] = useState("08:00");
  const [shiftEnd, setShiftEnd] = useState("16:00");
  const [shiftStatus, setShiftStatus] = useState<"present" | "absent">("present");
  const [shiftNotes, setShiftNotes] = useState("");
  const [savingShift, setSavingShift] = useState(false);

  // Badge
  const [scanCode, setScanCode] = useState("");
  const [scanFeedback, setScanFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [workerSearch, setWorkerSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | WorkerRole>("all");
  const [detailsTab, setDetailsTab] = useState<"info" | "register" | "finance" | "due">("register");
  const [registerMonth, setRegisterMonth] = useState(todayKey().slice(0, 7));
  const [markingAbsences, setMarkingAbsences] = useState(false);

  const today = todayKey();

  // Une journée entamée sans pointage de sortie est gelée dès que le jour est
  // passé, et une journée ouvrée sans aucune trace devient une absence : les
  // deux rattrapages sont idempotents, on les lance à l'ouverture de l'écran.
  useEffect(() => {
    freezeOpenWorkerShifts();
    markWorkerAbsences();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Lectures --------------------------------------------------------------
  const getStaffAcomptes = (sid: string) => acomptes.filter((a) => a.teacherId === sid);
  const getStaffAbsences = (sid: string) => absences.filter((a) => a.teacherId === sid);
  const openAcomptesOf = (sid: string) =>
    acomptes.filter((a) => a.teacherId === sid && !a.paymentId);
  const openRetenuesOf = (sid: string) =>
    absences.filter((a) => a.teacherId === sid && !a.paymentId);

  const shiftsOf = (sid: string) =>
    workerShifts
      .filter((s) => s.workerId === sid)
      .sort((a, b) => b.workDate.localeCompare(a.workDate));

  const paymentsOf = (sid: string) =>
    workerPayments
      .filter((p) => p.workerId === sid)
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt));

  const frozenShiftsOf = (sid: string) => shiftsOf(sid).filter((s) => s.frozen && !s.paid);

  /** La journée en cours d'un travailleur : celle qu'il a ouverte aujourd'hui
   *  sans encore la refermer. C'est elle que le bouton « Terminer » clôt. */
  const openShiftOf = (sid: string) =>
    workerShifts.find(
      (s) => s.workerId === sid && s.workDate === today && s.startAt && !s.endAt && s.status !== "absent",
    );

  const shiftToday = (sid: string) => workerShifts.find((s) => s.workerId === sid && s.workDate === today);

  const periodsOf = (w: ReceptionStaff) =>
    unpaidPeriodsOf(w, workerShifts, workerPayments, today);

  /** Ce qu'une journée vaut, selon le contrat — la même règle partout : carte,
   *  écran de paie, et bulletin imprimé. */
  const dayValueOf = (w: ReceptionStaff, s: WorkerShift) => {
    if (s.status === "absent") return 0;
    if (w.paymentType === "hourly") return Math.round((s.minutes / 60) * (w.hourlyRate ?? 0));
    if (w.paymentType === "monthly") return 0; // le mois est payé en bloc
    return w.salary;
  };

  const visibleWorkers = useMemo(
    () =>
      reception.filter((w) => {
        if (roleFilter !== "all" && (w.role ?? "reception") !== roleFilter) return false;
        const q = workerSearch.trim().toLowerCase();
        if (!q) return true;
        return `${w.firstName} ${w.lastName} ${w.phone} ${w.email} ${w.rfid ?? ""} ${w.jobTitle ?? ""}`
          .toLowerCase()
          .includes(q);
      }),
    [reception, roleFilter, workerSearch],
  );

  /**
   * Les alertes de paie de toute l'école.
   *
   * Elles ne vivent pas dans cet écran : le tableau de bord affiche exactement
   * la même liste, calculée par le même module. Deux calculs séparés finissent
   * toujours par annoncer deux retards différents.
   */
  const payAlerts = useMemo(() => {
    const rows: Array<{ worker: ReceptionStaff; period: WorkerPeriod; urgency: string; daysLeft: number }> = [];
    for (const w of reception) {
      for (const p of periodsOf(w)) {
        if (p.running) continue;
        const { urgency, daysLeft } = urgencyOf(p, w, today);
        if (urgency === "ok") continue;
        rows.push({ worker: w, period: p, urgency, daysLeft });
      }
    }
    return rows.sort((a, b) => a.daysLeft - b.daysLeft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reception, workerShifts, workerPayments, today]);

  const lateAlerts = payAlerts.filter((a) => a.urgency === "late");
  const soonAlerts = payAlerts.filter((a) => a.urgency === "soon");

  const workersWithFrozenDays = useMemo(
    () => reception.filter((w) => frozenShiftsOf(w.id).length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reception, workerShifts],
  );

  // ---- CRUD travailleur ------------------------------------------------------
  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setPhone("");
    setEmail("");
    setPassword("");
    setRole("reception");
    setJobTitle("");
    setPaymentType("monthly");
    setSalary(0);
    setHourlyRate(0);
    setRfid("");
    setStartDate(todayKey());
    setWorkDays(DEFAULT_WORK_DAYS);
    setDailyStart("08:00");
    setDailyEnd("16:00");
    setPayAlertDays(3);
    setSelectedStaff(null);
  };

  const toggleWorkDay = (d: Day) =>
    setWorkDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const handleCreateStaff = async () => {
    if (!firstName || !lastName || !phone) {
      alert("Prénom, nom et téléphone sont obligatoires.");
      return;
    }
    if (paymentType === "hourly" && hourlyRate <= 0) {
      alert("Veuillez saisir le prix d'une heure de travail.");
      return;
    }
    if (paymentType !== "hourly" && salary <= 0) {
      alert("Veuillez saisir la rémunération de ce travailleur.");
      return;
    }
    if (workDays.length === 0) {
      alert(
        "Choisissez au moins un jour de travail : sans jours ouvrés, aucune absence ne peut être constatée.",
      );
      return;
    }

    const common = {
      firstName,
      lastName,
      phone,
      paymentType,
      startDate,
      salary,
      role,
      rfid: rfid.trim(),
      hourlyRate,
      workDays,
      dailyStart,
      dailyEnd,
      jobTitle: jobTitle.trim(),
      payAlertDays,
    };

    // Ménage n'a jamais de compte ; les autres n'en ont un que si les
    // identifiants sont réellement remplis.
    const wantsAccount = role !== "menage" && (email.trim() !== "" || password !== "");

    if (wantsAccount) {
      if (!email.trim()) {
        alert(
          "Saisissez un email de connexion, ou laissez les deux champs vides pour créer ce travailleur sans compte.",
        );
        return;
      }
      if (password.length < 6) {
        alert("Le mot de passe doit contenir au moins 6 caractères.");
        return;
      }
      try {
        const { id: staffId } = await createRoleUser({
          role: "reception",
          email,
          password,
          firstName,
          lastName,
          phone,
          paymentType,
          startDate,
          salary,
          workerRole: role,
          workerRfid: rfid.trim() || undefined,
          hourlyRate,
        });
        push("reception", { id: staffId, email, ...common });
        // Les colonnes ajoutées le 12/09/2026 ne passent pas par la route
        // d'administration : on les écrit juste après, sur la ligne créée.
        await updateItem("reception", staffId, {
          workDays,
          dailyStart,
          dailyEnd,
          jobTitle: jobTitle.trim(),
          payAlertDays,
        });
      } catch (err) {
        alert(err instanceof Error ? err.message : "Erreur lors de la création du compte.");
        return;
      }
    } else {
      const workerId = uid("wrk");
      const supabase = createClient();
      const { error } = await supabase.from("reception_staff").insert({
        id: workerId,
        first_name: firstName,
        last_name: lastName,
        phone,
        email: email.trim() || null,
        payment_type: paymentType,
        start_date: startDate,
        salary,
        role,
        rfid: rfid.trim() || null,
        hourly_rate: hourlyRate,
        work_days: workDays,
        daily_start: dailyStart,
        daily_end: dailyEnd,
        job_title: jobTitle.trim(),
        pay_alert_days: payAlertDays,
      });
      if (error) {
        alert(`Erreur lors de la création du travailleur : ${error.message}`);
        return;
      }
      push("reception", { id: workerId, email: email.trim(), ...common });
    }

    setIsCreateOpen(false);
    resetForm();
  };

  const handleEditStaff = async () => {
    if (!selectedStaff) return;
    if (workDays.length === 0) {
      alert("Choisissez au moins un jour de travail.");
      return;
    }

    if (password && role !== "menage") {
      try {
        await resetUserPassword(selectedStaff.id, password);
      } catch (err) {
        alert(
          err instanceof Error
            ? `${err.message} — ce travailleur n'a probablement pas de compte de connexion.`
            : "Erreur lors du changement de mot de passe.",
        );
        return;
      }
    }

    updateItem("reception", selectedStaff.id, {
      firstName,
      lastName,
      phone,
      email,
      role,
      paymentType,
      startDate,
      salary,
      rfid: rfid.trim() || undefined,
      hourlyRate,
      workDays,
      dailyStart,
      dailyEnd,
      jobTitle: jobTitle.trim(),
      payAlertDays,
    });
    setIsEditOpen(false);
    resetForm();
  };

  const handleDelete = (id: string) => {
    if (confirm("Supprimer ce travailleur ? Son pointage et ses règlements partiront avec lui.")) {
      deleteFrom("reception", id);
      setActiveMenuId(null);
    }
  };

  // ---- Acomptes / retenues ---------------------------------------------------
  const handleCreateAcompte = () => {
    if (!selectedStaff || amount <= 0) return;
    push("acomptes", {
      id: uid("ac"),
      teacherId: selectedStaff.id,
      amount,
      description: description || "Acompte",
      date: actionDate,
    });
    push("cash", {
      id: uid("csh"),
      type: "acompte",
      amount: -amount,
      date: new Date().toISOString(),
      description: `Acompte versé à ${selectedStaff.firstName} ${selectedStaff.lastName} (${description})`,
    });
    setIsAcompteOpen(false);
    setAmount(0);
    setDescription("");
  };

  const handleCreateAbsence = () => {
    if (!selectedStaff || amount <= 0) return;
    push("absences", {
      id: uid("ab"),
      teacherId: selectedStaff.id,
      cost: amount,
      description: description || "Retenue",
      date: actionDate,
    });
    setIsAbsenceOpen(false);
    setAmount(0);
    setDescription("");
  };

  // ---- Pointage --------------------------------------------------------------
  const handleScan = async () => {
    if (!scanCode.trim()) return;
    const res = await scanWorkerCard(scanCode);
    const messages: Record<string, string> = {
      "worker.clockIn": "Arrivée pointée — badgez à nouveau en partant.",
      "worker.clockOut": `Départ pointé — ${fmtHours(res.minutes ?? 0)} travaillées aujourd'hui.`,
      "worker.alreadyClosed": `Journée déjà clôturée (${fmtHours(res.minutes ?? 0)}).`,
      "worker.frozen":
        "Journée gelée : une journée précédente n'a pas été clôturée. Corrigez-la depuis la fiche.",
      "worker.notFound": "Badge inconnu — aucun travailleur ne correspond à cette carte.",
    };
    setScanFeedback({
      ok: res.ok,
      text: `${res.workerName ? `${res.workerName} — ` : ""}${messages[res.messageKey] ?? "Pointage impossible."}`,
    });
    setScanCode("");
  };

  /** Démarrer la journée à la main : le travailleur est là, sa carte ne l'est
   *  pas. Vaut exactement un badge. */
  const handleManualStart = async (w: ReceptionStaff) => {
    const res = await setWorkerShift({
      workerId: w.id,
      workDate: today,
      startAt: new Date().toISOString(),
      endAt: null,
      status: "present",
      notes: "Arrivée saisie par la réception",
    });
    if (!res.ok) {
      alert(
        res.messageKey === "worker.alreadyPaid"
          ? "Cette journée a déjà été réglée : elle ne peut plus être modifiée."
          : "Le pointage manuel a échoué. Si le message parle d'une fonction manquante, passez la migration supabase/migrations/20260912_particulier_workers_accounts_and_billing_start.sql.",
      );
      return;
    }
    setActiveMenuId(null);
  };

  const handleManualEnd = async (w: ReceptionStaff) => {
    const res = await endWorkerShift(w.id);
    if (!res.ok) {
      alert(
        res.messageKey === "worker.noOpenShift"
          ? "Aucune journée ouverte à clôturer pour ce travailleur."
          : "La clôture a échoué — vérifiez l'heure d'arrivée.",
      );
      return;
    }
    setActiveMenuId(null);
  };

  const handleMarkAbsentToday = async (w: ReceptionStaff) => {
    if (!confirm(`Marquer ${w.firstName} ${w.lastName} ABSENT aujourd'hui ?`)) return;
    const res = await setWorkerShift({
      workerId: w.id,
      workDate: today,
      status: "absent",
      notes: "Absence constatée par la réception",
    });
    if (!res.ok) alert("L'absence n'a pas pu être enregistrée.");
    setActiveMenuId(null);
  };

  const handleMarkAbsences = async () => {
    setMarkingAbsences(true);
    try {
      const res = await markWorkerAbsences();
      if (!res.ok) {
        alert(
          "Le relevé des absences n'a pas pu être lancé. Si le message parle d'une fonction " +
            "manquante, passez la migration supabase/migrations/20260912_particulier_workers_accounts_and_billing_start.sql.",
        );
        return;
      }
      alert(
        (res.marked ?? 0) === 0
          ? "Aucune absence à constater : toutes les journées ouvrées révolues ont une trace."
          : `${res.marked} journée(s) d'absence enregistrée(s) chez ${res.workers} travailleur(s).`,
      );
    } finally {
      setMarkingAbsences(false);
    }
  };

  const openShiftEditor = (w: ReceptionStaff, s?: WorkerShift) => {
    setSelectedStaff(w);
    setShiftDate(s?.workDate ?? today);
    setShiftStatus(s?.status === "absent" ? "absent" : "present");
    setShiftStart(s?.startAt ? toLocalInput(s.startAt).slice(11) : w.dailyStart || "08:00");
    setShiftEnd(s?.endAt ? toLocalInput(s.endAt).slice(11) : w.dailyEnd || "16:00");
    setShiftNotes(s?.notes ?? "");
    setIsShiftEditOpen(true);
    setActiveMenuId(null);
  };

  const handleSaveShift = async () => {
    if (!selectedStaff) return;
    if (!shiftDate) {
      alert("Choisissez la journée à enregistrer.");
      return;
    }
    setSavingShift(true);
    try {
      const res = await setWorkerShift({
        workerId: selectedStaff.id,
        workDate: shiftDate,
        startAt: shiftStatus === "present" ? isoAt(shiftDate, shiftStart) : null,
        endAt: shiftStatus === "present" ? isoAt(shiftDate, shiftEnd) : null,
        status: shiftStatus,
        notes: shiftNotes,
      });
      if (!res.ok) {
        alert(
          res.messageKey === "worker.alreadyPaid"
            ? "Cette journée a déjà été réglée : elle ne peut plus être modifiée. Annulez d'abord le règlement."
            : res.messageKey === "worker.endBeforeStart"
              ? "L'heure de fin doit être postérieure à l'heure d'arrivée."
              : "L'enregistrement a échoué.",
        );
        return;
      }
      setIsShiftEditOpen(false);
    } finally {
      setSavingShift(false);
    }
  };

  // ---- Règlement -------------------------------------------------------------
  const openPay = (w: ReceptionStaff) => {
    setSelectedStaff(w);
    const periods = periodsOf(w).filter((p) => !p.running);
    setPayPeriodKey(periods[0] ? `${periods[0].key}|${periods[0].start}` : "");
    setPayAmountOverride(null);
    setDeductAbsences(false);
    setDeductAcomptes(true);
    setDeductRetenues(true);
    setPayDetailsOpen(false);
    setIsPayOpen(true);
    setActiveMenuId(null);
  };

  /** La période sélectionnée dans l'écran de règlement. `key` peut être vide
   *  (contrat horaire), d'où la clé composite key|start. */
  const payPeriods = selectedStaff ? periodsOf(selectedStaff) : [];
  const chosenPeriod =
    payPeriods.find((p) => `${p.key}|${p.start}` === payPeriodKey) ?? null;

  const payOpenAcomptes = selectedStaff ? openAcomptesOf(selectedStaff.id) : [];
  const payOpenRetenues = selectedStaff ? openRetenuesOf(selectedStaff.id) : [];
  const acomptesTotal = payOpenAcomptes.reduce((s, a) => s + a.amount, 0);
  const retenuesTotal = payOpenRetenues.reduce((s, a) => s + a.cost, 0);

  const grossOf = (p: WorkerPeriod | null) =>
    !p ? 0 : Math.max(0, p.amount - (deductAbsences ? p.absenceDeduction : 0));

  const computedNet = (() => {
    const gross = grossOf(chosenPeriod);
    const net =
      gross - (deductAcomptes ? acomptesTotal : 0) - (deductRetenues ? retenuesTotal : 0);
    return Math.max(0, net);
  })();

  const finalPay = payAmountOverride ?? computedNet;

  /** Les journées de la période choisie, telles que le bulletin les imprimera. */
  const periodShifts = (p: WorkerPeriod | null) =>
    !p || !selectedStaff
      ? []
      : workerShifts
          .filter((s) => s.workerId === selectedStaff.id && s.workDate >= p.start && s.workDate <= p.end)
          .sort((a, b) => a.workDate.localeCompare(b.workDate));

  const handlePay = async () => {
    if (!selectedStaff || !chosenPeriod) {
      alert("Choisissez la période à régler.");
      return;
    }
    if (finalPay <= 0) {
      alert(
        "Le montant net doit être supérieur à 0 DA. Décochez une retenue, ou saisissez le montant à la main.",
      );
      return;
    }

    const rows = periodShifts(chosenPeriod);
    const details = buildPaymentDetails(rows, chosenPeriod.shiftIds, (s) =>
      dayValueOf(selectedStaff, s),
    );

    setSavingPay(true);
    try {
      const res = await payWorkerPeriod({
        workerId: selectedStaff.id,
        method: selectedStaff.paymentType,
        periodKey: chosenPeriod.key,
        periodStart: chosenPeriod.start,
        periodEnd: chosenPeriod.end,
        shiftIds: chosenPeriod.shiftIds,
        amount: finalPay,
        description: `Règlement ${selectedStaff.firstName} ${selectedStaff.lastName} — ${chosenPeriod.label}`,
        details,
        settleDeductions: deductAcomptes || deductRetenues,
        acompteIds: deductAcomptes ? payOpenAcomptes.map((a) => a.id) : [],
        absenceIds: deductRetenues ? payOpenRetenues.map((a) => a.id) : [],
      });

      if (!res.ok) {
        alert(
          res.messageKey === "worker.periodAlreadyPaid"
            ? "Cette période a déjà été réglée. Rechargez l'écran pour voir le règlement existant."
            : "Le règlement a échoué. Si le message parle d'une fonction manquante, passez la " +
              "migration supabase/migrations/20260912_particulier_workers_accounts_and_billing_start.sql.",
        );
        return;
      }

      setIsPayOpen(false);
      if (confirm(`Règlement de ${finalPay} DA enregistré. Imprimer le bulletin de paie ?`)) {
        printHtmlDocument(
          buildWorkerPaymentReceipt({
            worker: selectedStaff,
            school,
            lang: language,
            amount: finalPay,
            gross: grossOf(chosenPeriod),
            acomptes: deductAcomptes ? acomptesTotal : 0,
            deductions:
              (deductRetenues ? retenuesTotal : 0) +
              (deductAbsences ? chosenPeriod.absenceDeduction : 0),
            periodLabel: chosenPeriod.label,
            details,
            paidAt: new Date().toISOString(),
          }),
        );
      }
    } finally {
      setSavingPay(false);
    }
  };

  const reprintPayment = (w: ReceptionStaff, p: WorkerPayment) => {
    printHtmlDocument(
      buildWorkerPaymentReceipt({
        worker: w,
        school,
        lang: language,
        amount: p.amount,
        periodLabel:
          p.periodKey ||
          (p.periodStart && p.periodEnd ? `${frDate(p.periodStart)} → ${frDate(p.periodEnd)}` : "—"),
        details: Array.isArray(p.details) ? p.details : [],
        paidAt: p.paidAt,
        receiptNo: `SAL-${p.id.slice(0, 8).toUpperCase()}`,
      }),
    );
  };

  const handleCancelPayment = async (p: WorkerPayment) => {
    if (
      !confirm(
        `Annuler ce règlement de ${p.amount} DA ?\n\n` +
          "Les journées qu'il a réglées redeviennent dues, les acomptes et retenues qu'il a " +
          "consommés redeviennent exigibles, et son mouvement de caisse est retiré.",
      )
    ) {
      return;
    }
    const res = await deleteWorkerPayment(p.id);
    if (!res.ok) {
      alert("L'annulation a échoué.");
      return;
    }
    alert(`Règlement annulé — ${res.restored ?? 0} journée(s) redeviennent dues.`);
  };

  const openEdit = (w: ReceptionStaff) => {
    setSelectedStaff(w);
    setFirstName(w.firstName);
    setLastName(w.lastName);
    setPhone(w.phone);
    setEmail(w.email);
    setPassword("");
    setRole(w.role ?? "reception");
    setJobTitle(w.jobTitle ?? "");
    setPaymentType(w.paymentType);
    setStartDate(w.startDate);
    setSalary(w.salary);
    setHourlyRate(w.hourlyRate ?? 0);
    setRfid(w.rfid ?? "");
    setWorkDays(w.workDays?.length ? w.workDays : DEFAULT_WORK_DAYS);
    setDailyStart(w.dailyStart || "08:00");
    setDailyEnd(w.dailyEnd || "16:00");
    setPayAlertDays(w.payAlertDays ?? 3);
    setIsEditOpen(true);
    setActiveMenuId(null);
  };

  const openDetails = (w: ReceptionStaff, tab: typeof detailsTab = "register") => {
    setSelectedStaff(w);
    setDetailsTab(tab);
    setRegisterMonth(today.slice(0, 7));
    setIsDetailsOpen(true);
    setActiveMenuId(null);
  };

  // ---- Blocs de formulaire partagés (créer / modifier) -----------------------
  const renderWorkerForm = (mode: "create" | "edit") => (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-semibold text-muted">Prénom *</label>
        <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-muted">Nom *</label>
        <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom de famille" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-muted">Téléphone *</label>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+213 XXXXXXXXX" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-muted">Rôle *</label>
        <Select value={role} onChange={(e) => setRole(e.target.value as WorkerRole)} className="w-full">
          <option value="reception">Réception</option>
          <option value="security">Agent de sécurité</option>
          <option value="menage">Ménage</option>
        </Select>
      </div>

      <div className="md:col-span-2">
        <label className="mb-1 block text-xs font-semibold text-muted">Poste / fonction</label>
        <Input
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          placeholder="Ex : Agent d'accueil du soir, Gardien de nuit…"
        />
        <p className="mt-1 text-[10px] text-muted">
          Facultatif. Apparaît sur le bulletin de paie — utile quand plusieurs personnes partagent
          le même rôle.
        </p>
      </div>

      {/* Badge de pointage */}
      <div className="md:col-span-2">
        <label className="mb-1 block text-xs font-semibold text-muted">
          Carte RFID (badge de pointage)
        </label>
        <div className="relative">
          <Scan className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={rfid}
            onChange={(e) => setRfid(e.target.value)}
            placeholder="Passez la carte du travailleur devant le lecteur..."
            className="pl-9 font-mono"
          />
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-muted">
          Le <strong>premier passage de la journée</strong> ouvre le service, le{" "}
          <strong>second</strong> le ferme et calcule les heures. Sans badge, la réception saisit
          les journées à la main — le résultat est exactement le même.
        </p>
      </div>

      {role !== "menage" ? (
        <>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">
              Email (connexion) — optionnel
            </label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@ecole.com" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">
              {mode === "create" ? "Mot de passe — optionnel" : "Nouveau mot de passe"}
            </label>
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="6 caractères min."
            />
          </div>
          {mode === "create" && (
            <div className="rounded-xl border border-line bg-primary-50/50 p-2.5 text-[10px] text-muted md:col-span-2">
              Laissez l&apos;email et le mot de passe vides pour créer ce travailleur{" "}
              <strong>sans compte de connexion</strong>.
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center rounded-xl border border-line bg-canvas p-2.5 text-[10px] text-muted md:col-span-2">
          Le rôle <strong className="mx-1">Ménage</strong> n&apos;a jamais de compte de connexion.
        </div>
      )}

      {/* ---- Contrat ---- */}
      <div className="md:col-span-2 rounded-xl border border-primary/25 bg-primary-50/30 p-3">
        <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-primary">
          Contrat et rémunération
        </span>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Type de paiement</label>
            <Select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as ReceptionPaymentType)}
              className="w-full"
            >
              <option value="monthly">Mensuel</option>
              <option value="daily">Journalier</option>
              <option value="half_day">Demi-journée</option>
              <option value="hourly">Horaire (pointage arrivée / sortie)</option>
            </Select>
          </div>

          {paymentType === "hourly" ? (
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">
                Prix d&apos;une heure (DA) *
              </label>
              <Input
                type="number"
                min={0}
                value={hourlyRate || ""}
                onChange={(e) => setHourlyRate(Number(e.target.value))}
                placeholder="Ex: 400"
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">
                Rémunération par {PAYMENT_UNITS[paymentType]} (DA) *
              </label>
              <Input
                type="number"
                min={0}
                value={salary || ""}
                onChange={(e) => setSalary(Number(e.target.value))}
                placeholder="Ex: 35000"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">
              Début du travail *
            </label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <p className="mt-1 text-[10px] text-muted">
              {paymentType === "monthly"
                ? "Les mois dus partent de cette date — jamais avant."
                : "Aucune journée n'est comptée avant cette date."}
            </p>
          </div>
        </div>
      </div>

      {/* ---- Jours et horaires attendus ---- */}
      <div className="md:col-span-2 rounded-xl border border-line bg-canvas/40 p-3">
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
          Jours de travail attendus
        </span>
        <p className="mb-2 text-[10px] leading-relaxed text-muted">
          C&apos;est ce qui rend le relevé automatique des absences utilisable : sans ces jours,
          <strong> tout jour sans pointage deviendrait une absence</strong>, jours de repos
          compris.
        </p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {DAYS.map((d) => {
            const on = workDays.includes(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleWorkDay(d)}
                className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition-all ${
                  on
                    ? "border-primary bg-primary text-white"
                    : "border-line bg-surface text-muted hover:text-ink"
                }`}
              >
                {DAY_LABELS_FR[d]}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Arrivée attendue</label>
            <Input type="time" value={dailyStart} onChange={(e) => setDailyStart(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Sortie attendue</label>
            <Input type="time" value={dailyEnd} onChange={(e) => setDailyEnd(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">
              Alerte de paie (jours avant)
            </label>
            <Input
              type="number"
              min={0}
              max={30}
              value={payAlertDays}
              onChange={(e) => setPayAlertDays(Number(e.target.value))}
            />
            <p className="mt-1 text-[10px] text-muted">
              Le salaire est signalé {payAlertDays} jour(s) avant son échéance.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  return (
    <div>
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <PageHeader
          emoji="👥"
          title="Travailleurs"
          subtitle="Pointage, absences et paie du personnel : réception, sécurité et ménage"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={handleMarkAbsences}
            disabled={markingAbsences}
            className="flex items-center gap-2"
          >
            <UserX className="h-4 w-4" />
            {markingAbsences ? "Relevé en cours..." : "Relever les absences"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setScanFeedback(null);
              setIsScanOpen(true);
            }}
            className="flex items-center gap-2"
          >
            <Scan className="h-4 w-4" /> Pointage Badge
          </Button>
          <Button
            onClick={() => {
              resetForm();
              setIsCreateOpen(true);
            }}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" /> Nouveau Travailleur
          </Button>
        </div>
      </div>

      {/* ---- ALERTES DE PAIE ---------------------------------------------- */}
      {/* En retard : l'alerte bat, parce qu'un salaire en retard se règle
          aujourd'hui et pas « quand on y repensera ». */}
      {lateAlerts.length > 0 && (
        <div className="mb-4 animate-pulse rounded-2xl border-2 border-danger/50 bg-danger/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <strong className="block text-sm text-danger">
                {lateAlerts.length} salaire(s) EN RETARD —{" "}
                {lateAlerts.reduce((s, a) => s + a.period.amount, 0)} DA à verser
              </strong>
              <div className="mt-2 flex flex-wrap gap-2">
                {lateAlerts.map((a) => (
                  <button
                    key={`${a.worker.id}-${a.period.key}-${a.period.start}`}
                    onClick={() => openPay(a.worker)}
                    className="rounded-lg border border-danger/30 bg-danger/15 px-2.5 py-1 text-[10px] font-bold text-danger transition-colors hover:bg-danger/25"
                  >
                    {a.worker.firstName} {a.worker.lastName} · {a.period.label} ·{" "}
                    {a.period.amount} DA · {Math.abs(a.daysLeft)} j de retard
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {soonAlerts.length > 0 && (
        <div className="mb-4 rounded-2xl border border-warning/40 bg-warning/10 p-4">
          <div className="flex items-start gap-3">
            <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <strong className="block text-sm text-warning">
                {soonAlerts.length} salaire(s) à verser bientôt
              </strong>
              <div className="mt-2 flex flex-wrap gap-2">
                {soonAlerts.map((a) => (
                  <button
                    key={`${a.worker.id}-${a.period.key}-${a.period.start}`}
                    onClick={() => openPay(a.worker)}
                    className="rounded-lg border border-warning/30 bg-warning/15 px-2.5 py-1 text-[10px] font-bold text-warning transition-colors hover:bg-warning/25"
                  >
                    {a.worker.firstName} {a.worker.lastName} · {a.period.label} ·{" "}
                    {a.period.amount} DA ·{" "}
                    {a.daysLeft === 0 ? "aujourd'hui" : `dans ${a.daysLeft} j`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Journées non clôturées */}
      {workersWithFrozenDays.length > 0 && (
        <div className="mb-4 rounded-2xl border border-danger/30 bg-danger/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <strong className="block text-sm text-danger">
                {workersWithFrozenDays.length} travailleur(s) avec des journées non clôturées
              </strong>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                Une arrivée a été pointée sans pointage de sortie : le calcul des heures de ces
                journées est <strong>gelé</strong> et elles ne peuvent pas être payées. Cliquez
                pour saisir l&apos;heure de fin.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {workersWithFrozenDays.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => openDetails(w, "register")}
                    className="rounded-lg border border-danger/25 bg-danger/10 px-2.5 py-1 text-[10px] font-bold text-danger transition-colors hover:bg-danger/20"
                  >
                    {w.firstName} {w.lastName} · {frozenShiftsOf(w.id).length} jour(s)
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Recherche + filtre de rôle ---- */}
      <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={workerSearch}
            onChange={(e) => setWorkerSearch(e.target.value)}
            placeholder="Rechercher un travailleur (nom, téléphone, badge, poste)..."
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { key: "all" as const, label: `Tous (${reception.length})` },
              ...(["reception", "security", "menage"] as WorkerRole[]).map((r) => ({
                key: r,
                label: `${ROLE_LABELS[r]} (${reception.filter((w) => (w.role ?? "reception") === r).length})`,
              })),
            ]
          ).map((k) => (
            <button
              key={k.key}
              onClick={() => setRoleFilter(k.key)}
              className={`rounded-lg px-3 py-1.5 text-[10px] font-bold transition-all ${
                roleFilter === k.key ? "bg-primary text-white shadow-sm" : "bg-canvas text-muted hover:text-ink"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      {/* ---- Grille des travailleurs ---- */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {visibleWorkers.map((staff) => {
          const periods = periodsOf(staff);
          const duePeriods = periods.filter((p) => !p.running);
          const totalDue = duePeriods.reduce((sum, p) => sum + p.amount, 0);
          const frozen = frozenShiftsOf(staff.id);
          const open = openShiftOf(staff.id);
          const todayShift = shiftToday(staff.id);
          const alert = payAlerts.find((a) => a.worker.id === staff.id);
          const expectedToday = worksOn(staff, today);

          return (
            <Card
              key={staff.id}
              className={`relative transition-all duration-300 ${
                activeMenuId === staff.id
                  ? "z-30 scale-[1.02] shadow-2xl ring-2 ring-primary/45"
                  : "z-10 border border-line hover:z-20 hover:-translate-y-0.5 hover:shadow-lg"
              }`}
            >
              <CardBody className="relative flex min-h-[260px] flex-col justify-between p-5">
                {/* Panneau d'actions */}
                {activeMenuId === staff.id && (
                  <div className="absolute inset-0 z-20 flex animate-in flex-col justify-between rounded-2xl border border-primary/20 bg-surface/98 p-4 backdrop-blur-md duration-200 fade-in zoom-in-95">
                    <div className="flex items-center justify-between border-b border-line pb-2">
                      <span className="truncate text-[10px] font-bold uppercase tracking-wider text-muted">
                        {staff.firstName} {staff.lastName}
                      </span>
                      <button
                        onClick={() => setActiveMenuId(null)}
                        className="rounded-lg p-1 text-muted transition-colors hover:bg-canvas hover:text-ink"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="my-2 grid flex-1 grid-cols-2 items-center gap-2">
                      <button
                        onClick={() => openDetails(staff)}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-line bg-canvas px-3 py-2 text-xs font-bold text-ink transition-colors hover:bg-primary-50"
                      >
                        <Eye className="h-3.5 w-3.5" /> Détails
                      </button>
                      <button
                        onClick={() => openPay(staff)}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-success/30 bg-success/15 px-3 py-2 text-xs font-bold text-success transition-colors hover:bg-success/25"
                      >
                        <DollarSign className="h-3.5 w-3.5" /> Payer
                      </button>

                      {/* Pointage manuel : le badge n'est qu'une des portes */}
                      {open ? (
                        <button
                          onClick={() => handleManualEnd(staff)}
                          className="flex items-center justify-center gap-1.5 rounded-xl border border-warning/30 bg-warning/15 px-3 py-2 text-xs font-bold text-warning transition-colors hover:bg-warning/25"
                        >
                          <LogOut className="h-3.5 w-3.5" /> Fin de service
                        </button>
                      ) : (
                        <button
                          onClick={() => handleManualStart(staff)}
                          disabled={!!todayShift && todayShift.status !== "absent"}
                          className="flex items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-bold text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
                        >
                          <LogIn className="h-3.5 w-3.5" /> Début de service
                        </button>
                      )}
                      <button
                        onClick={() => handleMarkAbsentToday(staff)}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-danger/30 bg-danger/15 px-3 py-2 text-xs font-bold text-danger transition-colors hover:bg-danger/25"
                      >
                        <UserX className="h-3.5 w-3.5" /> Absent aujourd&apos;hui
                      </button>

                      <button
                        onClick={() => openShiftEditor(staff)}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-line bg-canvas px-3 py-2 text-xs font-bold text-ink transition-colors hover:bg-primary-50"
                      >
                        <Clock className="h-3.5 w-3.5" /> Saisir un jour
                      </button>
                      <button
                        onClick={() => {
                          setSelectedStaff(staff);
                          setAmount(0);
                          setDescription("Avance sur salaire");
                          setIsAcompteOpen(true);
                          setActiveMenuId(null);
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-line bg-canvas px-3 py-2 text-xs font-bold text-ink transition-colors hover:bg-primary-50"
                      >
                        <Plus className="h-3.5 w-3.5" /> Acompte
                      </button>

                      <button
                        onClick={() => {
                          setSelectedStaff(staff);
                          setAmount(0);
                          setDescription("Retenue");
                          setIsAbsenceOpen(true);
                          setActiveMenuId(null);
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-line bg-canvas px-3 py-2 text-xs font-bold text-ink transition-colors hover:bg-primary-50"
                      >
                        <Plus className="h-3.5 w-3.5" /> Retenue
                      </button>
                      <button
                        onClick={() => openEdit(staff)}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-line bg-canvas px-3 py-2 text-xs font-bold text-ink transition-colors hover:bg-primary-50"
                      >
                        <Edit className="h-3.5 w-3.5" /> Modifier
                      </button>
                    </div>

                    <div className="border-t border-line pt-2">
                      <button
                        onClick={() => handleDelete(staff.id)}
                        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-danger px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-danger/90"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Supprimer
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-xs font-bold tracking-wider text-primary">
                        {staff.firstName.slice(0, 1).toUpperCase()}
                        {staff.lastName.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h4 className="truncate text-sm font-bold text-ink">
                          {staff.firstName} {staff.lastName}
                        </h4>
                        <span className="block truncate font-mono text-[10px] text-muted">
                          {staff.phone}
                        </span>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          <Badge
                            tone={
                              staff.role === "menage"
                                ? "neutral"
                                : staff.role === "security"
                                  ? "warning"
                                  : "primary"
                            }
                            className="px-1.5 py-0 text-[9px]"
                          >
                            {ROLE_LABELS[staff.role ?? "reception"]}
                          </Badge>
                          {staff.rfid && (
                            <Badge tone="success" className="px-1.5 py-0 font-mono text-[9px]">
                              🎫 {staff.rfid}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => setActiveMenuId(activeMenuId === staff.id ? null : staff.id)}
                      className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-primary-50 hover:text-ink"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Où en est-il AUJOURD'HUI — la première chose qu'on veut savoir */}
                  <div
                    className={`mb-2.5 flex items-center justify-between rounded-xl border px-2.5 py-2 text-[10px] ${
                      !expectedToday
                        ? "border-line bg-canvas/30 text-muted"
                        : todayShift?.status === "absent"
                          ? "border-danger/30 bg-danger/10 text-danger"
                          : open
                            ? "border-success/30 bg-success/10 text-success"
                            : todayShift
                              ? "border-primary/25 bg-primary-50/40 text-primary"
                              : "border-warning/30 bg-warning/10 text-warning"
                    }`}
                  >
                    <span className="font-bold">
                      {!expectedToday
                        ? "Repos aujourd'hui"
                        : todayShift?.status === "absent"
                          ? "Absent aujourd'hui"
                          : open
                            ? `En service depuis ${fmtTime(open.startAt)}`
                            : todayShift
                              ? `Journée close · ${fmtHours(todayShift.minutes)}`
                              : "Pas encore pointé"}
                    </span>
                    {todayShift?.source && (
                      <Badge tone={SOURCE_LABELS[todayShift.source]?.tone ?? "neutral"} className="text-[9px]">
                        {SOURCE_LABELS[todayShift.source]?.label ?? todayShift.source}
                      </Badge>
                    )}
                  </div>

                  {frozen.length > 0 && (
                    <button
                      onClick={() => openDetails(staff, "register")}
                      className="mb-2.5 flex w-full items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-2.5 py-2 text-[10px] font-bold text-danger transition-colors hover:bg-danger/20"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span className="text-start">
                        {frozen.length} journée(s) sans pointage de sortie — cliquez pour corriger
                      </span>
                    </button>
                  )}

                  {alert && (
                    <button
                      onClick={() => openPay(staff)}
                      className={`mb-2.5 flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-[10px] font-bold transition-colors ${
                        alert.urgency === "late"
                          ? "animate-pulse border-danger/40 bg-danger/15 text-danger hover:bg-danger/25"
                          : "border-warning/40 bg-warning/15 text-warning hover:bg-warning/25"
                      }`}
                    >
                      <DollarSign className="h-3.5 w-3.5 shrink-0" />
                      <span className="text-start">
                        {alert.urgency === "late"
                          ? `Salaire en retard de ${Math.abs(alert.daysLeft)} j — ${alert.period.label}`
                          : `Salaire à verser ${alert.daysLeft === 0 ? "aujourd'hui" : `dans ${alert.daysLeft} j`} — ${alert.period.label}`}
                      </span>
                    </button>
                  )}

                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between rounded-xl border border-line/60 bg-canvas/30 p-2.5 text-xs">
                      <div>
                        <span className="block text-[10px] font-semibold uppercase text-muted">
                          Contrat
                        </span>
                        <span className="font-semibold text-ink">
                          {PAYMENT_LABELS[staff.paymentType]}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="block text-[10px] font-semibold uppercase text-muted">
                          Rémunération
                        </span>
                        <span className="font-bold text-primary">
                          {staff.paymentType === "hourly" ? staff.hourlyRate ?? 0 : staff.salary} DA /{" "}
                          {PAYMENT_UNITS[staff.paymentType]}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      <div className="rounded-xl border border-line/50 bg-canvas/20 p-2">
                        <span className="block text-[9px] uppercase text-muted">Périodes dues</span>
                        <strong className="mt-0.5 block text-ink">{duePeriods.length}</strong>
                      </div>
                      <div className="rounded-xl border border-line/50 bg-canvas/20 p-2">
                        <span className="block text-[9px] uppercase text-muted">Absences (30 j)</span>
                        <strong className="mt-0.5 block text-danger">
                          {
                            shiftsOf(staff.id).filter(
                              (s) =>
                                s.status === "absent" &&
                                s.workDate >= dayKey(new Date(Date.now() - 30 * 86400000)),
                            ).length
                          }
                        </strong>
                      </div>
                      <div className="rounded-xl border border-line/50 bg-canvas/20 p-2">
                        <span className="block text-[9px] uppercase text-muted">Acomptes</span>
                        <strong className="mt-0.5 block text-warning">
                          {openAcomptesOf(staff.id).reduce((s, a) => s + a.amount, 0)} DA
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-line/60 pt-3">
                  <span className="flex items-center gap-1.5 text-[10px] text-muted">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        totalDue > 0 ? "animate-pulse bg-warning" : "bg-success"
                      }`}
                    />
                    {duePeriods.length} période(s) due(s)
                  </span>
                  <Badge
                    tone={totalDue > 0 ? "warning" : "success"}
                    className="font-mono text-[10px] font-bold"
                  >
                    {totalDue} DA
                  </Badge>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {visibleWorkers.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-surface p-12 text-center">
          <p className="text-sm text-muted">Aucun travailleur ne correspond à cette recherche.</p>
        </div>
      )}

      {/* ================================================================== */}
      {/* Pointage par badge                                                  */}
      {/* ================================================================== */}
      <Modal open={isScanOpen} onClose={() => setIsScanOpen(false)} title="Pointage par badge RFID">
        <div className="space-y-4">
          <p className="text-[11px] leading-relaxed text-muted">
            Passez la carte du travailleur. Le <strong>premier passage de la journée</strong>{" "}
            enregistre l&apos;arrivée, le <strong>second</strong> la sortie et calcule les heures
            travaillées.
          </p>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Code de la carte</label>
            <Input
              data-scan-input="true"
              value={scanCode}
              onChange={(e) => setScanCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleScan();
              }}
              placeholder="Passez la carte ou saisissez le code..."
              autoFocus
            />
          </div>
          {scanFeedback && (
            <div
              className={`rounded-xl border p-3 text-xs ${
                scanFeedback.ok
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-danger/30 bg-danger/10 text-danger"
              }`}
            >
              {scanFeedback.text}
            </div>
          )}
          <div className="flex justify-end gap-2 border-t border-line pt-2">
            <Button variant="outline" onClick={() => setIsScanOpen(false)}>
              Fermer
            </Button>
            <Button onClick={handleScan}>Pointer</Button>
          </div>
        </div>
      </Modal>

      {/* ---- Créer ---- */}
      <Modal
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Créer un travailleur"
        size="xl"
      >
        {renderWorkerForm("create")}
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-6">
          <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleCreateStaff}>Créer</Button>
        </div>
      </Modal>

      {/* ---- Modifier ---- */}
      <Modal
        open={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        title="Modifier le travailleur"
        size="xl"
      >
        {renderWorkerForm("edit")}
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-6">
          <Button variant="outline" onClick={() => setIsEditOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleEditStaff}>Enregistrer</Button>
        </div>
      </Modal>

      {/* ================================================================== */}
      {/* Fiche du travailleur                                                */}
      {/* ================================================================== */}
      <Modal
        open={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
        title={selectedStaff ? `${selectedStaff.firstName} ${selectedStaff.lastName}` : ""}
        subtitle={
          selectedStaff
            ? `${ROLE_LABELS[selectedStaff.role ?? "reception"]}${selectedStaff.jobTitle ? ` · ${selectedStaff.jobTitle}` : ""} — contrat ${PAYMENT_LABELS[selectedStaff.paymentType].toLowerCase()}`
            : undefined
        }
        size="xl"
      >
        {selectedStaff && (
          <div className="space-y-5">
            {/* ---- Bandeau ---- */}
            <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-line bg-canvas p-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-sm font-bold tracking-wider text-primary">
                  {selectedStaff.firstName.charAt(0).toUpperCase()}
                  {selectedStaff.lastName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-base font-bold text-ink">
                    {selectedStaff.firstName} {selectedStaff.lastName}
                  </h3>
                  <span className="block text-xs text-muted">
                    {selectedStaff.phone} · {selectedStaff.email || "aucun compte"} · badge{" "}
                    <span className="font-mono">{selectedStaff.rfid || "aucun"}</span>
                  </span>
                </div>
              </div>
              <Badge tone="primary" className="px-3 py-1 text-xs font-bold">
                {selectedStaff.paymentType === "hourly"
                  ? `${selectedStaff.hourlyRate ?? 0} DA / heure`
                  : `${selectedStaff.salary} DA / ${PAYMENT_UNITS[selectedStaff.paymentType]}`}
              </Badge>
            </div>

            {/* ---- Onglets ---- */}
            <div className="flex gap-1.5 overflow-x-auto border-b border-line pb-0.5">
              {(
                [
                  { key: "register", label: "⏱️ Pointage & Absences" },
                  { key: "due", label: "🗓️ Périodes dues" },
                  { key: "finance", label: "💸 Paie & Bilan" },
                  { key: "info", label: "👤 Contrat" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setDetailsTab(tab.key)}
                  className={`-mb-0.5 whitespace-nowrap rounded-t-xl border-b-2 px-4 py-2 text-xs font-bold transition-colors ${
                    detailsTab === tab.key
                      ? "border-primary text-primary"
                      : "border-transparent text-muted hover:bg-canvas/50 hover:text-ink"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ---- Onglet CONTRAT ---- */}
            {detailsTab === "info" && (
              <div className="grid grid-cols-1 gap-4 rounded-2xl border border-line bg-surface p-4 md:grid-cols-3">
                {[
                  { label: "Début du travail", value: formatDateFr(selectedStaff.startDate) || "—" },
                  { label: "Mode de paiement", value: PAYMENT_LABELS[selectedStaff.paymentType] },
                  { label: "Poste", value: selectedStaff.jobTitle || "—" },
                  { label: "Téléphone", value: selectedStaff.phone || "—" },
                  { label: "Compte de connexion", value: selectedStaff.email || "aucun" },
                  { label: "Badge RFID", value: selectedStaff.rfid || "aucun" },
                  {
                    label: "Jours de travail",
                    value: formatDays(selectedStaff.workDays?.length ? selectedStaff.workDays : DEFAULT_WORK_DAYS),
                  },
                  {
                    label: "Horaire attendu",
                    value:
                      selectedStaff.dailyStart && selectedStaff.dailyEnd
                        ? `${selectedStaff.dailyStart} → ${selectedStaff.dailyEnd}`
                        : "—",
                  },
                  {
                    label: "Alerte de paie",
                    value: `${selectedStaff.payAlertDays ?? 3} jour(s) avant`,
                  },
                ].map((row) => (
                  <div key={row.label}>
                    <span className="block text-[10px] font-semibold uppercase text-muted">
                      {row.label}
                    </span>
                    <strong className="mt-1 block text-sm text-ink">{row.value}</strong>
                  </div>
                ))}
              </div>
            )}

            {/* ---- Onglet POINTAGE ---- */}
            {detailsTab === "register" &&
              (() => {
                const all = shiftsOf(selectedStaff.id);
                const inMonth = all.filter((s) => s.workDate.startsWith(registerMonth));
                const present = inMonth.filter((s) => s.status !== "absent");
                const absent = inMonth.filter((s) => s.status === "absent");
                const minutes = present.reduce((sum, s) => sum + s.minutes, 0);
                const scanned = inMonth.filter((s) => (s.source ?? "scan") === "scan").length;

                return (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <label className="mb-1 block text-[10px] font-bold uppercase text-muted">
                          Mois
                        </label>
                        <Input
                          type="month"
                          value={registerMonth}
                          onChange={(e) => setRegisterMonth(e.target.value)}
                          className="w-44"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => openShiftEditor(selectedStaff)}>
                          <Clock className="h-3.5 w-3.5" /> Saisir une journée
                        </Button>
                        {openShiftOf(selectedStaff.id) && (
                          <Button size="sm" variant="outline" onClick={() => handleManualEnd(selectedStaff)}>
                            <LogOut className="h-3.5 w-3.5" /> Fin de service
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                      {[
                        { label: "Journées", value: `${inMonth.length}`, tone: "text-ink" },
                        { label: "Présences", value: `${present.length}`, tone: "text-success" },
                        { label: "Absences", value: `${absent.length}`, tone: "text-danger" },
                        { label: "Heures", value: fmtHours(minutes), tone: "text-primary" },
                        { label: "Dont badgées", value: `${scanned}`, tone: "text-muted" },
                      ].map((k) => (
                        <div key={k.label} className="rounded-xl border border-line bg-canvas p-3 text-center">
                          <span className="block text-[10px] font-semibold uppercase text-muted">
                            {k.label}
                          </span>
                          <strong className={`font-mono text-base ${k.tone}`}>{k.value}</strong>
                        </div>
                      ))}
                    </div>

                    {/* Le registre : tout ce qui s'est passé, quelle qu'en soit
                        l'origine — badge, saisie, ou relevé automatique. */}
                    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
                      <div className="max-h-80 overflow-y-auto">
                        <table className="w-full border-collapse text-left text-xs">
                          <thead className="sticky top-0 bg-canvas">
                            <tr className="border-b border-line text-[10px] font-bold uppercase tracking-wider text-muted">
                              <th className="p-3">Jour</th>
                              <th className="p-3">Statut</th>
                              <th className="p-3">Arrivée</th>
                              <th className="p-3">Sortie</th>
                              <th className="p-3">Origine</th>
                              <th className="p-3 text-right">Heures</th>
                              <th className="p-3 text-right">Montant</th>
                              <th className="p-3 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {inMonth.length === 0 ? (
                              <tr>
                                <td colSpan={8} className="p-6 text-center italic text-muted">
                                  Aucune journée enregistrée sur ce mois.
                                </td>
                              </tr>
                            ) : (
                              inMonth.map((s) => (
                                <tr
                                  key={s.id}
                                  className={`border-b border-line transition-colors last:border-0 hover:bg-canvas/30 ${
                                    s.status === "absent" ? "bg-danger/5" : ""
                                  }`}
                                >
                                  <td className="p-3 font-mono text-[10px] text-ink">
                                    {formatDateFr(s.workDate)}
                                  </td>
                                  <td className="p-3">
                                    <Badge
                                      tone={s.status === "absent" ? "danger" : "success"}
                                      className="text-[9px]"
                                    >
                                      {s.status === "absent" ? "Absent" : "Présent"}
                                    </Badge>
                                  </td>
                                  <td className="p-3 font-mono">{fmtTime(s.startAt)}</td>
                                  <td className="p-3 font-mono">
                                    {s.endAt ? (
                                      fmtTime(s.endAt)
                                    ) : s.status === "absent" ? (
                                      "—"
                                    ) : (
                                      <span className="font-bold text-danger">Non pointée</span>
                                    )}
                                  </td>
                                  <td className="p-3">
                                    <Badge
                                      tone={SOURCE_LABELS[s.source ?? "scan"]?.tone ?? "neutral"}
                                      className="text-[9px]"
                                    >
                                      {SOURCE_LABELS[s.source ?? "scan"]?.label ?? s.source}
                                    </Badge>
                                  </td>
                                  <td className="p-3 text-right font-mono font-bold">
                                    {s.frozen ? (
                                      <span className="text-danger">gelée</span>
                                    ) : s.minutes > 0 ? (
                                      fmtHours(s.minutes)
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                  <td className="p-3 text-right font-mono">
                                    {s.frozen ? "—" : `${dayValueOf(selectedStaff, s)} DA`}
                                  </td>
                                  <td className="p-3 text-right">
                                    {s.paid ? (
                                      <Badge tone="success" className="text-[9px]">Payée</Badge>
                                    ) : (
                                      <button
                                        onClick={() => openShiftEditor(selectedStaff, s)}
                                        className="rounded-lg border border-line bg-canvas px-2 py-1 text-[10px] font-bold text-ink hover:bg-primary-50"
                                      >
                                        Corriger
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {inMonth.some((s) => s.notes) && (
                      <div className="rounded-2xl border border-line bg-canvas/30 p-3">
                        <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted">
                          Observations
                        </span>
                        <ul className="space-y-1 text-[10px] text-muted">
                          {inMonth
                            .filter((s) => s.notes)
                            .map((s) => (
                              <li key={s.id}>
                                <strong className="text-ink">{formatDateFr(s.workDate)}</strong> —{" "}
                                {s.notes}
                              </li>
                            ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })()}

            {/* ---- Onglet PÉRIODES DUES ---- */}
            {detailsTab === "due" &&
              (() => {
                const periods = periodsOf(selectedStaff);
                return (
                  <div className="space-y-3">
                    {periods.length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-success/40 bg-success/5 py-10 text-center text-xs font-bold text-success">
                        Ce travailleur est entièrement à jour.
                      </p>
                    ) : (
                      periods.map((p) => {
                        const { urgency, daysLeft } = urgencyOf(p, selectedStaff, today);
                        return (
                          <div
                            key={`${p.key}|${p.start}`}
                            className={`rounded-2xl border p-3 ${
                              p.running
                                ? "border-line bg-canvas/30"
                                : urgency === "late"
                                  ? "border-danger/40 bg-danger/5"
                                  : urgency === "soon"
                                    ? "border-warning/40 bg-warning/5"
                                    : "border-line bg-surface"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="min-w-0">
                                <strong className="block text-xs capitalize text-ink">{p.label}</strong>
                                <span className="mt-0.5 block text-[10px] text-muted">
                                  {frDate(p.start)} → {frDate(p.end)} · {p.present} présence(s)
                                  {p.absent > 0 && ` · ${p.absent} absence(s)`}
                                  {p.minutes > 0 && ` · ${fmtHours(p.minutes)}`}
                                </span>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                {p.running ? (
                                  <Badge tone="neutral" className="text-[9px] font-bold">En cours</Badge>
                                ) : urgency === "late" ? (
                                  <Badge tone="danger" className="animate-pulse text-[9px] font-bold">
                                    Retard {Math.abs(daysLeft)} j
                                  </Badge>
                                ) : urgency === "soon" ? (
                                  <Badge tone="warning" className="text-[9px] font-bold">
                                    {daysLeft === 0 ? "Dû aujourd'hui" : `Dans ${daysLeft} j`}
                                  </Badge>
                                ) : (
                                  <Badge tone="neutral" className="text-[9px]">
                                    Échéance {frDate(p.dueDate)}
                                  </Badge>
                                )}
                                <Badge tone="primary" className="font-mono text-[10px] font-bold">
                                  {p.amount} DA
                                </Badge>
                              </div>
                            </div>
                            {p.absent > 0 && (
                              <p className="mt-2 border-t border-line/60 pt-2 text-[10px] text-muted">
                                {p.absent} journée(s) d&apos;absence sur la période — déduction
                                possible de{" "}
                                <strong className="text-danger">{p.absenceDeduction} DA</strong> au
                                moment du règlement.
                              </p>
                            )}
                          </div>
                        );
                      })
                    )}

                    <div className="flex justify-end">
                      <Button onClick={() => { setIsDetailsOpen(false); openPay(selectedStaff); }}>
                        <DollarSign className="h-4 w-4" /> Régler une période
                      </Button>
                    </div>
                  </div>
                );
              })()}

            {/* ---- Onglet PAIE & BILAN ---- */}
            {detailsTab === "finance" &&
              (() => {
                const myPayments = paymentsOf(selectedStaff.id);
                const myAcomptes = getStaffAcomptes(selectedStaff.id);
                const myRetenues = getStaffAbsences(selectedStaff.id);
                return (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-xl border border-line bg-canvas p-3 text-center">
                        <span className="block text-[10px] font-semibold uppercase text-muted">
                          Total versé
                        </span>
                        <strong className="font-mono text-base text-success">
                          {myPayments.reduce((s, p) => s + p.amount, 0)} DA
                        </strong>
                      </div>
                      <div className="rounded-xl border border-line bg-canvas p-3 text-center">
                        <span className="block text-[10px] font-semibold uppercase text-muted">
                          Acomptes
                        </span>
                        <strong className="font-mono text-base text-warning">
                          {myAcomptes.reduce((s, a) => s + a.amount, 0)} DA
                        </strong>
                      </div>
                      <div className="rounded-xl border border-line bg-canvas p-3 text-center">
                        <span className="block text-[10px] font-semibold uppercase text-muted">
                          Retenues
                        </span>
                        <strong className="font-mono text-base text-danger">
                          {myRetenues.reduce((s, a) => s + a.cost, 0)} DA
                        </strong>
                      </div>
                    </div>

                    {/* Historique des bulletins — réimprimable, annulable */}
                    <div className="rounded-2xl border border-line bg-surface p-4">
                      <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted">
                        <Wallet className="h-4 w-4" /> Bulletins de paie
                      </h4>
                      {myPayments.length === 0 ? (
                        <p className="py-6 text-center text-xs italic text-muted">
                          Aucun règlement enregistré.
                        </p>
                      ) : (
                        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                          {myPayments.map((p) => (
                            <div
                              key={p.id}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success/20 bg-success/5 p-3 text-xs"
                            >
                              <div className="min-w-0 flex-1">
                                <span className="block font-bold text-ink">
                                  {p.amount} DA
                                  <Badge tone="primary" className="ml-1.5 text-[9px]">
                                    {p.periodKey || PAYMENT_LABELS[p.method as ReceptionPaymentType] || p.method}
                                  </Badge>
                                </span>
                                <span className="block text-[10px] text-muted">
                                  {p.daysCount} journée(s)
                                  {p.minutes > 0 && ` · ${fmtHours(p.minutes)}`} ·{" "}
                                  {new Date(p.paidAt).toLocaleString("fr-DZ", {
                                    day: "2-digit",
                                    month: "2-digit",
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                                {p.periodStart && p.periodEnd && (
                                  <span className="block text-[10px] text-muted/80">
                                    {frDate(p.periodStart)} → {frDate(p.periodEnd)}
                                  </span>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  onClick={() => reprintPayment(selectedStaff, p)}
                                  className="rounded-lg p-1.5 text-primary hover:bg-primary-50"
                                  title="Réimprimer le bulletin"
                                >
                                  <Printer className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => handleCancelPayment(p)}
                                  className="rounded-lg p-1.5 text-danger hover:bg-danger/10"
                                  title="Annuler ce règlement"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Acomptes et retenues */}
                    <div className="rounded-2xl border border-line bg-surface p-4">
                      <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted">
                        🕒 Acomptes et retenues
                      </h4>
                      {myAcomptes.length === 0 && myRetenues.length === 0 ? (
                        <p className="py-6 text-center text-xs italic text-muted">
                          Aucun acompte ni retenue.
                        </p>
                      ) : (
                        <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                          {[
                            ...myAcomptes.map((a) => ({
                              id: a.id,
                              title: "Acompte (avance)",
                              amount: a.amount,
                              date: a.date,
                              description: a.description,
                              settled: !!a.paymentId,
                              tone: "border-warning/20 bg-warning/5",
                            })),
                            ...myRetenues.map((a) => ({
                              id: a.id,
                              title: "Retenue",
                              amount: a.cost,
                              date: a.date,
                              description: a.description,
                              settled: !!a.paymentId,
                              tone: "border-danger/20 bg-danger/5",
                            })),
                          ]
                            .sort((a, b) => b.date.localeCompare(a.date))
                            .map((row) => (
                              <div
                                key={row.id}
                                className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-xs ${row.tone}`}
                              >
                                <div className="min-w-0">
                                  <span className="block font-bold text-ink">{row.title}</span>
                                  <span className="mt-0.5 block truncate text-[10px] text-muted">
                                    {row.description}
                                  </span>
                                </div>
                                <div className="shrink-0 text-right">
                                  <span className="block font-mono text-sm font-bold">
                                    -{row.amount} DA
                                  </span>
                                  <Badge
                                    tone={row.settled ? "success" : "warning"}
                                    className="mt-0.5 text-[9px]"
                                  >
                                    {row.settled ? "Déduit" : "À déduire"}
                                  </Badge>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

            <div className="flex justify-between border-t border-line pt-3">
              <Button variant="outline" onClick={() => openShiftEditor(selectedStaff)}>
                <Clock className="h-4 w-4" /> Saisir une journée
              </Button>
              <div className="flex gap-2">
                <Button onClick={() => { setIsDetailsOpen(false); openPay(selectedStaff); }}>
                  <DollarSign className="h-4 w-4" /> Payer
                </Button>
                <Button variant="outline" onClick={() => setIsDetailsOpen(false)}>
                  Fermer
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ================================================================== */}
      {/* Saisir / corriger une journée                                       */}
      {/* ================================================================== */}
      <Modal
        open={isShiftEditOpen}
        onClose={() => setIsShiftEditOpen(false)}
        title="Journée de travail"
        subtitle="Le badge n'est qu'une des portes : une journée saisie ici compte exactement comme une journée pointée."
      >
        {selectedStaff && (
          <div className="space-y-4 text-xs">
            <div className="rounded-xl border border-line bg-canvas/40 p-3">
              <strong className="block text-sm text-ink">
                {selectedStaff.firstName} {selectedStaff.lastName}
              </strong>
              <span className="text-[10px] text-muted">
                Horaire attendu : {selectedStaff.dailyStart || "—"} → {selectedStaff.dailyEnd || "—"} ·{" "}
                {formatDays(selectedStaff.workDays?.length ? selectedStaff.workDays : DEFAULT_WORK_DAYS)}
              </span>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Journée *</label>
              <Input type="date" value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} />
              {shiftDate && !worksOn(selectedStaff, shiftDate) && (
                <p className="mt-1 text-[10px] text-warning">
                  Ce jour n&apos;est pas un jour ouvré pour ce travailleur — la saisie reste
                  possible (heures supplémentaires, remplacement).
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setShiftStatus("present")}
                className={`rounded-xl border p-3 text-left transition-all ${
                  shiftStatus === "present"
                    ? "border-success bg-success/10 ring-2 ring-success/25"
                    : "border-line bg-surface"
                }`}
              >
                <strong className="block text-xs text-ink">Présent</strong>
                <span className="text-[10px] text-muted">Avec ses heures d&apos;arrivée et de sortie.</span>
              </button>
              <button
                type="button"
                onClick={() => setShiftStatus("absent")}
                className={`rounded-xl border p-3 text-left transition-all ${
                  shiftStatus === "absent"
                    ? "border-danger bg-danger/10 ring-2 ring-danger/25"
                    : "border-line bg-surface"
                }`}
              >
                <strong className="block text-xs text-ink">Absent</strong>
                <span className="text-[10px] text-muted">Aucune heure ne sera comptée.</span>
              </button>
            </div>

            {shiftStatus === "present" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Arrivée</label>
                  <Input type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">
                    Sortie (vide = en cours)
                  </label>
                  <Input type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} />
                </div>
                {shiftStart && shiftEnd && (
                  <div className="col-span-2 flex justify-between rounded-xl border border-line bg-canvas/40 p-3">
                    <span className="text-muted">Heures comptées :</span>
                    <strong className="text-primary">
                      {(() => {
                        const a = isoAt(shiftDate, shiftStart);
                        const b = isoAt(shiftDate, shiftEnd);
                        if (!a || !b) return "—";
                        const min = Math.round(
                          (new Date(b).getTime() - new Date(a).getTime()) / 60000,
                        );
                        return min > 0 ? fmtHours(min) : "heure de fin invalide";
                      })()}
                    </strong>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Observation</label>
              <Input
                value={shiftNotes}
                onChange={(e) => setShiftNotes(e.target.value)}
                placeholder="Badge oublié, absence justifiée, remplacement…"
              />
            </div>

            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <Button variant="outline" onClick={() => setIsShiftEditOpen(false)}>
                Annuler
              </Button>
              <Button onClick={handleSaveShift} disabled={savingShift}>
                {savingShift ? "Enregistrement..." : "Enregistrer la journée"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ---- Acompte ---- */}
      <Modal open={isAcompteOpen} onClose={() => setIsAcompteOpen(false)} title="Nouvel acompte">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">
              Montant de l&apos;acompte (DA) *
            </label>
            <Input
              type="number"
              value={amount || ""}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder="Ex: 3000"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Motif</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Avance" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Date</label>
            <Input type="date" value={actionDate} onChange={(e) => setActionDate(e.target.value)} />
          </div>
          <p className="rounded-xl border border-line bg-canvas/40 p-2.5 text-[10px] leading-relaxed text-muted">
            L&apos;argent sort de la caisse tout de suite. L&apos;acompte sera{" "}
            <strong>déduit du prochain règlement</strong> — et rattaché à lui, pas supprimé :
            annuler ce règlement le rendra à nouveau exigible.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setIsAcompteOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreateAcompte}>Confirmer</Button>
          </div>
        </div>
      </Modal>

      {/* ---- Retenue ---- */}
      <Modal open={isAbsenceOpen} onClose={() => setIsAbsenceOpen(false)} title="Nouvelle retenue">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">
              Coût de la retenue (DA) *
            </label>
            <Input
              type="number"
              value={amount || ""}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder="Ex: 1000"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Motif</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Retard répété" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Date</label>
            <Input type="date" value={actionDate} onChange={(e) => setActionDate(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setIsAbsenceOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreateAbsence}>Confirmer</Button>
          </div>
        </div>
      </Modal>

      {/* ================================================================== */}
      {/* RÈGLEMENT                                                           */}
      {/* ================================================================== */}
      <Modal
        open={isPayOpen}
        onClose={() => setIsPayOpen(false)}
        title="Régler un travailleur"
        subtitle={
          selectedStaff
            ? `${selectedStaff.firstName} ${selectedStaff.lastName} — contrat ${PAYMENT_LABELS[selectedStaff.paymentType].toLowerCase()} · choisissez la période, vérifiez le détail, puis validez.`
            : undefined
        }
        size="xl"
      >
        {selectedStaff && (
          <div className="space-y-5">
            {/* ---- Bandeau ---- */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-primary/25 bg-gradient-to-r from-primary-50/70 to-transparent p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-sm font-bold tracking-wider text-primary">
                  {selectedStaff.firstName.charAt(0).toUpperCase()}
                  {selectedStaff.lastName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <strong className="block text-base text-ink">
                    {selectedStaff.firstName} {selectedStaff.lastName}
                  </strong>
                  <span className="block text-[11px] text-muted">
                    {ROLE_LABELS[selectedStaff.role ?? "reception"]}
                    {selectedStaff.jobTitle && ` · ${selectedStaff.jobTitle}`} ·{" "}
                    {selectedStaff.paymentType === "hourly"
                      ? `${selectedStaff.hourlyRate ?? 0} DA / heure`
                      : `${selectedStaff.salary} DA / ${PAYMENT_UNITS[selectedStaff.paymentType]}`}{" "}
                    · depuis le {formatDateFr(selectedStaff.startDate)}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="warning" className="font-bold">
                  {payPeriods.filter((p) => !p.running).length} période(s) due(s)
                </Badge>
                <Badge tone="primary" className="font-mono font-bold">
                  {payPeriods.filter((p) => !p.running).reduce((s, p) => s + p.amount, 0)} DA
                </Badge>
              </div>
            </div>

            {payPeriods.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-success/40 bg-success/5 py-12 text-center">
                <strong className="block text-sm text-success">Rien à régler.</strong>
                <span className="mt-1 block text-[11px] text-muted">
                  Toutes les périodes de ce travailleur ont déjà été payées.
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
                {/* ---- COLONNE GAUCHE : les périodes ---- */}
                <div className="space-y-3">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-muted">
                    {selectedStaff.paymentType === "monthly"
                      ? "Mois non payés"
                      : selectedStaff.paymentType === "hourly"
                        ? "Journées pointées non payées"
                        : "Journées non payées"}
                  </span>

                  <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
                    {payPeriods.map((p) => {
                      const id = `${p.key}|${p.start}`;
                      const chosen = payPeriodKey === id;
                      const { urgency, daysLeft } = urgencyOf(p, selectedStaff, today);
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            setPayPeriodKey(id);
                            setPayAmountOverride(null);
                            setPayDetailsOpen(false);
                          }}
                          disabled={p.running}
                          className={`w-full rounded-2xl border p-3 text-left transition-all ${
                            p.running
                              ? "cursor-not-allowed border-line bg-canvas/20 opacity-60"
                              : chosen
                                ? "border-primary bg-primary-50/40 ring-2 ring-primary/25"
                                : "border-line bg-canvas/20 hover:border-primary/40"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <strong className="block text-xs capitalize text-ink">{p.label}</strong>
                              <span className="mt-0.5 block text-[10px] text-muted">
                                {frDate(p.start)} → {frDate(p.end)}
                              </span>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                              {p.running ? (
                                <Badge tone="neutral" className="text-[9px] font-bold">
                                  Mois en cours
                                </Badge>
                              ) : urgency === "late" ? (
                                <Badge tone="danger" className="animate-pulse text-[9px] font-bold">
                                  Retard {Math.abs(daysLeft)} j
                                </Badge>
                              ) : urgency === "soon" ? (
                                <Badge tone="warning" className="text-[9px] font-bold">
                                  {daysLeft === 0 ? "Aujourd'hui" : `Dans ${daysLeft} j`}
                                </Badge>
                              ) : null}
                              <Badge tone="success" className="font-mono text-[10px] font-bold">
                                {p.amount} DA
                              </Badge>
                            </div>
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line/60 pt-2 text-[10px]">
                            <Badge tone="success" className="text-[9px]">
                              {p.present} présence(s)
                            </Badge>
                            {p.absent > 0 && (
                              <Badge tone="danger" className="text-[9px]">
                                {p.absent} absence(s)
                              </Badge>
                            )}
                            {p.expected > 0 && (
                              <Badge tone="neutral" className="text-[9px]">
                                {p.expected} jour(s) attendu(s)
                              </Badge>
                            )}
                            {p.minutes > 0 && (
                              <Badge tone="primary" className="font-mono text-[9px]">
                                {fmtHours(p.minutes)}
                              </Badge>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* ---- LE DÉTAIL JOUR PAR JOUR ---- */}
                  {/* Le bouton que l'ancien écran n'avait pas : payer un mois
                      sans pouvoir montrer les journées qui le composent est ce
                      qui rendait tout salaire discutable. */}
                  {chosenPeriod && (
                    <div className="rounded-2xl border border-line bg-surface">
                      <button
                        type="button"
                        onClick={() => setPayDetailsOpen(!payDetailsOpen)}
                        className="flex w-full items-center justify-between gap-2 p-3 text-left"
                      >
                        <span className="flex items-center gap-2 text-[11px] font-bold text-ink">
                          <CheckSquare className="h-4 w-4 text-primary" />
                          Détail des journées de la période ({periodShifts(chosenPeriod).length})
                        </span>
                        <span className="text-[10px] font-bold text-primary">
                          {payDetailsOpen ? "Masquer" : "Afficher"}
                        </span>
                      </button>

                      {payDetailsOpen && (
                        <div className="max-h-64 overflow-y-auto border-t border-line">
                          <table className="w-full text-left text-[11px]">
                            <thead className="sticky top-0 bg-canvas">
                              <tr className="text-[9px] uppercase text-muted">
                                <th className="p-2">Jour</th>
                                <th className="p-2">Statut</th>
                                <th className="p-2">Arrivée</th>
                                <th className="p-2">Sortie</th>
                                <th className="p-2">Origine</th>
                                <th className="p-2 text-right">Heures</th>
                                <th className="p-2 text-right">Montant</th>
                              </tr>
                            </thead>
                            <tbody>
                              {periodShifts(chosenPeriod).length === 0 ? (
                                <tr>
                                  <td colSpan={7} className="p-4 text-center italic text-muted">
                                    Aucune journée enregistrée sur cette période.
                                  </td>
                                </tr>
                              ) : (
                                periodShifts(chosenPeriod).map((s) => (
                                  <tr
                                    key={s.id}
                                    className={`border-t border-line/50 ${
                                      s.status === "absent" ? "bg-danger/5 text-muted" : ""
                                    }`}
                                  >
                                    <td className="p-2 font-mono text-[10px]">
                                      {formatDateFr(s.workDate)}
                                    </td>
                                    <td className="p-2">
                                      <Badge
                                        tone={s.status === "absent" ? "danger" : "success"}
                                        className="text-[9px]"
                                      >
                                        {s.status === "absent" ? "Absent" : "Présent"}
                                      </Badge>
                                    </td>
                                    <td className="p-2 font-mono">{fmtTime(s.startAt)}</td>
                                    <td className="p-2 font-mono">{fmtTime(s.endAt)}</td>
                                    <td className="p-2 text-[9px] text-muted">
                                      {SOURCE_LABELS[s.source ?? "scan"]?.label ?? s.source}
                                    </td>
                                    <td className="p-2 text-right font-mono">
                                      {s.minutes > 0 ? fmtHours(s.minutes) : "—"}
                                    </td>
                                    <td className="p-2 text-right font-mono font-bold text-primary">
                                      {dayValueOf(selectedStaff, s)} DA
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ---- COLONNE DROITE : le calcul ---- */}
                <div className="space-y-3 lg:sticky lg:top-2 lg:self-start">
                  <div className="rounded-2xl border border-line bg-canvas p-4">
                    <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-muted">
                      Période réglée
                    </span>
                    {chosenPeriod ? (
                      <>
                        <strong className="block text-sm capitalize text-ink">
                          {chosenPeriod.label}
                        </strong>
                        <span className="mt-0.5 block text-[10px] text-muted">
                          {frDate(chosenPeriod.start)} → {frDate(chosenPeriod.end)}
                        </span>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                          <div className="rounded-xl border border-line bg-surface p-2">
                            <span className="block text-[9px] uppercase text-muted">Présences</span>
                            <strong className="font-mono text-base text-success">
                              {chosenPeriod.present}
                            </strong>
                          </div>
                          <div className="rounded-xl border border-line bg-surface p-2">
                            <span className="block text-[9px] uppercase text-muted">Absences</span>
                            <strong className="font-mono text-base text-danger">
                              {chosenPeriod.absent}
                            </strong>
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="py-3 text-center text-[11px] italic text-muted">
                        Choisissez une période à gauche.
                      </p>
                    )}
                  </div>

                  {/* Retenues */}
                  {chosenPeriod &&
                    (chosenPeriod.absenceDeduction > 0 || acomptesTotal > 0 || retenuesTotal > 0) && (
                      <div className="space-y-2 rounded-2xl border border-danger/25 bg-danger/5 p-4">
                        <span className="block text-[10px] font-bold uppercase tracking-wider text-danger">
                          Retenues à déduire
                        </span>

                        {chosenPeriod.absenceDeduction > 0 && (
                          <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
                            <span className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={deductAbsences}
                                onChange={(e) => {
                                  setDeductAbsences(e.target.checked);
                                  setPayAmountOverride(null);
                                }}
                                className="h-4 w-4"
                              />
                              <span className="text-ink">
                                Absences de la période
                                <span className="block text-[10px] text-muted">
                                  {chosenPeriod.absent} jour(s) non travaillé(s)
                                </span>
                              </span>
                            </span>
                            <strong className="font-mono text-danger">
                              -{chosenPeriod.absenceDeduction} DA
                            </strong>
                          </label>
                        )}

                        {acomptesTotal > 0 && (
                          <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
                            <span className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={deductAcomptes}
                                onChange={(e) => {
                                  setDeductAcomptes(e.target.checked);
                                  setPayAmountOverride(null);
                                }}
                                className="h-4 w-4"
                              />
                              <span className="text-ink">
                                Acomptes déjà versés
                                <span className="block text-[10px] text-muted">
                                  {payOpenAcomptes.length} avance(s)
                                </span>
                              </span>
                            </span>
                            <strong className="font-mono text-danger">-{acomptesTotal} DA</strong>
                          </label>
                        )}

                        {retenuesTotal > 0 && (
                          <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
                            <span className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={deductRetenues}
                                onChange={(e) => {
                                  setDeductRetenues(e.target.checked);
                                  setPayAmountOverride(null);
                                }}
                                className="h-4 w-4"
                              />
                              <span className="text-ink">
                                Retenues
                                <span className="block text-[10px] text-muted">
                                  {payOpenRetenues.length} retenue(s)
                                </span>
                              </span>
                            </span>
                            <strong className="font-mono text-danger">-{retenuesTotal} DA</strong>
                          </label>
                        )}

                        <p className="border-t border-danger/20 pt-2 text-[10px] leading-relaxed text-muted">
                          Cochées, acomptes et retenues sont <strong>rattachés</strong> à ce
                          règlement — jamais supprimés. L&apos;annuler les rend à nouveau
                          exigibles.
                        </p>
                      </div>
                    )}

                  {/* Montant final */}
                  <div className="space-y-1.5 rounded-2xl border-2 border-success/40 bg-success/5 p-4 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted">Rémunération brute</span>
                      <strong className="font-mono text-ink">
                        {chosenPeriod ? chosenPeriod.amount : 0} DA
                      </strong>
                    </div>
                    {deductAbsences && (chosenPeriod?.absenceDeduction ?? 0) > 0 && (
                      <div className="flex justify-between text-danger">
                        <span>Absences</span>
                        <strong className="font-mono">-{chosenPeriod?.absenceDeduction} DA</strong>
                      </div>
                    )}
                    {deductAcomptes && acomptesTotal > 0 && (
                      <div className="flex justify-between text-danger">
                        <span>Acomptes</span>
                        <strong className="font-mono">-{acomptesTotal} DA</strong>
                      </div>
                    )}
                    {deductRetenues && retenuesTotal > 0 && (
                      <div className="flex justify-between text-danger">
                        <span>Retenues</span>
                        <strong className="font-mono">-{retenuesTotal} DA</strong>
                      </div>
                    )}
                    <div className="flex items-end justify-between border-t border-success/30 pt-2">
                      <span className="text-[10px] font-bold uppercase text-muted">Net à verser</span>
                      <strong className="font-mono text-2xl font-black text-success">
                        {finalPay} DA
                      </strong>
                    </div>
                  </div>

                  {/* Correction manuelle */}
                  <div className="rounded-2xl border border-line bg-canvas/40 p-3">
                    <label className="mb-1 block text-[10px] font-bold uppercase text-muted">
                      Montant versé (modifiable)
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={payAmountOverride ?? computedNet}
                      onChange={(e) => setPayAmountOverride(Number(e.target.value))}
                    />
                    <div className="mt-1.5 flex items-center justify-between">
                      <p className="text-[10px] text-muted">
                        Calcul automatique : {computedNet} DA.
                      </p>
                      {payAmountOverride !== null && payAmountOverride !== computedNet && (
                        <button
                          onClick={() => setPayAmountOverride(null)}
                          className="text-[10px] font-bold text-primary hover:underline"
                        >
                          Revenir au calcul
                        </button>
                      )}
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={!chosenPeriod}
                    onClick={() => {
                      if (!chosenPeriod || !selectedStaff) return;
                      printHtmlDocument(
                        buildWorkerPaymentReceipt({
                          worker: selectedStaff,
                          school,
                          lang: language,
                          amount: finalPay,
                          gross: grossOf(chosenPeriod),
                          acomptes: deductAcomptes ? acomptesTotal : 0,
                          deductions:
                            (deductRetenues ? retenuesTotal : 0) +
                            (deductAbsences ? chosenPeriod.absenceDeduction : 0),
                          periodLabel: chosenPeriod.label,
                          details: buildPaymentDetails(
                            periodShifts(chosenPeriod),
                            chosenPeriod.shiftIds,
                            (s) => dayValueOf(selectedStaff, s),
                          ),
                          paidAt: new Date().toISOString(),
                          receiptNo: "PROJET — NON VALIDÉ",
                        }),
                      );
                    }}
                  >
                    <Printer className="h-4 w-4" /> Imprimer le détail
                  </Button>

                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setIsPayOpen(false)}>
                      Annuler
                    </Button>
                    <Button
                      variant="success"
                      className="flex-1"
                      onClick={handlePay}
                      disabled={savingPay || !chosenPeriod || finalPay <= 0}
                    >
                      {savingPay ? "Enregistrement..." : `Payer ${finalPay} DA`}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
