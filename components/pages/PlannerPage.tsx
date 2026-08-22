"use client";

import { useMemo, useState } from "react";
import { useData, uid } from "@/lib/store/data";
import { createClient } from "@/lib/supabase/client";
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
  Calendar as CalendarIcon,
  User,
  MapPin,
  Users,
  Clock,
  Filter,
  Printer,
  Search,
  Sparkles,
  X
} from "lucide-react";
import type { ScheduleSession, Day, SeanceAudience, Subscription, Teacher } from "@/lib/types";
import { checkOpenSeanceAudience } from "@/lib/seanceAudience";
import { DAY_LABELS_FR, formatDateFr, salleStartClashes, sessionSalleIds } from "@/lib/helpers";
import { printHtmlDocument } from "@/lib/print";
import {
  bannerHtml,
  letterheadHtml,
  metaFooterHtml,
  printDocument,
  signaturesHtml,
} from "@/lib/printTemplates";
import { useSettings } from "@/lib/store/settings";

const PRINT_LABELS = {
  fr: {
    docTitle: "Emploi du Temps — Fiche de Séance",
    printedOn: (d: string) => `Imprimé le ${d}`,
    infoTitle: "Informations de la Séance",
    tableTitle: "Horaires Détaillés",
    day: "Jour",
    time: "Horaire (début – fin)",
    module: "Module / Matière",
    group: "Groupe",
    classLevel: "Classe / Niveau",
    teacher: "Enseignant",
    salle: "Salle",
    enrolled: "Élèves inscrits",
    signDirection: "La Direction",
    signTeacher: "L'Enseignant",
    days: {
      saturday: "Samedi", sunday: "Dimanche", monday: "Lundi", tuesday: "Mardi",
      wednesday: "Mercredi", thursday: "Jeudi", friday: "Vendredi",
    } as Record<Day, string>,
  },
  ar: {
    docTitle: "جدول التوقيت — بطاقة الحصة",
    printedOn: (d: string) => `طُبع بتاريخ ${d}`,
    infoTitle: "معلومات الحصة",
    tableTitle: "التوقيت المفصّل",
    day: "اليوم",
    time: "التوقيت (البداية – النهاية)",
    module: "المادة",
    group: "الفوج",
    classLevel: "القسم / المستوى",
    teacher: "الأستاذ",
    salle: "القاعة",
    enrolled: "التلاميذ المسجلون",
    signDirection: "الإدارة",
    signTeacher: "الأستاذ",
    days: {
      saturday: "السبت", sunday: "الأحد", monday: "الإثنين", tuesday: "الثلاثاء",
      wednesday: "الأربعاء", thursday: "الخميس", friday: "الجمعة",
    } as Record<Day, string>,
  },
} as const;

const WEEKDAYS: { key: Day; label: string }[] = [
  { key: "saturday", label: "Samedi" },
  { key: "sunday", label: "Dimanche" },
  { key: "monday", label: "Lundi" },
  { key: "tuesday", label: "Mardi" },
  { key: "wednesday", label: "Mercredi" },
  { key: "thursday", label: "Jeudi" },
  { key: "friday", label: "Vendredi" },
];

