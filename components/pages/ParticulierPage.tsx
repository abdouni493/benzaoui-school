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
  ClipboardList,
  DollarSign,
  Edit,
  Eye,
  GraduationCap,
  Plus,
  Printer,
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
  cascadeOfClass,
  filiereOptionsOf,
  levelOptionsOf,
  matchedClassesOf,
  yearOptionsOf,
  type LevelKey,
} from "@/lib/classCascade";
import {
  classCascadeLabel,
  formatDateFr,
  normalizeSearchText,
  todayIso,
} from "@/lib/helpers";
import { printHtmlDocument } from "@/lib/print";
import { buildPrivateSessionInvoice } from "@/lib/reports/privateSessionInvoice";
import { useSettings } from "@/lib/store/settings";
import { useCanSeeGains, useSession } from "@/lib/store/session";
import { useToast } from "@/lib/store/toast";

/** Domaine des identifiants du portail — identique à l'écran Étudiants. */
const PORTAL_EMAIL_DOMAIN = "benzaoui.com";

const STATUS_LABELS: Record<PrivateSessionStatus, string> = {
  requested: "À programmer",
  planned: "Programmée",
  done: "Terminée",
  cancelled: "Annulée",
};

const STATUS_TONES: Record<PrivateSessionStatus, "primary" | "success" | "neutral" | "warning"> = {
  requested: "warning",
  planned: "primary",
  done: "success",
  cancelled: "neutral",
};

/**
 * Un élève en cours de saisie, à l'étape « renseignement ».
 *
 * Plusieurs élèves peuvent partager la même séance particulière (deux cousins,
 * deux camarades). Chacun garde sa scolarité et, à la conclusion, sa part —
 * les entasser dans un seul nom rendait impossible de dire qui avait payé quoi.
 */
interface StudentDraft {
  uiKey: string;
  /** identifiant en base, une fois la demande enregistrée (sert à la conclusion) */
  rowId?: string;
  /** élève déjà inscrit à l'école */
  studentId: string;
  /** élève de passage : ce que le guichet note de lui */
  guestName: string;
  guestPhone: string;
  guestPhone2: string;
  /** scolarité déclarée (facultative) */
  level: LevelKey;
  year: string;
  filiereId: string;
  /** recherche en cours dans la liste des élèves inscrits */
  search: string;
}

const emptyStudentDraft = (): StudentDraft => ({
  uiKey: uid("sd"),
  studentId: "",
  guestName: "",
  guestPhone: "",
  guestPhone2: "",
  level: "",
  year: "",
  filiereId: "",
  search: "",
});

/** Une ligne de module à l'étape « programmation ». */
interface ModuleDraft {
  uiKey: string;
  moduleId: string;
  /** enseignant de l'école, choisi dans la base */
  teacherId: string;
  /** … ou enseignant de l'occasion, simplement nommé */
  teacherName: string;
  teacherPhone: string;
  /** date et heure PROPRES à ce module */
  date: string;
  time: string;
  hours: number;
  minutes: number;
  /** prix forfaitaire : > 0, c'est lui le prix du module */
  flatPrice: number;
  /** tarif horaire, utilisé quand aucun forfait n'est posé */
  hourlyPrice: number;
  teacherPercentage: number;
  search: string;
}

const emptyModuleDraft = (date: string): ModuleDraft => ({
  uiKey: uid("md"),
  moduleId: "",
  teacherId: "",
  teacherName: "",
  teacherPhone: "",
  date,
  time: "15:00",
  hours: 1,
  minutes: 0,
  flatPrice: 0,
  hourlyPrice: 0,
  teacherPercentage: 50,
  search: "",
});

/** Prix d'un module : le forfait s'il est posé, sinon minutes × tarif horaire.
 *  Miroir exact du calcul SQL — l'écran ne doit jamais annoncer un total que la
 *  base recalculerait autrement. */
const priceOf = (d: ModuleDraft) => {
  if (d.flatPrice > 0) return Math.round(d.flatPrice);
  return Math.round(((d.hours * 60 + d.minutes) * Math.max(0, d.hourlyPrice)) / 60);
};

const minutesOf = (d: ModuleDraft) => d.hours * 60 + d.minutes;

