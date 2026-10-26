"use client";

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AlertTriangle, Trash2 } from "lucide-react";
import { useData } from "@/lib/store/data";
import { useToast } from "@/lib/store/toast";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/SearchInput";
import { confirmsStudentDeletion, DELETE_STUDENT_WORD } from "@/lib/accountDeletion";

/**
 * LA SUPPRESSION D'UN ÉLÈVE, confirmée pour de bon.
 *
 * Elle passait par `confirm()`, la boîte native du navigateur. Or le lecteur
 * de cartes du guichet est un clavier : il tape le code puis « Entrée ». Une
 * boîte native ouverte par un clic égaré — « Supprimer l'élève » est juste
 * sous « Paiements (période) » — était validée par le badge suivant, et
 * l'élève partait avec tout son historique. Plus de trente fiches ont disparu
 * ainsi en trois semaines.
 *
 * Ici rien ne part sans que le mot SUPPRIMER soit tapé, et la fenêtre dit ce
 * qui part avec l'élève.
 */
export function DeleteStudentDialog({
  studentId,
  onClose,
  onDeleted,
}: {
  studentId: string | null;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  return (
    <Modal open={!!studentId} onClose={onClose} title="Supprimer l'élève">
      {studentId && (
        <DeleteStudentBody key={studentId} studentId={studentId} onClose={onClose} onDeleted={onDeleted} />
      )}
    </Modal>
  );
}

function DeleteStudentBody({
  studentId,
  onClose,
  onDeleted,
}: {
  studentId: string;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const { student, presences, transactions, absences, enrollments, deleteStudent } = useData(
    useShallow((s) => {
      const stu = s.students.find((x) => x.id === studentId);
      return {
        student: stu,
        presences: s.attendance.filter((a) => a.studentId === studentId).length,
        transactions: s.balanceTx.filter((t) => t.studentId === studentId).length,
        absences: s.absencePenalties.filter((p) => p.studentId === studentId).length,
        enrollments: stu?.subscriptionIds.length ?? 0,
        deleteStudent: s.deleteStudent,
      };
    }),
  );
  const addToast = useToast((s) => s.addToast);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  if (!student) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted">Cet élève n&apos;existe plus.</p>
        <Button onClick={onClose}>Fermer</Button>
      </div>
    );
  }

  const name = `${student.firstName} ${student.lastName}`;
  const confirmed = confirmsStudentDeletion(typed);

  const submit = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    const res = await deleteStudent(student.id);
    setBusy(false);
    if (!res.ok) {
      addToast({
        type: "danger",
        title: "Suppression refusée",
        message: `${name} n'a PAS été supprimé : ${res.error ?? "erreur inconnue"}.`,
      });
      return;
    }
    addToast({ type: "success", title: "Élève supprimé", message: `${name} a été supprimé.` });
    onDeleted?.();
    onClose();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <strong className="block">Suppression DÉFINITIVE — aucune annulation possible.</strong>
          <span className="block">
            La fiche de l&apos;élève part avec tout son historique : présences, transactions, absences facturées et
            inscriptions. Pour qu&apos;il ne vienne plus, il suffit de le désinscrire de ses emplois du temps : son
            historique est alors conservé.
          </span>
        </div>
      </div>

      <div className="space-y-1 rounded-xl border border-line bg-canvas p-3 text-xs">
        <strong className="block text-sm text-ink">{name}</strong>
        <span className="block text-muted">
          Carte {student.rfid || "—"} · Téléphone {student.phone || "—"}
        </span>
        <span className="block text-muted">
          {enrollments} inscription(s) · {presences} présence(s) · {absences} absence(s) facturée(s) ·{" "}
          {transactions} transaction(s)
        </span>
        <strong className={student.balance < 0 ? "text-danger" : "text-success"}>
          Solde : {student.balance} DA
          {student.balance > 0 && " — ce crédit sera perdu"}
          {student.balance < 0 && " — cette dette sera effacée"}
        </strong>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="delete-student-confirm" className="block text-xs font-semibold text-muted">
          Pour confirmer, tapez <strong className="text-danger">{DELETE_STUDENT_WORD}</strong> :
        </label>
        <Input
          id="delete-student-confirm"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={DELETE_STUDENT_WORD}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Annuler
        </Button>
        <Button type="button" variant="danger" onClick={submit} disabled={!confirmed || busy}>
          <Trash2 className="me-1 h-4 w-4" /> {busy ? "Suppression…" : "Supprimer définitivement"}
        </Button>
      </div>
    </div>
  );
}
