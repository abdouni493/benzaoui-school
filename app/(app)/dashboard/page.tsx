"use client";

import { useData } from "@/lib/store/data";
import { useSession } from "@/lib/store/session";
import { Card, CardBody } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { TeacherPages } from "@/components/pages/TeacherPages";
import { motion } from "framer-motion";
import {
  Users,
  GraduationCap,
  Calendar,
  CheckCircle2,
  DollarSign,
  AlertTriangle,
  Clock,
  TrendingUp,
  ArrowUpRight,
  ArrowDownLeft,
  BookOpen,
  Receipt,
  TrendingDown
} from "lucide-react";

export default function DashboardPage() {
  const { user } = useSession();
  if (user?.role === "teacher") return <TeacherPages slug="dashboard" />;
  return <AdminDashboard reception={user?.role === "reception"} />;
}

// Framer motion variants with const casting for strict TS types
const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring" as const,
      stiffness: 100,
      damping: 15
    }
  }
};

function AdminDashboard({ reception = false }: { reception?: boolean }) {
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
    salles,
  } = useData();

  // 1. General Operational Metrics
  const totalStudents = students.length;
  const totalTeachers = teachers.length;
  const totalClasses = classes.length;

  const todayStr = new Date().toISOString().split("T")[0];
  const todayAttendance = attendance.filter((a) => a.timestamp.startsWith(todayStr));
  const presentCount = todayAttendance.filter((a) => a.status === "present" || a.status === "late").length;
  const attendanceRate = todayAttendance.length > 0 ? Math.round((presentCount / todayAttendance.length) * 100) : 0;

  // 2. Financial Metrics (Admin Only)
  const cashInHand = cash.reduce((sum, tx) => sum + tx.amount, 0);
  const totalDebts = students.reduce((sum, s) => {
    const balDebt = s.balance < 0 ? Math.abs(s.balance) : 0;
    const regDebt = s.registrationDue || 0;
    return sum + balDebt + regDebt;
  }, 0);
  const unpaidTeacherSessions = unpaidTeacher.filter((u) => !u.paid).reduce((sum, u) => sum + u.amount, 0);

  // Today's classes schedule
  const todayIndex = (["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const)[
    new Date().getDay()
  ];
  const todaysSchedule = sessions
    .filter((s) => s.days.includes(todayIndex))
    .map((s) => {
      const teacher = teachers.find((t) => t.id === s.teacherId);
      const mod = modules.find((m) => m.id === s.moduleId);
      const group = groups.find((g) => g.id === s.groupId);
      const salle = salles.find((sa) => sa.id === s.salleId);
      return {
        ...s,
        teacherName: teacher ? `${teacher.firstName} ${teacher.lastName}` : "Non spécifié",
        moduleName: mod ? mod.name : "Module",
        groupName: group ? group.name : "Groupe",
        salleName: salle ? salle.name : "Salle non spécifiée",
      };
    });

  // 3. Subscription Count By Module (CSS Bar Chart Data)
  const getModuleEnrollments = () => {
    const counts: Record<string, number> = {};
    students.forEach((s) => {
      s.subscriptionIds.forEach((subId) => {
        const sub = subscriptions.find((subItem) => subItem.id === subId);
        if (sub) {
          const session = sessions.find((se) => se.id === sub.sessionId);
          if (session) {
            counts[session.moduleId] = (counts[session.moduleId] || 0) + 1;
          }
        }
      });
    });

    return modules
      .map((m) => ({
        name: m.name,
        count: counts[m.id] || 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // top 5
  };

  const moduleEnrollments = getModuleEnrollments();
  const maxEnrollment = Math.max(...moduleEnrollments.map((m) => m.count), 1);

  // 4. Weekly Cash Flows (Admin Only - CSS Bar Chart Data)
  const getWeeklyCashFlows = () => {
    const days = [];
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];

      const dayTxs = cash.filter((tx) => tx.date.startsWith(dateStr));
      const inflows = dayTxs.filter((tx) => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0);
      const outflows = dayTxs.filter((tx) => tx.amount < 0).reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

      const label = d.toLocaleDateString("fr-FR", { weekday: "short" });
      days.push({ label, dateStr, inflows, outflows });
    }

    return days;
  };

  const weeklyCashData = getWeeklyCashFlows();
  const maxCashValue = Math.max(...weeklyCashData.map((d) => Math.max(d.inflows, d.outflows)), 1000);

  // 5. Intelligent Alerts & Analytics
  const severeDebtors = students.filter((s) => s.balance <= -2000);
  const lowEnrollmentGroups = groups.filter((g) => {
    const enrolledCount = students.filter((s) => s.subscriptionIds.some((subId) => {
      const sub = subscriptions.find((subItem) => subItem.id === subId);
      if (sub) {
        const session = sessions.find((se) => se.id === sub.sessionId);
        return session ? session.groupId === g.id : false;
      }
      return false;
    })).length;
    return enrolledCount > 0 && enrolledCount < 3;
  });
  
  const heavyUnpaidTeachers = teachers.filter((t) => {
    const amt = unpaidTeacher.filter((u) => u.teacherId === t.id && !u.paid).reduce((sum, u) => sum + u.amount, 0);
    return amt >= 5000;
  });

  const alerts = [];
  if (severeDebtors.length > 0) {
    alerts.push({
      type: "danger" as const,
      text: `${severeDebtors.length} élève(s) ont un découvert critique supérieur à -2000 DA.`,
    });
  }
  if (heavyUnpaidTeachers.length > 0) {
    alerts.push({
      type: "warning" as const,
      text: `${heavyUnpaidTeachers.length} enseignant(s) ont plus de 5000 DA d'impayés cumulés.`,
    });
  }
  if (lowEnrollmentGroups.length > 0) {
    alerts.push({
      type: "info" as const,
      text: `${lowEnrollmentGroups.length} groupe(s) ont un effectif faible (moins de 3 élèves).`,
    });
  }

  // Last 5 cash transactions
  const recentTransactions = cash.slice(-5).reverse();

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader
          emoji="🏠"
          title={reception ? "Accueil Réception" : "Tableau de Bord Administrateur"}
          subtitle={reception ? "Suivi opérationnel en temps réel" : "Bilan décisionnel et indicateurs clés"}
        />
        <div className="text-right text-[11px] text-muted font-mono bg-surface border border-line px-3.5 py-1.5 rounded-xl self-start sm:self-center shadow-sm">
          Aujourd'hui : {new Date().toLocaleDateString("fr-FR", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </div>

      {/* Row 1: KPI Cards */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-gradient-primary relative overflow-hidden rounded-2xl p-5 text-white card-shadow flex justify-between items-center h-24 hover:scale-[1.01] transition-transform duration-300">
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-white/80 uppercase tracking-wider">Élèves Actifs</p>
            <p className="text-3xl font-black">{totalStudents}</p>
          </div>
          <div className="h-12 w-12 rounded-xl bg-white/10 flex items-center justify-center">
            <GraduationCap className="h-6 w-6 text-white" />
          </div>
        </div>

        <div className="bg-gradient-success relative overflow-hidden rounded-2xl p-5 text-white card-shadow flex justify-between items-center h-24 hover:scale-[1.01] transition-transform duration-300">
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-white/80 uppercase tracking-wider">Enseignants</p>
            <p className="text-3xl font-black">{totalTeachers}</p>
          </div>
          <div className="h-12 w-12 rounded-xl bg-white/10 flex items-center justify-center">
            <Users className="h-6 w-6 text-white" />
          </div>
        </div>

        <div className="bg-gradient-warning relative overflow-hidden rounded-2xl p-5 text-white card-shadow flex justify-between items-center h-24 hover:scale-[1.01] transition-transform duration-300">
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-white/80 uppercase tracking-wider">Groupes Actifs</p>
            <p className="text-3xl font-black">{groups.length}</p>
          </div>
          <div className="h-12 w-12 rounded-xl bg-white/10 flex items-center justify-center">
            <Calendar className="h-6 w-6 text-white" />
          </div>
        </div>

        <div className="bg-gradient-danger relative overflow-hidden rounded-2xl p-5 text-white card-shadow flex justify-between items-center h-24 hover:scale-[1.01] transition-transform duration-300">
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-white/80 uppercase tracking-wider">Présence aujourd'hui</p>
            <p className="text-3xl font-black">{attendanceRate}%</p>
            <span className="text-[9px] text-white/70 block font-mono">{presentCount} / {todayAttendance.length || 0} élèves</span>
          </div>
          <div className="h-12 w-12 rounded-xl bg-white/10 flex items-center justify-center">
            <CheckCircle2 className="h-6 w-6 text-white" />
          </div>
        </div>
      </motion.div>

      {/* Row 2: Operational Alerts (All Users) */}
      {alerts.length > 0 && (
        <motion.div variants={itemVariants} className="space-y-2">
          {alerts.map((alert, idx) => (
            <div
              key={idx}
              className={`p-3.5 rounded-2xl border flex items-center gap-3 text-xs font-semibold ${
                alert.type === "danger"
                  ? "bg-danger/10 border-danger/20 text-danger"
                  : alert.type === "warning"
                  ? "bg-warning/10 border-warning/20 text-warning"
                  : "bg-primary-50 text-primary border-primary/20"
              }`}
            >
              <AlertTriangle className="h-4.5 w-4.5 shrink-0" />
              <span>{alert.text}</span>
            </div>
          ))}
        </motion.div>
      )}

      {/* Row 3: Admin-Only Graphs & Financials */}
      {!reception && (
        <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Chart 1: SVG/CSS Bar Chart of Cash Operations */}
          <Card className="border border-line card-shadow">
            <CardBody className="space-y-6 p-5">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-xs font-bold text-ink uppercase tracking-wide flex items-center gap-1.5">
                    <TrendingUp className="h-4.5 w-4.5 text-success" /> Flux Financier (7 derniers jours)
                  </h3>
                  <p className="text-[10px] text-muted">Comparaison journalière des recettes et dépenses de caisse</p>
                </div>
                <div className="flex gap-3 text-[10px] font-bold">
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-success" /> Entrées</span>
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-danger" /> Sorties</span>
                </div>
              </div>

              {/* Chart Grid */}
              <div className="h-44 flex items-end justify-between gap-2 px-2 border-b border-line pb-1">
                {weeklyCashData.map((d, idx) => {
                  const inflowPct = (d.inflows / maxCashValue) * 100;
                  const outflowPct = (d.outflows / maxCashValue) * 100;

                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-2 group relative">
                      {/* Tooltip on Hover */}
                      <div className="absolute bottom-full mb-2 bg-ink text-white rounded-lg p-2 text-[9px] font-mono pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 shadow-lg z-20 whitespace-nowrap">
                        <span className="text-success block">+{d.inflows} DA</span>
                        <span className="text-danger block">-{d.outflows} DA</span>
                      </div>

                      {/* Side-by-side vertical bars */}
                      <div className="w-full flex items-end justify-center gap-1 h-36">
                        <div
                          style={{ height: `${Math.max(inflowPct, 3)}%` }}
                          className={`w-3.5 sm:w-4 bg-success rounded-t-md transition-all duration-550 ${
                            d.inflows > 0 ? "opacity-100" : "opacity-15"
                          }`}
                        />
                        <div
                          style={{ height: `${Math.max(outflowPct, 3)}%` }}
                          className={`w-3.5 sm:w-4 bg-danger rounded-t-md transition-all duration-550 ${
                            d.outflows > 0 ? "opacity-100" : "opacity-15"
                          }`}
                        />
                      </div>
                      <span className="text-[9px] font-mono text-muted uppercase mt-1">{d.label}</span>
                    </div>
                  );
                })}
              </div>

              {/* Cash Summary details */}
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="bg-canvas/40 p-2.5 rounded-xl border border-line">
                  <span className="text-[9px] text-muted block uppercase font-bold">Caisse Réelle</span>
                  <strong className="text-primary font-black mt-0.5 block">{cashInHand} DA</strong>
                </div>
                <div className="bg-canvas/40 p-2.5 rounded-xl border border-line">
                  <span className="text-[9px] text-muted block uppercase font-bold">Dettes Élèves</span>
                  <strong className="text-warning font-black mt-0.5 block">{totalDebts} DA</strong>
                </div>
                <div className="bg-canvas/40 p-2.5 rounded-xl border border-line">
                  <span className="text-[9px] text-muted block uppercase font-bold">Impayés Profs</span>
                  <strong className="text-danger font-black mt-0.5 block">{unpaidTeacherSessions} DA</strong>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Chart 2: Student module subscriptions */}
          <Card className="border border-line card-shadow">
            <CardBody className="space-y-6 p-5">
              <div>
                <h3 className="text-xs font-bold text-ink uppercase tracking-wide flex items-center gap-1.5">
                  <BookOpen className="h-4.5 w-4.5 text-primary" /> Popularité des Modules
                </h3>
                <p className="text-[10px] text-muted">Nombre d'inscriptions d'élèves par matières principales</p>
              </div>

              <div className="space-y-3.5 pt-1.5">
                {moduleEnrollments.length === 0 ? (
                  <p className="text-xs text-muted italic text-center p-8">Aucune inscription active.</p>
                ) : (
                  moduleEnrollments.map((item, idx) => {
                    const pct = (item.count / maxEnrollment) * 100;
                    return (
                      <div key={idx} className="space-y-1.5 text-xs">
                        <div className="flex justify-between items-center font-semibold">
                          <span className="text-ink">{item.name}</span>
                          <span className="text-muted font-mono">{item.count} élève(s)</span>
                        </div>
                        {/* Custom progress bar */}
                        <div className="h-2 w-full bg-canvas rounded-full overflow-hidden border border-line/30">
                          <div
                            style={{ width: `${pct}%` }}
                            className="h-full bg-primary rounded-full transition-all duration-700"
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CardBody>
          </Card>
        </motion.div>
      )}

      {/* Row 4: Operational Data Columns */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Column 1: Today's school schedule */}
        <Card className={reception ? "lg:col-span-2 border border-line card-shadow" : "border border-line card-shadow"}>
          <CardBody className="space-y-4 p-5">
            <h3 className="font-bold text-ink border-b border-line pb-3 flex items-center gap-2">
              <Clock className="h-4.5 w-4.5 text-primary" /> Séances du Jour ({todaysSchedule.length})
            </h3>

            <div className="space-y-2.5 max-h-72 overflow-y-auto pt-1 pr-1">
              {todaysSchedule.length === 0 ? (
                <p className="text-xs text-muted italic text-center py-12">Aucun cours planifié aujourd'hui.</p>
              ) : (
                todaysSchedule.map((s) => (
                  <div key={s.id} className="flex justify-between items-center p-3 bg-canvas/30 rounded-xl border border-line hover:border-primary/30 transition-colors">
                    <div>
                      <strong className="text-ink font-bold block text-xs">{s.moduleName}</strong>
                      <span className="text-[10px] text-muted block mt-0.5 font-sans">Gr: {s.groupName} | Prof: {s.teacherName}</span>
                      <span className="text-[9px] text-primary font-bold block mt-1">{s.salleName}</span>
                    </div>
                    <Badge tone="primary" className="font-mono text-[10px]">{s.startTime} - {s.endTime}</Badge>
                  </div>
                ))
              )}
            </div>
          </CardBody>
        </Card>

        {/* Column 2: Debtor Students warning list (Admin only) */}
        {!reception && (
          <Card className="border border-line card-shadow">
            <CardBody className="space-y-4 p-5">
              <h3 className="font-bold text-danger border-b border-line pb-3 flex items-center gap-2">
                <AlertTriangle className="h-4.5 w-4.5" /> Étudiants Débiteurs ({severeDebtors.length})
              </h3>

              <div className="space-y-2.5 max-h-72 overflow-y-auto pt-1 pr-1">
                {severeDebtors.length === 0 ? (
                  <div className="text-xs text-success italic text-center py-12 font-bold flex flex-col items-center gap-2">
                    <CheckCircle2 className="h-8 w-8" />
                    <span>Tous les élèves sont à jour de paiement !</span>
                  </div>
                ) : (
                  severeDebtors.map((s) => {
                    const debtAmount = s.balance < 0 ? Math.abs(s.balance) : 0;
                    return (
                      <div key={s.id} className="flex justify-between items-center p-3 bg-danger/5 border border-danger/15 rounded-xl hover:border-danger/30 transition-colors">
                        <div>
                          <strong className="text-ink block text-xs">{s.firstName} {s.lastName}</strong>
                          <span className="text-[9px] text-muted block mt-0.5">{s.phone}</span>
                        </div>
                        <strong className="text-danger font-black text-xs">-{debtAmount} DA</strong>
                      </div>
                    );
                  })
                )}
              </div>
            </CardBody>
          </Card>
        )}

        {/* Column 3: Recent cashier transactions / operational feed */}
        <Card className="border border-line card-shadow">
          <CardBody className="space-y-4 p-5">
            <h3 className="font-bold text-ink border-b border-line pb-3 flex items-center gap-2">
              <Receipt className="h-4.5 w-4.5 text-primary" /> Flux Récent de Caisse
            </h3>

            <div className="space-y-2.5 max-h-72 overflow-y-auto pt-1 pr-1">
              {recentTransactions.length === 0 ? (
                <p className="text-xs text-muted italic text-center py-12">Aucun mouvement de caisse enregistré.</p>
              ) : (
                recentTransactions.map((tx) => (
                  <div key={tx.id} className="flex justify-between items-center p-3 bg-canvas/30 border border-line rounded-xl hover:border-primary/10 transition-colors">
                    <div className="max-w-[70%]">
                      <strong className="text-ink block text-xs truncate font-semibold">{tx.description}</strong>
                      <span className="text-[9px] text-muted block mt-0.5 font-mono">{tx.date.substring(0, 10)}</span>
                    </div>
                    <strong className={`font-black text-xs whitespace-nowrap ${tx.amount > 0 ? "text-success" : "text-danger"}`}>
                      {tx.amount > 0 ? `+${tx.amount}` : tx.amount} DA
                    </strong>
                  </div>
                ))
              )}
            </div>
          </CardBody>
        </Card>
      </motion.div>
    </motion.div>
  );
}
