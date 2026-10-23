"use client";

import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  CalendarCheck,
  CalendarPlus,
  CalendarX,
  Clock,
  Edit,
  History,
  Info,
  ListChecks,
  Plus,
  Receipt,
  Scale,
  Trash2,
  UserCheck,
  Wrench,
} from "lucide-react";
import { useData } from "@/lib/store/data";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/lib/store/toast";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import {
  DeleteAttendanceDialog,
  DeletePenaltyDialog,
  DeleteTxDialog,
  EditAttendanceDialog,
  EditTxDialog,
  TX_TYPE_LABELS,
} from "@/components/students/LedgerDialogs";
import {
  DAY_LABELS_FR,
  dayOfIsoDate,
  formatDays,
  freeReasonOf,
  FREE_REASON_LABELS,
  isoFromSchoolInput,
  schoolDateKey,
  schoolDateTimeInput,
  schoolDateTimeLabel,
  studentSeancePrice,
} from "@/lib/helpers";
import {
  absenceWeekOf,
  chargesWithoutPresence,
  contradictedPenalties,
  frDay,
  historyTotal,
  isAbsenceTx,
  pairAbsenceLines,
  presencesInPenaltyWeek,
} from "@/lib/studentRepair";
import type {
  AbsencePenalty,
  AttendanceRecord,
  BalanceTransaction,
  BalanceTxType,
  ScheduleSession,
  Student,
  Subscription,
} from "@/lib/types";

/**
 * « RÉGULARISER LA SITUATION » D'UN ÉLÈVE.
 *
 * Tout ce qui fait son solde, sur une seule page : versements, débits,
 * présences, absences facturées — chacun modifiable ou supprimable — plus ce
 * qui manque (un versement oublié, une séance non pointée, une absence) à
 * ajouter à la date voulue. Rien n'est écrit « à côté » : chaque ajout passe
 * par le même chemin que le guichet (présence → `mark_attendance`, ligne du
 * solde → `update_balance_tx`), et compte donc exactement comme les autres.
 *
 * En tête, un contrôle automatique dit ce qui cloche et le répare d'un clic :
 * un solde qui ne vaut plus la somme de son historique, une absence facturée
 * alors qu'une présence existe dans la semaine, une absence déjà remboursée.
 */
export function StudentRepairModal({
  studentId,
  open,
  onClose,
}: {
  studentId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open && !!studentId}
      onClose={onClose}
      title="Régulariser la situation"
      subtitle="Paiements, transactions, présences et absences de l'élève — tout se corrige et se complète ici."
      size="xl"
    >
      {studentId && <RepairBody key={studentId} studentId={studentId} onClose={onClose} />}
    </Modal>
  );
}

type View = "timeline" | "add";
type Filter = "all" | "payments" | "debits" | "presences" | "absences";
type AddKind = "payment" | "transaction" | "presence" | "absence";

type Row =
  | { kind: "tx"; id: string; when: string; tx: BalanceTransaction }
  | { kind: "att"; id: string; when: string; att: AttendanceRecord }
  | { kind: "pen"; id: string; when: string; pen: AbsencePenalty };

const MONTHS = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

const nowInput = () => schoolDateTimeInput(new Date());
const todayKey = () => schoolDateKey(new Date());