export function PlannerPage() {
  const {
    school,
    sessions,
    classes,
    modules,
    groups,
    salles,
    teachers,
    students,
    subscriptions,
    push,
    deleteFrom,
    updateItem,
  } = useData();
  const { language } = useSettings();

  // View mode toggle
  const [viewMode, setViewMode] = useState<"calendar" | "cards">("calendar");

  // Filters
  const [filterSessionId, setFilterSessionId] = useState("");
  const [filterTeacherId, setFilterTeacherId] = useState("");
  const [filterSalleId, setFilterSalleId] = useState("");
  const [filterClassId, setFilterClassId] = useState("");

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<ScheduleSession | null>(null);

  // Form states
  const [classId, setClassId] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [salleId, setSalleId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [selectedDays, setSelectedDays] = useState<Day[]>([]);
  const [startHour, setStartHour] = useState("08");
  const [startMin, setStartMin] = useState("00");
  const [endHour, setEndHour] = useState("10");
  const [endMin, setEndMin] = useState("00");

  // Inline creations
  const [newModuleName, setNewModuleName] = useState("");
  const [showAddModule, setShowAddModule] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [newSalleName, setNewSalleName] = useState("");
  const [showAddSalle, setShowAddSalle] = useState(false);

  // ---- Séance libre (créneau ouvert) --------------------------------------
  const [isOpenSeanceModalOpen, setIsOpenSeanceModalOpen] = useState(false);
  const [editingOpenSession, setEditingOpenSession] = useState<ScheduleSession | null>(null);
  const [openModuleId, setOpenModuleId] = useState("");
  const [openClassIds, setOpenClassIds] = useState<string[]>([]);
  const [openGroupIds, setOpenGroupIds] = useState<string[]>([]);
  const [openSalleIds, setOpenSalleIds] = useState<string[]>([]);
  const [openPeriodStart, setOpenPeriodStart] = useState("");
  const [openPeriodEnd, setOpenPeriodEnd] = useState("");
  const [openDays, setOpenDays] = useState<Day[]>([]);
  const [openStartHour, setOpenStartHour] = useState("08");
  const [openStartMin, setOpenStartMin] = useState("00");
  const [openEndHour, setOpenEndHour] = useState("10");
  const [openEndMin, setOpenEndMin] = useState("00");
  const [openPrice, setOpenPrice] = useState<number>(0);
  // teacher: pick an existing one, or type a "passager" who has no account
  const [openTeacherMode, setOpenTeacherMode] = useState<"existing" | "passager">("existing");
  const [openTeacherSearch, setOpenTeacherSearch] = useState("");
  const [openTeacherId, setOpenTeacherId] = useState("");
  const [openPassagerName, setOpenPassagerName] = useState("");
  const [openPassagerPhone, setOpenPassagerPhone] = useState("");
  const [openTitleOverride, setOpenTitleOverride] = useState("");
  // "Séance libre offerte": the whole créneau is free — every présence recorded
  // on it is offered (no débit, no encaissement, no rémunération de l'enseignant).
  const [openIsFree, setOpenIsFree] = useState(false);
  // Public du créneau : qui la réception pourra encaisser dessus (voir
  // lib/seanceAudience.ts). Un créneau neuf est réservé à ses propres classes
  // et groupes — c'est le réglage qu'on peut toujours élargir ensuite.
  const [openAudience, setOpenAudience] = useState<SeanceAudience>("enrolled");
  const [savingOpenSeance, setSavingOpenSeance] = useState(false);
  // "Vue" filter: all timings / regular courses only / séances libres only
  const [kindFilter, setKindFilter] = useState<"all" | "cours" | "open">("all");

  // Helper: consistent coloring by module ID
  const getSessionColor = (modId: string) => {
    let hash = 0;
    for (let i = 0; i < modId.length; i++) {
      hash = modId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = [
      "border-l-4 border-l-blue-500 bg-blue-50/70 text-blue-900 dark:bg-blue-950/20 dark:text-blue-200 border-blue-100",
      "border-l-4 border-l-emerald-500 bg-emerald-50/70 text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200 border-emerald-100",
      "border-l-4 border-l-amber-500 bg-amber-50/70 text-amber-900 dark:bg-amber-950/20 dark:text-amber-200 border-amber-100",
      "border-l-4 border-l-rose-500 bg-rose-50/70 text-rose-900 dark:bg-rose-950/20 dark:text-rose-200 border-rose-100",
      "border-l-4 border-l-purple-500 bg-purple-50/70 text-purple-900 dark:bg-purple-950/20 dark:text-purple-200 border-purple-100",
      "border-l-4 border-l-cyan-500 bg-cyan-50/70 text-cyan-900 dark:bg-cyan-950/20 dark:text-cyan-200 border-cyan-100",
      "border-l-4 border-l-indigo-500 bg-indigo-50/70 text-indigo-900 dark:bg-indigo-950/20 dark:text-indigo-200 border-indigo-100",
    ];
    return colors[Math.abs(hash) % colors.length];
  };

  // Helpers
  const getClassName = (cid: string) => {
    const cls = classes.find((c) => c.id === cid);
    if (!cls) return "-";
    const lvl = cls.type === "cours" ? cls.coursLevel : cls.formationLevel;
    return `${cls.name} (${lvl})`;
  };

  const getModuleName = (mid: string) => modules.find((m) => m.id === mid)?.name ?? "-";
  const getGroupName = (gid: string) => groups.find((g) => g.id === gid)?.name ?? "-";
  const getSalleName = (sid: string) => salles.find((s) => s.id === sid)?.name ?? "-";

  /**
   * Prévient quand la salle demandée est DÉJÀ prise le même jour à la même
   * heure de début — sans jamais refuser l'enregistrement : une école peut
   * vouloir doubler une salle (demi-groupes, surveillance), le dernier mot lui
   * revient. L'alerte sert à ce qu'elle ne le fasse pas sans le savoir.
   */
  const warnSalleClash = (candidate: {
    id?: string;
    salleIds: string[];
    days: Day[];
    startTime: string;
  }) => {
    const clashes = salleStartClashes(sessions, candidate);
    if (clashes.length === 0) return;
    const lines = clashes
      .map(
        (s) =>
          `• ${sessionSalleIds(s).map(getSalleName).join(" + ")} — ${getModuleName(s.moduleId)}` +
          ` (${getGroupName(s.groupId)}) ${s.startTime}-${s.endTime}` +
          ` · ${s.days.map((d) => DAY_LABELS_FR[d]).join(", ")}`,
      )
      .join("\n");
    alert(
      `⚠️ Salle déjà occupée à ${candidate.startTime} :\n\n${lines}\n\n` +
        "Le créneau est tout de même enregistré — vérifiez que c'est bien voulu.",
    );
  };
  const getTeacherName = (tid: string) => {
    const t = teachers.find((te) => te.id === tid);
    return t ? `${t.firstName} ${t.lastName}` : "-";
  };

  const toggleDay = (day: Day) => {
    if (selectedDays.includes(day)) {
      setSelectedDays(selectedDays.filter((d) => d !== day));
    } else {
      setSelectedDays([...selectedDays, day]);
    }
  };

  const handleCreateModule = () => {
    if (!newModuleName.trim()) return;
    const newId = uid("mod");
    push("modules", { id: newId, name: newModuleName });
    setModuleId(newId);
    setNewModuleName("");
    setShowAddModule(false);
  };

  const handleCreateGroup = () => {
    if (!newGroupName.trim()) return;
    const newId = uid("grp");
    push("groups", { id: newId, name: newGroupName });
    setGroupId(newId);
    setNewGroupName("");
    setShowAddGroup(false);
  };

  const handleCreateSalle = () => {
    if (!newSalleName.trim()) return;
    const newId = uid("salle");
    push("salles", { id: newId, name: newSalleName });
    setSalleId(newId);
    setNewSalleName("");
    setShowAddSalle(false);
  };

  // ---- Séance libre helpers ------------------------------------------------

  const toggleIn = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const DOW_KEYS: Day[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  /** Weekdays that actually occur at least once inside the selected period —
   *  the user can only pick study days that exist in that range. */
  const daysAvailableInPeriod = useMemo<Day[]>(() => {
    if (!openPeriodStart || !openPeriodEnd || openPeriodStart > openPeriodEnd) return [];
    const start = new Date(`${openPeriodStart}T12:00:00`);
    const end = new Date(`${openPeriodEnd}T12:00:00`);
    const found = new Set<Day>();
    const cursor = new Date(start);
    // A full week covers every weekday; stop early instead of walking months.
    while (cursor <= end && found.size < 7) {
      found.add(DOW_KEYS[cursor.getDay()]);
      cursor.setDate(cursor.getDate() + 1);
    }
    return WEEKDAYS.filter((w) => found.has(w.key)).map((w) => w.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPeriodStart, openPeriodEnd]);

  /** How many actual séances the period will contain (period × selected days). */
  const openSeanceCount = useMemo(() => {
    if (!openPeriodStart || !openPeriodEnd || openDays.length === 0) return 0;
    const start = new Date(`${openPeriodStart}T12:00:00`);
    const end = new Date(`${openPeriodEnd}T12:00:00`);
    let count = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
      if (openDays.includes(DOW_KEYS[cursor.getDay()])) count += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    return count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPeriodStart, openPeriodEnd, openDays]);

  /**
   * Combien d'élèves chaque public laisserait entrer, avec les classes et les
   * groupes cochés à l'instant. La réception ne devine pas ce que « toute la
   * filière » ajoute : autant le compter devant elle, sur ses propres données.
   * Calculé uniquement quand la fenêtre est ouverte.
   */
  const audienceCounts = useMemo(() => {
    if (!isOpenSeanceModalOpen) return { enrolled: 0, filiere: 0 };
    const draft: ScheduleSession = {
      id: editingOpenSession?.id ?? "draft",
      classId: openClassIds[0] ?? "",
      moduleId: openModuleId,
      groupId: openGroupIds[0] ?? "",
      salleId: openSalleIds[0] ?? "",
      teacherId: openTeacherId,
      days: openDays,
      startTime: `${openStartHour}:${openStartMin}`,
      endTime: `${openEndHour}:${openEndMin}`,
      isOpen: true,
      classIds: openClassIds,
      groupIds: openGroupIds,
      salleIds: openSalleIds,
    };
    const countOf = (audience: SeanceAudience) =>
      students.filter(
        (student) =>
          checkOpenSeanceAudience({
            session: { ...draft, openAudience: audience },
            student,
            sessions,
            subscriptions,
            classes,
          }).allowed,
      ).length;
    return { enrolled: countOf("enrolled"), filiere: countOf("filiere") };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpenSeanceModalOpen, openClassIds, openGroupIds, students, sessions, subscriptions, classes]);

  /** Readable, self-describing name for a séance libre timing — the format the
   *  Abonnements / Séances Libres screens display. */
  const buildOpenTitle = () => {
    const mod = openModuleId ? getModuleName(openModuleId) : "Module";
    const salleLabel = openSalleIds.length
      ? openSalleIds.map(getSalleName).join(" + ")
      : "Salle ?";
    const time = `${openStartHour}:${openStartMin}-${openEndHour}:${openEndMin}`;
    const period =
      openPeriodStart && openPeriodEnd
        ? ` · du ${formatDateFr(openPeriodStart)} au ${formatDateFr(openPeriodEnd)}`
        : "";
    return `Séance Libre — ${mod} · ${salleLabel} · ${time}${period}`;
  };

  const resetOpenForm = () => {
    setEditingOpenSession(null);
    setOpenModuleId("");
    setOpenClassIds([]);
    setOpenGroupIds([]);
    setOpenSalleIds([]);
    setOpenPeriodStart("");
    setOpenPeriodEnd("");
    setOpenDays([]);
    setOpenStartHour("08");
    setOpenStartMin("00");
    setOpenEndHour("10");
    setOpenEndMin("00");
    setOpenPrice(0);
    setOpenTeacherMode("existing");
    setOpenTeacherSearch("");
    setOpenTeacherId("");
    setOpenPassagerName("");
    setOpenPassagerPhone("");
    setOpenTitleOverride("");
    setOpenIsFree(false);
    setOpenAudience("enrolled");
  };

  const openEditOpenSeance = (s: ScheduleSession) => {
    setEditingOpenSession(s);
    setOpenModuleId(s.moduleId);
    setOpenClassIds(s.classIds?.length ? s.classIds : [s.classId]);
    setOpenGroupIds(s.groupIds?.length ? s.groupIds : [s.groupId]);
    setOpenSalleIds(s.salleIds?.length ? s.salleIds : [s.salleId]);
    setOpenPeriodStart(s.periodStart ?? "");
    setOpenPeriodEnd(s.periodEnd ?? "");
    setOpenDays(s.days);
    const [sh, sm] = s.startTime.split(":");
    const [eh, em] = s.endTime.split(":");
    setOpenStartHour(sh);
    setOpenStartMin(sm);
    setOpenEndHour(eh);
    setOpenEndMin(em);
    setOpenPrice(subscriptions.find((su) => su.sessionId === s.id)?.pricePerSession ?? s.openPrice ?? 0);
    const t = teachers.find((te) => te.id === s.teacherId);
    setOpenTeacherMode(t?.isPassager ? "passager" : "existing");
    setOpenTeacherId(s.teacherId ?? "");
    setOpenTeacherSearch(t ? `${t.firstName} ${t.lastName}` : "");
    setOpenPassagerName(t?.isPassager ? `${t.firstName} ${t.lastName}`.trim() : "");
    setOpenPassagerPhone(t?.isPassager ? t.phone : "");
    setOpenTitleOverride(s.title ?? "");
    setOpenIsFree(!!s.isFree);
    // Créneau d'avant le réglage : le formulaire propose le public restreint,
    // et c'est l'enregistrement qui le lui donnera vraiment.
    setOpenAudience(s.openAudience ?? "enrolled");
    setIsOpenSeanceModalOpen(true);
    setIsDetailsOpen(false);
  };

  /**
   * Creates (or updates) a séance libre timing.
   *
   * A timing is stored as a normal `sessions` row flagged `isOpen`, so the scan,
   * the présences and the teacher payout keep working unchanged. The single
   * class/group/salle columns hold the FIRST selection (the one the scanner
   * matches on) while the `*_ids` arrays hold the complete multi-selection.
   * A matching `subscriptions` row is created at the same time, which is what
   * makes the timing show up on the Abonnements screen exactly like a
   * hand-made subscription.
   */
  const handleSaveOpenSeance = async () => {
    if (!openModuleId) return alert("Veuillez sélectionner le module de la séance libre.");
    if (openClassIds.length === 0) return alert("Veuillez sélectionner au moins une classe concernée.");
    if (openGroupIds.length === 0) return alert("Veuillez sélectionner au moins un groupe concerné.");
    if (openSalleIds.length === 0) return alert("Veuillez sélectionner au moins une salle.");
    if (!openPeriodStart || !openPeriodEnd) return alert("Veuillez définir la date de début et la date de fin de la période.");
    if (openPeriodStart > openPeriodEnd) return alert("La date de début doit précéder la date de fin.");
    if (openDays.length === 0) return alert("Veuillez sélectionner au moins un jour d'étude dans cette période.");
    // Un créneau OFFERT n'a pas de prix : on ne le demande pas, et le tarif
    // écrit vaut 0 — rien n'est débité à l'élève, rien n'est encaissé par
    // l'école, et l'enseignant n'est pas rémunéré dessus.
    if (!openIsFree && openPrice <= 0) return alert("Veuillez saisir le prix d'une séance.");
    if (openTeacherMode === "existing" && !openTeacherId) return alert("Veuillez sélectionner un enseignant existant.");
    if (openTeacherMode === "passager" && !openPassagerName.trim()) return alert("Veuillez saisir le nom de l'enseignant passager.");

    setSavingOpenSeance(true);
    try {
      let teacherId = openTeacherId;

      // Teacher passager: no login, saved straight into the teachers table so
      // the Enseignants screen can pay him and show his history.
      if (openTeacherMode === "passager") {
        const existingPassager = teachers.find(
          (t) => t.isPassager && `${t.firstName} ${t.lastName}`.trim().toLowerCase() === openPassagerName.trim().toLowerCase(),
        );
        if (existingPassager) {
          teacherId = existingPassager.id;
          if (openPassagerPhone && openPassagerPhone !== existingPassager.phone) {
            updateItem("teachers", existingPassager.id, { phone: openPassagerPhone });
          }
        } else {
          const parts = openPassagerName.trim().split(/\s+/);
          const newTeacher: Teacher = {
            id: uid("tch"),
            firstName: parts[0] ?? openPassagerName.trim(),
            lastName: parts.slice(1).join(" "),
            phone: openPassagerPhone,
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
          teacherId = newTeacher.id;
        }
      }

      warnSalleClash({
        id: editingOpenSession?.id,
        salleIds: openSalleIds,
        days: openDays,
        startTime: `${openStartHour}:${openStartMin}`,
      });

      const title = openTitleOverride.trim() || buildOpenTitle();
      // Séance offerte => tarif 0 partout (créneau + abonnement auto), pour que
      // même une base qui ne connaîtrait pas encore la colonne `is_free` ne
      // débite jamais l'élève sur ce créneau.
      const priceToWrite = openIsFree ? 0 : openPrice;
      const payload = {
        classId: openClassIds[0],
        moduleId: openModuleId,
        groupId: openGroupIds[0],
        salleId: openSalleIds[0],
        teacherId,
        days: openDays,
        startTime: `${openStartHour}:${openStartMin}`,
        endTime: `${openEndHour}:${openEndMin}`,
        isOpen: true,
        title,
        periodStart: openPeriodStart,
        periodEnd: openPeriodEnd,
        classIds: openClassIds,
        groupIds: openGroupIds,
        salleIds: openSalleIds,
        openPrice: priceToWrite,
        isFree: openIsFree,
        openAudience,
      };

      if (editingOpenSession) {
        updateItem("sessions", editingOpenSession.id, payload);
        const sub = subscriptions.find((su) => su.sessionId === editingOpenSession.id);
        if (sub) updateItem("subscriptions", sub.id, { pricePerSession: priceToWrite });
        else push("subscriptions", { id: uid("sub"), sessionId: editingOpenSession.id, pricePerSession: priceToWrite });
      } else {
        const sessionId = uid("ses");
        // L'abonnement auto RÉFÉRENCE le créneau (subscriptions.session_id) :
        // les deux écritures partaient jusqu'ici en parallèle, et quand
        // l'abonnement arrivait le premier Postgres le refusait
        // (« violates foreign key constraint subscriptions_session_id_fkey »).
        // On attend donc que le créneau soit accepté, et on n'écrit
        // l'abonnement que dans ce cas — sinon il resterait orphelin.
        const written = await push("sessions", { id: sessionId, ...payload });
        if (!written) return;
        // Auto-created subscription: this is what makes the timing appear on
        // the Abonnements page as if it had been created there by hand.
        await push("subscriptions", { id: uid("sub"), sessionId, pricePerSession: priceToWrite } as Subscription);
      }

      setIsOpenSeanceModalOpen(false);
      resetOpenForm();
    } finally {
      setSavingOpenSeance(false);
    }
  };

  const handleCreateSession = () => {
    if (!classId || !moduleId || !groupId || !salleId || !teacherId || selectedDays.length === 0) {
      alert("Veuillez remplir tous les champs obligatoires et sélectionner au moins un jour.");
      return;
    }
    warnSalleClash({ salleIds: [salleId], days: selectedDays, startTime: `${startHour}:${startMin}` });

    const newSession: ScheduleSession = {
      id: uid("ses"),
      classId,
      moduleId,
      groupId,
      salleId,
      teacherId,
      days: selectedDays,
      startTime: `${startHour}:${startMin}`,
      endTime: `${endHour}:${endMin}`,
    };
    push("sessions", newSession);
    setIsCreateOpen(false);
    resetForm();
  };

  const handleEditSession = () => {
    if (!selectedSession) return;
    if (!classId || !moduleId || !groupId || !salleId || !teacherId || selectedDays.length === 0) {
      alert("Veuillez remplir tous les champs obligatoires.");
      return;
    }
    warnSalleClash({
      id: selectedSession.id,
      salleIds: [salleId],
      days: selectedDays,
      startTime: `${startHour}:${startMin}`,
    });

    const updated: Partial<ScheduleSession> = {
      classId,
      moduleId,
      groupId,
      salleId,
      teacherId,
      days: selectedDays,
      startTime: `${startHour}:${startMin}`,
      endTime: `${endHour}:${endMin}`,
    };
    updateItem("sessions", selectedSession.id, updated);
    setIsEditOpen(false);
    resetForm();
  };

  const handleDelete = (id: string) => {
    if (confirm("Êtes-vous sûr de vouloir supprimer cet emploi du temps ?")) {
      // The auto-created subscription of a séance libre would otherwise be left
      // behind (Postgres cascades the row, but the local store must follow).
      subscriptions
        .filter((su) => su.sessionId === id)
        .forEach((su) => deleteFrom("subscriptions", su.id));
      deleteFrom("sessions", id);
      setIsDetailsOpen(false);
    }
  };

  const resetForm = () => {
    setClassId("");
    setModuleId("");
    setGroupId("");
    setSalleId("");
    setTeacherId("");
    setSelectedDays([]);
    setStartHour("08");
    setStartMin("00");
    setEndHour("10");
    setEndMin("00");
    setSelectedSession(null);
  };

  const openEdit = (s: ScheduleSession) => {
    setSelectedSession(s);
    setClassId(s.classId);
    setModuleId(s.moduleId);
    setGroupId(s.groupId);
    setSalleId(s.salleId);
    setTeacherId(s.teacherId);
    setSelectedDays(s.days);
    const [sh, sm] = s.startTime.split(":");
    const [eh, em] = s.endTime.split(":");
    setStartHour(sh);
    setStartMin(sm);
    setEndHour(eh);
    setEndMin(em);
    setIsEditOpen(true);
    setIsDetailsOpen(false);
  };

  const openDetails = (s: ScheduleSession) => {
    setSelectedSession(s);
    setIsDetailsOpen(true);
  };

  // Print one timing card: school letterhead + a detailed table (one row per
  // scheduled weekday) with module, group, class level, teacher and salle.
  const handlePrintSession = (s: ScheduleSession) => {
    const L = PRINT_LABELS[language];
    const enrolledCount = getSessionStudents(s.id).length;
    const orderedDays = WEEKDAYS.filter((wd) => s.days.includes(wd.key)).map((wd) => wd.key);
    const printDate = new Date().toLocaleDateString(language === "ar" ? "ar-DZ" : "fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    const rows = orderedDays
      .map(
        (day) => `
          <tr>
            <td style="font-weight:bold;">${L.days[day]}</td>
            <td style="font-family:monospace; font-weight:700;">${s.startTime} – ${s.endTime}</td>
            <td>${getModuleName(s.moduleId)}</td>
            <td>${getGroupName(s.groupId)}</td>
            <td>${getClassName(s.classId)}</td>
            <td>${getTeacherName(s.teacherId)}</td>
            <td>${getSalleName(s.salleId)}</td>
          </tr>`,
      )
      .join("");

    const bodyHtml = `
      ${letterheadHtml(school)}
      ${bannerHtml(L.docTitle, L.printedOn(printDate))}

      <div class="frame frame-info" style="margin-bottom:20px;">
        <h3>${L.infoTitle}</h3>
        <table style="margin-top:0;">
          <tr>
            <td style="width:18%; font-weight:bold; color:#5c567a;">${L.module} :</td>
            <td style="width:32%; font-weight:bold; font-size:1.1em;">${getModuleName(s.moduleId)}</td>
            <td style="width:18%; font-weight:bold; color:#5c567a;">${L.group} :</td>
            <td style="width:32%;">${getGroupName(s.groupId)}</td>
          </tr>
          <tr>
            <td style="font-weight:bold; color:#5c567a;">${L.classLevel} :</td>
            <td>${getClassName(s.classId)}</td>
            <td style="font-weight:bold; color:#5c567a;">${L.teacher} :</td>
            <td>${getTeacherName(s.teacherId)}</td>
          </tr>
          <tr>
            <td style="font-weight:bold; color:#5c567a;">${L.salle} :</td>
            <td>${getSalleName(s.salleId)}</td>
            <td style="font-weight:bold; color:#5c567a;">${L.enrolled} :</td>
            <td><span class="badge badge-primary">${enrolledCount}</span></td>
          </tr>
        </table>
      </div>

      <div class="frame">
        <h3>${L.tableTitle}</h3>
        <table>
          <thead>
            <tr>
              <th>${L.day}</th>
              <th>${L.time}</th>
              <th>${L.module}</th>
              <th>${L.group}</th>
              <th>${L.classLevel}</th>
              <th>${L.teacher}</th>
              <th>${L.salle}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      ${signaturesHtml(L.signTeacher, L.signDirection)}
      ${metaFooterHtml(school.name, language)}
    `;

    printHtmlDocument(
      printDocument({
        title: `${L.docTitle} - ${getModuleName(s.moduleId)} ${getGroupName(s.groupId)}`,
        lang: language,
        bodyHtml,
      }),
    );
  };

  const getSessionStudents = (sessionId: string) => {
    const sub = subscriptions.find((su) => su.sessionId === sessionId);
    if (!sub) return [];
    return students.filter((stu) => stu.subscriptionIds.includes(sub.id));
  };

  const getHours = () => Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const getMinutes = () => ["00", "15", "30", "45"];

  const clearFilters = () => {
    setFilterSessionId("");
    setFilterTeacherId("");
    setFilterSalleId("");
    setFilterClassId("");
    setKindFilter("all");
  };

  /** A séance libre also "belongs" to every class / group / salle of its
   *  multi-selection, not only to the primary one stored in the columns. */
  const sessionCovers = (s: ScheduleSession, kind: "class" | "salle", id: string) => {
    if (kind === "class") return s.classId === id || (s.classIds ?? []).includes(id);
    return s.salleId === id || (s.salleIds ?? []).includes(id);
  };

  // Filter sessions
  const filteredSessions = sessions.filter((s) => {
    if (kindFilter === "cours" && s.isOpen) return false;
    if (kindFilter === "open" && !s.isOpen) return false;
    if (filterSessionId && s.id !== filterSessionId) return false;
    if (filterTeacherId && s.teacherId !== filterTeacherId) return false;
    if (filterSalleId && !sessionCovers(s, "salle", filterSalleId)) return false;
    if (filterClassId && !sessionCovers(s, "class", filterClassId)) return false;
    return true;
  });

  /** Label shown on the cards / calendar for any timing. */
  const sessionTitle = (s: ScheduleSession) =>
    s.isOpen ? s.title || `Séance Libre — ${getModuleName(s.moduleId)}` : getModuleName(s.moduleId);

  const openSessionPrice = (s: ScheduleSession) =>
    subscriptions.find((su) => su.sessionId === s.id)?.pricePerSession ?? s.openPrice ?? 0;

  /** Is a séance libre still inside its date period? */
  const openSessionActive = (s: ScheduleSession) => {
    const today = new Date().toLocaleDateString("fr-CA");
    if (s.periodStart && today < s.periodStart) return false;
    if (s.periodEnd && today > s.periodEnd) return false;
    return true;
  };

  return (
    <div className="space-y-6 text-xs">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader emoji="📅" title="Emploi du Temps" subtitle="Visualisation du calendrier hebdomadaire et planification" />
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
          <Button
            variant="outline"
            onClick={() => { resetOpenForm(); setIsOpenSeanceModalOpen(true); }}
            className="flex items-center gap-2 border-primary/30 text-primary hover:bg-primary-50"
          >
            <Sparkles className="h-4 w-4" /> Créneau Séance Libre
          </Button>
          <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> Créer une Séance
          </Button>
        </div>
      </div>

      {/* Advanced Filter Toolbar */}
      <Card className="border border-line shadow-sm">
        <CardBody className="p-4 space-y-3.5">
          <div className="flex items-center justify-between border-b border-line pb-2.5">
            <span className="font-bold text-ink uppercase tracking-wider text-[10px] flex items-center gap-1.5">
              <Filter className="h-4 w-4 text-primary" /> Filtrer le Calendrier
            </span>
            {(filterSessionId || filterTeacherId || filterClassId || filterSalleId || kindFilter !== "all") && (
              <button onClick={clearFilters} className="text-primary hover:underline font-bold text-[10px] flex items-center gap-1">
                <X className="h-3 w-3" /> Réinitialiser
              </button>
            )}
          </div>

          {/* Type of timing: regular courses vs séances libres */}
          <div className="flex flex-wrap gap-1.5">
            {([
              { key: "all", label: `Tous (${sessions.length})` },
              { key: "cours", label: `Cours (${sessions.filter((s) => !s.isOpen).length})` },
              { key: "open", label: `Séances Libres (${sessions.filter((s) => s.isOpen).length})` },
            ] as const).map((k) => (
              <button
                key={k.key}
                onClick={() => setKindFilter(k.key)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                  kindFilter === k.key ? "bg-primary text-white shadow-sm" : "bg-canvas text-muted hover:text-ink"
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Filter by specific emploi du temps */}
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Séance Spécifique</label>
              <Select value={filterSessionId} onChange={(e) => setFilterSessionId(e.target.value)} className="w-full">
                <option value="">Tous les cours</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.isOpen ? `🎯 ${sessionTitle(s)}` : `${getModuleName(s.moduleId)} - ${getGroupName(s.groupId)}`}
                  </option>
                ))}
              </Select>
            </div>

            {/* Filter by Teacher */}
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Enseignant</label>
              <Select value={filterTeacherId} onChange={(e) => setFilterTeacherId(e.target.value)} className="w-full">
                <option value="">Tous les enseignants</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.firstName} {t.lastName}
                  </option>
                ))}
              </Select>
            </div>

            {/* Filter by Classroom */}
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Salle de Cours</label>
              <Select value={filterSalleId} onChange={(e) => setFilterSalleId(e.target.value)} className="w-full">
                <option value="">Toutes les salles</option>
                {salles.map((sa) => (
                  <option key={sa.id} value={sa.id}>
                    {sa.name}
                  </option>
                ))}
              </Select>
            </div>

            {/* Filter by Class */}
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Classe & Niveau</label>
              <Select value={filterClassId} onChange={(e) => setFilterClassId(e.target.value)} className="w-full">
                <option value="">Toutes les classes</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.type === "cours" ? c.coursLevel : c.formationLevel})
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Layout View Toggle */}
      <div className="flex justify-end items-center gap-2">
        <span className="text-[10px] uppercase font-bold text-muted font-sans mr-1">Affichage :</span>
        <div className="bg-canvas border border-line p-1 rounded-xl flex gap-1">
          <button
            onClick={() => setViewMode("calendar")}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
              viewMode === "calendar"
                ? "bg-primary text-white shadow-sm"
                : "text-muted hover:text-ink hover:bg-canvas/50"
            }`}
          >
            Vue Calendrier
          </button>
          <button
            onClick={() => setViewMode("cards")}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
              viewMode === "cards"
                ? "bg-primary text-white shadow-sm"
                : "text-muted hover:text-ink hover:bg-canvas/50"
            }`}
          >
            Vue Cartes
          </button>
        </div>
      </div>

      {viewMode === "calendar" ? (
        /* TIMETABLE BOARD COLUMN GRID */
        <div className="overflow-x-auto pb-4">
          <div className="grid grid-cols-1 md:grid-cols-7 gap-4 min-w-[900px] md:min-w-0">
            {WEEKDAYS.map((day) => {
              // Filter and sort sessions chronologically for this day
              const daySessions = filteredSessions
                .filter((s) => s.days.includes(day.key))
                .sort((a, b) => a.startTime.localeCompare(b.startTime));

              return (
                <div key={day.key} className="flex flex-col bg-canvas/30 rounded-2xl border border-line p-3 min-h-[420px] space-y-3.5">
                  {/* Column Header */}
                  <div className="border-b border-line pb-2.5 text-center flex justify-between items-center px-1">
                    <span className="font-extrabold text-ink uppercase text-[10px] tracking-wider block capitalize">
                      {day.label}
                    </span>
                    <Badge tone={daySessions.length > 0 ? "primary" : "neutral"} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                      {daySessions.length}
                    </Badge>
                  </div>

                  {/* Day Timetable Cards list */}
                  <div className="flex-1 space-y-2.5 overflow-y-auto max-h-[500px] pr-0.5">
                    {daySessions.length === 0 ? (
                      <div className="h-full flex items-center justify-center py-16 text-center text-muted font-medium italic text-[10px]">
                        Libre
                      </div>
                    ) : (
                      daySessions.map((s) => {
                        const enrolledCount = getSessionStudents(s.id).length;
                        return (
                          <div
                            key={s.id}
                            onClick={() => openDetails(s)}
                            className={`p-3 rounded-xl border cursor-pointer hover:shadow-sm hover:scale-[1.01] transition-all duration-200 space-y-2 ${getSessionColor(
                              s.moduleId
                            )}`}
                          >
                            {/* Timings */}
                            <div className="flex items-center gap-1 text-[9px] font-bold font-mono">
                              <Clock className="h-3 w-3 shrink-0" />
                              <span>{s.startTime} - {s.endTime}</span>
                            </div>

                            {/* Module & Class Info */}
                            <div className="space-y-0.5">
                              <strong className="block text-[11px] font-black leading-tight line-clamp-2">
                                {s.isOpen && <span className="mr-1">🎯</span>}
                                {getModuleName(s.moduleId)}
                              </strong>
                              <span className="block text-[9px] opacity-80 font-bold truncate">
                                {s.isOpen
                                  ? `Séance libre · ${openSessionPrice(s)} DA${s.isFree ? " · 🎁 Offerte" : ""}`
                                  : getClassName(s.classId)}
                              </span>
                            </div>

                            {/* Room & Teacher */}
                            <div className="text-[9px] opacity-90 space-y-1 pt-1.5 border-t border-black/5 dark:border-white/5">
                              <div className="flex items-center gap-1">
                                <User className="h-3 w-3 shrink-0" />
                                <span className="truncate">{getTeacherName(s.teacherId)}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-1 truncate max-w-[65%]">
                                  <MapPin className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{getSalleName(s.salleId)}</span>
                                </span>
                                <Badge tone="success" className="text-[8px] px-1 py-0 font-bold">
                                  {enrolledCount} él.
                                </Badge>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* DETAILED CARDS VIEW */
        <div>
          {filteredSessions.length === 0 ? (
            <div className="text-center p-12 bg-canvas/30 border border-line border-dashed rounded-2xl text-muted text-xs">
              Aucune séance d'emploi du temps ne correspond aux filtres actuels.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSessions.map((s) => {
                const enrolledCount = getSessionStudents(s.id).length;
                return (
                  <Card key={s.id} className={`hover:shadow-md transition-all duration-200 ${getSessionColor(s.moduleId)}`}>
                    <CardBody className="p-4 space-y-3 flex flex-col justify-between h-full">
                      <div className="space-y-2">
                        {/* Header: Module + Group Badge */}
                        <div className="flex justify-between items-start">
                          <div className="min-w-0">
                            <strong className="block text-sm font-black text-ink leading-tight line-clamp-2">
                              {sessionTitle(s)}
                            </strong>
                            <span className="text-[10px] font-bold opacity-80 mt-0.5 block truncate">
                              {s.isOpen
                                ? (s.classIds ?? [s.classId]).map(getClassName).join(" · ")
                                : getClassName(s.classId)}
                            </span>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            {s.isOpen && (
                              <Badge tone={openSessionActive(s) ? "success" : "neutral"} className="font-bold text-[9px]">
                                {openSessionActive(s) ? "Séance Libre" : "Période terminée"}
                              </Badge>
                            )}
                            {s.isOpen && s.isFree && (
                              <Badge tone="warning" className="font-bold text-[9px]">🎁 Offerte</Badge>
                            )}
                            <Badge tone="primary" className="font-bold">
                              {s.isOpen
                                ? `${(s.groupIds ?? [s.groupId]).length} groupe(s)`
                                : getGroupName(s.groupId)}
                            </Badge>
                          </div>
                        </div>

                        {/* Room & Teacher & Schedule info */}
                        <div className="space-y-1.5 pt-2 border-t border-black/5 dark:border-white/5 text-[11px] text-ink/90">
                          <div className="flex items-center gap-2">
                            <User className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span>
                              Enseignant: <strong>{getTeacherName(s.teacherId)}</strong>
                              {teachers.find((t) => t.id === s.teacherId)?.isPassager && (
                                <span className="ml-1 text-[9px] font-bold px-1 py-0.5 rounded bg-warning/15 text-warning">
                                  Passager
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span>
                              Salle:{" "}
                              <strong>
                                {s.isOpen
                                  ? (s.salleIds ?? [s.salleId]).map(getSalleName).join(" + ")
                                  : getSalleName(s.salleId)}
                              </strong>
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span>Horaires: <strong className="font-mono">{s.startTime} - {s.endTime}</strong></span>
                          </div>
                          {s.isOpen && (
                            <>
                              <div className="flex items-center gap-2">
                                <CalendarIcon className="h-3.5 w-3.5 text-primary shrink-0" />
                                <span>
                                  Période:{" "}
                                  <strong className="font-mono">
                                    {formatDateFr(s.periodStart)} → {formatDateFr(s.periodEnd)}
                                  </strong>
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Users className="h-3.5 w-3.5 text-primary shrink-0" />
                                <span>
                                  Tarif séance:{" "}
                                  {s.isFree ? (
                                    <strong className="text-warning">Offerte — 0 DA</strong>
                                  ) : (
                                    <strong className="text-primary">{openSessionPrice(s)} DA</strong>
                                  )}
                                </span>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Days list */}
                        <div className="pt-1 flex flex-wrap gap-1">
                          {s.days.map((dayKey) => (
                            <Badge key={dayKey} tone="neutral" className="text-[9px] font-bold uppercase">
                              {WEEKDAYS.find((wd) => wd.key === dayKey)?.label || dayKey}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      {/* Footer Actions & Count */}
                      <div className="flex justify-between items-center pt-3 border-t border-black/5 dark:border-white/5 mt-auto">
                        <Badge tone="success" className="text-[10px] font-bold flex items-center gap-1">
                          <Users className="h-3 w-3" /> {enrolledCount} élève(s)
                        </Badge>

                        <div className="flex gap-1.5">
                          <button
                            onClick={() => openDetails(s)}
                            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-ink/80 transition-colors"
                            title="Consulter les détails"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handlePrintSession(s)}
                            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-ink/80 transition-colors"
                            title="Imprimer cet horaire"
                          >
                            <Printer className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => (s.isOpen ? openEditOpenSeance(s) : openEdit(s))}
                            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-primary transition-colors"
                            title="Modifier"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(s.id)}
                            className="p-1.5 rounded-lg hover:bg-danger/10 text-danger transition-colors"
                            title="Supprimer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Séance libre: create / edit a timing                             */}
      {/* ---------------------------------------------------------------- */}
      <Modal
        open={isOpenSeanceModalOpen}
        onClose={() => setIsOpenSeanceModalOpen(false)}
        title={editingOpenSession ? "Modifier le créneau de séance libre" : "Créer un créneau de séance libre"}
        wide
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ---- Left: what & who -------------------------------------- */}
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-muted font-sans">Module *</label>
                <button onClick={() => setShowAddModule(!showAddModule)} className="text-xs text-primary hover:underline">
                  + Nouveau module
                </button>
              </div>
              {showAddModule ? (
                <div className="flex gap-2">
                  <Input
                    value={newModuleName}
                    onChange={(e) => setNewModuleName(e.target.value)}
                    placeholder="Nom du module"
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      if (!newModuleName.trim()) return;
                      const newId = uid("mod");
                      push("modules", { id: newId, name: newModuleName });
                      setOpenModuleId(newId);
                      setNewModuleName("");
                      setShowAddModule(false);
                    }}
                  >
                    Créer
                  </Button>
                </div>
              ) : (
                <Select value={openModuleId} onChange={(e) => setOpenModuleId(e.target.value)} className="w-full">
                  <option value="">Sélectionner un module</option>
                  {modules.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </Select>
              )}
            </div>

            {/* Multi-selects: classes / groupes / salles */}
            {([
              { label: "Classes concernées *", items: classes.map((c) => ({ id: c.id, name: `${c.name} (${c.type === "cours" ? c.coursLevel : c.formationLevel})` })), selected: openClassIds, set: setOpenClassIds },
              { label: "Groupes concernés *", items: groups, selected: openGroupIds, set: setOpenGroupIds },
              { label: "Salles *", items: salles, selected: openSalleIds, set: setOpenSalleIds },
            ] as const).map((block) => (
              <div key={block.label}>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-muted font-sans">{block.label}</label>
                  <span className="text-[10px] font-bold text-primary">{block.selected.length} sélectionné(s)</span>
                </div>
                <div className="border border-line rounded-xl max-h-32 overflow-y-auto p-1.5 bg-canvas/30 space-y-1">
                  {block.items.length === 0 ? (
                    <p className="text-[10px] text-muted italic p-2">Aucun élément disponible.</p>
                  ) : (
                    block.items.map((it) => {
                      const active = block.selected.includes(it.id);
                      return (
                        <button
                          key={it.id}
                          type="button"
                          onClick={() => block.set(toggleIn(block.selected, it.id))}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                            active ? "bg-primary text-white font-bold" : "hover:bg-primary-50 text-ink"
                          }`}
                        >
                          <span className="truncate">{it.name}</span>
                          <input type="checkbox" checked={active} readOnly className="h-3.5 w-3.5 shrink-0" />
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ))}

            {/* Public du créneau : à qui la réception pourra le vendre. Les cases
                ci-dessus décrivaient le créneau ; celle-ci dit qui y entre. */}
            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5 font-sans">
                Qui peut assister à cette séance libre ? *
              </label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  {
                    key: "enrolled",
                    title: "Ses classes et groupes",
                    count: audienceCounts.enrolled,
                  },
                  {
                    key: "filiere",
                    title: "Toute la filière",
                    count: audienceCounts.filiere,
                  },
                ] as const).map((choice) => {
                  const active = openAudience === choice.key;
                  return (
                    <button
                      key={choice.key}
                      type="button"
                      onClick={() => setOpenAudience(choice.key)}
                      className={`p-2.5 rounded-xl border text-start text-xs transition-all ${
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-line bg-surface text-muted hover:bg-primary-50/40"
                      }`}
                    >
                      <span className="block font-bold">{choice.title}</span>
                      <span className={`mt-0.5 block text-[10px] ${active ? "text-primary/80" : "text-muted"}`}>
                        {choice.count} élève(s) concerné(s)
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted mt-1.5 leading-relaxed">
                {openAudience === "enrolled" ? (
                  <>
                    Seuls les élèves dont l&apos;emploi du temps passe par les{" "}
                    <strong>classes ET les groupes cochés</strong> ci-dessus pourront être
                    encaissés sur ce créneau.
                  </>
                ) : (
                  <>
                    Tout élève d&apos;une classe de la <strong>même filière</strong> pourra être
                    encaissé dessus, même s&apos;il suit un autre groupe ou un autre emploi du temps.
                  </>
                )}{" "}
                Un <strong>passager</strong> occasionnel, lui, reste accepté dans les deux cas : il
                n&apos;a ni classe ni filière.
              </p>
            </div>

            {/* Teacher: existing or passager */}
            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5 font-sans">Enseignant *</label>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setOpenTeacherMode("existing")}
                  className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${
                    openTeacherMode === "existing" ? "border-primary bg-primary/10 text-primary" : "border-line bg-surface text-muted"
                  }`}
                >
                  Enseignant existant
                </button>
                <button
                  type="button"
                  onClick={() => setOpenTeacherMode("passager")}
                  className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${
                    openTeacherMode === "passager" ? "border-primary bg-primary/10 text-primary" : "border-line bg-surface text-muted"
                  }`}
                >
                  Enseignant passager
                </button>
              </div>

              {openTeacherMode === "existing" ? (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                    <Input
                      value={openTeacherSearch}
                      onChange={(e) => setOpenTeacherSearch(e.target.value)}
                      placeholder="Rechercher un enseignant par nom..."
                      className="pl-9"
                    />
                  </div>
                  <div className="border border-line rounded-xl max-h-32 overflow-y-auto p-1.5 bg-canvas/30 space-y-1">
                    {teachers
                      .filter((t) =>
                        !openTeacherSearch ||
                        `${t.firstName} ${t.lastName} ${t.phone}`.toLowerCase().includes(openTeacherSearch.toLowerCase()),
                      )
                      .map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => { setOpenTeacherId(t.id); setOpenTeacherSearch(`${t.firstName} ${t.lastName}`); }}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                            openTeacherId === t.id ? "bg-primary text-white font-bold" : "hover:bg-primary-50 text-ink"
                          }`}
                        >
                          <span className="truncate">
                            {t.firstName} {t.lastName}
                            {t.isPassager && <span className="ml-1 opacity-70">(passager)</span>}
                          </span>
                          <span className={openTeacherId === t.id ? "text-white/80" : "text-muted"}>
                            {t.paymentType === "monthly" ? "Mensuel" : `${t.percentage ?? 0}%`}
                          </span>
                        </button>
                      ))}
                  </div>
                  <p className="text-[10px] text-muted leading-relaxed">
                    {openIsFree
                      ? "Séance offerte : l'enseignant n'est pas rémunéré sur ce créneau."
                      : "L'enseignant est rémunéré sur cette séance libre exactement comme sur ses autres séances (sa part est calculée à chaque présence selon son contrat)."}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    value={openPassagerName}
                    onChange={(e) => setOpenPassagerName(e.target.value)}
                    placeholder="Nom complet de l'enseignant passager"
                  />
                  <Input
                    value={openPassagerPhone}
                    onChange={(e) => setOpenPassagerPhone(e.target.value)}
                    placeholder="Téléphone (optionnel)"
                  />
                  <p className="text-[10px] text-muted leading-relaxed">
                    Il sera enregistré dans l&apos;interface <strong>Enseignants</strong> sans compte de connexion,
                    avec uniquement les actions <strong>Payer</strong> et <strong>Détails</strong>.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ---- Right: when & how much -------------------------------- */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Début de la période *</label>
                <Input type="date" value={openPeriodStart} onChange={(e) => setOpenPeriodStart(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Fin de la période *</label>
                <Input type="date" value={openPeriodEnd} onChange={(e) => setOpenPeriodEnd(e.target.value)} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-2 font-sans">
                Jours d&apos;étude dans cette période *
              </label>
              {daysAvailableInPeriod.length === 0 ? (
                <p className="text-[10px] text-muted italic border border-dashed border-line rounded-xl p-3">
                  Choisissez d&apos;abord la période : seuls les jours réellement présents dans cet
                  intervalle seront proposés.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {WEEKDAYS.filter((d) => daysAvailableInPeriod.includes(d.key)).map((day) => {
                    const active = openDays.includes(day.key);
                    return (
                      <Button
                        key={day.key}
                        variant={active ? "primary" : "outline"}
                        onClick={() => setOpenDays(active ? openDays.filter((d) => d !== day.key) : [...openDays, day.key])}
                        size="sm"
                        className="w-full text-start py-2 justify-between"
                      >
                        <span>{day.label}</span>
                        {active && <span className="text-[10px] bg-white/25 px-1.5 rounded">✔</span>}
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Heure de début</label>
                <div className="flex gap-1.5">
                  <Select value={openStartHour} onChange={(e) => setOpenStartHour(e.target.value)} className="flex-1">
                    {getHours().map((h) => <option key={h} value={h}>{h} H</option>)}
                  </Select>
                  <Select value={openStartMin} onChange={(e) => setOpenStartMin(e.target.value)} className="flex-1">
                    {getMinutes().map((m) => <option key={m} value={m}>{m} Min</option>)}
                  </Select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Heure de fin</label>
                <div className="flex gap-1.5">
                  <Select value={openEndHour} onChange={(e) => setOpenEndHour(e.target.value)} className="flex-1">
                    {getHours().map((h) => <option key={h} value={h}>{h} H</option>)}
                  </Select>
                  <Select value={openEndMin} onChange={(e) => setOpenEndMin(e.target.value)} className="flex-1">
                    {getMinutes().map((m) => <option key={m} value={m}>{m} Min</option>)}
                  </Select>
                </div>
              </div>
            </div>

            {/* Séance libre OFFERTE — la question est posée AVANT le prix :
                quand le créneau est offert, le prix n'est plus demandé du tout
                (aucun débit élève, aucun encaissement école, aucune
                rémunération enseignant sur ce créneau). */}
            <label
              className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-xs transition-colors ${
                openIsFree ? "border-warning/50 bg-warning/10" : "border-line bg-canvas/40 hover:bg-primary-50/40"
              }`}
            >
              <input
                type="checkbox"
                checked={openIsFree}
                onChange={(e) => {
                  setOpenIsFree(e.target.checked);
                  // Le prix saisi avant de cocher ne doit pas rester : un
                  // créneau offert vaut 0 DA, partout.
                  if (e.target.checked) setOpenPrice(0);
                }}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span>
                <strong className="block text-ink">🎁 Séance libre offerte (gratuite)</strong>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">
                  Aucun prix n&apos;est demandé pour ce créneau. Chaque présence enregistrée dessus est{" "}
                  <strong>offerte</strong> : le solde de l&apos;élève n&apos;est pas débité,
                  l&apos;école n&apos;encaisse rien et{" "}
                  <strong>l&apos;enseignant n&apos;est pas rémunéré</strong> sur cette séance.
                </span>
              </span>
            </label>

            {!openIsFree && (
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Prix d&apos;une séance (DA) *</label>
                <Input
                  type="number"
                  min={0}
                  value={openPrice || ""}
                  onChange={(e) => setOpenPrice(Number(e.target.value))}
                  placeholder="Ex: 800"
                />
                <p className="text-[10px] text-muted mt-1 leading-relaxed">
                  Un abonnement est créé automatiquement à ce tarif : le créneau apparaîtra dans
                  l&apos;interface <strong>Abonnements</strong> comme s&apos;il y avait été saisi à la main.
                </p>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Nom du créneau</label>
              <Input
                value={openTitleOverride}
                onChange={(e) => setOpenTitleOverride(e.target.value)}
                placeholder={buildOpenTitle()}
              />
              <div className="bg-canvas/50 border border-line rounded-xl p-3 text-xs mt-2">
                <span className="text-[10px] text-muted block font-semibold mb-1 font-sans">Nom enregistré</span>
                <div className="font-bold text-ink break-words">{openTitleOverride.trim() || buildOpenTitle()}</div>
                {openSeanceCount > 0 && (
                  <div className="text-[10px] text-muted mt-1.5">
                    {openSeanceCount} séance(s) sur la période · {openClassIds.length} classe(s) ·{" "}
                    {openGroupIds.length} groupe(s) · {openSalleIds.length} salle(s)
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsOpenSeanceModalOpen(false)}>Annuler</Button>
          <Button onClick={handleSaveOpenSeance} disabled={savingOpenSeance}>
            {savingOpenSeance ? "Enregistrement..." : editingOpenSession ? "Enregistrer" : "Créer le créneau"}
          </Button>
        </div>
      </Modal>

      {/* Creation Modal */}
      <Modal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Créer un emploi du temps" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left panel - core drop downs */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Classe</label>
              <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-full">
                <option value="">Sélectionner une classe</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.type === "cours" ? c.coursLevel : c.formationLevel})
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-muted font-sans">Module</label>
                <button onClick={() => setShowAddModule(!showAddModule)} className="text-xs text-primary hover:underline">
                  + Nouveau module
                </button>
              </div>
              {showAddModule ? (
                <div className="flex gap-2">
                  <Input
                    value={newModuleName}
                    onChange={(e) => setNewModuleName(e.target.value)}
                    placeholder="Nom du module"
                    className="flex-1"
                  />
                  <Button size="sm" onClick={handleCreateModule}>Créer</Button>
                </div>
              ) : (
                <Select value={moduleId} onChange={(e) => setModuleId(e.target.value)} className="w-full">
                  <option value="">Sélectionner un module</option>
                  {modules.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-muted font-sans">Groupe</label>
                <button onClick={() => setShowAddGroup(!showAddGroup)} className="text-xs text-primary hover:underline">
                  + Nouveau groupe
                </button>
              </div>
              {showAddGroup ? (
                <div className="flex gap-2">
                  <Input
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="Nom du groupe (ex: Groupe C)"
                    className="flex-1"
                  />
                  <Button size="sm" onClick={handleCreateGroup}>Créer</Button>
                </div>
              ) : (
                <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="w-full">
                  <option value="">Sélectionner un groupe</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-muted font-sans">Salle</label>
                <button onClick={() => setShowAddSalle(!showAddSalle)} className="text-xs text-primary hover:underline">
                  + Nouvelle salle
                </button>
              </div>
              {showAddSalle ? (
                <div className="flex gap-2">
                  <Input
                    value={newSalleName}
                    onChange={(e) => setNewSalleName(e.target.value)}
                    placeholder="Nom de la salle"
                    className="flex-1"
                  />
                  <Button size="sm" onClick={handleCreateSalle}>Créer</Button>
                </div>
              ) : (
                <Select value={salleId} onChange={(e) => setSalleId(e.target.value)} className="w-full">
                  <option value="">Sélectionner une salle</option>
                  {salles.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Enseignant</label>
              <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="w-full">
                <option value="">Sélectionner un enseignant</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.firstName} {t.lastName}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* Right panel - days & times */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-2 font-sans">Sélectionner les jours de cours</label>
              <div className="grid grid-cols-2 gap-2">
                {WEEKDAYS.map((day) => {
                  const active = selectedDays.includes(day.key);
                  return (
                    <Button
                      key={day.key}
                      variant={active ? "primary" : "outline"}
                      onClick={() => toggleDay(day.key)}
                      size="sm"
                      className="w-full text-start py-2 justify-between"
                    >
                      <span>{day.label}</span>
                      {active && <span className="text-[10px] bg-white/25 px-1.5 rounded">✔</span>}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Heure de début</label>
              <div className="flex gap-2">
                <Select value={startHour} onChange={(e) => setStartHour(e.target.value)} className="flex-1">
                  {getHours().map((h) => <option key={h} value={h}>{h} H</option>)}
                </Select>
                <Select value={startMin} onChange={(e) => setStartMin(e.target.value)} className="flex-1">
                  {getMinutes().map((m) => <option key={m} value={m}>{m} Min</option>)}
                </Select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Heure de fin</label>
              <div className="flex gap-2">
                <Select value={endHour} onChange={(e) => setEndHour(e.target.value)} className="flex-1">
                  {getHours().map((h) => <option key={h} value={h}>{h} H</option>)}
                </Select>
                <Select value={endMin} onChange={(e) => setEndMin(e.target.value)} className="flex-1">
                  {getMinutes().map((m) => <option key={m} value={m}>{m} Min</option>)}
                </Select>
              </div>
            </div>

            {/* Generated Name Preview */}
            <div className="bg-canvas/50 border border-line rounded-xl p-3 text-xs">
              <span className="text-[10px] text-muted block font-semibold mb-1 font-sans">Nom suggéré de l'emploi</span>
              <div className="font-bold text-ink line-clamp-2">
                {classId ? classes.find((c) => c.id === classId)?.name : "?"} -{" "}
                {moduleId ? getModuleName(moduleId) : "?"} (Gr: {groupId ? getGroupName(groupId) : "?"} / Salle:{" "}
                {salleId ? getSalleName(salleId) : "?"}) par {teacherId ? getTeacherName(teacherId) : "?"}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleCreateSession}>Créer</Button>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Modifier l'emploi du temps" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Classe</label>
              <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-full">
                <option value="">Sélectionner une classe</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.type === "cours" ? c.coursLevel : c.formationLevel})
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Module</label>
              <Select value={moduleId} onChange={(e) => setModuleId(e.target.value)} className="w-full">
                <option value="">Sélectionner un module</option>
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Groupe</label>
              <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="w-full">
                <option value="">Sélectionner un groupe</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Salle</label>
              <Select value={salleId} onChange={(e) => setSalleId(e.target.value)} className="w-full">
                <option value="">Sélectionner une salle</option>
                {salles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Enseignant</label>
              <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="w-full">
                <option value="">Sélectionner un enseignant</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.firstName} {t.lastName}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-2 font-sans">Sélectionner les jours</label>
              <div className="grid grid-cols-2 gap-2">
                {WEEKDAYS.map((day) => {
                  const active = selectedDays.includes(day.key);
                  return (
                    <Button
                      key={day.key}
                      variant={active ? "primary" : "outline"}
                      onClick={() => toggleDay(day.key)}
                      size="sm"
                      className="w-full text-start py-2 justify-between"
                    >
                      <span>{day.label}</span>
                      {active && <span className="text-[10px]">✔</span>}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Heure de début</label>
              <div className="flex gap-2">
                <Select value={startHour} onChange={(e) => setStartHour(e.target.value)} className="flex-1">
                  {getHours().map((h) => <option key={h} value={h}>{h} H</option>)}
                </Select>
                <Select value={startMin} onChange={(e) => setStartMin(e.target.value)} className="flex-1">
                  {getMinutes().map((m) => <option key={m} value={m}>{m} Min</option>)}
                </Select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Heure de fin</label>
              <div className="flex gap-2">
                <Select value={endHour} onChange={(e) => setEndHour(e.target.value)} className="flex-1">
                  {getHours().map((h) => <option key={h} value={h}>{h} H</option>)}
                </Select>
                <Select value={endMin} onChange={(e) => setEndMin(e.target.value)} className="flex-1">
                  {getMinutes().map((m) => <option key={m} value={m}>{m} Min</option>)}
                </Select>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsEditOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleEditSession}>Enregistrer</Button>
        </div>
      </Modal>

      {/* Details Modal */}
      <Modal open={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Détails de la Séance" wide>
        {selectedSession && (
          <div className="space-y-6">
            {selectedSession.isOpen && (
              <div className="rounded-xl border border-primary/25 bg-primary-50/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-[10px] text-primary block uppercase font-bold tracking-wider">
                      🎯 Créneau Séance Libre
                    </span>
                    <strong className="text-ink block text-sm break-words">{sessionTitle(selectedSession)}</strong>
                  </div>
                  <Badge tone={openSessionActive(selectedSession) ? "success" : "neutral"} className="font-bold">
                    {formatDateFr(selectedSession.periodStart)} → {formatDateFr(selectedSession.periodEnd)}
                  </Badge>
                </div>
                <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-[10px] text-muted block uppercase">Tarif séance</span>
                    {selectedSession.isFree ? (
                      <strong className="text-warning">🎁 Offerte — 0 DA</strong>
                    ) : (
                      <strong className="text-primary">{openSessionPrice(selectedSession)} DA</strong>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] text-muted block uppercase">Classes</span>
                    <strong className="text-ink">
                      {(selectedSession.classIds ?? [selectedSession.classId]).map(getClassName).join(" · ")}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted block uppercase">Groupes</span>
                    <strong className="text-ink">
                      {(selectedSession.groupIds ?? [selectedSession.groupId]).map(getGroupName).join(" · ")}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted block uppercase">Salles</span>
                    <strong className="text-ink">
                      {(selectedSession.salleIds ?? [selectedSession.salleId]).map(getSalleName).join(" · ")}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-primary-50/50 rounded-xl p-4 border border-line">
              <div>
                <span className="text-[10px] text-muted block uppercase font-sans">Module / Matière</span>
                <span className="font-bold text-ink">{getModuleName(selectedSession.moduleId)}</span>
              </div>
              <div>
                <span className="text-[10px] text-muted block uppercase font-sans">Classe & Niveau</span>
                <span className="font-semibold text-ink">{getClassName(selectedSession.classId)}</span>
              </div>
              <div>
                <span className="text-[10px] text-muted block uppercase font-sans">Groupe / Salle</span>
                <span className="font-semibold text-ink">
                  {getGroupName(selectedSession.groupId)} - {getSalleName(selectedSession.salleId)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-muted block uppercase font-sans">Enseignant</span>
                <span className="font-semibold text-ink">
                  {getTeacherName(selectedSession.teacherId)}
                  {teachers.find((t) => t.id === selectedSession.teacherId)?.isPassager && (
                    <Badge tone="warning" className="ml-1.5 text-[9px]">Passager</Badge>
                  )}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-bold text-ink mb-2.5 flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-primary" /> Jours & Horaires
                </h4>
                <div className="bg-surface border border-line p-4 rounded-xl space-y-3">
                  <div className="flex justify-between items-center text-xs border-b border-line pb-2">
                    <span className="text-muted">Heure de début:</span>
                    <strong className="text-primary font-bold">{selectedSession.startTime}</strong>
                  </div>
                  <div className="flex justify-between items-center text-xs border-b border-line pb-2">
                    <span className="text-muted">Heure de fin:</span>
                    <strong className="text-primary font-bold">{selectedSession.endTime}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted block mb-1.5 font-sans">Jours programmés:</span>
                    <div className="flex flex-wrap gap-1">
                      {selectedSession.days.map((d) => (
                        <Badge key={d} tone="primary" className="uppercase text-[9px] font-bold">
                          {WEEKDAYS.find((wd) => wd.key === d)?.label || d}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-ink mb-2.5 flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-primary" /> Étudiants Inscrits ({getSessionStudents(selectedSession.id).length})
                </h4>
                <div className="bg-surface border border-line p-3 rounded-xl max-h-48 overflow-y-auto space-y-2">
                  {getSessionStudents(selectedSession.id).length === 0 ? (
                    <p className="text-xs text-muted italic p-4 text-center">Aucun étudiant inscrit à cette séance.</p>
                  ) : (
                    getSessionStudents(selectedSession.id).map((stu) => (
                      <div key={stu.id} className="flex justify-between items-center text-xs bg-canvas/30 p-2.5 rounded-lg border border-line/50">
                        <div>
                          <span className="font-bold text-ink block">{stu.firstName} {stu.lastName}</span>
                          <span className="text-[10px] text-muted">{stu.phone}</span>
                        </div>
                        <Badge tone={stu.balance < 0 ? "danger" : "primary"} className="font-bold">
                          {stu.balance} DA
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Admin actions block */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-4 border-t border-line">
              <div className="flex gap-2">
                <Button variant="outline" className="flex items-center gap-1 text-xs text-ink" onClick={() => handlePrintSession(selectedSession)}>
                  <Printer className="h-4 w-4" /> Imprimer
                </Button>
                <Button
                  variant="outline"
                  className="flex items-center gap-1 text-xs text-ink"
                  onClick={() => (selectedSession.isOpen ? openEditOpenSeance(selectedSession) : openEdit(selectedSession))}
                >
                  <Edit className="h-4 w-4" /> Modifier
                </Button>
                <Button variant="outline" className="flex items-center gap-1 text-xs text-danger border-danger/20 hover:bg-danger/5" onClick={() => handleDelete(selectedSession.id)}>
                  <Trash2 className="h-4 w-4 text-danger" /> Supprimer la Séance
                </Button>
              </div>
              <Button onClick={() => setIsDetailsOpen(false)}>Fermer</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
