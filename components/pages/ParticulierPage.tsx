"use client";

import { useEffect, useMemo, useState } from "react";
import { useData, uid } from "@/lib/store/data";
import { createClient } from "@/lib/supabase/client";
import { createRoleUser } from "@/lib/supabase/createUser";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckCircle,
  DollarSign,
  Edit,
  Eye,
  GraduationCap,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
  XCircle,
} from "lucide-react";
import type {
  PrivateSession,
  PrivateSessionStatus,
  Student,
  Teacher,
} from "@/lib/types";
import {
  COURS_LEVEL_LABELS,
  YEAR_ORDER,
  formatDateFr,
  normalizeSearchText,
} from "@/lib/helpers";
import { useToast } from "@/lib/store/toast";

/** Domaine des identifiants du portail — identique à l'écran Étudiants. */
const PORTAL_EMAIL_DOMAIN = "benzaoui.com";

const STATUS_LABELS: Record<PrivateSessionStatus, string> = {
  planned: "Programmée",
  done: "Terminée",
  cancelled: "Annulée",
};

const STATUS_TONES: Record<PrivateSessionStatus, "primary" | "success" | "neutral"> = {
  planned: "primary",
  done: "success",
  cancelled: "neutral",
};

/** Une ligne de module en cours de saisie. */
interface ModuleDraft {
  /** clé locale du formulaire (pas l'identifiant en base) */
  uiKey: string;
  moduleId: string;
  teacherId: string;
  hours: number;
  minutes: number;
  hourlyPrice: number;
  teacherPercentage: number;
  teacherPaid: boolean;
}

const emptyModuleDraft = (): ModuleDraft => ({
  uiKey: uid("draft"),
  moduleId: "",
  teacherId: "",
  hours: 1,
  minutes: 0,
  hourlyPrice: 0,
  teacherPercentage: 50,
  teacherPaid: false,
});

/** minutes × tarif horaire, arrondi — miroir exact du calcul SQL. */
const priceOf = (d: ModuleDraft) =>
  Math.round(((d.hours * 60 + d.minutes) * Math.max(0, d.hourlyPrice)) / 60);

/** "2026-09-12T14:30" → ISO, ou null si la saisie est incomplète. */
function toIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-DZ", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

