"use client";

import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle,
  CreditCard,
  DollarSign,
  Edit,
  History,
  Phone,
  Repeat,
  Trash2,
  User,
} from "lucide-react";
import { useData } from "@/lib/store/data";
import { useToast } from "@/lib/store/toast";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import {
  allocateDebtPayment,
  daysUntil,
  EXPIRY_WARNING_DAYS,
  formatDateFr,
  formatDays,
  freeReasonOf,
  FREE_REASON_HINTS,
  FREE_REASON_LABELS,
  studentDebtOf,
  type StudentDebt,
} from "@/lib/helpers";
import type {
  AbsencePenalty,
  AttendanceRecord,
  AttendanceStatus,
  BalanceTransaction,
  BalanceTxType,
  Student,
  Subscription,
} from "@/lib/types";

/**
 * LA FICHE ÉTUDIANT, partagée.
 *
 * Elle vivait tout entière à l'intérieur de l'écran Étudiants : pour la
 * montrer ailleurs (la fiche d'une classe, la liste des débiteurs d'un emploi
 * du temps), il aurait fallu la recopier — et deux copies d'une fiche d'argent
 * finissent toujours par ne plus dire la même chose. Elle est donc ici, une
 * seule fois, avec tout ce qu'on y fait : corriger une transaction, annuler
 * une présence (et rembourser), supprimer une absence facturée, régler la
 * dette.
 *
 * Les données sont relues dans le store à chaque synchronisation : la fiche
 * n'affiche jamais un solde d'il y a cinq minutes.
 */

/** Libellés des types de ligne du solde (onglet « Transactions »). */
export const TX_TYPE_LABELS: Record<BalanceTxType, string> = {
  topup: "Versement / Recharge",
  deduction: "Débit (séance, absence…)",
  debt_payment: "Règlement de dette",
  registration: "Frais d'inscription",
};

export type StudentDetailsTab = "personal" | "subs" | "payments" | "attendance";

/** L'historique affiché est la chaîne stockée ; la case d'édition travaille
 *  sur la même chaîne (ce que la ligne montre est ce qu'on modifie). */
const txDateToInput = (iso: string) => iso.substring(0, 16);
const txInputToIso = (value: string) =>
  value.length === 16 ? `${value}:00.000Z` : new Date(value).toISOString();

/** La dette d'UN élève, écart solde ↔ historique compris (0 si l'historique
 *  n'est pas complet : on ne signale rien sur une table amputée). */
function useStudentDebt(student: Student | undefined): StudentDebt | null {
  const { balanceTx, complete } = useData(
    useShallow((s) => ({ balanceTx: s.balanceTx, complete: s.complete.balanceTx })),
  );
  return useMemo(() => {
    if (!student) return null;
    let drift = 0;
    if (complete !== false) {
      let history = 0;
      for (const tx of balanceTx) if (tx.studentId === student.id) history += tx.amount;
      drift = student.balance - history;
    }
    return studentDebtOf(student, { drift });
  }, [student, balanceTx, complete]);
}

// =============================================================================
// Fiche Étudiant
// =============================================================================

export function StudentDetailsModal({
  studentId,
  open,
  onClose,
  initialTab = "personal",
}: {
  studentId: string | null;
  open: boolean;
  onClose: () => void;
  initialTab?: StudentDetailsTab;
}) {
  return (
    <Modal open={open && !!studentId} onClose={onClose} title="Fiche Étudiant" size="xl">
      {studentId && (
        // `key` : chaque élève ouvre sa fiche sur ses propres onglets et filtres.
        <StudentDetailsBody key={studentId} studentId={studentId} onClose={onClose} initialTab={initialTab} />
      )}
    </Modal>
  );
}

