"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  Edit,
  Eye,
  GraduationCap,
  Layers,
  MapPin,
  MessageCircle,
  Printer,
  Search,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
} from "lucide-react";
import { useData } from "@/lib/store/data";
import { useCanSeeGains } from "@/lib/store/session";
import { useSettings } from "@/lib/store/settings";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { StudentDetailsModal, PayDebtModal } from "@/components/students/StudentDetailsModal";
import {
  WhatsAppMessageModal,
  type WhatsAppRecipient,
  type WhatsAppStudentContext,
} from "@/components/whatsapp/WhatsAppMessageModal";
import {
  COURS_LEVEL_LABELS,
  formatDateFr,
  formatDays,
  isExpiredOpenSeance,
  normalizeSearchText,
  studentDebtOf,
  type StudentDebt,
} from "@/lib/helpers";
import {
  attendanceRate,
  buildSessionStats,
  RECENT_DAYS,
  sessionsOfClass,
  summarizeClass,
  type SessionStat,
  type StudentInSession,
} from "@/lib/classStats";
import { buildClassRosterCsv, buildClassRosterReport, type RosterRow } from "@/lib/reports/classRoster";
import { printHtmlDocument } from "@/lib/print";
import { isSendablePhone } from "@/lib/whatsapp/phone";
import type { ScheduleSession, SchoolClass, Student } from "@/lib/types";

/**
 * LA FICHE D'UNE CLASSE.
 *
 * Elle répond, dans cet ordre, aux questions qu'on se pose en l'ouvrant :
 *
 *   1. combien d'élèves, combien d'emplois du temps, combien d'argent dû ?
 *   2. quels sont ses emplois du temps (module, groupe, jours, enseignant) ?
 *   3. pour UN emploi du temps : qui y est inscrit, qui DOIT de l'argent —
 *      en alerte, avec de quoi ouvrir sa fiche ou encaisser tout de suite.
 *
 * La fiche d'un élève ouverte d'ici est EXACTEMENT celle de l'écran Étudiants
 * (même composant) : même onglets, mêmes corrections, même dette.
 */

type StudentFilter = "all" | "debt" | "ok" | "absent";
type SortKey = "debt" | "name" | "balance" | "presences";
const OVERVIEW = "__overview__";

interface Row {
  student: Student;
  debt: StudentDebt;
  /** sur l'emploi du temps choisi (absent en vue d'ensemble) */
  inSession?: StudentInSession;
  /** en vue d'ensemble : les emplois du temps de la classe suivis par l'élève */
  sessionCount?: number;
}

export function ClassDetailsModal({
  classId,
  onClose,
  onEdit,
}: {
  classId: string | null;
  onClose: () => void;
  onEdit?: (cls: SchoolClass) => void;
}) {
  const cls = useData((s) => (classId ? s.classes.find((c) => c.id === classId) : undefined));
  return (
    <Modal
      open={!!classId}
      onClose={onClose}
      size="full"
      title={cls ? `Classe — ${cls.name}` : "Classe"}
      subtitle="Emplois du temps, élèves inscrits, dettes et paiements"
    >
      {classId && cls ? (
        <ClassDetailsBody key={classId} cls={cls} onClose={onClose} onEdit={onEdit} />
      ) : (
        <p className="text-sm text-muted">Cette classe n&apos;existe plus.</p>
      )}
    </Modal>
  );
}

