"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useData } from "@/lib/store/data";
import { useShallow } from "zustand/react/shallow";
import { useSession } from "@/lib/store/session";
import { Card, CardBody } from "@/components/ui/Card";

// Le portail enseignant n'est téléchargé que par un compte enseignant.
const TeacherPages = dynamic(
  () => import("@/components/pages/TeacherPages").then((m) => m.TeacherPages),
  { ssr: false },
);
import { DaySchedulePanel } from "@/components/schedule/DaySchedulePanel";
import { FreeBillingBanner } from "@/components/schedule/FreeBillingBanner";
import { WhatsAppAlertsCard } from "@/components/whatsapp/WhatsAppAlertsCard";
import { BirthdayAlertsCard } from "@/components/birthdays/BirthdayAlertsCard";
import {
  balanceDriftByStudent,
  schoolDateKey,
  schoolDateTimeLabel,
  sessionsOnDate,
  studentDebtOf,
} from "@/lib/helpers";
import { payAlertsOf, pendingAbsencesOf } from "@/lib/workerPay";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BookOpen,
  CalendarCheck,
  ChevronRight,
  GraduationCap,
  Info,
  Receipt,
  TrendingUp,
  Users,
  Wallet,
  HandCoins,
  ClipboardList,
} from "lucide-react";

export default function DashboardPage() {
  const role = useSession((s) => s.user?.role);
  if (role === "teacher") return <TeacherPages slug="dashboard" />;
  return <AdminDashboard reception={role === "reception"} />;
}

// Framer motion variants with const casting for strict TS types
const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring" as const,
      stiffness: 100,
      damping: 15,
    },
  },
};

type Severity = "danger" | "warning" | "info";
interface DashboardAlert {
  type: Severity;
  text: string;
  href?: string;
}

const SEVERITY_ORDER: Record<Severity, number> = { danger: 0, warning: 1, info: 2 };