function StudentDetailsBody({
  studentId,
  onClose,
  initialTab,
}: {
  studentId: string;
  onClose: () => void;
  initialTab: StudentDetailsTab;
}) {
  const {
    students,
    subscriptions,
    sessions,
    classes,
    modules,
    groups,
    salles,
    coursework,
    balanceTx,
    attendance,
    absencePenalties,
    parents,
    filieres,
    updateItem,
    updateBalanceTx,
    deleteBalanceTx,
    cancelAttendance,
    updateAttendance,
    deleteAbsencePenalty,
  } = useData(
    useShallow((s) => ({
      students: s.students,
      subscriptions: s.subscriptions,
      sessions: s.sessions,
      classes: s.classes,
      modules: s.modules,
      groups: s.groups,
      salles: s.salles,
      coursework: s.coursework,
      balanceTx: s.balanceTx,
      attendance: s.attendance,
      absencePenalties: s.absencePenalties,
      parents: s.parents,
      filieres: s.filieres,
      updateItem: s.updateItem,
      updateBalanceTx: s.updateBalanceTx,
      deleteBalanceTx: s.deleteBalanceTx,
      cancelAttendance: s.cancelAttendance,
      updateAttendance: s.updateAttendance,
      deleteAbsencePenalty: s.deleteAbsencePenalty,
    })),
  );
  const addToast = useToast((s) => s.addToast);

  const student = students.find((s) => s.id === studentId);
  const debt = useStudentDebt(student);

  // ---- Index : une recherche par ligne au lieu d'un parcours de table ----------
  const lookups = useMemo(
    () => ({
      subscription: new Map(subscriptions.map((s) => [s.id, s])),
      session: new Map(sessions.map((s) => [s.id, s])),
      module: new Map(modules.map((m) => [m.id, m])),
      group: new Map(groups.map((g) => [g.id, g])),
      salle: new Map(salles.map((s) => [s.id, s])),
      classe: new Map(classes.map((c) => [c.id, c])),
      filiere: new Map(filieres.map((f) => [f.id, f])),
      coursework: new Map(coursework.map((c) => [c.id, c])),
    }),
    [subscriptions, sessions, modules, groups, salles, classes, filieres, coursework],
  );

  // ---- Ce qui appartient à CET élève -------------------------------------------
  const myTx = useMemo(() => balanceTx.filter((t) => t.studentId === studentId), [balanceTx, studentId]);
  const myAtt = useMemo(() => attendance.filter((a) => a.studentId === studentId), [attendance, studentId]);
  const myPen = useMemo(
    () => absencePenalties.filter((p) => p.studentId === studentId),
    [absencePenalties, studentId],
  );

  // ---- Onglets et filtres ------------------------------------------------------
  const [detailsTab, setDetailsTab] = useState<StudentDetailsTab>(initialTab);
  const [txModuleFilter, setTxModuleFilter] = useState<string>("all");
  const [attModuleFilter, setAttModuleFilter] = useState<string>("all");
  const [attDateMode, setAttDateMode] = useState<"all" | "month" | "range">("all");
  const [attMonth, setAttMonth] = useState("");
  const [attStart, setAttStart] = useState("");
  const [attEnd, setAttEnd] = useState("");
  const [attKindFilter, setAttKindFilter] = useState<"all" | "present" | "absent">("all");

  // ---- Corriger une présence / retirer une absence facturée --------------------
  const [editingAtt, setEditingAtt] = useState<AttendanceRecord | null>(null);
  const [deletingAtt, setDeletingAtt] = useState<AttendanceRecord | null>(null);
  const [deletingPen, setDeletingPen] = useState<AbsencePenalty | null>(null);
  const [attEditStatus, setAttEditStatus] = useState<AttendanceStatus>("present");
  const [attEditDate, setAttEditDate] = useState("");
  const [attEditAmount, setAttEditAmount] = useState<number>(0);
  const [attBusy, setAttBusy] = useState(false);

  // ---- Corriger une ligne de l'historique du solde -----------------------------
  const [editingTx, setEditingTx] = useState<BalanceTransaction | null>(null);
  const [deletingTx, setDeletingTx] = useState<BalanceTransaction | null>(null);
  const [txAmount, setTxAmount] = useState<number>(0);
  const [txDescription, setTxDescription] = useState("");
  const [txDate, setTxDate] = useState("");
  const [txType, setTxType] = useState<BalanceTxType>("topup");
  const [txAdjustCash, setTxAdjustCash] = useState(true);
  const [txBusy, setTxBusy] = useState(false);

  const [payDebtOpen, setPayDebtOpen] = useState(false);

  if (!student || !debt) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted">Cet élève n&apos;existe plus (supprimé depuis un autre poste ?).</p>
        <Button onClick={onClose}>Fermer</Button>
      </div>
    );
  }

  // ---- Libellés ---------------------------------------------------------------
  const sessionOfSub = (subId: string) => {
    const sub = lookups.subscription.get(subId);
    return sub ? lookups.session.get(sub.sessionId) : undefined;
  };

  const getSubLabel = (subId: string) => {
    const sub = lookups.subscription.get(subId);
    if (!sub) {
      const cw = lookups.coursework.get(subId);
      if (cw) return `Stage: ${cw.name}`;
      return "Abonnement inconnu";
    }
    const s = lookups.session.get(sub.sessionId);
    if (!s) return "Séance inconnue";
    const mod = lookups.module.get(s.moduleId)?.name ?? "Module";
    const cls = lookups.classe.get(s.classId)?.name ?? "Classe";
    const grp = lookups.group.get(s.groupId)?.name;
    return `${cls} - ${mod}${grp ? ` (${grp})` : ""}`;
  };

  /** The subscription, if it belongs to a formation class (level-priced, time-limited). */
  const getFormationSub = (subId: string): Subscription | undefined => {
    const sub = lookups.subscription.get(subId);
    if (!sub) return undefined;
    const sess = lookups.session.get(sub.sessionId);
    const cls = sess ? lookups.classe.get(sess.classId) : undefined;
    return cls?.type === "formation" || sub.periodMonths ? sub : undefined;
  };

  /** Modules assigned to the student (via his subscriptions), for the filters. */
  const moduleOptions = (() => {
    const map = new Map<string, string>();
    for (const subId of student.subscriptionIds) {
      const sess = sessionOfSub(subId);
      if (!sess) continue;
      const mod = lookups.module.get(sess.moduleId);
      if (mod) map.set(mod.id, mod.name);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  })();

  const parent = parents.find((p) => p.id === student.parentId);

  // ---- Chiffres de tête ---------------------------------------------------------
  const presences = myAtt.filter((a) => a.status !== "absent").length;
  const absences = myAtt.filter((a) => a.status === "absent").length + myPen.length;
  const totalPaid = myTx
    .filter((t) => t.type === "topup" || t.type === "debt_payment")
    .reduce((sum, t) => sum + Math.max(0, t.amount), 0);

  // ---- Transactions --------------------------------------------------------------
  const openEditTx = (tx: BalanceTransaction) => {
    setEditingTx(tx);
    setTxAmount(tx.amount);
    setTxDescription(tx.description);
    setTxDate(txDateToInput(tx.date));
    setTxType(tx.type);
    setTxAdjustCash(true);
  };

  const openDeleteTx = (tx: BalanceTransaction) => {
    setDeletingTx(tx);
    setTxAdjustCash(true);
  };

  const closeTxModals = () => {
    setEditingTx(null);
    setDeletingTx(null);
    setTxBusy(false);
  };

  const handleUpdateTx = async () => {
    if (!editingTx || !txDate) return;
    setTxBusy(true);
    const res = await updateBalanceTx(editingTx.id, {
      amount: Math.round(txAmount),
      description: txDescription,
      date: txInputToIso(txDate),
      type: txType,
      adjustCash: txAdjustCash,
    });
    setTxBusy(false);
    if (!res.ok) {
      addToast({
        type: "danger",
        title: "Modification impossible",
        message: res.error ?? "La transaction n'a pas pu être modifiée.",
      });
      return;
    }
    addToast({
      type: "success",
      title: "Transaction modifiée",
      message: `Nouveau solde: ${res.newBalance} DA${res.cashAdjusted ? " — caisse corrigée." : ""}`,
    });
    closeTxModals();
  };

  const handleDeleteTx = async () => {
    if (!deletingTx) return;
    setTxBusy(true);
    const res = await deleteBalanceTx(deletingTx.id, txAdjustCash);
    setTxBusy(false);
    if (!res.ok) {
      addToast({
        type: "danger",
        title: "Suppression impossible",
        message: res.error ?? "La transaction n'a pas pu être supprimée.",
      });
      return;
    }
    addToast({
      type: "success",
      title: "Transaction supprimée",
      message: `Nouveau solde: ${res.newBalance} DA${res.cashAdjusted ? " — caisse corrigée." : ""}`,
    });
    closeTxModals();
  };

  // ---- Présences -----------------------------------------------------------------
  // A presence carries money (it debited the séance), so editing/removing one
  // has to move the balance back by the same amount — both live in a
  // server-side RPC (update_attendance / cancel_attendance) for that reason.
  const openEditAtt = (att: AttendanceRecord) => {
    setEditingAtt(att);
    setAttEditStatus(att.status);
    setAttEditDate(att.timestamp.substring(0, 16));
    setAttEditAmount(att.amountDeducted);
  };

  const closeAttModals = () => {
    setEditingAtt(null);
    setDeletingAtt(null);
    setDeletingPen(null);
    setAttBusy(false);
  };

  const handleUpdateAtt = async () => {
    if (!editingAtt || !attEditDate) return;
    setAttBusy(true);
    const res = await updateAttendance(editingAtt.id, {
      status: attEditStatus,
      occurredAt: txInputToIso(attEditDate),
      amount: Math.max(0, Math.round(attEditAmount || 0)),
    });
    setAttBusy(false);
    if (!res.ok) {
      addToast({
        type: "danger",
        title: "Modification impossible",
        message:
          res.messageKey === "attendance.duplicateDay"
            ? "Une présence existe déjà pour cet élève sur ce créneau à cette date."
            : "La présence n'a pas pu être modifiée.",
      });
      return;
    }
    addToast({
      type: "success",
      title: "Présence modifiée",
      message: `Montant: ${res.cost ?? 0} DA — nouveau solde: ${res.newBalance ?? 0} DA.`,
    });
    closeAttModals();
  };

  const handleDeleteAtt = async () => {
    if (!deletingAtt) return;
    setAttBusy(true);
    const res = await cancelAttendance(deletingAtt.id);
    setAttBusy(false);
    if (!res.ok) {
      addToast({ type: "danger", title: "Suppression impossible", message: "La présence n'a pas pu être supprimée." });
      return;
    }
    addToast({
      type: "success",
      title: "Présence supprimée",
      message: `${res.refunded ? `${res.refunded} DA remboursés — ` : ""}nouveau solde: ${res.newBalance ?? 0} DA.`,
    });
    closeAttModals();
  };

  const handleDeletePenalty = async () => {
    if (!deletingPen) return;
    setAttBusy(true);
    const res = await deleteAbsencePenalty(deletingPen.id);
    setAttBusy(false);
    if (!res.ok) {
      addToast({ type: "danger", title: "Suppression impossible", message: "L'absence n'a pas pu être supprimée." });
      return;
    }
    addToast({
      type: "success",
      title: "Absence supprimée",
      message: `${res.refunded ?? 0} DA remboursés — nouveau solde: ${res.newBalance ?? 0} DA.`,
    });
    closeAttModals();
  };

  const tabClass = (tab: StudentDetailsTab) =>
    `pb-2.5 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
      detailsTab === tab ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
    }`;

  return (
    <div className="space-y-6">
      {/* En-tête : qui, et où il en est — sans ouvrir un seul onglet. */}
      <div className="rounded-2xl border border-line bg-primary-50/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-base font-black text-primary">
              {student.firstName.substring(0, 1)}
              {student.lastName.substring(0, 1)}
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-lg font-bold text-ink">
                {student.firstName} {student.lastName}
              </h3>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                <span className="flex items-center gap-1">
                  <CreditCard className="h-3 w-3" /> {student.rfid || "—"}
                </span>
                <span className="flex items-center gap-1">
                  <Phone className="h-3 w-3" /> {student.phone || "—"}
                </span>
              </span>
            </div>
          </div>
          <Badge
            tone={debt.alert ? "danger" : student.isFree ? "success" : "primary"}
            className="px-3 py-1 text-sm"
          >
            {student.isFree ? "Études gratuites" : `${student.balance} DA`}
          </Badge>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <HeadStat label="Solde" value={`${student.balance} DA`} tone={student.balance < 0 ? "danger" : "success"} />
          <HeadStat label="Dette" value={`${debt.total} DA`} tone={debt.total > 0 ? "danger" : "neutral"} />
          <HeadStat label="Présences" value={String(presences)} tone="success" />
          <HeadStat label="Absences" value={String(absences)} tone={absences > 0 ? "warning" : "neutral"} />
          <HeadStat label="Total versé" value={`${totalPaid} DA`} tone="primary" />
        </div>
      </div>

      {/* Ce que l'élève doit, en haut de sa fiche et non au fond d'un onglet :
          c'est la question qu'on se pose en ouvrant la fiche. Le badge du
          chiffre ne suffit pas — un solde négatif se lit comme un solde tant
          qu'on ne le nomme pas « dette ». */}
      {debt.alert && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/50 bg-danger/10 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 animate-pulse text-danger" />
            <div>
              <strong className="block text-xs font-bold text-danger">DETTE : {debt.total} DA à régler</strong>
              <span className="text-[10px] text-danger/90">
                {debt.sessions > 0 && (
                  <>
                    Séances suivies et non payées : {debt.sessions} DA — c&apos;est exactement ce que son
                    solde affiche en négatif.{" "}
                  </>
                )}
                {debt.registration > 0 && <>Frais d&apos;inscription impayés : {debt.registration} DA. </>}
                Chaque nouvelle séance creuse la dette d&apos;autant.
              </span>
            </div>
          </div>
          <Button size="sm" variant="danger" onClick={() => setPayDebtOpen(true)}>
            <DollarSign className="me-1 h-3.5 w-3.5" /> Régler la dette
          </Button>
        </div>
      )}

      {/* L'INCOHÉRENCE, séparée de la DETTE — parce qu'on n'en fait pas la même
          chose. Une dette s'encaisse au guichet ; un solde qui s'écarte de son
          propre historique se répare en base. */}
      {debt.drift !== 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-warning/50 bg-warning/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <strong className="block text-xs font-bold text-warning">
              SOLDE À VÉRIFIER : {Math.abs(debt.drift)} DA d&apos;écart avec l&apos;historique
            </strong>
            <span className="text-[10px] text-warning/90">
              Le solde affiché ({student.balance} DA) ne vaut pas la somme des lignes de l&apos;onglet
              Transactions ({student.balance - debt.drift} DA). Ce n&apos;est pas un montant à encaisser :
              c&apos;est une écriture qui a manqué sa cible. À corriger en base avec{" "}
              <code className="font-mono">reconcile_student_balances(true)</code>.
            </span>
          </div>
        </div>
      )}

      {/* Navigation Tabs inside details modal */}
      <div className="flex gap-2 overflow-x-auto border-b border-line">
        <button onClick={() => setDetailsTab("personal")} className={tabClass("personal")}>
          <User className="h-4 w-4" /> Personnel
        </button>
        <button onClick={() => setDetailsTab("subs")} className={tabClass("subs")}>
          <BookOpen className="h-4 w-4" /> Abonnements ({student.subscriptionIds.length})
        </button>
        <button onClick={() => setDetailsTab("payments")} className={tabClass("payments")}>
          <History className="h-4 w-4" /> Transactions ({myTx.length})
        </button>
        <button onClick={() => setDetailsTab("attendance")} className={tabClass("attendance")}>
          <CheckCircle className="h-4 w-4" /> Présences &amp; Absences ({myAtt.length + myPen.length})
        </button>
      </div>

      {/* Tab Contents */}
      <div className="min-h-[220px]">
        {detailsTab === "personal" && (
          <div className="grid grid-cols-1 gap-4 text-xs md:grid-cols-2">
            <Field label="Date de naissance" value={student.birthDate ? formatDateFr(student.birthDate) : "-"} />
            <Field label="Téléphone" value={student.phone || "-"} />
            <Field label="Email de connexion" value={student.email || "-"} />
            <div>
              <span className="mb-0.5 block font-semibold text-muted">Mot de passe de connexion:</span>
              <span className="text-xs italic text-muted">
                Non affiché — utilisez « Modifier » (écran Étudiants) pour définir un nouveau mot de passe.
              </span>
            </div>
            <Field
              label="Tuteur affecté"
              value={parent ? `${parent.firstName} ${parent.lastName} (${parent.phone})` : "Aucun tuteur assigné"}
            />
            <Field
              label="Frais d'inscription"
              value={(student.registrationDue ?? 0) > 0 ? `${student.registrationDue} DA restent dus` : "Payés ✔"}
            />
            {student.createdAt && (
              <Field label="Inscrit le" value={formatDateFr(student.createdAt.slice(0, 10))} />
            )}
          </div>
        )}

        {detailsTab === "subs" && (
          <div className="space-y-2">
            {student.subscriptionIds.length === 0 ? (
              <p className="text-xs italic text-muted">Non inscrit à des cours ou stages.</p>
            ) : (
              student.subscriptionIds.map((subId) => {
                const sub = lookups.subscription.get(subId);
                const isCw = !sub;
                const formationSub = isCw ? undefined : getFormationSub(subId);
                const dates = student.subscriptionDates?.[subId];
                const days = dates?.expiryDate ? daysUntil(dates.expiryDate) : null;
                const sess = sessionOfSub(subId);
                return (
                  <div
                    key={subId}
                    className="flex items-center justify-between rounded-xl border border-line bg-canvas p-3 text-xs"
                  >
                    <div>
                      <strong className="block text-ink">{getSubLabel(subId)}</strong>
                      <span className="text-[10px] text-muted">
                        {isCw
                          ? "Stage Intensif"
                          : formationSub
                            ? `Formation · Prix du niveau: ${formationSub.levelPrice ?? 0} DA · ${formationSub.periodMonths ?? 0} mois`
                            : `Tarif: ${sub?.pricePerSession} DA / séance`}
                        {sess ? ` · ${formatDays(sess.days)} ${sess.startTime}-${sess.endTime}` : ""}
                      </span>
                      {!isCw && (
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted">
                          <span>
                            Inscrit le <strong className="text-ink">{formatDateFr(dates?.subscribedAt)}</strong>
                          </span>
                          <span>
                            · Début <strong className="text-ink">{formatDateFr(dates?.startDate)}</strong>
                          </span>
                          {dates?.startDate && daysUntil(dates.startDate) > 0 && (
                            <Badge tone="success" className="px-1.5 py-0 text-[9px]">
                              Pas encore commencé — séances offertes
                            </Badge>
                          )}
                        </span>
                      )}
                      {formationSub && dates?.expiryDate && days !== null && (
                        <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted">
                          Du {formatDateFr(dates.startDate)} au {formatDateFr(dates.expiryDate)}
                          <Badge
                            tone={days < 0 ? "danger" : days <= EXPIRY_WARNING_DAYS ? "warning" : "success"}
                            className="px-1.5 py-0 text-[9px]"
                          >
                            {days < 0
                              ? "Expirée"
                              : days === 0
                                ? "Expire aujourd'hui"
                                : days <= EXPIRY_WARNING_DAYS
                                  ? `Expire dans ${days} j`
                                  : "Active"}
                          </Badge>
                        </span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("Se désabonner de ce module ?")) {
                          updateItem("students", student.id, {
                            subscriptionIds: student.subscriptionIds.filter((id) => id !== subId),
                          });
                        }
                      }}
                      className="text-danger hover:bg-danger/10"
                    >
                      Désinscrire
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        )}

        {detailsTab === "payments" &&
          (() => {
            const filterModuleName =
              txModuleFilter === "all" ? "" : lookups.module.get(txModuleFilter)?.name ?? "";
            const txList = myTx.filter((t) => {
              if (txModuleFilter === "all") return true;
              // Rows older than balance_tx.module_id are matched by the module
              // name embedded in their description.
              if (t.moduleId) return t.moduleId === txModuleFilter;
              return !!filterModuleName && t.description.toLowerCase().includes(filterModuleName.toLowerCase());
            });
            return (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-canvas/40 p-2">
                  <label className="shrink-0 text-[10px] font-bold uppercase text-muted">Module :</label>
                  <Select value={txModuleFilter} onChange={(e) => setTxModuleFilter(e.target.value)} className="w-52">
                    <option value="all">Tous les modules</option>
                    {moduleOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                  <span className="ms-auto font-mono text-[10px] text-muted">{txList.length} transaction(s)</span>
                </div>
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {txList.length === 0 ? (
                    <p className="text-xs italic text-muted">Aucune transaction pour ce filtre.</p>
                  ) : (
                    [...txList].reverse().map((tx) => {
                      const isAbsence = tx.amount < 0 && tx.description.startsWith("Absence hebdomadaire");
                      return (
                        <div
                          key={tx.id}
                          className={`flex items-center justify-between gap-2 rounded-xl border p-3 text-xs ${
                            isAbsence ? "border-warning/40 bg-warning/5" : "border-line bg-canvas"
                          }`}
                        >
                          <div className="min-w-0">
                            <strong className="flex items-center gap-1.5 text-ink">
                              {isAbsence && <Badge tone="warning">Absence</Badge>}
                              {tx.description}
                            </strong>
                            <span className="text-[10px] text-muted">
                              {tx.date.substring(0, 16).replace("T", " ")} · {TX_TYPE_LABELS[tx.type]}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <strong className={tx.amount > 0 ? "font-bold text-success" : "font-bold text-danger"}>
                              {tx.amount > 0 ? `+${tx.amount}` : tx.amount} DA
                            </strong>
                            {/* Correction manuelle d'une ligne (montant saisi de travers, doublon…) */}
                            <button
                              onClick={() => openEditTx(tx)}
                              title="Modifier cette transaction"
                              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-primary-50 hover:text-primary"
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => openDeleteTx(tx)}
                              title="Supprimer cette transaction"
                              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()}

        {detailsTab === "attendance" &&
          (() => {
            const inDateWindow = (when: Date) => {
              if (attDateMode === "month" && attMonth) {
                const key = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}`;
                if (key !== attMonth) return false;
              }
              if (attDateMode === "range") {
                if (attStart && when < new Date(`${attStart}T00:00:00`)) return false;
                if (attEnd && when > new Date(`${attEnd}T23:59:59.999`)) return false;
              }
              return true;
            };
            const attList = myAtt.filter((att) => {
              if (attModuleFilter !== "all") {
                const sess = lookups.session.get(att.sessionId);
                if (!sess || sess.moduleId !== attModuleFilter) return false;
              }
              if (attKindFilter === "absent" && att.status !== "absent") return false;
              if (attKindFilter === "present" && att.status === "absent") return false;
              return inDateWindow(new Date(att.timestamp));
            });
            // Automatic weekly-absence charges, shown alongside real scans so the
            // presence history tells the whole story.
            const penList = myPen.filter((pen) => {
              if (attModuleFilter !== "all" && pen.moduleId !== attModuleFilter) return false;
              if (attKindFilter === "present") return false;
              return inDateWindow(new Date(`${pen.periodEnd}T12:00:00`));
            });
            const presentCount = attList.filter((a) => a.status !== "absent").length;
            const lateCount = attList.filter((a) => a.status === "late").length;
            const absentTotal = attList.filter((a) => a.status === "absent").length + penList.length;
            const chargedTotal =
              attList.reduce((sum, a) => sum + a.amountDeducted, 0) + penList.reduce((sum, p) => sum + p.amount, 0);
            const fmtDay = (d: string) => d.split("-").reverse().join("/");
            const rows = [
              ...attList.map((att) => ({ kind: "att" as const, id: att.id, when: new Date(att.timestamp), att })),
              ...penList.map((pen) => ({
                kind: "pen" as const,
                id: pen.id,
                when: new Date(`${pen.periodEnd}T12:00:00`),
                pen,
              })),
            ].sort((a, b) => b.when.getTime() - a.when.getTime());
            return (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-canvas/40 p-2">
                  <label className="shrink-0 text-[10px] font-bold uppercase text-muted">Module :</label>
                  <Select
                    value={attModuleFilter}
                    onChange={(e) => setAttModuleFilter(e.target.value)}
                    className="w-44"
                  >
                    <option value="all">Tous les modules</option>
                    {moduleOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>

                  <label className="ms-2 shrink-0 text-[10px] font-bold uppercase text-muted">Date :</label>
                  <div className="flex gap-1">
                    {(
                      [
                        ["all", "Tout"],
                        ["month", "Par mois"],
                        ["range", "Période"],
                      ] as const
                    ).map(([mode, label]) => (
                      <Button
                        key={mode}
                        size="sm"
                        variant={attDateMode === mode ? "primary" : "outline"}
                        onClick={() => setAttDateMode(mode)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>

                  {attDateMode === "month" && (
                    <Input type="month" value={attMonth} onChange={(e) => setAttMonth(e.target.value)} className="w-40" />
                  )}
                  {attDateMode === "range" && (
                    <div className="flex items-center gap-1.5">
                      <Input type="date" value={attStart} onChange={(e) => setAttStart(e.target.value)} className="w-36" />
                      <span className="text-[10px] text-muted">→</span>
                      <Input type="date" value={attEnd} onChange={(e) => setAttEnd(e.target.value)} className="w-36" />
                    </div>
                  )}

                  <label className="ms-2 shrink-0 text-[10px] font-bold uppercase text-muted">Type :</label>
                  <div className="flex gap-1">
                    {(
                      [
                        ["all", "Tout"],
                        ["present", "Présences"],
                        ["absent", "Absences"],
                      ] as const
                    ).map(([mode, label]) => (
                      <Button
                        key={mode}
                        size="sm"
                        variant={attKindFilter === mode ? "primary" : "outline"}
                        onClick={() => setAttKindFilter(mode)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Compte-rendu du filtre courant */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-xl border border-success/30 bg-success/5 p-2 text-center">
                    <span className="block text-[10px] font-semibold text-muted">Présences</span>
                    <strong className="text-sm text-success">{presentCount}</strong>
                  </div>
                  <div className="rounded-xl border border-warning/30 bg-warning/5 p-2 text-center">
                    <span className="block text-[10px] font-semibold text-muted">Dont retards</span>
                    <strong className="text-sm text-warning">{lateCount}</strong>
                  </div>
                  <div className="rounded-xl border border-danger/30 bg-danger/5 p-2 text-center">
                    <span className="block text-[10px] font-semibold text-muted">Absences</span>
                    <strong className="text-sm text-danger">{absentTotal}</strong>
                  </div>
                  <div className="rounded-xl border border-line bg-canvas/40 p-2 text-center">
                    <span className="block text-[10px] font-semibold text-muted">Total débité</span>
                    <strong className="text-sm text-ink">{chargedTotal} DA</strong>
                  </div>
                </div>

                <div className="max-h-80 space-y-2 overflow-y-auto">
                  {rows.length === 0 ? (
                    <p className="text-xs italic text-muted">Aucune présence ni absence pour ces filtres.</p>
                  ) : (
                    rows.map((row) => {
                      if (row.kind === "att") {
                        const att = row.att;
                        const s = lookups.session.get(att.sessionId);
                        const modName = s ? lookups.module.get(s.moduleId)?.name : "Module";
                        const grpName = s ? lookups.group.get(s.groupId)?.name : undefined;
                        const salleName = s ? lookups.salle.get(s.salleId)?.name : undefined;
                        const isAbsent = att.status === "absent";
                        const reason = freeReasonOf(att, {
                          studentIsFree: student.isFree,
                          sessionIsFree: !!s?.isFree,
                        });
                        return (
                          <div
                            key={att.id}
                            className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-xs ${
                              isAbsent ? "border-danger/30 bg-danger/5" : "border-line bg-canvas"
                            }`}
                          >
                            <div className="min-w-0">
                              <strong className="block text-ink">
                                {isAbsent ? "Absence" : "Présence"}: {modName}
                                {grpName ? <span className="font-semibold text-muted"> — {grpName}</span> : null}
                                {att.substituteGroup && (
                                  <Badge tone="primary" className="ms-1.5 px-1.5 py-0 text-[9px]">
                                    <Repeat className="me-0.5 inline h-2.5 w-2.5" /> Autre groupe
                                  </Badge>
                                )}
                              </strong>
                              <span className="text-[10px] text-muted">
                                {att.timestamp.substring(0, 16).replace("T", " ")}
                                {s ? ` · ${s.startTime}-${s.endTime}` : ""}
                                {salleName ? ` · Salle ${salleName}` : ""}
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <Badge
                                tone={att.status === "present" ? "success" : att.status === "late" ? "warning" : "danger"}
                              >
                                {att.status === "present" ? "Présent" : att.status === "late" ? "En retard" : "Absent"}
                              </Badge>
                              {/* « Pourquoi le solde n'a-t-il pas bougé ? » se lit ICI. */}
                              {!reason ? (
                                <span className="text-[10px] font-bold text-danger">-{att.amountDeducted} DA</span>
                              ) : (
                                <span className="text-[10px] font-bold text-success" title={FREE_REASON_HINTS[reason]}>
                                  Offert · {FREE_REASON_LABELS[reason]}
                                  {(att.waivedAmount ?? 0) > 0 ? ` (${att.waivedAmount} DA)` : ""}
                                </span>
                              )}
                              <button
                                onClick={() => openEditAtt(att)}
                                title="Modifier cette présence"
                                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-primary-50 hover:text-primary"
                              >
                                <Edit className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => setDeletingAtt(att)}
                                title="Supprimer cette présence (et rembourser)"
                                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      }
                      const pen = row.pen;
                      const s = pen.sessionId ? lookups.session.get(pen.sessionId) : undefined;
                      const modName = (pen.moduleId && lookups.module.get(pen.moduleId)?.name) || "Module";
                      const grpName = s ? lookups.group.get(s.groupId)?.name : undefined;
                      return (
                        <div
                          key={pen.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs"
                        >
                          <div className="min-w-0">
                            <strong className="block text-ink">
                              Absence facturée: {modName}
                              {grpName ? <span className="font-semibold text-muted"> — {grpName}</span> : null}
                            </strong>
                            <span className="text-[10px] text-muted">
                              Semaine du {fmtDay(pen.periodStart)} au {fmtDay(pen.periodEnd)}
                              {" · "}solde après :{" "}
                              <span className={pen.balanceAfter < 0 ? "font-bold text-danger" : ""}>
                                {pen.balanceAfter} DA
                              </span>
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <Badge tone="danger">Absent (semaine)</Badge>
                            <span className="text-[10px] font-bold text-danger">-{pen.amount} DA</span>
                            <button
                              onClick={() => setDeletingPen(pen)}
                              title="Supprimer cette absence (et rembourser)"
                              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()}
      </div>

      <div className="flex justify-end border-t border-line pt-2">
        <Button onClick={onClose}>Fermer</Button>
      </div>

      {/* Edit one line of the balance history — the RPC moves students.balance
          by the same delta, so history and balance can never drift apart. */}
      <Modal open={!!editingTx} onClose={closeTxModals} title="Modifier la transaction">
        {editingTx &&
          (() => {
            const previewBalance = student.balance - editingTx.amount + Math.round(txAmount || 0);
            const delta = Math.round(txAmount || 0) - editingTx.amount;
            return (
              <div className="space-y-4">
                <div className="space-y-0.5 rounded-xl border border-line bg-canvas p-3 text-xs">
                  <strong className="block text-ink">
                    {student.firstName} {student.lastName}
                  </strong>
                  <span className="block text-muted">
                    Ligne d&apos;origine : {editingTx.amount > 0 ? `+${editingTx.amount}` : editingTx.amount} DA ·{" "}
                    {editingTx.date.substring(0, 16).replace("T", " ")}
                  </span>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Type</label>
                  <Select value={txType} onChange={(e) => setTxType(e.target.value as BalanceTxType)} className="w-full">
                    {(Object.keys(TX_TYPE_LABELS) as BalanceTxType[]).map((t) => (
                      <option key={t} value={t}>
                        {TX_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Montant (DA)</label>
                  <Input type="number" value={txAmount} onChange={(e) => setTxAmount(Number(e.target.value))} />
                  <p className="mt-1 text-[10px] text-muted">
                    Montant signé : <strong>positif</strong> pour un versement/crédit, <strong>négatif</strong> pour un
                    débit.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Description</label>
                  <Input value={txDescription} onChange={(e) => setTxDescription(e.target.value)} />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Date</label>
                  <Input type="datetime-local" value={txDate} onChange={(e) => setTxDate(e.target.value)} />
                </div>

                {editingTx.type === "topup" && (
                  <label className="flex cursor-pointer items-center justify-between rounded-xl border border-line bg-canvas p-3">
                    <span className="text-xs font-bold text-ink">
                      Corriger aussi la caisse
                      <span className="block text-[10px] font-normal text-muted">
                        Écrit une écriture de correction de {delta > 0 ? `+${delta}` : delta} DA dans la caisse (le
                        versement d&apos;origine y avait été enregistré).
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={txAdjustCash}
                      onChange={(e) => setTxAdjustCash(e.target.checked)}
                      className="h-5 w-5 shrink-0"
                    />
                  </label>
                )}

                <div className="flex items-center justify-between rounded-xl border border-primary/25 bg-primary-50/40 p-3 text-xs">
                  <span className="font-semibold text-muted">Solde après correction</span>
                  <strong className={previewBalance < 0 ? "text-danger" : "text-success"}>{previewBalance} DA</strong>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={closeTxModals} disabled={txBusy}>
                    Annuler
                  </Button>
                  <Button onClick={handleUpdateTx} disabled={txBusy || !txDate}>
                    {txBusy ? "Enregistrement…" : "Enregistrer"}
                  </Button>
                </div>
              </div>
            );
          })()}
      </Modal>

      {/* Delete one line of the balance history */}
      <Modal open={!!deletingTx} onClose={closeTxModals} title="Supprimer la transaction">
        {deletingTx &&
          (() => {
            const previewBalance = student.balance - deletingTx.amount;
            return (
              <div className="space-y-4">
                <div className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/5 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                  <p className="text-xs leading-relaxed text-ink">
                    Cette transaction sera définitivement supprimée et son effet sur le solde annulé.
                    {deletingTx.type === "deduction" && (
                      <span className="mt-1 block text-muted">
                        La présence liée (onglet « Présences ») n&apos;est pas supprimée pour autant.
                      </span>
                    )}
                  </p>
                </div>

                <div className="space-y-0.5 rounded-xl border border-line bg-canvas p-3 text-xs">
                  <strong className="block text-ink">{deletingTx.description}</strong>
                  <span className="block text-muted">
                    {student.firstName} {student.lastName} · {deletingTx.date.substring(0, 16).replace("T", " ")} ·{" "}
                    {TX_TYPE_LABELS[deletingTx.type]}
                  </span>
                  <strong className={deletingTx.amount > 0 ? "text-success" : "text-danger"}>
                    {deletingTx.amount > 0 ? `+${deletingTx.amount}` : deletingTx.amount} DA
                  </strong>
                </div>

                {deletingTx.type === "topup" && (
                  <label className="flex cursor-pointer items-center justify-between rounded-xl border border-line bg-canvas p-3">
                    <span className="text-xs font-bold text-ink">
                      Corriger aussi la caisse
                      <span className="block text-[10px] font-normal text-muted">
                        Écrit une écriture d&apos;annulation de {-deletingTx.amount} DA dans la caisse.
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={txAdjustCash}
                      onChange={(e) => setTxAdjustCash(e.target.checked)}
                      className="h-5 w-5 shrink-0"
                    />
                  </label>
                )}

                <div className="flex items-center justify-between rounded-xl border border-primary/25 bg-primary-50/40 p-3 text-xs">
                  <span className="font-semibold text-muted">Solde après suppression</span>
                  <strong className={previewBalance < 0 ? "text-danger" : "text-success"}>{previewBalance} DA</strong>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={closeTxModals} disabled={txBusy}>
                    Annuler
                  </Button>
                  <Button variant="danger" onClick={handleDeleteTx} disabled={txBusy}>
                    {txBusy ? "Suppression…" : "Supprimer"}
                  </Button>
                </div>
              </div>
            );
          })()}
      </Modal>

      {/* Correct one presence — the RPC moves the balance by the same delta */}
      <Modal open={!!editingAtt} onClose={closeAttModals} title="Modifier la présence">
        {editingAtt &&
          (() => {
            const s = lookups.session.get(editingAtt.sessionId);
            const modName = s ? lookups.module.get(s.moduleId)?.name ?? "Module" : "Module";
            const grpName = s ? lookups.group.get(s.groupId)?.name ?? "-" : "-";
            const delta = Math.max(0, Math.round(attEditAmount || 0)) - editingAtt.amountDeducted;
            const previewBalance = student.balance - delta;
            return (
              <div className="space-y-4">
                <div className="space-y-0.5 rounded-xl border border-line bg-canvas p-3 text-xs">
                  <strong className="block text-ink">
                    {modName} — {grpName}
                    {editingAtt.substituteGroup && (
                      <Badge tone="primary" className="ms-1.5 px-1.5 py-0 text-[9px]">
                        Autre groupe
                      </Badge>
                    )}
                  </strong>
                  <span className="block text-muted">
                    {student.firstName} {student.lastName}
                    {s ? ` · ${formatDays(s.days)} · ${s.startTime}-${s.endTime}` : ""}
                  </span>
                  <span className="block text-muted">Débit d&apos;origine : {editingAtt.amountDeducted} DA</span>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Statut</label>
                  <Select
                    value={attEditStatus}
                    onChange={(e) => setAttEditStatus(e.target.value as AttendanceStatus)}
                    className="w-full"
                  >
                    <option value="present">Présent</option>
                    <option value="late">En retard</option>
                    <option value="absent">Absent</option>
                  </Select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Date et heure</label>
                  <Input type="datetime-local" value={attEditDate} onChange={(e) => setAttEditDate(e.target.value)} />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Montant débité (DA)</label>
                  <Input
                    type="number"
                    min={0}
                    value={attEditAmount}
                    onChange={(e) => setAttEditAmount(Number(e.target.value))}
                  />
                  <p className="mt-1 text-[10px] text-muted">
                    La différence est reportée sur le solde de l&apos;élève et tracée dans ses transactions. Mettez{" "}
                    <strong>0</strong> pour une séance offerte.
                  </p>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-primary/25 bg-primary-50/40 p-3 text-xs">
                  <span className="font-semibold text-muted">Solde après correction</span>
                  <strong className={previewBalance < 0 ? "text-danger" : "text-success"}>{previewBalance} DA</strong>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={closeAttModals} disabled={attBusy}>
                    Annuler
                  </Button>
                  <Button onClick={handleUpdateAtt} disabled={attBusy || !attEditDate}>
                    {attBusy ? "Enregistrement…" : "Enregistrer"}
                  </Button>
                </div>
              </div>
            );
          })()}
      </Modal>

      {/* Delete one presence — refunds the séance and clears the teacher due */}
      <Modal open={!!deletingAtt} onClose={closeAttModals} title="Supprimer la présence">
        {deletingAtt &&
          (() => {
            const s = lookups.session.get(deletingAtt.sessionId);
            const modName = s ? lookups.module.get(s.moduleId)?.name ?? "Module" : "Module";
            const grpName = s ? lookups.group.get(s.groupId)?.name ?? "-" : "-";
            const previewBalance = student.balance + deletingAtt.amountDeducted;
            return (
              <div className="space-y-4">
                <div className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/5 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                  <p className="text-xs leading-relaxed text-ink">
                    La présence sera supprimée, les {deletingAtt.amountDeducted} DA débités seront remboursés et la
                    part due à l&apos;enseignant pour cette séance sera annulée.
                  </p>
                </div>

                <div className="space-y-0.5 rounded-xl border border-line bg-canvas p-3 text-xs">
                  <strong className="block text-ink">
                    {modName} — {grpName}
                  </strong>
                  <span className="block text-muted">
                    {student.firstName} {student.lastName} · {deletingAtt.timestamp.substring(0, 16).replace("T", " ")}
                  </span>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-primary/25 bg-primary-50/40 p-3 text-xs">
                  <span className="font-semibold text-muted">Solde après suppression</span>
                  <strong className={previewBalance < 0 ? "text-danger" : "text-success"}>{previewBalance} DA</strong>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={closeAttModals} disabled={attBusy}>
                    Annuler
                  </Button>
                  <Button variant="danger" onClick={handleDeleteAtt} disabled={attBusy}>
                    {attBusy ? "Suppression…" : "Supprimer"}
                  </Button>
                </div>
              </div>
            );
          })()}
      </Modal>

      {/* Delete one automatic weekly-absence charge */}
      <Modal open={!!deletingPen} onClose={closeAttModals} title="Supprimer l'absence facturée">
        {deletingPen &&
          (() => {
            const modName = (deletingPen.moduleId && lookups.module.get(deletingPen.moduleId)?.name) || "Module";
            const previewBalance = student.balance + deletingPen.amount;
            const fmt = (d: string) => d.split("-").reverse().join("/");
            return (
              <div className="space-y-4">
                <div className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/5 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                  <p className="text-xs leading-relaxed text-ink">
                    L&apos;absence hebdomadaire sera supprimée, les {deletingPen.amount} DA facturés seront remboursés et
                    la ligne correspondante disparaîtra de l&apos;historique du solde.
                  </p>
                </div>

                <div className="space-y-0.5 rounded-xl border border-line bg-canvas p-3 text-xs">
                  <strong className="block text-ink">{modName}</strong>
                  <span className="block text-muted">
                    {student.firstName} {student.lastName} · Semaine du {fmt(deletingPen.periodStart)} au{" "}
                    {fmt(deletingPen.periodEnd)}
                  </span>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-primary/25 bg-primary-50/40 p-3 text-xs">
                  <span className="font-semibold text-muted">Solde après suppression</span>
                  <strong className={previewBalance < 0 ? "text-danger" : "text-success"}>{previewBalance} DA</strong>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={closeAttModals} disabled={attBusy}>
                    Annuler
                  </Button>
                  <Button variant="danger" onClick={handleDeletePenalty} disabled={attBusy}>
                    {attBusy ? "Suppression…" : "Supprimer"}
                  </Button>
                </div>
              </div>
            );
          })()}
      </Modal>

      <PayDebtModal studentId={payDebtOpen ? student.id : null} onClose={() => setPayDebtOpen(false)} />
    </div>
  );
}

function HeadStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "danger" | "warning" | "primary" | "neutral";
}) {
  const color = {
    success: "text-success",
    danger: "text-danger",
    warning: "text-warning",
    primary: "text-primary",
    neutral: "text-ink",
  }[tone];
  return (
    <div className="rounded-xl border border-line bg-surface p-2.5 text-center">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <strong className={`mt-0.5 block text-sm font-black ${color}`}>{value}</strong>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="mb-0.5 block font-semibold text-muted">{label}:</span>
      <span className="font-bold text-ink">{value}</span>
    </div>
  );
}

// =============================================================================
// Paiement de dette
// =============================================================================

/**
 * Encaisse un règlement de dette. La répartition est décidée côté serveur :
 * l'inscription due d'abord, les séances suivies ensuite, le reste au solde —
 * et l'argent entre en caisse. La fenêtre l'annonce AVANT de valider.
 */
export function PayDebtModal({ studentId, onClose }: { studentId: string | null; onClose: () => void }) {
  return (
    <Modal open={!!studentId} onClose={onClose} title="Paiement de Dette">
      {studentId && <PayDebtBody key={studentId} studentId={studentId} onClose={onClose} />}
    </Modal>
  );
}

function PayDebtBody({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const student = useData((s) => s.students.find((st) => st.id === studentId));
  const payDebt = useData((s) => s.payDebt);
  const addToast = useToast((s) => s.addToast);
  const debt = useStudentDebt(student);
  // Ce que la RPC sait régler : le solde négatif et l'inscription due.
  const [payAmount, setPayAmount] = useState<number>(() => debt?.total ?? 0);
  const [busy, setBusy] = useState(false);

  if (!student || !debt) return null;

  const submit = async () => {
    if (payAmount <= 0 || busy) return;
    setBusy(true);
    const amount = payAmount;
    const res = await payDebt(student.id, amount);
    setBusy(false);
    const parts = [
      (res.registrationPaid ?? 0) > 0 ? `${res.registrationPaid} DA d'inscription` : "",
      (res.debtPaid ?? 0) > 0 ? `${res.debtPaid} DA de séances suivies` : "",
      (res.credited ?? 0) > 0 ? `${res.credited} DA portés au solde` : "",
    ].filter(Boolean);
    addToast({
      type: res.ok ? "success" : "danger",
      title: res.ok ? "Dette réglée" : "Règlement refusé",
      message: res.ok
        ? `${amount} DA encaissés${parts.length ? ` — ${parts.join(", ")}` : ""}.`
        : `La base a refusé le règlement : ${res.error ?? "erreur inconnue"}.`,
      studentName: `${student.firstName} ${student.lastName}`,
    });
    if (res.ok) onClose();
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1 rounded-xl border border-line bg-canvas p-3 text-xs">
        <div>
          <span className="block text-[10px] uppercase text-muted">Étudiant</span>
          <strong className="text-ink">
            {student.firstName} {student.lastName}
          </strong>
        </div>
        <div className="mt-1 flex justify-between border-t border-line/50 pt-1.5">
          <span className="text-muted">Solde:</span>
          <strong className={student.balance < 0 ? "text-danger" : "text-success"}>{student.balance} DA</strong>
        </div>
        {debt.sessions > 0 && (
          <div className="flex justify-between">
            <span className="text-muted">Séances suivies non payées:</span>
            <strong className="text-danger">{debt.sessions} DA</strong>
          </div>
        )}
        {debt.registration > 0 && (
          <div className="flex justify-between">
            <span className="text-muted">Frais inscription:</span>
            <strong className="text-danger">{debt.registration} DA</strong>
          </div>
        )}
        <div className="mt-1 flex justify-between border-t border-line/50 pt-1.5">
          <span className="font-bold text-ink">Total dû:</span>
          <strong className="text-danger">{debt.total} DA</strong>
        </div>
        {/* Le solde ne vaut pas la somme de son historique : le montant réclamé
            ci-dessus est calculé sur une valeur douteuse. */}
        {debt.drift !== 0 && (
          <div className="mt-1 rounded-lg border border-warning/40 bg-warning/10 p-2 text-[10px] leading-relaxed text-warning">
            <strong className="block">
              Solde à vérifier : {Math.abs(debt.drift)} DA d&apos;écart avec l&apos;historique.
            </strong>
            Le « Total dû » ci-dessus est calculé sur le solde stocké, qui ne correspond pas à la somme de ses
            transactions. Faites corriger la base (<code className="font-mono">reconcile_student_balances</code>) avant
            d&apos;encaisser.
          </div>
        )}
        {/* L'ordre d'imputation est décidé côté serveur : l'annoncer ici, chiffré
            sur le montant tapé. */}
        {payAmount > 0 &&
          (() => {
            const split = allocateDebtPayment(payAmount, debt);
            return (
              <div className="mt-1 space-y-0.5 rounded-lg border border-primary/30 bg-primary/5 p-2 text-[10px]">
                <strong className="block text-primary">Ce versement ira :</strong>
                {split.registration > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted">Frais d&apos;inscription :</span>
                    <strong className="text-ink">{split.registration} DA</strong>
                  </div>
                )}
                {split.sessions > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted">Séances suivies non payées :</span>
                    <strong className="text-ink">{split.sessions} DA</strong>
                  </div>
                )}
                {split.credited > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted">Porté au solde :</span>
                    <strong className="text-success">{split.credited} DA</strong>
                  </div>
                )}
              </div>
            );
          })()}
        <p className="pt-1 text-[10px] leading-relaxed text-muted">
          Recharger le solde règle la dette de la même façon, par simple addition.
        </p>
      </div>

      <div>
        <label className="mb-1 block font-sans text-xs font-semibold text-muted">Montant remboursé (DA) *</label>
        <Input
          type="number"
          value={payAmount || ""}
          onChange={(e) => setPayAmount(Number(e.target.value))}
          placeholder="Ex: 1000"
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Annuler
        </Button>
        <Button onClick={submit} disabled={busy || payAmount <= 0}>
          {busy ? "Enregistrement…" : "Enregistrer le paiement"}
        </Button>
      </div>
    </div>
  );
}