function ClassDetailsBody({
  cls,
  onClose,
  onEdit,
}: {
  cls: SchoolClass;
  onClose: () => void;
  onEdit?: (cls: SchoolClass) => void;
}) {
  const {
    school,
    filieres,
    sessions,
    subscriptions,
    students,
    attendance,
    absencePenalties,
    unpaidTeacher,
    modules,
    groups,
    salles,
    teachers,
    parents,
  } = useData(
    useShallow((s) => ({
      school: s.school,
      filieres: s.filieres,
      sessions: s.sessions,
      subscriptions: s.subscriptions,
      students: s.students,
      attendance: s.attendance,
      absencePenalties: s.absencePenalties,
      unpaidTeacher: s.unpaidTeacher,
      modules: s.modules,
      groups: s.groups,
      salles: s.salles,
      teachers: s.teachers,
      parents: s.parents,
    })),
  );
  const canSeeGains = useCanSeeGains();
  const language = useSettings((s) => s.language);

  // ---- Ce qui est affiché -------------------------------------------------------
  const [selected, setSelected] = useState<string>(OVERVIEW);
  const [filter, setFilter] = useState<StudentFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("debt");
  const [showEnded, setShowEnded] = useState(false);

  // ---- Fenêtres ouvertes depuis la fiche -----------------------------------------
  const [detailsStudentId, setDetailsStudentId] = useState<string | null>(null);
  const [payDebtStudentId, setPayDebtStudentId] = useState<string | null>(null);
  const [waTarget, setWaTarget] = useState<{
    recipients: WhatsAppRecipient[];
    students: WhatsAppStudentContext[];
    defaultRecipientIds: string[];
  } | null>(null);

  // ---- Index ----------------------------------------------------------------------
  const lookups = useMemo(
    () => ({
      module: new Map(modules.map((m) => [m.id, m.name])),
      group: new Map(groups.map((g) => [g.id, g.name])),
      salle: new Map(salles.map((s) => [s.id, s.name])),
      teacher: new Map(teachers.map((t) => [t.id, `${t.firstName} ${t.lastName}`])),
      student: new Map(students.map((s) => [s.id, s])),
      parent: new Map(parents.map((p) => [p.id, p])),
      price: new Map(subscriptions.map((sub) => [sub.sessionId, sub.pricePerSession])),
    }),
    [modules, groups, salles, teachers, students, parents, subscriptions],
  );

  const filiereName = cls.filiereId ? filieres.find((f) => f.id === cls.filiereId)?.name ?? "" : "";

  // ---- Les emplois du temps de la classe, et leurs chiffres ------------------------
  const allClassSessions = useMemo(() => sessionsOfClass(sessions, cls.id), [sessions, cls.id]);
  const endedCount = allClassSessions.filter((s) => isExpiredOpenSeance(s)).length;
  const classSessions = useMemo(
    () =>
      allClassSessions
        .filter((s) => showEnded || !isExpiredOpenSeance(s))
        .sort((a, b) => {
          const ma = lookups.module.get(a.moduleId) ?? "";
          const mb = lookups.module.get(b.moduleId) ?? "";
          return ma.localeCompare(mb) || a.startTime.localeCompare(b.startTime);
        }),
    [allClassSessions, showEnded, lookups],
  );

  const debtById = useMemo(() => {
    const map = new Map<string, StudentDebt>();
    for (const s of students) map.set(s.id, studentDebtOf(s));
    return map;
  }, [students]);

  const stats = useMemo(
    () =>
      buildSessionStats({
        sessions: allClassSessions,
        subscriptions,
        students,
        attendance,
        absencePenalties,
        unpaidTeacher,
        debtOf: (s) => debtById.get(s.id) ?? studentDebtOf(s),
      }),
    [allClassSessions, subscriptions, students, attendance, absencePenalties, unpaidTeacher, debtById],
  );

  const summary = useMemo(
    () => summarizeClass(classSessions, stats, (id) => debtById.get(id)),
    [classSessions, stats, debtById],
  );

  // Une vue sur un créneau masqué (séance libre terminée) retombe sur l'ensemble.
  const selectedSession =
    selected === OVERVIEW ? undefined : classSessions.find((s) => s.id === selected);
  const selectedStat = selectedSession ? stats.get(selectedSession.id) : undefined;

  // ---- Libellés ----------------------------------------------------------------------
  const sessionTitle = (s: ScheduleSession) =>
    s.isOpen && s.title
      ? s.title
      : `${lookups.module.get(s.moduleId) ?? "Module"}${lookups.group.get(s.groupId) ? ` · ${lookups.group.get(s.groupId)}` : ""}`;
  const sessionLine = (s: ScheduleSession) =>
    [
      `${formatDays(s.days)} ${s.startTime}-${s.endTime}`,
      lookups.teacher.get(s.teacherId),
      lookups.salle.get(s.salleId) ? `Salle ${lookups.salle.get(s.salleId)}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  const classMeta = [
    cls.type === "cours" ? (cls.coursLevel ? COURS_LEVEL_LABELS[cls.coursLevel] : "") : "Formation",
    cls.type === "cours" && cls.year ? `${cls.year} Année` : cls.formationLevel ? `Niveau ${cls.formationLevel}` : "",
    filiereName,
  ].filter(Boolean);

  // ---- Les élèves affichés --------------------------------------------------------
  const rows: Row[] = useMemo(() => {
    if (selectedSession && selectedStat) {
      return selectedStat.studentIds
        .map((id) => lookups.student.get(id))
        .filter((s): s is Student => !!s)
        .map((student) => ({
          student,
          debt: debtById.get(student.id) ?? studentDebtOf(student),
          inSession: selectedStat.perStudent.get(student.id),
        }));
    }
    // Vue d'ensemble : chaque élève une fois, avec le nombre de créneaux suivis.
    const count = new Map<string, number>();
    for (const s of classSessions) {
      for (const id of stats.get(s.id)?.studentIds ?? []) count.set(id, (count.get(id) ?? 0) + 1);
    }
    return [...count.keys()]
      .map((id) => lookups.student.get(id))
      .filter((s): s is Student => !!s)
      .map((student) => ({
        student,
        debt: debtById.get(student.id) ?? studentDebtOf(student),
        sessionCount: count.get(student.id),
      }));
  }, [selectedSession, selectedStat, classSessions, stats, lookups, debtById]);

  const debtorRows = useMemo(
    () => rows.filter((r) => r.debt.alert).sort((a, b) => b.debt.total - a.debt.total),
    [rows],
  );

  const shownRows = useMemo(() => {
    const q = normalizeSearchText(search.trim());
    const out = rows.filter((r) => {
      if (filter === "debt" && !r.debt.alert) return false;
      if (filter === "ok" && r.debt.alert) return false;
      if (filter === "absent" && !((r.inSession?.absences ?? 0) > 0)) return false;
      if (!q) return true;
      const s = r.student;
      return (
        normalizeSearchText(`${s.firstName} ${s.lastName}`).includes(q) ||
        s.phone.includes(search.trim()) ||
        (s.rfid ?? "").toLowerCase().includes(q)
      );
    });
    const name = (r: Row) => `${r.student.lastName} ${r.student.firstName}`.toLowerCase();
    out.sort((a, b) => {
      if (sort === "name") return name(a).localeCompare(name(b));
      if (sort === "balance") return a.student.balance - b.student.balance || name(a).localeCompare(name(b));
      if (sort === "presences")
        return (b.inSession?.presences ?? 0) - (a.inSession?.presences ?? 0) || name(a).localeCompare(name(b));
      return b.debt.total - a.debt.total || name(a).localeCompare(name(b));
    });
    return out;
  }, [rows, filter, search, sort]);

  // ---- Chiffres de tête du panneau ------------------------------------------------
  const panel = selectedStat
    ? {
        students: selectedStat.studentIds.length,
        debtors: selectedStat.debtorIds.length,
        totalDebt: selectedStat.totalDebt,
        totalPaid: selectedStat.totalPaid,
        teacherDue: selectedStat.teacherDue,
        rate: attendanceRate(selectedStat.presencesRecent, selectedStat.absencesRecent),
        seances: selectedStat.seancesHeld,
      }
    : {
        students: summary.studentIds.length,
        debtors: summary.debtorIds.length,
        totalDebt: summary.totalDebt,
        totalPaid: summary.totalPaid,
        teacherDue: summary.teacherDue,
        rate: attendanceRate(summary.presencesRecent, summary.absencesRecent),
        seances: classSessions.reduce((sum, s) => sum + (stats.get(s.id)?.seancesHeld ?? 0), 0),
      };

  // ---- Actions ---------------------------------------------------------------------
  const openWhatsApp = (stu: Student) => {
    const parent = stu.parentId ? lookups.parent.get(stu.parentId) : undefined;
    const name = `${stu.firstName} ${stu.lastName}`;
    const recipients: WhatsAppRecipient[] = [{ id: `student-${stu.id}`, name, phone: stu.phone, role: "student" }];
    if (parent) {
      recipients.push({
        id: `parent-${parent.id}`,
        name: `${parent.firstName} ${parent.lastName}`,
        phone: parent.phone,
        role: "parent",
      });
    }
    setWaTarget({
      recipients,
      students: [{ id: stu.id, name, balance: stu.balance, registrationDue: stu.registrationDue }],
      // Une relance de dette s'adresse d'abord au parent, quand il y en a un.
      defaultRecipientIds: [parent && isSendablePhone(parent.phone) ? `parent-${parent.id}` : `student-${stu.id}`],
    });
  };

  const rosterRows = (list: Row[]): RosterRow[] =>
    list.map((r) => ({
      name: `${r.student.firstName} ${r.student.lastName}`,
      phone: r.student.phone,
      card: r.student.rfid,
      balance: r.student.balance,
      debt: r.debt.total,
      presences: r.inSession?.presences ?? 0,
      absences: r.inSession?.absences ?? 0,
      lastPresence: r.inSession?.lastPresence,
    }));

  const rosterInfo = () => ({
    className: [cls.name, ...classMeta.filter((m) => !cls.name.includes(m))].join(" · "),
    scheduleLabel: selectedSession ? `${sessionTitle(selectedSession)} — ${sessionLine(selectedSession)}` : undefined,
    figures: [
      { label: "Élèves", value: String(panel.students) },
      { label: "En dette", value: String(panel.debtors) },
      { label: "Dettes", value: `${panel.totalDebt} DA` },
      ...(canSeeGains ? [{ label: "Payé (séances)", value: `${panel.totalPaid} DA` }] : []),
      { label: `Présence ${RECENT_DAYS} j`, value: panel.rate === null ? "—" : `${panel.rate} %` },
    ],
  });

  const printList = (debtorsOnly: boolean) =>
    printHtmlDocument(
      buildClassRosterReport({
        school,
        lang: language,
        info: rosterInfo(),
        rows: rosterRows(debtorsOnly ? debtorRows : shownRows),
        debtorsOnly,
      }),
    );

  const exportCsv = () => {
    const csv = buildClassRosterCsv(rosterRows(shownRows));
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const slug = `${cls.name}${selectedSession ? `-${sessionTitle(selectedSession)}` : ""}`
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .toLowerCase();
    a.download = `eleves-${slug}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const counts = {
    all: rows.length,
    debt: debtorRows.length,
    ok: rows.length - debtorRows.length,
    absent: rows.filter((r) => (r.inSession?.absences ?? 0) > 0).length,
  };

  return (
    <div className="space-y-5">
      {/* ================= EN-TÊTE ================= */}
      <div className="relative overflow-hidden rounded-2xl border border-line bg-gradient-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-primary text-2xl text-white card-shadow">
              🏫
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="break-words text-xl font-black text-ink">{cls.name}</h3>
                <Badge tone={cls.type === "cours" ? "primary" : "success"}>
                  {cls.type === "cours" ? "Cours" : "Formation"}
                </Badge>
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {classMeta.map((m) => (
                  <span key={m} className="rounded-lg border border-line bg-surface px-2 py-0.5 text-[11px] font-semibold text-muted">
                    {m}
                  </span>
                ))}
              </div>
              {cls.description && <p className="mt-2 max-w-2xl text-xs text-muted">{cls.description}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => printList(false)} title="Imprimer la liste des élèves affichés">
              <Printer className="h-3.5 w-3.5" /> Imprimer la liste
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => printList(true)}
              disabled={debtorRows.length === 0}
              title="Imprimer la liste des élèves en dette (pour les relances)"
              className="border-danger/40 text-danger hover:bg-danger/10"
            >
              <AlertTriangle className="h-3.5 w-3.5" /> Imprimer les débiteurs
            </Button>
            <Button size="sm" variant="outline" onClick={exportCsv} title="Exporter la liste affichée (Excel)">
              <Download className="h-3.5 w-3.5" /> Exporter
            </Button>
            {onEdit && (
              <Button size="sm" variant="outline" onClick={() => onEdit(cls)}>
                <Edit className="h-3.5 w-3.5" /> Modifier
              </Button>
            )}
          </div>
        </div>

        {/* Chiffres de la CLASSE entière */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Tile icon={<Users className="h-4 w-4" />} label="Élèves inscrits" value={summary.studentIds.length} tone="primary" />
          <Tile
            icon={<CalendarDays className="h-4 w-4" />}
            label="Emplois du temps"
            value={classSessions.length}
            hint={`${summary.moduleIds.length} module(s) · ${summary.teacherIds.length} enseignant(s)`}
            tone="neutral"
          />
          <Tile
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Élèves en dette"
            value={summary.debtorIds.length}
            tone={summary.debtorIds.length > 0 ? "danger" : "success"}
            pulse={summary.debtorIds.length > 0}
          />
          <Tile
            icon={<Wallet className="h-4 w-4" />}
            label="Dette totale"
            value={`${summary.totalDebt} DA`}
            tone={summary.totalDebt > 0 ? "danger" : "success"}
          />
          {canSeeGains ? (
            <Tile
              icon={<TrendingUp className="h-4 w-4" />}
              label="Total payé (séances)"
              value={`${summary.totalPaid} DA`}
              tone="success"
            />
          ) : (
            <Tile
              icon={<CheckCircle2 className="h-4 w-4" />}
              label="Séances tenues"
              value={classSessions.reduce((sum, s) => sum + (stats.get(s.id)?.seancesHeld ?? 0), 0)}
              tone="success"
            />
          )}
          <Tile
            icon={<UserCheck className="h-4 w-4" />}
            label={`Présence (${RECENT_DAYS} j)`}
            value={(() => {
              const r = attendanceRate(summary.presencesRecent, summary.absencesRecent);
              return r === null ? "—" : `${r} %`;
            })()}
            hint={`${summary.presencesRecent} présence(s) · ${summary.absencesRecent} absence(s)`}
            tone="warning"
          />
        </div>
      </div>

      {/* ================= CORPS : emplois du temps | panneau ================= */}
      <div className="grid gap-5 lg:grid-cols-[minmax(260px,340px)_1fr]">
        {/* ---------- Liste des emplois du temps ---------- */}
        <aside className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="flex items-center gap-2 text-sm font-bold text-ink">
              <CalendarDays className="h-4 w-4 text-primary" /> Emplois du temps ({classSessions.length})
            </h4>
            {endedCount > 0 && (
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
                <input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} />
                Terminées ({endedCount})
              </label>
            )}
          </div>

          <div className="space-y-2 lg:max-h-[62vh] lg:overflow-y-auto lg:pe-1">
            <button
              type="button"
              onClick={() => setSelected(OVERVIEW)}
              className={`w-full rounded-2xl border p-3 text-start transition-all ${
                selected === OVERVIEW || !selectedSession
                  ? "border-primary bg-primary-50 shadow-sm ring-2 ring-primary/20"
                  : "border-line bg-surface hover:border-primary/40 hover:bg-primary-50/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-bold text-ink">
                  <Layers className="h-4 w-4 text-primary" /> Toute la classe
                </span>
                <Badge tone="primary">{summary.studentIds.length} élèves</Badge>
              </div>
              <p className="mt-1 text-[11px] text-muted">Vue d&apos;ensemble : tous les élèves et toutes les dettes.</p>
            </button>

            {classSessions.length === 0 && (
              <div className="rounded-2xl border border-dashed border-line p-5 text-center text-xs text-muted">
                Aucun emploi du temps pour cette classe. Créez-en un depuis le Planner.
              </div>
            )}

            {classSessions.map((s) => {
              const st = stats.get(s.id);
              const active = selectedSession?.id === s.id;
              const debtors = st?.debtorIds.length ?? 0;
              const ended = isExpiredOpenSeance(s);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSelected(s.id);
                    setFilter("all");
                  }}
                  className={`group w-full rounded-2xl border p-3 text-start transition-all ${
                    active
                      ? "border-primary bg-primary-50 shadow-sm ring-2 ring-primary/20"
                      : debtors > 0
                        ? "border-danger/30 bg-surface hover:border-danger/60 hover:bg-danger/5"
                        : "border-line bg-surface hover:border-primary/40 hover:bg-primary-50/40"
                  } ${ended ? "opacity-60" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{sessionTitle(s)}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
                        <Clock className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          {formatDays(s.days)} · {s.startTime}-{s.endTime}
                        </span>
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-muted">
                        {lookups.teacher.get(s.teacherId) ?? "—"}
                        {lookups.salle.get(s.salleId) ? ` · Salle ${lookups.salle.get(s.salleId)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="rounded-lg bg-primary/10 px-2 py-0.5 text-[11px] font-black text-primary">
                        {st?.studentIds.length ?? 0} élèves
                      </span>
                      {debtors > 0 && (
                        <span className="flex items-center gap-1 rounded-lg bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white">
                          <AlertTriangle className="h-3 w-3 animate-pulse" /> {debtors}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {s.isOpen && <Badge tone="warning" className="text-[9px]">Séance libre</Badge>}
                    {s.isFree && <Badge tone="success" className="text-[9px]">Offerte</Badge>}
                    {ended && <Badge tone="neutral" className="text-[9px]">Terminée</Badge>}
                    {(st?.totalDebt ?? 0) > 0 && (
                      <span className="text-[10px] font-bold text-danger">Dettes : {st?.totalDebt} DA</span>
                    )}
                    {lookups.price.get(s.id) !== undefined && (
                      <span className="ms-auto text-[10px] text-muted">{lookups.price.get(s.id)} DA / séance</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* ---------- Panneau : l'emploi du temps choisi (ou la classe) ---------- */}
        <motion.section
          key={selectedSession?.id ?? OVERVIEW}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="min-w-0 space-y-4"
        >
          <div className="rounded-2xl border border-line bg-surface p-4">
            {selectedSession ? (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-primary">Emploi du temps</p>
                  <h4 className="truncate text-lg font-black text-ink">{sessionTitle(selectedSession)}</h4>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    <span className="flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" /> {formatDays(selectedSession.days)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" /> {selectedSession.startTime}-{selectedSession.endTime}
                    </span>
                    <span className="flex items-center gap-1">
                      <GraduationCap className="h-3.5 w-3.5" /> {lookups.teacher.get(selectedSession.teacherId) ?? "—"}
                    </span>
                    {lookups.salle.get(selectedSession.salleId) && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" /> Salle {lookups.salle.get(selectedSession.salleId)}
                      </span>
                    )}
                    {lookups.price.get(selectedSession.id) !== undefined && (
                      <span className="flex items-center gap-1">
                        <Wallet className="h-3.5 w-3.5" /> {lookups.price.get(selectedSession.id)} DA / séance
                      </span>
                    )}
                  </div>
                  {(selectedSession.periodStart || selectedSession.billingStartDate) && (
                    <p className="mt-1 text-[11px] text-muted">
                      {selectedSession.periodStart &&
                        `Période : ${formatDateFr(selectedSession.periodStart)} → ${formatDateFr(selectedSession.periodEnd)}. `}
                      {selectedSession.billingStartDate &&
                        `Facturation à partir du ${formatDateFr(selectedSession.billingStartDate)}.`}
                    </p>
                  )}
                </div>
                {selectedStat?.lastSeanceDate && (
                  <Badge tone="neutral" className="text-[10px]">
                    Dernière séance pointée : {formatDateFr(selectedStat.lastSeanceDate)}
                  </Badge>
                )}
              </div>
            ) : (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-primary">Vue d&apos;ensemble</p>
                <h4 className="text-lg font-black text-ink">Tous les élèves de la classe</h4>
                <p className="text-xs text-muted">
                  Choisissez un emploi du temps à gauche pour voir ses seuls élèves, ses dettes et ses paiements.
                </p>
              </div>
            )}

            {/* Chiffres du panneau */}
            <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(118px,1fr))] gap-3">
              <Tile icon={<Users className="h-4 w-4" />} label="Total élèves" value={panel.students} tone="primary" />
              <Tile
                icon={<Wallet className="h-4 w-4" />}
                label="Total dettes"
                value={`${panel.totalDebt} DA`}
                hint="solde négatif + inscription due"
                tone={panel.totalDebt > 0 ? "danger" : "success"}
              />
              {canSeeGains && (
                <Tile
                  icon={<TrendingUp className="h-4 w-4" />}
                  label="Total payé"
                  value={`${panel.totalPaid} DA`}
                  hint="débité sur les séances"
                  tone="success"
                />
              )}
              <Tile
                icon={<AlertTriangle className="h-4 w-4" />}
                label="Élèves en dette"
                value={panel.debtors}
                tone={panel.debtors > 0 ? "danger" : "success"}
                pulse={panel.debtors > 0}
              />
              <Tile
                icon={<UserCheck className="h-4 w-4" />}
                label={`Présence (${RECENT_DAYS} j)`}
                value={panel.rate === null ? "—" : `${panel.rate} %`}
                tone="warning"
              />
              <Tile icon={<CheckCircle2 className="h-4 w-4" />} label="Séances tenues" value={panel.seances} tone="neutral" />
              {canSeeGains && panel.teacherDue > 0 && (
                <Tile
                  icon={<BookOpen className="h-4 w-4" />}
                  label="Dû à l'enseignant"
                  value={`${panel.teacherDue} DA`}
                  tone="warning"
                />
              )}
            </div>
          </div>

          {/* Répartition par emploi du temps (vue d'ensemble seulement) */}
          {!selectedSession && classSessions.length > 1 && (
            <SessionBreakdown
              sessions={classSessions}
              stats={stats}
              title={sessionTitle}
              onPick={(id) => setSelected(id)}
            />
          )}

          {/* ---------- LES DÉBITEURS, en alerte ---------- */}
          {debtorRows.length > 0 && (
            <div className="overflow-hidden rounded-2xl border-2 border-danger/40 bg-danger/5">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-gradient-danger px-4 py-3 text-white">
                <span className="flex items-center gap-2 text-sm font-black">
                  <AlertTriangle className="h-5 w-5 animate-pulse" />
                  {debtorRows.length} élève(s) en dette
                  {selectedSession ? " sur cet emploi du temps" : " dans la classe"} —{" "}
                  {debtorRows.reduce((sum, r) => sum + r.debt.total, 0)} DA à recouvrer
                </span>
                <button
                  type="button"
                  onClick={() => setFilter("debt")}
                  className="rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-bold hover:bg-white/25"
                >
                  N&apos;afficher qu&apos;eux dans la liste
                </button>
              </div>
              <div className="grid gap-2 p-3 md:grid-cols-2">
                {debtorRows.slice(0, 12).map((r) => (
                  <div
                    key={r.student.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger/25 bg-surface p-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar student={r.student} danger />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-ink">
                          {r.student.firstName} {r.student.lastName}
                        </p>
                        <p className="truncate text-[10px] text-danger">
                          {[
                            r.debt.sessions > 0 ? `Séances : ${r.debt.sessions} DA` : "",
                            r.debt.registration > 0 ? `Inscription : ${r.debt.registration} DA` : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                    </div>
                    <div className="ms-auto flex shrink-0 items-center gap-1">
                      <span className="me-1 text-xs font-black text-danger">{r.debt.total} DA</span>
                      <IconButton title="Voir la fiche de l'élève" onClick={() => setDetailsStudentId(r.student.id)}>
                        <Eye className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        title="Régler la dette"
                        tone="danger"
                        onClick={() => setPayDebtStudentId(r.student.id)}
                      >
                        <Wallet className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        title="Relancer par WhatsApp"
                        tone="success"
                        onClick={() => openWhatsApp(r.student)}
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  </div>
                ))}
              </div>
              {debtorRows.length > 12 && (
                <p className="px-4 pb-3 text-[11px] text-danger">
                  … et {debtorRows.length - 12} autre(s) : filtrez la liste ci-dessous sur « En dette ».
                </p>
              )}
            </div>
          )}

          {/* ---------- LA LISTE ---------- */}
          <div className="rounded-2xl border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
              <div className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted ltr:left-3 rtl:right-3" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher un élève (nom, téléphone, carte)…"
                  className="ltr:pl-9 rtl:pr-9"
                />
              </div>
              <div className="flex flex-wrap gap-1">
                <FilterChip active={filter === "all"} onClick={() => setFilter("all")} count={counts.all}>
                  Tous
                </FilterChip>
                <FilterChip active={filter === "debt"} onClick={() => setFilter("debt")} count={counts.debt} danger>
                  En dette
                </FilterChip>
                <FilterChip active={filter === "ok"} onClick={() => setFilter("ok")} count={counts.ok}>
                  À jour
                </FilterChip>
                {selectedSession && (
                  <FilterChip active={filter === "absent"} onClick={() => setFilter("absent")} count={counts.absent}>
                    Avec absences
                  </FilterChip>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <ArrowDownWideNarrow className="h-4 w-4 text-muted" />
                <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-9 text-xs">
                  <option value="debt">Dette (la plus forte)</option>
                  <option value="name">Nom (A → Z)</option>
                  <option value="balance">Solde (le plus bas)</option>
                  {selectedSession && <option value="presences">Présences</option>}
                </Select>
              </div>
            </div>

            {/* En-têtes (écran large) */}
            <div className="hidden grid-cols-[minmax(0,2.2fr)_1.1fr_0.9fr_0.9fr_1.2fr_210px] gap-3 border-b border-line bg-canvas/50 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-muted md:grid">
              <span>Élève</span>
              <span>Téléphone</span>
              <span className="text-end">Solde</span>
              <span className="text-end">Dette</span>
              <span>{selectedSession ? "Présences" : "Emplois du temps"}</span>
              <span className="text-end">Actions</span>
            </div>

            <div className="max-h-[52vh] divide-y divide-line overflow-y-auto">
              {shownRows.length === 0 && (
                <p className="p-8 text-center text-xs text-muted">
                  {rows.length === 0
                    ? "Aucun élève inscrit à cet emploi du temps."
                    : "Aucun élève ne correspond à ces filtres."}
                </p>
              )}
              {shownRows.map((r) => (
                <StudentLine
                  key={r.student.id}
                  row={r}
                  inSessionView={!!selectedSession}
                  onDetails={() => setDetailsStudentId(r.student.id)}
                  onPay={() => setPayDebtStudentId(r.student.id)}
                  onWhatsApp={() => openWhatsApp(r.student)}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-[11px] text-muted">
              <span>
                {shownRows.length} élève(s) affiché(s) sur {rows.length}
              </span>
              <span>
                Dette des élèves affichés :{" "}
                <strong className="text-danger">{shownRows.reduce((sum, r) => sum + r.debt.total, 0)} DA</strong>
              </span>
            </div>
          </div>
        </motion.section>
      </div>

      <div className="flex justify-end border-t border-line pt-3">
        <Button onClick={onClose}>Fermer</Button>
      </div>

      {/* La fiche élève : exactement celle de l'écran Étudiants. */}
      <StudentDetailsModal
        studentId={detailsStudentId}
        open={!!detailsStudentId}
        onClose={() => setDetailsStudentId(null)}
      />
      <PayDebtModal studentId={payDebtStudentId} onClose={() => setPayDebtStudentId(null)} />
      {waTarget && (
        <WhatsAppMessageModal
          onClose={() => setWaTarget(null)}
          recipients={waTarget.recipients}
          students={waTarget.students}
          defaultRecipientIds={waTarget.defaultRecipientIds}
        />
      )}
    </div>
  );
}

// =============================================================================
// Pièces de l'écran
// =============================================================================

const TONES = {
  primary: { icon: "bg-primary/15 text-primary", value: "text-primary" },
  success: { icon: "bg-success/15 text-success", value: "text-success" },
  warning: { icon: "bg-warning/15 text-warning", value: "text-warning" },
  danger: { icon: "bg-danger/15 text-danger", value: "text-danger" },
  neutral: { icon: "bg-muted/15 text-muted", value: "text-ink" },
} as const;

function Tile({
  icon,
  label,
  value,
  hint,
  tone,
  pulse,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  hint?: string;
  tone: keyof typeof TONES;
  pulse?: boolean;
}) {
  const t = TONES[tone];
  return (
    <div
      className={`rounded-2xl border bg-surface p-3 card-shadow ${
        tone === "danger" && pulse ? "border-danger/40" : "border-line"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${t.icon} ${pulse ? "animate-pulse" : ""}`}>
          {icon}
        </span>
        <span className="text-[10px] font-bold uppercase leading-tight tracking-wide text-muted">{label}</span>
      </div>
      <p className={`mt-2 text-lg font-black ${t.value}`}>{value}</p>
      {hint && <p className="text-[10px] leading-tight text-muted">{hint}</p>}
    </div>
  );
}

function Avatar({ student, danger }: { student: Student; danger?: boolean }) {
  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-black ${
        danger ? "bg-danger/15 text-danger" : "bg-primary/10 text-primary"
      }`}
    >
      {student.firstName.substring(0, 1)}
      {student.lastName.substring(0, 1)}
    </div>
  );
}

function IconButton({
  title,
  onClick,
  children,
  tone = "primary",
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  tone?: "primary" | "danger" | "success";
}) {
  const color = {
    primary: "text-primary hover:bg-primary/10",
    danger: "text-danger hover:bg-danger/10",
    success: "text-success hover:bg-success/10",
  }[tone];
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface transition-colors ${color}`}
    >
      {children}
    </button>
  );
}

function FilterChip({
  active,
  onClick,
  count,
  danger,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors ${
        active
          ? danger
            ? "border-danger bg-danger text-white"
            : "border-primary bg-gradient-primary text-white"
          : "border-line bg-surface text-ink hover:bg-primary-50/60"
      }`}
    >
      {children}
      <span
        className={`rounded-md px-1.5 text-[10px] font-black ${
          active ? "bg-white/25" : danger && count > 0 ? "bg-danger/15 text-danger" : "bg-muted/15 text-muted"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function StudentLine({
  row,
  inSessionView,
  onDetails,
  onPay,
  onWhatsApp,
}: {
  row: Row;
  inSessionView: boolean;
  onDetails: () => void;
  onPay: () => void;
  onWhatsApp: () => void;
}) {
  const { student, debt, inSession } = row;
  const inDebt = debt.alert;
  return (
    <div
      className={`grid grid-cols-1 gap-2 px-4 py-2.5 text-xs md:grid-cols-[minmax(0,2.2fr)_1.1fr_0.9fr_0.9fr_1.2fr_210px] md:items-center md:gap-3 ${
        inDebt ? "bg-danger/5" : ""
      }`}
    >
      <button type="button" onClick={onDetails} className="flex min-w-0 items-center gap-2 text-start">
        <Avatar student={student} danger={inDebt} />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate font-bold text-ink hover:text-primary">
            {inDebt && <AlertTriangle className="h-3.5 w-3.5 shrink-0 animate-pulse text-danger" />}
            <span className="truncate">
              {student.firstName} {student.lastName}
            </span>
          </p>
          <p className="truncate text-[10px] text-muted">Carte {student.rfid || "—"}</p>
        </div>
      </button>
      <span className="text-muted md:text-ink">{student.phone || "—"}</span>
      <span className={`font-bold md:text-end ${student.balance < 0 ? "text-danger" : "text-success"}`}>
        <span className="me-1 text-[10px] font-normal text-muted md:hidden">Solde :</span>
        {student.isFree ? "Gratuit" : `${student.balance} DA`}
      </span>
      <span className={`font-black md:text-end ${inDebt ? "text-danger" : "text-muted"}`}>
        <span className="me-1 text-[10px] font-normal text-muted md:hidden">Dette :</span>
        {inDebt ? `${debt.total} DA` : "—"}
      </span>
      <span className="text-muted">
        {inSessionView ? (
          <>
            <strong className="text-success">{inSession?.presences ?? 0}</strong> prés. ·{" "}
            <strong className={(inSession?.absences ?? 0) > 0 ? "text-danger" : "text-muted"}>
              {inSession?.absences ?? 0}
            </strong>{" "}
            abs.
            {inSession?.lastPresence && (
              <span className="block text-[10px]">Dernière : {formatDateFr(inSession.lastPresence.slice(0, 10))}</span>
            )}
          </>
        ) : (
          <>{row.sessionCount ?? 0} emploi(s) du temps</>
        )}
      </span>
      <div className="flex items-center gap-1 md:justify-end">
        <Button size="sm" variant="outline" onClick={onDetails} title="Ouvrir la fiche de l'élève">
          <Eye className="h-3.5 w-3.5" /> Détails
        </Button>
        {inDebt && (
          <Button size="sm" variant="danger" onClick={onPay} title="Encaisser un règlement de dette">
            Régler
          </Button>
        )}
        <IconButton title="Message WhatsApp" tone="success" onClick={onWhatsApp}>
          <MessageCircle className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
  );
}

/** Comparaison des emplois du temps de la classe : élèves et dettes. */
function SessionBreakdown({
  sessions,
  stats,
  title,
  onPick,
}: {
  sessions: ScheduleSession[];
  stats: Map<string, SessionStat>;
  title: (s: ScheduleSession) => string;
  onPick: (id: string) => void;
}) {
  const max = Math.max(1, ...sessions.map((s) => stats.get(s.id)?.studentIds.length ?? 0));
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h5 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink">
        <Users className="h-4 w-4 text-primary" /> Élèves par emploi du temps
      </h5>
      <div className="space-y-2.5">
        {sessions.map((s) => {
          const st = stats.get(s.id);
          const n = st?.studentIds.length ?? 0;
          const debtors = st?.debtorIds.length ?? 0;
          return (
            <button key={s.id} type="button" onClick={() => onPick(s.id)} className="block w-full text-start">
              <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate font-semibold text-ink">{title(s)}</span>
                <span className="shrink-0 text-muted">
                  {n} élève(s)
                  {debtors > 0 && <strong className="ms-1 text-danger">· {debtors} en dette</strong>}
                </span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-canvas">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${((n - debtors) / max) * 100}%` }}
                />
                <div
                  className="h-full bg-danger transition-all duration-500"
                  style={{ width: `${(debtors / max) * 100}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>
      <p className="mt-3 flex items-center gap-3 text-[10px] text-muted">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-primary" /> à jour
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-danger" /> en dette
        </span>
      </p>
    </div>
  );
}