// Teintes fixes, avec leur variante claire en thème sombre : `--success` et
// `--warning` y deviennent illisibles sur le fond bordeaux.
const TONE = {
  primary: { chip: "bg-primary/15 text-primary dark:text-rose-200", value: "text-ink" },
  success: { chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300", value: "text-emerald-600 dark:text-emerald-300" },
  danger: { chip: "bg-rose-500/15 text-rose-600 dark:text-rose-300", value: "text-rose-600 dark:text-rose-300" },
  warning: { chip: "bg-amber-500/15 text-amber-600 dark:text-amber-300", value: "text-amber-600 dark:text-amber-300" },
  info: { chip: "bg-sky-500/15 text-sky-600 dark:text-sky-300", value: "text-sky-600 dark:text-sky-300" },
} as const;

const da = (n: number) => `${n.toLocaleString("fr-FR")} DA`;

function AdminDashboard({ reception = false }: { reception?: boolean }) {
  // L'heure courante ne se lit pas pendant le rendu — deux rendus successifs
  // donneraient deux réponses. Rafraîchie chaque minute, elle fait basculer
  // une séance « en retard » sous les yeux de la réception, sans rechargement.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const userName = useSession((s) => s.user?.name);
  const {
    students,
    teachers,
    classes,
    attendance,
    cash,
    unpaidTeacher,
    sessions,
    modules,
    groups,
    subscriptions,
    balanceTx,
    reception: workers,
    workerShifts,
    workerPayments,
    privateSessions,
    privateSessionModules,
    complete,
  } = useData(
    useShallow((s) => ({
      students: s.students,
      teachers: s.teachers,
      classes: s.classes,
      attendance: s.attendance,
      cash: s.cash,
      unpaidTeacher: s.unpaidTeacher,
      sessions: s.sessions,
      modules: s.modules,
      groups: s.groups,
      subscriptions: s.subscriptions,
      balanceTx: s.balanceTx,
      reception: s.reception,
      workerShifts: s.workerShifts,
      workerPayments: s.workerPayments,
      privateSessions: s.privateSessions,
      privateSessionModules: s.privateSessionModules,
      complete: s.complete,
    })),
  );

  // ---- 1. La journée — à l'heure de l'école, quel que soit le poste ----------
  const today = schoolDateKey(nowMs);
  const { presentToday, sessionsToday } = useMemo(() => {
    let present = 0;
    for (const a of attendance) {
      if ((a.status === "present" || a.status === "late") && schoolDateKey(a.timestamp) === today) present += 1;
    }
    return { presentToday: present, sessionsToday: sessionsOnDate(sessions, today).length };
  }, [attendance, sessions, today]);

  // ---- 2. L'argent --------------------------------------------------------------
  const cashInHand = cash.reduce((sum, tx) => sum + tx.amount, 0);

  // Ce que l'école a à recouvrer, élève par élève : son solde négatif et ses
  // frais d'inscription dus, rien d'autre. Le solde porte DÉJÀ chaque séance
  // suivie — badge comme pointage manuel le font descendre du prix de la
  // séance, dans la même transaction que sa ligne d'historique. Ajouter le
  // total des présences par-dessus comptait deux fois les mêmes séances.
  // Tout ce qui suit est recalculé UNIQUEMENT quand les tables qu'il lit
  // changent — plus à chaque minute d'horloge, plus à chaque scan qui ne les
  // concerne pas.
  const { debtors, totalDebts, studiedWithoutFunds, driftingBalances } = useMemo(() => {
    const driftByStudent = balanceDriftByStudent({
      students,
      balanceTx,
      complete: complete.balanceTx !== false,
    });
    const debtors = students
      .map((s) => ({ student: s, debt: studentDebtOf(s, { drift: driftByStudent.get(s.id) ?? 0 }) }))
      .filter((row) => row.debt.alert)
      .map((row) => ({ ...row, owed: row.debt.total }))
      .sort((a, b) => b.owed - a.owed);
    return {
      debtors,
      totalDebts: debtors.reduce((sum, row) => sum + row.owed, 0),
      // Les élèves qui ont étudié sans provision : c'est la dette que le badge
      // crée tout seul, celle que personne n'a décidée au guichet.
      studiedWithoutFunds: debtors.filter((row) => row.debt.sessions > 0),
      // Les soldes qui ne valent pas la somme de leur propre historique. Ce
      // n'est PAS de l'argent dû : c'est une écriture qui a manqué sa cible.
      // On les compte sur TOUS les élèves, pas seulement les débiteurs — un
      // solde faux est le plus souvent faux dans le sens positif.
      driftingBalances: students.filter((s) => (driftByStudent.get(s.id) ?? 0) !== 0),
    };
  }, [students, balanceTx, complete.balanceTx]);

  const { unpaidTeacherSessions, unpaidByTeacher } = useMemo(() => {
    const byTeacher = new Map<string, number>();
    let total = 0;
    for (const u of unpaidTeacher) {
      if (u.paid) continue;
      total += u.amount;
      byTeacher.set(u.teacherId, (byTeacher.get(u.teacherId) ?? 0) + u.amount);
    }
    return { unpaidTeacherSessions: total, unpaidByTeacher: byTeacher };
  }, [unpaidTeacher]);

  // Pour chaque abonnement : son créneau (module + groupe), une fois pour toutes.
  const { moduleEnrollments, studentsPerGroup } = useMemo(() => {
    const sessionById = new Map(sessions.map((se) => [se.id, se]));
    const sessionOfSub = new Map<string, (typeof sessions)[number]>();
    for (const sub of subscriptions) {
      const se = sessionById.get(sub.sessionId);
      if (se) sessionOfSub.set(sub.id, se);
    }
    const counts = new Map<string, number>();
    const perGroup = new Map<string, number>();
    for (const s of students) {
      const groupsOfStudent = new Set<string>();
      for (const subId of s.subscriptionIds) {
        const se = sessionOfSub.get(subId);
        if (!se) continue;
        counts.set(se.moduleId, (counts.get(se.moduleId) ?? 0) + 1);
        groupsOfStudent.add(se.groupId);
      }
      for (const g of groupsOfStudent) perGroup.set(g, (perGroup.get(g) ?? 0) + 1);
    }
    return {
      // Inscriptions par module — les 6 plus suivis
      moduleEnrollments: modules
        .map((m) => ({ name: m.name, count: counts.get(m.id) ?? 0 }))
        .filter((m) => m.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 6),
      studentsPerGroup: perGroup,
    };
  }, [students, subscriptions, sessions, modules]);
  const maxEnrollment = Math.max(...moduleEnrollments.map((m) => m.count), 1);

  // ---- 3. La caisse des 7 derniers jours (jours de l'école) ------------------
  const { weeklyCashData, recentTransactions } = useMemo(() => {
    const byDay = new Map<string, { inflows: number; outflows: number }>();
    for (const tx of cash) {
      const key = schoolDateKey(tx.date);
      const cur = byDay.get(key) ?? { inflows: 0, outflows: 0 };
      if (tx.amount > 0) cur.inflows += tx.amount;
      else cur.outflows += -tx.amount;
      byDay.set(key, cur);
    }
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      const flows = byDay.get(key) ?? { inflows: 0, outflows: 0 };
      days.push({
        key,
        label: d.toLocaleDateString("fr-FR", { weekday: "short", timeZone: "UTC" }),
        ...flows,
      });
    }
    return {
      weeklyCashData: days,
      // Les derniers mouvements par DATE — l'ordre de la table n'est pas celui
      // de la caisse.
      recentTransactions: [...cash].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6),
    };
  }, [cash, today]);
  const maxCashValue = Math.max(...weeklyCashData.map((d) => Math.max(d.inflows, d.outflows)), 1000);
  const weekIn = weeklyCashData.reduce((s, d) => s + d.inflows, 0);
  const weekOut = weeklyCashData.reduce((s, d) => s + d.outflows, 0);

  // ---- 4. Ce qui demande une action -------------------------------------------
  const severeDebtors = debtors.filter((row) => row.owed >= 2000);
  const lowEnrollmentGroups = groups.filter((g) => {
    const enrolledCount = studentsPerGroup.get(g.id) ?? 0;
    return enrolledCount > 0 && enrolledCount < 3;
  });

  const heavyUnpaidTeachers = teachers.filter((t) => (unpaidByTeacher.get(t.id) ?? 0) >= 5000);

  // Les salaires du personnel, calculés par `lib/workerPay.ts` exactement comme
  // sur l'écran Travailleurs : deux calculs séparés finissaient toujours par
  // annoncer deux retards différents — et c'est le tableau de bord qu'on croit.
  const { lateWorkers, soonWorkers, pendingWorkerAbsences } = useMemo(() => {
    const workerAlerts = payAlertsOf(workers, workerShifts, workerPayments);
    return {
      lateWorkers: workerAlerts.filter((a) => a.urgency === "late"),
      soonWorkers: workerAlerts.filter((a) => a.urgency === "soon"),
      // Les absences dont la retenue n'a jamais été tranchée.
      pendingWorkerAbsences: pendingAbsencesOf(workers, workerShifts),
    };
    // `nowMs` : l'échéance d'un salaire avance avec l'horloge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workers, workerShifts, workerPayments, nowMs]);

  // Les séances particulières. « À programmer » : la demande est prise, mais
  // rien n'est posé — c'est ainsi qu'une famille attend un coup de fil qui ne
  // vient jamais. « En retard » : l'heure est passée sans conclusion.
  const unplannedPrivate = privateSessions.filter((p) => p.status === "requested");
  const plannedPrivate = privateSessions.filter((p) => p.status === "planned" && !!p.scheduledAt);
  const latePrivate = plannedPrivate.filter((p) => new Date(p.scheduledAt as string).getTime() < nowMs);
  const soonPrivate = plannedPrivate.filter((p) => {
    const t = new Date(p.scheduledAt as string).getTime();
    return t >= nowMs && t - nowMs <= 24 * 3600 * 1000;
  });
  const privateTeacherDue = privateSessions
    .filter((p) => p.status !== "cancelled")
    .map((p) => ({
      session: p,
      due: privateSessionModules
        .filter((m) => m.privateSessionId === p.id && m.teacherId && !m.teacherPaid)
        .reduce((sum, m) => sum + m.teacherAmount, 0),
    }))
    .filter((row) => row.due > 0);
  const privateStudentDebt = privateSessions
    .filter((p) => p.status !== "cancelled" && p.totalPrice > p.paidAmount)
    .reduce((sum, p) => sum + (p.totalPrice - p.paidAmount), 0);

  const alerts: DashboardAlert[] = [];
  // La première alerte de la journée : qui a étudié sans avoir de quoi payer.
  // Depuis que le badge n'est plus refusé pour solde épuisé, c'est la seule
  // trace de ce qui est dû — et elle doit se voir sans ouvrir une fiche.
  if (studiedWithoutFunds.length > 0) {
    alerts.push({
      type: "danger",
      text: `${studiedWithoutFunds.length} élève(s) ont suivi des séances sans provision — ${da(
        studiedWithoutFunds.reduce((sum, row) => sum + row.debt.sessions, 0),
      )} à réclamer à la caisse.`,
      href: "/students",
    });
  }
  if (driftingBalances.length > 0) {
    alerts.push({
      type: "warning",
      text:
        `${driftingBalances.length} élève(s) ont un solde qui ne correspond pas à la somme de leur historique ` +
        "— filtre « Solde à vérifier » de l'écran Étudiants, puis « Régulariser » sur la carte.",
      href: "/students",
    });
  }
  // Un salaire en retard passe avant tout le reste : c'est la seule dette de
  // l'école envers quelqu'un qui travaille encore pour elle.
  if (lateWorkers.length > 0) {
    alerts.push({
      type: "danger",
      text: `${lateWorkers.length} salaire(s) de travailleur EN RETARD — ${da(
        lateWorkers.reduce((sum, a) => sum + a.period.amount, 0),
      )} à verser (${lateWorkers.map((a) => `${a.worker.firstName} ${a.worker.lastName}`).join(", ")}).`,
      href: "/workers",
    });
  }
  if (soonWorkers.length > 0) {
    alerts.push({
      type: "warning",
      text: `${soonWorkers.length} salaire(s) de travailleur à verser dans les prochains jours — ${da(
        soonWorkers.reduce((sum, a) => sum + a.period.amount, 0),
      )}.`,
      href: "/workers",
    });
  }
  // Une absence non tranchée bloque le règlement de sa période : elle doit se
  // voir d'ici, sinon on découvre le blocage le jour de la paie.
  if (pendingWorkerAbsences.length > 0) {
    alerts.push({
      type: "warning",
      text:
        `${pendingWorkerAbsences.length} absence(s) de travailleur à trancher ` +
        `(${[...new Set(pendingWorkerAbsences.map((a) => `${a.worker.firstName} ${a.worker.lastName}`))].join(", ")}) — ` +
        "fixez la retenue, ou décidez de ne rien retenir : le règlement de la période l'attend.",
      href: "/workers",
    });
  }
  if (unplannedPrivate.length > 0) {
    alerts.push({
      type: "warning",
      text:
        `${unplannedPrivate.length} séance(s) particulière(s) à PROGRAMMER : la demande est ` +
        "prise, mais aucune date n'est posée — ni l'élève ni l'enseignant ne savent quand.",
      href: "/particulier",
    });
  }
  if (latePrivate.length > 0) {
    alerts.push({
      type: "danger",
      text: `${latePrivate.length} séance(s) particulière(s) en retard : l'heure est passée sans qu'elles soient marquées tenues ou annulées.`,
      href: "/particulier",
    });
  }
  if (soonPrivate.length > 0) {
    alerts.push({
      type: "info",
      text: `${soonPrivate.length} séance(s) particulière(s) dans les 24 heures.`,
      href: "/particulier",
    });
  }
  if (privateTeacherDue.length > 0) {
    alerts.push({
      type: "warning",
      text: `${privateTeacherDue.length} séance(s) particulière(s) avec un enseignant non réglé — ${da(
        privateTeacherDue.reduce((sum, r) => sum + r.due, 0),
      )}.`,
      href: "/particulier",
    });
  }
  if (privateStudentDebt > 0) {
    alerts.push({
      type: "warning",
      text: `${da(privateStudentDebt)} de dettes sur les séances particulières.`,
      href: "/particulier",
    });
  }
  if (severeDebtors.length > 0) {
    alerts.push({
      type: "danger",
      text: `${severeDebtors.length} élève(s) doivent 2 000 DA ou plus.`,
      href: "/students",
    });
  }
  if (heavyUnpaidTeachers.length > 0) {
    alerts.push({
      type: "warning",
      text: `${heavyUnpaidTeachers.length} enseignant(s) ont plus de 5 000 DA d'impayés cumulés.`,
      href: reception ? undefined : "/teachers",
    });
  }
  if (lowEnrollmentGroups.length > 0) {
    alerts.push({
      type: "info",
      text: `${lowEnrollmentGroups.length} groupe(s) ont un effectif faible (moins de 3 élèves).`,
    });
  }
  // Le plus grave en tête : on lit la liste de haut en bas, et on s'arrête.
  alerts.sort((a, b) => SEVERITY_ORDER[a.type] - SEVERITY_ORDER[b.type]);
  const urgent = alerts.filter((a) => a.type === "danger").length;

  const longToday = new Date(`${today}T12:00:00Z`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-6">
      {/* ---- En-tête : où l'on est, quel jour, et les écrans du quotidien ---- */}
      <motion.div
        variants={itemVariants}
        className="relative overflow-hidden rounded-3xl border border-line bg-gradient-card p-5 card-shadow md:p-6"
      >
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-primary text-3xl shadow-md">
              {reception ? "🛎️" : "📊"}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted first-letter:uppercase">
                {longToday}
              </p>
              <h1 className="truncate text-xl font-black text-ink md:text-2xl">
                {userName ? `Bonjour, ${userName}` : reception ? "Accueil Réception" : "Tableau de bord"}
              </h1>
              <p className="text-sm text-muted">
                {reception ? "Suivi opérationnel en temps réel" : "Bilan décisionnel et indicateurs clés"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <QuickLink href="/students" icon={<GraduationCap className="h-4 w-4" />} label="Étudiants" />
            <QuickLink href="/attendance" icon={<CalendarCheck className="h-4 w-4" />} label="Présences" />
            {!reception && <QuickLink href="/cash" icon={<Wallet className="h-4 w-4" />} label="Caisse" />}
          </div>
        </div>
      </motion.div>

      {/* Une gratuité active met TOUS les scans à 0 DA : ça doit se voir ici,
          pas seulement dans le toast d'un scan déjà passé. */}
      <motion.div variants={itemVariants} className="empty:hidden">
        <FreeBillingBanner />
      </motion.div>

      {/* ---- Les chiffres du jour ------------------------------------------- */}
      <motion.div
        variants={itemVariants}
        className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${reception ? "xl:grid-cols-4" : "xl:grid-cols-5"}`}
      >
        <KpiTile
          href="/students"
          icon={<GraduationCap className="h-5 w-5" />}
          tone="primary"
          label="Élèves inscrits"
          value={students.length.toLocaleString("fr-FR")}
          hint={`${classes.length} classe(s) · ${groups.length} groupe(s)`}
        />
        <KpiTile
          href="/attendance"
          icon={<CalendarCheck className="h-5 w-5" />}
          tone="success"
          label="Présences aujourd'hui"
          value={presentToday.toLocaleString("fr-FR")}
          hint={`${sessionsToday} séance(s) programmée(s)`}
        />
        <KpiTile
          href="/students"
          icon={<AlertTriangle className="h-5 w-5" />}
          tone={totalDebts > 0 ? "danger" : "success"}
          label="À recouvrer"
          value={da(totalDebts)}
          hint={debtors.length > 0 ? `${debtors.length} élève(s) en dette` : "Tout le monde est à jour"}
        />
        {reception ? (
          <KpiTile
            icon={<Users className="h-5 w-5" />}
            tone="info"
            label="Enseignants"
            value={teachers.length.toLocaleString("fr-FR")}
            hint={`${sessions.length} créneau(x) au planning`}
          />
        ) : (
          <>
            <KpiTile
              href="/cash"
              icon={<Wallet className="h-5 w-5" />}
              tone="info"
              label="Caisse"
              value={da(cashInHand)}
              hint={`7 j : +${da(weekIn)} / -${da(weekOut)}`}
            />
            <KpiTile
              href="/teachers"
              icon={<HandCoins className="h-5 w-5" />}
              tone={unpaidTeacherSessions > 0 ? "warning" : "success"}
              label="Dû aux enseignants"
              value={da(unpaidTeacherSessions)}
              hint={`${teachers.length} enseignant(s)`}
            />
          </>
        )}
      </motion.div>

      {/* ---- À traiter : tout ce qui attend une décision, le plus grave d'abord */}
      <motion.div variants={itemVariants}>
        <Card className="border border-line">
          <CardBody className="p-4 md:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
                <ClipboardList className="h-4.5 w-4.5 text-primary" /> À traiter
                {alerts.length > 0 && (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[11px] text-primary dark:text-rose-200">
                    {alerts.length}
                  </span>
                )}
              </h2>
              {urgent > 0 && (
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${TONE.danger.chip}`}>
                  {urgent} urgent(s)
                </span>
              )}
            </div>
            {alerts.length === 0 ? (
              <div className={`flex items-center gap-2 rounded-xl px-3 py-3 text-xs font-semibold ${TONE.success.chip}`}>
                <BadgeCheck className="h-4 w-4" /> Rien à signaler : aucune dette, aucun retard, aucun écart.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {alerts.map((alert, idx) => (
                  <AlertRow key={idx} alert={alert} />
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </motion.div>

      {/* Les anniversaires du jour et les alertes WhatsApp à relire. Chaque
          carte ne s'affiche que si elle a quelque chose à dire. */}
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-1 gap-6 xl:grid-cols-2 [&:not(:has(>div>*))]:hidden"
      >
        <div className="empty:hidden">
          <BirthdayAlertsCard />
        </div>
        <div className="empty:hidden">
          <WhatsAppAlertsCard />
        </div>
      </motion.div>

      {/* Les séances de la journée, en emploi du temps — et l'historique des
          jours précédents à portée de flèche. */}
      <motion.div variants={itemVariants}>
        <DaySchedulePanel />
      </motion.div>

      {/* ---- Direction : la caisse de la semaine et les modules suivis ------- */}
      {!reception && (
        <motion.div variants={itemVariants} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="border border-line">
            <CardBody className="space-y-5 p-5">
              <SectionTitle
                icon={<TrendingUp className="h-4.5 w-4.5 text-emerald-500" />}
                title="Caisse — 7 derniers jours"
                hint="Entrées et sorties de caisse, jour par jour"
                right={
                  <div className="flex gap-3 text-[10px] font-bold text-muted">
                    <span className="flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Entrées
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Sorties
                    </span>
                  </div>
                }
              />
              <div className="flex h-44 items-end justify-between gap-2 border-b border-line px-1 pb-1">
                {weeklyCashData.map((d) => {
                  const inflowPct = (d.inflows / maxCashValue) * 100;
                  const outflowPct = (d.outflows / maxCashValue) * 100;
                  const isToday = d.key === today;
                  return (
                    <div key={d.key} className="group relative flex flex-1 flex-col items-center gap-1.5">
                      <div className="pointer-events-none absolute bottom-full z-20 mb-2 whitespace-nowrap rounded-lg border border-line bg-surface p-2 font-mono text-[10px] opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                        <span className="block text-emerald-600 dark:text-emerald-300">+{da(d.inflows)}</span>
                        <span className="block text-rose-600 dark:text-rose-300">-{da(d.outflows)}</span>
                      </div>
                      <div className="flex h-36 w-full items-end justify-center gap-1">
                        <div
                          style={{ height: `${Math.max(inflowPct, 3)}%` }}
                          className={`w-3.5 rounded-t-md bg-gradient-to-t from-emerald-600 to-emerald-400 transition-all sm:w-4 ${
                            d.inflows > 0 ? "opacity-100" : "opacity-20"
                          }`}
                        />
                        <div
                          style={{ height: `${Math.max(outflowPct, 3)}%` }}
                          className={`w-3.5 rounded-t-md bg-gradient-to-t from-rose-700 to-rose-400 transition-all sm:w-4 ${
                            d.outflows > 0 ? "opacity-100" : "opacity-20"
                          }`}
                        />
                      </div>
                      <span
                        className={`font-mono text-[10px] uppercase ${isToday ? "font-black text-primary" : "text-muted"}`}
                      >
                        {d.label}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <MiniStat label="Entrées (7 j)" value={`+${da(weekIn)}`} tone="success" />
                <MiniStat label="Sorties (7 j)" value={`-${da(weekOut)}`} tone="danger" />
                <MiniStat label="Net (7 j)" value={da(weekIn - weekOut)} tone={weekIn - weekOut >= 0 ? "success" : "danger"} />
              </div>
            </CardBody>
          </Card>

          <Card className="border border-line">
            <CardBody className="space-y-5 p-5">
              <SectionTitle
                icon={<BookOpen className="h-4.5 w-4.5 text-primary" />}
                title="Modules les plus suivis"
                hint="Nombre d'inscriptions d'élèves par matière"
              />
              <div className="space-y-3">
                {moduleEnrollments.length === 0 ? (
                  <p className="p-8 text-center text-xs italic text-muted">Aucune inscription active.</p>
                ) : (
                  moduleEnrollments.map((item, idx) => (
                    <div key={item.name} className="space-y-1.5 text-xs">
                      <div className="flex items-center justify-between font-semibold">
                        <span className="flex items-center gap-2 capitalize text-ink">
                          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/15 font-mono text-[10px] text-primary dark:text-rose-200">
                            {idx + 1}
                          </span>
                          {item.name}
                        </span>
                        <span className="font-mono text-muted">{item.count} élève(s)</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full border border-line/40 bg-canvas">
                        <div
                          style={{ width: `${(item.count / maxEnrollment) * 100}%` }}
                          className="h-full rounded-full bg-gradient-primary transition-all duration-700"
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardBody>
          </Card>
        </motion.div>
      )}

      {/* ---- Qui doit, et ce qui vient de passer en caisse -------------------- */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Qui doit de l'argent à l'école. Cette liste ne retenait autrefois que
            les découverts au-delà de 2000 DA et n'était montrée qu'à
            l'administrateur : une séance suivie sans provision — 625 DA — n'y
            figurait jamais, et la réception, qui est le guichet, ne la voyait pas. */}
        <Card className="border border-line">
          <CardBody className="space-y-3 p-5">
            <SectionTitle
              icon={<AlertTriangle className="h-4.5 w-4.5 text-rose-500" />}
              title={`Élèves débiteurs (${debtors.length})`}
              right={
                debtors.length > 0 ? (
                  <span className={`font-mono text-xs font-black ${TONE.danger.value}`}>{da(totalDebts)}</span>
                ) : undefined
              }
            />
            <div className="max-h-80 space-y-2 overflow-y-auto pe-1">
              {debtors.length === 0 ? (
                <div className={`flex flex-col items-center gap-2 py-10 text-center text-xs font-bold ${TONE.success.value}`}>
                  <BadgeCheck className="h-8 w-8" />
                  <span>Tous les élèves sont à jour de paiement !</span>
                </div>
              ) : (
                debtors.slice(0, 12).map(({ student: s, debt, owed }) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 rounded-xl border border-line bg-canvas/40 px-3 py-2.5 transition-colors hover:border-rose-500/40"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-red-700 text-[11px] font-black uppercase text-white">
                      {s.firstName.substring(0, 1)}
                      {s.lastName.substring(0, 1)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-xs capitalize text-ink">
                        {s.firstName} {s.lastName}
                      </strong>
                      <span className="block truncate text-[10px] text-muted">
                        {[
                          debt.sessions > 0 ? `${da(debt.sessions)} de séances suivies` : "",
                          debt.registration > 0 ? `${da(debt.registration)} d'inscription` : "",
                          debt.drift !== 0 ? `solde à vérifier (${da(Math.abs(debt.drift))} d'écart)` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    <strong className={`whitespace-nowrap font-mono text-xs font-black ${TONE.danger.value}`}>
                      -{da(owed)}
                    </strong>
                  </div>
                ))
              )}
            </div>
            {debtors.length > 12 && (
              <Link
                href="/students"
                className="flex items-center justify-center gap-1 rounded-xl border border-line py-2 text-xs font-semibold text-muted transition-colors hover:border-primary/40 hover:text-ink"
              >
                Voir les {debtors.length} débiteurs dans l&apos;écran Étudiants <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </CardBody>
        </Card>

        <Card className="border border-line">
          <CardBody className="space-y-3 p-5">
            <SectionTitle
              icon={<Receipt className="h-4.5 w-4.5 text-primary" />}
              title="Derniers mouvements de caisse"
            />
            <div className="max-h-80 space-y-2 overflow-y-auto pe-1">
              {recentTransactions.length === 0 ? (
                <p className="py-10 text-center text-xs italic text-muted">Aucun mouvement de caisse enregistré.</p>
              ) : (
                recentTransactions.map((tx) => {
                  const credit = tx.amount > 0;
                  return (
                    <div
                      key={tx.id}
                      className="flex items-center gap-3 rounded-xl border border-line bg-canvas/40 px-3 py-2.5"
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                          credit ? TONE.success.chip : TONE.danger.chip
                        }`}
                      >
                        {credit ? <TrendingUp className="h-4 w-4" /> : <Receipt className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <strong className="block truncate text-xs font-semibold text-ink">{tx.description}</strong>
                        <span className="block font-mono text-[10px] text-muted">{schoolDateTimeLabel(tx.date)}</span>
                      </div>
                      <strong
                        className={`whitespace-nowrap font-mono text-xs font-black ${
                          credit ? TONE.success.value : TONE.danger.value
                        }`}
                      >
                        {credit ? `+${da(tx.amount)}` : `-${da(-tx.amount)}`}
                      </strong>
                    </div>
                  );
                })
              )}
            </div>
          </CardBody>
        </Card>
      </motion.div>
    </motion.div>
  );
}

// =============================================================================
// Briques
// =============================================================================

function QuickLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:border-primary/50 hover:bg-primary-50"
    >
      <span className="text-primary">{icon}</span> {label}
    </Link>
  );
}

function KpiTile({
  href,
  icon,
  tone,
  label,
  value,
  hint,
}: {
  href?: string;
  icon: React.ReactNode;
  tone: keyof typeof TONE;
  label: string;
  value: string;
  hint?: string;
}) {
  const t = TONE[tone];
  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${t.chip}`}>{icon}</span>
        {href && (
          <ChevronRight className="h-4 w-4 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </div>
      <div className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
        <strong className={`mt-0.5 block truncate font-mono text-xl font-black md:text-2xl ${t.value}`}>{value}</strong>
        {hint && <span className="mt-0.5 block truncate text-[10px] text-muted">{hint}</span>}
      </div>
    </>
  );
  const className =
    "group flex flex-col gap-3 rounded-2xl border border-line bg-gradient-card p-4 card-shadow transition-all";
  return href ? (
    <Link href={href} className={`${className} hover:-translate-y-0.5 hover:border-primary/40`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function AlertRow({ alert }: { alert: DashboardAlert }) {
  const t = TONE[alert.type];
  const icon =
    alert.type === "info" ? <Info className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />;
  const body = (
    <>
      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${t.chip}`}>{icon}</span>
      <span className="min-w-0 flex-1 text-xs leading-relaxed text-ink">{alert.text}</span>
      {alert.href && <ChevronRight className="mt-1.5 h-4 w-4 shrink-0 text-muted" />}
    </>
  );
  const frame = {
    danger: "border-rose-500/30 bg-rose-500/5",
    warning: "border-amber-500/30 bg-amber-500/5",
    info: "border-sky-500/30 bg-sky-500/5",
  }[alert.type];
  // Une alerte qu'on ne peut pas suivre jusqu'à l'écran qui la règle se relit
  // tous les matins sans que rien ne bouge.
  return alert.href ? (
    <Link
      href={alert.href}
      className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors hover:brightness-110 ${frame}`}
    >
      {body}
    </Link>
  ) : (
    <div className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${frame}`}>{body}</div>
  );
}

function SectionTitle({
  icon,
  title,
  hint,
  right,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
          {icon} {title}
        </h3>
        {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: "success" | "danger" }) {
  return (
    <div className="rounded-xl border border-line bg-canvas/40 p-2.5">
      <span className="block text-[9px] font-bold uppercase text-muted">{label}</span>
      <strong className={`mt-0.5 block truncate font-mono font-black ${TONE[tone].value}`}>{value}</strong>
    </div>
  );
}
