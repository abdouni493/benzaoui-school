"use client";

import { useMemo, useState } from "react";
import { useData, uid } from "@/lib/store/data";
import { createClient } from "@/lib/supabase/client";
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
  Percent,
  Printer,
  Search,
  Users,
  Clock,
  X,
} from "lucide-react";
import type { Day, ScheduleSession, Teacher, TeacherPaymentDetail } from "@/lib/types";
import { DAYS } from "@/lib/types";
import { printHtmlDocument } from "@/lib/print";
import { buildTeacherPaymentReport } from "@/lib/reports/teacherPayment";
import { buildTeacherSettlementReceipt } from "@/lib/reports/teacherSettlement";
import { DAY_LABELS_FR, formatDateFr, formatDays } from "@/lib/helpers";
import { useSettings } from "@/lib/store/settings";

/** One unpaid timing of a teacher: a (date, séance) pair with everyone who was
 *  present on it — registered students AND passagers. */
interface UnpaidTiming {
  key: string; // "YYYY-MM-DD|sessionId" — the key the settlement RPC expects
  dateKey: string;
  sessionId: string;
  isOpen: boolean;
  title: string;
  moduleName: string;
  className: string;
  groupName: string;
  startTime: string;
  endTime: string;
  students: {
    name: string;
    groupName: string;
    time: string;
    status: string;
    fee: number;
    share: number;
    isPassager: boolean;
  }[];
  passagers: number;
  totalFees: number;
  totalShare: number;
}

