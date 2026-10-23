"use client";

import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AlertTriangle } from "lucide-react";
import { useData } from "@/lib/store/data";
import { useToast } from "@/lib/store/toast";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { formatDays, isoFromSchoolInput, schoolDateTimeInput, schoolDateTimeLabel } from "@/lib/helpers";
import { frDay, isAbsenceTx, pairAbsenceLines } from "@/lib/studentRepair";
import type {
  AbsencePenalty,
  AttendanceRecord,
  AttendanceStatus,
  BalanceTransaction,
  BalanceTxType,
  Student,
} from "@/lib/types";

/**
 * Les fenêtres qui corrigent UNE ligne d'argent d'un élève : une transaction
 * du solde, une présence, une absence facturée. La fiche étudiant et la
 * fenêtre « Régulariser » ouvrent les mêmes — une correction ne peut pas
 * faire une chose sur un écran et une autre ailleurs.
 *
 * Chaque écriture passe par une RPC qui déplace le solde ET écrit son
 * historique dans la même transaction. Les dates se lisent et se saisissent
 * à l'heure de l'école.
 */

/** Libellés des types de ligne du solde. */
export const TX_TYPE_LABELS: Record<BalanceTxType, string> = {
  topup: "Versement / Recharge",
  deduction: "Débit (séance, absence…)",
  debt_payment: "Règlement de dette",
  registration: "Frais d'inscription",
};

function useLookups() {
  const { sessions, modules, groups } = useData(
    useShallow((s) => ({ sessions: s.sessions, modules: s.modules, groups: s.groups })),
  );
  return useMemo(
    () => ({
      session: new Map(sessions.map((s) => [s.id, s])),
      module: new Map(modules.map((m) => [m.id, m.name])),
      group: new Map(groups.map((g) => [g.id, g.name])),
    }),
    [sessions, modules, groups],
  );
}

function BalancePreview({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-primary/25 bg-primary-50/40 p-3 text-xs">
      <span className="font-semibold text-muted">{label}</span>
      <strong className={value < 0 ? "text-danger" : "text-success"}>{value} DA</strong>
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/5 p-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
      <p className="text-xs leading-relaxed text-ink">{children}</p>
    </div>
  );
}

function Actions({
  busy,
  onCancel,
  onConfirm,
  confirmLabel,
  busyLabel,
  danger,
  disabled,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  busyLabel: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button variant="outline" onClick={onCancel} disabled={busy}>
        Annuler
      </Button>
      <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy || disabled}>
        {busy ? busyLabel : confirmLabel}
      </Button>
    </div>
  );
}

// =============================================================================
// Transaction du solde
// =============================================================================

export function EditTxDialog({
  tx,
  student,
  onClose,
}: {
  tx: BalanceTransaction | null;
  student: Student;
  onClose: () => void;
}) {
  return (
    <Modal open={!!tx} onClose={onClose} title="Modifier la transaction">
      {tx && <EditTxBody key={tx.id} tx={tx} student={student} onClose={onClose} />}
    </Modal>
  );
}