/** "2026-09-12" + "14:30" → ISO, ou null si la saisie est incomplète. */
function toIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function fmtDateTime(iso?: string): string {
  if (!iso) return "—";
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
  /**
   * CE QUE LE GUICHET NE VOIT PAS SUR CET ÉCRAN
   * -------------------------------------------
   * Un cours particulier se partage entre l'école et l'enseignant. Le guichet
   * a besoin du TOTAL, de ce qui est ENCAISSÉ et de ce qui reste DÛ par la
   * famille : c'est ce qu'il réclame et ce qu'il rend. Il n'a rien à faire du
   * partage lui-même — le pourcentage de l'enseignant, sa part en dinars, ce
   * qui revient à l'école — pas plus que sur l'écran Enseignants, qui lui est
   * déjà fermé.
   *
   * Le règlement d'un enseignant suit la même ligne : c'est une sortie de
   * caisse vers l'historique d'un enseignant, donc une opération de direction.
   * Une séance conclue au guichet laisse donc l'enseignant « à régler », et
   * l'alerte qui le dit est celle que la direction voit.
   */
  const canSeeGains = useCanSeeGains();
  const {
    privateSessions,
    privateSessionModules,
    privateSessionStudents,
    students,
    teachers,
    modules,
    classes,
    filieres,
    reception,
    school,
    push,
    createPrivateRequest,
    updatePrivateRequest,
    programPrivateSession,
    completePrivateSession,
    payPrivateSession,
    payPrivateSessionTeacher,
    setPrivateSessionStatus,
    reschedulePrivateSession,
    deletePrivateSession,
  } = useData();
  const { addToast } = useToast();
  const { language } = useSettings();
  const sessionUser = useSession((s) => s.user);

  // ---- Écran principal -------------------------------------------------------
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PrivateSessionStatus>("all");
  const [moneyFilter, setMoneyFilter] = useState<"all" | "debt" | "teacherDue">("all");

  // ---- Modales ---------------------------------------------------------------
  /** Étape 1 — le renseignement. */
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  /** Étape 2 — la programmation. */
  const [programId, setProgramId] = useState<string | null>(null);
  /** Étape 3 — la conclusion. */
  const [completeId, setCompleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [payId, setPayId] = useState<string | null>(null);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [isStudentFormOpen, setIsStudentFormOpen] = useState(false);
  const [isTeacherFormOpen, setIsTeacherFormOpen] = useState(false);
  /** la ligne d'élève / de module dont on crée la fiche */
  const [studentForDraft, setStudentForDraft] = useState<string | null>(null);
  const [teacherForDraft, setTeacherForDraft] = useState<string | null>(null);
  const [moduleForDraft, setModuleForDraft] = useState<string | null>(null);

  // ---- Étape 1 : le dossier de demande --------------------------------------
  const [studentDrafts, setStudentDrafts] = useState<StudentDraft[]>([emptyStudentDraft()]);
  const [requestDate, setRequestDate] = useState(todayIso());
  const [receptionistId, setReceptionistId] = useState("");
  const [observation, setObservation] = useState("");
  const [depositAmount, setDepositAmount] = useState<number>(0);
  const [savingRequest, setSavingRequest] = useState(false);

  // ---- Étape 2 : la programmation -------------------------------------------
  const [moduleDrafts, setModuleDrafts] = useState<ModuleDraft[]>([]);
  const [savingProgram, setSavingProgram] = useState(false);

  // ---- Étape 3 : la conclusion ----------------------------------------------
  const [completeTotal, setCompleteTotal] = useState<number>(0);
  const [pctMode, setPctMode] = useState<"school" | "teacher">("teacher");
  const [pctValue, setPctValue] = useState<number>(50);
  const [cashNow, setCashNow] = useState<number>(0);
  const [payTeachersNow, setPayTeachersNow] = useState(true);
  const [studentAmounts, setStudentAmounts] = useState<Record<string, { due: number; paid: number }>>({});
  const [savingComplete, setSavingComplete] = useState(false);

  // ---- Création rapide d'un module ------------------------------------------
  const [newModuleName, setNewModuleName] = useState("");

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
    privateSessionModules
      .filter((m) => m.privateSessionId === sessionId)
      .sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));

  const studentsOf = (sessionId: string) =>
    privateSessionStudents.filter((r) => r.privateSessionId === sessionId);

  const studentLabel = (studentId?: string, guestName?: string) => {
    if (studentId) {
      const stu = students.find((x) => x.id === studentId);
      if (stu) return `${stu.firstName} ${stu.lastName}`;
    }
    return guestName || "Élève";
  };

  /** Le nom qui s'affiche sur la carte : le premier élève, et « +N » quand la
   *  séance en porte plusieurs. */
  const nameOf = (s: PrivateSession) => {
    const rows = studentsOf(s.id);
    if (rows.length === 0) return studentLabel(s.studentId, s.guestName);
    const first = studentLabel(rows[0].studentId, rows[0].guestName);
    return rows.length > 1 ? `${first} +${rows.length - 1}` : first;
  };

  const phoneOf = (s: PrivateSession) => {
    const rows = studentsOf(s.id);
    for (const r of rows) {
      if (r.studentId) {
        const stu = students.find((x) => x.id === r.studentId);
        if (stu?.phone) return stu.phone;
      }
      if (r.guestPhone) return r.guestPhone;
    }
    if (s.studentId) {
      const stu = students.find((x) => x.id === s.studentId);
      if (stu?.phone) return stu.phone;
    }
    return s.guestPhone || "";
  };

  /** Comment un module nomme son enseignant : la fiche s'il en a une, sinon le
   *  nom saisi pour l'occasion. */
  const teacherLabel = (teacherId?: string, fallbackName?: string) => {
    const t = teachers.find((x) => x.id === teacherId);
    if (t) return `${t.firstName} ${t.lastName}`.trim();
    return fallbackName?.trim() || "Enseignant à désigner";
  };

  const moduleName = (id: string) => modules.find((m) => m.id === id)?.name ?? "Module";
  const filiereLabelOf = (id: string) => filieres.find((f) => f.id === id)?.name ?? "";

  const schoolingOf = (classId?: string, year?: string, filiereId?: string) => {
    const cls = classId ? classes.find((c) => c.id === classId) : undefined;
    if (cls) return classCascadeLabel(cls, filiereLabelOf(cls.filiereId ?? ""));
    return [year ? `${year} Année` : "", filiereId ? filiereLabelOf(filiereId) : ""]
      .filter(Boolean)
      .join(" · ");
  };

  const dueOf = (s: PrivateSession) => Math.max(0, s.totalPrice - s.paidAmount);

  /** Ce qui reste dû aux enseignants d'une séance. */
  const teacherDueOf = (s: PrivateSession) =>
    modulesOf(s.id)
      .filter((m) => !m.teacherPaid && m.teacherId)
      .reduce((sum, m) => sum + m.teacherAmount, 0);

  /**
   * Où en est le rendez-vous dans le temps.
   *
   * « unplanned » = la demande est prise mais rien n'est programmé. C'est le cas
   * qui se perd le plus facilement : personne ne rappelle la famille, et la
   * séance n'a même pas de date à partir de laquelle on pourrait la dire en
   * retard. D'où une alerte à part.
   */
  const timingOf = (s: PrivateSession): "unplanned" | "soon" | "late" | "future" | "closed" => {
    if (s.status === "requested") return "unplanned";
    if (s.status !== "planned") return "closed";
    if (!s.scheduledAt) return "unplanned";
    const t = new Date(s.scheduledAt).getTime();
    if (t < nowMs) return "late";
    if (t - nowMs <= 24 * 3600 * 1000) return "soon";
    return "future";
  };

  const sorted = useMemo(
    () =>
      [...privateSessions].sort((a, b) =>
        (b.scheduledAt ?? b.requestDate ?? "").localeCompare(a.scheduledAt ?? a.requestDate ?? ""),
      ),
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
        ...studentsOf(s.id).map(
          (r) => `${studentLabel(r.studentId, r.guestName)} ${r.guestPhone ?? ""}`,
        ),
        nameOf(s),
        s.guestPhone ?? "",
        s.guestPhone2 ?? "",
        s.receptionistName ?? "",
        ...modulesOf(s.id).map(
          (m) => `${moduleName(m.moduleId)} ${teacherLabel(m.teacherId, m.teacherName)}`,
        ),
      ].join(" ");
      return normalizeSearchText(haystack).includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sorted,
    search,
    statusFilter,
    moneyFilter,
    privateSessionModules,
    privateSessionStudents,
    students,
    teachers,
    modules,
  ]);

  const unplannedSessions = sorted.filter((s) => s.status === "requested");
  const lateSessions = sorted.filter((s) => timingOf(s) === "late");
  const soonSessions = sorted.filter((s) => timingOf(s) === "soon");
  const unpaidTeachers = sorted.filter((s) => s.status !== "cancelled" && teacherDueOf(s) > 0);
  const debtSessions = sorted.filter((s) => s.status !== "cancelled" && dueOf(s) > 0);

  // ===========================================================================
  // ÉTAPE 1 — le renseignement
  // ===========================================================================
  const updateStudentDraft = (uiKey: string, patch: Partial<StudentDraft>) =>
    setStudentDrafts((prev) => prev.map((d) => (d.uiKey === uiKey ? { ...d, ...patch } : d)));

  /** La cascade niveau → année → filière, par ligne d'élève. */
  const levelOptions = useMemo(() => levelOptionsOf(classes), [classes]);
  const yearOptionsFor = (level: LevelKey) => yearOptionsOf(classes, level);
  const filiereOptionsFor = (level: LevelKey, year: string) =>
    filiereOptionsOf(classes, level, year, filiereLabelOf);
  const matchedClassOf = (d: StudentDraft) =>
    matchedClassesOf(classes, d.level, d.year, d.filiereId)[0];

  /** Sélectionner un élève inscrit : sa scolarité est déjà connue, la retaper
   *  serait du travail inutile — et une occasion de se tromper. */
  const chooseStudentForDraft = (uiKey: string, stu: Student) => {
    const firstSub = stu.subscriptionIds[0];
    const cls = (() => {
      if (!firstSub) return undefined;
      // On remonte de l'inscription au créneau, puis à sa classe.
      const sub = useData.getState().subscriptions.find((x) => x.id === firstSub);
      const sess = sub
        ? useData.getState().sessions.find((x) => x.id === sub.sessionId)
        : undefined;
      return sess ? classes.find((c) => c.id === sess.classId) : undefined;
    })();
    const pos = cascadeOfClass(cls);
    updateStudentDraft(uiKey, {
      studentId: stu.id,
      guestName: "",
      guestPhone: "",
      search: `${stu.firstName} ${stu.lastName}`,
      level: pos.level,
      year: pos.year,
      filiereId: pos.filiereId,
    });
  };

  const matchesFor = (query: string) => {
    const q = normalizeSearchText(query.trim());
    if (!q) return [];
    return students
      .filter((s) =>
        normalizeSearchText(`${s.firstName} ${s.lastName} ${s.phone} ${s.rfid ?? ""}`).includes(q),
      )
      .slice(0, 8);
  };

  /** Les comptes qui peuvent figurer comme réceptionniste. Un administrateur
   *  peut désigner un travailleur ; un compte de réception ne peut désigner que
   *  lui-même — il ne met pas le travail d'un collègue sur le dos d'un autre. */
  const receptionistOptions = useMemo(() => {
    const own = sessionUser
      ? [{ id: sessionUser.id, name: `${sessionUser.name} (moi)` }]
      : [];
    if (sessionUser?.role !== "admin") return own;
    return [
      ...own,
      ...reception.map((w) => ({ id: w.id, name: `${w.firstName} ${w.lastName}` })),
    ];
  }, [reception, sessionUser]);

  const receptionistNameOf = (id: string) =>
    receptionistOptions.find((o) => o.id === id)?.name.replace(" (moi)", "") ??
    sessionUser?.name ??
    "";

  const resetRequest = () => {
    setEditingId(null);
    setStudentDrafts([emptyStudentDraft()]);
    setRequestDate(todayIso());
    setReceptionistId(sessionUser?.id ?? "");
    setObservation("");
    setDepositAmount(0);
  };

  const openRequest = () => {
    resetRequest();
    setIsRequestOpen(true);
  };

  /** Modifier le dossier de demande d'une séance existante. */
  const openRequestEdit = (s: PrivateSession) => {
    setEditingId(s.id);
    const rows = studentsOf(s.id);
    setStudentDrafts(
      (rows.length > 0 ? rows : []).map((r) => {
        const cls = r.classId ? classes.find((c) => c.id === r.classId) : undefined;
        const pos = cascadeOfClass(cls);
        return {
          uiKey: r.id,
          rowId: r.id,
          studentId: r.studentId ?? "",
          guestName: r.guestName ?? "",
          guestPhone: r.guestPhone ?? "",
          guestPhone2: "",
          level: pos.level,
          year: r.year || pos.year,
          filiereId: r.filiereId || pos.filiereId,
          search: r.studentId ? studentLabel(r.studentId) : "",
        };
      }),
    );
    if (rows.length === 0) setStudentDrafts([emptyStudentDraft()]);
    setRequestDate(s.requestDate ?? todayIso());
    setReceptionistId(s.receptionistId ?? sessionUser?.id ?? "");
    setObservation(s.observation ?? s.notes ?? "");
    setDepositAmount(s.depositAmount ?? 0);
    setDetailsId(null);
    setIsRequestOpen(true);
  };

  const handleSaveRequest = async () => {
    const filled = studentDrafts.filter((d) => d.studentId || d.guestName.trim());
    if (filled.length === 0) {
      alert("Indiquez au moins un élève : choisissez-le dans la base, ou saisissez son nom.");
      return;
    }
    for (const d of filled) {
      if (!d.studentId && !d.guestPhone.trim()) {
        alert(
          `Le téléphone de « ${d.guestName.trim()} » est obligatoire : c'est la seule façon de le rappeler.`,
        );
        return;
      }
    }

    const payload = {
      requestDate,
      receptionistId: receptionistId || undefined,
      receptionistName: receptionistNameOf(receptionistId),
      observation: observation.trim(),
      notes: observation.trim(),
      depositAmount: Math.max(0, Math.round(depositAmount || 0)),
      students: filled.map((d) => {
        const cls = matchedClassOf(d);
        return {
          studentId: d.studentId || undefined,
          guestName: d.studentId ? undefined : d.guestName.trim(),
          guestPhone: d.studentId ? undefined : d.guestPhone.trim() || undefined,
          guestPhone2: d.studentId ? undefined : d.guestPhone2.trim() || undefined,
          classId: cls?.id,
          year: d.year || undefined,
          filiereId: d.filiereId && d.filiereId !== "none" ? d.filiereId : undefined,
        };
      }),
    };

    setSavingRequest(true);
    try {
      const res = editingId
        ? await updatePrivateRequest(editingId, payload)
        : await createPrivateRequest(payload);
      if (!res.ok) {
        alert(
          "L'enregistrement a échoué. Si le message parle d'une fonction manquante, passez la " +
            "migration supabase/migrations/20260915_teacher_pay_matrix_particulier_workflow.sql.",
        );
        return;
      }
      setIsRequestOpen(false);
      addToast({
        type: "success",
        title: editingId ? "Dossier modifié" : "Demande enregistrée",
        message: editingId
          ? `${filled.length} élève(s) sur cette séance.`
          : `${filled.length} élève(s) — la séance reste À PROGRAMMER : elle apparaît en alerte jusqu'à ce qu'elle le soit.`,
      });
      resetRequest();
    } finally {
      setSavingRequest(false);
    }
  };

  // ===========================================================================
  // ÉTAPE 2 — la programmation
  // ===========================================================================
  const programSession = privateSessions.find((s) => s.id === programId) ?? null;

  const updateModuleDraft = (uiKey: string, patch: Partial<ModuleDraft>) =>
    setModuleDrafts((prev) => prev.map((d) => (d.uiKey === uiKey ? { ...d, ...patch } : d)));

  const openProgram = (s: PrivateSession) => {
    setProgramId(s.id);
    const existing = modulesOf(s.id);
    const fallbackDate = (s.scheduledAt ?? s.requestDate ?? todayIso()).slice(0, 10);
    setModuleDrafts(
      existing.length > 0
        ? existing.map((m) => {
            const when = m.scheduledAt ? new Date(m.scheduledAt) : null;
            return {
              uiKey: m.id,
              moduleId: m.moduleId,
              teacherId: m.teacherId ?? "",
              teacherName: m.teacherName ?? "",
              teacherPhone: m.teacherPhone ?? "",
              date: when
                ? `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`
                : fallbackDate,
              time: when
                ? `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`
                : "15:00",
              hours: Math.floor(m.minutes / 60),
              minutes: m.minutes % 60,
              flatPrice: m.flatPrice ?? 0,
              hourlyPrice: m.hourlyPrice,
              teacherPercentage: m.teacherPercentage,
              search: m.teacherId ? teacherLabel(m.teacherId) : "",
            };
          })
        : [emptyModuleDraft(fallbackDate)],
    );
    setDetailsId(null);
  };

  const programTotal = moduleDrafts.reduce((sum, d) => sum + priceOf(d), 0);
  const programMinutes = moduleDrafts.reduce((sum, d) => sum + minutesOf(d), 0);

  const handleProgram = async () => {
    if (!programId) return;
    const filled = moduleDrafts.filter((d) => d.moduleId);
    if (filled.length === 0) {
      alert("Ajoutez au moins un module à cette séance.");
      return;
    }
    for (const d of filled) {
      if (!toIso(d.date, d.time)) {
        alert(`Indiquez la date et l'heure de « ${moduleName(d.moduleId)} ».`);
        return;
      }
      if (priceOf(d) <= 0) {
        alert(
          `Indiquez le prix de « ${moduleName(d.moduleId)} » : un forfait, ou une durée et un tarif horaire.`,
        );
        return;
      }
    }

    setSavingProgram(true);
    try {
      const res = await programPrivateSession(programId, {
        modules: filled.map((d) => ({
          moduleId: d.moduleId,
          teacherId: d.teacherId || undefined,
          teacherName: d.teacherId ? undefined : d.teacherName.trim() || undefined,
          teacherPhone: d.teacherId ? undefined : d.teacherPhone.trim() || undefined,
          scheduledAt: toIso(d.date, d.time) ?? undefined,
          minutes: minutesOf(d),
          hourlyPrice: Math.max(0, Math.round(d.hourlyPrice || 0)),
          flatPrice: Math.max(0, Math.round(d.flatPrice || 0)),
          teacherPercentage: d.teacherPercentage,
        })),
      });
      if (!res.ok) {
        alert(
          res.messageKey === "particulier.noDate"
            ? "Indiquez la date d'au moins un module."
            : "La programmation a échoué. Si le message parle d'une fonction manquante, passez la " +
              "migration supabase/migrations/20260915_teacher_pay_matrix_particulier_workflow.sql.",
        );
        return;
      }
      setProgramId(null);
      addToast({
        type: "success",
        title: "Séance programmée",
        message: `${filled.length} module(s) · ${res.total ?? programTotal} DA · ${fmtDateTime(res.scheduledAt)}.`,
      });
    } finally {
      setSavingProgram(false);
    }
  };

  // ===========================================================================
  // ÉTAPE 3 — la conclusion
  // ===========================================================================
  const completeSession = privateSessions.find((s) => s.id === completeId) ?? null;
  const completeStudents = completeSession ? studentsOf(completeSession.id) : [];

  const openComplete = (s: PrivateSession) => {
    setCompleteId(s.id);
    setCompleteTotal(s.totalPrice);
    setPctMode("teacher");
    // Le taux de départ : celui du premier enseignant fiché de la séance, à
    // défaut 50 %. C'est ce que le guichet allait taper de toute façon.
    const mods = modulesOf(s.id);
    setPctValue(mods[0]?.teacherPercentage || 50);
    setCashNow(Math.max(0, s.totalPrice - s.paidAmount));
    setPayTeachersNow(true);
    const rows = studentsOf(s.id);
    const share = rows.length > 0 ? Math.round(s.totalPrice / rows.length) : 0;
    setStudentAmounts(
      Object.fromEntries(
        rows.map((r) => [
          r.id,
          { due: r.totalPrice > 0 ? r.totalPrice : share, paid: r.paidAmount },
        ]),
      ),
    );
    setDetailsId(null);
  };

  /** Les deux parts, calculées comme la base les calcule : la part de
   *  l'enseignant module par module, et l'école prend CE QUI RESTE — jamais un
   *  second pourcentage, dont l'arrondi ne referait pas le total. */
  const completeSplit = useMemo(() => {
    if (!completeSession) {
      return { teacherPct: 0, schoolPct: 0, teacherShare: 0, schoolShare: 0 };
    }
    const teacherPct =
      pctMode === "school"
        ? Math.max(0, 100 - Math.min(Math.max(pctValue, 0), 100))
        : Math.min(Math.max(pctValue, 0), 100);
    const mods = modulesOf(completeSession.id);
    // Les modules déjà réglés gardent leur montant : cet argent est sorti.
    const teacherShare = mods.reduce(
      (sum, m) =>
        sum +
        (m.teacherPaid ? m.teacherAmount : Math.round((m.totalPrice * teacherPct) / 100)),
      0,
    );
    const total = Math.max(0, Math.round(completeTotal || 0));
    return {
      teacherPct,
      schoolPct: 100 - teacherPct,
      teacherShare,
      schoolShare: Math.max(0, total - teacherShare),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completeSession, completeTotal, pctMode, pctValue, privateSessionModules]);

  const studentAmountsTotal = Object.values(studentAmounts).reduce((s, v) => s + (v.due || 0), 0);

  /** Imprimer la facture d'une séance conclue. On la construit à partir de ce
   *  que la BASE porte, jamais de l'écran : réimprimer six mois plus tard doit
   *  donner exactement le même papier. */
  const printInvoice = (s: PrivateSession) => {
    printHtmlDocument(
      buildPrivateSessionInvoice({
        school,
        lang: language,
        session: s,
        students: studentsOf(s.id).map((r) => {
          const stu = r.studentId ? students.find((x) => x.id === r.studentId) : undefined;
          return {
            row: r,
            name: studentLabel(r.studentId, r.guestName),
            phone: stu?.phone ?? r.guestPhone ?? "",
            schooling: schoolingOf(r.classId, r.year, r.filiereId),
            isRegistered: !!r.studentId,
          };
        }),
        modules: modulesOf(s.id).map((m) => ({
          row: m,
          moduleName: moduleName(m.moduleId),
          teacherName: teacherLabel(m.teacherId, m.teacherName),
        })),
      }),
    );
  };

  const handleComplete = async () => {
    if (!completeId || !completeSession) return;
    const total = Math.max(0, Math.round(completeTotal || 0));
    if (total <= 0) {
      alert("Le total de la séance doit être supérieur à 0 DA.");
      return;
    }
    if (completeStudents.length > 1 && studentAmountsTotal !== total) {
      if (
        !confirm(
          `Les parts des élèves totalisent ${studentAmountsTotal} DA, et la séance ${total} DA.\n\n` +
            "Enregistrer quand même ? La dette de la séance suivra le total, pas la somme des parts.",
        )
      ) {
        return;
      }
    }

    setSavingComplete(true);
    try {
      const res = await completePrivateSession(completeId, {
        totalPrice: total,
        percentageMode: pctMode,
        percentage: Math.min(Math.max(pctValue, 0), 100),
        cashNow: Math.max(0, Math.round(cashNow || 0)),
        teacherPaid: payTeachersNow,
        students: completeStudents.map((r) => ({
          id: r.id,
          totalPrice: studentAmounts[r.id]?.due ?? r.totalPrice,
          paidAmount: studentAmounts[r.id]?.paid ?? r.paidAmount,
        })),
      });
      if (!res.ok) {
        alert(
          "La conclusion a échoué. Si le message parle d'une fonction manquante, passez la " +
            "migration supabase/migrations/20260915_teacher_pay_matrix_particulier_workflow.sql.",
        );
        return;
      }
      setCompleteId(null);
      addToast({
        type: "success",
        title: "Séance terminée",
        message: canSeeGains
          ? `Total ${res.total} DA — école ${res.schoolShare} DA, enseignants ${res.teacherShare} DA. ` +
            ((res.teachersPaid ?? 0) > 0
              ? `${res.teachersPaid} enseignant(s) réglé(s).`
              : "Les enseignants restent à régler.")
          : `Total ${res.total} DA. La séance est close.`,
      });

      // La facture, tout de suite : c'est le moment où la famille est au
      // guichet, et le seul où elle peut signer ce qu'elle vient de payer.
      // On relit la séance depuis la base (la RPC vient de la réécrire), sans
      // quoi la facture porterait l'ancien total.
      const fresh = useData.getState().privateSessions.find((x) => x.id === completeId);
      if (fresh && confirm("Séance enregistrée. Imprimer la facture ?")) {
        printInvoice(fresh);
      }
    } finally {
      setSavingComplete(false);
    }
  };

  // ===========================================================================
  // Créations rapides
  // ===========================================================================
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
      if (studentForDraft) chooseStudentForDraft(studentForDraft, newStudent);
      setIsStudentFormOpen(false);
      setStudentForDraft(null);
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
          alert(
            "Un enseignant de l'école a besoin d'un email et d'un mot de passe (6 caractères min.).",
          );
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
        updateModuleDraft(teacherForDraft, {
          teacherId: newId,
          teacherName: "",
          teacherPhone: "",
          teacherPercentage: ntPercentage,
          search: `${ntFirstName} ${ntLastName}`.trim(),
        });
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
    if (moduleForDraft) updateModuleDraft(moduleForDraft, { moduleId: id });
    setNewModuleName("");
    setModuleForDraft(null);
  };

  // ===========================================================================
  // Actions sur une séance
  // ===========================================================================
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
          ? "Cet enseignant n'a pas de fiche : créez-la depuis l'écran Enseignants pour pouvoir " +
              "le régler et garder une trace dans son historique."
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
    if (!res.ok) {
      alert(
        res.messageKey === "particulier.noDate"
          ? "Cette séance n'a pas encore de date : programmez-la d'abord."
          : "Le changement d'état a échoué.",
      );
    }
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

  const detailsSession = privateSessions.find((s) => s.id === detailsId) ?? null;
  const paySession = privateSessions.find((s) => s.id === payId) ?? null;

  /** Les enseignants proposés dans une ligne de module. */
  const teacherMatchesFor = (query: string) => {
    const q = normalizeSearchText(query.trim());
    if (!q) return [];
    return teachers
      .filter((t) =>
        normalizeSearchText(`${t.firstName} ${t.lastName} ${t.phone} ${t.description ?? ""}`).includes(q),
      )
      .slice(0, 8);
  };

  // ===========================================================================
  return (
    <div>
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <PageHeader
          emoji="🎓"
          title="Particulier"
          subtitle="Cours particuliers : la demande, la programmation, puis la séance tenue"
        />
        <Button onClick={openRequest} className="flex items-center gap-2">
          <Plus className="h-4 w-4" /> Nouvelle demande
        </Button>
      </div>

      {/* ---- ALERTES ------------------------------------------------------ */}
      {/* Une demande NON PROGRAMMÉE passe avant tout le reste : elle n'a même
          pas de date à partir de laquelle on pourrait la dire en retard, donc
          rien ne la rappellerait jamais. C'est ainsi qu'une famille attend un
          coup de fil qui ne vient pas. */}
      {unplannedSessions.length > 0 && (
        <div className="mb-4 animate-pulse rounded-2xl border-2 border-warning/60 bg-warning/10 p-4">
          <div className="flex items-start gap-3">
            <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <strong className="block text-sm text-warning">
                {unplannedSessions.length} séance(s) particulière(s) à PROGRAMMER
              </strong>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                La demande est prise, mais aucune date n&apos;est posée : ni l&apos;élève ni
                l&apos;enseignant ne savent quand la séance a lieu. Cliquez pour voir la demande et
                la programmer.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {unplannedSessions.slice(0, 12).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setDetailsId(s.id)}
                    className="rounded-lg border border-warning/30 bg-warning/15 px-2.5 py-1 text-[10px] font-bold text-warning transition-colors hover:bg-warning/25"
                  >
                    {nameOf(s)}
                    {s.requestDate && ` · demandé le ${formatDateFr(s.requestDate)}`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

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
                Concluez-les si elles ont eu lieu, <strong>annulez-les</strong> sinon, ou{" "}
                <strong>reportez-les</strong>. Tant qu&apos;elles restent ainsi, leur argent
                n&apos;est réclamé à personne.
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

      {canSeeGains && unpaidTeachers.length > 0 && (
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
            placeholder="Rechercher par élève, enseignant, module, réceptionniste ou téléphone..."
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { key: "all" as const, label: `Toutes (${sorted.length})` },
              { key: "requested" as const, label: `À programmer (${unplannedSessions.length})` },
              {
                key: "planned" as const,
                label: `Programmées (${sorted.filter((s) => s.status === "planned").length})`,
              },
              {
                key: "done" as const,
                label: `Terminées (${sorted.filter((s) => s.status === "done").length})`,
              },
              {
                key: "cancelled" as const,
                label: `Annulées (${sorted.filter((s) => s.status === "cancelled").length})`,
              },
            ]
          ).map((k) => (
            <button
              key={k.key}
              onClick={() => setStatusFilter(k.key)}
              className={`rounded-lg px-3 py-1.5 text-[10px] font-bold transition-all ${
                statusFilter === k.key
                  ? "bg-primary text-white shadow-sm"
                  : "bg-canvas text-muted hover:text-ink"
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
              ...(canSeeGains
                ? [{ key: "teacherDue" as const, label: `Prof à payer (${unpaidTeachers.length})` }]
                : []),
            ]
          ).map((k) => (
            <button
              key={k.key}
              onClick={() => setMoneyFilter(k.key)}
              className={`rounded-lg px-3 py-1.5 text-[10px] font-bold transition-all ${
                moneyFilter === k.key
                  ? "bg-warning text-white shadow-sm"
                  : "bg-canvas text-muted hover:text-ink"
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
            const rows = studentsOf(s.id);
            const due = dueOf(s);
            const tDue = teacherDueOf(s);
            const timing = timingOf(s);
            return (
              <Card
                key={s.id}
                className={`border transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg ${
                  timing === "unplanned"
                    ? "border-warning/50"
                    : timing === "late"
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
                          {rows.length > 1 && (
                            <Badge tone="primary" className="px-1.5 py-0 text-[9px]">
                              {rows.length} élèves
                            </Badge>
                          )}
                          {rows.every((r) => r.studentId) && rows.length > 0 ? (
                            <Badge tone="primary" className="px-1.5 py-0 text-[9px]">
                              Élève(s) inscrit(s)
                            </Badge>
                          ) : (
                            <Badge tone="neutral" className="px-1.5 py-0 text-[9px]">
                              De passage
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Quand — ou « pas encore programmée » */}
                    <div
                      className={`mb-2.5 flex items-center gap-2 rounded-xl border px-2.5 py-2 text-[10px] font-bold ${
                        timing === "unplanned"
                          ? "animate-pulse border-warning/40 bg-warning/10 text-warning"
                          : timing === "late"
                            ? "animate-pulse border-danger/30 bg-danger/10 text-danger"
                            : timing === "soon"
                              ? "border-warning/30 bg-warning/10 text-warning"
                              : "border-line bg-canvas/30 text-ink"
                      }`}
                    >
                      {timing === "unplanned" ? (
                        <>
                          <ClipboardList className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            Pas encore programmée
                            {s.requestDate && ` · demandé le ${formatDateFr(s.requestDate)}`}
                          </span>
                        </>
                      ) : (
                        <>
                          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                          <span>{fmtDateTime(s.scheduledAt)}</span>
                          {timing === "late" && <span className="ms-auto">en retard</span>}
                          {timing === "soon" && <span className="ms-auto">bientôt</span>}
                        </>
                      )}
                    </div>

                    {/* Le dossier de demande */}
                    {(s.receptionistName || s.observation) && (
                      <div className="mb-2.5 space-y-0.5 rounded-xl border border-line/60 bg-canvas/20 px-2.5 py-2 text-[10px] text-muted">
                        {s.receptionistName && (
                          <div>
                            Reçu par <strong className="text-ink">{s.receptionistName}</strong>
                          </div>
                        )}
                        {s.observation && <div className="line-clamp-2">{s.observation}</div>}
                      </div>
                    )}

                    {/* Modules */}
                    {mods.length > 0 ? (
                      <div className="mb-2.5 space-y-1">
                        {mods.slice(0, 3).map((m) => (
                          <div
                            key={m.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-line/60 bg-canvas/20 px-2 py-1.5 text-[10px]"
                          >
                            <span className="min-w-0 truncate">
                              <strong className="text-ink">{moduleName(m.moduleId)}</strong>
                              <span className="text-muted">
                                {" "}
                                · {teacherLabel(m.teacherId, m.teacherName)}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-1">
                              <span className="font-mono text-muted">{fmtDuration(m.minutes)}</span>
                              {canSeeGains && (
                                <Badge
                                  tone={m.teacherPaid ? "success" : "warning"}
                                  className="text-[9px] font-bold"
                                >
                                  {m.teacherPaid ? "prof payé" : `${m.teacherAmount} DA`}
                                </Badge>
                              )}
                            </span>
                          </div>
                        ))}
                        {mods.length > 3 && (
                          <span className="block text-[10px] text-muted">
                            + {mods.length - 3} autre(s) module(s)
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="mb-2.5 rounded-lg border border-dashed border-line px-2.5 py-2 text-[10px] italic text-muted">
                        Aucun module — la séance n&apos;est pas encore programmée.
                      </p>
                    )}

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

                  {/* Actions — celles que l'ÉTAT de la séance autorise */}
                  <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line/60 pt-3">
                    <button
                      onClick={() => setDetailsId(s.id)}
                      className="flex items-center gap-1 rounded-lg border border-line bg-canvas px-2 py-1.5 text-[10px] font-bold text-ink transition-colors hover:bg-primary-50"
                    >
                      <Eye className="h-3 w-3" /> Détails
                    </button>

                    {s.status === "requested" && (
                      <button
                        onClick={() => openProgram(s)}
                        className="flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/15 px-2 py-1.5 text-[10px] font-bold text-primary transition-colors hover:bg-primary/25"
                      >
                        <CalendarDays className="h-3 w-3" /> Programmer
                      </button>
                    )}

                    {s.status === "planned" && (
                      <>
                        <button
                          onClick={() => openComplete(s)}
                          className="flex items-center gap-1 rounded-lg border border-success/40 bg-success/15 px-2 py-1.5 text-[10px] font-bold text-success transition-colors hover:bg-success/25"
                        >
                          <CheckCircle className="h-3 w-3" /> Compléter la séance
                        </button>
                        <button
                          onClick={() => {
                            setRescheduleId(s.id);
                            const d = new Date(s.scheduledAt ?? Date.now());
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
                          onClick={() => openProgram(s)}
                          className="flex items-center gap-1 rounded-lg border border-line bg-canvas px-2 py-1.5 text-[10px] font-bold text-ink transition-colors hover:bg-primary-50"
                        >
                          <Edit className="h-3 w-3" /> Modules
                        </button>
                      </>
                    )}

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

                    {s.status === "done" && (
                      <button
                        onClick={() => printInvoice(s)}
                        className="flex items-center gap-1 rounded-lg border border-line bg-canvas px-2 py-1.5 text-[10px] font-bold text-ink transition-colors hover:bg-primary-50"
                      >
                        <Printer className="h-3 w-3" /> Facture
                      </button>
                    )}

                    <button
                      onClick={() => openRequestEdit(s)}
                      className="flex items-center gap-1 rounded-lg border border-line bg-canvas px-2 py-1.5 text-[10px] font-bold text-ink transition-colors hover:bg-primary-50"
                    >
                      <Edit className="h-3 w-3" /> Dossier
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
      {/* ÉTAPE 1 — RENSEIGNEMENT                                             */}
      {/*                                                                     */}
      {/* Quelqu'un demande un cours particulier. On note QUI (un ou           */}
      {/* plusieurs élèves), QUAND il a demandé, QUI l'a reçu, ce qu'il veut,  */}
      {/* et le versement pris au passage. Rien n'est encore programmé — et    */}
      {/* c'est justement ce que l'alerte doit crier.                          */}
      {/* ================================================================== */}
      <Modal
        open={isRequestOpen}
        onClose={() => setIsRequestOpen(false)}
        title={editingId ? "Modifier le dossier" : "Nouvelle demande — Renseignement"}
        subtitle="Qui demande, quand, reçu par qui. La programmation vient après."
        size="xl"
      >
        <div className="space-y-5">
          {/* ---- Les élèves ---- */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
                <Users className="h-4 w-4 text-primary" />
                Élève(s) — {studentDrafts.length}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setStudentDrafts((prev) => [...prev, emptyStudentDraft()])}
              >
                <Plus className="h-3.5 w-3.5" /> Ajouter un élève
              </Button>
            </div>
            <p className="text-[10px] leading-relaxed text-muted">
              Plusieurs élèves peuvent partager la même séance. Chacun garde sa scolarité, et à la
              conclusion chacun aura <strong>sa part</strong> — c&apos;est ce qui permet de dire qui
              a payé quoi.
            </p>

            {studentDrafts.map((d, i) => {
              const picked = d.studentId ? students.find((x) => x.id === d.studentId) : undefined;
              const matches = d.studentId ? [] : matchesFor(d.search);
              return (
                <div key={d.uiKey} className="rounded-2xl border border-line bg-canvas/30 p-3.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <strong className="text-xs text-ink">Élève {i + 1}</strong>
                    {studentDrafts.length > 1 && (
                      <button
                        onClick={() =>
                          setStudentDrafts((prev) => prev.filter((x) => x.uiKey !== d.uiKey))
                        }
                        className="flex h-6 w-6 items-center justify-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger"
                        title="Retirer cet élève"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {/* Qui */}
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-muted">
                        Nom complet — cherchez un élève inscrit, ou saisissez-le
                      </label>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                        <Input
                          value={picked ? `${picked.firstName} ${picked.lastName}` : d.search}
                          onChange={(e) =>
                            updateStudentDraft(d.uiKey, {
                              search: e.target.value,
                              guestName: e.target.value,
                              studentId: "",
                            })
                          }
                          placeholder="Nom, prénom, téléphone ou carte RFID..."
                          className="pl-9"
                        />
                      </div>

                      {matches.length > 0 && (
                        <div className="mt-1.5 max-h-36 space-y-1 overflow-y-auto rounded-xl border border-line bg-surface p-1.5">
                          {matches.map((st) => (
                            <button
                              key={st.id}
                              type="button"
                              onClick={() => chooseStudentForDraft(d.uiKey, st)}
                              className="w-full rounded-lg p-2 text-start text-xs text-ink transition-colors hover:bg-primary-50"
                            >
                              <span className="block truncate font-semibold">
                                {st.firstName} {st.lastName}
                              </span>
                              <span className="block font-mono text-[9px] text-muted">
                                🎫 {st.rfid || "sans carte"} · 📞 {st.phone || "—"} · Solde{" "}
                                {st.balance} DA
                              </span>
                            </button>
                          ))}
                        </div>
                      )}

                      {picked ? (
                        <p className="mt-1.5 rounded-xl border border-primary/25 bg-primary-50/50 p-2 text-[10px] text-muted">
                          <strong className="text-ink">Élève inscrit</strong> · 📞{" "}
                          {picked.phone || "—"} · Solde {picked.balance} DA — sa scolarité est
                          pré-remplie ci-contre.
                        </p>
                      ) : (
                        <>
                          <label className="mb-1 mt-2 block text-[10px] font-semibold text-muted">
                            Téléphone *
                          </label>
                          <Input
                            value={d.guestPhone}
                            onChange={(e) =>
                              updateStudentDraft(d.uiKey, { guestPhone: e.target.value })
                            }
                            placeholder="+213 5XX XX XX XX"
                            className="font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setStudentForDraft(d.uiKey);
                              setIsStudentFormOpen(true);
                            }}
                            className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-primary hover:underline"
                          >
                            <UserPlus className="h-3 w-3" /> Créer sa fiche élève complète
                          </button>
                        </>
                      )}
                    </div>

                    {/* Sa scolarité */}
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-muted">
                        Scolarité <span className="font-normal">(facultatif)</span>
                      </label>
                      <div className="grid grid-cols-3 gap-1.5">
                        <Select
                          className="w-full"
                          value={d.level}
                          onChange={(e) =>
                            updateStudentDraft(d.uiKey, {
                              level: e.target.value as LevelKey,
                              year: "",
                              filiereId: "",
                            })
                          }
                        >
                          <option value="">Classe</option>
                          {levelOptions.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                        <Select
                          className="w-full"
                          value={d.year}
                          disabled={!d.level}
                          onChange={(e) =>
                            updateStudentDraft(d.uiKey, { year: e.target.value, filiereId: "" })
                          }
                        >
                          <option value="">Année</option>
                          {yearOptionsFor(d.level).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                        <Select
                          className="w-full"
                          value={d.filiereId}
                          disabled={!d.year || d.level === "formation"}
                          onChange={(e) =>
                            updateStudentDraft(d.uiKey, { filiereId: e.target.value })
                          }
                        >
                          <option value="">Filière</option>
                          {filiereOptionsFor(d.level, d.year).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                      {matchedClassOf(d) && (
                        <p className="mt-1.5 text-[10px] text-muted">
                          <strong className="text-ink">
                            {classCascadeLabel(
                              matchedClassOf(d)!,
                              filiereLabelOf(matchedClassOf(d)!.filiereId ?? ""),
                            )}
                          </strong>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ---- Le dossier ---- */}
          <div className="grid grid-cols-1 gap-3 rounded-2xl border border-line bg-canvas/30 p-3.5 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-[10px] font-semibold text-muted">
                Date de demande *
              </label>
              <Input
                type="date"
                value={requestDate}
                onChange={(e) => setRequestDate(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold text-muted">
                Reçu par (réceptionniste)
              </label>
              <Select
                className="w-full"
                value={receptionistId}
                disabled={sessionUser?.role !== "admin"}
                onChange={(e) => setReceptionistId(e.target.value)}
              >
                <option value="">— {sessionUser?.name ?? "compte courant"} —</option>
                {receptionistOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-[10px] leading-relaxed text-muted">
                {sessionUser?.role === "admin"
                  ? "Vous êtes administrateur : vous pouvez désigner le travailleur qui a réellement reçu la demande."
                  : "Votre compte est enregistré comme réceptionniste de cette demande."}
              </p>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-[10px] font-semibold text-muted">
                Observation <span className="font-normal">(facultatif)</span>
              </label>
              <Input
                value={observation}
                onChange={(e) => setObservation(e.target.value)}
                placeholder="Ce que la famille demande, ses contraintes d'horaire..."
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-[10px] font-semibold text-muted">
                Chargement de solde — versement à la demande{" "}
                <span className="font-normal">(facultatif)</span>
              </label>
              <Input
                type="number"
                min={0}
                value={depositAmount || ""}
                disabled={!!editingId}
                onChange={(e) => setDepositAmount(Number(e.target.value))}
                placeholder="0"
              />
              <p className="mt-1 text-[10px] leading-relaxed text-muted">
                {editingId
                  ? "Le versement déjà encaissé ne se modifie pas ici : on ne réécrit pas une recette. Utilisez « Encaisser » sur la carte."
                  : "Cet argent entre en caisse tout de suite — il est réellement reçu, même si la séance n'est pas encore programmée. Il sera déduit du total à la conclusion."}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
            <span className="text-[10px] text-muted">
              {editingId
                ? "Le dossier est modifié ; la programmation n'est pas touchée."
                : "La séance sera créée « À PROGRAMMER » et apparaîtra en alerte jusqu'à ce qu'elle ait une date."}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsRequestOpen(false)}>
                Annuler
              </Button>
              <Button onClick={handleSaveRequest} disabled={savingRequest}>
                {savingRequest
                  ? "Enregistrement..."
                  : editingId
                    ? "Enregistrer le dossier"
                    : "Créer la demande"}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ================================================================== */}
      {/* ÉTAPE 2 — PROGRAMMATION                                             */}
      {/*                                                                     */}
      {/* Les modules, chacun à SON heure, avec SON prix et SON enseignant.    */}
      {/* Un module peut être facturé au forfait (« la séance, 2 500 ») ou à   */}
      {/* l'heure — le guichet annonce souvent un prix rond que le calcul      */}
      {/* horaire ne sait pas reproduire.                                      */}
      {/* ================================================================== */}
      <Modal
        open={programSession !== null}
        onClose={() => setProgramId(null)}
        title="Programmer la séance"
        subtitle={
          programSession
            ? `${nameOf(programSession)} — modules, dates, prix et enseignants.`
            : undefined
        }
        size="xl"
      >
        {programSession && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-canvas/40 p-3.5 text-xs">
              <div className="min-w-0">
                <strong className="block text-sm text-ink">{nameOf(programSession)}</strong>
                <span className="block text-[10px] text-muted">
                  {studentsOf(programSession.id).length} élève(s)
                  {programSession.requestDate &&
                    ` · demandé le ${formatDateFr(programSession.requestDate)}`}
                  {programSession.receptionistName && ` · reçu par ${programSession.receptionistName}`}
                </span>
              </div>
              {(programSession.depositAmount ?? 0) > 0 && (
                <Badge tone="success" className="font-mono font-bold">
                  {programSession.depositAmount} DA déjà versés
                </Badge>
              )}
            </div>

            {programSession.observation && (
              <p className="rounded-xl border border-line bg-canvas/30 p-3 text-[11px] text-muted">
                <strong className="text-ink">Ce que la famille demande :</strong>{" "}
                {programSession.observation}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted">
                Modules — {moduleDrafts.length}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setModuleDrafts((prev) => [
                    ...prev,
                    emptyModuleDraft(
                      prev[prev.length - 1]?.date ??
                        (programSession.requestDate ?? todayIso()).slice(0, 10),
                    ),
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5" /> Ajouter un module
              </Button>
            </div>

            <div className="space-y-3">
              {moduleDrafts.map((d, i) => {
                const pickedTeacher = d.teacherId
                  ? teachers.find((t) => t.id === d.teacherId)
                  : undefined;
                const tMatches = d.teacherId ? [] : teacherMatchesFor(d.search);
                return (
                  <div key={d.uiKey} className="rounded-2xl border border-line bg-canvas/30 p-3.5">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <strong className="text-xs text-ink">Module {i + 1}</strong>
                      <span className="flex items-center gap-2">
                        <Badge tone="primary" className="font-mono text-[10px] font-bold">
                          {priceOf(d)} DA
                        </Badge>
                        {moduleDrafts.length > 1 && (
                          <button
                            onClick={() =>
                              setModuleDrafts((prev) => prev.filter((x) => x.uiKey !== d.uiKey))
                            }
                            className="flex h-6 w-6 items-center justify-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger"
                            title="Retirer ce module"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {/* Le module, sa date, sa durée, son prix */}
                      <div className="space-y-2">
                        <div>
                          <label className="mb-1 block text-[10px] font-semibold text-muted">
                            Matière *
                          </label>
                          <Select
                            className="w-full"
                            value={d.moduleId}
                            onChange={(e) => updateModuleDraft(d.uiKey, { moduleId: e.target.value })}
                          >
                            <option value="">— Choisir —</option>
                            {[...modules]
                              .sort((a, b) => a.name.localeCompare(b.name))
                              .map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                          </Select>
                          <button
                            type="button"
                            onClick={() => setModuleForDraft(d.uiKey)}
                            className="mt-1 flex items-center gap-1 text-[10px] font-bold text-primary hover:underline"
                          >
                            <Plus className="h-3 w-3" /> Créer une matière
                          </button>
                          {moduleForDraft === d.uiKey && (
                            <div className="mt-1.5 flex gap-1.5">
                              <Input
                                value={newModuleName}
                                onChange={(e) => setNewModuleName(e.target.value)}
                                placeholder="Nom de la matière"
                              />
                              <Button size="sm" onClick={handleCreateModule}>
                                Créer
                              </Button>
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="mb-1 block text-[10px] font-semibold text-muted">
                              Date *
                            </label>
                            <Input
                              type="date"
                              value={d.date}
                              onChange={(e) => updateModuleDraft(d.uiKey, { date: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-semibold text-muted">
                              Heure *
                            </label>
                            <Input
                              type="time"
                              value={d.time}
                              onChange={(e) => updateModuleDraft(d.uiKey, { time: e.target.value })}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="mb-1 block text-[10px] font-semibold text-muted">
                              Durée — heures
                            </label>
                            <Input
                              type="number"
                              min={0}
                              value={d.hours}
                              onChange={(e) =>
                                updateModuleDraft(d.uiKey, { hours: Number(e.target.value) })
                              }
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-semibold text-muted">
                              Durée — minutes
                            </label>
                            <Input
                              type="number"
                              min={0}
                              max={59}
                              value={d.minutes}
                              onChange={(e) =>
                                updateModuleDraft(d.uiKey, { minutes: Number(e.target.value) })
                              }
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="mb-1 block text-[10px] font-semibold text-muted">
                              Prix forfaitaire (DA)
                            </label>
                            <Input
                              type="number"
                              min={0}
                              value={d.flatPrice || ""}
                              onChange={(e) =>
                                updateModuleDraft(d.uiKey, { flatPrice: Number(e.target.value) })
                              }
                              placeholder="Ex: 2500"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-semibold text-muted">
                              … ou tarif horaire (DA/h)
                            </label>
                            <Input
                              type="number"
                              min={0}
                              value={d.hourlyPrice || ""}
                              disabled={d.flatPrice > 0}
                              onChange={(e) =>
                                updateModuleDraft(d.uiKey, { hourlyPrice: Number(e.target.value) })
                              }
                              placeholder="Ex: 1000"
                            />
                          </div>
                        </div>
                        <p className="text-[10px] leading-relaxed text-muted">
                          {d.flatPrice > 0 ? (
                            <>
                              Forfait : <strong className="text-ink">{priceOf(d)} DA</strong> pour{" "}
                              {fmtDuration(minutesOf(d))}. Le tarif horaire est ignoré.
                            </>
                          ) : (
                            <>
                              {fmtDuration(minutesOf(d))} × {d.hourlyPrice || 0} DA/h ={" "}
                              <strong className="text-ink">{priceOf(d)} DA</strong>.
                            </>
                          )}
                        </p>
                      </div>

                      {/* Son enseignant, et sa part */}
                      <div className="space-y-2">
                        <div>
                          <label className="mb-1 block text-[10px] font-semibold text-muted">
                            Enseignant — cherchez-le, ou nommez-le
                          </label>
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                            <Input
                              value={
                                pickedTeacher
                                  ? `${pickedTeacher.firstName} ${pickedTeacher.lastName}`
                                  : d.search
                              }
                              onChange={(e) =>
                                updateModuleDraft(d.uiKey, {
                                  search: e.target.value,
                                  teacherName: e.target.value,
                                  teacherId: "",
                                })
                              }
                              placeholder="Nom de l'enseignant..."
                              className="pl-9"
                            />
                          </div>

                          {tMatches.length > 0 && (
                            <div className="mt-1.5 max-h-32 space-y-1 overflow-y-auto rounded-xl border border-line bg-surface p-1.5">
                              {tMatches.map((t) => (
                                <button
                                  key={t.id}
                                  type="button"
                                  onClick={() =>
                                    updateModuleDraft(d.uiKey, {
                                      teacherId: t.id,
                                      teacherName: "",
                                      teacherPhone: "",
                                      search: `${t.firstName} ${t.lastName}`,
                                      teacherPercentage: t.percentage ?? d.teacherPercentage,
                                    })
                                  }
                                  className="w-full rounded-lg p-2 text-start text-xs text-ink transition-colors hover:bg-primary-50"
                                >
                                  <span className="block truncate font-semibold">
                                    {t.firstName} {t.lastName}
                                    {t.isPassager && (
                                      <Badge tone="warning" className="ml-1.5 text-[8px]">
                                        Passager
                                      </Badge>
                                    )}
                                  </span>
                                  <span className="block font-mono text-[9px] text-muted">
                                    📞 {t.phone || "—"}
                                    {canSeeGains && ` · ${t.percentage ?? 0} %`}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}

                          {!pickedTeacher && (
                            <>
                              <label className="mb-1 mt-2 block text-[10px] font-semibold text-muted">
                                Son téléphone
                              </label>
                              <Input
                                value={d.teacherPhone}
                                onChange={(e) =>
                                  updateModuleDraft(d.uiKey, { teacherPhone: e.target.value })
                                }
                                placeholder="+213 5XX XX XX XX"
                                className="font-mono"
                              />
                              <p className="mt-1 rounded-xl border border-warning/25 bg-warning/5 p-2 text-[10px] leading-relaxed text-muted">
                                Un enseignant simplement <strong>nommé</strong> n&apos;a pas
                                d&apos;historique : il ne pourra pas être réglé par
                                l&apos;application. Créez sa fiche pour que son versement laisse
                                une trace.
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  setTeacherForDraft(d.uiKey);
                                  setNtFirstName(d.teacherName);
                                  setNtPhone(d.teacherPhone);
                                  setNtPercentage(d.teacherPercentage);
                                  setIsTeacherFormOpen(true);
                                }}
                                className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-primary hover:underline"
                              >
                                <UserPlus className="h-3 w-3" /> Créer sa fiche enseignant
                              </button>
                            </>
                          )}
                        </div>

                        {/* Le partage école / enseignant : direction seulement.
                            Masqué, le taux garde sa valeur — celui de la fiche
                            de l'enseignant choisi, ou celui déjà enregistré sur
                            le module qu'on modifie : rien n'est remis à zéro en
                            programmant depuis le guichet. */}
                        {canSeeGains && (
                          <div>
                            <label className="mb-1 block text-[10px] font-semibold text-muted">
                              Part de l&apos;enseignant (%)
                            </label>
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              value={d.teacherPercentage || ""}
                              onChange={(e) =>
                                updateModuleDraft(d.uiKey, {
                                  teacherPercentage: Number(e.target.value),
                                })
                              }
                            />
                            <p className="mt-1 text-[10px] text-muted">
                              {priceOf(d)} DA × {d.teacherPercentage || 0} % ={" "}
                              <strong className="text-primary">
                                {Math.round((priceOf(d) * (d.teacherPercentage || 0)) / 100)} DA
                              </strong>{" "}
                              — ajustable une dernière fois à la conclusion.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-primary/30 bg-primary-50/40 p-4">
              <span className="text-[11px] text-muted">
                {moduleDrafts.filter((d) => d.moduleId).length} module(s) ·{" "}
                {fmtDuration(programMinutes)}
              </span>
              <span className="flex items-baseline gap-2">
                <span className="text-[10px] font-bold uppercase text-muted">Total</span>
                <strong className="font-mono text-2xl font-black text-primary">
                  {programTotal} DA
                </strong>
              </span>
            </div>

            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <Button variant="outline" onClick={() => setProgramId(null)}>
                Annuler
              </Button>
              <Button onClick={handleProgram} disabled={savingProgram}>
                {savingProgram ? "Enregistrement..." : "Programmer la séance"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ================================================================== */}
      {/* ÉTAPE 3 — CONCLUSION                                                */}
      {/*                                                                     */}
      {/* L'élève a étudié et vient payer. On ajuste le total, on dit comment  */}
      {/* il se partage, ce que chaque élève verse, et si l'enseignant est     */}
      {/* réglé maintenant — sinon c'est une alerte jusqu'à ce qu'il le soit.  */}
      {/* ================================================================== */}
      <Modal
        open={completeSession !== null}
        onClose={() => setCompleteId(null)}
        title="Compléter la séance"
        subtitle={
          completeSession
            ? `${nameOf(completeSession)} — l'élève a étudié et vient payer.`
            : undefined
        }
        size="xl"
      >
        {completeSession && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            {/* ---- Gauche : les modules et les élèves ---- */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-line bg-surface p-3.5">
                <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">
                  Modules de la séance
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-line text-[10px] font-bold uppercase text-muted">
                        <th className="p-2">Module</th>
                        <th className="p-2">Date</th>
                        <th className="p-2">Enseignant</th>
                        <th className="p-2 text-right">Prix</th>
                        {canSeeGains && <th className="p-2 text-right">Part prof</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {modulesOf(completeSession.id).map((m) => (
                        <tr key={m.id} className="border-b border-line/50 last:border-0">
                          <td className="p-2 font-semibold text-ink">{moduleName(m.moduleId)}</td>
                          <td className="p-2 font-mono text-[10px] text-muted">
                            {m.scheduledAt ? fmtDateTime(m.scheduledAt) : "—"}
                          </td>
                          <td className="p-2 text-muted">
                            {teacherLabel(m.teacherId, m.teacherName)}
                            {!m.teacherId && (
                              <Badge tone="warning" className="ml-1.5 text-[8px]">
                                sans fiche
                              </Badge>
                            )}
                          </td>
                          <td className="p-2 text-right font-mono">{m.totalPrice} DA</td>
                          {canSeeGains && (
                            <td className="p-2 text-right font-mono">
                              {m.teacherPaid ? (
                                <>
                                  {m.teacherAmount} DA
                                  <Badge tone="success" className="ml-1 text-[8px]">
                                    payé
                                  </Badge>
                                </>
                              ) : (
                                <>
                                  {Math.round((m.totalPrice * completeSplit.teacherPct) / 100)} DA
                                  <span className="block text-[9px] text-muted">
                                    {completeSplit.teacherPct} %
                                  </span>
                                </>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Les parts des élèves — seulement utile quand ils sont plusieurs,
                  mais affichées dans tous les cas : la facture a la même forme. */}
              <div className="rounded-2xl border border-line bg-surface p-3.5">
                <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">
                  Part de chaque élève ({completeStudents.length})
                </h4>
                {completeStudents.length > 1 && (
                  <p className="mb-2 text-[10px] leading-relaxed text-muted">
                    La séance est partagée : réglez ce que <strong>chacun</strong> doit et ce
                    qu&apos;il verse. Somme des parts :{" "}
                    <strong
                      className={
                        studentAmountsTotal === Math.round(completeTotal || 0)
                          ? "text-success"
                          : "text-warning"
                      }
                    >
                      {studentAmountsTotal} DA
                    </strong>{" "}
                    / {Math.round(completeTotal || 0)} DA.
                  </p>
                )}
                <div className="space-y-2">
                  {completeStudents.map((r) => {
                    const v = studentAmounts[r.id] ?? { due: r.totalPrice, paid: r.paidAmount };
                    return (
                      <div
                        key={r.id}
                        className="grid grid-cols-1 items-end gap-2 rounded-xl border border-line/60 bg-canvas/20 p-2.5 sm:grid-cols-[minmax(0,1fr)_7rem_7rem]"
                      >
                        <div className="min-w-0">
                          <strong className="block truncate text-xs text-ink">
                            {studentLabel(r.studentId, r.guestName)}
                          </strong>
                          <span className="block truncate text-[10px] text-muted">
                            {schoolingOf(r.classId, r.year, r.filiereId) || "scolarité non précisée"}
                          </span>
                        </div>
                        <div>
                          <label className="mb-0.5 block text-[9px] font-semibold uppercase text-muted">
                            À payer
                          </label>
                          <Input
                            type="number"
                            min={0}
                            value={v.due || ""}
                            onChange={(e) =>
                              setStudentAmounts((prev) => ({
                                ...prev,
                                [r.id]: { ...v, due: Number(e.target.value) },
                              }))
                            }
                          />
                        </div>
                        <div>
                          <label className="mb-0.5 block text-[9px] font-semibold uppercase text-muted">
                            Versé
                          </label>
                          <Input
                            type="number"
                            min={0}
                            value={v.paid || ""}
                            onChange={(e) =>
                              setStudentAmounts((prev) => ({
                                ...prev,
                                [r.id]: { ...v, paid: Number(e.target.value) },
                              }))
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ---- Droite : le calcul ---- */}
            <div className="space-y-3 lg:sticky lg:top-2 lg:self-start">
              <div className="rounded-2xl border border-line bg-canvas p-4">
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                  Total de la séance (DA)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={completeTotal || ""}
                  onChange={(e) => setCompleteTotal(Number(e.target.value))}
                />
                <p className="mt-1 text-[10px] leading-relaxed text-muted">
                  Programmé : <strong className="text-ink">{completeSession.totalPrice} DA</strong>.
                  Modifiable — c&apos;est le moment où l&apos;école ajuste (une heure de moins, un
                  geste commercial).
                </p>
              </div>

              {/* La répartition, dans les deux sens — direction seulement.
                  Masquée, la conclusion applique le taux déjà porté par les
                  modules de la séance (celui posé à la programmation), exactement
                  la valeur que ce panneau proposait par défaut. */}
              {canSeeGains && (
              <div className="space-y-3 rounded-2xl border border-primary/25 bg-primary-50/40 p-4">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-primary">
                  Répartition
                </span>
                <p className="text-[10px] leading-relaxed text-muted">
                  Le même partage se dit dans les deux sens. Choisissez le chiffre que vous avez en
                  tête — l&apos;autre s&apos;en déduit.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPctMode("school")}
                    className={`rounded-xl border p-2.5 text-left transition-all ${
                      pctMode === "school"
                        ? "border-primary bg-primary/10 ring-2 ring-primary/25"
                        : "border-line bg-surface"
                    }`}
                  >
                    <strong className="block text-[11px] text-ink">% de l&apos;école</strong>
                    <span className="block text-[9px] text-muted">« Je prends 30 % »</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPctMode("teacher")}
                    className={`rounded-xl border p-2.5 text-left transition-all ${
                      pctMode === "teacher"
                        ? "border-primary bg-primary/10 ring-2 ring-primary/25"
                        : "border-line bg-surface"
                    }`}
                  >
                    <strong className="block text-[11px] text-ink">% de l&apos;enseignant</strong>
                    <span className="block text-[9px] text-muted">« Le prof prend 70 % »</span>
                  </button>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-muted">
                    {pctMode === "school"
                      ? "Pourcentage de l'école (%)"
                      : "Pourcentage de l'enseignant (%)"}
                  </label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={pctValue || ""}
                    onChange={(e) => setPctValue(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1 border-t border-primary/20 pt-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted">Enseignants ({completeSplit.teacherPct} %)</span>
                    <strong className="font-mono text-primary">
                      {completeSplit.teacherShare} DA
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">École ({completeSplit.schoolPct} %)</span>
                    <strong className="font-mono text-success">
                      {completeSplit.schoolShare} DA
                    </strong>
                  </div>
                  <p className="pt-1 text-[10px] leading-relaxed text-muted">
                    La part de l&apos;école est ce qui <strong>reste</strong> une fois les
                    enseignants payés — jamais un second calcul de pourcentage, dont
                    l&apos;arrondi ne referait pas le total.
                  </p>
                </div>
              </div>
              )}

              {/* L'encaissement */}
              <div className="space-y-2 rounded-2xl border border-line bg-canvas p-4 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted">Déjà versé</span>
                  <strong className="font-mono text-ink">{completeSession.paidAmount} DA</strong>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-muted">
                    Encaissé maintenant (DA)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={cashNow || ""}
                    onChange={(e) => setCashNow(Number(e.target.value))}
                  />
                </div>
                <div className="flex justify-between border-t border-line pt-2">
                  <span className="text-muted">Reste dû après</span>
                  <strong
                    className={`font-mono ${
                      Math.max(
                        0,
                        Math.round(completeTotal || 0) -
                          completeSession.paidAmount -
                          Math.max(0, Math.round(cashNow || 0)),
                      ) > 0
                        ? "text-danger"
                        : "text-success"
                    }`}
                  >
                    {Math.max(
                      0,
                      Math.round(completeTotal || 0) -
                        completeSession.paidAmount -
                        Math.max(0, Math.round(cashNow || 0)),
                    )}{" "}
                    DA
                  </strong>
                </div>
              </div>

              {/* L'enseignant est-il réglé maintenant ? Régler un enseignant
                  est une sortie de caisse vers SON historique : direction
                  seulement. Une séance conclue au guichet laisse donc
                  l'enseignant à régler, et l'alerte de cette page — visible de
                  la direction — le rappellera. */}
              {canSeeGains && (
              <label
                className={`flex cursor-pointer items-start gap-2.5 rounded-2xl border p-3.5 text-xs transition-colors ${
                  payTeachersNow
                    ? "border-success/40 bg-success/10"
                    : "border-warning/40 bg-warning/10"
                }`}
              >
                <input
                  type="checkbox"
                  checked={payTeachersNow}
                  onChange={(e) => setPayTeachersNow(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>
                  <strong className="block text-ink">
                    L&apos;enseignant reçoit son argent maintenant
                  </strong>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">
                    {payTeachersNow ? (
                      <>
                        Le versement sort de la caisse et s&apos;inscrit dans{" "}
                        <strong>l&apos;historique de l&apos;enseignant</strong> — à condition
                        qu&apos;il ait une fiche. Un enseignant simplement nommé restera à régler.
                      </>
                    ) : (
                      <>
                        La séance sera <strong className="text-warning">signalée en alerte</strong>{" "}
                        — sur cette page et sur le tableau de bord — jusqu&apos;à ce que
                        l&apos;enseignant soit réglé.
                      </>
                    )}
                  </span>
                </span>
              </label>
              )}

              <div className="flex flex-col gap-2 border-t border-line pt-4">
                <Button onClick={handleComplete} disabled={savingComplete} variant="success">
                  {savingComplete ? "Enregistrement..." : "Terminer la séance"}
                </Button>
                <Button variant="outline" onClick={() => setCompleteId(null)}>
                  Annuler
                </Button>
              </div>
            </div>
          </div>
        )}
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
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={STATUS_TONES[detailsSession.status]} className="font-bold">
                  {STATUS_LABELS[detailsSession.status]}
                </Badge>
                <Badge tone="primary" className="font-mono font-bold">
                  {detailsSession.status === "requested"
                    ? "Pas encore programmée"
                    : fmtDateTime(detailsSession.scheduledAt)}
                </Badge>
              </div>
            </div>

            {/* Le dossier de demande */}
            <div className="rounded-2xl border border-line bg-surface p-4">
              <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">
                📋 Le dossier
              </h4>
              <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                {[
                  [
                    "Date de demande",
                    detailsSession.requestDate ? formatDateFr(detailsSession.requestDate) : "—",
                  ],
                  ["Reçu par", detailsSession.receptionistName || "—"],
                  [
                    "Versement à la demande",
                    `${detailsSession.depositAmount ?? 0} DA`,
                  ],
                  [
                    "Séance conclue le",
                    detailsSession.completedAt ? fmtDateTime(detailsSession.completedAt) : "—",
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex justify-between gap-3 border-b border-line/50 pb-1.5"
                  >
                    <span className="text-muted">{label} :</span>
                    <strong className="text-end text-ink">{value}</strong>
                  </div>
                ))}
              </div>
              {(detailsSession.observation || detailsSession.notes) && (
                <p className="mt-2 rounded-xl border border-line bg-canvas/30 p-2.5 text-[11px] text-muted">
                  <strong className="text-ink">Observation :</strong>{" "}
                  {detailsSession.observation || detailsSession.notes}
                </p>
              )}
            </div>

            {/* Les élèves */}
            <div className="rounded-2xl border border-line bg-surface p-4">
              <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">
                👥 Élève(s) ({studentsOf(detailsSession.id).length})
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-line text-[10px] font-bold uppercase text-muted">
                      <th className="p-2">Nom</th>
                      <th className="p-2">Téléphone</th>
                      <th className="p-2">Scolarité</th>
                      <th className="p-2 text-right">À payer</th>
                      <th className="p-2 text-right">Versé</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentsOf(detailsSession.id).map((r) => {
                      const stu = r.studentId ? students.find((x) => x.id === r.studentId) : undefined;
                      const left = Math.max(0, r.totalPrice - r.paidAmount);
                      return (
                        <tr key={r.id} className="border-b border-line/50 last:border-0">
                          <td className="p-2 font-semibold text-ink">
                            {studentLabel(r.studentId, r.guestName)}
                            <Badge
                              tone={r.studentId ? "primary" : "neutral"}
                              className="ml-1.5 text-[8px]"
                            >
                              {r.studentId ? "inscrit" : "de passage"}
                            </Badge>
                          </td>
                          <td className="p-2 font-mono text-muted">
                            {stu?.phone || r.guestPhone || "—"}
                          </td>
                          <td className="p-2 text-muted">
                            {schoolingOf(r.classId, r.year, r.filiereId) || "—"}
                          </td>
                          <td className="p-2 text-right font-mono">{r.totalPrice} DA</td>
                          <td
                            className={`p-2 text-right font-mono font-bold ${
                              left > 0 ? "text-danger" : "text-success"
                            }`}
                          >
                            {r.paidAmount} DA
                            {left > 0 && (
                              <span className="block text-[9px] font-normal">reste {left} DA</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Argent */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                {
                  label: "Durée",
                  value: fmtDuration(detailsSession.durationMinutes),
                  tone: "text-ink",
                },
                { label: "Total", value: `${detailsSession.totalPrice} DA`, tone: "text-primary" },
                {
                  label: "Encaissé",
                  value: `${detailsSession.paidAmount} DA`,
                  tone: "text-success",
                },
                {
                  label: "Reste dû",
                  value: `${dueOf(detailsSession)} DA`,
                  tone: dueOf(detailsSession) > 0 ? "text-danger" : "text-muted",
                },
              ].map((k) => (
                <div
                  key={k.label}
                  className="rounded-xl border border-line bg-canvas p-3 text-center"
                >
                  <span className="block text-[10px] font-semibold uppercase text-muted">
                    {k.label}
                  </span>
                  <strong className={`font-mono text-base ${k.tone}`}>{k.value}</strong>
                </div>
              ))}
            </div>

            {canSeeGains && (detailsSession.teacherShare ?? 0) > 0 && (
              <div className="grid grid-cols-2 gap-3 rounded-2xl border border-line bg-canvas/30 p-3 text-xs">
                <div className="text-center">
                  <span className="block text-[10px] uppercase text-muted">
                    Part école ({detailsSession.schoolPercentage ?? 0} %)
                  </span>
                  <strong className="font-mono text-base text-success">
                    {detailsSession.schoolShare ?? 0} DA
                  </strong>
                </div>
                <div className="text-center">
                  <span className="block text-[10px] uppercase text-muted">
                    Part enseignants ({100 - (detailsSession.schoolPercentage ?? 0)} %)
                  </span>
                  <strong className="font-mono text-base text-primary">
                    {detailsSession.teacherShare ?? 0} DA
                  </strong>
                </div>
              </div>
            )}

            {/* Modules */}
            <div className="rounded-2xl border border-line bg-surface p-4">
              <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted">
                📚 Modules et enseignants
              </h4>
              {modulesOf(detailsSession.id).length === 0 ? (
                <p className="py-4 text-center text-xs italic text-muted">
                  Aucun module — la séance n&apos;est pas encore programmée.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-line text-[10px] font-bold uppercase text-muted">
                        <th className="p-2">Module</th>
                        <th className="p-2">Date & heure</th>
                        <th className="p-2">Enseignant</th>
                        <th className="p-2 text-center">Durée</th>
                        <th className="p-2 text-right">Tarif</th>
                        <th className="p-2 text-right">Total</th>
                        {/* Ce que l'enseignant touche, et le bouton qui le lui
                            verse : direction seulement. */}
                        {canSeeGains && <th className="p-2 text-right">Part prof</th>}
                        {canSeeGains && <th className="p-2 text-right">Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {modulesOf(detailsSession.id).map((m) => (
                        <tr key={m.id} className="border-b border-line/50 last:border-0">
                          <td className="p-2 font-semibold text-ink">{moduleName(m.moduleId)}</td>
                          <td className="p-2 font-mono text-[10px] text-muted">
                            {m.scheduledAt ? fmtDateTime(m.scheduledAt) : "—"}
                          </td>
                          <td className="p-2 text-muted">
                            {teacherLabel(m.teacherId, m.teacherName)}
                            {m.teacherPhone && (
                              <span className="block font-mono text-[9px]">{m.teacherPhone}</span>
                            )}
                          </td>
                          <td className="p-2 text-center font-mono">{fmtDuration(m.minutes)}</td>
                          <td className="p-2 text-right font-mono">
                            {(m.flatPrice ?? 0) > 0 ? "forfait" : `${m.hourlyPrice} DA/h`}
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-primary">
                            {m.totalPrice} DA
                          </td>
                          {canSeeGains && (
                            <td className="p-2 text-right font-mono">
                              {m.teacherAmount} DA
                              <span className="block text-[9px] text-muted">
                                {m.teacherPercentage} %
                              </span>
                            </td>
                          )}
                          {canSeeGains && (
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
                                    handlePayTeacher(
                                      m.id,
                                      teacherLabel(m.teacherId, m.teacherName),
                                      m.teacherAmount,
                                    )
                                  }
                                >
                                  Payer {m.teacherAmount} DA
                                </Button>
                              ) : (
                                <Badge tone="warning" className="text-[9px]">
                                  Sans fiche — non réglable
                                </Badge>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
              <div className="flex flex-wrap gap-2">
                {detailsSession.status === "requested" && (
                  <Button onClick={() => openProgram(detailsSession)}>
                    <CalendarDays className="h-4 w-4" /> Programmer
                  </Button>
                )}
                {detailsSession.status === "planned" && (
                  <Button variant="success" onClick={() => openComplete(detailsSession)}>
                    <CheckCircle className="h-4 w-4" /> Compléter la séance
                  </Button>
                )}
                {dueOf(detailsSession) > 0 && detailsSession.status !== "cancelled" && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setPayId(detailsSession.id);
                      setPayAmount(dueOf(detailsSession));
                      setDetailsId(null);
                    }}
                  >
                    <DollarSign className="h-4 w-4" /> Encaisser {dueOf(detailsSession)} DA
                  </Button>
                )}
                {detailsSession.status === "done" && (
                  <Button variant="outline" onClick={() => printInvoice(detailsSession)}>
                    <Printer className="h-4 w-4" /> Facture
                  </Button>
                )}
                <Button variant="outline" onClick={() => openRequestEdit(detailsSession)}>
                  <Edit className="h-4 w-4" /> Dossier
                </Button>
                {detailsSession.status !== "cancelled" && (
                  <Button
                    variant="outline"
                    onClick={() => handleStatus(detailsSession, "cancelled")}
                  >
                    <XCircle className="h-4 w-4" /> Annuler
                  </Button>
                )}
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
        title="Encaisser un règlement"
        subtitle={
          paySession
            ? `${nameOf(paySession)} — reste dû : ${dueOf(paySession)} DA`
            : undefined
        }
      >
        {paySession && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              {[
                { label: "Total", value: paySession.totalPrice, tone: "text-ink" },
                { label: "Déjà versé", value: paySession.paidAmount, tone: "text-success" },
                { label: "Reste dû", value: dueOf(paySession), tone: "text-danger" },
              ].map((k) => (
                <div key={k.label} className="rounded-xl border border-line bg-canvas p-2.5">
                  <span className="block text-[9px] uppercase text-muted">{k.label}</span>
                  <strong className={`font-mono text-base ${k.tone}`}>{k.value} DA</strong>
                </div>
              ))}
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">
                Montant encaissé (DA) *
              </label>
              <Input
                type="number"
                min={0}
                max={dueOf(paySession)}
                value={payAmount || ""}
                onChange={(e) => setPayAmount(Number(e.target.value))}
              />
              <p className="mt-1 text-[10px] leading-relaxed text-muted">
                Le versement est réparti sur les élèves qui doivent encore, du plus endetté au
                moins — sans quoi une séance à plusieurs ne saurait plus qui a payé quoi.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <Button variant="outline" onClick={() => setPayId(null)}>
                Annuler
              </Button>
              <Button variant="success" onClick={handlePayDebt}>
                Encaisser {payAmount} DA
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
        subtitle="Une séance annulée qu'on redate est une séance reprogrammée."
      >
        <div className="space-y-4">
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
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="outline" onClick={() => setRescheduleId(null)}>
              Annuler
            </Button>
            <Button onClick={handleReschedule}>Reporter</Button>
          </div>
        </div>
      </Modal>

      {/* ---- Créer un élève ---- */}
      <Modal
        open={isStudentFormOpen}
        onClose={() => setIsStudentFormOpen(false)}
        title="Nouvel élève"
        subtitle="Il sera créé, puis rattaché automatiquement à cette séance."
        wide
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Prénom *</label>
            <Input value={nsFirstName} onChange={(e) => setNsFirstName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Nom *</label>
            <Input value={nsLastName} onChange={(e) => setNsLastName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Date de naissance</label>
            <Input type="date" value={nsBirthDate} onChange={(e) => setNsBirthDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Téléphone *</label>
            <Input value={nsPhone} onChange={(e) => setNsPhone(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Carte RFID *</label>
            <Input
              value={nsRfid}
              onChange={(e) => setNsRfid(e.target.value)}
              className="font-mono"
              placeholder="Passez la carte devant le lecteur..."
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">
              Email (généré si vide)
            </label>
            <Input value={nsEmail} onChange={(e) => setNsEmail(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">
              Mot de passe * (6 car. min.)
            </label>
            <Input value={nsPassword} onChange={(e) => setNsPassword(e.target.value)} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 self-end text-xs">
            <input
              type="checkbox"
              checked={nsIsFree}
              onChange={(e) => setNsIsFree(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-ink">Élève gratuit</span>
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="outline" onClick={() => setIsStudentFormOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleCreateStudent} disabled={savingStudent}>
            {savingStudent ? "Création..." : "Créer et rattacher"}
          </Button>
        </div>
      </Modal>

      {/* ---- Créer un enseignant ---- */}
      <Modal
        open={isTeacherFormOpen}
        onClose={() => setIsTeacherFormOpen(false)}
        title="Nouvel enseignant"
        subtitle="Il sera créé, puis rattaché automatiquement à ce module."
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
              <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">
                Pas de compte de connexion. Il a en revanche une fiche — donc un{" "}
                <strong>historique de versements</strong>, et il peut être réglé.
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
              <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">
                Avec compte de connexion : il voit son emploi du temps et ses versements.
              </span>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Prénom / Nom *</label>
              <Input value={ntFirstName} onChange={(e) => setNtFirstName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Nom de famille</label>
              <Input value={ntLastName} onChange={(e) => setNtLastName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Téléphone</label>
              <Input value={ntPhone} onChange={(e) => setNtPhone(e.target.value)} />
            </div>
            {/* Ce qu'un enseignant touche se fixe à la direction, pas au
                guichet. Masqué, le champ garde sa valeur — celle du module
                d'où la fiche est créée, 50 % à défaut : la fiche naît avec le
                même taux qu'avant. */}
            {canSeeGains && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">
                  Pourcentage (%)
                </label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={ntPercentage || ""}
                  onChange={(e) => setNtPercentage(Number(e.target.value))}
                />
              </div>
            )}
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-muted">
                Description — de quoi se rappeler qui c&apos;est
              </label>
              <Input
                value={ntDescription}
                onChange={(e) => setNtDescription(e.target.value)}
                placeholder="Spécialité, provenance, disponibilités..."
              />
            </div>
            {ntKind === "staff" && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">
                    Email (connexion) *
                  </label>
                  <Input value={ntEmail} onChange={(e) => setNtEmail(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">
                    Mot de passe * (6 car. min.)
                  </label>
                  <Input value={ntPassword} onChange={(e) => setNtPassword(e.target.value)} />
                </div>
              </>
            )}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="outline" onClick={() => setIsTeacherFormOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleCreateTeacher} disabled={savingTeacher}>
            {savingTeacher ? "Création..." : "Créer et rattacher"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