export function TeachersPage() {
  const {
    teachers,
    sessions,
    modules,
    groups,
    classes,
    salles,
    students,
    unpaidTeacher,
    acomptes,
    absences,
    cash,
    attendance,
    independent,
    teacherPayments,
    school,
    push,
    deleteFrom,
    updateItem,
    settleTeacherPercentage,
    payTeacherSessions,
  } = useData();
  const { language } = useSettings();

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isAcompteOpen, setIsAcompteOpen] = useState(false);
  const [isAbsenceOpen, setIsAbsenceOpen] = useState(false);
  const [isPayOpen, setIsPayOpen] = useState(false);
  const [isUnpaidDetailOpen, setIsUnpaidDetailOpen] = useState(false);
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null);

  // Form: Create/Edit Teacher
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [paymentType, setPaymentType] = useState<"monthly" | "percentage">("percentage");
  const [monthlyAmount, setMonthlyAmount] = useState<number>(0);
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [percentage, setPercentage] = useState<number>(50);

  // Form: Acompte & Absence
  const [amount, setAmount] = useState<number>(0);
  const [description, setDescription] = useState("");
  const [actionDate, setActionDate] = useState(new Date().toISOString().split("T")[0]);

  // Form: Print
  const [printStart, setPrintStart] = useState("");
  const [printEnd, setPrintEnd] = useState("");

  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [detailsTab, setDetailsTab] = useState<"info" | "finance" | "sessions">("info");
  const [sessionFilter, setSessionFilter] = useState<"all" | "paid" | "unpaid">("all");

  // ---- List search / filters ------------------------------------------------
  const [teacherSearch, setTeacherSearch] = useState("");
  const [teacherKind, setTeacherKind] = useState<"all" | "staff" | "passager">("all");

  // ---- Per-timing settlement (séance libre + enseignant passager) ----------
  const [isTimingPayOpen, setIsTimingPayOpen] = useState(false);
  const [selectedTimingKeys, setSelectedTimingKeys] = useState<string[]>([]);
  const [payMethod, setPayMethod] = useState<"fixed" | "percent">("fixed");
  const [payFixedAmount, setPayFixedAmount] = useState<number>(0);
  const [payPercentage, setPayPercentage] = useState<number>(50);
  const [expandedTimingKey, setExpandedTimingKey] = useState<string | null>(null);
  const [timingGroupFilter, setTimingGroupFilter] = useState<string>("all");
  const [savingPayment, setSavingPayment] = useState(false);
  // Passager teacher created straight from this page
  const [isPassagerCreateOpen, setIsPassagerCreateOpen] = useState(false);

  // Helpers
  const getTeacherUnpaidSessions = (tid: string) => {
    return unpaidTeacher.filter((u) => u.teacherId === tid && !u.paid);
  };

  const getTeacherAcomptes = (tid: string) => {
    return acomptes.filter((a) => a.teacherId === tid);
  };

  const getTeacherAbsences = (tid: string) => {
    return absences.filter((a) => a.teacherId === tid);
  };

  // Group a teacher's UNPAID séances by day + timing, with each student's
  // exact scan time, fee and teacher share — the "calculation detail" view
  // shown before validating a percentage payment.
  const buildUnpaidDetail = (tid: string) => {
    const rows = unpaidTeacher.filter((u) => u.teacherId === tid && !u.paid);
    const map: Record<string, {
      dateKey: string;
      sessionId: string;
      moduleName: string;
      className: string;
      groupName: string;
      startTime: string;
      endTime: string;
      students: { name: string; time: string; status: string; fee: number; share: number }[];
      totalFees: number;
      totalPayout: number;
    }> = {};

    rows.forEach((u) => {
      const dateKey = new Date(u.date).toLocaleDateString("fr-CA");
      const key = `${dateKey}_${u.sessionId}`;
      const sess = sessions.find((s) => s.id === u.sessionId);
      if (!map[key]) {
        map[key] = {
          dateKey,
          sessionId: u.sessionId,
          moduleName: sess ? modules.find((m) => m.id === sess.moduleId)?.name ?? "Séance" : "Séance",
          className: sess ? classes.find((c) => c.id === sess.classId)?.name ?? "-" : "-",
          groupName: sess ? groups.find((g) => g.id === sess.groupId)?.name ?? "-" : "-",
          startTime: sess?.startTime ?? "",
          endTime: sess?.endTime ?? "",
          students: [],
          totalFees: 0,
          totalPayout: 0,
        };
      }
      const stu = students.find((st) => st.id === u.studentId);
      const att = attendance.find(
        (a) =>
          a.studentId === u.studentId &&
          a.sessionId === u.sessionId &&
          new Date(a.timestamp).toLocaleDateString("fr-CA") === dateKey
      );
      map[key].students.push({
        name: stu ? `${stu.firstName} ${stu.lastName}` : "Élève inconnu",
        time: new Date(att?.timestamp ?? u.date).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        status: att?.status === "late" ? "En Retard" : "Présent",
        fee: att?.amountDeducted ?? 0,
        share: u.amount,
      });
      map[key].totalFees += att?.amountDeducted ?? 0;
      map[key].totalPayout += u.amount;
    });

    return Object.values(map).sort(
      (a, b) => b.dateKey.localeCompare(a.dateKey) || a.startTime.localeCompare(b.startTime)
    );
  };

  // ---------------------------------------------------------------------------
  // Per-timing view of what a teacher is still owed.
  //
  // A "timing" is one (date, séance) pair. The presences of registered students
  // come from `unpaid_teacher_sessions` (one row per présence, flipped to paid
  // by the settlement RPC), and the passagers come from the séances libres
  // recorded on the Séances Libres screen for the same timing — so the payout
  // screen shows the FULL attendance of the créneau.
  //
  // Only UNPAID timings are ever listed: once settled, the underlying rows are
  // `paid = true` and the timing disappears from here for good.
  // ---------------------------------------------------------------------------
  // ---- Emploi du temps of one teacher --------------------------------------
  // Every screen that lists a teacher's timings shows the SAME card, because
  // what reception asks first about a créneau is "quels jours ?" — the hours
  // alone say nothing about when the teacher is actually expected.

  /** Minutes of one séance of this timing. */
  const timingMinutes = (s: ScheduleSession) => {
    const [sh, sm] = s.startTime.split(":").map(Number);
    const [eh, em] = s.endTime.split(":").map(Number);
    const diff = (eh * 60 + em) - (sh * 60 + sm);
    return diff > 0 ? diff : 0;
  };

  const asHours = (minutes: number) =>
    `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;

  /** A séance libre spreads over several classes / groups / salles. */
  const timingLabels = (s: ScheduleSession) => {
    const many = (ids: string[] | undefined, one: string | undefined, name: (id: string) => string) =>
      (s.isOpen && ids?.length ? ids : [one]).filter(Boolean).map((id) => name(id as string)).join(" · ") || "—";
    return {
      title: s.isOpen
        ? s.title || `Séance libre — ${modules.find((m) => m.id === s.moduleId)?.name ?? "Séance"}`
        : modules.find((m) => m.id === s.moduleId)?.name ?? "Séance",
      moduleName: modules.find((m) => m.id === s.moduleId)?.name ?? "—",
      className: many(s.classIds, s.classId, (id) => classes.find((c) => c.id === id)?.name ?? "—"),
      groupName: many(s.groupIds, s.groupId, (id) => groups.find((g) => g.id === id)?.name ?? "—"),
      salleName: many(s.salleIds, s.salleId, (id) => salles.find((sa) => sa.id === id)?.name ?? "—"),
    };
  };

  /** One assigned emploi du temps, days of the week included. */
  const renderTimingCard = (s: ScheduleSession) => {
    const l = timingLabels(s);
    const weekly = timingMinutes(s) * s.days.length;
    return (
      <div key={s.id} className="space-y-2 rounded-xl border border-line bg-canvas/30 p-3 text-xs">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <strong className="block truncate text-ink">
              {s.isOpen && <span className="me-1">🎯</span>}
              {l.title}
            </strong>
            <span className="mt-0.5 block truncate text-[10px] text-muted">
              {l.className} · Gr: {l.groupName} · Salle: {l.salleName}
            </span>
          </div>
          <Badge tone={s.isOpen ? "success" : "primary"} className="shrink-0 text-[9px]">
            {s.isOpen ? "Séance libre" : "Cours"}
          </Badge>
        </div>

        {/* Days of the week — the whole point of this card */}
        <div className="flex flex-wrap items-center gap-1">
          {DAYS.map((d: Day) => {
            const on = s.days.includes(d);
            return (
              <span
                key={d}
                className={`rounded-md border px-1.5 py-0.5 text-[9px] font-bold ${
                  on
                    ? "border-primary bg-primary text-white"
                    : "border-line bg-surface text-muted/50"
                }`}
                title={DAY_LABELS_FR[d]}
              >
                {DAY_LABELS_FR[d].slice(0, 3)}
              </span>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/60 pt-2 font-mono text-[10px] text-primary">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {s.startTime} - {s.endTime}
          </span>
          <span className="text-muted">
            {s.days.length} séance{s.days.length > 1 ? "s" : ""} / semaine · {asHours(weekly)}
          </span>
          {s.periodStart && (
            <span className="text-muted">
              {formatDateFr(s.periodStart)} → {formatDateFr(s.periodEnd)}
            </span>
          )}
        </div>

        <p className="text-[10px] text-muted">
          <strong className="text-ink">Jours :</strong> {formatDays(s.days) || "aucun jour défini"}
        </p>
      </div>
    );
  };

  /** "3 créneaux · 7 séances / semaine · 12h00" — recap above the cards. */
  const renderTimingRecap = (list: ScheduleSession[]) => {
    const seances = list.reduce((sum, s) => sum + s.days.length, 0);
    const minutes = list.reduce((sum, s) => sum + timingMinutes(s) * s.days.length, 0);
    const daysCovered = DAYS.filter((d) => list.some((s) => s.days.includes(d)));
    return (
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px]">
        <Badge tone="primary" className="font-bold">{list.length} créneau(x)</Badge>
        <Badge tone="neutral" className="font-bold">{seances} séance(s) / semaine</Badge>
        <Badge tone="success" className="font-bold">{asHours(minutes)} / semaine</Badge>
        <span className="text-muted">
          Jours travaillés : <strong className="text-ink">{formatDays(daysCovered) || "—"}</strong>
        </span>
      </div>
    );
  };

  const buildUnpaidTimings = (tid: string): UnpaidTiming[] => {
    const map = new Map<string, UnpaidTiming>();

    const timingFor = (sessionId: string, dateKey: string): UnpaidTiming => {
      const key = `${dateKey}|${sessionId}`;
      let t = map.get(key);
      if (!t) {
        const sess = sessions.find((s) => s.id === sessionId);
        const moduleName = sess ? modules.find((m) => m.id === sess.moduleId)?.name ?? "Séance" : "Séance";
        t = {
          key,
          dateKey,
          sessionId,
          isOpen: !!sess?.isOpen,
          title: sess?.isOpen ? sess.title || `Séance libre — ${moduleName}` : moduleName,
          moduleName,
          className: sess ? classes.find((c) => c.id === sess.classId)?.name ?? "-" : "-",
          groupName: sess
            ? sess.isOpen
              ? (sess.groupIds?.length ? sess.groupIds : [sess.groupId])
                  .map((id) => groups.find((g) => g.id === id)?.name ?? "-")
                  .join(" · ")
              : groups.find((g) => g.id === sess.groupId)?.name ?? "-"
            : "-",
          startTime: sess?.startTime ?? "",
          endTime: sess?.endTime ?? "",
          students: [],
          passagers: 0,
          totalFees: 0,
          totalShare: 0,
        };
        map.set(key, t);
      }
      return t;
    };

    // Registered students, from the teacher's unpaid dues
    unpaidTeacher
      .filter((u) => u.teacherId === tid && !u.paid)
      .forEach((u) => {
        const dateKey = new Date(u.date).toLocaleDateString("fr-CA");
        const t = timingFor(u.sessionId, dateKey);
        const stu = students.find((st) => st.id === u.studentId);
        const att = attendance.find(
          (a) =>
            a.studentId === u.studentId &&
            a.sessionId === u.sessionId &&
            new Date(a.timestamp).toLocaleDateString("fr-CA") === dateKey,
        );
        const sess = sessions.find((s) => s.id === u.sessionId);
        t.students.push({
          name: stu ? `${stu.firstName} ${stu.lastName}` : "Élève inconnu",
          groupName: sess ? groups.find((g) => g.id === sess.groupId)?.name ?? "-" : "-",
          time: new Date(att?.timestamp ?? u.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          status: att?.status === "late" ? "En Retard" : "Présent",
          fee: att?.amountDeducted ?? 0,
          share: u.amount,
          isPassager: false,
        });
        t.totalFees += att?.amountDeducted ?? 0;
        t.totalShare += u.amount;
      });

    // Passagers of the same timings (séances libres, no student account).
    // `teacherPaid` is their own settlement flag: a créneau attended only by
    // passagers has no unpaid_teacher_sessions row to flip. A séance OFFERTE
    // (`isFree`) is skipped outright: nobody is paid on it, teacher included.
    const teacherSessionIds = new Set(sessions.filter((s) => s.teacherId === tid).map((s) => s.id));
    independent
      .filter(
        (ind) =>
          ind.sessionId &&
          teacherSessionIds.has(ind.sessionId) &&
          !ind.studentId &&
          !ind.isFree &&
          !ind.teacherPaid,
      )
      .forEach((ind) => {
        const key = `${ind.date}|${ind.sessionId}`;
        // A passager alone can also create the timing: he still generated money.
        const t = map.get(key) ?? timingFor(ind.sessionId!, ind.date);
        t.students.push({
          name: ind.passagerName ?? "Passager",
          groupName: "Passager",
          time: ind.startTime ?? "-",
          status: "Présent",
          fee: ind.price,
          share: 0,
          isPassager: true,
        });
        t.passagers += 1;
        t.totalFees += ind.price;
      });

    return [...map.values()].sort(
      (a, b) => b.dateKey.localeCompare(a.dateKey) || a.startTime.localeCompare(b.startTime),
    );
  };

  /** The timings currently listed in the payment modal (memoised: the modal
   *  recomputes them on every keystroke of the amount field otherwise). */
  const payTimings = useMemo(
    () => (selectedTeacher ? buildUnpaidTimings(selectedTeacher.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedTeacher, unpaidTeacher, independent, attendance, sessions, students, groups, modules, classes],
  );

  const chosenTimings = payTimings.filter((t) => selectedTimingKeys.includes(t.key));
  const chosenPresents = chosenTimings.reduce((s, t) => s + t.students.length, 0);
  const chosenPassagers = chosenTimings.reduce((s, t) => s + t.passagers, 0);
  const chosenRevenue = chosenTimings.reduce((s, t) => s + t.totalFees, 0);

  /**
   * What the teacher gets for the chosen timings.
   *  - "fixed": whatever the user typed.
   *  - "percent": the percentage is applied to what each student generated
   *    (module cost × %), summed over every présence — computed automatically.
   */
  const computedPayout = useMemo(() => {
    if (payMethod === "fixed") return Math.max(0, Math.round(payFixedAmount || 0));
    const pct = Math.min(Math.max(payPercentage || 0, 0), 100);
    return chosenTimings.reduce(
      (sum, t) => sum + t.students.reduce((s, st) => s + Math.round((st.fee * pct) / 100), 0),
      0,
    );
  }, [payMethod, payFixedAmount, payPercentage, chosenTimings]);

  /** Per-timing share, distributed the same way the total is computed. */
  const shareForTiming = (t: UnpaidTiming) => {
    if (payMethod === "percent") {
      const pct = Math.min(Math.max(payPercentage || 0, 0), 100);
      return t.students.reduce((s, st) => s + Math.round((st.fee * pct) / 100), 0);
    }
    // Fixed amount: spread proportionally to what each timing generated so the
    // printed slip still adds up to the amount actually paid.
    if (chosenRevenue <= 0) {
      return chosenTimings.length > 0 ? Math.round(computedPayout / chosenTimings.length) : 0;
    }
    return Math.round((computedPayout * t.totalFees) / chosenRevenue);
  };

  const openTimingPay = (t: Teacher) => {
    setSelectedTeacher(t);
    const timings = buildUnpaidTimings(t.id);
    setSelectedTimingKeys(timings.map((x) => x.key));
    setPayMethod(t.isPassager ? "fixed" : "percent");
    setPayFixedAmount(0);
    setPayPercentage(t.percentage ?? 50);
    setExpandedTimingKey(null);
    setTimingGroupFilter("all");
    setIsTimingPayOpen(true);
    setActiveMenuId(null);
  };

  const handleTimingPayment = async () => {
    if (!selectedTeacher) return;
    if (selectedTimingKeys.length === 0) {
      alert("Sélectionnez au moins un créneau à régler.");
      return;
    }
    if (computedPayout <= 0) {
      alert("Le montant à verser doit être supérieur à 0 DA.");
      return;
    }

    const details: TeacherPaymentDetail[] = chosenTimings.map((t) => ({
      dateKey: t.dateKey,
      sessionId: t.sessionId,
      title: t.title,
      moduleName: t.moduleName,
      groupName: t.groupName,
      startTime: t.startTime,
      endTime: t.endTime,
      presents: t.students.length,
      passagers: t.passagers,
      gross: t.totalFees,
      share: shareForTiming(t),
    }));

    setSavingPayment(true);
    try {
      const res = await payTeacherSessions({
        teacherId: selectedTeacher.id,
        keys: selectedTimingKeys,
        amount: computedPayout,
        method: payMethod,
        percentage: payMethod === "percent" ? payPercentage : undefined,
        details,
        description: `Règlement séances ${selectedTeacher.firstName} ${selectedTeacher.lastName}`,
      });

      if (!res.ok) {
        alert("Le règlement a échoué — veuillez réessayer.");
        return;
      }

      setIsTimingPayOpen(false);

      if (confirm(`Paiement de ${computedPayout} DA enregistré. Imprimer le bon de paiement ?`)) {
        printHtmlDocument(
          buildTeacherSettlementReceipt({
            teacher: selectedTeacher,
            school,
            lang: language,
            amount: computedPayout,
            method: payMethod,
            percentage: payMethod === "percent" ? payPercentage : undefined,
            details,
            paidAt: new Date().toISOString(),
          }),
        );
      }
    } finally {
      setSavingPayment(false);
    }
  };

  const reprintSettlement = (paymentId: string) => {
    const pay = teacherPayments.find((p) => p.id === paymentId);
    const t = pay ? teachers.find((x) => x.id === pay.teacherId) : undefined;
    if (!pay || !t) return;
    printHtmlDocument(
      buildTeacherSettlementReceipt({
        teacher: t,
        school,
        lang: language,
        amount: pay.amount,
        method: pay.method,
        percentage: pay.percentage,
        details: Array.isArray(pay.details) ? pay.details : [],
        paidAt: pay.paidAt,
        receiptNo: `PAY-${pay.id.slice(0, 8).toUpperCase()}`,
      }),
    );
  };

  /** Creates a login-less "enseignant passager" straight from this page. */
  const handleCreatePassager = async () => {
    if (!firstName.trim()) {
      alert("Le nom de l'enseignant passager est obligatoire.");
      return;
    }
    const newTeacher: Teacher = {
      id: uid("tch"),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone,
      email: "",
      paymentType: "percentage",
      isPassager: true,
    };
    // teachers is auth-linked in the store (creation normally goes through
    // /api/admin/users), so a login-less passager is inserted directly.
    const supabase = createClient();
    const { error } = await supabase.from("teachers").insert({
      id: newTeacher.id,
      first_name: newTeacher.firstName,
      last_name: newTeacher.lastName,
      phone: newTeacher.phone,
      email: null,
      payment_type: "percentage",
      is_passager: true,
    });
    if (error) {
      alert(`Impossible d'enregistrer l'enseignant passager : ${error.message}`);
      return;
    }
    push("teachers", newTeacher);
    setIsPassagerCreateOpen(false);
    resetForm();
  };

  // Get months between startDate and now
  const getUnpaidMonthsList = (teacher: Teacher) => {
    if (teacher.paymentType !== "monthly" || !teacher.startDate) return [];
    const start = new Date(teacher.startDate);
    const end = new Date();
    const months: { label: string; key: string; amount: number }[] = [];

    const current = new Date(start.getFullYear(), start.getMonth(), 1);
    while (current <= end) {
      const monthLabel = current.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
      const monthKey = `${String(current.getMonth() + 1).padStart(2, "0")}/${current.getFullYear()}`;

      // Check if cash database has a record for this teacher and this month
      const paymentExists = cash.some(
        (c) =>
          c.type === "teacher_payment" &&
          c.description.includes(teacher.lastName) &&
          c.description.includes(monthKey)
      );

      if (!paymentExists) {
        months.push({
          label: monthLabel,
          key: monthKey,
          amount: teacher.monthlyAmount ?? 0,
        });
      }

      current.setMonth(current.getMonth() + 1);
    }

    return months;
  };

  const handleCreateTeacher = async () => {
    if (!firstName || !lastName || !phone || !email) {
      alert("Veuillez remplir tous les champs obligatoires.");
      return;
    }
    if (password.length < 6) {
      alert("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }

    try {
      const { id: teacherId } = await createRoleUser({
        role: "teacher",
        email,
        password,
        firstName,
        lastName,
        phone,
        paymentType,
        ...(paymentType === "monthly" ? { monthlyAmount, startDate } : { percentage }),
      });

      const newTeacher: Teacher = {
        id: teacherId,
        firstName,
        lastName,
        phone,
        email,
        paymentType,
        ...(paymentType === "monthly" ? { monthlyAmount, startDate } : { percentage }),
      };
      push("teachers", newTeacher);

      setIsCreateOpen(false);
      resetForm();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur lors de la création du compte.");
    }
  };

  const handleEditTeacher = async () => {
    if (!selectedTeacher) return;

    if (password) {
      try {
        await resetUserPassword(selectedTeacher.id, password);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Erreur lors du changement de mot de passe.");
        return;
      }
    }

    updateItem("teachers", selectedTeacher.id, {
      firstName,
      lastName,
      phone,
      email,
      paymentType,
      monthlyAmount: paymentType === "monthly" ? monthlyAmount : undefined,
      startDate: paymentType === "monthly" ? startDate : undefined,
      percentage: paymentType === "percentage" ? percentage : undefined,
    });
    setIsEditOpen(false);
    resetForm();
  };

  const handleDelete = (id: string) => {
    if (confirm("Êtes-vous sûr de vouloir supprimer cet enseignant ?")) {
      deleteFrom("teachers", id);
      setActiveMenuId(null);
    }
  };

  const handleCreateAcompte = () => {
    if (!selectedTeacher || amount <= 0) return;
    push("acomptes", {
      id: uid("ac"),
      teacherId: selectedTeacher.id,
      amount,
      description: description || "Avance sur salaire",
      date: actionDate,
    });

    // Deduct directly from cash register
    push("cash", {
      id: uid("csh"),
      type: "acompte",
      amount: -amount,
      date: new Date().toISOString(),
      description: `Acompte versé à ${selectedTeacher.firstName} ${selectedTeacher.lastName} (${description || "Acompte"})`,
    });

    setIsAcompteOpen(false);
    setAmount(0);
    setDescription("");
  };

  const handleCreateAbsence = () => {
    if (!selectedTeacher || amount <= 0) return;
    push("absences", {
      id: uid("ab"),
      teacherId: selectedTeacher.id,
      cost: amount,
      description: description || "Absence non justifiée",
      date: actionDate,
    });

    setIsAbsenceOpen(false);
    setAmount(0);
    setDescription("");
  };

  const handlePaymentSubmit = async (monthKey?: string) => {
    if (!selectedTeacher) return;

    if (selectedTeacher.paymentType === "percentage") {
      // Atomic settlement server-side (settle_teacher_percentage RPC): marks
      // every unpaid séance as paid, consumes acomptes/absences and writes
      // the cash movement in a single transaction.
      const res = await settleTeacherPercentage(selectedTeacher.id);
      if (!res.ok) {
        alert(
          res.messageKey === "pay.nothingDue"
            ? `Le solde net à payer est inférieur ou égal à 0 DA (net: ${res.net ?? 0} DA).`
            : "Le paiement a échoué — veuillez réessayer."
        );
        return;
      }
      alert(
        `Paiement validé : ${res.net} DA versés (${res.sessions} présence(s), brut ${res.gross} DA, acomptes -${res.acomptes} DA, absences -${res.absences} DA).`
      );
    } else {
      // Monthly payment
      if (!monthKey) return;
      const netAmount = selectedTeacher.monthlyAmount ?? 0;

      // Record in cash register with month signature
      push("cash", {
        id: uid("csh"),
        type: "teacher_payment",
        amount: -netAmount,
        date: new Date().toISOString(),
        description: `Salaire mensuel ${selectedTeacher.firstName} ${selectedTeacher.lastName} - ${monthKey}`,
      });
    }

    setIsPayOpen(false);
    setIsUnpaidDetailOpen(false);
  };

  const handlePrintTeacherReport = () => {
    if (!selectedTeacher) return;
    printHtmlDocument(
      buildTeacherPaymentReport({
        teacher: selectedTeacher,
        school,
        lang: language,
        startDate: printStart,
        endDate: printEnd,
        sessions,
        attendance,
        unpaidTeacher,
        modules,
        groups,
        classes,
      }),
    );
    setIsPrintOpen(false);
  };

  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setPhone("");
    setEmail("");
    setPassword("");
    setPaymentType("percentage");
    setMonthlyAmount(0);
    setPercentage(50);
    setSelectedTeacher(null);
  };

  const openEdit = (t: Teacher) => {
    setSelectedTeacher(t);
    setFirstName(t.firstName);
    setLastName(t.lastName);
    setPhone(t.phone);
    setEmail(t.email);
    setPassword("");
    setPaymentType(t.paymentType);
    if (t.paymentType === "monthly") {
      setMonthlyAmount(t.monthlyAmount || 0);
      setStartDate(t.startDate || "");
    } else {
      setPercentage(t.percentage || 50);
    }
    setIsEditOpen(true);
    setActiveMenuId(null);
  };

  const openDetails = (t: Teacher) => {
    setSelectedTeacher(t);
    setDetailsTab("info");
    setSessionFilter("all");
    setIsDetailsOpen(true);
    setActiveMenuId(null);
  };

  const openAcompte = (t: Teacher) => {
    setSelectedTeacher(t);
    setAmount(0);
    setDescription("Avance sur salaire");
    setIsAcompteOpen(true);
    setActiveMenuId(null);
  };

  const openAbsence = (t: Teacher) => {
    setSelectedTeacher(t);
    setAmount(0);
    setDescription("Absence non justifiée");
    setIsAbsenceOpen(true);
    setActiveMenuId(null);
  };

  const openPay = (t: Teacher) => {
    setSelectedTeacher(t);
    setIsPayOpen(true);
    setActiveMenuId(null);
  };

  const openPrint = (t: Teacher) => {
    setSelectedTeacher(t);
    setPrintStart("");
    setPrintEnd("");
    setIsPrintOpen(true);
    setActiveMenuId(null);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <PageHeader emoji="👨‍🏫" title="Enseignants" subtitle="Gérer le corps enseignant et leurs salaires" />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => { resetForm(); setIsPassagerCreateOpen(true); }}
            className="flex items-center gap-2 border-warning/30 text-warning hover:bg-warning/10"
          >
            <Plus className="h-4 w-4" /> Enseignant Passager
          </Button>
          <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> Nouvel Enseignant
          </Button>
        </div>
      </div>

      {/* Search + kind filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6 bg-surface border border-line p-3 rounded-2xl">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <Input
            value={teacherSearch}
            onChange={(e) => setTeacherSearch(e.target.value)}
            placeholder="Rechercher un enseignant (nom, téléphone, email)..."
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          {([
            { key: "all", label: `Tous (${teachers.length})` },
            { key: "staff", label: `École (${teachers.filter((t) => !t.isPassager).length})` },
            { key: "passager", label: `Passagers (${teachers.filter((t) => t.isPassager).length})` },
          ] as const).map((k) => (
            <button
              key={k.key}
              onClick={() => setTeacherKind(k.key)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                teacherKind === k.key ? "bg-primary text-white shadow-sm" : "bg-canvas text-muted hover:text-ink"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of teachers */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {teachers
          .filter((t) => {
            if (teacherKind === "staff" && t.isPassager) return false;
            if (teacherKind === "passager" && !t.isPassager) return false;
            if (!teacherSearch.trim()) return true;
            return `${t.firstName} ${t.lastName} ${t.phone} ${t.email}`
              .toLowerCase()
              .includes(teacherSearch.toLowerCase());
          })
          .map((t) => {
          const unpaidSess = getTeacherUnpaidSessions(t.id);
          const unpaidMonths = getUnpaidMonthsList(t);
          const unpaidTimingsCount = buildUnpaidTimings(t.id).length;

          return (
            <Card
              key={t.id}
              className={`relative transition-all duration-300 ${
                activeMenuId === t.id
                  ? "z-30 scale-[1.02] ring-2 ring-primary/45 shadow-2xl"
                  : "z-10 hover:z-20 hover:shadow-lg hover:-translate-y-0.5 border border-line"
              }`}
            >
              <CardBody className="flex flex-col justify-between min-h-[220px] relative p-5">
                {/* Actions overlay panel */}
                {activeMenuId === t.id && (
                  <div className="absolute inset-0 bg-surface/98 backdrop-blur-md rounded-2xl p-4 flex flex-col justify-between z-20 animate-in fade-in zoom-in-95 duration-200 border border-primary/20">
                    <div className="flex justify-between items-center border-b border-line pb-2">
                      <span className="font-bold text-[10px] text-muted uppercase tracking-wider">
                        Actions: {t.firstName} {t.lastName}
                      </span>
                      <button
                        onClick={() => setActiveMenuId(null)}
                        className="p-1 rounded-lg hover:bg-canvas text-muted hover:text-ink transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {/* A "passager" has no account and no contract with the
                        school: only the two actions the brief asks for. */}
                    <div className="grid grid-cols-2 gap-2 my-2 flex-1 items-center">
                      <button
                        onClick={() => openDetails(t)}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                      >
                        <Eye className="h-3.5 w-3.5" /> Détails
                      </button>
                      <button
                        onClick={() => (t.isPassager ? openTimingPay(t) : openPay(t))}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-success/15 text-success border border-success/30 hover:bg-success/25 transition-colors"
                      >
                        <DollarSign className="h-3.5 w-3.5" /> Payer
                      </button>
                      {!t.isPassager && (
                        <>
                          <button
                            onClick={() => openAcompte(t)}
                            className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                          >
                            <Plus className="h-3.5 w-3.5" /> Acompte
                          </button>
                          <button
                            onClick={() => openAbsence(t)}
                            className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25 transition-colors"
                          >
                            <Plus className="h-3.5 w-3.5" /> Absence
                          </button>
                          <button
                            onClick={() => openPrint(t)}
                            className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                          >
                            <Printer className="h-3.5 w-3.5" /> Rapport
                          </button>
                          <button
                            onClick={() => openEdit(t)}
                            className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                          >
                            <Edit className="h-3.5 w-3.5" /> Modifier
                          </button>
                        </>
                      )}
                    </div>

                    <div className="border-t border-line pt-2">
                      <button
                        onClick={() => handleDelete(t.id)}
                        className="flex items-center justify-center gap-1.5 w-full py-2 px-3 text-xs font-bold rounded-xl bg-danger text-white hover:bg-danger/90 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Supprimer
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 border border-primary/20 text-primary font-bold text-xs flex items-center justify-center tracking-wider shrink-0">
                        {t.firstName.charAt(0).toUpperCase()}{t.lastName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-ink hover:text-primary transition-colors truncate">
                          {t.firstName} {t.lastName}
                        </h4>
                        <span className="text-[10px] text-muted block font-mono truncate">{t.phone || "—"}</span>
                        {t.isPassager && (
                          <Badge tone="warning" className="text-[9px] px-1.5 py-0 mt-0.5">Passager</Badge>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => setActiveMenuId(activeMenuId === t.id ? null : t.id)}
                      className="p-1.5 rounded-lg hover:bg-primary-50 text-muted hover:text-ink transition-colors shrink-0"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-xs bg-canvas/30 border border-line/60 rounded-xl p-2.5">
                      <div>
                        <span className="text-[10px] text-muted block uppercase font-semibold">Contrat</span>
                        <span className="font-semibold text-ink">
                          {t.isPassager ? "À la séance" : t.paymentType === "monthly" ? "Fixe Mensuel" : "Pourcentage"}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-muted block uppercase font-semibold">Rémunération</span>
                        <span className="font-bold text-primary">
                          {t.isPassager
                            ? "Montant / %"
                            : t.paymentType === "monthly"
                              ? `${t.monthlyAmount} DA/m`
                              : `${t.percentage}% / élève`}
                        </span>
                      </div>
                    </div>

                    {t.isPassager ? (
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl flex flex-col justify-between">
                          <span className="text-muted block text-[9px] uppercase">Créneaux non payés</span>
                          <strong className="text-warning mt-0.5">{unpaidTimingsCount}</strong>
                        </div>
                        <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl flex flex-col justify-between">
                          <span className="text-muted block text-[9px] uppercase">Total déjà versé</span>
                          <strong className="text-success mt-0.5">
                            {teacherPayments.filter((p) => p.teacherId === t.id).reduce((s, p) => s + p.amount, 0)} DA
                          </strong>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl flex flex-col justify-between">
                          <span className="text-muted block text-[9px] uppercase">Dernier acompte</span>
                          <strong className="text-ink mt-0.5">{getTeacherAcomptes(t.id).slice(-1)[0]?.amount ?? 0} DA</strong>
                        </div>
                        <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl flex flex-col justify-between">
                          <span className="text-muted block text-[9px] uppercase">Absences (Coût)</span>
                          <strong className="text-danger mt-0.5">
                            {getTeacherAbsences(t.id).length} ({getTeacherAbsences(t.id).reduce((s, a) => s + a.cost, 0)} DA)
                          </strong>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-line/60 pt-3 mt-4 flex items-center justify-between">
                  <span className="text-[10px] text-muted flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${unpaidMonths.length > 0 || unpaidSess.length > 0 ? "bg-warning animate-pulse" : "bg-success"}`} />
                    {t.isPassager
                      ? `${unpaidTimingsCount} créneau(x) dus`
                      : t.paymentType === "monthly"
                        ? `${unpaidMonths.length} mois dus`
                        : `${unpaidSess.length} séances dues`}
                  </span>

                  <Badge tone={unpaidMonths.length > 0 || unpaidSess.length > 0 ? "warning" : "success"} className="font-mono font-bold text-[10px]">
                    {t.isPassager
                      ? `${unpaidSess.length} présence(s)`
                      : t.paymentType === "monthly"
                        ? `${unpaidMonths.length * (t.monthlyAmount ?? 0)} DA`
                        : `${unpaidSess.reduce((sum, s) => sum + s.amount, 0)} DA`}
                  </Badge>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/* Creation Modal */}
      <Modal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Créer un enseignant" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Prénom *</label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Nom *</label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Téléphone *</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+213 5XX XX XX XX" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Email (Login) *</label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@ecole.com" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Mot de passe *</label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6 caractères min." />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Type de rémunération</label>
            <Select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as "monthly" | "percentage")}
              className="w-full"
            >
              <option value="percentage">Pourcentage par élève/présence</option>
              <option value="monthly">Fixe mensuel</option>
            </Select>
          </div>

          {paymentType === "monthly" ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Montant mensuel (DA)</label>
                <Input
                  type="number"
                  value={monthlyAmount || ""}
                  onChange={(e) => setMonthlyAmount(Number(e.target.value))}
                  placeholder="Ex: 45000"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Date de début de contrat</label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Pourcentage par séance (%)</label>
              <Input
                type="number"
                value={percentage || ""}
                onChange={(e) => setPercentage(Number(e.target.value))}
                placeholder="Ex: 55"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleCreateTeacher}>Créer</Button>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Modifier l'enseignant" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Prénom</label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Nom</label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Téléphone</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Email</label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Nouveau mot de passe</label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Laisser vide pour ne pas changer" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Type de rémunération</label>
            <Select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as "monthly" | "percentage")}
              className="w-full"
            >
              <option value="percentage">Pourcentage</option>
              <option value="monthly">Fixe mensuel</option>
            </Select>
          </div>
          {paymentType === "monthly" ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Salaire mensuel (DA)</label>
                <Input
                  type="number"
                  value={monthlyAmount || ""}
                  onChange={(e) => setMonthlyAmount(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Date début</label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Pourcentage (%)</label>
              <Input
                type="number"
                value={percentage || ""}
                onChange={(e) => setPercentage(Number(e.target.value))}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsEditOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleEditTeacher}>Enregistrer</Button>
        </div>
      </Modal>

      {/* Details Modal */}
      <Modal open={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Détails de l'Enseignant" wide>
        {selectedTeacher && (
          <div className="space-y-5">
            {/* Header info */}
            <div className="bg-canvas border border-line p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-primary/10 border border-primary/20 text-primary font-bold text-sm flex items-center justify-center tracking-wider">
                  {selectedTeacher.firstName.charAt(0).toUpperCase()}{selectedTeacher.lastName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-bold text-base text-ink">{selectedTeacher.firstName} {selectedTeacher.lastName}</h3>
                  <span className="text-xs text-muted block">Téléphone: {selectedTeacher.phone} | Email: {selectedTeacher.email}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selectedTeacher.isPassager && (
                  <Badge tone="warning" className="text-xs px-3 py-1 font-bold">Enseignant passager</Badge>
                )}
                <Badge tone="primary" className="text-xs px-3 py-1 font-bold">
                  {selectedTeacher.isPassager
                    ? "Réglé à la séance"
                    : selectedTeacher.paymentType === "monthly"
                      ? `Salaire Fixe: ${selectedTeacher.monthlyAmount} DA / mois`
                      : `Rémunération: ${selectedTeacher.percentage}% / séance`}
                </Badge>
              </div>
            </div>

            {/* -------------------------------------------------------------- */}
            {/* Passager: a dedicated, complete file (history + payments)       */}
            {/* -------------------------------------------------------------- */}
            {selectedTeacher.isPassager && (() => {
              const myTimings = sessions.filter((s) => s.teacherId === selectedTeacher.id);
              const myTimingIds = new Set(myTimings.map((s) => s.id));
              const myDues = unpaidTeacher.filter((u) => u.teacherId === selectedTeacher.id);
              const myPassagerAttendees = independent.filter(
                (ind) => ind.sessionId && myTimingIds.has(ind.sessionId) && !ind.studentId,
              );
              const myPayments = teacherPayments
                .filter((p) => p.teacherId === selectedTeacher.id)
                .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
              const distinctStudents = new Set(myDues.map((u) => u.studentId)).size;
              const unpaidList = buildUnpaidTimings(selectedTeacher.id);
              const revenueGenerated = attendance
                .filter((a) => myTimingIds.has(a.sessionId))
                .reduce((s, a) => s + a.amountDeducted, 0)
                + myPassagerAttendees.reduce((s, i) => s + i.price, 0);
              // Séances offertes: nothing was cashed, nothing is owed to him —
              // but the school still wants to see what it gave away.
              const offeredSeances = myPassagerAttendees.filter((i) => i.isFree);
              const offeredValue = offeredSeances.reduce((s, i) => s + (i.waivedAmount ?? 0), 0);

              // One line per (date, timing) actually held, paid or not.
              const heldTimings = new Map<string, { dateKey: string; sessionId: string; presents: number; passagers: number; offered: number; revenue: number; waived: number; paid: boolean }>();
              const emptyRow = (dateKey: string, sessionId: string) => ({
                dateKey, sessionId, presents: 0, passagers: 0, offered: 0, revenue: 0, waived: 0, paid: true,
              });
              attendance.forEach((a) => {
                if (!myTimingIds.has(a.sessionId)) return;
                const dateKey = new Date(a.timestamp).toLocaleDateString("fr-CA");
                const key = `${dateKey}|${a.sessionId}`;
                const row = heldTimings.get(key) ?? emptyRow(dateKey, a.sessionId);
                row.presents += 1;
                row.revenue += a.amountDeducted;
                heldTimings.set(key, row);
              });
              myPassagerAttendees.forEach((ind) => {
                const key = `${ind.date}|${ind.sessionId}`;
                const row = heldTimings.get(key) ?? emptyRow(ind.date, ind.sessionId!);
                row.presents += 1;
                row.passagers += 1;
                row.revenue += ind.price;
                if (ind.isFree) {
                  row.offered += 1;
                  row.waived += ind.waivedAmount ?? 0;
                }
                heldTimings.set(key, row);
              });
              myDues.forEach((u) => {
                const dateKey = new Date(u.date).toLocaleDateString("fr-CA");
                const row = heldTimings.get(`${dateKey}|${u.sessionId}`);
                if (row && !u.paid) row.paid = false;
              });
              myPassagerAttendees.forEach((ind) => {
                if (ind.isFree) return; // offerte: rien n'est dû à l'enseignant
                const row = heldTimings.get(`${ind.date}|${ind.sessionId}`);
                if (row && !ind.teacherPaid) row.paid = false;
              });
              const heldList = [...heldTimings.values()].sort((a, b) => b.dateKey.localeCompare(a.dateKey));

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold">Créneaux animés</span>
                      <strong className="text-ink text-base font-mono">{myTimings.length}</strong>
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold">Élèves suivis</span>
                      <strong className="text-primary text-base font-mono">{distinctStudents}</strong>
                      <span className="text-[9px] text-muted block">+ {myPassagerAttendees.length} passager(s)</span>
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold">Recette générée</span>
                      <strong className="text-success text-base font-mono">{revenueGenerated} DA</strong>
                      {offeredSeances.length > 0 && (
                        <span className="text-[9px] text-warning block">
                          {offeredSeances.length} offerte(s) · {offeredValue} DA
                        </span>
                      )}
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold">Total versé</span>
                      <strong className="text-success text-base font-mono">
                        {myPayments.reduce((s, p) => s + p.amount, 0)} DA
                      </strong>
                      <span className="text-[9px] text-warning block">{unpaidList.length} créneau(x) dus</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Séance libre history */}
                    <div className="border border-line rounded-2xl p-4 bg-surface">
                      <h4 className="font-bold text-ink mb-3 text-xs uppercase tracking-wider text-muted">
                        🎯 Historique des séances libres
                      </h4>
                      {heldList.length === 0 ? (
                        <p className="text-xs text-muted italic text-center py-6">Aucune séance tenue pour le moment.</p>
                      ) : (
                        <div className="max-h-60 overflow-y-auto">
                          <table className="w-full text-xs text-left">
                            <thead>
                              <tr className="text-[10px] uppercase text-muted font-bold border-b border-line">
                                <th className="py-1.5">Date</th>
                                <th className="py-1.5">Créneau</th>
                                <th className="py-1.5 text-center">Présents</th>
                                <th className="py-1.5 text-right">Recette</th>
                                <th className="py-1.5 text-right">Statut</th>
                              </tr>
                            </thead>
                            <tbody>
                              {heldList.map((r) => {
                                const sess = sessions.find((s) => s.id === r.sessionId);
                                return (
                                  <tr key={`${r.dateKey}-${r.sessionId}`} className="border-b border-line/50 last:border-0">
                                    <td className="py-1.5 font-mono text-[10px]">{formatDateFr(r.dateKey)}</td>
                                    <td className="py-1.5">
                                      <span className="text-ink block truncate max-w-[160px]">
                                        {sess?.title || modules.find((m) => m.id === sess?.moduleId)?.name || "Séance"}
                                      </span>
                                      <span className="text-[9px] text-muted font-mono">
                                        {sess?.startTime} - {sess?.endTime}
                                      </span>
                                    </td>
                                    <td className="py-1.5 text-center">
                                      <strong>{r.presents}</strong>
                                      {r.passagers > 0 && (
                                        <span className="text-[9px] text-warning block">{r.passagers} pass.</span>
                                      )}
                                    </td>
                                    <td className="py-1.5 text-right font-mono">
                                      {r.revenue} DA
                                      {r.waived > 0 && (
                                        <span className="text-[9px] text-warning block">offert: {r.waived} DA</span>
                                      )}
                                    </td>
                                    <td className="py-1.5 text-right">
                                      <Badge tone={r.paid ? "success" : "warning"} className="text-[9px]">
                                        {r.paid ? "Payé" : "Dû"}
                                      </Badge>
                                      {r.offered > 0 && (
                                        <Badge tone="neutral" className="text-[9px] mt-0.5">
                                          {r.offered} offerte(s)
                                        </Badge>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Payments history */}
                    <div className="border border-line rounded-2xl p-4 bg-surface">
                      <h4 className="font-bold text-ink mb-3 text-xs uppercase tracking-wider text-muted">
                        💸 Historique des règlements
                      </h4>
                      {myPayments.length === 0 ? (
                        <p className="text-xs text-muted italic text-center py-6">Aucun règlement enregistré.</p>
                      ) : (
                        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                          {myPayments.map((p) => (
                            <div
                              key={p.id}
                              className="flex items-center justify-between gap-3 p-3 rounded-xl border border-success/20 bg-success/5 text-xs"
                            >
                              <div className="min-w-0">
                                <span className="font-bold text-ink block">
                                  {p.amount} DA
                                  <Badge tone={p.method === "percent" ? "primary" : "neutral"} className="ml-1.5 text-[9px]">
                                    {p.method === "percent" ? `${p.percentage ?? 0}%` : "Montant fixe"}
                                  </Badge>
                                </span>
                                <span className="text-[10px] text-muted block">
                                  {p.sessionsCount} créneau(x) ·{" "}
                                  {new Date(p.paidAt).toLocaleString("fr-DZ", {
                                    day: "2-digit", month: "2-digit", year: "numeric",
                                    hour: "2-digit", minute: "2-digit",
                                  })}
                                </span>
                              </div>
                              <button
                                onClick={() => reprintSettlement(p.id)}
                                className="p-1.5 rounded-lg hover:bg-primary-50 text-primary shrink-0"
                                title="Réimprimer le bon"
                              >
                                <Printer className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Timings he is attached to — days of the week included */}
                  <div className="border border-line rounded-2xl p-4 bg-surface">
                    <h4 className="font-bold text-ink mb-3 text-xs uppercase tracking-wider text-muted">
                      📅 Emplois du temps affectés
                    </h4>
                    {myTimings.length === 0 ? (
                      <p className="text-xs text-muted italic text-center py-6">Aucun créneau affecté.</p>
                    ) : (
                      <>
                        {renderTimingRecap(myTimings)}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {myTimings.map((s) => renderTimingCard(s))}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex justify-between items-center pt-3 border-t border-line">
                    <Button
                      onClick={() => { setIsDetailsOpen(false); openTimingPay(selectedTeacher); }}
                      className="flex items-center gap-2"
                    >
                      <DollarSign className="h-4 w-4" /> Payer ses séances ({unpaidList.length})
                    </Button>
                    <Button variant="outline" onClick={() => setIsDetailsOpen(false)}>Fermer</Button>
                  </div>
                </div>
              );
            })()}

            {/* Modal Tabs navigation — school teachers only; a passager has his
                own single-page file above. */}
            <div className={`flex border-b border-line gap-1.5 pb-0.5 ${selectedTeacher.isPassager ? "hidden" : ""}`}>
              <button
                onClick={() => setDetailsTab("info")}
                className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-colors border-b-2 -mb-0.5 ${
                  detailsTab === "info"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted hover:text-ink hover:bg-canvas/50"
                }`}
              >
                📅 Emploi du Temps
              </button>
              <button
                onClick={() => setDetailsTab("finance")}
                className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-colors border-b-2 -mb-0.5 ${
                  detailsTab === "finance"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted hover:text-ink hover:bg-canvas/50"
                }`}
              >
                💸 Historique Financier
              </button>
              <button
                onClick={() => setDetailsTab("sessions")}
                className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-colors border-b-2 -mb-0.5 ${
                  detailsTab === "sessions"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted hover:text-ink hover:bg-canvas/50"
                }`}
              >
                📊 Historique des Séances
              </button>
            </div>

            {/* TAB CONTENT: Info / Schedule */}
            {!selectedTeacher.isPassager && detailsTab === "info" && (() => {
              const myTimings = sessions
                .filter((s) => s.teacherId === selectedTeacher.id)
                .sort(
                  (a, b) =>
                    DAYS.findIndex((d) => a.days.includes(d)) - DAYS.findIndex((d) => b.days.includes(d)) ||
                    a.startTime.localeCompare(b.startTime),
                );
              /** The same timings read the other way round: what the teacher
               *  actually does on each day of the week. */
              const byDay = DAYS.map((d) => ({
                day: d,
                items: myTimings
                  .filter((s) => s.days.includes(d))
                  .sort((a, b) => a.startTime.localeCompare(b.startTime)),
              }));

              return (
                <div className="space-y-4">
                  <div className="border border-line rounded-2xl p-4 bg-surface">
                    <h4 className="font-bold text-ink mb-3 flex items-center gap-2 text-xs uppercase tracking-wider text-muted">
                      📅 Emplois du temps affectés
                    </h4>
                    {myTimings.length === 0 ? (
                      <p className="text-xs text-muted italic text-center py-6">Aucune séance programmée pour cet enseignant.</p>
                    ) : (
                      <>
                        {renderTimingRecap(myTimings)}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1">
                          {myTimings.map((s) => renderTimingCard(s))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Week board: the teacher's presence day by day */}
                  {myTimings.length > 0 && (
                    <div className="border border-line rounded-2xl p-4 bg-surface">
                      <h4 className="font-bold text-ink mb-3 flex items-center gap-2 text-xs uppercase tracking-wider text-muted">
                        🗓️ Sa semaine, jour par jour
                      </h4>
                      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                        {byDay.map(({ day, items }) => (
                          <div
                            key={day}
                            className={`rounded-xl border p-2 space-y-1.5 ${
                              items.length > 0 ? "border-primary/25 bg-primary-50/50" : "border-line bg-canvas/30"
                            }`}
                          >
                            <span
                              className={`block text-[10px] font-bold text-center ${
                                items.length > 0 ? "text-primary" : "text-muted"
                              }`}
                            >
                              {DAY_LABELS_FR[day]}
                            </span>
                            {items.length === 0 ? (
                              <span className="block text-center text-[9px] italic text-muted/60">Libre</span>
                            ) : (
                              items.map((s) => (
                                <div
                                  key={`${day}-${s.id}`}
                                  className="rounded-lg border border-line bg-surface px-1.5 py-1 text-[9px]"
                                >
                                  <strong className="block truncate text-ink">{timingLabels(s).title}</strong>
                                  <span className="block font-mono text-muted">
                                    {s.startTime} - {s.endTime}
                                  </span>
                                  <span className="block truncate text-muted">{timingLabels(s).salleName}</span>
                                </div>
                              ))
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* TAB CONTENT: Finance History */}
            {!selectedTeacher.isPassager && detailsTab === "finance" && (() => {
              const teacherAcomptes = getTeacherAcomptes(selectedTeacher.id).map(ac => ({
                id: ac.id,
                type: "acompte" as const,
                title: "Acompte (Avance)",
                amount: ac.amount,
                date: ac.date,
                description: ac.description,
                color: "text-warning bg-warning/5 border-warning/20",
              }));

              const teacherAbsences = getTeacherAbsences(selectedTeacher.id).map(ab => ({
                id: ab.id,
                type: "absence" as const,
                title: "Retenue pour Absence",
                amount: ab.cost,
                date: ab.date,
                description: ab.description,
                color: "text-danger bg-danger/5 border-danger/20",
              }));

              const teacherPayments = cash
                .filter(c => c.type === "teacher_payment" && (c.description.toLowerCase().includes(selectedTeacher.lastName.toLowerCase()) || c.description.toLowerCase().includes(selectedTeacher.firstName.toLowerCase())))
                .map(pay => ({
                  id: pay.id,
                  type: "payment" as const,
                  title: "Règlement de Salaire",
                  amount: Math.abs(pay.amount),
                  date: pay.date.split("T")[0],
                  description: pay.description,
                  color: "text-success bg-success/5 border-success/20",
                }));

              const allFinancialLogs = [...teacherAcomptes, ...teacherAbsences, ...teacherPayments].sort(
                (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
              );

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold">Total Acomptes</span>
                      <strong className="text-warning text-base font-mono">{teacherAcomptes.reduce((s, a) => s + a.amount, 0)} DA</strong>
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold">Total Absences</span>
                      <strong className="text-danger text-base font-mono">{teacherAbsences.reduce((s, a) => s + a.amount, 0)} DA</strong>
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold">Total Payé</span>
                      <strong className="text-success text-base font-mono">{teacherPayments.reduce((s, a) => s + a.amount, 0)} DA</strong>
                    </div>
                  </div>

                  <div className="border border-line rounded-2xl p-4 bg-surface">
                    <h4 className="font-bold text-ink mb-3 text-xs uppercase tracking-wider text-muted">
                      🕒 Journal des transactions financières
                    </h4>
                    {allFinancialLogs.length === 0 ? (
                      <p className="text-xs text-muted italic text-center py-6">Aucun acompte, absence ou paiement enregistré.</p>
                    ) : (
                      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {allFinancialLogs.map((log, index) => (
                          <div
                            key={`${log.id}-${index}`}
                            className={`flex items-center justify-between p-3 rounded-xl border text-xs gap-3 ${log.color}`}
                          >
                            <div className="min-w-0">
                              <span className="font-bold block text-ink">{log.title}</span>
                              <span className="text-[10px] text-muted block truncate mt-0.5">{log.description}</span>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="font-mono font-bold block text-sm">
                                {log.type === "absence" ? "-" : ""}{log.amount} DA
                              </span>
                              <span className="text-[9px] text-muted block font-mono">{log.date}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* TAB CONTENT: Sessions History */}
            {!selectedTeacher.isPassager && detailsTab === "sessions" && (() => {
              const allTeacherSessions = unpaidTeacher.filter((u) => u.teacherId === selectedTeacher.id);
              const unpaidSessions = allTeacherSessions.filter((u) => !u.paid);
              const paidSessions = allTeacherSessions.filter((u) => u.paid);

              const filteredSessionsList = allTeacherSessions.filter((u) => {
                if (sessionFilter === "paid") return u.paid;
                if (sessionFilter === "unpaid") return !u.paid;
                return true;
              }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-canvas border border-line p-3 rounded-xl flex items-center justify-between">
                      <div>
                        <span className="text-muted text-[10px] uppercase block font-semibold">Total Séances</span>
                        <strong className="text-ink text-base font-mono">{allTeacherSessions.length}</strong>
                      </div>
                      <Badge tone="primary">Toutes</Badge>
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl flex items-center justify-between">
                      <div>
                        <span className="text-muted text-[10px] uppercase block font-semibold">Réglées / Payées</span>
                        <strong className="text-success text-base font-mono">{paidSessions.length}</strong>
                      </div>
                      <Badge tone="success">Payé</Badge>
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl flex items-center justify-between">
                      <div>
                        <span className="text-muted text-[10px] uppercase block font-semibold">En attente</span>
                        <strong className="text-warning text-base font-mono">{unpaidSessions.length}</strong>
                      </div>
                      <Badge tone="warning">Dues ({unpaidSessions.reduce((s, a) => s + a.amount, 0)} DA)</Badge>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={sessionFilter === "all" ? "primary" : "outline"}
                      onClick={() => setSessionFilter("all")}
                    >
                      Toutes ({allTeacherSessions.length})
                    </Button>
                    <Button
                      size="sm"
                      variant={sessionFilter === "paid" ? "primary" : "outline"}
                      onClick={() => setSessionFilter("paid")}
                    >
                      Payées ({paidSessions.length})
                    </Button>
                    <Button
                      size="sm"
                      variant={sessionFilter === "unpaid" ? "primary" : "outline"}
                      onClick={() => setSessionFilter("unpaid")}
                    >
                      Dues ({unpaidSessions.length})
                    </Button>
                  </div>

                  <div className="border border-line rounded-2xl overflow-hidden bg-surface">
                    <div className="max-h-60 overflow-y-auto">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead>
                          <tr className="bg-canvas border-b border-line text-[10px] text-muted uppercase font-bold tracking-wider">
                            <th className="p-3">Date</th>
                            <th className="p-3">Module / Groupe</th>
                            <th className="p-3">Montant Dû</th>
                            <th className="p-3 text-right">Statut</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredSessionsList.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="p-6 text-center text-muted italic">Aucune séance enregistrée pour cet enseignant.</td>
                            </tr>
                          ) : (
                            filteredSessionsList.map((u) => {
                              const moduleName = modules.find((m) => m.id === sessions.find((s) => s.id === u.sessionId)?.moduleId)?.name || "Séance";
                              const groupName = groups.find((g) => g.id === sessions.find((s) => s.id === u.sessionId)?.groupId)?.name || "Groupe";

                              return (
                                <tr key={u.id} className="border-b border-line last:border-0 hover:bg-canvas/30 transition-colors">
                                  <td className="p-3 font-mono text-[10px] text-ink">{u.date}</td>
                                  <td className="p-3">
                                    <span className="font-bold text-ink block">{moduleName}</span>
                                    <span className="text-[10px] text-muted">{groupName}</span>
                                  </td>
                                  <td className="p-3 font-bold text-primary font-mono">{u.amount} DA</td>
                                  <td className="p-3 text-right">
                                    <Badge tone={u.paid ? "success" : "warning"} className="font-bold">
                                      {u.paid ? "Payée" : "En attente"}
                                    </Badge>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })()}

            {!selectedTeacher.isPassager && (
              <div className="flex justify-end pt-3 border-t border-line">
                <Button onClick={() => setIsDetailsOpen(false)}>Fermer</Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Acompte Modal */}
      <Modal open={isAcompteOpen} onClose={() => setIsAcompteOpen(false)} title="Enregistrer un acompte">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Montant de l'acompte (DA) *</label>
            <Input
              type="number"
              value={amount || ""}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder="Ex: 5000"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Description / Motif</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Avance" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date</label>
            <Input type="date" value={actionDate} onChange={(e) => setActionDate(e.target.value)} />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsAcompteOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreateAcompte}>Confirmer</Button>
          </div>
        </div>
      </Modal>

      {/* Absence Modal */}
      <Modal open={isAbsenceOpen} onClose={() => setIsAbsenceOpen(false)} title="Signaler une absence / retenue">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Retenue financière (Coût - DA)</label>
            <Input
              type="number"
              value={amount || ""}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder="Ex: 1000"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Motif de l'absence</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Absence non justifiée" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date</label>
            <Input type="date" value={actionDate} onChange={(e) => setActionDate(e.target.value)} />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsAbsenceOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreateAbsence}>Enregistrer</Button>
          </div>
        </div>
      </Modal>

      {/* Salary Payment Settlement Modal */}
      <Modal open={isPayOpen} onClose={() => setIsPayOpen(false)} title="Règlement financier de l'enseignant">
        <div className="space-y-4">
          {selectedTeacher && (
            <>
              <div className="bg-canvas border border-line p-4 rounded-xl text-xs space-y-2">
                <span className="text-[10px] text-muted block uppercase">Contrat</span>
                <strong className="text-ink text-sm block">
                  {selectedTeacher.firstName} {selectedTeacher.lastName}
                </strong>
                <span className="text-muted block">
                  Type: {selectedTeacher.paymentType === "monthly" ? "Fixe Mensuel" : "Au Pourcentage"}
                </span>

                {selectedTeacher.paymentType === "percentage" ? (
                  <>
                    <div className="flex justify-between border-t border-line/50 pt-2 mt-2">
                      <span>Séances impayées accumulées:</span>
                      <strong className="text-ink">{getTeacherUnpaidSessions(selectedTeacher.id).length} séances</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Rémunération séances brute:</span>
                      <strong className="text-primary">
                        {getTeacherUnpaidSessions(selectedTeacher.id).reduce((sum, s) => sum + s.amount, 0)} DA
                      </strong>
                    </div>
                    <div className="flex justify-between text-danger">
                      <span>Déduction Acomptes:</span>
                      <strong>
                        -{getTeacherAcomptes(selectedTeacher.id).reduce((sum, a) => sum + a.amount, 0)} DA
                      </strong>
                    </div>
                    <div className="flex justify-between text-danger">
                      <span>Déduction Absences:</span>
                      <strong>
                        -{getTeacherAbsences(selectedTeacher.id).reduce((sum, ab) => sum + ab.cost, 0)} DA
                      </strong>
                    </div>
                    <div className="flex justify-between border-t border-line pt-2 font-bold text-sm text-success">
                      <span>Net à Payer:</span>
                      <span>
                        {getTeacherUnpaidSessions(selectedTeacher.id).reduce((sum, s) => sum + s.amount, 0) -
                          getTeacherAcomptes(selectedTeacher.id).reduce((sum, a) => sum + a.amount, 0) -
                          getTeacherAbsences(selectedTeacher.id).reduce((sum, ab) => sum + ab.cost, 0)}{" "}
                        DA
                      </span>
                    </div>

                    <div className="pt-4 flex flex-col sm:flex-row justify-end gap-2">
                      <Button variant="outline" onClick={() => setIsUnpaidDetailOpen(true)}>
                        📋 Calculer & voir le détail des séances
                      </Button>
                      <Button onClick={() => handlePaymentSubmit()}>Valider le paiement de séance</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="border-t border-line/50 pt-2 mt-2">
                      <span className="block text-[10px] text-muted uppercase mb-1">Mois impayés</span>
                      {getUnpaidMonthsList(selectedTeacher).length === 0 ? (
                        <p className="text-xs text-success italic font-bold">À jour pour tous les mois.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {getUnpaidMonthsList(selectedTeacher).map((m) => (
                            <div key={m.key} className="flex justify-between items-center p-2 bg-surface border border-line rounded-lg">
                              <div>
                                <span className="font-bold text-ink">{m.label}</span>
                                <span className="text-[10px] text-muted block">{m.amount} DA</span>
                              </div>
                              <Button
                                size="sm"
                                onClick={() => handlePaymentSubmit(m.key)}
                                className="text-xs"
                              >
                                Payer {m.amount} DA
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Unpaid séances calculation detail — every timing, student, hour and amount */}
      <Modal
        open={isUnpaidDetailOpen}
        onClose={() => setIsUnpaidDetailOpen(false)}
        title="Calcul des séances non payées"
        wide
      >
        {selectedTeacher && (() => {
          const detail = buildUnpaidDetail(selectedTeacher.id);
          const totalShare = detail.reduce((s, d) => s + d.totalPayout, 0);
          const totalFees = detail.reduce((s, d) => s + d.totalFees, 0);
          const totalPresences = detail.reduce((s, d) => s + d.students.length, 0);
          const totAcomptes = getTeacherAcomptes(selectedTeacher.id).reduce((s, a) => s + a.amount, 0);
          const totAbsences = getTeacherAbsences(selectedTeacher.id).reduce((s, a) => s + a.cost, 0);
          const net = totalShare - totAcomptes - totAbsences;

          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                  <span className="text-muted text-[10px] uppercase block font-semibold">Séances dues</span>
                  <strong className="text-ink text-base font-mono">{detail.length}</strong>
                </div>
                <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                  <span className="text-muted text-[10px] uppercase block font-semibold">Présences</span>
                  <strong className="text-ink text-base font-mono">{totalPresences}</strong>
                </div>
                <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                  <span className="text-muted text-[10px] uppercase block font-semibold">Revenu élèves</span>
                  <strong className="text-success text-base font-mono">{totalFees} DA</strong>
                </div>
                <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                  <span className="text-muted text-[10px] uppercase block font-semibold">Part enseignant</span>
                  <strong className="text-primary text-base font-mono">{totalShare} DA</strong>
                </div>
              </div>

              {detail.length === 0 ? (
                <p className="text-xs text-muted italic text-center py-6">
                  Aucune séance non payée pour cet enseignant.
                </p>
              ) : (
                <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
                  {detail.map((d) => (
                    <div key={`${d.dateKey}_${d.sessionId}`} className="border border-line rounded-2xl bg-canvas/20 p-3">
                      <div className="flex flex-wrap justify-between items-center gap-2 border-b border-line pb-2 mb-2 text-xs">
                        <div>
                          <strong className="text-ink block text-sm">
                            📅 {new Date(`${d.dateKey}T12:00:00`).toLocaleDateString("fr-FR")} — {d.moduleName}
                          </strong>
                          <span className="text-muted">
                            {d.className} | Groupe: {d.groupName} |{" "}
                            <span className="font-mono">{d.startTime} - {d.endTime}</span>
                          </span>
                        </div>
                        <Badge tone="primary" className="font-mono font-bold">+{d.totalPayout} DA</Badge>
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-[10px] uppercase text-muted font-bold text-left">
                            <th className="py-1">Élève</th>
                            <th className="py-1">Heure</th>
                            <th className="py-1">Statut</th>
                            <th className="py-1 text-right">Tarif élève</th>
                            <th className="py-1 text-right">Part prof ({selectedTeacher.percentage ?? 0}%)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.students.map((st, i) => (
                            <tr key={i} className="border-t border-line/50">
                              <td className="py-1.5 font-semibold text-ink">{st.name}</td>
                              <td className="py-1.5 font-mono">{st.time}</td>
                              <td className="py-1.5">
                                <Badge tone={st.status === "En Retard" ? "warning" : "success"} className="text-[9px]">
                                  {st.status}
                                </Badge>
                              </td>
                              <td className="py-1.5 text-right font-mono">{st.fee} DA</td>
                              <td className="py-1.5 text-right font-mono font-bold text-primary">{st.share} DA</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-canvas border border-line rounded-2xl p-3 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span>Part enseignant brute ({detail.length} séance(s), {totalPresences} présence(s)) :</span>
                  <strong className="text-primary">{totalShare} DA</strong>
                </div>
                <div className="flex justify-between text-danger">
                  <span>Acomptes à déduire :</span>
                  <strong>-{totAcomptes} DA</strong>
                </div>
                <div className="flex justify-between text-danger">
                  <span>Retenues d'absences :</span>
                  <strong>-{totAbsences} DA</strong>
                </div>
                <div className="flex justify-between border-t border-line pt-1.5 font-bold text-sm text-success">
                  <span>NET À PAYER :</span>
                  <span>{net} DA</span>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsUnpaidDetailOpen(false)}>Fermer</Button>
                <Button onClick={() => handlePaymentSubmit()} disabled={net <= 0}>
                  Payer {net} DA maintenant
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ---------------------------------------------------------------- */}
      {/* Create an "enseignant passager" (no login, paid per timing)       */}
      {/* ---------------------------------------------------------------- */}
      <Modal open={isPassagerCreateOpen} onClose={() => setIsPassagerCreateOpen(false)} title="Nouvel enseignant passager">
        <div className="space-y-4">
          <div className="bg-warning/10 border border-warning/20 rounded-xl p-3 text-[11px] text-muted leading-relaxed">
            Un <strong className="text-warning">enseignant passager</strong> intervient ponctuellement sur des
            séances libres. Il n&apos;a <strong>pas de compte de connexion</strong> et n&apos;apparaît qu&apos;avec
            les actions <strong>Payer</strong> et <strong>Détails</strong>.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Prénom *</label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Nom</label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-muted mb-1">Téléphone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+213 5XX XX XX XX" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t border-line">
            <Button variant="outline" onClick={() => setIsPassagerCreateOpen(false)}>Annuler</Button>
            <Button onClick={handleCreatePassager}>Enregistrer</Button>
          </div>
        </div>
      </Modal>

      {/* ---------------------------------------------------------------- */}
      {/* Per-timing settlement: only UNPAID timings, fixed or percentage   */}
      {/* ---------------------------------------------------------------- */}
      <Modal
        open={isTimingPayOpen}
        onClose={() => setIsTimingPayOpen(false)}
        title="Règlement des séances de l'enseignant"
        wide
      >
        {selectedTeacher && (
          <div className="space-y-4">
            <div className="bg-canvas border border-line rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <strong className="text-ink text-sm block">
                  {selectedTeacher.firstName} {selectedTeacher.lastName}
                </strong>
                <span className="text-[11px] text-muted">
                  {selectedTeacher.isPassager ? "Enseignant passager (sans compte)" : "Enseignant de l'école"}
                  {selectedTeacher.phone ? ` · ${selectedTeacher.phone}` : ""}
                </span>
              </div>
              <div className="flex gap-2">
                <Badge tone="warning" className="font-bold">{payTimings.length} créneau(x) non payé(s)</Badge>
                <Badge tone="primary" className="font-bold">{chosenPresents} présence(s) sélectionnée(s)</Badge>
              </div>
            </div>

            {payTimings.length === 0 ? (
              <p className="text-xs text-success font-bold text-center py-10 border border-dashed border-line rounded-2xl">
                Tous les créneaux de cet enseignant ont déjà été réglés.
              </p>
            ) : (
              <>
                {/* Summary of what is being paid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                    <span className="text-muted text-[10px] uppercase block font-semibold">Créneaux</span>
                    <strong className="text-ink text-base font-mono">{chosenTimings.length}</strong>
                  </div>
                  <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                    <span className="text-muted text-[10px] uppercase block font-semibold">Élèves présents</span>
                    <strong className="text-ink text-base font-mono">{chosenPresents}</strong>
                  </div>
                  <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                    <span className="text-muted text-[10px] uppercase block font-semibold">Dont passagers</span>
                    <strong className="text-warning text-base font-mono">{chosenPassagers}</strong>
                  </div>
                  <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                    <span className="text-muted text-[10px] uppercase block font-semibold">Montant généré</span>
                    <strong className="text-success text-base font-mono">{chosenRevenue} DA</strong>
                  </div>
                </div>

                {/* Payment method */}
                <div className="rounded-2xl border border-primary/25 bg-primary-50/40 p-4 space-y-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                    Mode de rémunération
                  </span>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPayMethod("fixed")}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        payMethod === "fixed" ? "border-primary bg-primary/10 ring-2 ring-primary/25" : "border-line bg-surface"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <DollarSign className={`h-4 w-4 ${payMethod === "fixed" ? "text-primary" : "text-muted"}`} />
                        <span className="font-bold text-xs text-ink">Montant fixe</span>
                      </div>
                      <span className="text-[10px] text-muted block leading-normal">
                        Vous saisissez directement la somme à verser.
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPayMethod("percent")}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        payMethod === "percent" ? "border-primary bg-primary/10 ring-2 ring-primary/25" : "border-line bg-surface"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Percent className={`h-4 w-4 ${payMethod === "percent" ? "text-primary" : "text-muted"}`} />
                        <span className="font-bold text-xs text-ink">Pourcentage</span>
                      </div>
                      <span className="text-[10px] text-muted block leading-normal">
                        % appliqué au tarif de chaque élève présent — calcul automatique.
                      </span>
                    </button>
                  </div>

                  {payMethod === "fixed" ? (
                    <div>
                      <label className="block text-[10px] font-semibold text-muted mb-1">Montant à verser (DA) *</label>
                      <Input
                        type="number"
                        min={0}
                        value={payFixedAmount || ""}
                        onChange={(e) => setPayFixedAmount(Number(e.target.value))}
                        placeholder="Ex: 4000"
                        className="w-48"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-end gap-4">
                      <div>
                        <label className="block text-[10px] font-semibold text-muted mb-1">
                          Pourcentage par élève / par module (%)
                        </label>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={payPercentage || ""}
                          onChange={(e) => setPayPercentage(Number(e.target.value))}
                          className="w-32"
                        />
                      </div>
                      <div className="pb-1.5 text-xs">
                        <span className="block text-[10px] font-semibold text-muted mb-1">Calcul automatique</span>
                        <strong className="text-primary">
                          {chosenRevenue} DA × {payPercentage}% = {computedPayout} DA
                        </strong>
                      </div>
                    </div>
                  )}
                </div>

                {/* Timings list, each expandable to the students present */}
                <div className="space-y-2 max-h-[38vh] overflow-y-auto pr-1">
                  {payTimings.map((t) => {
                    const checked = selectedTimingKeys.includes(t.key);
                    const expanded = expandedTimingKey === t.key;
                    const groupsInTiming = [...new Set(t.students.map((s) => s.groupName))];
                    const visibleStudents =
                      timingGroupFilter === "all"
                        ? t.students
                        : t.students.filter((s) => s.groupName === timingGroupFilter);
                    return (
                      <div key={t.key} className="border border-line rounded-2xl bg-canvas/20 overflow-hidden">
                        <div className="flex flex-wrap items-center justify-between gap-2 p-3">
                          <label className="flex items-start gap-2.5 min-w-0 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setSelectedTimingKeys(
                                  checked
                                    ? selectedTimingKeys.filter((k) => k !== t.key)
                                    : [...selectedTimingKeys, t.key],
                                )
                              }
                              className="h-4 w-4 mt-0.5 shrink-0"
                            />
                            <span className="min-w-0">
                              <strong className="text-ink block text-xs">
                                📅 {formatDateFr(t.dateKey)} — {t.title}
                                {t.isOpen && <Badge tone="success" className="ml-1.5 text-[9px]">Séance libre</Badge>}
                              </strong>
                              <span className="text-[10px] text-muted block">
                                {t.className} · Gr: {t.groupName} ·{" "}
                                <span className="font-mono">{t.startTime} - {t.endTime}</span>
                              </span>
                            </span>
                          </label>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge tone="primary" className="font-mono font-bold text-[10px]">
                              <Users className="h-3 w-3 inline mr-1" />
                              {t.students.length}
                              {t.passagers > 0 && ` (${t.passagers} pass.)`}
                            </Badge>
                            <Badge tone="success" className="font-mono font-bold text-[10px]">{t.totalFees} DA</Badge>
                            {checked && (
                              <Badge tone="warning" className="font-mono font-bold text-[10px]">
                                → {shareForTiming(t)} DA
                              </Badge>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setExpandedTimingKey(expanded ? null : t.key)}
                            >
                              {expanded ? "Masquer" : "Détails élèves"}
                            </Button>
                          </div>
                        </div>

                        {expanded && (
                          <div className="border-t border-line bg-surface p-3 space-y-2">
                            {/* Filter the presence list by group */}
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[10px] uppercase font-bold text-muted mr-1">Filtrer :</span>
                              {["all", ...groupsInTiming].map((g) => (
                                <button
                                  key={g}
                                  onClick={() => setTimingGroupFilter(g)}
                                  className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                                    timingGroupFilter === g ? "bg-primary text-white" : "bg-canvas text-muted hover:text-ink"
                                  }`}
                                >
                                  {g === "all" ? `Tous (${t.students.length})` : `${g} (${t.students.filter((s) => s.groupName === g).length})`}
                                </button>
                              ))}
                            </div>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-[10px] uppercase text-muted font-bold text-left">
                                  <th className="py-1">Élève</th>
                                  <th className="py-1">Groupe</th>
                                  <th className="py-1">Heure</th>
                                  <th className="py-1">Statut</th>
                                  <th className="py-1 text-right">Tarif élève</th>
                                  <th className="py-1 text-right">
                                    Part prof {payMethod === "percent" ? `(${payPercentage}%)` : ""}
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {visibleStudents.map((st, i) => (
                                  <tr key={i} className="border-t border-line/50">
                                    <td className="py-1.5 font-semibold text-ink">
                                      {st.name}
                                      {st.isPassager && (
                                        <Badge tone="warning" className="ml-1.5 text-[8px]">Passager</Badge>
                                      )}
                                    </td>
                                    <td className="py-1.5 text-muted">{st.groupName}</td>
                                    <td className="py-1.5 font-mono">{st.time}</td>
                                    <td className="py-1.5">
                                      <Badge tone={st.status === "En Retard" ? "warning" : "success"} className="text-[9px]">
                                        {st.status}
                                      </Badge>
                                    </td>
                                    <td className="py-1.5 text-right font-mono">{st.fee} DA</td>
                                    <td className="py-1.5 text-right font-mono font-bold text-primary">
                                      {payMethod === "percent"
                                        ? Math.round((st.fee * payPercentage) / 100)
                                        : "—"}{" "}
                                      {payMethod === "percent" ? "DA" : ""}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="rounded-2xl border-2 border-success/40 bg-success/5 p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-muted block">Montant à verser</span>
                    <strong className="text-success text-xl font-black">{computedPayout} DA</strong>
                    <span className="text-[10px] text-muted block mt-0.5">
                      {chosenTimings.length} créneau(x) · {chosenPresents} présence(s)
                      {chosenPassagers > 0 && ` · ${chosenPassagers} passager(s)`}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setIsTimingPayOpen(false)}>Annuler</Button>
                    <Button
                      onClick={handleTimingPayment}
                      disabled={savingPayment || computedPayout <= 0 || selectedTimingKeys.length === 0}
                    >
                      {savingPayment ? "Enregistrement..." : `Payer ${computedPayout} DA`}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* Print Salary Modal */}
      <Modal open={isPrintOpen} onClose={() => setIsPrintOpen(false)} title="Sélectionner la période d'impression">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Date de début</label>
              <Input type="date" value={printStart} onChange={(e) => setPrintStart(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Date de fin</label>
              <Input type="date" value={printEnd} onChange={(e) => setPrintEnd(e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsPrintOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handlePrintTeacherReport}>Générer & Imprimer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