function EditTxBody({ tx, student, onClose }: { tx: BalanceTransaction; student: Student; onClose: () => void }) {
  const updateBalanceTx = useData((s) => s.updateBalanceTx);
  const addToast = useToast((s) => s.addToast);
  const [amount, setAmount] = useState(tx.amount);
  const [description, setDescription] = useState(tx.description);
  const [date, setDate] = useState(schoolDateTimeInput(tx.date));
  const [type, setType] = useState<BalanceTxType>(tx.type);
  const [adjustCash, setAdjustCash] = useState(true);
  const [busy, setBusy] = useState(false);

  const value = Math.round(amount || 0);
  const delta = value - tx.amount;

  const submit = async () => {
    if (!date) return;
    setBusy(true);
    const res = await updateBalanceTx(tx.id, {
      amount: value,
      description,
      date: isoFromSchoolInput(date),
      type,
      adjustCash,
    });
    setBusy(false);
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
    onClose();
  };

  return (
    <div className="space-y-4">
      <div className="space-y-0.5 rounded-xl border border-line bg-canvas p-3 text-xs">
        <strong className="block text-ink">
          {student.firstName} {student.lastName}
        </strong>
        <span className="block text-muted">
          Ligne d&apos;origine : {tx.amount > 0 ? `+${tx.amount}` : tx.amount} DA · {schoolDateTimeLabel(tx.date)}
        </span>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-muted">Type</label>
        <Select value={type} onChange={(e) => setType(e.target.value as BalanceTxType)} className="w-full">
          {(Object.keys(TX_TYPE_LABELS) as BalanceTxType[]).map((t) => (
            <option key={t} value={t}>
              {TX_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-muted">Montant (DA)</label>
        <Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        <p className="mt-1 text-[10px] text-muted">
          Montant signé : <strong>positif</strong> pour un versement/crédit, <strong>négatif</strong> pour un débit.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-muted">Description</label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-muted">Date (heure de l&apos;école)</label>
        <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {tx.type === "topup" && (
        <label className="flex cursor-pointer items-center justify-between rounded-xl border border-line bg-canvas p-3">
          <span className="text-xs font-bold text-ink">
            Corriger aussi la caisse
            <span className="block text-[10px] font-normal text-muted">
              Écrit une écriture de correction de {delta > 0 ? `+${delta}` : delta} DA dans la caisse (le versement
              d&apos;origine y avait été enregistré).
            </span>
          </span>
          <input
            type="checkbox"
            checked={adjustCash}
            onChange={(e) => setAdjustCash(e.target.checked)}
            className="h-5 w-5 shrink-0"
          />
        </label>
      )}

      {isAbsenceTx(tx) && (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-[10px] text-warning">
          Ligne d&apos;une absence hebdomadaire : l&apos;absence prendra le nouveau montant.
        </p>
      )}

      <BalancePreview label="Solde après correction" value={student.balance + delta} />
      <Actions
        busy={busy}
        onCancel={onClose}
        onConfirm={submit}
        confirmLabel="Enregistrer"
        busyLabel="Enregistrement…"
        disabled={!date}
      />
    </div>
  );
}

export function DeleteTxDialog({
  tx,
  student,
  onClose,
}: {
  tx: BalanceTransaction | null;
  student: Student;
  onClose: () => void;
}) {
  return (
    <Modal open={!!tx} onClose={onClose} title="Supprimer la transaction">
      {tx && <DeleteTxBody key={tx.id} tx={tx} student={student} onClose={onClose} />}
    </Modal>
  );
}

function DeleteTxBody({ tx, student, onClose }: { tx: BalanceTransaction; student: Student; onClose: () => void }) {
  const deleteBalanceTx = useData((s) => s.deleteBalanceTx);
  const addToast = useToast((s) => s.addToast);
  const [adjustCash, setAdjustCash] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await deleteBalanceTx(tx.id, adjustCash);
    setBusy(false);
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
    onClose();
  };

  return (
    <div className="space-y-4">
      <Warning>
        Cette transaction sera définitivement supprimée et son effet sur le solde annulé.
        {isAbsenceTx(tx) ? (
          <span className="mt-1 block text-muted">
            C&apos;est la ligne d&apos;une absence hebdomadaire : l&apos;absence est retirée avec elle (remboursée une
            seule fois).
          </span>
        ) : (
          tx.type === "deduction" && (
            <span className="mt-1 block text-muted">
              La présence liée (onglet « Présences ») n&apos;est pas supprimée pour autant.
            </span>
          )
        )}
      </Warning>

      <div className="space-y-0.5 rounded-xl border border-line bg-canvas p-3 text-xs">
        <strong className="block text-ink">{tx.description}</strong>
        <span className="block text-muted">
          {student.firstName} {student.lastName} · {schoolDateTimeLabel(tx.date)} · {TX_TYPE_LABELS[tx.type]}
        </span>
        <strong className={tx.amount > 0 ? "text-success" : "text-danger"}>
          {tx.amount > 0 ? `+${tx.amount}` : tx.amount} DA
        </strong>
      </div>

      {tx.type === "topup" && (
        <label className="flex cursor-pointer items-center justify-between rounded-xl border border-line bg-canvas p-3">
          <span className="text-xs font-bold text-ink">
            Corriger aussi la caisse
            <span className="block text-[10px] font-normal text-muted">
              Écrit une écriture d&apos;annulation de {-tx.amount} DA dans la caisse.
            </span>
          </span>
          <input
            type="checkbox"
            checked={adjustCash}
            onChange={(e) => setAdjustCash(e.target.checked)}
            className="h-5 w-5 shrink-0"
          />
        </label>
      )}

      <BalancePreview label="Solde après suppression" value={student.balance - tx.amount} />
      <Actions
        busy={busy}
        onCancel={onClose}
        onConfirm={submit}
        confirmLabel="Supprimer"
        busyLabel="Suppression…"
        danger
      />
    </div>
  );
}

// =============================================================================
// Présence
// =============================================================================

export function EditAttendanceDialog({
  att,
  student,
  onClose,
}: {
  att: AttendanceRecord | null;
  student: Student;
  onClose: () => void;
}) {
  return (
    <Modal open={!!att} onClose={onClose} title="Modifier la présence">
      {att && <EditAttendanceBody key={att.id} att={att} student={student} onClose={onClose} />}
    </Modal>
  );
}

function EditAttendanceBody({
  att,
  student,
  onClose,
}: {
  att: AttendanceRecord;
  student: Student;
  onClose: () => void;
}) {
  const updateAttendance = useData((s) => s.updateAttendance);
  const addToast = useToast((s) => s.addToast);
  const lookups = useLookups();
  const [status, setStatus] = useState<AttendanceStatus>(att.status);
  const [date, setDate] = useState(schoolDateTimeInput(att.timestamp));
  const [amount, setAmount] = useState(att.amountDeducted);
  const [busy, setBusy] = useState(false);

  const s = lookups.session.get(att.sessionId);
  const modName = s ? lookups.module.get(s.moduleId) ?? "Module" : "Module";
  const grpName = s ? lookups.group.get(s.groupId) ?? "-" : "-";
  const value = Math.max(0, Math.round(amount || 0));
  const delta = value - att.amountDeducted;

  const submit = async () => {
    if (!date) return;
    setBusy(true);
    const res = await updateAttendance(att.id, { status, occurredAt: isoFromSchoolInput(date), amount: value });
    setBusy(false);
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
    onClose();
  };

  return (
    <div className="space-y-4">
      <div className="space-y-0.5 rounded-xl border border-line bg-canvas p-3 text-xs">
        <strong className="block text-ink">
          {modName} — {grpName}
          {att.substituteGroup && (
            <Badge tone="primary" className="ms-1.5 px-1.5 py-0 text-[9px]">
              Autre groupe
            </Badge>
          )}
        </strong>
        <span className="block text-muted">
          {student.firstName} {student.lastName}
          {s ? ` · ${formatDays(s.days)} · ${s.startTime}-${s.endTime}` : ""}
        </span>
        <span className="block text-muted">Débit d&apos;origine : {att.amountDeducted} DA</span>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-muted">Statut</label>
        <Select value={status} onChange={(e) => setStatus(e.target.value as AttendanceStatus)} className="w-full">
          <option value="present">Présent</option>
          <option value="late">En retard</option>
          <option value="absent">Absent</option>
        </Select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-muted">Date et heure (heure de l&apos;école)</label>
        <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-muted">Montant débité (DA)</label>
        <Input type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        <p className="mt-1 text-[10px] text-muted">
          La différence est reportée sur le solde de l&apos;élève et tracée dans ses transactions. Mettez{" "}
          <strong>0</strong> pour une séance offerte.
        </p>
      </div>

      <BalancePreview label="Solde après correction" value={student.balance - delta} />
      <Actions
        busy={busy}
        onCancel={onClose}
        onConfirm={submit}
        confirmLabel="Enregistrer"
        busyLabel="Enregistrement…"
        disabled={!date}
      />
    </div>
  );
}

export function DeleteAttendanceDialog({
  att,
  student,
  onClose,
}: {
  att: AttendanceRecord | null;
  student: Student;
  onClose: () => void;
}) {
  return (
    <Modal open={!!att} onClose={onClose} title="Supprimer la présence">
      {att && <DeleteAttendanceBody key={att.id} att={att} student={student} onClose={onClose} />}
    </Modal>
  );
}

function DeleteAttendanceBody({
  att,
  student,
  onClose,
}: {
  att: AttendanceRecord;
  student: Student;
  onClose: () => void;
}) {
  const cancelAttendance = useData((s) => s.cancelAttendance);
  const addToast = useToast((s) => s.addToast);
  const lookups = useLookups();
  const [busy, setBusy] = useState(false);

  const s = lookups.session.get(att.sessionId);
  const modName = s ? lookups.module.get(s.moduleId) ?? "Module" : "Module";
  const grpName = s ? lookups.group.get(s.groupId) ?? "-" : "-";

  const submit = async () => {
    setBusy(true);
    const res = await cancelAttendance(att.id);
    setBusy(false);
    if (!res.ok) {
      addToast({ type: "danger", title: "Suppression impossible", message: "La présence n'a pas pu être supprimée." });
      return;
    }
    addToast({
      type: "success",
      title: "Présence supprimée",
      message: `${res.refunded ? `${res.refunded} DA remboursés — ` : ""}nouveau solde: ${res.newBalance ?? student.balance} DA.`,
    });
    onClose();
  };

  return (
    <div className="space-y-4">
      <Warning>
        La présence sera supprimée, les {att.amountDeducted} DA débités seront remboursés et la part due à
        l&apos;enseignant pour cette séance sera annulée.
      </Warning>
      <div className="space-y-0.5 rounded-xl border border-line bg-canvas p-3 text-xs">
        <strong className="block text-ink">
          {modName} — {grpName}
        </strong>
        <span className="block text-muted">
          {student.firstName} {student.lastName} · {schoolDateTimeLabel(att.timestamp)}
        </span>
      </div>
      <BalancePreview label="Solde après suppression" value={student.balance + att.amountDeducted} />
      <Actions
        busy={busy}
        onCancel={onClose}
        onConfirm={submit}
        confirmLabel="Supprimer"
        busyLabel="Suppression…"
        danger
      />
    </div>
  );
}

// =============================================================================
// Absence facturée
// =============================================================================

export function DeletePenaltyDialog({
  pen,
  student,
  onClose,
}: {
  pen: AbsencePenalty | null;
  student: Student;
  onClose: () => void;
}) {
  return (
    <Modal open={!!pen} onClose={onClose} title="Supprimer l'absence facturée">
      {pen && <DeletePenaltyBody key={pen.id} pen={pen} student={student} onClose={onClose} />}
    </Modal>
  );
}

function DeletePenaltyBody({ pen, student, onClose }: { pen: AbsencePenalty; student: Student; onClose: () => void }) {
  const { deleteAbsencePenalty, absencePenalties, balanceTx } = useData(
    useShallow((s) => ({
      deleteAbsencePenalty: s.deleteAbsencePenalty,
      absencePenalties: s.absencePenalties,
      balanceTx: s.balanceTx,
    })),
  );
  const addToast = useToast((s) => s.addToast);
  const lookups = useLookups();
  const [busy, setBusy] = useState(false);

  const modName = (pen.moduleId && lookups.module.get(pen.moduleId)) || "Module";
  // Ce que la suppression remboursera : la ligne de l'absence, si elle existe
  // encore. Sans elle, l'absence a déjà été remboursée.
  const line = useMemo(() => {
    const mine = absencePenalties.filter((p) => p.studentId === pen.studentId);
    const lines = balanceTx.filter((t) => t.studentId === pen.studentId && isAbsenceTx(t));
    const groupOf = (p: AbsencePenalty) => {
      const se = p.sessionId ? lookups.session.get(p.sessionId) : undefined;
      return se ? lookups.group.get(se.groupId) : undefined;
    };
    const id = pairAbsenceLines(mine, lines, groupOf).get(pen.id);
    return id ? lines.find((t) => t.id === id) : undefined;
  }, [absencePenalties, balanceTx, pen, lookups]);
  const refund = line ? -line.amount : 0;

  const submit = async () => {
    setBusy(true);
    const res = await deleteAbsencePenalty(pen.id);
    setBusy(false);
    if (!res.ok) {
      addToast({ type: "danger", title: "Suppression impossible", message: "L'absence n'a pas pu être supprimée." });
      return;
    }
    addToast({
      type: "success",
      title: "Absence supprimée",
      message: res.refunded
        ? `${res.refunded} DA remboursés — nouveau solde: ${res.newBalance ?? student.balance} DA.`
        : "Absence retirée — sa ligne au solde avait déjà été remboursée, rien n'a été remboursé une 2e fois.",
    });
    onClose();
  };

  return (
    <div className="space-y-4">
      <Warning>
        {line ? (
          <>
            L&apos;absence hebdomadaire sera supprimée, les {refund} DA facturés seront remboursés et la ligne
            correspondante disparaîtra de l&apos;historique du solde.
          </>
        ) : (
          <>
            Cette absence n&apos;a plus de ligne dans l&apos;historique du solde : elle a déjà été remboursée. Elle
            sera retirée <strong>sans nouveau remboursement</strong>.
          </>
        )}
      </Warning>
      <div className="space-y-0.5 rounded-xl border border-line bg-canvas p-3 text-xs">
        <strong className="block text-ink">{modName}</strong>
        <span className="block text-muted">
          {student.firstName} {student.lastName} · Semaine du {frDay(pen.periodStart)} au {frDay(pen.periodEnd)}
        </span>
      </div>
      <BalancePreview label="Solde après suppression" value={student.balance + refund} />
      <Actions
        busy={busy}
        onCancel={onClose}
        onConfirm={submit}
        confirmLabel="Supprimer"
        busyLabel="Suppression…"
        danger
      />
    </div>
  );
}