function RepairBody({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const {
    students,
    balanceTx,
    attendance,
    absencePenalties,
    sessions,
    subscriptions,
    modules,
    groups,
    salles,
    school,
    complete,
    alignStudentBalance,
    deleteAbsencePenalty,
  } = useData(
    useShallow((s) => ({
      students: s.students,
      balanceTx: s.balanceTx,
      attendance: s.attendance,
      absencePenalties: s.absencePenalties,
      sessions: s.sessions,
      subscriptions: s.subscriptions,
      modules: s.modules,
      groups: s.groups,
      salles: s.salles,
      school: s.school,
      complete: s.complete,
      alignStudentBalance: s.alignStudentBalance,
      deleteAbsencePenalty: s.deleteAbsencePenalty,
    })),
  );
  const role = useSession((s) => s.user?.role);
  const addToast = useToast((s) => s.addToast);

  const student = students.find((s) => s.id === studentId);

  const lookups = useMemo(
    () => ({
      session: new Map(sessions.map((s) => [s.id, s])),
      subscription: new Map(subscriptions.map((s) => [s.id, s])),
      module: new Map(modules.map((m) => [m.id, m.name])),
      group: new Map(groups.map((g) => [g.id, g.name])),
      salle: new Map(salles.map((s) => [s.id, s.name])),
    }),
    [sessions, subscriptions, modules, groups, salles],
  );

  const myTx = useMemo(() => balanceTx.filter((t) => t.studentId === studentId), [balanceTx, studentId]);
  const myAtt = useMemo(() => attendance.filter((a) => a.studentId === studentId), [attendance, studentId]);
  const myPen = useMemo(
    () => absencePenalties.filter((p) => p.studentId === studentId),
    [absencePenalties, studentId],
  );

  const groupOfPenalty = useMemo(
    () => (p: AbsencePenalty) => {
      const se = p.sessionId ? lookups.session.get(p.sessionId) : undefined;
      return se ? lookups.group.get(se.groupId) : undefined;
    },
    [lookups],
  );

  // ---- Le contrôle -------------------------------------------------------------
  const historyComplete = complete.balanceTx !== false;
  const history = useMemo(() => historyTotal(studentId, myTx), [studentId, myTx]);
  const drift = student && historyComplete ? student.balance - history : 0;

  const penaltyLines = useMemo(
    () => pairAbsenceLines(myPen, myTx.filter(isAbsenceTx), groupOfPenalty),
    [myPen, myTx, groupOfPenalty],
  );
  const contradicted = useMemo(
    () => contradictedPenalties({ penalties: myPen, attendance: myAtt, sessions }),
    [myPen, myAtt, sessions],
  );
  const contradictedIds = useMemo(() => new Set(contradicted.map((c) => c.penalty.id)), [contradicted]);
  const refundedPenalties = useMemo(
    () => myPen.filter((p) => !penaltyLines.has(p.id) && !contradictedIds.has(p.id)),
    [myPen, penaltyLines, contradictedIds],
  );
  const deletedSlotCharges = useMemo(
    () => chargesWithoutPresence({ studentId, balanceTx: myTx, attendance: myAtt, sessions }),
    [studentId, myTx, myAtt, sessions],
  );
  const deletedSlotIds = useMemo(() => new Set(deletedSlotCharges.map((t) => t.id)), [deletedSlotCharges]);

  // ---- Vue ---------------------------------------------------------------------
  const [view, setView] = useState<View>("timeline");
  const [filter, setFilter] = useState<Filter>("all");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [addKind, setAddKind] = useState<AddKind>("payment");

  const [editingTx, setEditingTx] = useState<BalanceTransaction | null>(null);
  const [deletingTx, setDeletingTx] = useState<BalanceTransaction | null>(null);
  const [editingAtt, setEditingAtt] = useState<AttendanceRecord | null>(null);
  const [deletingAtt, setDeletingAtt] = useState<AttendanceRecord | null>(null);
  const [deletingPen, setDeletingPen] = useState<AbsencePenalty | null>(null);
  const [alignOpen, setAlignOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Les emplois du temps de l'élève : ceux de ses inscriptions.
  const enrolled = useMemo(() => {
    if (!student) return [];
    return student.subscriptionIds
      .map((subId) => {
        const sub = lookups.subscription.get(subId);
        const session = sub ? lookups.session.get(sub.sessionId) : undefined;
        return sub && session ? { sub, session } : null;
      })
      .filter((x): x is { sub: Subscription; session: ScheduleSession } => !!x);
  }, [student, lookups]);

  const moduleOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const { session } of enrolled) map.set(session.moduleId, lookups.module.get(session.moduleId) ?? "Module");
    for (const t of myTx) if (t.moduleId && !map.has(t.moduleId)) map.set(t.moduleId, lookups.module.get(t.moduleId) ?? "Module");
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [enrolled, myTx, lookups]);

  const rows = useMemo<Row[]>(() => {
    const moduleOfAtt = (a: AttendanceRecord) => lookups.session.get(a.sessionId)?.moduleId;
    const list: Row[] = [];
    if (filter === "all" || filter === "payments" || filter === "debits") {
      for (const tx of myTx) {
        if (filter === "payments" && tx.amount <= 0) continue;
        if (filter === "debits" && tx.amount > 0) continue;
        if (moduleFilter !== "all" && tx.moduleId !== moduleFilter) continue;
        list.push({ kind: "tx", id: tx.id, when: tx.date, tx });
      }
    }
    if (filter === "all" || filter === "presences" || filter === "absences") {
      for (const att of myAtt) {
        if (filter === "presences" && att.status === "absent") continue;
        if (filter === "absences" && att.status !== "absent") continue;
        if (moduleFilter !== "all" && moduleOfAtt(att) !== moduleFilter) continue;
        list.push({ kind: "att", id: att.id, when: att.timestamp, att });
      }
    }
    if (filter === "all" || filter === "absences") {
      for (const pen of myPen) {
        if (moduleFilter !== "all" && pen.moduleId !== moduleFilter) continue;
        list.push({ kind: "pen", id: pen.id, when: isoFromSchoolInput(`${pen.periodEnd}T23:00`), pen });
      }
    }
    return list.sort((a, b) => b.when.localeCompare(a.when));
  }, [filter, moduleFilter, myTx, myAtt, myPen, lookups]);

  const grouped = useMemo(() => {
    const out: { key: string; label: string; rows: Row[] }[] = [];
    for (const row of rows) {
      const key = schoolDateKey(row.when).slice(0, 7);
      let bucket = out[out.length - 1];
      if (!bucket || bucket.key !== key) {
        const [y, m] = key.split("-");
        bucket = { key, label: `${MONTHS[Number(m) - 1] ?? ""} ${y}`, rows: [] };
        out.push(bucket);
      }
      bucket.rows.push(row);
    }
    return out;
  }, [rows]);

  if (!student) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted">Cet élève n&apos;existe plus (supprimé depuis un autre poste ?).</p>
        <Button onClick={onClose}>Fermer</Button>
      </div>
    );
  }

  if (role !== "admin" && role !== "reception") {
    return <p className="text-sm text-muted">Réservé à l&apos;administration et à la réception.</p>;
  }

  const totalIn = myTx.reduce((s, t) => s + (t.amount > 0 ? t.amount : 0), 0);
  const totalOut = myTx.reduce((s, t) => s + (t.amount < 0 ? -t.amount : 0), 0);
  const issues = (drift !== 0 ? 1 : 0) + contradicted.length + refundedPenalties.length;

  const cancelPenalties = async (ids: string[], label: string) => {
    setBusy(label);
    let refunded = 0;
    let failed = 0;
    for (const id of ids) {
      const res = await deleteAbsencePenalty(id);
      if (res.ok) refunded += res.refunded ?? 0;
      else failed += 1;
    }
    setBusy(null);
    addToast({
      type: failed ? "warning" : "success",
      title: failed ? "Correction partielle" : "Absences corrigées",
      message:
        `${ids.length - failed} absence(s) retirée(s)` +
        (refunded ? ` — ${refunded} DA remboursés.` : " — rien à rembourser (déjà remboursées).") +
        (failed ? ` ${failed} n'ont pas pu l'être : réessayez.` : ""),
    });
  };

  const describePenalty = (pen: AbsencePenalty) => {
    const mod = (pen.moduleId && lookups.module.get(pen.moduleId)) || "Module";
    const grp = groupOfPenalty(pen);
    return `${mod}${grp ? ` (${grp})` : ""} — semaine du ${frDay(pen.periodStart)} au ${frDay(pen.periodEnd)}`;
  };

  const viewTab = (v: View, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => setView(v)}
      className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition-colors ${
        view === v ? "bg-gradient-primary text-white shadow-sm" : "text-muted hover:bg-surface hover:text-ink"
      }`}
    >
      {icon} {label}
    </button>
  );

  return (
    <div className="space-y-5">
      {/* ---- Qui, et où en est son argent ------------------------------------- */}
      <div className="overflow-hidden rounded-2xl border border-line bg-gradient-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-primary text-sm font-black uppercase text-white shadow-sm">
              {student.firstName.substring(0, 1)}
              {student.lastName.substring(0, 1)}
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-base font-bold capitalize text-ink">
                {student.firstName} {student.lastName}
              </h3>
              <span className="font-mono text-[11px] text-muted">
                Carte {student.rfid || "—"} · {student.phone || "—"}
              </span>
            </div>
          </div>
          {issues === 0 ? (
            <Badge tone="success" className="px-3 py-1">
              <BadgeCheck className="h-3.5 w-3.5" /> Situation saine
            </Badge>
          ) : (
            <Badge tone="warning" className="px-3 py-1">
              <AlertTriangle className="h-3.5 w-3.5" /> {issues} point(s) à corriger
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-5">
          <Tile label="Solde stocké" value={`${student.balance} DA`} tone={student.balance < 0 ? "danger" : "success"} />
          <Tile
            label="Somme de l'historique"
            value={historyComplete ? `${history} DA` : "—"}
            tone={history < 0 ? "danger" : "success"}
          />
          <Tile label="Écart" value={`${drift > 0 ? "+" : ""}${drift} DA`} tone={drift !== 0 ? "warning" : "neutral"} />
          <Tile label="Total versé / crédité" value={`+${totalIn} DA`} tone="primary" />
          <Tile label="Total débité" value={`-${totalOut} DA`} tone="danger" />
        </div>
      </div>

      {/* ---- Le contrôle automatique ------------------------------------------ */}
      <section className="rounded-2xl border border-line bg-surface p-4">
        <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted">
          <ListChecks className="h-4 w-4 text-primary" /> Contrôle de la situation
        </h4>

        {!historyComplete && (
          <p className="mb-2 rounded-lg bg-warning/10 px-3 py-2 text-[11px] text-warning">
            L&apos;historique n&apos;est pas entièrement chargé : l&apos;écart solde ↔ historique n&apos;est pas calculé.
          </p>
        )}

        <div className="space-y-2">
          {issues === 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/5 px-3 py-2.5 text-xs text-success">
              <BadgeCheck className="h-4 w-4 shrink-0" />
              <span>
                Aucune anomalie : le solde vaut la somme de son historique et aucune absence n&apos;est contredite par
                une présence.
              </span>
            </div>
          )}

          {drift !== 0 && (
            <Issue
              tone="warning"
              icon={<Scale className="h-4 w-4" />}
              title={`Le solde (${student.balance} DA) ne vaut pas la somme de son historique (${history} DA)`}
              detail={
                drift > 0
                  ? `${drift} DA ont été crédités au solde sans ligne dans l'historique — typiquement une absence remboursée deux fois.`
                  : `${-drift} DA ont été débités du solde sans ligne dans l'historique.`
              }
              action={
                <Button size="sm" variant="primary" onClick={() => setAlignOpen(true)} disabled={!!busy}>
                  <Scale className="h-3.5 w-3.5" /> Aligner sur l&apos;historique
                </Button>
              }
            />
          )}

          {contradicted.map(({ penalty, presences }) => (
            <Issue
              key={penalty.id}
              tone="danger"
              icon={<CalendarX className="h-4 w-4" />}
              title={`Absence facturée alors que l'élève était présent : ${describePenalty(penalty)}`}
              detail={`Présence le ${presences
                .map((a) => schoolDateTimeLabel(a.timestamp))
                .join(", ")} — ${
                penaltyLines.has(penalty.id) ? `${penalty.amount} DA à rembourser.` : "sa ligne au solde est déjà remboursée."
              }`}
              action={
                <Button
                  size="sm"
                  variant="danger"
                  disabled={!!busy}
                  onClick={() => cancelPenalties([penalty.id], penalty.id)}
                >
                  {busy === penalty.id ? "Correction…" : penaltyLines.has(penalty.id) ? "Annuler et rembourser" : "Retirer"}
                </Button>
              }
            />
          ))}

          {refundedPenalties.map((penalty) => (
            <Issue
              key={penalty.id}
              tone="warning"
              icon={<Receipt className="h-4 w-4" />}
              title={`Absence déjà remboursée mais toujours affichée : ${describePenalty(penalty)}`}
              detail="Sa ligne a été supprimée de l'historique (le remboursement est fait). Elle sera retirée sans rembourser une seconde fois."
              action={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => cancelPenalties([penalty.id], penalty.id)}
                >
                  {busy === penalty.id ? "Retrait…" : "Retirer"}
                </Button>
              }
            />
          ))}

          {contradicted.length + refundedPenalties.length > 1 && (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                disabled={!!busy}
                onClick={() =>
                  cancelPenalties(
                    [...contradicted.map((c) => c.penalty.id), ...refundedPenalties.map((p) => p.id)],
                    "all",
                  )
                }
              >
                <Wrench className="h-3.5 w-3.5" /> {busy === "all" ? "Correction…" : "Corriger toutes les absences"}
              </Button>
            </div>
          )}

          {deletedSlotCharges.length > 0 && (
            <Issue
              tone="info"
              icon={<Info className="h-4 w-4" />}
              title={`${deletedSlotCharges.length} séance(s) payée(s) dont l'emploi du temps a été supprimé`}
              detail={`${deletedSlotCharges
                .map((t) => `${schoolDateTimeLabel(t.date)} · ${t.description}`)
                .join(" ; ")}. Supprimer un emploi du temps efface ses présences, pas les paiements : elles restent comptées et figurent au rapport.`}
            />
          )}
        </div>
      </section>

      {/* ---- Chronologie / Ajouter ------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-line bg-canvas/60 p-1">
        {viewTab("timeline", <History className="h-4 w-4" />, `Chronologie (${myTx.length + myAtt.length + myPen.length})`)}
        {viewTab("add", <Plus className="h-4 w-4" />, "Ajouter une opération")}
      </div>

      {view === "timeline" ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["all", "Tout"],
                  ["payments", "Paiements"],
                  ["debits", "Débits"],
                  ["presences", "Présences"],
                  ["absences", "Absences"],
                ] as const
              ).map(([f, label]) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
                    filter === f
                      ? "border-primary bg-primary text-white"
                      : "border-line bg-surface text-muted hover:border-primary/50 hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <Select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className="h-8 text-xs">
              <option value="all">Toutes les matières</option>
              {moduleOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
            <span className="ms-auto font-mono text-[10px] text-muted">{rows.length} ligne(s)</span>
          </div>

          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line py-10 text-center text-xs text-muted">
              Rien pour ce filtre.
            </p>
          ) : (
            <div className="max-h-[28rem] space-y-4 overflow-y-auto pe-1">
              {grouped.map((bucket) => (
                <div key={bucket.key}>
                  <div className="sticky top-0 z-10 mb-1.5 bg-surface/95 py-1 text-[10px] font-bold uppercase tracking-wider text-muted backdrop-blur">
                    {bucket.label}
                  </div>
                  <div className="space-y-1.5">
                    {bucket.rows.map((row) => (
                      <TimelineRow
                        key={`${row.kind}-${row.id}`}
                        row={row}
                        student={student}
                        lookups={lookups}
                        contradicted={row.kind === "pen" && contradictedIds.has(row.id)}
                        refunded={row.kind === "pen" && !penaltyLines.has(row.id)}
                        deletedSlot={row.kind === "tx" && deletedSlotIds.has(row.id)}
                        onEditTx={setEditingTx}
                        onDeleteTx={setDeletingTx}
                        onEditAtt={setEditingAtt}
                        onDeleteAtt={setDeletingAtt}
                        onDeletePen={setDeletingPen}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <KindCard
              active={addKind === "payment"}
              onClick={() => setAddKind("payment")}
              icon={<Banknote className="h-5 w-5" />}
              title="Paiement"
              hint="Versement daté, en caisse"
              tone="success"
            />
            <KindCard
              active={addKind === "transaction"}
              onClick={() => setAddKind("transaction")}
              icon={<Receipt className="h-5 w-5" />}
              title="Transaction"
              hint="Débit ou crédit manuel"
              tone="primary"
            />
            <KindCard
              active={addKind === "presence"}
              onClick={() => setAddKind("presence")}
              icon={<CalendarCheck className="h-5 w-5" />}
              title="Présence"
              hint="Séance non pointée"
              tone="success"
            />
            <KindCard
              active={addKind === "absence"}
              onClick={() => setAddKind("absence")}
              icon={<CalendarPlus className="h-5 w-5" />}
              title="Absence"
              hint="Semaine facturée"
              tone="danger"
            />
          </div>

          <div className="rounded-2xl border border-line bg-surface p-4">
            {addKind === "payment" && <PaymentForm student={student} />}
            {addKind === "transaction" && <TransactionForm student={student} moduleOptions={moduleOptions} />}
            {addKind === "presence" && (
              <PresenceForm student={student} enrolled={enrolled} lookups={lookups} myAtt={myAtt} myPen={myPen} />
            )}
            {addKind === "absence" && (
              <AbsenceForm
                student={student}
                enrolled={enrolled}
                lookups={lookups}
                myAtt={myAtt}
                myPen={myPen}
                weekStartDay={school.absenceWeekStartDay ?? 5}
              />
            )}
          </div>
        </section>
      )}

      <div className="flex justify-end border-t border-line pt-3">
        <Button variant="outline" onClick={onClose}>
          Fermer
        </Button>
      </div>

      <EditTxDialog tx={editingTx} student={student} onClose={() => setEditingTx(null)} />
      <DeleteTxDialog tx={deletingTx} student={student} onClose={() => setDeletingTx(null)} />
      <EditAttendanceDialog att={editingAtt} student={student} onClose={() => setEditingAtt(null)} />
      <DeleteAttendanceDialog att={deletingAtt} student={student} onClose={() => setDeletingAtt(null)} />
      <DeletePenaltyDialog pen={deletingPen} student={student} onClose={() => setDeletingPen(null)} />

      <Modal open={alignOpen} onClose={() => setAlignOpen(false)} title="Aligner le solde sur l'historique">
        <AlignBody
          student={student}
          history={history}
          onDone={() => setAlignOpen(false)}
          align={alignStudentBalance}
        />
      </Modal>
    </div>
  );
}

// =============================================================================
// Briques d'affichage
// =============================================================================

type Lookups = {
  session: Map<string, ScheduleSession>;
  subscription: Map<string, Subscription>;
  module: Map<string, string>;
  group: Map<string, string>;
  salle: Map<string, string>;
};

const TONE_TEXT = {
  success: "text-emerald-600 dark:text-emerald-300",
  danger: "text-rose-600 dark:text-rose-300",
  warning: "text-amber-600 dark:text-amber-300",
  primary: "text-primary dark:text-rose-200",
  neutral: "text-ink",
} as const;

function Tile({ label, value, tone }: { label: string; value: string; tone: keyof typeof TONE_TEXT }) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <strong className={`mt-0.5 block font-mono text-sm font-black ${TONE_TEXT[tone]}`}>{value}</strong>
    </div>
  );
}

function Issue({
  tone,
  icon,
  title,
  detail,
  action,
}: {
  tone: "danger" | "warning" | "info";
  icon: React.ReactNode;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  // Teintes fixes, avec leur variante claire en thème sombre (où `--warning`
  // et `--success` deviennent illisibles sur fond bordeaux).
  const frame = {
    danger: "border-rose-500/40 bg-rose-500/5 text-rose-600 dark:text-rose-300",
    warning: "border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-300",
    info: "border-sky-500/30 bg-sky-500/5 text-sky-600 dark:text-sky-300",
  }[tone];
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${frame}`}>
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0">
          <strong className="block text-xs font-bold">{title}</strong>
          <span className="block text-[11px] leading-relaxed text-muted">{detail}</span>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function KindCard({
  active,
  onClick,
  icon,
  title,
  hint,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
  tone: "success" | "danger" | "primary";
}) {
  const accent = { success: "text-success bg-success/10", danger: "text-danger bg-danger/10", primary: "text-primary bg-primary/10" }[
    tone
  ];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-2xl border p-3 text-start transition-all ${
        active ? "border-primary bg-primary-50/60 shadow-sm ring-2 ring-[var(--ring)]" : "border-line bg-surface hover:border-primary/40"
      }`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${accent}`}>{icon}</span>
      <span className="min-w-0">
        <strong className="block text-sm text-ink">{title}</strong>
        <span className="block truncate text-[10px] text-muted">{hint}</span>
      </span>
    </button>
  );
}

function IconAction({
  title,
  onClick,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded-lg p-1.5 text-muted transition-colors ${
        danger ? "hover:bg-danger/10 hover:text-danger" : "hover:bg-primary-50 hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

function TimelineRow({
  row,
  student,
  lookups,
  contradicted,
  refunded,
  deletedSlot,
  onEditTx,
  onDeleteTx,
  onEditAtt,
  onDeleteAtt,
  onDeletePen,
}: {
  row: Row;
  student: Student;
  lookups: Lookups;
  contradicted: boolean;
  refunded: boolean;
  deletedSlot: boolean;
  onEditTx: (tx: BalanceTransaction) => void;
  onDeleteTx: (tx: BalanceTransaction) => void;
  onEditAtt: (att: AttendanceRecord) => void;
  onDeleteAtt: (att: AttendanceRecord) => void;
  onDeletePen: (pen: AbsencePenalty) => void;
}) {
  let icon: React.ReactNode;
  let iconTone: string;
  let title: React.ReactNode;
  let subtitle: string;
  let amount: React.ReactNode;
  let tags: React.ReactNode = null;
  let actions: React.ReactNode;

  if (row.kind === "tx") {
    const tx = row.tx;
    const credit = tx.amount > 0;
    icon = credit ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />;
    iconTone = credit ? "bg-success/12 text-success" : tx.amount < 0 ? "bg-danger/12 text-danger" : "bg-muted/15 text-muted";
    title = tx.description || TX_TYPE_LABELS[tx.type];
    subtitle = `${schoolDateTimeLabel(tx.date)} · ${TX_TYPE_LABELS[tx.type]}`;
    amount = (
      <span className={`font-mono text-xs font-black ${credit ? "text-success" : tx.amount < 0 ? "text-danger" : "text-muted"}`}>
        {credit ? `+${tx.amount}` : tx.amount} DA
      </span>
    );
    tags = (
      <>
        {isAbsenceTx(tx) && <Badge tone="warning" className="px-1.5 py-0 text-[9px]">Absence</Badge>}
        {deletedSlot && (
          <Badge tone="warning" className="px-1.5 py-0 text-[9px]">
            Emploi du temps supprimé
          </Badge>
        )}
      </>
    );
    actions = (
      <>
        <IconAction title="Modifier cette transaction" onClick={() => onEditTx(tx)}>
          <Edit className="h-3.5 w-3.5" />
        </IconAction>
        <IconAction title="Supprimer cette transaction" onClick={() => onDeleteTx(tx)} danger>
          <Trash2 className="h-3.5 w-3.5" />
        </IconAction>
      </>
    );
  } else if (row.kind === "att") {
    const att = row.att;
    const s = lookups.session.get(att.sessionId);
    const mod = s ? lookups.module.get(s.moduleId) ?? "Module" : "Module";
    const grp = s ? lookups.group.get(s.groupId) : undefined;
    const salle = s ? lookups.salle.get(s.salleId) : undefined;
    const reason = freeReasonOf(att, { studentIsFree: student.isFree, sessionIsFree: !!s?.isFree });
    const absent = att.status === "absent";
    icon = absent ? <CalendarX className="h-4 w-4" /> : att.status === "late" ? <Clock className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />;
    iconTone = absent ? "bg-danger/12 text-danger" : att.status === "late" ? "bg-warning/12 text-warning" : "bg-success/12 text-success";
    title = (
      <>
        {absent ? "Absence" : att.status === "late" ? "Présence (retard)" : "Présence"} · {mod}
        {grp ? <span className="font-semibold text-muted"> — {grp}</span> : null}
      </>
    );
    subtitle = [schoolDateTimeLabel(att.timestamp), s ? `${s.startTime}-${s.endTime}` : "", salle ? `Salle ${salle}` : ""]
      .filter(Boolean)
      .join(" · ");
    amount = reason ? (
      <span className="text-[10px] font-bold text-success">Offerte · {FREE_REASON_LABELS[reason]}</span>
    ) : (
      <span className="font-mono text-xs font-black text-danger">-{att.amountDeducted} DA</span>
    );
    tags = att.substituteGroup ? <Badge tone="primary" className="px-1.5 py-0 text-[9px]">Autre groupe</Badge> : null;
    actions = (
      <>
        <IconAction title="Modifier cette présence" onClick={() => onEditAtt(att)}>
          <Edit className="h-3.5 w-3.5" />
        </IconAction>
        <IconAction title="Supprimer cette présence (et rembourser)" onClick={() => onDeleteAtt(att)} danger>
          <Trash2 className="h-3.5 w-3.5" />
        </IconAction>
      </>
    );
  } else {
    const pen = row.pen;
    const s = pen.sessionId ? lookups.session.get(pen.sessionId) : undefined;
    const mod = (pen.moduleId && lookups.module.get(pen.moduleId)) || "Module";
    const grp = s ? lookups.group.get(s.groupId) : undefined;
    icon = <CalendarX className="h-4 w-4" />;
    iconTone = "bg-danger/12 text-danger";
    title = (
      <>
        Absence facturée · {mod}
        {grp ? <span className="font-semibold text-muted"> — {grp}</span> : null}
      </>
    );
    subtitle = `Semaine du ${frDay(pen.periodStart)} au ${frDay(pen.periodEnd)}`;
    amount = <span className="font-mono text-xs font-black text-danger">-{pen.amount} DA</span>;
    tags = (
      <>
        {contradicted && <Badge tone="danger" className="px-1.5 py-0 text-[9px]">Présent cette semaine</Badge>}
        {refunded && <Badge tone="warning" className="px-1.5 py-0 text-[9px]">Déjà remboursée</Badge>}
      </>
    );
    actions = (
      <IconAction title="Supprimer cette absence" onClick={() => onDeletePen(pen)} danger>
        <Trash2 className="h-3.5 w-3.5" />
      </IconAction>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-canvas/40 px-3 py-2 transition-colors hover:border-primary/30">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconTone}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <strong className="truncate text-xs text-ink">{title}</strong>
          {tags}
        </div>
        <span className="block truncate text-[10px] text-muted">{subtitle}</span>
      </div>
      <div className="shrink-0 text-end">{amount}</div>
      <div className="flex shrink-0 items-center">{actions}</div>
    </div>
  );
}

// =============================================================================
// Aligner le solde
// =============================================================================

function AlignBody({
  student,
  history,
  onDone,
  align,
}: {
  student: Student;
  history: number;
  onDone: () => void;
  align: (studentId: string) => Promise<{ ok: boolean; from?: number; to?: number; error?: string }>;
}) {
  const addToast = useToast((s) => s.addToast);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const res = await align(student.id);
    setBusy(false);
    if (!res.ok) {
      addToast({ type: "danger", title: "Alignement impossible", message: res.error ?? "Erreur inconnue." });
      return;
    }
    addToast({
      type: "success",
      title: "Solde aligné sur l'historique",
      message: `${student.firstName} ${student.lastName} : ${res.from} DA → ${res.to} DA. Une ligne « Régularisation » à 0 DA le trace.`,
    });
    onDone();
  };
  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-ink">
        L&apos;historique (versements, séances, absences) est la référence : c&apos;est lui qui est imprimé sur les reçus
        et adossé aux présences. Le solde stocké va être ramené à sa somme. Aucune ligne existante n&apos;est modifiée,
        rien n&apos;entre ni ne sort de la caisse ; une ligne « Régularisation » à 0 DA garde la trace de la correction.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-line bg-canvas p-3 text-center">
          <span className="block text-[10px] font-semibold uppercase text-muted">Solde actuel</span>
          <strong className="font-mono text-lg font-black text-ink">{student.balance} DA</strong>
        </div>
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-center">
          <span className="block text-[10px] font-semibold uppercase text-muted">Solde après</span>
          <strong className={`font-mono text-lg font-black ${history < 0 ? "text-danger" : "text-success"}`}>
            {history} DA
          </strong>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone} disabled={busy}>
          Annuler
        </Button>
        <Button onClick={submit} disabled={busy}>
          <Scale className="h-4 w-4" /> {busy ? "Alignement…" : "Aligner le solde"}
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// Ajouter : paiement, transaction, présence, absence
// =============================================================================

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-muted">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[10px] leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

function Preview({ before, after }: { before: number; after: number }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-primary/25 bg-primary-50/40 px-3 py-2.5 text-xs">
      <span className="font-semibold text-muted">Solde</span>
      <span className="font-mono">
        <span className="text-muted">{before} DA</span>
        <span className="mx-2 text-muted">→</span>
        <strong className={after < 0 ? "text-danger" : "text-success"}>{after} DA</strong>
      </span>
    </div>
  );
}

function PaymentForm({ student }: { student: Student }) {
  const addLedgerLine = useData((s) => s.addLedgerLine);
  const addToast = useToast((s) => s.addToast);
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(nowInput);
  const [description, setDescription] = useState("Dépôt solde");
  const [cash, setCash] = useState(true);
  const [busy, setBusy] = useState(false);
  const value = Math.round(amount || 0);

  const submit = async () => {
    if (value <= 0 || !date) return;
    setBusy(true);
    const res = await addLedgerLine({
      studentId: student.id,
      amount: value,
      type: "topup",
      description: description.trim() || "Dépôt solde",
      date: isoFromSchoolInput(date),
      cash,
    });
    setBusy(false);
    if (!res.ok) {
      addToast({ type: "danger", title: "Paiement non enregistré", message: res.error ?? "Erreur inconnue." });
      return;
    }
    addToast({
      type: "success",
      title: "Paiement enregistré",
      message: `+${value} DA le ${schoolDateTimeLabel(isoFromSchoolInput(date))} — nouveau solde : ${res.newBalance} DA${
        res.cashAdjusted ? " — entré en caisse." : "."
      }`,
      studentName: `${student.firstName} ${student.lastName}`,
    });
    setAmount(0);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Montant versé (DA) *">
          <Input type="number" min={0} value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} />
        </Field>
        <Field label="Date et heure du versement *">
          <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Libellé">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-canvas p-3">
        <span className="text-xs font-bold text-ink">
          Encaisser en caisse
          <span className="block text-[10px] font-normal text-muted">
            L&apos;argent entre dans la caisse à la date choisie. Décochez si ce versement y figure déjà.
          </span>
        </span>
        <input type="checkbox" checked={cash} onChange={(e) => setCash(e.target.checked)} className="h-5 w-5 shrink-0" />
      </label>
      <Preview before={student.balance} after={student.balance + Math.max(0, value)} />
      <div className="flex justify-end">
        <Button variant="success" onClick={submit} disabled={busy || value <= 0 || !date}>
          <Banknote className="h-4 w-4" /> {busy ? "Enregistrement…" : "Enregistrer le paiement"}
        </Button>
      </div>
    </div>
  );
}

function TransactionForm({
  student,
  moduleOptions,
}: {
  student: Student;
  moduleOptions: { id: string; name: string }[];
}) {
  const addLedgerLine = useData((s) => s.addLedgerLine);
  const addToast = useToast((s) => s.addToast);
  const [direction, setDirection] = useState<"debit" | "credit">("debit");
  const [type, setType] = useState<BalanceTxType>("deduction");
  const [amount, setAmount] = useState(0);
  const [moduleId, setModuleId] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(nowInput);
  const [busy, setBusy] = useState(false);
  const value = Math.max(0, Math.round(amount || 0));
  const signed = direction === "debit" ? -value : value;
  const types: BalanceTxType[] = direction === "debit" ? ["deduction", "registration"] : ["topup", "debt_payment"];

  const switchDirection = (d: "debit" | "credit") => {
    setDirection(d);
    setType(d === "debit" ? "deduction" : "topup");
  };

  const submit = async () => {
    if (value <= 0 || !description.trim() || !date) return;
    setBusy(true);
    const res = await addLedgerLine({
      studentId: student.id,
      amount: signed,
      type,
      description: description.trim(),
      date: isoFromSchoolInput(date),
      moduleId: moduleId || undefined,
      cash: false,
    });
    setBusy(false);
    if (!res.ok) {
      addToast({ type: "danger", title: "Transaction non enregistrée", message: res.error ?? "Erreur inconnue." });
      return;
    }
    addToast({
      type: "success",
      title: "Transaction enregistrée",
      message: `${signed > 0 ? `+${signed}` : signed} DA — nouveau solde : ${res.newBalance} DA.`,
      studentName: `${student.firstName} ${student.lastName}`,
    });
    setAmount(0);
    setDescription("");
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["debit", "Débit", "Retire du solde (séance, frais…)", <ArrowUpRight key="d" className="h-4 w-4" />],
            ["credit", "Crédit", "Ajoute au solde, sans caisse (avoir)", <ArrowDownLeft key="c" className="h-4 w-4" />],
          ] as const
        ).map(([d, label, hint, icon]) => (
          <button
            key={d}
            type="button"
            onClick={() => switchDirection(d)}
            className={`flex items-center gap-2 rounded-xl border p-2.5 text-start text-xs transition-colors ${
              direction === d
                ? d === "debit"
                  ? "border-danger bg-danger/10 text-danger"
                  : "border-success bg-success/10 text-success"
                : "border-line bg-surface text-muted hover:border-primary/40"
            }`}
          >
            {icon}
            <span>
              <strong className="block">{label}</strong>
              <span className="text-[10px] text-muted">{hint}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Montant (DA) *">
          <Input type="number" min={0} value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} />
        </Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as BalanceTxType)} className="w-full">
            {types.map((t) => (
              <option key={t} value={t}>
                {TX_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Libellé *">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={direction === "debit" ? "Ex : Séance science du 29/09" : "Ex : Avoir — séance annulée"}
          />
        </Field>
        <Field label="Matière (facultatif)">
          <Select value={moduleId} onChange={(e) => setModuleId(e.target.value)} className="w-full">
            <option value="">— Aucune —</option>
            {moduleOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date et heure *">
          <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <p className="rounded-lg bg-canvas px-3 py-2 text-[10px] text-muted">
        Une transaction ne touche pas la caisse : pour de l&apos;argent réellement reçu, utilisez « Paiement ». Pour une
        séance suivie, préférez « Présence » : elle paie aussi l&apos;enseignant.
      </p>
      <Preview before={student.balance} after={student.balance + signed} />
      <div className="flex justify-end">
        <Button
          variant={direction === "debit" ? "danger" : "success"}
          onClick={submit}
          disabled={busy || value <= 0 || !description.trim() || !date}
        >
          <Receipt className="h-4 w-4" /> {busy ? "Enregistrement…" : "Enregistrer la transaction"}
        </Button>
      </div>
    </div>
  );
}

const sessionLabelOf = (session: ScheduleSession, lookups: Lookups) => {
  const mod = lookups.module.get(session.moduleId) ?? "Module";
  const grp = lookups.group.get(session.groupId);
  return `${mod}${grp ? ` — ${grp}` : ""} · ${formatDays(session.days)} ${session.startTime}-${session.endTime}${
    session.isOpen ? " (séance libre)" : ""
  }`;
};

/** Le dernier jour (aujourd'hui compris) où ce créneau a eu lieu : la date
 *  qu'on vient le plus souvent rattraper. */
function lastSessionDay(session: ScheduleSession | undefined): string {
  const today = todayKey();
  if (!session || session.days.length === 0) return today;
  for (let back = 0; back < 7; back++) {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - back);
    const iso = d.toISOString().slice(0, 10);
    if (session.days.includes(dayOfIsoDate(iso))) return iso;
  }
  return today;
}

