"use client";

import { useMemo, useState } from "react";
import { useData, uid } from "@/lib/store/data";
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
  Calendar,
  Search,
  MoreVertical,
  Printer,
  X,
  Check,
  Clock,
  Filter,
  LayoutGrid,
  Table as TableIcon,
  User,
  MapPin,
  Users,
} from "lucide-react";
import type { Day, IndependentSession, SchoolClass, Student } from "@/lib/types";
import {
  cascadeOfClass,
  filiereOptionsOf,
  levelOptionsOf,
  matchedClassesOf,
  yearOptionsOf,
  type LevelKey,
} from "@/lib/classCascade";
import { printHtmlDocument } from "@/lib/print";
import { checkOpenSeanceAudience } from "@/lib/seanceAudience";
import {
  DAY_LABELS_FR,
  classCascadeLabel,
  dayOfIsoDate,
  formatDateFr,
  freePeriodCovering,
  isExpiredOpenSeance,
  matchesAllWords,
  todayIso,
} from "@/lib/helpers";
import { buildFreeSeanceTicket } from "@/lib/reports/freeSeanceTicket";
import { useSettings } from "@/lib/store/settings";
import { useCanSeeGains, useSession } from "@/lib/store/session";

/** Everything the séance libre receipt needs, captured at creation time. */
interface CasualReceiptData {
  personName: string;
  isRegisteredStudent: boolean;
  /** neither a known student nor a typed name: an anonymous passager */
  isAnonymous?: boolean;
  itemLabel: string;
  moduleName?: string;
  teacherName?: string;
  classLabel?: string;
  salleLabel?: string;
  timeLabel?: string;
  daysLabel?: string;
  price: number;
  /** séance offerte: nothing was cashed, this is what it would have cost */
  isFree?: boolean;
  waived?: number;
  date: string;
  createdAt: string;
  // ---- Ce que le bon de séance libre imprime en plus ---------------------
  /** téléphone saisi au guichet (passager) ou lu sur la fiche (élève) */
  phone?: string;
  rfid?: string;
  /** scolarité déclarée, en clair : « Lycée · 3eme Année · Sciences » */
  schooling?: string;
  balanceBefore?: number;
  balanceAfter?: number;
  studentIsFree?: boolean;
  /** part de l'enseignant posée sur CETTE séance (undefined = taux habituel) */
  teacherPercentage?: number;
  teacherAmount?: number;
}

/** One searchable item the reception can attach a séance libre to: either a
 *  regular course module, or a "séance libre" timing created in the planner. */
interface SeanceOption {
  key: string;
  kind: "cours" | "timing";
  label: string;
  price: number;
  sessionId: string;
  moduleName: string;
  classLabel: string;
  groupLabel: string;
  salleLabel: string;
  teacherName: string;
  teacherIsPassager: boolean;
  daysLabel: string;
  timeLabel: string;
  periodLabel?: string;
  /** jours de la semaine du créneau — sert à ne proposer que ceux du JOUR
   *  de la séance, ce que le guichet demande d'abord */
  days: Day[];
  /** module du créneau : le filtre « matière » porte sur lui */
  moduleId: string;
  teacherId: string;
  startTime: string;
  endTime: string;
  /** the whole séance libre timing is offered — every présence on it is free */
  sessionIsFree: boolean;
  /** classes the timing covers — a séance libre spans several of them. A
   *  période gratuite applies as soon as it covers ONE of them. */
  classIds: string[];
}

const DAY_LABELS: Record<string, string> = {
  saturday: "Sam",
  sunday: "Dim",
  monday: "Lun",
  tuesday: "Mar",
  wednesday: "Mer",
  thursday: "Jeu",
  friday: "Ven",
};