export function ParticulierPage() {
  const {
    privateSessions,
    privateSessionModules,
    students,
    teachers,
    modules,
    classes,
    filieres,
    push,
    createPrivateSession,
    updatePrivateSession,
    payPrivateSession,
    payPrivateSessionTeacher,
    setPrivateSessionStatus,
    reschedulePrivateSession,
    deletePrivateSession,
  } = useData();
  const { addToast } = useToast();

  // ---- Écran principal -------------------------------------------------------
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PrivateSessionStatus>("all");
  const [moneyFilter, setMoneyFilter] = useState<"all" | "debt" | "teacherDue">("all");

  // ---- Modales ---------------------------------------------------------------
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [payId, setPayId] = useState<string | null>(null);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [isStudentFormOpen, setIsStudentFormOpen] = useState(false);
  const [isTeacherFormOpen, setIsTeacherFormOpen] = useState(false);
  /** la ligne de module dont on est en train de créer l'enseignant */
  const [teacherForDraft, setTeacherForDraft] = useState<string | null>(null);

  // ---- Formulaire : l'élève --------------------------------------------------
  const [studentMode, setStudentMode] = useState<"existing" | "guest">("existing");
  const [studentId, setStudentId] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestPhone2, setGuestPhone2] = useState("");
  const [classId, setClassId] = useState("");
  const [year, setYear] = useState("");
  const [filiereId, setFiliereId] = useState("");

  // ---- Formulaire : le rendez-vous ------------------------------------------
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [time, setTime] = useState("15:00");
  const [notes, setNotes] = useState("");
  const [drafts, setDrafts] = useState<ModuleDraft[]>([emptyModuleDraft()]);

  // ---- Formulaire : l'argent -------------------------------------------------
  const [studentPaid, setStudentPaid] = useState(false);
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [paidTouched, setPaidTouched] = useState(false);

  const [saving, setSaving] = useState(false);

  // ---- Création rapide d'un module ------------------------------------------
  const [newModuleName, setNewModuleName] = useState("");
  const [moduleForDraft, setModuleForDraft] = useState<string | null>(null);

  // ---- Création rapide d'un élève -------------------------------------------
  const [nsFirstName, setNsFirstName] = useState("");
  const [nsLastName, setNsLastName] = useState("");
  const [nsBirthDate, setNsBirthDate] = useState("");
  const [nsPhone, setNsPhone] = useState("");
  const [nsRfid, setNsRfid] = useState("");
  const [nsEmail, setNsEmail] = useState("");
  const [nsPassword, setNsPassword] = useState("");
  const [nsIsFree, setNsIsFree] = useState(false);
  const [savingStudent, setSavingStudent] = useState(false);

  // ---- Création rapide d'un enseignant --------------------------------------
  const [ntKind, setNtKind] = useState<"passager" | "staff">("passager");
  const [ntFirstName, setNtFirstName] = useState("");
  const [ntLastName, setNtLastName] = useState("");
  const [ntPhone, setNtPhone] = useState("");
  const [ntDescription, setNtDescription] = useState("");
  const [ntEmail, setNtEmail] = useState("");
  const [ntPassword, setNtPassword] = useState("");
  const [ntPercentage, setNtPercentage] = useState(50);
  const [savingTeacher, setSavingTeacher] = useState(false);

  // ---- Encaissement de la dette ---------------------------------------------
  const [payAmount, setPayAmount] = useState<number>(0);

  // ---- Report ----------------------------------------------------------------
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");

  /**
   * L'heure courante, tenue dans un état plutôt que lue pendant le rendu.
   *
   * Un rendu doit donner le même résultat à chaque fois qu'on le rejoue :
   * appeler `Date.now()` en plein rendu le rend imprévisible. La ranger ici a
   * surtout un bénéfice concret — une séance qui bascule « en retard » le
   * devient à l'écran toute seule, sans que personne ait à recharger la page.
   */
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // ===========================================================================
  // Lectures
  // ===========================================================================
  const modulesOf = (sessionId: string) =>
    privateSessionModules.filter((m) => m.privateSessionId === sessionId);

  const nameOf = (s: PrivateSession) => {
    if (s.studentId) {
      const stu = students.find((x) => x.id === s.studentId);
      if (stu) return `${stu.firstName} ${stu.lastName}`;
    }
    return s.guestName || "Élève";
  };

  const phoneOf = (s: PrivateSession) => {
    if (s.studentId) {
      const stu = students.find((x) => x.id === s.studentId);
      if (stu?.phone) return stu.phone;
    }
    return s.guestPhone || "";
  };

  const teacherName = (id?: string) => {
    const t = teachers.find((x) => x.id === id);
    return t ? `${t.firstName} ${t.lastName}`.trim() : "Enseignant à désigner";
  };

  const moduleName = (id: string) => modules.find((m) => m.id === id)?.name ?? "Module";

  const dueOf = (s: PrivateSession) => Math.max(0, s.totalPrice - s.paidAmount);

  /** Ce qui reste dû aux enseignants d'une séance TENUE ou programmée. */
  const teacherDueOf = (s: PrivateSession) =>
    modulesOf(s.id)
      .filter((m) => !m.teacherPaid && m.teacherId)
      .reduce((sum, m) => sum + m.teacherAmount, 0);

  /**
   * Où en est le rendez-vous dans le temps.
   *
   * « Bientôt » = dans moins de 24 h : c'est la fenêtre où il faut encore
   * prévenir l'élève et l'enseignant. « En retard » = l'heure est passée et la
   * séance n'a jamais été marquée tenue ni annulée — c'est le cas qui se
   * perdait jusqu'ici, et avec lui l'argent de la séance.
   */
  const timingOf = (s: PrivateSession): "soon" | "late" | "future" | "closed" => {
    if (s.status !== "planned") return "closed";
    const t = new Date(s.scheduledAt).getTime();
    if (t < nowMs) return "late";
    if (t - nowMs <= 24 * 3600 * 1000) return "soon";
    return "future";
  };

  const sorted = useMemo(
    () => [...privateSessions].sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)),
    [privateSessions],
  );

  const visible = useMemo(() => {
    const q = normalizeSearchText(search.trim());
    return sorted.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (moneyFilter === "debt" && dueOf(s) <= 0) return false;
      if (moneyFilter === "teacherDue" && teacherDueOf(s) <= 0) return false;
      if (!q) return true;
      // On cherche par élève OU par enseignant : ce sont les deux entrées
      // naturelles sur un cours particulier.
      const haystack = [
        nameOf(s),
        s.guestPhone ?? "",
        s.guestPhone2 ?? "",
        ...modulesOf(s.id).map((m) => `${moduleName(m.moduleId)} ${teacherName(m.teacherId)}`),
      ].join(" ");
      return normalizeSearchText(haystack).includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, search, statusFilter, moneyFilter, privateSessionModules, students, teachers, modules]);

  const lateSessions = sorted.filter((s) => timingOf(s) === "late");
  const soonSessions = sorted.filter((s) => timingOf(s) === "soon");
  const unpaidTeachers = sorted.filter(
    (s) => s.status !== "cancelled" && teacherDueOf(s) > 0,
  );
  const debtSessions = sorted.filter((s) => s.status !== "cancelled" && dueOf(s) > 0);

  // ===========================================================================
  // Formulaire
  // ===========================================================================
  const draftTotal = drafts.reduce((sum, d) => sum + priceOf(d), 0);
  const draftMinutes = drafts.reduce((sum, d) => sum + d.hours * 60 + d.minutes, 0);

  const resetForm = () => {
    setEditingId(null);
    setStudentMode("existing");
    setStudentId("");
    setStudentSearch("");
    setGuestName("");
    setGuestPhone("");
    setGuestPhone2("");
    setClassId("");
    setYear("");
    setFiliereId("");
    setDate(new Date().toISOString().split("T")[0]);
    setTime("15:00");
    setNotes("");
    setDrafts([emptyModuleDraft()]);
    setStudentPaid(false);
    setPaidAmount(0);
    setPaidTouched(false);
  };

  const openCreate = () => {
    resetForm();
    setIsFormOpen(true);
  };

  const openEdit = (s: PrivateSession) => {
    setEditingId(s.id);
    setStudentMode(s.studentId ? "existing" : "guest");
    setStudentId(s.studentId ?? "");
    setStudentSearch("");
    setGuestName(s.guestName ?? "");
    setGuestPhone(s.guestPhone ?? "");
    setGuestPhone2(s.guestPhone2 ?? "");
    setClassId(s.classId ?? "");
    setYear(s.year ?? "");
    setFiliereId(s.filiereId ?? "");
    const d = new Date(s.scheduledAt);
    setDate(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
    setTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    setNotes(s.notes ?? "");
    setDrafts(
      modulesOf(s.id).map((m) => ({
        uiKey: m.id,
        moduleId: m.moduleId,
        teacherId: m.teacherId ?? "",
        hours: Math.floor(m.minutes / 60),
        minutes: m.minutes % 60,
        hourlyPrice: m.hourlyPrice,
        teacherPercentage: m.teacherPercentage,
        teacherPaid: m.teacherPaid,
      })),
    );
    setStudentPaid(s.paidAmount > 0);
    setPaidAmount(s.paidAmount);
    setPaidTouched(true);
    setDetailsId(null);
    setIsFormOpen(true);
  };

  const updateDraft = (uiKey: string, patch: Partial<ModuleDraft>) =>
    setDrafts((prev) => prev.map((d) => (d.uiKey === uiKey ? { ...d, ...patch } : d)));

  const handleSave = async () => {
    // ---- Contrôles ----
    if (studentMode === "existing" && !studentId) {
      alert("Sélectionnez l'élève, ou passez en « élève de passage ».");
      return;
    }
    if (studentMode === "guest" && !guestName.trim()) {
      alert("Le nom complet de l'élève est obligatoire.");
      return;
    }
    if (studentMode === "guest" && !guestPhone.trim()) {
      alert("Le numéro de téléphone est obligatoire pour un élève de passage.");
      return;
    }
    const scheduledAt = toIso(date, time);
    if (!scheduledAt) {
      alert("Indiquez la date et l'heure de la séance.");
      return;
    }
    if (drafts.length === 0) {
      alert("Ajoutez au moins un module à cette séance.");
      return;
    }
    for (const d of drafts) {
      if (!d.moduleId) {
        alert("Chaque ligne doit porter un module.");
        return;
      }
      if (d.hours * 60 + d.minutes <= 0) {
        alert(`Indiquez la durée du module « ${moduleName(d.moduleId)} ».`);
        return;
      }
      if (d.hourlyPrice <= 0) {
        alert(`Indiquez le prix d'une heure pour « ${moduleName(d.moduleId)} ».`);
        return;
      }
    }
    // Un enseignant réglé d'avance alors que l'élève n'a rien payé fait sortir
    // de l'argent que l'école n'a pas encaissé : on prévient, sans interdire.
    const prepaidTeachers = drafts.filter((d) => d.teacherPaid);
    if (!studentPaid && prepaidTeachers.length > 0) {
      if (
        !confirm(
          "L'élève n'a rien versé, mais vous réglez déjà " +
            `${prepaidTeachers.length} enseignant(s). La caisse sortira cet argent sans l'avoir encaissé. Continuer ?`,
        )
      ) {
        return;
      }
    }

    const payload = {
      studentId: studentMode === "existing" ? studentId : undefined,
      guestName: studentMode === "guest" ? guestName.trim() : undefined,
      guestPhone: studentMode === "guest" ? guestPhone.trim() : undefined,
      guestPhone2: studentMode === "guest" ? guestPhone2.trim() || undefined : undefined,
      classId: classId || undefined,
      year: year || undefined,
      filiereId: filiereId || undefined,
      scheduledAt,
      notes: notes.trim(),
      paidAmount: studentPaid ? Math.min(paidAmount, draftTotal) : 0,
      modules: drafts.map((d) => ({
        moduleId: d.moduleId,
        teacherId: d.teacherId || undefined,
        minutes: d.hours * 60 + d.minutes,
        hourlyPrice: d.hourlyPrice,
        teacherPercentage: d.teacherPercentage,
        teacherPaid: d.teacherPaid,
      })),
    };

    setSaving(true);
    try {
      const res = editingId
        ? await updatePrivateSession(editingId, payload)
        : await createPrivateSession(payload);
      if (!res.ok) {
        alert(
          "L'enregistrement a échoué. Si le message parle d'une fonction manquante, passez la " +
            "migration supabase/migrations/20260912_particulier_workers_accounts_and_billing_start.sql.",
        );
        return;
      }
      setIsFormOpen(false);
      addToast({
        type: "success",
        title: editingId ? "Séance particulière modifiée" : "Séance particulière programmée",
        message: `${studentMode === "existing" ? nameOfStudent(studentId) : guestName} — ${drafts.length} module(s), ${draftTotal} DA.`,
      });
      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const nameOfStudent = (id: string) => {
    const stu = students.find((x) => x.id === id);
    return stu ? `${stu.firstName} ${stu.lastName}` : "Élève";
  };

  // ---- Création d'un élève depuis cet écran ---------------------------------
  const handleCreateStudent = async () => {
    if (!nsFirstName || !nsLastName || !nsPhone || !nsRfid) {
      alert("Prénom, nom, téléphone et carte RFID sont obligatoires.");
      return;
    }
    if (nsPassword.length < 6) {
      alert("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }
    const finalEmail =
      nsEmail || `${nsFirstName.toLowerCase()}.${nsRfid.toLowerCase()}@${PORTAL_EMAIL_DOMAIN}`;

    setSavingStudent(true);
    try {
      const { id } = await createRoleUser({
        role: "student",
        email: finalEmail,
        password: nsPassword,
        firstName: nsFirstName,
        lastName: nsLastName,
        phone: nsPhone,
        birthDate: nsBirthDate,
        rfid: nsRfid,
        isFree: nsIsFree,
        registrationDue: 0,
      });
      const newStudent: Student = {
        id,
        firstName: nsFirstName,
        lastName: nsLastName,
        birthDate: nsBirthDate,
        phone: nsPhone,
        email: finalEmail,
        rfid: nsRfid,
        balance: 0,
        isFree: nsIsFree,
        subscriptionIds: [],
        registrationDue: 0,
        createdAt: new Date().toISOString(),
      };
      push("students", newStudent);

      // Sélectionné automatiquement : c'est tout l'intérêt de le créer d'ici.
      setStudentMode("existing");
      setStudentId(id);
      setStudentSearch("");
      setIsStudentFormOpen(false);
      setNsFirstName("");
      setNsLastName("");
      setNsBirthDate("");
      setNsPhone("");
      setNsRfid("");
      setNsEmail("");
      setNsPassword("");
      setNsIsFree(false);
      addToast({
        type: "success",
        title: "Élève créé et sélectionné",
        message: `${newStudent.firstName} ${newStudent.lastName} est enregistré et rattaché à cette séance.`,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur lors de la création de l'élève.");
    } finally {
      setSavingStudent(false);
    }
  };

  // ---- Création d'un enseignant depuis cet écran ----------------------------
  const handleCreateTeacher = async () => {
    if (!ntFirstName.trim()) {
      alert("Le nom de l'enseignant est obligatoire.");
      return;
    }

    setSavingTeacher(true);
    try {
      let newId: string;
      if (ntKind === "staff") {
        if (!ntEmail.trim() || ntPassword.length < 6) {
          alert("Un enseignant de l'école a besoin d'un email et d'un mot de passe (6 caractères min.).");
          return;
        }
        const { id } = await createRoleUser({
          role: "teacher",
          email: ntEmail,
          password: ntPassword,
          firstName: ntFirstName,
          lastName: ntLastName,
          phone: ntPhone,
          paymentType: "percentage",
          percentage: ntPercentage,
        });
        newId = id;
        push("teachers", {
          id,
          firstName: ntFirstName,
          lastName: ntLastName,
          phone: ntPhone,
          email: ntEmail,
          paymentType: "percentage",
          percentage: ntPercentage,
          description: ntDescription,
        } as Teacher);
      } else {
        // Passager : aucune connexion, donc insertion directe (la table est
        // "auth-linked" dans le store, qui passerait sinon par /api/admin/users).
        newId = uid("tch");
        const supabase = createClient();
        const { error } = await supabase.from("teachers").insert({
          id: newId,
          first_name: ntFirstName.trim(),
          last_name: ntLastName.trim(),
          phone: ntPhone,
          email: null,
          payment_type: "percentage",
          percentage: ntPercentage,
          is_passager: true,
          description: ntDescription.trim(),
        });
        if (error) {
          alert(`Impossible d'enregistrer l'enseignant passager : ${error.message}`);
          return;
        }
        push("teachers", {
          id: newId,
          firstName: ntFirstName.trim(),
          lastName: ntLastName.trim(),
          phone: ntPhone,
          email: "",
          paymentType: "percentage",
          percentage: ntPercentage,
          isPassager: true,
          description: ntDescription.trim(),
        } as Teacher);
      }

      // Rattaché directement à la ligne de module d'où on l'a créé.
      if (teacherForDraft) {
        updateDraft(teacherForDraft, { teacherId: newId, teacherPercentage: ntPercentage });
      }
      setIsTeacherFormOpen(false);
      setTeacherForDraft(null);
      setNtFirstName("");
      setNtLastName("");
      setNtPhone("");
      setNtDescription("");
      setNtEmail("");
      setNtPassword("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur lors de la création de l'enseignant.");
    } finally {
      setSavingTeacher(false);
    }
  };

  const handleCreateModule = async () => {
    const name = newModuleName.trim();
    if (!name) return;
    const id = uid("mod");
    const ok = await push("modules", { id, name });
    if (!ok) return;
    if (moduleForDraft) updateDraft(moduleForDraft, { moduleId: id });
    setNewModuleName("");
    setModuleForDraft(null);
  };

  // ---- Actions sur une séance ------------------------------------------------
  const handlePayDebt = async () => {
    if (!payId) return;
    const s = privateSessions.find((x) => x.id === payId);
    if (!s) return;
    if (payAmount <= 0) {
      alert("Saisissez le montant encaissé.");
      return;
    }
    const res = await payPrivateSession(payId, payAmount);
    if (!res.ok) {
      alert(
        res.messageKey === "particulier.nothingDue"
          ? "Cette séance est déjà soldée."
          : "L'encaissement a échoué.",
      );
      return;
    }
    setPayId(null);
    addToast({
      type: "success",
      title: "Règlement encaissé",
      message: `${res.paid} DA encaissés pour ${nameOf(s)}.${(res.due ?? 0) > 0 ? ` Reste dû : ${res.due} DA.` : " Séance soldée."}`,
    });
  };

  const handlePayTeacher = async (moduleRowId: string, label: string, amount: number) => {
    if (!confirm(`Régler ${amount} DA à ${label} pour cette séance particulière ?`)) return;
    const res = await payPrivateSessionTeacher(moduleRowId);
    if (!res.ok) {
      alert(
        res.messageKey === "particulier.noTeacher"
          ? "Aucun enseignant n'est affecté à ce module."
          : res.messageKey === "particulier.teacherAlreadyPaid"
            ? "Cet enseignant a déjà été réglé pour ce module."
            : "Le règlement a échoué.",
      );
      return;
    }
    addToast({
      type: "success",
      title: "Enseignant réglé",
      message: `${res.amount} DA versés à ${label}. Le versement apparaît dans sa fiche et en caisse.`,
    });
  };

  const handleStatus = async (s: PrivateSession, status: PrivateSessionStatus) => {
    if (status === "cancelled" && !confirm(`Annuler la séance de ${nameOf(s)} ?`)) return;
    const res = await setPrivateSessionStatus(s.id, status);
    if (!res.ok) alert("Le changement d'état a échoué.");
  };

  const handleReschedule = async () => {
    if (!rescheduleId) return;
    const iso = toIso(newDate, newTime);
    if (!iso) {
      alert("Indiquez la nouvelle date et la nouvelle heure.");
      return;
    }
    const res = await reschedulePrivateSession(rescheduleId, iso);
    if (!res.ok) {
      alert("Le report a échoué.");
      return;
    }
    setRescheduleId(null);
    addToast({
      type: "success",
      title: "Séance reportée",
      message: `Nouveau rendez-vous : ${fmtDateTime(iso)}.`,
    });
  };

  const handleDelete = async (s: PrivateSession) => {
    const money = s.paidAmount > 0 || modulesOf(s.id).some((m) => m.teacherPaid);
    if (
      !confirm(
        money
          ? `De l'argent est déjà passé sur cette séance (${s.paidAmount} DA encaissés).\n\n` +
              "La supprimer ne retirera PAS les mouvements de caisse : le fond de caisse ne " +
              "s'expliquera plus par les séances. Préférez « Annuler la séance ».\n\nSupprimer quand même ?"
          : `Supprimer définitivement la séance de ${nameOf(s)} ?`,
      )
    ) {
      return;
    }
    const res = await deletePrivateSession(s.id, money);
    if (!res.ok) {
      alert("La suppression a échoué.");
      return;
    }
    setDetailsId(null);
  };

  // ---- Recherche d'élève dans le formulaire ---------------------------------
  const studentMatches = useMemo(() => {
    const q = normalizeSearchText(studentSearch.trim());
    if (!q) return [];
    return students
      .filter((s) =>
        normalizeSearchText(`${s.firstName} ${s.lastName} ${s.phone} ${s.rfid ?? ""}`).includes(q),
      )
      .slice(0, 8);
  }, [students, studentSearch]);

  const selectedStudent = students.find((s) => s.id === studentId);
  const detailsSession = privateSessions.find((s) => s.id === detailsId) ?? null;
  const paySession = privateSessions.find((s) => s.id === payId) ?? null;

  // ===========================================================================
  return (
    <div>
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <PageHeader
          emoji="🎓"
          title="Particulier"
          subtitle="Cours particuliers : rendez-vous, modules facturés à l'heure, parts des enseignants"
        />
        <Button onClick={openCreate} className="flex items-center gap-2">
          <Plus className="h-4 w-4" /> Nouvelle séance particulière
        </Button>
      </div>

      {/* ---- ALERTES ------------------------------------------------------ */}
      {lateSessions.length > 0 && (
        <div className="mb-4 animate-pulse rounded-2xl border-2 border-danger/50 bg-danger/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <strong className="block text-sm text-danger">
                {lateSessions.length} séance(s) en retard — l&apos;heure est passée et rien n&apos;a
                été conclu
              </strong>
              <p className="mt-0.5 text-[11px] text-muted">
                Marquez-les <strong>terminées</strong> si elles ont eu lieu, <strong>annulées</strong>{" "}
                sinon, ou <strong>reportez-les</strong>. Tant qu&apos;elles restent ainsi, leur
                argent n&apos;est réclamé à personne.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {lateSessions.slice(0, 12).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setDetailsId(s.id)}
                    className="rounded-lg border border-danger/30 bg-danger/15 px-2.5 py-1 text-[10px] font-bold text-danger transition-colors hover:bg-danger/25"
                  >
                    {nameOf(s)} · {fmtDateTime(s.scheduledAt)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {soonSessions.length > 0 && (
        <div className="mb-4 rounded-2xl border border-warning/40 bg-warning/10 p-4">
          <div className="flex items-start gap-3">
            <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <strong className="block text-sm text-warning">
                {soonSessions.length} séance(s) dans les 24 heures
              </strong>
              <div className="mt-2 flex flex-wrap gap-2">
                {soonSessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setDetailsId(s.id)}
                    className="rounded-lg border border-warning/30 bg-warning/15 px-2.5 py-1 text-[10px] font-bold text-warning transition-colors hover:bg-warning/25"
                  >
                    {nameOf(s)} · {fmtDateTime(s.scheduledAt)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {unpaidTeachers.length > 0 && (
        <div className="mb-4 rounded-2xl border border-primary/30 bg-primary-50/50 p-4">
          <div className="flex items-start gap-3">
            <Users className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <strong className="block text-sm text-primary">
                {unpaidTeachers.length} séance(s) avec un enseignant non réglé —{" "}
                {unpaidTeachers.reduce((sum, s) => sum + teacherDueOf(s), 0)} DA
              </strong>
              <div className="mt-2 flex flex-wrap gap-2">
                {unpaidTeachers.slice(0, 12).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setDetailsId(s.id)}
                    className="rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary transition-colors hover:bg-primary/20"
                  >
                    {nameOf(s)} · {teacherDueOf(s)} DA
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Barre de recherche et filtres --------------------------------- */}
      <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par élève, enseignant, module ou téléphone..."
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { key: "all" as const, label: `Toutes (${sorted.length})` },
              { key: "planned" as const, label: `Programmées (${sorted.filter((s) => s.status === "planned").length})` },
              { key: "done" as const, label: `Terminées (${sorted.filter((s) => s.status === "done").length})` },
              { key: "cancelled" as const, label: `Annulées (${sorted.filter((s) => s.status === "cancelled").length})` },
            ]
          ).map((k) => (
            <button
              key={k.key}
              onClick={() => setStatusFilter(k.key)}
              className={`rounded-lg px-3 py-1.5 text-[10px] font-bold transition-all ${
                statusFilter === k.key ? "bg-primary text-white shadow-sm" : "bg-canvas text-muted hover:text-ink"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { key: "all" as const, label: "Tout" },
              { key: "debt" as const, label: `Dette élève (${debtSessions.length})` },
              { key: "teacherDue" as const, label: `Prof à payer (${unpaidTeachers.length})` },
            ]
          ).map((k) => (
            <button
              key={k.key}
              onClick={() => setMoneyFilter(k.key)}
              className={`rounded-lg px-3 py-1.5 text-[10px] font-bold transition-all ${
                moneyFilter === k.key ? "bg-warning text-white shadow-sm" : "bg-canvas text-muted hover:text-ink"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      {/* ---- Les cartes ---------------------------------------------------- */}
      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface p-12 text-center">
          <GraduationCap className="mx-auto mb-3 h-8 w-8 text-muted" />
          <p className="text-sm text-muted">
            {sorted.length === 0
              ? "Aucune séance particulière pour le moment."
              : "Aucune séance ne correspond à cette recherche."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((s) => {
            const mods = modulesOf(s.id);
            const due = dueOf(s);
            const tDue = teacherDueOf(s);
            const timing = timingOf(s);
            return (
              <Card
                key={s.id}
                className={`border transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg ${
                  timing === "late"
                    ? "border-danger/40"
                    : timing === "soon"
                      ? "border-warning/40"
                      : "border-line"
                }`}
              >
                <CardBody className="flex min-h-[250px] flex-col justify-between p-5">
                  <div>
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="truncate text-sm font-bold text-ink">{nameOf(s)}</h4>
                        <span className="block truncate font-mono text-[10px] text-muted">
                          {phoneOf(s) || "sans téléphone"}
                        </span>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <Badge tone={STATUS_TONES[s.status]} className="px-1.5 py-0 text-[9px]">
                            {STATUS_LABELS[s.status]}
                          </Badge>
                          {s.studentId ? (
                            <Badge tone="primary" className="px-1.5 py-0 text-[9px]">
                              Élève inscrit
                            </Badge>
                          ) : (
                            <Badge tone="neutral" className="px-1.5 py-0 text-[9px]">
                              De passage
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Quand */}
                    <div
                      className={`mb-2.5 flex items-center gap-2 rounded-xl border px-2.5 py-2 text-[10px] font-bold ${
                        timing === "late"
                          ? "animate-pulse border-danger/30 bg-danger/10 text-danger"
                          : timing === "soon"
                            ? "border-warning/30 bg-warning/10 text-warning"
                            : "border-line bg-canvas/30 text-ink"
                      }`}
                    >
                      <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                      <span>{fmtDateTime(s.scheduledAt)}</span>
                      {timing === "late" && <span className="ms-auto">en retard</span>}
                      {timing === "soon" && <span className="ms-auto">bientôt</span>}
                    </div>

                    {/* Modules */}
                    <div className="mb-2.5 space-y-1">
                      {mods.slice(0, 3).map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-line/60 bg-canvas/20 px-2 py-1.5 text-[10px]"
                        >
                          <span className="min-w-0 truncate">
                            <strong className="text-ink">{moduleName(m.moduleId)}</strong>
                            <span className="text-muted"> · {teacherName(m.teacherId)}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            <span className="font-mono text-muted">{fmtDuration(m.minutes)}</span>
                            <Badge
                              tone={m.teacherPaid ? "success" : "warning"}
                              className="text-[9px] font-bold"
                            >
                              {m.teacherPaid ? "prof payé" : `${m.teacherAmount} DA`}
                            </Badge>
                          </span>
                        </div>
                      ))}
                      {mods.length > 3 && (
                        <span className="block text-[10px] text-muted">
                          + {mods.length - 3} autre(s) module(s)
                        </span>
                      )}
                    </div>

                    {/* Argent */}
                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                      <div className="rounded-xl border border-line/50 bg-canvas/20 p-2 text-center">
                        <span className="block text-[9px] uppercase text-muted">Total</span>
                        <strong className="font-mono text-ink">{s.totalPrice} DA</strong>
                      </div>
                      <div className="rounded-xl border border-line/50 bg-canvas/20 p-2 text-center">
                        <span className="block text-[9px] uppercase text-muted">Encaissé</span>
                        <strong className="font-mono text-success">{s.paidAmount} DA</strong>
                      </div>
                      <div
                        className={`rounded-xl border p-2 text-center ${
                          due > 0 ? "border-danger/30 bg-danger/5" : "border-line/50 bg-canvas/20"
                        }`}
                      >
                        <span className="block text-[9px] uppercase text-muted">Dette</span>
                        <strong className={`font-mono ${due > 0 ? "text-danger" : "text-muted"}`}>
                          {due} DA
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line/60 pt-3">
                    <button
                      onClick={() => setDetailsId(s.id)}
                      className="flex items-center gap-1 rounded-lg border border-line bg-canvas px-2 py-1.5 text-[10px] font-bold text-ink transition-colors hover:bg-primary-50"
                    >
                      <Eye className="h-3 w-3" /> Détails
                    </button>
                    {due > 0 && s.status !== "cancelled" && (
                      <button
                        onClick={() => {
                          setPayId(s.id);
                          setPayAmount(due);
                        }}
                        className="flex items-center gap-1 rounded-lg border border-success/30 bg-success/15 px-2 py-1.5 text-[10px] font-bold text-success transition-colors hover:bg-success/25"
                      >
                        <DollarSign className="h-3 w-3" /> Encaisser {due} DA
                      </button>
                    )}
                    {tDue > 0 && s.status !== "cancelled" && (
                      <button
                        onClick={() => setDetailsId(s.id)}
                        className="flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2 py-1.5 text-[10px] font-bold text-primary transition-colors hover:bg-primary/20"
                      >
                        <Users className="h-3 w-3" /> Payer prof ({tDue} DA)
                      </button>
                    )}
                    {s.status === "planned" && (
                      <button
                        onClick={() => handleStatus(s, "done")}
                        className="flex items-center gap-1 rounded-lg border border-success/30 bg-success/10 px-2 py-1.5 text-[10px] font-bold text-success transition-colors hover:bg-success/20"
                      >
                        <CheckCircle className="h-3 w-3" /> Séance tenue
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setRescheduleId(s.id);
                        const d = new Date(s.scheduledAt);
                        setNewDate(
                          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
                        );
                        setNewTime(
                          `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
                        );
                      }}
                      className="flex items-center gap-1 rounded-lg border border-line bg-canvas px-2 py-1.5 text-[10px] font-bold text-ink transition-colors hover:bg-primary-50"
                    >
                      <CalendarClock className="h-3 w-3" /> Reporter
                    </button>
                    <button
                      onClick={() => openEdit(s)}
                      className="flex items-center gap-1 rounded-lg border border-line bg-canvas px-2 py-1.5 text-[10px] font-bold text-ink transition-colors hover:bg-primary-50"
                    >
                      <Edit className="h-3 w-3" /> Modifier
                    </button>
                    {s.status !== "cancelled" && (
                      <button
                        onClick={() => handleStatus(s, "cancelled")}
                        className="flex items-center gap-1 rounded-lg border border-line bg-canvas px-2 py-1.5 text-[10px] font-bold text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                      >
                        <XCircle className="h-3 w-3" /> Annuler
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(s)}
                      className="flex items-center gap-1 rounded-lg border border-danger/30 bg-danger/10 px-2 py-1.5 text-[10px] font-bold text-danger transition-colors hover:bg-danger/20"
                    >
                      <Trash2 className="h-3 w-3" /> Supprimer
                    </button>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {/* ================================================================== */}
      {/* FORMULAIRE — créer / modifier une séance particulière                */}
      {/* ================================================================== */}
      <Modal
        open={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={editingId ? "Modifier la séance particulière" : "Nouvelle séance particulière"}
        subtitle="L'élève, la date, puis les modules facturés à l'heure avec leur enseignant et son pourcentage."
        size="xl"
      >
        <div className="space-y-5">
          {/* ---- 1. L'ÉLÈVE ---- */}
          <div className="rounded-2xl border border-line bg-canvas/30 p-4">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-muted">
              1 · L&apos;élève
            </span>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setStudentMode("existing")}
                className={`rounded-xl border p-3 text-left transition-all ${
                  studentMode === "existing"
                    ? "border-primary bg-primary/10 ring-2 ring-primary/25"
                    : "border-line bg-surface"
                }`}
              >
                <strong className="block text-xs text-ink">Élève de l&apos;école</strong>
                <span className="text-[10px] text-muted">
                  Cherchez-le, ou créez-le ici sans quitter l&apos;écran.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setStudentMode("guest")}
                className={`rounded-xl border p-3 text-left transition-all ${
                  studentMode === "guest"
                    ? "border-primary bg-primary/10 ring-2 ring-primary/25"
                    : "border-line bg-surface"
                }`}
              >
                <strong className="block text-xs text-ink">Élève de passage</strong>
                <span className="text-[10px] text-muted">
                  Un nom, un téléphone : aucun dossier n&apos;est créé.
                </span>
              </button>
            </div>

            {studentMode === "existing" ? (
              <div className="space-y-2">
                {selectedStudent ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary-50/40 p-3">
                    <div className="min-w-0">
                      <strong className="block text-xs text-ink">
                        {selectedStudent.firstName} {selectedStudent.lastName}
                      </strong>
                      <span className="block text-[10px] text-muted">
                        {selectedStudent.phone || "sans téléphone"} · carte{" "}
                        <span className="font-mono">{selectedStudent.rfid || "—"}</span> · solde{" "}
                        <span className="font-mono">{selectedStudent.balance} DA</span>
                      </span>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setStudentId("")}>
                      <X className="h-3.5 w-3.5" /> Changer
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <div className="relative min-w-[14rem] flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                        <Input
                          value={studentSearch}
                          onChange={(e) => setStudentSearch(e.target.value)}
                          placeholder="Chercher un élève (nom, téléphone, carte)..."
                          className="pl-9"
                        />
                      </div>
                      <Button variant="outline" onClick={() => setIsStudentFormOpen(true)}>
                        <UserPlus className="h-4 w-4" /> Créer un élève
                      </Button>
                    </div>

                    {studentSearch.trim() && (
                      <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-line bg-surface p-1.5">
                        {studentMatches.length === 0 ? (
                          <p className="py-3 text-center text-[10px] italic text-muted">
                            Aucun élève trouvé. Créez-le, ou passez en « élève de passage ».
                          </p>
                        ) : (
                          studentMatches.map((st) => (
                            <button
                              key={st.id}
                              type="button"
                              onClick={() => {
                                setStudentId(st.id);
                                setStudentSearch("");
                              }}
                              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] transition-colors hover:bg-primary-50"
                            >
                              <span className="min-w-0">
                                <strong className="block truncate text-ink">
                                  {st.firstName} {st.lastName}
                                </strong>
                                <span className="block truncate font-mono text-[10px] text-muted">
                                  {st.phone} · {st.rfid}
                                </span>
                              </span>
                              <Badge
                                tone={st.balance < 0 ? "danger" : "primary"}
                                className="shrink-0 font-mono text-[9px]"
                              >
                                {st.balance} DA
                              </Badge>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-3">
                  <label className="mb-1 block text-xs font-semibold text-muted">Nom complet *</label>
                  <Input
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder="Prénom et nom"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Téléphone *</label>
                  <Input
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value)}
                    placeholder="+213 5XX XX XX XX"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">
                    2ᵉ téléphone (optionnel)
                  </label>
                  <Input
                    value={guestPhone2}
                    onChange={(e) => setGuestPhone2(e.target.value)}
                    placeholder="Parent, tuteur…"
                  />
                </div>
              </div>
            )}

            {/* Scolarité — utile même pour un élève de passage */}
            <div className="mt-3 grid grid-cols-1 gap-3 border-t border-line/60 pt-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Classe</label>
                <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-full">
                  <option value="">—</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.coursLevel ? ` (${COURS_LEVEL_LABELS[c.coursLevel]})` : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Année</label>
                <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-full">
                  <option value="">—</option>
                  {YEAR_ORDER.map((y) => (
                    <option key={y} value={y}>
                      {y} Année
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Filière</label>
                <Select
                  value={filiereId}
                  onChange={(e) => setFiliereId(e.target.value)}
                  className="w-full"
                >
                  <option value="">—</option>
                  {filieres.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </div>

          {/* ---- 2. QUAND ---- */}
          <div className="rounded-2xl border border-line bg-canvas/30 p-4">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-muted">
              2 · Le rendez-vous
            </span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Date *</label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Heure *</label>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Durée totale</label>
                <div className="flex h-10 items-center rounded-xl border border-line bg-surface px-3 font-mono text-sm text-primary">
                  {fmtDuration(draftMinutes)}
                </div>
              </div>
              <div className="sm:col-span-3">
                <label className="mb-1 block text-xs font-semibold text-muted">Observation</label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Préparation bac, remise à niveau, salle demandée…"
                />
              </div>
            </div>
          </div>

          {/* ---- 3. LES MODULES ---- */}
          <div className="rounded-2xl border border-primary/25 bg-primary-50/30 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                3 · Les modules — facturés à l&apos;heure
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDrafts([...drafts, emptyModuleDraft()])}
              >
                <Plus className="h-3.5 w-3.5" /> Ajouter un module
              </Button>
            </div>

            <div className="space-y-3">
              {drafts.map((d, i) => {
                const total = priceOf(d);
                const share = Math.round((total * d.teacherPercentage) / 100);
                return (
                  <div key={d.uiKey} className="rounded-xl border border-line bg-surface p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <strong className="text-[11px] text-ink">Module {i + 1}</strong>
                      {drafts.length > 1 && (
                        <button
                          onClick={() => setDrafts(drafts.filter((x) => x.uiKey !== d.uiKey))}
                          className="rounded-lg p-1 text-danger hover:bg-danger/10"
                          title="Retirer ce module"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                      {/* Module */}
                      <div className="sm:col-span-2">
                        <div className="mb-1 flex items-center justify-between">
                          <label className="text-xs font-semibold text-muted">Module *</label>
                          <button
                            onClick={() =>
                              setModuleForDraft(moduleForDraft === d.uiKey ? null : d.uiKey)
                            }
                            className="text-[10px] font-bold text-primary hover:underline"
                          >
                            + Nouveau module
                          </button>
                        </div>
                        {moduleForDraft === d.uiKey ? (
                          <div className="flex gap-2">
                            <Input
                              value={newModuleName}
                              onChange={(e) => setNewModuleName(e.target.value)}
                              placeholder="Nom du module"
                              className="flex-1"
                            />
                            <Button size="sm" onClick={handleCreateModule}>
                              Créer
                            </Button>
                          </div>
                        ) : (
                          <Select
                            value={d.moduleId}
                            onChange={(e) => updateDraft(d.uiKey, { moduleId: e.target.value })}
                            className="w-full"
                          >
                            <option value="">Sélectionner un module</option>
                            {modules.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </Select>
                        )}
                      </div>

                      {/* Durée */}
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-muted">Durée *</label>
                        <div className="flex gap-1.5">
                          <Input
                            type="number"
                            min={0}
                            max={12}
                            value={d.hours}
                            onChange={(e) => updateDraft(d.uiKey, { hours: Number(e.target.value) })}
                            className="w-full"
                            title="heures"
                          />
                          <Input
                            type="number"
                            min={0}
                            max={59}
                            step={5}
                            value={d.minutes}
                            onChange={(e) => updateDraft(d.uiKey, { minutes: Number(e.target.value) })}
                            className="w-full"
                            title="minutes"
                          />
                        </div>
                        <span className="mt-0.5 block text-[9px] text-muted">heures · minutes</span>
                      </div>

                      {/* Tarif horaire */}
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-muted">
                          Prix de l&apos;heure (DA) *
                        </label>
                        <Input
                          type="number"
                          min={0}
                          value={d.hourlyPrice || ""}
                          onChange={(e) => updateDraft(d.uiKey, { hourlyPrice: Number(e.target.value) })}
                          placeholder="Ex: 1500"
                        />
                      </div>
                    </div>

                    {/* Enseignant */}
                    <div className="mt-3 grid grid-cols-1 gap-3 border-t border-line/60 pt-3 sm:grid-cols-4">
                      <div className="sm:col-span-2">
                        <div className="mb-1 flex items-center justify-between">
                          <label className="text-xs font-semibold text-muted">Enseignant</label>
                          <button
                            onClick={() => {
                              setTeacherForDraft(d.uiKey);
                              setNtPercentage(d.teacherPercentage);
                              setIsTeacherFormOpen(true);
                            }}
                            className="text-[10px] font-bold text-primary hover:underline"
                          >
                            + Nouvel enseignant
                          </button>
                        </div>
                        <Select
                          value={d.teacherId}
                          onChange={(e) => {
                            const t = teachers.find((x) => x.id === e.target.value);
                            updateDraft(d.uiKey, {
                              teacherId: e.target.value,
                              teacherPercentage: t?.percentage ?? d.teacherPercentage,
                            });
                          }}
                          className="w-full"
                        >
                          <option value="">À désigner</option>
                          {teachers.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.firstName} {t.lastName}
                              {t.isPassager ? " (passager)" : ""}
                            </option>
                          ))}
                        </Select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-semibold text-muted">
                          Part enseignant (%)
                        </label>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={d.teacherPercentage}
                          onChange={(e) =>
                            updateDraft(d.uiKey, { teacherPercentage: Number(e.target.value) })
                          }
                        />
                      </div>

                      <div className="flex flex-col justify-end">
                        <div className="flex items-center justify-between rounded-xl border border-line bg-canvas/40 px-3 py-2">
                          <span className="text-[10px] text-muted">Total module</span>
                          <strong className="font-mono text-sm text-primary">{total} DA</strong>
                        </div>
                        <span className="mt-1 block text-[10px] text-muted">
                          dont <strong className="text-ink">{share} DA</strong> pour
                          l&apos;enseignant
                        </span>
                      </div>
                    </div>

                    {d.teacherId && (
                      <label className="mt-2 flex cursor-pointer items-center gap-2 border-t border-line/60 pt-2 text-[11px]">
                        <input
                          type="checkbox"
                          checked={d.teacherPaid}
                          onChange={(e) => updateDraft(d.uiKey, { teacherPaid: e.target.checked })}
                          className="h-4 w-4"
                        />
                        <span className="text-ink">
                          L&apos;enseignant est réglé tout de suite ({share} DA)
                          <span className="block text-[10px] text-muted">
                            Sinon, la séance est signalée « enseignant non réglé » ici et sur le
                            tableau de bord jusqu&apos;au versement.
                          </span>
                        </span>
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ---- 4. L'ARGENT ---- */}
          <div className="rounded-2xl border border-success/30 bg-success/5 p-4">
            <span className="mb-3 block text-[10px] font-bold uppercase tracking-wider text-success">
              4 · Le règlement
            </span>

            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-line bg-surface p-3 text-center">
                <span className="block text-[9px] uppercase text-muted">Durée</span>
                <strong className="font-mono text-sm text-ink">{fmtDuration(draftMinutes)}</strong>
              </div>
              <div className="rounded-xl border border-line bg-surface p-3 text-center">
                <span className="block text-[9px] uppercase text-muted">Total séance</span>
                <strong className="font-mono text-sm text-primary">{draftTotal} DA</strong>
              </div>
              <div className="rounded-xl border border-line bg-surface p-3 text-center">
                <span className="block text-[9px] uppercase text-muted">Part enseignants</span>
                <strong className="font-mono text-sm text-warning">
                  {drafts.reduce(
                    (sum, d) => sum + Math.round((priceOf(d) * d.teacherPercentage) / 100),
                    0,
                  )}{" "}
                  DA
                </strong>
              </div>
              <div className="rounded-xl border border-line bg-surface p-3 text-center">
                <span className="block text-[9px] uppercase text-muted">Marge école</span>
                <strong className="font-mono text-sm text-success">
                  {draftTotal -
                    drafts.reduce(
                      (sum, d) => sum + Math.round((priceOf(d) * d.teacherPercentage) / 100),
                      0,
                    )}{" "}
                  DA
                </strong>
              </div>
            </div>

            <label className="mb-2 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3">
              <span className="min-w-0">
                <strong className="block text-xs text-ink">L&apos;élève a payé</strong>
                <span className="block text-[10px] text-muted">
                  Décochez si rien n&apos;est versé : la totalité devient une dette attachée à cette
                  séance.
                </span>
              </span>
              <input
                type="checkbox"
                checked={studentPaid}
                onChange={(e) => {
                  setStudentPaid(e.target.checked);
                  if (e.target.checked && !paidTouched) setPaidAmount(draftTotal);
                  if (!e.target.checked) setPaidAmount(0);
                }}
                className="h-5 w-5 shrink-0"
              />
            </label>

            {studentPaid && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">
                    Montant versé (DA)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    max={draftTotal}
                    value={paidAmount}
                    onChange={(e) => {
                      setPaidAmount(Number(e.target.value));
                      setPaidTouched(true);
                    }}
                  />
                </div>
                <div className="flex items-end">
                  <div
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 ${
                      draftTotal - Math.min(paidAmount, draftTotal) > 0
                        ? "border-danger/30 bg-danger/5"
                        : "border-success/30 bg-success/10"
                    }`}
                  >
                    <span className="text-[10px] text-muted">Reste dû</span>
                    <strong
                      className={`font-mono text-sm ${
                        draftTotal - Math.min(paidAmount, draftTotal) > 0
                          ? "text-danger"
                          : "text-success"
                      }`}
                    >
                      {Math.max(0, draftTotal - Math.min(paidAmount, draftTotal))} DA
                    </strong>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="outline" onClick={() => setIsFormOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving
                ? "Enregistrement..."
                : editingId
                  ? "Enregistrer les modifications"
                  : `Programmer la séance (${draftTotal} DA)`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ================================================================== */}
      {/* Créer un élève sans quitter l'écran                                  */}
      {/* ================================================================== */}
      <Modal
        open={isStudentFormOpen}
        onClose={() => setIsStudentFormOpen(false)}
        title="Créer un élève"
        subtitle="Le dossier est créé comme depuis l'écran Étudiants, puis rattaché automatiquement à cette séance."
        wide
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Prénom *</label>
            <Input value={nsFirstName} onChange={(e) => setNsFirstName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Nom de famille *</label>
            <Input value={nsLastName} onChange={(e) => setNsLastName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Date de naissance</label>
            <Input type="date" value={nsBirthDate} onChange={(e) => setNsBirthDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Téléphone *</label>
            <Input
              value={nsPhone}
              onChange={(e) => setNsPhone(e.target.value)}
              placeholder="+213 5XX XX XX XX"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Numéro carte RFID *</label>
            <Input
              value={nsRfid}
              onChange={(e) => setNsRfid(e.target.value)}
              placeholder="Ex: RFID-0010"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Email</label>
            <Input
              value={nsEmail}
              onChange={(e) => setNsEmail(e.target.value)}
              placeholder={`prenom.carte@${PORTAL_EMAIL_DOMAIN}`}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Mot de passe *</label>
            <Input
              value={nsPassword}
              onChange={(e) => setNsPassword(e.target.value)}
              placeholder="6 caractères min."
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-line bg-primary-50/50 p-3 md:col-span-2">
            <div>
              <strong className="block text-xs text-ink">Études gratuites</strong>
              <span className="text-[10px] text-muted">
                Aucun frais ne sera déduit de son solde sur ses cours réguliers.
              </span>
            </div>
            <input
              type="checkbox"
              checked={nsIsFree}
              onChange={(e) => setNsIsFree(e.target.checked)}
              className="h-5 w-5"
            />
          </div>
        </div>
        <p className="mt-3 rounded-xl border border-line bg-canvas/40 p-2.5 text-[10px] leading-relaxed text-muted">
          Ses inscriptions aux cours réguliers, ses frais d&apos;inscription et son premier
          versement se règlent depuis l&apos;écran <strong>Étudiants</strong> : un cours
          particulier ne passe pas par le solde de l&apos;élève.
        </p>
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="outline" onClick={() => setIsStudentFormOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleCreateStudent} disabled={savingStudent}>
            {savingStudent ? "Création..." : "Créer et sélectionner"}
          </Button>
        </div>
      </Modal>

      {/* ================================================================== */}
      {/* Créer un enseignant sans quitter l'écran                             */}
      {/* ================================================================== */}
      <Modal
        open={isTeacherFormOpen}
        onClose={() => {
          setIsTeacherFormOpen(false);
          setTeacherForDraft(null);
        }}
        title="Nouvel enseignant"
        subtitle="Il sera affecté directement au module d'où vous l'avez créé."
        wide
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setNtKind("passager")}
              className={`rounded-xl border p-3 text-left transition-all ${
                ntKind === "passager"
                  ? "border-primary bg-primary/10 ring-2 ring-primary/25"
                  : "border-line bg-surface"
              }`}
            >
              <strong className="block text-xs text-ink">Enseignant passager</strong>
              <span className="text-[10px] text-muted">
                Un nom, un téléphone, une description. Aucun compte de connexion.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setNtKind("staff")}
              className={`rounded-xl border p-3 text-left transition-all ${
                ntKind === "staff"
                  ? "border-primary bg-primary/10 ring-2 ring-primary/25"
                  : "border-line bg-surface"
              }`}
            >
              <strong className="block text-xs text-ink">Enseignant de l&apos;école</strong>
              <span className="text-[10px] text-muted">
                Avec compte de connexion, comme depuis l&apos;écran Enseignants.
              </span>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Prénom *</label>
              <Input value={ntFirstName} onChange={(e) => setNtFirstName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Nom</label>
              <Input value={ntLastName} onChange={(e) => setNtLastName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Téléphone</label>
              <Input
                value={ntPhone}
                onChange={(e) => setNtPhone(e.target.value)}
                placeholder="+213 5XX XX XX XX"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">
                Part par défaut (%)
              </label>
              <Input
                type="number"
                min={0}
                max={100}
                value={ntPercentage}
                onChange={(e) => setNtPercentage(Number(e.target.value))}
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-muted">Description</label>
              <Input
                value={ntDescription}
                onChange={(e) => setNtDescription(e.target.value)}
                placeholder="Spécialité, provenance, disponibilités…"
              />
            </div>

            {ntKind === "staff" && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Email *</label>
                  <Input
                    value={ntEmail}
                    onChange={(e) => setNtEmail(e.target.value)}
                    placeholder="email@ecole.com"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Mot de passe *</label>
                  <Input
                    value={ntPassword}
                    onChange={(e) => setNtPassword(e.target.value)}
                    placeholder="6 caractères min."
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setIsTeacherFormOpen(false);
                setTeacherForDraft(null);
              }}
            >
              Annuler
            </Button>
            <Button onClick={handleCreateTeacher} disabled={savingTeacher}>
              {savingTeacher ? "Création..." : "Créer et affecter"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ================================================================== */}
      {/* DÉTAILS                                                             */}
      {/* ================================================================== */}
      <Modal
        open={detailsSession !== null}
        onClose={() => setDetailsId(null)}
        title={detailsSession ? `Séance particulière — ${nameOf(detailsSession)}` : ""}
        size="xl"
      >
        {detailsSession && (
          <div className="space-y-4">
            {/* Bandeau */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-canvas p-4">
              <div className="min-w-0">
                <strong className="block text-base text-ink">{nameOf(detailsSession)}</strong>
                <span className="block text-[11px] text-muted">
                  {phoneOf(detailsSession) || "sans téléphone"}
                  {detailsSession.guestPhone2 && ` · ${detailsSession.guestPhone2}`}
                  {detailsSession.classId &&
                    ` · ${classes.find((c) => c.id === detailsSession.classId)?.name ?? ""}`}
                  {detailsSession.year && ` · ${detailsSession.year} Année`}
                  {detailsSession.filiereId &&
                    ` · ${filieres.find((f) => f.id === detailsSession.filiereId)?.name ?? ""}`}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={STATUS_TONES[detailsSession.status]} className="font-bold">
                  {STATUS_LABELS[detailsSession.status]}
                </Badge>
                <Badge tone="primary" className="font-mono font-bold">
                  {fmtDateTime(detailsSession.scheduledAt)}
                </Badge>
              </div>
            </div>

            {/* Argent */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Durée", value: fmtDuration(detailsSession.durationMinutes), tone: "text-ink" },
                { label: "Total", value: `${detailsSession.totalPrice} DA`, tone: "text-primary" },
                { label: "Encaissé", value: `${detailsSession.paidAmount} DA`, tone: "text-success" },
                {
                  label: "Reste dû",
                  value: `${dueOf(detailsSession)} DA`,
                  tone: dueOf(detailsSession) > 0 ? "text-danger" : "text-muted",
                },
              ].map((k) => (
                <div key={k.label} className="rounded-xl border border-line bg-canvas p-3 text-center">
                  <span className="block text-[10px] font-semibold uppercase text-muted">
                    {k.label}
                  </span>
                  <strong className={`font-mono text-base ${k.tone}`}>{k.value}</strong>
                </div>
              ))}
            </div>

            {detailsSession.notes && (
              <div className="rounded-xl border border-line bg-canvas/30 p-3 text-[11px] text-muted">
                <strong className="text-ink">Observation :</strong> {detailsSession.notes}
              </div>
            )}

            {/* Modules */}
            <div className="rounded-2xl border border-line bg-surface p-4">
              <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted">
                📚 Modules et enseignants
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-line text-[10px] font-bold uppercase text-muted">
                      <th className="p-2">Module</th>
                      <th className="p-2">Enseignant</th>
                      <th className="p-2 text-center">Durée</th>
                      <th className="p-2 text-right">Tarif horaire</th>
                      <th className="p-2 text-right">Total</th>
                      <th className="p-2 text-right">Part prof</th>
                      <th className="p-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modulesOf(detailsSession.id).map((m) => (
                      <tr key={m.id} className="border-b border-line/50 last:border-0">
                        <td className="p-2 font-semibold text-ink">{moduleName(m.moduleId)}</td>
                        <td className="p-2 text-muted">{teacherName(m.teacherId)}</td>
                        <td className="p-2 text-center font-mono">{fmtDuration(m.minutes)}</td>
                        <td className="p-2 text-right font-mono">{m.hourlyPrice} DA/h</td>
                        <td className="p-2 text-right font-mono font-bold text-primary">
                          {m.totalPrice} DA
                        </td>
                        <td className="p-2 text-right font-mono">
                          {m.teacherAmount} DA
                          <span className="block text-[9px] text-muted">
                            {m.teacherPercentage} %
                          </span>
                        </td>
                        <td className="p-2 text-right">
                          {m.teacherPaid ? (
                            <Badge tone="success" className="text-[9px]">
                              Payé
                              {m.teacherPaidAt &&
                                ` · ${formatDateFr(m.teacherPaidAt.slice(0, 10))}`}
                            </Badge>
                          ) : m.teacherId ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                handlePayTeacher(m.id, teacherName(m.teacherId), m.teacherAmount)
                              }
                            >
                              Payer {m.teacherAmount} DA
                            </Button>
                          ) : (
                            <Badge tone="neutral" className="text-[9px]">
                              Aucun enseignant
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
              <div className="flex flex-wrap gap-2">
                {dueOf(detailsSession) > 0 && detailsSession.status !== "cancelled" && (
                  <Button
                    variant="success"
                    onClick={() => {
                      setPayId(detailsSession.id);
                      setPayAmount(dueOf(detailsSession));
                      setDetailsId(null);
                    }}
                  >
                    <DollarSign className="h-4 w-4" /> Encaisser {dueOf(detailsSession)} DA
                  </Button>
                )}
                {detailsSession.status === "planned" && (
                  <Button variant="outline" onClick={() => handleStatus(detailsSession, "done")}>
                    <CheckCircle className="h-4 w-4" /> Séance tenue
                  </Button>
                )}
                {detailsSession.status !== "cancelled" && (
                  <Button variant="outline" onClick={() => handleStatus(detailsSession, "cancelled")}>
                    <XCircle className="h-4 w-4" /> Annuler
                  </Button>
                )}
                <Button variant="outline" onClick={() => openEdit(detailsSession)}>
                  <Edit className="h-4 w-4" /> Modifier
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="danger" onClick={() => handleDelete(detailsSession)}>
                  <Trash2 className="h-4 w-4" /> Supprimer
                </Button>
                <Button variant="outline" onClick={() => setDetailsId(null)}>
                  Fermer
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ---- Encaisser la dette ---- */}
      <Modal
        open={paySession !== null}
        onClose={() => setPayId(null)}
        title="Encaisser la dette de la séance"
        subtitle="L'argent entre en caisse. Le solde de l'élève n'est pas touché : un cours particulier est une prestation ponctuelle, pas une séance d'abonnement."
      >
        {paySession && (
          <div className="space-y-4 text-xs">
            <div className="rounded-xl border border-line bg-canvas/40 p-3">
              <strong className="block text-sm text-ink">{nameOf(paySession)}</strong>
              <span className="text-[10px] text-muted">
                {fmtDateTime(paySession.scheduledAt)} · total {paySession.totalPrice} DA · déjà
                encaissé {paySession.paidAmount} DA
              </span>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">
                Montant encaissé (DA) *
              </label>
              <Input
                type="number"
                min={0}
                max={dueOf(paySession)}
                value={payAmount}
                onChange={(e) => setPayAmount(Number(e.target.value))}
              />
              <p className="mt-1 text-[10px] text-muted">
                Reste dû : <strong className="text-danger">{dueOf(paySession)} DA</strong>. Un
                montant plus élevé est ramené à la dette — on n&apos;encaisse jamais plus que ce
                que la séance coûte.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <Button variant="outline" onClick={() => setPayId(null)}>
                Annuler
              </Button>
              <Button variant="success" onClick={handlePayDebt}>
                Encaisser
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ---- Reporter ---- */}
      <Modal
        open={rescheduleId !== null}
        onClose={() => setRescheduleId(null)}
        title="Reporter la séance"
        subtitle="Une séance annulée qu'on redate redevient programmée."
      >
        <div className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Nouvelle date *</label>
              <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Nouvelle heure *</label>
              <Input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <Button variant="outline" onClick={() => setRescheduleId(null)}>
              Annuler
            </Button>
            <Button onClick={handleReschedule}>
              <CalendarClock className="h-4 w-4" /> Reporter
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