const MARK_ERRORS: Record<string, string> = {
  "attendance.notScheduledThatDay": "Ce créneau n'a pas lieu ce jour-là.",
  "attendance.notEnrolled": "L'élève n'est pas inscrit sur ce créneau.",
  "attendance.sessionNotFound": "Cet emploi du temps n'existe plus.",
  "scan.alreadyPresent": "Une présence existe déjà sur ce créneau à cette date.",
  "scan.notFound": "Élève introuvable.",
  "scan.error": "La base a refusé la présence.",
};

function PresenceForm({
  student,
  enrolled,
  lookups,
  myAtt,
  myPen,
}: {
  student: Student;
  enrolled: { sub: Subscription; session: ScheduleSession }[];
  lookups: Lookups;
  myAtt: AttendanceRecord[];
  myPen: AbsencePenalty[];
}) {
  const markAttendance = useData((s) => s.markAttendance);
  const addToast = useToast((s) => s.addToast);
  const [subId, setSubId] = useState(enrolled[0]?.sub.id ?? "");
  const [date, setDate] = useState(() => lastSessionDay(enrolled[0]?.session));
  const [status, setStatus] = useState<"present" | "late">("present");
  const [busy, setBusy] = useState(false);

  const picked = enrolled.find((e) => e.sub.id === subId);
  const session = picked?.session;

  const day = date ? dayOfIsoDate(date) : undefined;
  const wrongDay = !!session && !!day && !session.days.includes(day);
  const outOfPeriod =
    !!session?.isOpen &&
    !!date &&
    ((!!session.periodStart && date < session.periodStart) || (!!session.periodEnd && date > session.periodEnd));
  const future = !!date && date > todayKey();
  const duplicate =
    !!session && !!date && myAtt.some((a) => a.sessionId === session.id && schoolDateKey(a.timestamp) === date);

  // Ce que la base va débiter — mêmes règles que `mark_attendance`.
  const startDate = [student.subscriptionDates?.[subId]?.startDate, session?.billingStartDate]
    .filter((d): d is string => !!d)
    .sort()
    .pop();
  const beforeStart = !!startDate && !!date && date < startDate;
  const price = picked ? studentSeancePrice(student, picked.sub) : 0;
  const cost = student.isFree || beforeStart || session?.isFree ? 0 : price;

  // L'absence que cette présence va annuler.
  const probe = session
    ? ({ studentId: student.id, sessionId: session.id, timestamp: `${date}T12:00:00Z`, status: "present" } as AttendanceRecord)
    : null;
  const cancelled =
    probe && date ? myPen.filter((p) => presencesInPenaltyWeek(p, [probe], lookups.session).length > 0) : [];

  const blocked = !session || !date || wrongDay || outOfPeriod || future || duplicate;

  const submit = async () => {
    if (blocked || !session) return;
    setBusy(true);
    const res = await markAttendance(student.id, session.id, status, { date });
    setBusy(false);
    if (!res.ok || res.messageKey === "scan.alreadyPresent") {
      addToast({
        type: "danger",
        title: "Présence non enregistrée",
        message: MARK_ERRORS[res.messageKey] ?? res.messageKey,
      });
      return;
    }
    addToast({
      type: "success",
      title: "Présence enregistrée",
      message:
        `${frDay(date)} — ${res.cost ? `${res.cost} DA débités` : "séance offerte (0 DA)"}` +
        ` — nouveau solde : ${res.newBalance ?? student.balance} DA.`,
      studentName: `${student.firstName} ${student.lastName}`,
    });
  };

  if (enrolled.length === 0) {
    return <p className="text-xs italic text-muted">L&apos;élève n&apos;est inscrit à aucun emploi du temps.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="md:col-span-3">
          <Field label="Emploi du temps (inscriptions de l'élève) *">
            <Select
              value={subId}
              onChange={(e) => {
                setSubId(e.target.value);
                setDate(lastSessionDay(enrolled.find((x) => x.sub.id === e.target.value)?.session));
              }}
              className="w-full"
            >
              {enrolled.map(({ sub, session: s }) => (
                <option key={sub.id} value={sub.id}>
                  {sessionLabelOf(s, lookups)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label="Date de la séance *"
          hint={session ? `Ce créneau a lieu le ${session.days.map((d) => DAY_LABELS_FR[d]).join(", ")}.` : undefined}
        >
          <Input type="date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Statut">
          <Select value={status} onChange={(e) => setStatus(e.target.value as "present" | "late")} className="w-full">
            <option value="present">Présent</option>
            <option value="late">En retard</option>
          </Select>
        </Field>
        <Field label="Montant débité">
          <div className="flex h-10 items-center rounded-xl border border-line bg-canvas px-3 font-mono text-sm font-bold">
            {cost > 0 ? <span className="text-danger">-{cost} DA</span> : <span className="text-success">Offerte (0 DA)</span>}
          </div>
        </Field>
      </div>

      {wrongDay && day && (
        <Notice tone="danger">
          Le {frDay(date)} est un {DAY_LABELS_FR[day].toLowerCase()} : ce créneau n&apos;a pas lieu ce jour-là.
        </Notice>
      )}
      {outOfPeriod && <Notice tone="danger">Cette séance libre n&apos;existe pas à cette date.</Notice>}
      {future && <Notice tone="danger">On ne pointe pas une séance à venir.</Notice>}
      {duplicate && <Notice tone="danger">Une présence existe déjà sur ce créneau le {frDay(date)}.</Notice>}
      {beforeStart && !blocked && (
        <Notice tone="info">
          Séance antérieure au début de facturation ({frDay(startDate as string)}) : enregistrée comme offerte.
        </Notice>
      )}
      {cancelled.length > 0 && !blocked && (
        <Notice tone="info">
          L&apos;absence facturée de la semaine du {frDay(cancelled[0].periodStart)} au {frDay(cancelled[0].periodEnd)} sera
          annulée et remboursée : l&apos;élève était présent cette semaine-là.
        </Notice>
      )}

      <Preview before={student.balance} after={student.balance - cost} />
      <div className="flex justify-end">
        <Button variant="success" onClick={submit} disabled={busy || blocked}>
          <CalendarCheck className="h-4 w-4" /> {busy ? "Enregistrement…" : "Enregistrer la présence"}
        </Button>
      </div>
    </div>
  );
}

function AbsenceForm({
  student,
  enrolled,
  lookups,
  myAtt,
  myPen,
  weekStartDay,
}: {
  student: Student;
  enrolled: { sub: Subscription; session: ScheduleSession }[];
  lookups: Lookups;
  myAtt: AttendanceRecord[];
  myPen: AbsencePenalty[];
  weekStartDay: number;
}) {
  const addAbsencePenalty = useData((s) => s.addAbsencePenalty);
  const addToast = useToast((s) => s.addToast);
  const regular = enrolled.filter((e) => !e.session.isOpen);
  const [subId, setSubId] = useState(regular[0]?.sub.id ?? "");
  // La semaine écoulée : on ne facture une absence qu'une fois la semaine finie.
  const [date, setDate] = useState(() => {
    const d = new Date(`${todayKey()}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const picked = regular.find((e) => e.sub.id === subId);
  const defaultPrice = picked && !student.isFree ? studentSeancePrice(student, picked.sub) : 0;
  const [amount, setAmount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const value = Math.max(0, Math.round(amount ?? defaultPrice));

  const week = date ? absenceWeekOf(date, weekStartDay) : null;
  const session = picked?.session;

  // Une présence dans la semaine interdit l'absence : même test que la facturation.
  const presences =
    week && session
      ? presencesInPenaltyWeek(
          {
            id: "probe",
            studentId: student.id,
            subscriptionId: subId,
            sessionId: session.id,
            moduleId: session.moduleId,
            periodStart: week.start,
            periodEnd: week.end,
            amount: 0,
            balanceAfter: 0,
            createdAt: "",
          },
          myAtt,
          lookups.session,
        )
      : [];

  const existing = !!week && myPen.some((p) => p.subscriptionId === subId && p.periodEnd === week.end);
  // Une absence ne se facture qu'une fois la semaine terminée : avant, l'élève
  // peut encore venir — exactement la règle de la facturation automatique.
  const unfinished = !!week && week.end >= todayKey();
  const blocked = !session || !week || presences.length > 0 || existing || unfinished;

  const submit = async () => {
    if (blocked || !session || !week) return;
    setBusy(true);
    const mod = lookups.module.get(session.moduleId) ?? "module";
    const grp = lookups.group.get(session.groupId);
    const res = await addAbsencePenalty({
      studentId: student.id,
      subscriptionId: subId,
      sessionId: session.id,
      moduleId: session.moduleId,
      periodStart: week.start,
      periodEnd: week.end,
      amount: value,
      label: `${mod}${grp ? ` (${grp})` : ""}`,
    });
    setBusy(false);
    if (!res.ok) {
      addToast({ type: "danger", title: "Absence non enregistrée", message: res.error ?? "Erreur inconnue." });
      return;
    }
    addToast({
      type: "success",
      title: "Absence enregistrée",
      message: `Semaine du ${frDay(week.start)} au ${frDay(week.end)} — ${value ? `${value} DA débités` : "sans débit"}${
        res.newBalance !== undefined ? ` — nouveau solde : ${res.newBalance} DA.` : "."
      }`,
      studentName: `${student.firstName} ${student.lastName}`,
    });
    setAmount(null);
  };

  if (regular.length === 0) {
    return <p className="text-xs italic text-muted">L&apos;élève n&apos;est inscrit à aucun cours hebdomadaire.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="md:col-span-3">
          <Field label="Emploi du temps (inscriptions de l'élève) *">
            <Select
              value={subId}
              onChange={(e) => {
                setSubId(e.target.value);
                setAmount(null);
              }}
              className="w-full"
            >
              {regular.map(({ sub, session: s }) => (
                <option key={sub.id} value={sub.id}>
                  {sessionLabelOf(s, lookups)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label="Un jour de la semaine d'absence *"
          hint={week ? `Semaine facturée : du ${frDay(week.start)} au ${frDay(week.end)}.` : undefined}
        >
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Montant facturé (DA)" hint="Le prix de la séance de l'élève ; 0 pour une absence sans débit.">
          <Input type="number" min={0} value={value} onChange={(e) => setAmount(Number(e.target.value))} />
        </Field>
      </div>

      {presences.length > 0 && (
        <Notice tone="danger">
          L&apos;élève a une présence cette semaine ({presences.map((a) => schoolDateTimeLabel(a.timestamp)).join(", ")}) :
          une absence n&apos;est facturée que s&apos;il a manqué toute la semaine.
        </Notice>
      )}
      {existing && <Notice tone="danger">Une absence est déjà facturée sur cette semaine pour ce créneau.</Notice>}
      {unfinished && (
        <Notice tone="danger">
          Cette semaine n&apos;est pas terminée : une absence ne se facture qu&apos;une fois la semaine écoulée.
        </Notice>
      )}

      <Preview before={student.balance} after={student.balance - value} />
      <div className="flex justify-end">
        <Button variant="danger" onClick={submit} disabled={busy || blocked}>
          <CalendarPlus className="h-4 w-4" /> {busy ? "Enregistrement…" : "Enregistrer l'absence"}
        </Button>
      </div>
    </div>
  );
}

function Notice({ tone, children }: { tone: "danger" | "info"; children: React.ReactNode }) {
  return (
    <p
      className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[11px] leading-relaxed ${
        tone === "danger" ? "bg-rose-500/10 text-rose-600 dark:text-rose-300" : "bg-sky-500/10 text-sky-600 dark:text-sky-300"
      }`}
    >
      {tone === "danger" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span>{children}</span>
    </p>
  );
}