export function IndependentPage() {
  const {
    school,
    independent,
    teachers,
    students,
    subscriptions,
    sessions,
    modules,
    classes,
    filieres,
    groups,
    salles,
    freePeriods,
    push,
    deleteFrom,
    updateItem,
    chargeStudent,
  } = useData();
  const { language } = useSettings();
  /** Un compte de réception encaisse ; il ne voit pas ce que l'école gagne. */
  const canSeeGains = useCanSeeGains();
  /** Qui tient le guichet : la caisse doit pouvoir nommer qui a encaissé. */
  const sessionUser = useSession((st) => st.user);

  // Modals
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedCasual, setSelectedCasual] = useState<IndependentSession | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Main list: search / filters / layout
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [listSearch, setListSearch] = useState("");
  const [payerFilter, setPayerFilter] = useState<"all" | "student" | "passager">("all");
  const [billingFilter, setBillingFilter] = useState<"all" | "paid" | "free">("all");
  const [kindFilter, setKindFilter] = useState<"all" | "cours" | "timing">("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Form: séance libre
  const [studentSearchQuery, setStudentSearchQuery] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [itemSearchQuery, setItemSearchQuery] = useState("");
  /** Restrict the list to the emplois du temps the picked student follows. */
  const [onlyStudentSeances, setOnlyStudentSeances] = useState(false);
  const [selectedItem, setSelectedItem] = useState<SeanceOption | null>(null);
  const [casualDate, setCasualDate] = useState(todayIso());

  /**
   * LE GUICHET SAISIT UNE SÉANCE LIBRE DANS CET ORDRE.
   *
   * 1. Qui ? — un élève inscrit qu'on cherche, ou un passager dont on tape le
   *    nom (et, si on l'a, le téléphone).
   * 2. Sa scolarité — classe, année, filière. Pour un élève inscrit, les trois
   *    se remplissent tout seuls depuis son emploi du temps, et restent
   *    modifiables : un élève peut venir suivre la séance d'un autre niveau.
   * 3. La matière — FACULTATIVE : sans elle, tous les créneaux du jour sont
   *    proposés.
   * 4. Le créneau du JOUR de la séance qui correspond à tout ça.
   * 5. Le prix.
   * 6. Éventuellement, la part de l'enseignant sur CETTE séance.
   *
   * L'écran précédent posait la question 4 en premier, sur la liste entière des
   * créneaux de l'école, tous jours confondus — il fallait connaître le nom du
   * créneau par cœur pour trouver celui de l'après-midi.
   */
  const [passagerPhone, setPassagerPhone] = useState("");
  const [formLevel, setFormLevel] = useState<LevelKey>("");
  const [formYear, setFormYear] = useState("");
  const [formFiliereId, setFormFiliereId] = useState("");
  /** Matière choisie — vide = toutes. */
  const [formModuleId, setFormModuleId] = useState("");
  /** Ne proposer que les créneaux du jour de la séance (le cas courant). On
   *  peut l'élargir : une séance de rattrapage se saisit parfois le lendemain. */
  const [onlyThatDay, setOnlyThatDay] = useState(true);

  /**
   * « Cette séance-là rémunère l'enseignant à TEL taux. »
   *
   * Désactivé (le cas courant) : la séance rejoint les présences du créneau et
   * l'enseignant en touche son pourcentage habituel — l'élève compte comme un
   * présent de plus. Activé : la séance sort du lot, se chiffre à son propre
   * taux, et apparaît dans une colonne à part de l'écran de règlement.
   */
  const [teacherShareOn, setTeacherShareOn] = useState(false);
  const [teacherSharePct, setTeacherSharePct] = useState<number>(50);
  const [customPrice, setCustomPrice] = useState<number | null>(null);
  // "Séance offerte": the cours is followed as usual but nobody is paid on it —
  // the school cashes nothing and the teacher earns no share for it.
  const [isFreeSeance, setIsFreeSeance] = useState(false);
  // Explicit cash-in confirmation: the agent validates the amount received
  // before the séance is written. Offered séances need no validation.
  const [paymentValidated, setPaymentValidated] = useState(false);

  // Once a séance libre is created, immediately offer to print its receipt.
  const [receiptData, setReceiptData] = useState<CasualReceiptData | null>(null);

  // ---- Helpers --------------------------------------------------------------

  const nameOf = <T extends { id: string; name: string }>(list: T[], id?: string) =>
    list.find((x) => x.id === id)?.name ?? "-";

  const getStudentName = (sid?: string) => {
    const s = students.find((st) => st.id === sid);
    return s ? `${s.firstName} ${s.lastName}` : "-";
  };

  const classLabelOf = (id?: string) => {
    const c = classes.find((x) => x.id === id);
    if (!c) return "-";
    const lvl = c.type === "cours" ? c.coursLevel : c.formationLevel;
    return lvl ? `${c.name} (${lvl})` : c.name;
  };

  /**
   * Everything the reception can attach a séance libre to:
   *   - "cours": a regular course module (its full context is displayed so the
   *     agent can tell two identical module names apart),
   *   - "timing": a séance libre créneau created on the Emploi du Temps page —
   *     selecting it loads that créneau's own price.
   * Perfectionnements are no longer part of this screen.
   */
  const seanceOptions = useMemo<SeanceOption[]>(() => {
    const list: SeanceOption[] = [];

    sessions.forEach((s) => {
      // Une séance libre dont la période est terminée n'est plus proposée au
      // guichet : on ne rattache plus aucune présence à un créneau expiré.
      if (isExpiredOpenSeance(s)) return;
      const sub = subscriptions.find((su) => su.sessionId === s.id);
      const t = teachers.find((te) => te.id === s.teacherId);
      const isOpen = !!s.isOpen;
      const classLabel = isOpen
        ? (s.classIds?.length ? s.classIds : [s.classId]).map(classLabelOf).join(" · ")
        : classLabelOf(s.classId);
      const groupLabel = isOpen
        ? (s.groupIds?.length ? s.groupIds : [s.groupId]).map((id) => nameOf(groups, id)).join(" · ")
        : nameOf(groups, s.groupId);
      const salleLabel = isOpen
        ? (s.salleIds?.length ? s.salleIds : [s.salleId]).map((id) => nameOf(salles, id)).join(" · ")
        : nameOf(salles, s.salleId);
      const moduleName = nameOf(modules, s.moduleId);

      list.push({
        key: s.id,
        kind: isOpen ? "timing" : "cours",
        label: isOpen ? s.title || `Séance Libre — ${moduleName}` : `${moduleName} — ${classLabel}`,
        price: sub?.pricePerSession ?? s.openPrice ?? 0,
        sessionId: s.id,
        moduleName,
        classLabel,
        groupLabel,
        salleLabel,
        teacherName: t ? `${t.firstName} ${t.lastName}` : "-",
        teacherIsPassager: !!t?.isPassager,
        daysLabel: s.days.map((d) => DAY_LABELS[d] ?? d).join(" · "),
        timeLabel: `${s.startTime} - ${s.endTime}`,
        days: s.days,
        moduleId: s.moduleId,
        teacherId: s.teacherId,
        startTime: s.startTime,
        endTime: s.endTime,
        periodLabel:
          isOpen && s.periodStart && s.periodEnd
            ? `${formatDateFr(s.periodStart)} → ${formatDateFr(s.periodEnd)}`
            : undefined,
        sessionIsFree: isOpen && !!s.isFree,
        classIds: isOpen && s.classIds?.length ? s.classIds : [s.classId],
      });
    });

    return list.sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === "timing" ? -1 : 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, subscriptions, teachers, modules, classes, groups, salles]);

  /** The emplois du temps the selected student is enrolled on: what he
   *  "studies on" is the usual answer at the desk, so those créneaux are
   *  flagged and listed first. Empty as long as no student is picked. */
  const studentSessionIds = useMemo(() => {
    if (!selectedStudent) return new Set<string>();
    return new Set(
      selectedStudent.subscriptionIds
        .map((id) => subscriptions.find((su) => su.id === id)?.sessionId)
        .filter((id): id is string => !!id),
    );
  }, [selectedStudent, subscriptions]);

  const isStudentSeance = (o: SeanceOption) => studentSessionIds.has(o.sessionId);

  // ---- Scolarité déclarée : niveau → année → filière -------------------------
  const filiereLabelOf = (id: string) => filieres.find((f) => f.id === id)?.name ?? "";

  const levelOptions = useMemo(() => levelOptionsOf(classes), [classes]);
  const yearOptions = useMemo(
    () => yearOptionsOf(classes, formLevel),
    [classes, formLevel],
  );
  const filiereOptions = useMemo(
    () => filiereOptionsOf(classes, formLevel, formYear, filiereLabelOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [classes, formLevel, formYear, filieres],
  );

  /** Les classes que la cascade désigne — plusieurs lignes peuvent partager la
   *  même combinaison niveau/année/filière. */
  const matchedClasses = useMemo(
    () => matchedClassesOf(classes, formLevel, formYear, formFiliereId),
    [classes, formLevel, formYear, formFiliereId],
  );
  const matchedClassIds = useMemo(
    () => new Set(matchedClasses.map((c) => c.id)),
    [matchedClasses],
  );
  /** La cascade est-elle conclue ? (La branche formations n'a pas de filière.) */
  const cascadeComplete =
    !!formLevel && !!formYear && (formLevel === "formation" || !!formFiliereId);

  /** La scolarité en clair, telle que le bon l'imprime. */
  const schoolingLabel = useMemo(() => {
    if (matchedClasses.length === 0) return "";
    const cls = matchedClasses[0];
    return classCascadeLabel(cls, filiereLabelOf(cls.filiereId ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedClasses, filieres]);

  /** Remonter la cascade efface toutes les marches du dessous : garder une
   *  filière d'un autre niveau désignerait une classe qui n'existe pas. */
  const pickLevel = (level: LevelKey) => {
    setFormLevel(level);
    setFormYear("");
    setFormFiliereId("");
    setSelectedItem(null);
  };
  const pickYear = (year: string) => {
    setFormYear(year);
    setFormFiliereId("");
    setSelectedItem(null);
  };
  const pickFiliere = (id: string) => {
    setFormFiliereId(id);
    setSelectedItem(null);
  };

  /** La scolarité d'un élève inscrit, lue sur la classe de son premier
   *  créneau. C'est ce qui pré-remplit la cascade quand on le sélectionne. */
  const cascadeOfStudent = (stu: Student): SchoolClass | undefined => {
    for (const subId of stu.subscriptionIds) {
      const sub = subscriptions.find((su) => su.id === subId);
      const sess = sub ? sessions.find((se) => se.id === sub.sessionId) : undefined;
      const cls = sess ? classes.find((c) => c.id === sess.classId) : undefined;
      if (cls) return cls;
    }
    return undefined;
  };

  /** Sélectionner un élève : son nom, son téléphone et sa scolarité sont déjà
   *  connus — les retaper serait du travail inutile, et une occasion de se
   *  tromper. Les trois listes restent modifiables. */
  const chooseStudent = (st: Student) => {
    setSelectedStudent(st);
    setStudentSearchQuery(`${st.firstName} ${st.lastName}`);
    setPassagerPhone(st.phone ?? "");
    const cls = cascadeOfStudent(st);
    const pos = cascadeOfClass(cls);
    setFormLevel(pos.level);
    setFormYear(pos.year);
    setFormFiliereId(pos.filiereId);
    setSelectedItem(null);
  };

  /**
   * Les créneaux proposables : ceux du JOUR de la séance, sur la scolarité
   * déclarée, et sur la matière choisie quand il y en a une.
   *
   * Tant que la cascade n'est pas conclue, aucune classe n'est désignée — on
   * ne filtre alors pas par classe, sinon l'écran serait vide et on ne saurait
   * pas pourquoi.
   */
  const dayOfSeance: Day = useMemo(() => dayOfIsoDate(casualDate), [casualDate]);

  const dayOptions = useMemo(() => {
    return seanceOptions.filter((o) => {
      if (onlyThatDay && !o.days.includes(dayOfSeance)) return false;
      if (formModuleId && o.moduleId !== formModuleId) return false;
      if (cascadeComplete && matchedClassIds.size > 0) {
        if (!o.classIds.some((id) => matchedClassIds.has(id))) return false;
      }
      if (onlyStudentSeances && !isStudentSeance(o)) return false;
      if (itemSearchQuery.trim()) {
        const haystack = `${o.label} ${o.moduleName} ${o.classLabel} ${o.groupLabel} ${o.salleLabel} ${o.teacherName}`;
        if (!matchesAllWords(haystack, itemSearchQuery)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    seanceOptions,
    onlyThatDay,
    dayOfSeance,
    formModuleId,
    cascadeComplete,
    matchedClassIds,
    onlyStudentSeances,
    studentSessionIds,
    itemSearchQuery,
  ]);

  /** Les matières réellement enseignées ce jour-là sur cette scolarité : le
   *  filtre ne propose que ce qui existe, jamais une liste de modules morts. */
  const dayModules = useMemo(() => {
    const ids = new Set<string>();
    seanceOptions.forEach((o) => {
      if (onlyThatDay && !o.days.includes(dayOfSeance)) return;
      if (cascadeComplete && matchedClassIds.size > 0) {
        if (!o.classIds.some((id) => matchedClassIds.has(id))) return;
      }
      ids.add(o.moduleId);
    });
    return modules
      .filter((m) => ids.has(m.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [seanceOptions, onlyThatDay, dayOfSeance, cascadeComplete, matchedClassIds, modules]);

  /**
   * Le public du créneau, tel que l'Emploi du Temps l'a réglé : cet élève-là
   * a-t-il le droit d'être encaissé dessus ? Rien à contrôler tant qu'aucun
   * élève n'est choisi — un passager n'a ni classe ni filière, et la séance
   * libre existe précisément pour l'encaisser.
   */
  const audienceVerdictFor = (o: SeanceOption) => {
    if (!selectedStudent) return undefined;
    const session = sessions.find((s) => s.id === o.sessionId);
    if (!session) return undefined;
    const verdict = checkOpenSeanceAudience({
      session,
      student: selectedStudent,
      sessions,
      subscriptions,
      classes,
    });
    return verdict.allowed ? undefined : verdict;
  };

  /** Student lookup by name OR card number (RFID) — an empty selection means
   *  the attendee is recorded as a "passager". */
  const matchedStudents = useMemo(() => {
    const q = studentSearchQuery.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter(
        (st) =>
          `${st.firstName} ${st.lastName}`.toLowerCase().includes(q) ||
          (st.rfid ?? "").toLowerCase().includes(q) ||
          st.phone.includes(studentSearchQuery.trim()),
      )
      .slice(0, 25);
  }, [students, studentSearchQuery]);

  /** Le créneau choisi exclut-il l'élève choisi ? (undefined = tout va bien) */
  const selectedOutOfAudience = selectedItem ? audienceVerdictFor(selectedItem) : undefined;

  /**
   * Période gratuite couvrant le créneau choisi, à la date choisie.
   *
   * Le guichet ignorait complètement les périodes gratuites : la même séance
   * était offerte quand l'élève badgeait, et encaissée quand la réception la
   * saisissait à la main. D'où « la période gratuite marche pour certains
   * élèves et pas pour d'autres ». Un PASSAGER n'est pas concerné : il n'a ni
   * classe ni abonnement, et la séance libre existe pour l'encaisser.
   */
  const freePeriodForSelected = useMemo(() => {
    if (!selectedItem || !selectedStudent) return undefined;
    return freePeriodCovering(freePeriods, selectedItem.classIds, casualDate);
  }, [freePeriods, selectedItem, selectedStudent, casualDate]);

  /** Trois façons d'offrir la séance : la case cochée au guichet, le créneau
   *  coché « offert » sur le planning, une période gratuite en cours. */
  const seanceIsOffered = isFreeSeance || !!freePeriodForSelected;

  /** Tariff of the picked séance, reduction/override included. */
  const listedPrice = customPrice ?? selectedItem?.price ?? 0;
  /** What is actually cashed: nothing at all on an offered séance. */
  const effectivePrice = seanceIsOffered ? 0 : listedPrice;
  /** What the school gives away when the séance is offered. */
  const waivedPrice = seanceIsOffered ? listedPrice : 0;

  /**
   * Part de l'enseignant sur CETTE séance, quand le guichet a posé un taux.
   *
   * Une séance OFFERTE ne rémunère personne — l'enseignant compris : on ne
   * peut pas verser un pourcentage de zéro encaissé. Le taux reste saisissable
   * (l'agent peut décocher « offerte » ensuite) mais la part vaut 0.
   */
  const teacherSharePctValue = Math.min(Math.max(teacherSharePct || 0, 0), 100);
  const teacherShareAmount =
    teacherShareOn && !seanceIsOffered
      ? Math.round((effectivePrice * teacherSharePctValue) / 100)
      : 0;

  /** Reverse lookup used by the list/cards to describe a stored séance. */
  const optionForSession = (sessionId?: string) =>
    sessionId ? seanceOptions.find((o) => o.sessionId === sessionId) : undefined;

  // ---- Main list ------------------------------------------------------------

  const filteredList = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return independent
      .filter((ind) => {
        const person = ind.studentId ? getStudentName(ind.studentId) : ind.passagerName ?? "";
        if (q && !`${person} ${ind.itemLabel}`.toLowerCase().includes(q)) return false;
        if (payerFilter === "student" && !ind.studentId) return false;
        if (payerFilter === "passager" && ind.studentId) return false;
        if (billingFilter === "paid" && ind.isFree) return false;
        if (billingFilter === "free" && !ind.isFree) return false;
        if (kindFilter !== "all") {
          const opt = optionForSession(ind.sessionId);
          const kind = opt?.kind ?? "cours";
          if (kind !== kindFilter) return false;
        }
        if (fromDate && ind.date < fromDate) return false;
        if (toDate && ind.date > toDate) return false;
        return true;
      })
      .sort((a, b) => (b.createdAt ?? b.date).localeCompare(a.createdAt ?? a.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [independent, listSearch, payerFilter, billingFilter, kindFilter, fromDate, toDate, students, seanceOptions]);

  const totalCollected = filteredList.reduce((s, i) => s + i.price, 0);
  const offeredList = filteredList.filter((i) => i.isFree);
  const totalOffered = offeredList.reduce((s, i) => s + (i.waivedAmount ?? 0), 0);

  const clearListFilters = () => {
    setListSearch("");
    setPayerFilter("all");
    setBillingFilter("all");
    setKindFilter("all");
    setFromDate("");
    setToDate("");
  };

  // ---- Create / edit --------------------------------------------------------

  const resetForm = () => {
    setSelectedStudent(null);
    setStudentSearchQuery("");
    setPassagerPhone("");
    setItemSearchQuery("");
    setOnlyStudentSeances(false);
    setSelectedItem(null);
    setCasualDate(todayIso());
    setCustomPrice(null);
    setIsFreeSeance(false);
    setPaymentValidated(false);
    setSelectedCasual(null);
    setFormLevel("");
    setFormYear("");
    setFormFiliereId("");
    setFormModuleId("");
    setOnlyThatDay(true);
    setTeacherShareOn(false);
    setTeacherSharePct(50);
  };

  const openCreate = () => {
    resetForm();
    setIsFormOpen(true);
  };

  const openEdit = (ind: IndependentSession) => {
    setSelectedCasual(ind);
    setCasualDate(ind.date);
    // An offered séance carries its tariff in `waivedAmount`, not in `price`.
    setCustomPrice(ind.isFree ? ind.waivedAmount ?? 0 : ind.price);
    setIsFreeSeance(!!ind.isFree);
    setPaymentValidated(true);

    const student = ind.studentId ? students.find((s) => s.id === ind.studentId) : undefined;
    setSelectedStudent(student ?? null);
    setStudentSearchQuery(student ? `${student.firstName} ${student.lastName}` : ind.passagerName ?? "");
    setPassagerPhone(ind.passagerPhone ?? student?.phone ?? "");

    // La scolarité telle qu'elle a été enregistrée ; à défaut (séances écrites
    // avant ces colonnes), celle de la classe du créneau suivi.
    const opt = optionForSession(ind.sessionId);
    const storedClass = ind.classId ? classes.find((c) => c.id === ind.classId) : undefined;
    const fallbackClass = opt ? classes.find((c) => c.id === opt.classIds[0]) : undefined;
    const pos = cascadeOfClass(storedClass ?? fallbackClass);
    setFormLevel(pos.level);
    setFormYear(ind.year || pos.year);
    setFormFiliereId(ind.filiereId || pos.filiereId);
    setFormModuleId(ind.moduleId ?? "");
    // On modifie une séance déjà posée : ne pas restreindre au jour, sinon son
    // propre créneau disparaîtrait de la liste dès que la date change.
    setOnlyThatDay(false);

    setTeacherShareOn(ind.teacherPercentage !== undefined && ind.teacherPercentage !== null);
    setTeacherSharePct(ind.teacherPercentage ?? 50);

    setSelectedItem(opt ?? null);
    setItemSearchQuery("");
    setOnlyStudentSeances(false);
    setIsFormOpen(true);
    setActiveMenuId(null);
  };

  const handleSubmit = () => {
    if (!selectedItem) {
      alert("Veuillez sélectionner un cours ou un créneau de séance libre.");
      return;
    }

    // Le créneau réserve sa place : un élève hors de son public n'y entre pas.
    // Le contrôle vient AVANT l'encaissement — refuser après avoir pris
    // l'argent obligerait la réception à rembourser.
    const refused = audienceVerdictFor(selectedItem);
    if (refused) {
      alert(
        `Cet élève n'est pas dans le public de ce créneau.

${refused.reason}

` +
          "Choisissez un autre créneau, ou élargissez son public depuis l'Emploi du Temps.",
      );
      return;
    }

    // An amount to cash must be validated first; an offered séance skips it.
    if (!seanceIsOffered && !paymentValidated) {
      alert("Validez d'abord l'encaissement du paiement.");
      return;
    }

    // Who attends, in decreasing order of precision:
    //   1. an élève inscrit picked in the search,
    //   2. the name typed in the search box — a named passager,
    //   3. nothing at all — an anonymous passager, which is what the desk
    //      records when someone drops in without giving a name.
    const passagerName = !selectedStudent ? studentSearchQuery.trim() : undefined;
    const isAnonymous = !selectedStudent && !passagerName;

    const price = effectivePrice;
    const waived = waivedPrice;

    /** La scolarité et la matière déclarées, plus la part de l'enseignant :
     *  tout ce que la saisie a ajouté, écrit sur la séance elle-même pour que le
     *  bon réimprimé six mois plus tard dise encore de quoi il s'agissait. */
    const declared = {
      passagerPhone: selectedStudent ? undefined : passagerPhone.trim() || undefined,
      classId: matchedClasses[0]?.id,
      year: formYear || undefined,
      filiereId: formFiliereId && formFiliereId !== "none" ? formFiliereId : undefined,
      moduleId: formModuleId || selectedItem.moduleId,
      // `undefined` — et non 0 — quand l'option est désactivée : 0 % serait un
      // taux délibérément nul, qui sortirait la séance du lot pour ne rien
      // verser. L'absence de valeur, elle, veut dire « taux habituel du prof ».
      teacherPercentage: teacherShareOn ? teacherSharePctValue : undefined,
      teacherAmount: teacherShareOn ? teacherShareAmount : undefined,
      // Quel guichet a encaissé : c'est ce que la caisse et les rapports
      // demandent quand on veut savoir « combien CE compte a-t-il encaissé ».
      createdBy: sessionUser?.id,
    };

    if (selectedCasual) {
      updateItem("independent", selectedCasual.id, {
        studentId: selectedStudent ? selectedStudent.id : undefined,
        passagerName: passagerName || undefined,
        itemLabel: selectedItem.label,
        price,
        isFree: seanceIsOffered,
        waivedAmount: waived,
        date: casualDate,
        sessionId: selectedItem.sessionId,
        startTime: selectedItem.startTime,
        endTime: selectedItem.endTime,
        ...declared,
      });
      setIsFormOpen(false);
      resetForm();
      return;
    }

    const nowIso = new Date().toISOString();
    const newCasual: IndependentSession = {
      id: uid("ind"),
      studentId: selectedStudent ? selectedStudent.id : undefined,
      passagerName: passagerName || undefined,
      itemLabel: selectedItem.label,
      price,
      isFree: seanceIsOffered,
      waivedAmount: waived,
      date: casualDate,
      sessionId: selectedItem.sessionId,
      startTime: selectedItem.startTime,
      endTime: selectedItem.endTime,
      createdAt: nowIso,
      ...declared,
    };

    push("independent", newCasual);

    // Séance offerte: nothing is debited, nothing is cashed, and the teacher
    // earns no share for it (see buildUnpaidTimings on the Enseignants screen).
    if (!seanceIsOffered) {
      // Registered student: the séance is debited from his balance right away.
      // Le débit passe par la RPC, JAMAIS par un `updateItem` sur le solde :
      // celui-ci réécrivait une valeur absolue calculée sur la copie locale et
      // effaçait tout ce que le serveur avait débité entre-temps (un badge à
      // l'entrée pendant que la fenêtre était ouverte). Le solde peut descendre
      // en dette : la séance a été suivie, elle est due.
      if (selectedStudent) {
        const student = students.find((st) => st.id === selectedStudent.id);
        if (student && !student.isFree) {
          void chargeStudent(
            student.id,
            price,
            `Séance libre: ${selectedItem.label}`,
            sessions.find((s) => s.id === selectedItem.sessionId)?.moduleId,
          );
        }
      }

      // L'entrée en caisse. Le libellé nomme la prestation ET la personne : la
      // caisse et les rapports s'en servent pour distinguer une séance libre
      // d'une recharge de solde, et pour retrouver la séance concernée.
      push("cash", {
        id: uid("csh"),
        type: "student_payment",
        amount: price,
        date: nowIso,
        description: `Séance libre: ${selectedItem.label} (${
          selectedStudent
            ? `${selectedStudent.firstName} ${selectedStudent.lastName}`
            : passagerName || "passager"
        })`,
        createdBy: sessionUser?.id,
      });
    }

    setIsFormOpen(false);

    const balanceBefore = selectedStudent?.balance;
    setReceiptData({
      personName: selectedStudent
        ? `${selectedStudent.firstName} ${selectedStudent.lastName}`
        : passagerName || "Passager occasionnel",
      isRegisteredStudent: !!selectedStudent,
      isAnonymous,
      itemLabel: selectedItem.label,
      moduleName: selectedItem.moduleName,
      teacherName: selectedItem.teacherName,
      classLabel: selectedItem.classLabel,
      salleLabel: selectedItem.salleLabel,
      timeLabel: selectedItem.timeLabel,
      daysLabel: selectedItem.daysLabel,
      price,
      isFree: seanceIsOffered,
      waived,
      date: casualDate,
      createdAt: nowIso,
      phone: selectedStudent ? selectedStudent.phone : passagerPhone.trim() || undefined,
      rfid: selectedStudent?.rfid || undefined,
      schooling: schoolingLabel || selectedItem.classLabel,
      balanceBefore,
      // Le solde APRÈS, tel que la séance le laisse : un élève gratuit ou une
      // séance offerte ne débitent rien.
      balanceAfter:
        balanceBefore === undefined
          ? undefined
          : selectedStudent?.isFree || seanceIsOffered
            ? balanceBefore
            : balanceBefore - price,
      studentIsFree: selectedStudent?.isFree,
      teacherPercentage: teacherShareOn ? teacherSharePctValue : undefined,
      teacherAmount: teacherShareOn ? teacherShareAmount : undefined,
    });

    resetForm();
  };

  const handleDelete = (id: string) => {
    if (confirm("Supprimer cette séance libre ?")) {
      deleteFrom("independent", id);
      setActiveMenuId(null);
    }
  };

  // ---- Le bon de séance libre ----------------------------------------------
  //
  // MÊME PAPIER QUE LE BON DE CHARGEMENT DE SOLDE.
  //
  // Le ticket était composé ici, à la main, avec sa propre feuille de style :
  // deux bons sortis du même guichet ne se ressemblaient pas, et tout
  // réglage d'imprimante fait d'un côté manquait de l'autre. Le gabarit vit
  // désormais dans `lib/reports/freeSeanceTicket.ts`, calqué sur celui du
  // chargement de solde — mêmes largeurs, même graisse, même cadre — avec le
  // contenu d'une séance libre : qui, quel créneau, quel enseignant, combien,
  // et la part du prof quand le guichet l'a posée.

  const handlePrintReceipt = (data: CasualReceiptData) => {
    printHtmlDocument(
      buildFreeSeanceTicket({
        school,
        language,
        personName: data.personName,
        isRegisteredStudent: data.isRegisteredStudent,
        isAnonymous: !!data.isAnonymous,
        phone: data.phone,
        rfid: data.rfid,
        schooling: data.schooling || data.classLabel,
        seanceLabel: data.itemLabel,
        moduleName: data.moduleName,
        teacherName: data.teacherName,
        salleName: data.salleLabel,
        timeLabel: data.timeLabel,
        date: data.date,
        createdAt: data.createdAt,
        price: data.price,
        isFree: data.isFree,
        waived: data.waived,
        balanceBefore: data.balanceBefore,
        balanceAfter: data.balanceAfter,
        studentIsFree: data.studentIsFree,
        teacherPercentage: data.teacherPercentage,
        teacherAmount: data.teacherAmount,
      }),
    );
  };

  /** Réimprimer le bon d'une séance déjà enregistrée. On relit ce qu'elle porte
   *  (scolarité, téléphone, part du prof) plutôt que de le re-deviner. */
  const reprint = (ind: IndependentSession) => {
    const opt = optionForSession(ind.sessionId);
    const stu = ind.studentId ? students.find((x) => x.id === ind.studentId) : undefined;
    const cls = ind.classId ? classes.find((c) => c.id === ind.classId) : undefined;
    handlePrintReceipt({
      personName: stu
        ? `${stu.firstName} ${stu.lastName}`
        : ind.passagerName || "Passager occasionnel",
      isRegisteredStudent: !!ind.studentId,
      isAnonymous: !ind.studentId && !ind.passagerName,
      itemLabel: ind.itemLabel,
      moduleName: ind.moduleId
        ? modules.find((m) => m.id === ind.moduleId)?.name
        : opt?.moduleName,
      teacherName: opt?.teacherName,
      classLabel: opt?.classLabel,
      salleLabel: opt?.salleLabel,
      timeLabel:
        ind.startTime && ind.endTime ? `${ind.startTime} - ${ind.endTime}` : opt?.timeLabel,
      daysLabel: opt?.daysLabel,
      price: ind.price,
      isFree: ind.isFree,
      waived: ind.waivedAmount,
      date: ind.date,
      createdAt: ind.createdAt ?? `${ind.date}T12:00:00.000Z`,
      phone: ind.passagerPhone ?? stu?.phone,
      rfid: stu?.rfid,
      schooling: cls
        ? classCascadeLabel(cls, filiereLabelOf(cls.filiereId ?? ""))
        : opt?.classLabel,
      studentIsFree: stu?.isFree,
      teacherPercentage: ind.teacherPercentage,
      teacherAmount: ind.teacherAmount,
    });
  };

  const createdStamp = (ind: IndependentSession) => {
    const iso = ind.createdAt ?? `${ind.date}T12:00:00.000Z`;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return ind.date;
    return `${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  };

  // ---- Render ---------------------------------------------------------------

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <PageHeader
          emoji="🎓"
          title="Séances Libres"
          subtitle="Séances ponctuelles des élèves inscrits et des passagers — encaissées ou offertes"
        />
        <Button onClick={openCreate} className="flex items-center gap-2 self-start sm:self-center">
          <Plus className="h-4 w-4" /> Nouvelle Séance Libre
        </Button>
      </div>

      {/* Filters toolbar */}
      <Card className="border border-line">
        <CardBody className="p-4 space-y-3.5">
          <div className="flex items-center justify-between border-b border-line pb-2.5">
            <span className="font-bold text-ink uppercase tracking-wider text-[10px] flex items-center gap-1.5">
              <Filter className="h-4 w-4 text-primary" /> Rechercher & Filtrer
            </span>
            <div className="flex items-center gap-2">
              {(listSearch || payerFilter !== "all" || billingFilter !== "all" || kindFilter !== "all" || fromDate || toDate) && (
                <button onClick={clearListFilters} className="text-primary hover:underline font-bold text-[10px] flex items-center gap-1">
                  <X className="h-3 w-3" /> Réinitialiser
                </button>
              )}
              <div className="bg-canvas border border-line p-1 rounded-xl flex gap-1">
                <button
                  onClick={() => setViewMode("cards")}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 ${
                    viewMode === "cards" ? "bg-primary text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  <LayoutGrid className="h-3 w-3" /> Cartes
                </button>
                <button
                  onClick={() => setViewMode("table")}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 ${
                    viewMode === "table" ? "bg-primary text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  <TableIcon className="h-3 w-3" /> Tableau
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="lg:col-span-2">
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Recherche</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                <Input
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  placeholder="Nom de l'élève, passager ou séance..."
                  className="pl-9"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Type de payeur</label>
              <Select value={payerFilter} onChange={(e) => setPayerFilter(e.target.value as typeof payerFilter)} className="w-full">
                <option value="all">Tous</option>
                <option value="student">Élèves inscrits</option>
                <option value="passager">Passagers</option>
              </Select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Facturation</label>
              <Select
                value={billingFilter}
                onChange={(e) => setBillingFilter(e.target.value as typeof billingFilter)}
                className="w-full"
              >
                <option value="all">Toutes</option>
                <option value="paid">Encaissées</option>
                <option value="free">Offertes (gratuites)</option>
              </Select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Origine</label>
              <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)} className="w-full">
                <option value="all">Toutes</option>
                <option value="timing">Créneaux séance libre</option>
                <option value="cours">Cours normaux</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Du</label>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Au</label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Le CUMUL encaissé par l'écran est une recette : direction seulement.
              Le montant d'UNE séance reste partout visible — c'est ce que le
              guichet encaisse, il ne peut pas travailler sans. */}
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-2.5 text-[11px]">
            <Badge tone="primary" className="font-bold">{filteredList.length} séance(s)</Badge>
            {canSeeGains && (
              <Badge tone="success" className="font-bold">{totalCollected} DA encaissés</Badge>
            )}
            <Badge tone="neutral" className="font-bold">
              {filteredList.filter((i) => !i.studentId).length} passager(s)
            </Badge>
            <Badge tone="warning" className="font-bold">
              {offeredList.length} offerte(s)
              {canSeeGains && ` · ${totalOffered} DA non encaissés`}
            </Badge>
          </div>
        </CardBody>
      </Card>

      {filteredList.length === 0 ? (
        <div className="text-center p-12 bg-canvas/30 border border-line border-dashed rounded-2xl text-muted text-xs">
          Aucune séance libre ne correspond aux filtres actuels.
        </div>
      ) : viewMode === "cards" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredList.map((ind) => {
            const opt = optionForSession(ind.sessionId);
            return (
              <Card
                key={ind.id}
                className={`relative transition-all duration-300 ${
                  activeMenuId === ind.id
                    ? "z-30 scale-[1.02] ring-2 ring-primary/45 shadow-2xl"
                    : "z-10 hover:z-20 hover:shadow-lg hover:-translate-y-0.5 border border-line"
                }`}
              >
                <CardBody className="flex flex-col justify-between min-h-[230px] relative p-5">
                  {/* Actions overlay panel */}
                  {activeMenuId === ind.id && (
                    <div className="absolute inset-0 bg-surface/98 backdrop-blur-md rounded-2xl p-4 flex flex-col justify-between z-20 animate-in fade-in zoom-in-95 duration-200 border border-primary/20">
                      <div className="flex justify-between items-center border-b border-line pb-2">
                        <span className="font-bold text-[10px] text-muted uppercase tracking-wider truncate">
                          Actions: {ind.studentId ? getStudentName(ind.studentId) : ind.passagerName || "Passager anonyme"}
                        </span>
                        <button
                          onClick={() => setActiveMenuId(null)}
                          className="p-1 rounded-lg hover:bg-canvas text-muted hover:text-ink transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2 my-2 flex-1 items-center">
                        <button
                          onClick={() => { setSelectedCasual(ind); setIsDetailsOpen(true); setActiveMenuId(null); }}
                          className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                        >
                          <Eye className="h-3.5 w-3.5" /> Détails
                        </button>
                        <button
                          onClick={() => openEdit(ind)}
                          className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                        >
                          <Edit className="h-3.5 w-3.5" /> Modifier
                        </button>
                        <button
                          onClick={() => { reprint(ind); setActiveMenuId(null); }}
                          className="col-span-2 flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                        >
                          <Printer className="h-3.5 w-3.5" /> Réimprimer le reçu
                        </button>
                      </div>

                      <div className="border-t border-line pt-2">
                        <button
                          onClick={() => handleDelete(ind.id)}
                          className="flex items-center justify-center gap-1.5 w-full py-2 px-3 text-xs font-bold rounded-xl bg-danger text-white hover:bg-danger/90 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Supprimer
                        </button>
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-full bg-success/10 border border-success/20 text-success font-bold text-xs flex items-center justify-center shrink-0">
                          {ind.studentId ? "🎓" : "🚶"}
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-sm font-bold text-ink truncate">
                            {ind.studentId
                              ? getStudentName(ind.studentId)
                              : ind.passagerName || "Passager anonyme"}
                          </h4>
                          <span className="text-[10px] text-muted block font-mono truncate">
                            {ind.studentId ? "Élève Inscrit" : "Passager Occasionnel"}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => setActiveMenuId(activeMenuId === ind.id ? null : ind.id)}
                        className="p-1.5 rounded-lg hover:bg-primary-50 text-muted hover:text-ink transition-colors shrink-0"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2 text-xs bg-canvas/30 border border-line/60 rounded-xl p-2.5">
                        <div className="min-w-0">
                          <span className="text-[10px] text-muted block uppercase font-semibold">
                            {opt?.kind === "timing" ? "Créneau séance libre" : "Cours"}
                          </span>
                          <span className="font-semibold text-ink block truncate">{ind.itemLabel}</span>
                          {opt?.daysLabel && (
                            <span className="text-[9px] text-muted block font-mono truncate">{opt.daysLabel}</span>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-[10px] text-muted block uppercase font-semibold">
                            {ind.isFree ? "Offerte" : "Tarif Payé"}
                          </span>
                          {ind.isFree ? (
                            <>
                              <span className="font-bold text-warning">0 DA</span>
                              <span className="text-[9px] text-muted block">valeur {ind.waivedAmount ?? 0} DA</span>
                            </>
                          ) : (
                            <span className="font-bold text-success">{ind.price} DA</span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl">
                          <span className="text-muted block text-[9px] uppercase font-sans">Date séance</span>
                          <strong className="text-ink mt-0.5 font-mono block">{formatDateFr(ind.date)}</strong>
                          {ind.startTime && (
                            <span className="text-[9px] text-muted font-mono">{ind.startTime} - {ind.endTime}</span>
                          )}
                        </div>
                        <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl">
                          <span className="text-muted block text-[9px] uppercase">Créée le</span>
                          <strong className="text-ink mt-0.5 font-mono block text-[10px]">{createdStamp(ind)}</strong>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-line/60 pt-3 mt-4 flex items-center justify-between">
                    <span className="text-[10px] text-muted flex items-center gap-1.5 truncate">
                      <User className="h-3 w-3 shrink-0" />
                      {opt?.teacherName ?? "-"}
                      {opt?.teacherIsPassager && (
                        <Badge tone="warning" className="text-[8px] px-1 py-0">Passager</Badge>
                      )}
                    </span>
                    {ind.isFree ? (
                      <Badge tone="warning" className="font-mono font-bold text-[10px]">🎁 Offerte</Badge>
                    ) : (
                      <Badge tone="success" className="font-mono font-bold text-[10px]">{ind.price} DA</Badge>
                    )}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      ) : (
        /* TABLE VIEW */
        <div className="border border-line rounded-2xl overflow-hidden bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse min-w-[860px]">
              <thead>
                <tr className="bg-canvas border-b border-line text-[10px] text-muted uppercase font-bold tracking-wider">
                  <th className="p-3">Élève / Passager</th>
                  <th className="p-3">Séance</th>
                  <th className="p-3">Enseignant</th>
                  <th className="p-3">Date & horaire</th>
                  <th className="p-3">Créée le</th>
                  <th className="p-3 text-right">Tarif</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredList.map((ind) => {
                  const opt = optionForSession(ind.sessionId);
                  return (
                    <tr key={ind.id} className="border-b border-line last:border-0 hover:bg-canvas/30 transition-colors">
                      <td className="p-3">
                        <span className="font-bold text-ink block">
                          {ind.studentId
                            ? getStudentName(ind.studentId)
                            : ind.passagerName || "Passager anonyme"}
                        </span>
                        <Badge tone={ind.studentId ? "primary" : "warning"} className="text-[9px] mt-0.5">
                          {ind.studentId ? "Inscrit" : "Passager"}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <span className="text-ink block truncate max-w-[220px]">{ind.itemLabel}</span>
                        <span className="text-[10px] text-muted">
                          {opt?.kind === "timing" ? "Créneau séance libre" : "Cours"}
                          {opt?.daysLabel ? ` · ${opt.daysLabel}` : ""}
                        </span>
                        {ind.isFree && (
                          <Badge tone="warning" className="text-[9px] mt-0.5">🎁 Offerte</Badge>
                        )}
                      </td>
                      <td className="p-3 text-ink">{opt?.teacherName ?? "-"}</td>
                      <td className="p-3 font-mono text-[10px]">
                        {formatDateFr(ind.date)}
                        {ind.startTime && <span className="block text-muted">{ind.startTime} - {ind.endTime}</span>}
                      </td>
                      <td className="p-3 font-mono text-[10px] text-muted">{createdStamp(ind)}</td>
                      <td className="p-3 text-right font-mono">
                        {ind.isFree ? (
                          <>
                            <strong className="text-warning">0 DA</strong>
                            <span className="block text-[9px] text-muted">valeur {ind.waivedAmount ?? 0} DA</span>
                          </>
                        ) : (
                          <strong className="text-success">{ind.price} DA</strong>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => { setSelectedCasual(ind); setIsDetailsOpen(true); }}
                            className="p-1.5 rounded-lg hover:bg-primary-50 text-ink"
                            title="Détails"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => reprint(ind)} className="p-1.5 rounded-lg hover:bg-primary-50 text-ink" title="Réimprimer">
                            <Printer className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => openEdit(ind)} className="p-1.5 rounded-lg hover:bg-primary-50 text-primary" title="Modifier">
                            <Edit className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => handleDelete(ind.id)} className="p-1.5 rounded-lg hover:bg-danger/10 text-danger" title="Supprimer">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Create / edit a séance libre                                        */}
      {/* ------------------------------------------------------------------ */}
      {/* ------------------------------------------------------------------ */}
      {/* ENREGISTRER UNE SÉANCE LIBRE — la saisie suit l'ordre du guichet :   */}
      {/*   1. qui suit la séance (élève inscrit, ou passager nommé)           */}
      {/*   2. sa scolarité : classe → année → filière                        */}
      {/*   3. la matière (facultative)                                        */}
      {/*   4. le créneau du JOUR qui correspond                              */}
      {/*   5. le prix                                                         */}
      {/*   6. la part de l'enseignant sur cette séance (facultative)          */}
      {/* ------------------------------------------------------------------ */}
      <Modal
        open={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={selectedCasual ? "Modifier la séance libre" : "Enregistrer une séance libre"}
        subtitle="Qui suit la séance, sa scolarité, la matière, puis le créneau du jour."
        size="xl"
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* ================= COLONNE GAUCHE : QUI, ET QUOI ================ */}
          <div className="space-y-4">
            {/* ---- 1. Qui suit la séance ? ---- */}
            <div className="rounded-2xl border border-line bg-canvas/30 p-3.5">
              <div className="mb-1.5 flex items-center justify-between">
                <label className="block text-xs font-bold text-ink">
                  1. Qui suit la séance ?
                </label>
                {(selectedStudent || studentSearchQuery || passagerPhone) && (
                  <button
                    onClick={() => {
                      setSelectedStudent(null);
                      setStudentSearchQuery("");
                      setPassagerPhone("");
                    }}
                    className="text-[10px] font-bold text-primary hover:underline"
                  >
                    Vider
                  </button>
                )}
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input
                  value={studentSearchQuery}
                  onChange={(e) => {
                    setStudentSearchQuery(e.target.value);
                    if (selectedStudent) setSelectedStudent(null);
                  }}
                  placeholder="Nom complet, ou cherchez un élève inscrit (nom, carte, téléphone)"
                  className="pl-9"
                />
              </div>

              {/* Le téléphone : facultatif pour un passager, repris de la fiche
                  pour un élève inscrit (et non modifiable ici — c'est la fiche
                  élève qui en est la source). */}
              <div className="mt-2">
                <label className="mb-1 block text-[10px] font-semibold text-muted">
                  Téléphone <span className="font-normal">(facultatif)</span>
                </label>
                <Input
                  value={passagerPhone}
                  onChange={(e) => setPassagerPhone(e.target.value)}
                  disabled={!!selectedStudent}
                  placeholder="+213 5XX XX XX XX"
                  className="font-mono"
                />
                {selectedStudent && (
                  <p className="mt-1 text-[10px] text-muted">
                    Repris de la fiche de l&apos;élève — modifiable depuis l&apos;écran Étudiants.
                  </p>
                )}
              </div>

              {/* Les trois façons de nommer la personne, toutes valides. */}
              <div className="mt-2 space-y-1 rounded-xl border border-line bg-surface p-2 text-[10px] leading-relaxed text-muted">
                <p className={selectedStudent ? "font-bold text-primary" : ""}>
                  • <strong>Élève inscrit</strong> : cherchez-le, puis choisissez-le dans les
                  résultats — sa scolarité se remplit toute seule.
                </p>
                <p className={!selectedStudent && studentSearchQuery.trim() ? "font-bold text-primary" : ""}>
                  • <strong>Passager nommé</strong> : tapez son nom complet sans le sélectionner.
                </p>
                <p className={!selectedStudent && !studentSearchQuery.trim() ? "font-bold text-primary" : ""}>
                  • <strong>Passager anonyme</strong> : laissez le champ vide.
                </p>
              </div>

              {studentSearchQuery.trim() !== "" && !selectedStudent && (
                <div className="mt-2 space-y-1.5">
                  <span className="block text-[10px] font-bold uppercase text-muted">
                    Élèves inscrits trouvés ({matchedStudents.length})
                  </span>
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-line bg-surface p-1.5">
                    {matchedStudents.map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => chooseStudent(st)}
                        className="flex w-full items-center justify-between rounded-xl border border-transparent p-2.5 text-start text-xs text-ink transition-all hover:bg-primary-50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">
                            {st.firstName} {st.lastName}
                          </span>
                          <span className="mt-0.5 block font-mono text-[9px] text-muted">
                            🎫 {st.rfid || "sans carte"} · 📞 {st.phone || "—"} · Solde: {st.balance} DA
                          </span>
                        </span>
                      </button>
                    ))}
                    {matchedStudents.length === 0 && (
                      <div className="rounded-xl border border-line bg-canvas/40 p-3 text-center text-xs text-muted">
                        Aucun élève inscrit sous ce nom — il sera enregistré comme{" "}
                        <strong>passager</strong> : «&nbsp;{studentSearchQuery.trim()}&nbsp;».
                      </div>
                    )}
                  </div>
                </div>
              )}

              {selectedStudent && (
                <div className="mt-2 rounded-xl border border-primary/25 bg-primary-50/50 p-2.5 text-xs">
                  <span className="block text-[10px] font-bold uppercase text-muted">
                    Élève sélectionné
                  </span>
                  <strong className="mt-0.5 block text-ink">
                    {selectedStudent.firstName} {selectedStudent.lastName}
                  </strong>
                  <span className="text-[10px] text-muted">
                    Solde : {selectedStudent.balance} DA → après séance :{" "}
                    <strong
                      className={
                        !selectedStudent.isFree &&
                        !seanceIsOffered &&
                        selectedStudent.balance - effectivePrice < 0
                          ? "text-danger"
                          : "text-success"
                      }
                    >
                      {selectedStudent.isFree || seanceIsOffered
                        ? selectedStudent.balance
                        : selectedStudent.balance - effectivePrice}{" "}
                      DA
                    </strong>
                    {selectedStudent.isFree && " · élève gratuit, aucun débit"}
                    {seanceIsOffered && " · séance offerte, aucun débit"}
                  </span>
                </div>
              )}
            </div>

            {/* ---- 2. Scolarité : classe → année → filière ---- */}
            <div className="rounded-2xl border border-line bg-canvas/30 p-3.5">
              <label className="mb-1.5 block text-xs font-bold text-ink">
                2. Scolarité de l&apos;élève
              </label>
              <p className="mb-2 text-[10px] leading-relaxed text-muted">
                Classe, puis année, puis filière. Pour un élève inscrit, les trois sont
                pré-remplies depuis son emploi du temps — et restent modifiables (il peut venir
                suivre la séance d&apos;un autre niveau).
              </p>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-muted">Classe</label>
                  <Select
                    className="w-full"
                    value={formLevel}
                    onChange={(e) => pickLevel(e.target.value as LevelKey)}
                  >
                    <option value="">— Choisir —</option>
                    {levelOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-muted">Année</label>
                  <Select
                    className="w-full"
                    value={formYear}
                    disabled={!formLevel}
                    onChange={(e) => pickYear(e.target.value)}
                  >
                    <option value="">— Choisir —</option>
                    {yearOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-muted">Filière</label>
                  <Select
                    className="w-full"
                    value={formFiliereId}
                    disabled={!formYear || formLevel === "formation"}
                    onChange={(e) => pickFiliere(e.target.value)}
                  >
                    <option value="">
                      {formLevel === "formation" ? "— sans objet —" : "— Choisir —"}
                    </option>
                    {filiereOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              {cascadeComplete ? (
                <p className="mt-2 rounded-xl border border-success/25 bg-success/5 p-2 text-[10px] text-muted">
                  Scolarité : <strong className="text-ink">{schoolingLabel}</strong>
                  {matchedClasses.length > 1 &&
                    ` · ${matchedClasses.length} classes partagent cette combinaison`}
                </p>
              ) : (
                <p className="mt-2 text-[10px] italic text-muted">
                  Sans scolarité, tous les créneaux du jour sont proposés.
                </p>
              )}
            </div>

            {/* ---- 3. Matière (facultative) ---- */}
            <div className="rounded-2xl border border-line bg-canvas/30 p-3.5">
              <label className="mb-1.5 block text-xs font-bold text-ink">
                3. Matière <span className="font-normal text-muted">(facultatif)</span>
              </label>
              <Select
                className="w-full"
                value={formModuleId}
                onChange={(e) => {
                  setFormModuleId(e.target.value);
                  setSelectedItem(null);
                }}
              >
                <option value="">Toutes les matières du jour</option>
                {dayModules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
              <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
                Ne sont listées que les matières réellement enseignées ce jour-là sur cette
                scolarité. Laissez vide pour voir tous les créneaux.
              </p>
            </div>

            {/* ---- Date de la séance ---- */}
            <div className="rounded-2xl border border-line bg-canvas/30 p-3.5">
              <label className="mb-1.5 block text-xs font-bold text-ink">Date de la séance</label>
              <Input
                type="date"
                value={casualDate}
                onChange={(e) => {
                  setCasualDate(e.target.value);
                  setSelectedItem(null);
                }}
              />
              <label className="mt-2 flex cursor-pointer items-start gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={onlyThatDay}
                  onChange={(e) => {
                    setOnlyThatDay(e.target.checked);
                    setSelectedItem(null);
                  }}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span className="text-muted">
                  N&apos;afficher que les créneaux du{" "}
                  <strong className="text-ink">{DAY_LABELS_FR[dayOfSeance]}</strong>
                  {casualDate === todayIso() && " (aujourd'hui)"} — décochez pour voir toute la
                  semaine.
                </span>
              </label>
            </div>
          </div>

          {/* ============ COLONNE DROITE : LE CRÉNEAU ET L'ARGENT =========== */}
          <div className="space-y-4">
            {/* ---- 4. Le créneau du jour ---- */}
            <div className="rounded-2xl border border-line bg-canvas/30 p-3.5">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <label className="block text-xs font-bold text-ink">
                  4. Emploi du temps suivi *
                </label>
                <span className="text-[10px] text-muted">
                  {dayOptions.length} créneau(x) disponible(s)
                </span>
              </div>

              <div className="mb-2 flex flex-wrap gap-1.5">
                {selectedStudent && studentSessionIds.size > 0 && (
                  <button
                    onClick={() => setOnlyStudentSeances(!onlyStudentSeances)}
                    className={`rounded-lg px-2.5 py-1 text-[10px] font-bold transition-all ${
                      onlyStudentSeances ? "bg-success text-white" : "bg-canvas text-muted hover:text-ink"
                    }`}
                  >
                    🎓 Ses cours ({studentSessionIds.size})
                  </button>
                )}
              </div>

              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input
                  value={itemSearchQuery}
                  onChange={(e) => setItemSearchQuery(e.target.value)}
                  placeholder="Affiner : nom du créneau, groupe, salle, enseignant..."
                  className="pl-9"
                />
              </div>

              <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-line bg-surface p-1.5">
                {dayOptions.length === 0 ? (
                  <p className="p-4 text-center text-[11px] leading-relaxed text-muted">
                    Aucun créneau {onlyThatDay ? `le ${DAY_LABELS_FR[dayOfSeance].toLowerCase()}` : ""}
                    {cascadeComplete ? ` pour ${schoolingLabel}` : ""}
                    {formModuleId
                      ? ` en ${modules.find((m) => m.id === formModuleId)?.name ?? "cette matière"}`
                      : ""}
                    .
                    <br />
                    Élargissez à la semaine, retirez la matière, ou changez la scolarité.
                  </p>
                ) : (
                  dayOptions.map((opt) => {
                    const isSel = selectedItem?.key === opt.key;
                    // Un créneau dont le public exclut l'élève reste visible et
                    // cliquable — la réception doit lire POURQUOI il ne convient
                    // pas — mais il part grisé.
                    const outOfAudience = audienceVerdictFor(opt);
                    return (
                      <button
                        key={opt.key}
                        onClick={() => {
                          setSelectedItem(opt);
                          setCustomPrice(opt.price);
                          setPaymentValidated(false);
                          setIsFreeSeance(!!opt.sessionIsFree);
                        }}
                        className={`w-full rounded-lg border p-2.5 text-start text-xs transition-colors ${
                          isSel
                            ? "border-primary/40 bg-primary/10 text-ink"
                            : "border-transparent text-ink hover:bg-primary-50"
                        } ${outOfAudience ? "opacity-60" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <strong className="block min-w-0 truncate font-bold">
                            {opt.kind === "timing" && <span className="mr-1">🎯</span>}
                            {opt.label}
                            {isStudentSeance(opt) && (
                              <Badge tone="success" className="ml-1.5 px-1 py-0 align-middle text-[8px]">
                                Son cours
                              </Badge>
                            )}
                            {opt.sessionIsFree && (
                              <Badge tone="warning" className="ml-1.5 px-1 py-0 align-middle text-[8px]">
                                🎁 Offerte
                              </Badge>
                            )}
                            {outOfAudience && (
                              <Badge tone="danger" className="ml-1.5 px-1 py-0 align-middle text-[8px]">
                                Hors public
                              </Badge>
                            )}
                          </strong>
                          <strong className="shrink-0 text-primary">{opt.price} DA</strong>
                        </div>
                        <div className="mt-1 space-y-0.5 text-[10px] text-muted">
                          <div className="flex items-center gap-1">
                            <User className="h-3 w-3 shrink-0" /> {opt.teacherName}
                            {opt.teacherIsPassager ? " (passager)" : ""}
                          </div>
                          <div className="flex items-center gap-1">
                            <Users className="h-3 w-3 shrink-0" /> {opt.classLabel} · Gr:{" "}
                            {opt.groupLabel}
                          </div>
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3 w-3 shrink-0" /> {opt.salleLabel}
                          </div>
                          <div className="flex items-center gap-1 font-mono">
                            <Clock className="h-3 w-3 shrink-0" /> {opt.daysLabel} · {opt.timeLabel}
                          </div>
                          {opt.periodLabel && (
                            <div className="flex items-center gap-1 font-mono">
                              <Calendar className="h-3 w-3 shrink-0" /> {opt.periodLabel}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {selectedItem && (
              <>
                {/* Public du créneau : le motif se lit AVANT l'encaissement. */}
                {selectedOutOfAudience && (
                  <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs">
                    <strong className="block text-danger">
                      Cet élève n&apos;est pas dans le public de ce créneau
                    </strong>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">
                      {selectedOutOfAudience.reason} Choisissez un autre créneau, ou élargissez son
                      public depuis l&apos;<strong>Emploi du Temps</strong>. Un passager
                      occasionnel, lui, reste encaissable dessus.
                    </span>
                  </div>
                )}

                {/* Séance offerte : personne n'est payé dessus — ni l'école, ni
                    l'enseignant. Deux réglages la forcent et la verrouillent :
                    un créneau coché « offert », et une période gratuite. */}
                <label
                  className={`flex items-start gap-2.5 rounded-xl border p-3 text-xs transition-colors ${
                    selectedItem.sessionIsFree || freePeriodForSelected
                      ? "cursor-not-allowed"
                      : "cursor-pointer"
                  } ${
                    seanceIsOffered
                      ? "border-warning/40 bg-warning/10"
                      : "border-line bg-canvas/30 hover:bg-primary-50/40"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={seanceIsOffered}
                    disabled={selectedItem.sessionIsFree || !!freePeriodForSelected}
                    onChange={(e) => {
                      setIsFreeSeance(e.target.checked);
                      setPaymentValidated(false);
                    }}
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <span>
                    <strong className="block text-ink">Séance offerte (gratuite)</strong>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">
                      Rien n&apos;est encaissé, aucun solde n&apos;est débité, et{" "}
                      <strong>l&apos;enseignant n&apos;est pas rémunéré</strong> dessus. Sa valeur (
                      {listedPrice} DA) reste comptabilisée dans les rapports.
                    </span>
                    {selectedItem.sessionIsFree && (
                      <span className="mt-1 block text-[10px] font-bold text-warning">
                        🎁 Ce créneau est configuré « offert » dans le planning — toute présence y
                        est gratuite.
                      </span>
                    )}
                    {freePeriodForSelected && (
                      <span className="mt-1 block text-[10px] font-bold text-warning">
                        🎁 Période gratuite «&nbsp;{freePeriodForSelected.name}&nbsp;» du{" "}
                        {formatDateFr(freePeriodForSelected.startDate)} au{" "}
                        {formatDateFr(freePeriodForSelected.endDate)} : cette séance est offerte,
                        comme au badge.
                      </span>
                    )}
                  </span>
                </label>

                {/* ---- 5. Le prix ---- */}
                <div className="rounded-2xl border border-line bg-canvas/30 p-3.5">
                  <label className="mb-1.5 block text-xs font-bold text-ink">
                    5. {seanceIsOffered ? "Valeur de la séance offerte (DA)" : "Prix de la séance (DA)"}
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={customPrice ?? selectedItem.price}
                    onChange={(e) => {
                      setCustomPrice(Number(e.target.value));
                      setPaymentValidated(false);
                    }}
                  />
                  <p className="mt-1 text-[10px] text-muted">
                    Tarif chargé depuis{" "}
                    {selectedItem.kind === "timing" ? "le créneau" : "l'abonnement"} :{" "}
                    <strong>{selectedItem.price} DA</strong>. Modifiable pour cette séance
                    uniquement.
                  </p>
                </div>

                {/* ---- 6. Part de l'enseignant sur CETTE séance ---- */}
                {/* Ce que l'enseignant touche n'est pas une donnée de guichet.
                    Masqué, le réglage garde sa valeur : « décoché » sur une
                    nouvelle séance — le cas courant, l'enseignant touche son
                    pourcentage habituel — et la valeur déjà enregistrée sur une
                    séance qu'on modifie. Rien n'est effacé en passant par un
                    compte de réception. */}
                {canSeeGains && (
                <div
                  className={`rounded-2xl border p-3.5 transition-colors ${
                    teacherShareOn ? "border-primary/40 bg-primary-50/40" : "border-line bg-canvas/30"
                  }`}
                >
                  <label className="flex cursor-pointer items-start gap-2.5 text-xs">
                    <input
                      type="checkbox"
                      checked={teacherShareOn}
                      onChange={(e) => setTeacherShareOn(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0"
                    />
                    <span>
                      <strong className="block text-ink">
                        6. Fixer la part de l&apos;enseignant sur cette séance
                      </strong>
                      <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">
                        <strong>Décoché</strong> (le cas courant) : cet élève compte comme un
                        présent de plus sur le créneau, et l&apos;enseignant en touche son{" "}
                        <strong>pourcentage habituel</strong>.
                        <br />
                        <strong>Coché</strong> : la séance sort du lot, se calcule au taux
                        ci-dessous, et apparaît dans une{" "}
                        <strong>colonne à part</strong> de l&apos;écran de règlement de
                        l&apos;enseignant.
                      </span>
                    </span>
                  </label>

                  {teacherShareOn && (
                    <div className="mt-3 border-t border-primary/20 pt-3">
                      <label className="mb-1 block text-[10px] font-semibold text-muted">
                        Pourcentage de l&apos;enseignant sur cette séance (%)
                      </label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={teacherSharePct || ""}
                        onChange={(e) => setTeacherSharePct(Number(e.target.value))}
                      />
                      <p className="mt-1.5 text-[10px] text-muted">
                        {effectivePrice} DA × {teacherSharePctValue} % ={" "}
                        <strong className="text-primary">{teacherShareAmount} DA</strong> pour{" "}
                        <strong className="text-ink">{selectedItem.teacherName}</strong>.
                        {seanceIsOffered && (
                          <>
                            {" "}
                            <strong className="text-warning">
                              Séance offerte : rien ne sera versé.
                            </strong>
                          </>
                        )}
                      </p>
                    </div>
                  )}
                </div>
                )}

                {/* ---- L'encaissement ---- */}
                {seanceIsOffered ? (
                  <div className="rounded-xl border border-warning/30 bg-warning/10 p-3.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-warning">Total à encaisser :</span>
                      <strong className="text-sm font-extrabold text-warning">0 DA</strong>
                    </div>
                    <p className="mt-1 text-[10px] text-muted">
                      Séance offerte — valeur non encaissée : <strong>{waivedPrice} DA</strong>.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between rounded-xl border border-success/20 bg-success/10 p-3.5 text-xs">
                      <span className="font-semibold text-success">Total à encaisser :</span>
                      <strong className="text-sm font-extrabold text-success">
                        {effectivePrice} DA
                      </strong>
                    </div>
                    <label
                      className={`flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-xs transition-colors ${
                        paymentValidated
                          ? "border-success/40 bg-success/10"
                          : "border-line bg-canvas/30 hover:bg-primary-50/40"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={paymentValidated}
                        onChange={(e) => setPaymentValidated(e.target.checked)}
                        className="h-4 w-4 shrink-0"
                      />
                      <span>
                        <strong className="block text-ink">
                          Je valide l&apos;encaissement de {effectivePrice} DA
                        </strong>
                        <span className="block text-[10px] text-muted">
                          Paiement en espèces reçu au guichet.
                        </span>
                      </span>
                    </label>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          <span className="text-[10px] text-muted">
            {!selectedItem
              ? "Sélectionnez l'emploi du temps suivi."
              : seanceIsOffered
                ? `Séance offerte — 0 DA encaissé (valeur ${waivedPrice} DA).`
                : paymentValidated
                  ? `Paiement validé — ${effectivePrice} DA seront encaissés.`
                  : "Validez l'encaissement pour pouvoir enregistrer."}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setIsFormOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!selectedItem || (!seanceIsOffered && !paymentValidated)}
              className="flex items-center gap-2"
            >
              <Check className="h-4 w-4" />
              {selectedCasual
                ? "Enregistrer les modifications"
                : seanceIsOffered
                  ? "Enregistrer la séance offerte"
                  : "Valider & Encaisser"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ------------------------------------------------------------------ */}
      {/* Details                                                             */}
      {/* ------------------------------------------------------------------ */}
      <Modal open={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Détails de la séance libre" wide>
        {selectedCasual && (() => {
          const opt = optionForSession(selectedCasual.sessionId);
          const student = selectedCasual.studentId
            ? students.find((s) => s.id === selectedCasual.studentId)
            : undefined;
          return (
            <div className="space-y-5 text-xs">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-primary-50/50 rounded-xl p-4 border border-line">
                <div>
                  <span className="text-[10px] text-muted block uppercase">Élève / Passager</span>
                  <strong className="text-ink block">
                    {student
                      ? `${student.firstName} ${student.lastName}`
                      : selectedCasual.passagerName || "Passager anonyme"}
                  </strong>
                  <Badge tone={student ? "primary" : "warning"} className="text-[9px] mt-1">
                    {student ? "Élève inscrit" : "Passager"}
                  </Badge>
                </div>
                <div>
                  <span className="text-[10px] text-muted block uppercase">Séance</span>
                  <strong className="text-ink block break-words">{selectedCasual.itemLabel}</strong>
                  <span className="text-[10px] text-muted">
                    {opt?.kind === "timing" ? "Créneau séance libre" : "Cours normal"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-muted block uppercase">Date & horaire</span>
                  <strong className="text-ink block font-mono">{formatDateFr(selectedCasual.date)}</strong>
                  <span className="text-[10px] text-muted font-mono">
                    {selectedCasual.startTime ? `${selectedCasual.startTime} - ${selectedCasual.endTime}` : opt?.timeLabel ?? "-"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-muted block uppercase">Montant encaissé</span>
                  <strong className={`block text-base ${selectedCasual.isFree ? "text-warning" : "text-success"}`}>
                    {selectedCasual.price} DA
                  </strong>
                  {selectedCasual.isFree && (
                    <Badge tone="warning" className="text-[9px] mt-0.5">
                      🎁 Offerte — valeur {selectedCasual.waivedAmount ?? 0} DA
                    </Badge>
                  )}
                  <span className="text-[10px] text-muted block">Créée le {createdStamp(selectedCasual)}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-line rounded-2xl p-4 bg-surface space-y-2">
                  <h4 className="font-bold text-ink text-xs uppercase tracking-wider text-muted mb-2">
                    📚 Contexte de la séance
                  </h4>
                  {[
                    ["Module", opt?.moduleName],
                    ["Classe / Niveau", opt?.classLabel],
                    ["Groupe(s)", opt?.groupLabel],
                    ["Salle(s)", opt?.salleLabel],
                    ["Enseignant", opt ? `${opt.teacherName}${opt.teacherIsPassager ? " (passager)" : ""}` : undefined],
                    ["Jours", opt?.daysLabel],
                    ["Période", opt?.periodLabel],
                  ].map(([label, value]) =>
                    value ? (
                      <div key={label} className="flex justify-between border-b border-line/50 pb-1.5 last:border-0">
                        <span className="text-muted">{label} :</span>
                        <strong className="text-ink text-right">{value}</strong>
                      </div>
                    ) : null,
                  )}
                </div>

                <div className="border border-line rounded-2xl p-4 bg-surface space-y-2">
                  <h4 className="font-bold text-ink text-xs uppercase tracking-wider text-muted mb-2">
                    💰 Règlement
                  </h4>
                  <div className="flex justify-between border-b border-line/50 pb-1.5">
                    <span className="text-muted">Montant :</span>
                    <strong className={selectedCasual.isFree ? "text-warning" : "text-success"}>
                      {selectedCasual.price} DA
                    </strong>
                  </div>
                  <div className="flex justify-between border-b border-line/50 pb-1.5">
                    <span className="text-muted">Mode :</span>
                    <strong className="text-ink">
                      {selectedCasual.isFree ? "Séance offerte (rien encaissé)" : "Espèces (encaissé)"}
                    </strong>
                  </div>
                  {selectedCasual.isFree && (
                    <>
                      <div className="flex justify-between border-b border-line/50 pb-1.5">
                        <span className="text-muted">Valeur offerte :</span>
                        <strong className="text-warning">{selectedCasual.waivedAmount ?? 0} DA</strong>
                      </div>
                      {canSeeGains && (
                        <div className="flex justify-between border-b border-line/50 pb-1.5">
                          <span className="text-muted">Enseignant rémunéré :</span>
                          <strong className="text-ink">Non — séance offerte</strong>
                        </div>
                      )}
                    </>
                  )}
                  {student && (
                    <div className="flex justify-between border-b border-line/50 pb-1.5">
                      <span className="text-muted">Débité du solde :</span>
                      <strong className="text-ink">
                        {selectedCasual.isFree
                          ? "Non (séance offerte)"
                          : student.isFree
                            ? "Non (élève gratuit)"
                            : "Oui"}
                      </strong>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted">Enregistrée le :</span>
                    <strong className="text-ink font-mono">{createdStamp(selectedCasual)}</strong>
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-line">
                <div className="flex gap-2">
                  <Button variant="outline" className="flex items-center gap-1" onClick={() => reprint(selectedCasual)}>
                    <Printer className="h-4 w-4" /> Imprimer le reçu
                  </Button>
                  <Button variant="outline" className="flex items-center gap-1" onClick={() => { setIsDetailsOpen(false); openEdit(selectedCasual); }}>
                    <Edit className="h-4 w-4" /> Modifier
                  </Button>
                </div>
                <Button onClick={() => setIsDetailsOpen(false)}>Fermer</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Séance libre created -> propose the receipt right away */}
      <Modal open={receiptData !== null} onClose={() => setReceiptData(null)} title="Reçu de la Séance Libre">
        {receiptData && (
          <div className="space-y-6 text-center py-4">
            <div className="mx-auto w-12 h-12 bg-success/10 rounded-full flex items-center justify-center text-success text-xl">
              ✔
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-ink">
                {receiptData.isFree
                  ? "Séance libre offerte enregistrée !"
                  : "Séance libre enregistrée et encaissée !"}
              </h3>
              <p className="text-xs text-muted max-w-sm mx-auto leading-relaxed">
                <strong>{receiptData.itemLabel}</strong> pour <strong>{receiptData.personName}</strong> —{" "}
                {receiptData.isFree ? (
                  <>
                    <strong className="text-warning">séance offerte</strong> (valeur{" "}
                    <strong>{receiptData.waived ?? 0} DA</strong>, ni encaissée par l&apos;école ni
                    rémunérée à l&apos;enseignant).
                  </>
                ) : (
                  <>
                    <strong>{receiptData.price} DA</strong> encaissés.
                  </>
                )}
                <br />
                Souhaitez-vous imprimer le reçu ?
              </p>
            </div>

            <div className="flex justify-center gap-3 pt-4 border-t border-line">
              <Button variant="outline" onClick={() => setReceiptData(null)} className="px-5 py-2 rounded-xl text-xs font-bold">
                Ignorer
              </Button>
              <Button
                onClick={() => { handlePrintReceipt(receiptData); setReceiptData(null); }}
                className="px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2"
              >
                <Printer className="h-4 w-4" /> Imprimer le reçu (ticket)
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
