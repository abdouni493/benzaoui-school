"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useData, uid } from "@/lib/store/data";
import { useShallow } from "zustand/react/shallow";
import { createRoleUser, resetUserPassword } from "@/lib/supabase/createUser";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import { FreeBillingBanner } from "@/components/schedule/FreeBillingBanner";
import {
  Eye,
  Plus,
  Search,
  CreditCard,
  Printer,
  DollarSign,
  BookOpen,
  CheckCircle,
  Scan,
  Bell,
  Send,
  AlertTriangle,
  Wallet,
} from "lucide-react";
import type {
  CoursLevel,
  RegistrationFeeKey,
  SchoolClass,
  Student,
  Subscription,
  SubscriptionDates,
  SubscriptionDiscount,
  DiscountType,
  Coursework,
} from "@/lib/types";
import {
  byNewestFirst,
  classCascadeLabel,
  courseKeyOf,
  freeReasonOf,
  FREE_REASON_HINTS,
  FREE_REASON_LABELS,
  studentDebtOf,
  balanceDriftByStudent,
  daysUntil,
  deskPaymentFor,
  enrollmentExpiry,
  formatDateFr,
  formatDays,
  isExpiredOpenSeance,
  matchesAllWords,
  netPriceFor,
  normalizeSearchText,
  registrationFeeOptions,
  todayIso,
  COURS_LEVELS,
  COURS_LEVEL_LABELS,
  EXPIRY_WARNING_DAYS,
  YEAR_ORDER,
} from "@/lib/helpers";
import { useSettings } from "@/lib/store/settings";
import { printHtmlDocument } from "@/lib/print";
import { buildStudentPaymentsReport } from "@/lib/reports/studentPayments";
import { buildRechargeTicket } from "@/lib/reports/rechargeTicket";
import { useScanProcessor } from "@/lib/useScanProcessor";
import { useToast } from "@/lib/store/toast";
import {
  WhatsAppMessageModal,
  type WhatsAppRecipient,
  type WhatsAppStudentContext,
} from "@/components/whatsapp/WhatsAppMessageModal";
import { buildBalanceAlert } from "@/lib/whatsapp/alert";
import type { SendResponse } from "@/lib/whatsapp/types";
import {
  EnrollmentCards,
  selectedGroupIn,
  type AssignGroupOption,
  type AssignItem,
} from "@/components/students/EnrollmentPicker";
import {
  PayDebtModal,
  StudentDetailsModal,
  TX_TYPE_LABELS,
} from "@/components/students/StudentDetailsModal";
import { StudentCardGrid, type StudentCardActions } from "@/components/students/StudentCard";

/** Domaine des identifiants du portail. Les comptes élèves ne servent qu'à se
 *  connecter à l'application : l'adresse est fabriquée, jamais une vraie boîte
 *  mail, d'où un domaine unique pour toute l'école. */
const PORTAL_EMAIL_DOMAIN = "benzaoui.com";

/** Destinataires par appel à /api/whatsapp/send. La route refuse au-delà : elle
 *  temporise 3 à 7 s entre deux messages pour protéger le numéro WhatsApp de
 *  l'école, et doit rendre la main avant la limite d'exécution de Vercel. */
const WA_BATCH_SIZE = 8;

/** Les trois écrans qui touchent au dossier d'un élève. « Ajouter un étudiant »
 *  et « Modifier l'étudiant » affichent exactement les mêmes blocs ; l'écran
 *  « Inscriptions » n'en reprend que le choix des créneaux. */
type StudentFormMode = "create" | "edit" | "assign";

export function StudentsPage() {
  const {
    school,
    students,
    subscriptions,
    sessions,
    classes,
    modules,
    teachers,
    groups,
    salles,
    coursework,
    balanceTx,
    attendance,
    absencePenalties,
    parents,
    filieres,
    studentCredentials,
    complete,
    push,
    deleteFrom,
    updateItem,
    addBalance,
    settleRegistrationFee,
    payRegistrationFeeCash,
    setStudentPassword,
  } = useData(
    useShallow((s) => ({
      school: s.school,
      students: s.students,
      subscriptions: s.subscriptions,
      sessions: s.sessions,
      classes: s.classes,
      modules: s.modules,
      teachers: s.teachers,
      groups: s.groups,
      salles: s.salles,
      coursework: s.coursework,
      balanceTx: s.balanceTx,
      attendance: s.attendance,
      absencePenalties: s.absencePenalties,
      parents: s.parents,
      filieres: s.filieres,
      studentCredentials: s.studentCredentials,
      complete: s.complete,
      push: s.push,
      deleteFrom: s.deleteFrom,
      updateItem: s.updateItem,
      addBalance: s.addBalance,
      settleRegistrationFee: s.settleRegistrationFee,
      payRegistrationFeeCash: s.payRegistrationFeeCash,
      setStudentPassword: s.setStudentPassword,
    })),
  );

  const { language, autoSendWhatsapp, autoSendEmail, setAutoSendWhatsapp, setAutoSendEmail } = useSettings();
  const { addToast } = useToast();
  // Le scan de cette page passe par EXACTEMENT le même pipeline que le lecteur
  // physique (GlobalRFIDListener) : RPC scan_card, repli sur le badge
  // travailleur, annonce vocale, toasts et alertes WhatsApp automatiques.
  const processScan = useScanProcessor();

  // Search & Filtering
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "debt" | "paid" | "free" | "soon">("all");

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [detailsStudentId, setDetailsStudentId] = useState<string | null>(null);
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [isTopupOpen, setIsTopupOpen] = useState(false);
  const [payDebtStudentId, setPayDebtStudentId] = useState<string | null>(null);
  const [isScanOpen, setIsScanOpen] = useState(false);
  const [isAlertLowBalanceOpen, setIsAlertLowBalanceOpen] = useState(false);
  const [isDebtorsOpen, setIsDebtorsOpen] = useState(false);
  const [selectedAlertStudentIds, setSelectedAlertStudentIds] = useState<string[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  // WhatsApp — fenêtre d'envoi partagée par les boutons « élève » et « parent »
  const [waTarget, setWaTarget] = useState<{
    recipients: WhatsAppRecipient[];
    students: WhatsAppStudentContext[];
    defaultRecipientIds: string[];
  } | null>(null);
  const [sendingAlerts, setSendingAlerts] = useState(false);

  // Form: Create/Edit Student
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState("");
  const [rfid, setRfid] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isFree, setIsFree] = useState(false);
  const [isEmailDirty, setIsEmailDirty] = useState(false);
  const [isPasswordDirty, setIsPasswordDirty] = useState(false);
  /** L'homonyme dont on regarde le dossier, sans quitter l'écran de création.
   *  `null` = l'alerte est affichée mais aucun dossier n'est ouvert. */
  const [duplicateOpenId, setDuplicateOpenId] = useState<string | null>(null);

  // Form: first top-up written straight from the creation screen. It goes
  // through the very same `add_student_balance` RPC as the "Recharge" button,
  // so it lands in the student's transaction history and in the caisse.
  const [initialTopup, setInitialTopup] = useState<number>(0);
  const [initialTopupDesc, setInitialTopupDesc] = useState("Premier versement");

  // Form: which of the school's two registration tariffs this student is
  // charged, and whether he settles it right now or leaves it as a debt on his
  // file. `undefined` = reception has not touched the choice, so the first
  // tariff the school actually charges applies (the school row lands after the
  // first render, and "fee1" may well be the one left at 0); `null` = the desk
  // said "aucun frais" out loud.
  const [createFeeKey, setCreateFeeKey] = useState<RegistrationFeeKey | null | undefined>(undefined);
  /** La réception a choisi le tarif À LA MAIN : plus rien ne le change ensuite
   *  (ni la règle « 3e année secondaire », ni un changement de scolarité). */
  const [createFeeTouched, setCreateFeeTouched] = useState(false);
  const [createFeePayNow, setCreateFeePayNow] = useState(false);

  // Form: same choice on the EDIT screen, except that a student already carries
  // an amount on his file. `"current"` = leave that amount exactly as it is, so
  // opening the screen and saving never silently re-prices his inscription;
  // `null` = « aucun frais », which wipes what is still due.
  const [editFeeKey, setEditFeeKey] = useState<RegistrationFeeKey | null | "current">("current");
  const [editFeePayNow, setEditFeePayNow] = useState(false);

  // Form: inscriptions taken at creation time. Reception walks down niveau →
  // année → filière, then ticks the créneaux of that combination (the picked
  // groups are kept in the shared `selectedAssignIds` / dates / reductions
  // state used by the "Affecter" modal). The search box short-circuits the
  // three steps by matching "niveau + année + filière" in one go.
  const [createClassSearch, setCreateClassSearch] = useState("");
  const [createLevel, setCreateLevel] = useState<"" | CoursLevel | "formation">("");
  /** année of the picked niveau — or, on the formations branch, their level. */
  const [createYear, setCreateYear] = useState("");
  /** filière id, or "none" for the classes that carry no filière. */
  const [createFiliereId, setCreateFiliereId] = useState("");

  // Form: Topup
  const [topupAmount, setTopupAmount] = useState<number>(0);
  const [topupDesc, setTopupDesc] = useState("Recharge de solde");
  const [topupDate, setTopupDate] = useState(new Date().toISOString().split("T")[0]);
  const [settleReg, setSettleReg] = useState(false);

  // Frais d'inscription : DEUX portes, jamais confondues. « Sur le solde »
  // débite l'élève (et le fait plonger en dette si le solde ne suit pas),
  // « à part » encaisse l'argent en caisse et ne touche pas au solde.
  const [isRegFeeOpen, setIsRegFeeOpen] = useState(false);
  const [regFeeStudent, setRegFeeStudent] = useState<Student | null>(null);
  const [regFeeBusy, setRegFeeBusy] = useState(false);
  /** La fiche relue dans le store : après un règlement `fetchAll` rafraîchit la
   *  liste, et la fenêtre affiche le montant que la BASE dit encore dû — jamais
   *  celui que la carte cliquée portait il y a une minute. */
  const regFeeLive = regFeeStudent
    ? (students.find((st) => st.id === regFeeStudent.id) ?? regFeeStudent)
    : null;
  const regFeeDue = regFeeLive?.registrationDue ?? 0;

  // Print Confirm Modal Data
  const [printConfirmData, setPrintConfirmData] = useState<{
    student: Student;
    amount: number;
    description: string;
    settledReg: boolean;
  } | null>(null);

  // Print payments over a period (same flow as the teacher report)
  const [isPrintPayOpen, setIsPrintPayOpen] = useState(false);
  const [printPayStart, setPrintPayStart] = useState("");
  const [printPayEnd, setPrintPayEnd] = useState("");

  // Form: Assign subscription/coursework
  const [selectedAssignIds, setSelectedAssignIds] = useState<string[]>([]); // subscription or coursework ids
  // Enrollment dates, kept per subscription id for EVERY module (cours and
  // formations): the day the student was registered, and the day billing opens.
  const [assignSubDates, setAssignSubDates] = useState<Record<string, string>>({}); // sub id -> date d'inscription
  const [assignStartDates, setAssignStartDates] = useState<Record<string, string>>({}); // sub id -> date de début
  // Per-module reduction: subscription id -> { type, value }
  const [assignDiscounts, setAssignDiscounts] = useState<Record<string, SubscriptionDiscount>>({});
  // "Réduction groupée": one reduction applied at once to every ticked module
  const [bulkDiscountType, setBulkDiscountType] = useState<DiscountType>("percent");
  const [bulkDiscountValue, setBulkDiscountValue] = useState<number>(0);

  // Active overlay actions index
  const [overlayStudentId, setOverlayStudentId] = useState<string | null>(null);

  // Scanner state — le verdict détaillé affiché sous le champ. Le pipeline
  // partagé (useScanProcessor) s'occupe du reste : voix, toasts, alertes.
  const [scanRfidInput, setScanRfidInput] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [scanResult, setScanResult] = useState<{
    ok: boolean;
    studentName?: string;
    cost?: number;
    waived?: number;
    newBalance?: number;
    session?: string;
    msg?: string;
    /** verdict neutre (ni succès ni échec) : déjà pointé, badge travailleur… */
    neutral?: boolean;
  } | null>(null);

  // The selected student is a snapshot: re-sync it after every store refresh
  // (scan, topup, fetchAll) so the detail view never shows stale data.
  useEffect(() => {
    if (!selectedStudent) return;
    const fresh = students.find((s) => s.id === selectedStudent.id);
    if (fresh && fresh !== selectedStudent) setSelectedStudent(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students]);

  // ---- Index ---------------------------------------------------------------------
  // La liste affiche des centaines de cartes, chacune avec ses abonnements : un
  // `.find()` par libellé dans chaque table, c'était des centaines de milliers
  // de comparaisons à CHAQUE frappe au clavier. Les tables sont indexées une
  // fois, et chaque libellé calculé une fois, tant qu'elles ne changent pas.
  const lookups = useMemo(
    () => ({
      subscription: new Map(subscriptions.map((s) => [s.id, s])),
      session: new Map(sessions.map((s) => [s.id, s])),
      module: new Map(modules.map((m) => [m.id, m])),
      classe: new Map(classes.map((c) => [c.id, c])),
      filiere: new Map(filieres.map((f) => [f.id, f])),
      coursework: new Map(coursework.map((c) => [c.id, c])),
    }),
    [subscriptions, sessions, modules, classes, filieres, coursework],
  );

  /** Libellé « Module (classe - niveau - filière) » de chaque abonnement. */
  const moduleLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const cw of coursework) labels.set(cw.id, `Stage: ${cw.name}`);
    for (const sub of subscriptions) {
      const s = lookups.session.get(sub.sessionId);
      if (!s) {
        labels.set(sub.id, "Séance inconnue");
        continue;
      }
      const mod = lookups.module.get(s.moduleId)?.name ?? "Module";
      const cls = lookups.classe.get(s.classId);
      if (!cls) {
        labels.set(sub.id, mod);
        continue;
      }
      const level = cls.coursLevel || cls.formationLevel || "";
      const fil = (cls.filiereId && lookups.filiere.get(cls.filiereId)?.name) || "";

      let classNameClean = cls.name || "";
      if (fil) {
        const escaped = fil.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        classNameClean = classNameClean.replace(new RegExp(`\\s*-\\s*${escaped}`, "i"), "").trim();
      }

      const parts: string[] = [];
      if (classNameClean) parts.push(classNameClean);
      if (level) parts.push(level);
      if (fil) parts.push(fil);
      labels.set(sub.id, `${mod} (${parts.join(" - ")})`);
    }
    return labels;
  }, [subscriptions, coursework, lookups]);

  const getModuleLabel = useCallback(
    (subId: string) => moduleLabels.get(subId) ?? "Abonnement inconnu",
    [moduleLabels],
  );

  const getSubLabel = (subId: string) => {
    const sub = lookups.subscription.get(subId);
    if (!sub) {
      // Check if it's a coursework instead
      const cw = lookups.coursework.get(subId);
      if (cw) return `Stage: ${cw.name}`;
      return "Abonnement inconnu";
    }
    const s = lookups.session.get(sub.sessionId);
    if (!s) return "Séance inconnue";
    const mod = lookups.module.get(s.moduleId)?.name ?? "Module";
    const cls = lookups.classe.get(s.classId)?.name ?? "Classe";
    return `${cls} - ${mod}`;
  };

  /** The subscription, if it belongs to a formation class (level-priced, time-limited). */
  const getFormationSub = (subId: string): Subscription | undefined => {
    const sub = lookups.subscription.get(subId);
    if (!sub) return undefined;
    const sess = lookups.session.get(sub.sessionId);
    const cls = sess ? lookups.classe.get(sess.classId) : undefined;
    return cls?.type === "formation" || sub.periodMonths ? sub : undefined;
  };

  // Auto-generate credentials when firstName, lastName, or birthDate changes in the creation modal
  useEffect(() => {
    if (isCreateOpen) {
      const cleanedFirst = firstName.trim().toLowerCase().replace(/\s+/g, "");
      const cleanedLast = lastName.trim().toLowerCase().replace(/\s+/g, "");
      const cleanedBirth = birthDate.replace(/-/g, "");

      if (cleanedFirst && cleanedLast && cleanedBirth) {
        if (!isEmailDirty) {
          setEmail(`${cleanedFirst}${cleanedLast}${cleanedBirth}@${PORTAL_EMAIL_DOMAIN}`);
        }
        if (!isPasswordDirty) {
          setPassword(`${cleanedFirst}${cleanedLast}${cleanedBirth}`);
        }
      } else {
        if (!isEmailDirty) {
          setEmail("");
        }
        if (!isPasswordDirty) {
          setPassword("");
        }
      }
    }
  }, [firstName, lastName, birthDate, isCreateOpen, isEmailDirty, isPasswordDirty]);

  /**
   * Les élèves qui portent EXACTEMENT le nom en train d'être saisi.
   *
   * Deux frères inscrits deux fois, un élève réinscrit à la rentrée par une
   * autre personne du guichet : le doublon ne se voyait qu'après coup, une
   * fois deux dossiers ouverts, deux soldes et deux cartes en circulation.
   * La comparaison ignore la casse, les accents et les espaces en trop — «
   * Belkacem » et « BELKACEM » sont le même nom — mais elle reste EXACTE sur
   * les deux champs : un simple homonyme de prénom n'alerte pas.
   *
   * Ce n'est qu'un AVERTISSEMENT : deux élèves peuvent parfaitement porter le
   * même nom, et la création reste ouverte.
   */
  const nameDuplicates = useMemo(() => {
    const f = normalizeSearchText(firstName.trim());
    const l = normalizeSearchText(lastName.trim());
    if (!f || !l) return [];
    return students.filter(
      (st) =>
        normalizeSearchText(st.firstName.trim()) === f &&
        normalizeSearchText(st.lastName.trim()) === l,
    );
  }, [students, firstName, lastName]);

  /** Un homonyme dont on regarde le dossier n'a de sens que tant qu'il est
   *  dans la liste : changer le nom saisi referme le dossier. */
  const openDuplicate = nameDuplicates.find((st) => st.id === duplicateOpenId) ?? null;

  const isSoonToRunOut = useCallback(
    (student: Student) => {
      if (student.isFree) return false;
      const studentSubs = student.subscriptionIds
        .map((id) => lookups.subscription.get(id))
        .filter((s): s is Subscription => !!s);
      const minCost = studentSubs.length > 0 ? Math.max(...studentSubs.map((s) => s.pricePerSession)) : 500;
      return student.balance >= 0 && student.balance < minCost * 2;
    },
    [lookups],
  );
  /** Les soldes presque épuisés — lus par le bouton « Alertes Soldes », son
   *  compteur et sa fenêtre : calculés une seule fois. */
  const soonStudents = useMemo(() => students.filter(isSoonToRunOut), [students, isSoonToRunOut]);

  // Ce qu'un élève doit se lit ENTIÈREMENT sur sa fiche : son solde (négatif
  // = séances suivies non payées) et ses frais d'inscription. Le solde porte
  // déjà chaque présence facturée — badge comme pointage manuel la font
  // descendre du prix de la séance, dans la même transaction que sa ligne
  // d'historique. Ré-additionner les présences par-dessus compterait deux fois
  // les mêmes séances : c'est ce qui affichait « DETTE : 600 DA » sur une
  // fiche à +1250 DA.
  //
  // L'écart solde ↔ historique reste surveillé, mais à part : c'est une
  // incohérence à réparer en base, jamais un montant à encaisser.
  const driftByStudent = useMemo(
    () =>
      balanceDriftByStudent({
        students,
        balanceTx,
        complete: complete.balanceTx !== false,
      }),
    [students, balanceTx, complete.balanceTx],
  );
  /** La dette de chaque élève, calculée une fois par changement de données :
   *  une carte reçoit le MÊME objet tant que rien n'a bougé pour elle, et
   *  n'est donc pas redessinée. */
  const debtById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof studentDebtOf>>();
    for (const stu of students) {
      map.set(stu.id, studentDebtOf(stu, { drift: driftByStudent.get(stu.id) ?? 0 }));
    }
    return map;
  }, [students, driftByStudent]);
  const debtOf = useCallback(
    (student: Student) =>
      debtById.get(student.id) ?? studentDebtOf(student, { drift: driftByStudent.get(student.id) ?? 0 }),
    [debtById, driftByStudent],
  );

  // Tous ceux à qui l'école réclame quelque chose, du plus lourd au plus
  // léger. Le compteur du bouton et la fenêtre lisent la même liste.
  const { debtors, totalOwed } = useMemo(() => {
    const rows = students
      .map((stu) => ({ stu, debt: debtOf(stu) }))
      .filter((row) => row.debt.alert)
      .map((row) => ({ ...row, owed: row.debt.total }))
      .sort((a, b) => b.owed - a.owed);
    return { debtors: rows, totalOwed: rows.reduce((sum, row) => sum + row.owed, 0) };
  }, [students, debtOf]);

  // La saisie reste fluide : le filtrage suit la frappe avec un temps de retard
  // plutôt que de la bloquer à chaque lettre.
  const deferredSearch = useDeferredValue(searchQuery);

  // Filter students based on queries
  const filteredStudents = useMemo(() => {
    // La carte se cherche comme le reste : sans se soucier de la casse ni
    // des espaces, exactement comme le scan la lit.
    const query = deferredSearch.trim().toLowerCase();
    const rawQuery = deferredSearch.trim();
    const soon = filterType === "soon" ? new Set(soonStudents.map((s) => s.id)) : null;
    return students
      .filter((s) => {
        if (query) {
          const nameMatch = `${s.firstName} ${s.lastName}`.toLowerCase().includes(query);
          const phoneMatch = s.phone.includes(rawQuery);
          const emailMatch = s.email.toLowerCase().includes(query);
          const rfidMatch = (s.rfid ?? "").trim().toLowerCase().includes(query);
          if (!nameMatch && !phoneMatch && !emailMatch && !rfidMatch) return false;
        }

        // « En dette » retient aussi l'élève dont le solde ment : des séances
        // facturées dans son historique que le solde n'a jamais enregistrées.
        if (filterType === "debt") return debtOf(s).alert;
        if (filterType === "paid") return !debtOf(s).alert;
        if (filterType === "free") return s.isFree;
        if (filterType === "soon") return soon?.has(s.id) ?? false;

        return true;
      })
      // Du plus récemment inscrit au plus ancien : la fiche qu'on vient
      // d'enregistrer est la première sous les yeux de la réception.
      .sort(byNewestFirst);
  }, [students, deferredSearch, filterType, debtOf, soonStudents]);

  const handleCreateStudent = async () => {
    if (!firstName || !lastName || !phone || !rfid) {
      alert("Prénom, nom, téléphone et carte RFID sont obligatoires.");
      return;
    }
    if (password.length < 6) {
      alert("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }

    const finalEmail =
      email || `${firstName.toLowerCase()}.${rfid.toLowerCase()}@${PORTAL_EMAIL_DOMAIN}`;

    // Inscriptions picked on this same screen, plus the registration tariff
    // chosen just above (« Frais d'inscription ») — paying students only.
    const enrollIds = [...selectedAssignIds];
    const registrationDue = createRegistrationFee;
    const registrationLabel = createFeeOption?.label ?? "Frais d'inscription";

    const topupAmountToWrite = Math.round(initialTopup || 0);
    const settleRegistrationNow = settleRegistrationOnCreate;

    try {
      const { id: studentId } = await createRoleUser({
        role: "student",
        email: finalEmail,
        password,
        firstName,
        lastName,
        phone,
        birthDate,
        rfid,
        isFree,
        registrationDue,
      });

      const newStudent: Student = {
        id: studentId,
        firstName,
        lastName,
        birthDate,
        phone,
        email: finalEmail,
        rfid,
        balance: 0,
        isFree,
        subscriptionIds: [],
        registrationDue,
        // La base pose la sienne (`created_at` par défaut) ; celle-ci sert le
        // temps que la liste soit relue, pour que la fiche soit en tête tout
        // de suite et non après un rechargement.
        createdAt: new Date().toISOString(),
      };
      push("students", newStudent);

      // Keep the portal password so the payment receipt can print the login.
      // It lives in a staff-only table — never readable by the student/parent.
      await setStudentPassword(studentId, password);

      // The top-up RPC ends with a full refetch, so it has to run BEFORE the
      // enrollment write — otherwise that refetch would land while the
      // student_subscriptions rows are still in flight and wipe them locally.
      let topupError = "";
      if (topupAmountToWrite > 0) {
        // A first payment is made: the fee (when settled now) is taken out of
        // it, so the student walks away with the remainder on his balance.
        const res = await addBalance(
          studentId,
          topupAmountToWrite,
          initialTopupDesc.trim() || "Premier versement",
          settleRegistrationNow,
        );
        if (!res.ok) topupError = res.error ?? "erreur inconnue";
      } else if (settleRegistrationNow) {
        // No first top-up, but the inscription IS paid at the desk: it is
        // encashed on its own. The caisse receives the fee and the balance
        // stays at zero (+fee versé, -fee inscription).
        const res = await addBalance(
          studentId,
          registrationDue,
          `Frais d'inscription — ${registrationLabel}`,
          true,
        );
        if (!res.ok) topupError = res.error ?? "erreur inconnue";
      }

      if (enrollIds.length > 0) {
        updateItem("students", studentId, {
          subscriptionIds: enrollIds,
          subscriptionDates: buildEnrollmentDates(enrollIds),
          subscriptionDiscounts: buildEnrollmentDiscounts(enrollIds),
        });
      }

      const studentName = `${firstName} ${lastName}`;
      setIsCreateOpen(false);
      resetForm();
      // Être en tête de liste ne sert à rien si une recherche ou un filtre en
      // cours l'exclut : la réception verrait l'écran inchangé et croirait
      // l'enregistrement perdu. On rouvre donc la liste entière.
      setSearchQuery("");
      setFilterType("all");

      const settled = settleRegistrationNow && !topupError;
      // Alarme : la fiche part du guichet avec une inscription non réglée.
      const unpaidRegistration = registrationDue > 0 && !settled;
      addToast({
        type: topupError || unpaidRegistration ? "warning" : "success",
        title: topupError
          ? "Étudiant créé — versement en échec"
          : unpaidRegistration
            ? "⚠️ Étudiant créé — FRAIS D'INSCRIPTION NON PAYÉS"
            : "Étudiant créé",
        message: [
          `${studentName} a été enregistré.`,
          topupError
            ? `Le paiement n'a PAS été enregistré (${topupError}) — refaites-le depuis « Recharge ».`
            : topupAmountToWrite > 0
              ? `Solde initial: ${topupAmountToWrite - (settled ? registrationDue : 0)} DA (visible dans son historique).`
              : "",
          enrollIds.length > 0 ? `${enrollIds.length} inscription(s) enregistrée(s).` : "",
          registrationDue > 0
            ? settled
              ? `${registrationLabel} : ${registrationDue} DA encaissés.`
              : `${registrationLabel} : ${registrationDue} DA RESTENT DUS — sa fiche est signalée « inscription impayée » jusqu'au règlement.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur lors de la création du compte.");
    }
  };

  /**
   * Saves the edit screen — the mirror of `handleCreateStudent`, on a file that
   * already exists: identité, frais d'inscription, versement et inscriptions in
   * one pass. Every block defaults to the student's current state, so saving
   * without touching one writes it back unchanged.
   */
  const handleEditStudent = async () => {
    if (!selectedStudent) return;
    const stu = selectedStudent;

    if (!firstName || !lastName || !phone || !rfid) {
      alert("Prénom, nom, téléphone et carte RFID sont obligatoires.");
      return;
    }
    // Empty = keep the password in place; typed = it must be a valid one.
    if (password && password.length < 6) {
      alert("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }

    if (password) {
      try {
        await resetUserPassword(stu.id, password);
        // Mirror the new password into the staff-only table so the receipt
        // keeps printing credentials that actually work.
        await setStudentPassword(stu.id, password);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Erreur lors du changement de mot de passe.");
        return;
      }
    }

    const enrollIds = [...selectedAssignIds];
    const fee = editRegistrationFee;
    const feeLabel = editFeeOption?.label ?? "Frais d'inscription";
    const payNow = settleRegistrationOnEdit;
    const topup = Math.round(initialTopup || 0);

    // ---- 1. L'argent d'abord ------------------------------------------------
    // Same RPC as the "Recharge" button (history row + caisse entry), and it
    // ends with a full refetch — so it has to run BEFORE the enrollment write,
    // otherwise that refetch would land while the student_subscriptions rows
    // are still in flight and wipe them locally.
    // A fee settled here is taken out of the versement, exactly as at creation:
    // only what the desk actually receives goes into the caisse.
    const { cashed } = deskPaymentFor(topup, fee, payNow);
    let moneyError = "";
    if (cashed > 0) {
      const description =
        topup > 0 ? initialTopupDesc.trim() || "Versement" : `Frais d'inscription — ${feeLabel}`;
      const res = await addBalance(stu.id, cashed, description, false);
      if (!res.ok) moneyError = res.error ?? "erreur inconnue";
    }

    // ---- 2. Les frais d'inscription ----------------------------------------
    // `add_student_balance` settles whatever the DATABASE says is still due, so
    // it cannot be used when the desk has just picked another tariff. The
    // registration line is therefore written here, against the amount shown on
    // the screen: +versement encaissé, -frais, comme à la création.
    let registrationDue = fee;
    if (payNow && !moneyError && fee > 0) {
      // Débit RELATIF au solde stocké, historique compris, en une transaction.
      // Repartir d'un solde lu côté client — même fraîchement rafraîchi —
      // laissait la place à un badge arrivé entre la lecture et l'écriture,
      // dont le débit était alors effacé.
      const res = await settleRegistrationFee(stu.id, fee, `Frais d'inscription — ${feeLabel}`);
      if (!res.ok) moneyError = res.error ?? "erreur inconnue";
      else registrationDue = 0;
    }

    // ---- 3. Identité + inscriptions ----------------------------------------
    updateItem("students", stu.id, {
      firstName,
      lastName,
      birthDate,
      phone,
      email,
      rfid,
      isFree,
      registrationDue,
      subscriptionIds: enrollIds,
      subscriptionDates: buildEnrollmentDates(enrollIds),
      subscriptionDiscounts: buildEnrollmentDiscounts(enrollIds),
    });

    const studentName = `${firstName} ${lastName}`;
    setIsEditOpen(false);
    resetForm();

    addToast({
      type: moneyError ? "warning" : "success",
      title: moneyError ? "Modifications enregistrées — versement en échec" : "Modifications enregistrées",
      message: [
        `La fiche de ${studentName} a été mise à jour.`,
        moneyError
          ? `Le paiement n'a PAS été enregistré (${moneyError}) — refaites-le depuis « Recharge ».`
          : topup > 0
            ? `Versement de ${topup} DA encaissé.`
            : "",
        `${enrollIds.length} inscription(s) enregistrée(s).`,
        payNow && !moneyError
          ? `${feeLabel} : ${fee} DA encaissés.`
          : registrationDue > 0
            ? `${feeLabel} : ${registrationDue} DA restent dus.`
            : "",
      ]
        .filter(Boolean)
        .join(" "),
    });
  };

  const handleDelete = (id: string) => {
    if (confirm("Êtes-vous sûr de vouloir supprimer cet étudiant ?")) {
      deleteFrom("students", id);
      setOverlayStudentId(null);
    }
  };

  const handleTopup = async () => {
    if (!selectedStudent || topupAmount <= 0) return;
    const amount = topupAmount;
    const desc = topupDesc;
    const settle = settleReg;
    const stu = selectedStudent;

    setIsTopupOpen(false);
    setOverlayStudentId(null);

    await addBalance(stu.id, amount, desc, settle);

    setPrintConfirmData({
      student: stu,
      amount,
      description: desc,
      settledReg: settle,
    });
  };

  /** L'alerte « inscription impayée » d'une carte élève ouvre la fenêtre de
   *  règlement : c'est là que se choisit la porte — sur le solde, ou à part. */
  const openRegFee = (student: Student) => {
    if (!student.registrationDue) return;
    setRegFeeStudent(student);
    setIsRegFeeOpen(true);
    setOverlayStudentId(null);
  };

  /**
   * Régler les frais d'inscription, par l'une des DEUX portes.
   *
   *   · "balance" — l'élève paie avec ce qu'il a déjà versé. Son solde descend
   *     du montant des frais, et rien n'entre en caisse : l'argent y était
   *     déjà entré le jour de la recharge. Si le solde ne couvre pas, il passe
   *     en dette — l'école a fourni la place, elle la compte.
   *   · "cash" — l'élève paie les frais SÉPARÉMENT, au guichet. L'argent entre
   *     en caisse aujourd'hui et le solde ne bouge pas d'un dinar : sa
   *     recharge reste intacte pour ses séances.
   *
   * Les deux passent par une RPC : le solde et `registration_due` bougent
   * relativement à ce que la BASE porte, jamais à ce que l'écran croyait
   * savoir il y a dix minutes.
   */
  const handleRegFeePayment = async (source: "balance" | "cash") => {
    // La fiche RELUE dans le store, et le montant que la base dit encore dû :
    // la carte cliquée peut dater d'un badge ou d'un règlement plus récent.
    const student = regFeeLive;
    const due = regFeeDue;
    if (!student || due <= 0 || regFeeBusy) return;
    setRegFeeBusy(true);
    const res =
      source === "balance"
        ? await settleRegistrationFee(student.id, undefined, "Frais d'inscription réglés sur le solde")
        : await payRegistrationFeeCash(student.id, undefined, "Frais d'inscription encaissés au guichet");
    setRegFeeBusy(false);
    if (res.ok) {
      setIsRegFeeOpen(false);
      setRegFeeStudent(null);
    }
    addToast({
      type: res.ok ? "success" : "danger",
      title: res.ok ? "Frais d'inscription réglés" : "Règlement refusé",
      message: res.ok
        ? source === "balance"
          ? `${due} DA retirés du solde — nouveau solde : ${res.newBalance ?? 0} DA.`
          : `${due} DA encaissés en caisse — le solde reste à ${res.newBalance ?? student.balance} DA.`
        : `La base a refusé le règlement : ${res.error ?? "erreur inconnue"}.`,
      studentName: `${student.firstName} ${student.lastName}`,
    });
  };

  /**
   * Scan depuis l'écran Étudiants.
   *
   * Il ne fait PLUS son propre appel RPC : il délègue à `processScan`, le
   * pipeline unique partagé avec le lecteur physique. Il en tire donc, sans
   * duplication, le repli sur le badge travailleur, l'annonce vocale, les
   * toasts et les alertes WhatsApp automatiques — puis il affiche en plus son
   * verdict détaillé sous le champ.
   *
   * Le code est normalisé (espaces retirés) avant l'envoi : un code collé ou
   * saisi avec une espace parasite ne doit plus répondre « carte introuvable ».
   */
  const handleScanCard = async () => {
    const code = scanRfidInput.trim();
    if (!code || scanBusy) return;

    setScanBusy(true);
    let res;
    try {
      res = await processScan(code);
    } finally {
      setScanBusy(false);
    }

    // Le badge a été reconnu comme celui d'un TRAVAILLEUR (pointage) : le
    // pipeline a déjà tout fait, on se contente de le dire ici aussi.
    if (res.messageKey.startsWith("worker.")) {
      const workerMsgs: Record<string, string> = {
        "worker.clockIn": "Badge travailleur — arrivée pointée.",
        "worker.clockOut": "Badge travailleur — départ pointé, journée clôturée.",
        "worker.alreadyClosed": "Badge travailleur — journée déjà clôturée.",
        "worker.frozen": "Badge travailleur — journée gelée, corrigez l'heure de fin sur sa fiche.",
      };
      setScanResult({
        ok: res.ok,
        neutral: true,
        studentName: "Badge travailleur",
        msg: workerMsgs[res.messageKey] ?? "Badge travailleur traité.",
      });
      setScanRfidInput("");
      return;
    }

    // `students` du store peut dater d'avant le refetch déclenché par le scan :
    // on résout l'élève par l'id renvoyé par le RPC en priorité, puis par son
    // code de carte (comparaison insensible à la casse).
    const matchedStu =
      (res.studentId ? students.find((s) => s.id === res.studentId) : undefined) ??
      students.find(
        (s) => (s.rfid ?? "").trim().toLowerCase() === code.toLowerCase() || s.id === code,
      );
    const who = matchedStu ? `${matchedStu.firstName} ${matchedStu.lastName}` : undefined;

    const seance = res.moduleName
      ? `${res.moduleName}${res.groupName ? ` (${res.groupName})` : ""}${
          res.sessionStart ? ` ${res.sessionStart}-${res.sessionEnd}` : ""
        }`
      : undefined;

    if (res.ok) {
      // Rattrapage : présent sur un autre groupe du même cours — accepté.
      const substitution = res.otherGroup
        ? ` Rattrapage sur le groupe ${res.groupName ?? "suivi"}${
            res.ownGroupName ? ` (inscrit en ${res.ownGroupName})` : ""
          }.`
        : "";
      // Séance offerte : période gratuite, créneau de séance libre offert, ou
      // abonnement pas encore commencé — présence écrite, solde intact.
      const offered = res.free
        ? ` Séance OFFERTE${res.freePeriodName ? ` (${res.freePeriodName})` : ""} : aucun débit.`
        : res.preStart
          ? " Abonnement pas encore commencé : séance offerte, aucun débit."
          : "";
      const already = res.messageKey === "scan.alreadyPresent";

      setScanResult({
        ok: true,
        neutral: already,
        studentName: who ?? "Élève",
        cost: res.cost,
        waived: res.waived,
        newBalance: res.newBalance,
        session: seance,
        msg:
          (already
            ? "Élève déjà marqué présent sur cette séance aujourd'hui — aucun débit."
            : res.messageKey === "scan.successLate"
              ? "Présence enregistrée EN RETARD."
              : res.debt
                ? "Présence enregistrée — ATTENTION, le solde est passé en DETTE."
                : "Présence validée.") +
          substitution +
          offered,
      });
    } else {
      const failureMsgs: Record<string, string> = {
        "scan.noSession": "Aucune séance programmée à cette heure.",
        "scan.noSessionToday": "Aucune séance de SON emploi du temps aujourd'hui.",
        "scan.noSessionNow": "Ce n'est pas l'heure de la séance de cet élève.",
        "scan.tooEarly": `Trop tôt — la séance n'a pas encore commencé.${res.nextStart ? ` Prochaine séance à ${res.nextStart}.` : ""}`,
        "scan.sessionEnded": "Séance déjà terminée — scan refusé, l'élève reste absent.",
        "scan.subscriptionExpired": "Abonnement expiré pour la séance d'aujourd'hui.",
        "scan.notEligible":
          "La séance en cours n'est pas dans l'emploi du temps de cet élève — un cours n'accepte que ses propres inscrits.",
        "scan.expired": "Solde épuisé — entrée refusée (aucune présence, aucune dette créée).",
        "scan.debtBlocked": "Élève EN DETTE — entrée refusée. Veuillez régler la dette.",
        "scan.notFound": `Aucun élève ni travailleur ne porte la carte « ${code} ». Vérifiez le code sur sa fiche.`,
        "scan.error": "Le serveur n'a pas répondu au scan — vérifiez la connexion et réessayez.",
      };
      // Le double passage n'est PAS un échec : la présence est déjà écrite.
      const isCooldown = res.messageKey === "scan.cooldown";
      setScanResult({
        ok: false,
        neutral: isCooldown,
        studentName: who ?? "Carte inconnue",
        session: seance,
        msg: isCooldown
          ? "Passage ignoré : moins de 30 min depuis le dernier scan accepté sur ce créneau. La présence précédente reste enregistrée, aucun second débit."
          : failureMsgs[res.messageKey] ?? "Carte refusée — raison inconnue.",
      });
    }
    setScanRfidInput("");
  };

  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setBirthDate("");
    setPhone("");
    setRfid("");
    setEmail("");
    setPassword("");
    setIsFree(false);
    setTopupAmount(0);
    setTopupDesc("Recharge de solde");
    setSettleReg(false);
    setSelectedAssignIds([]);
    setAssignStartDates({});
    setAssignSubDates({});
    setAssignDiscounts({});
    setBulkDiscountType("percent");
    setBulkDiscountValue(0);
    setSelectedStudent(null);
    setIsEmailDirty(false);
    setIsPasswordDirty(false);
    setDuplicateOpenId(null);
    setInitialTopup(0);
    setInitialTopupDesc("Premier versement");
    setCreateFeeKey(undefined);
    setCreateFeeTouched(false);
    setCreateFeePayNow(false);
    setEditFeeKey("current");
    setEditFeePayNow(false);
    setCreateClassSearch("");
    setCreateLevel("");
    setCreateYear("");
    setCreateFiliereId("");
  };

  /** Loads a student's inscriptions into the shared enrollment form: the
   *  créneaux he is on, the dates already recorded and his reductions. Shared by
   *  « Modifier l'étudiant » and « Inscriptions », so both reopen on exactly
   *  what he has instead of on an empty selection. */
  const loadEnrollmentForm = (stu: Student) => {
    setSelectedAssignIds(stu.subscriptionIds);
    const starts: Record<string, string> = {};
    const subscribed: Record<string, string> = {};
    for (const subId of stu.subscriptionIds) {
      const dates = stu.subscriptionDates?.[subId];
      if (dates?.startDate) starts[subId] = dates.startDate;
      if (dates?.subscribedAt) subscribed[subId] = dates.subscribedAt;
    }
    setAssignStartDates(starts);
    setAssignSubDates(subscribed);
    setAssignDiscounts({ ...(stu.subscriptionDiscounts ?? {}) });
    setBulkDiscountType("percent");
    setBulkDiscountValue(0);
    // The niveau → année → filière cascade always reopens closed.
    setCreateClassSearch("");
    setCreateLevel("");
    setCreateYear("");
    setCreateFiliereId("");
  };

  const openEdit = (stu: Student) => {
    setSelectedStudent(stu);
    setFirstName(stu.firstName);
    setLastName(stu.lastName);
    setBirthDate(stu.birthDate);
    setPhone(stu.phone);
    setRfid(stu.rfid);
    setEmail(stu.email);
    setPassword("");
    setIsFree(stu.isFree);
    setIsEmailDirty(false);
    setIsPasswordDirty(false);
    loadEnrollmentForm(stu);
    // Frais d'inscription: reopen on what he actually owes. A due amount that
    // matches one of the school's tariffs shows that tariff as picked; anything
    // else is kept as-is ("Montant actuel") so saving never re-prices it.
    const due = stu.registrationDue ?? 0;
    const matching = createFeeOptions.find((o) => o.amount === due);
    setEditFeeKey(due === 0 ? null : matching ? matching.key : "current");
    setEditFeePayNow(false);
    // Nothing is cashed unless the desk types an amount.
    setInitialTopup(0);
    setInitialTopupDesc("Versement");
    setIsEditOpen(true);
    setOverlayStudentId(null);
  };

  const closeEdit = () => {
    setIsEditOpen(false);
    resetForm();
  };

  const openDetails = (stu: Student) => {
    setDetailsStudentId(stu.id);
    setOverlayStudentId(null);
  };

  /** Ouvre l'envoi WhatsApp pour un élève. Les deux numéros (élève et parent
   *  rattaché) sont toujours proposés ; `focus` détermine celui coché d'emblée,
   *  pour pouvoir prévenir les deux en une fois sans rouvrir la fenêtre. */
  const openWhatsApp = (stu: Student, focus: "student" | "parent") => {
    const parent = parents.find((p) => p.id === stu.parentId);
    const studentName = `${stu.firstName} ${stu.lastName}`;

    const recipients: WhatsAppRecipient[] = [
      { id: `student-${stu.id}`, name: studentName, phone: stu.phone, role: "student" },
    ];
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
      students: [
        {
          id: stu.id,
          name: studentName,
          balance: stu.balance,
          registrationDue: stu.registrationDue,
        },
      ],
      defaultRecipientIds: [
        focus === "parent" && parent ? `parent-${parent.id}` : `student-${stu.id}`,
      ],
    });
    setOverlayStudentId(null);
  };

  /** Alertes de solde en lot : notification dans l'application pour tous, plus
   *  un WhatsApp personnalisé par élève — au parent rattaché s'il en a un,
   *  sinon à l'élève lui-même.
   *
   *  L'envoi est découpé en lots de WA_BATCH_SIZE et les lots partent
   *  SÉQUENTIELLEMENT : la route temporise 3 à 7 s entre deux messages pour
   *  protéger le numéro de l'école du bannissement, et doit rendre la main
   *  avant la limite d'exécution de Vercel. Paralléliser annulerait le
   *  bénéfice de cette temporisation. */
  const handleSendLowBalanceAlerts = async () => {
    const selected = selectedAlertStudentIds
      .map((id) => students.find((s) => s.id === id))
      .filter((s): s is Student => Boolean(s));
    if (selected.length === 0) return;

    setSendingAlerts(true);

    const nowIso = new Date().toISOString();
    selected.forEach((stu) => {
      push("notifications", {
        id: uid("ntf"),
        parentId: stu.parentId ?? "",
        title: "Alerte de solde faible",
        description: `Rappel de paiement: Le solde de ${stu.firstName} ${stu.lastName} est de ${stu.balance} DA. Veuillez recharger rapidement. Accès aux cours refusé sans paiement.`,
        date: nowIso,
        read: false,
        auto: false,
      });
    });

    const msgLang = language === "ar" ? "ar" : "fr";
    // Même résolution destinataire + texte que l'alerte automatique du scan
    // (lib/whatsapp/alert) : le parent rattaché s'il est joignable, sinon
    // l'élève. `low: true` — ce bouton EST l'alerte « solde faible », donc un
    // solde positif encore faible part avec le texte « solde bientôt épuisé ».
    const waRecipients = selected.flatMap((stu) => {
      const parent = parents.find((p) => p.id === stu.parentId);
      const payload = buildBalanceAlert({
        student: stu,
        parent,
        school,
        lang: msgLang,
        low: true,
      });
      return payload ? [payload] : [];
    });

    if (waRecipients.length === 0) {
      setSendingAlerts(false);
      setIsAlertLowBalanceOpen(false);
      addToast({
        type: "warning",
        title: "Alertes enregistrées",
        message: `${selected.length} notification(s) créée(s) dans l'application, mais aucun numéro exploitable pour un envoi WhatsApp.`,
      });
      return;
    }

    let sent = 0;
    let failed = 0;
    let queued = 0;
    const queue = [...waRecipients];

    try {
      while (queue.length > 0) {
        const batch = queue.splice(0, WA_BATCH_SIZE);

        const response = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipients: batch }),
        });
        const payload = await response.json();

        if (!response.ok) {
          addToast({
            type: "danger",
            title: "WhatsApp indisponible",
            message: `${selected.length} notification(s) créée(s) dans l'application. ${sent} message(s) envoyé(s) avant l'interruption. Envoi WhatsApp impossible : ${payload?.error ?? "erreur inconnue"}`,
          });
          return;
        }

        const batchResult = payload as SendResponse;
        if (batchResult.results.length === 0) break; // garde-fou anti-boucle

        sent += batchResult.sent;
        failed += batchResult.failed;
        // Passerelle injoignable : ces messages attendent dans la file locale
        // et repartiront seuls. Ce n'est ni un envoi ni un échec.
        queued += batchResult.results.filter((r) => r.status === "pending").length;

        // Destinataires que la route n'a pas eu le temps de traiter avant sa
        // limite d'exécution : ils repassent en tête de file.
        if (batchResult.remaining?.length) {
          const notDone = batch.filter((r) => batchResult.remaining!.includes(r.phone));
          queue.unshift(...notDone);
        }
      }

      const notif = `${selected.length} notification(s) créée(s) dans l'application.`;
      // Une mise en file n'est PAS un problème à régler ici : ces messages
      // partiront tout seuls au retour de la passerelle. On le dit en une
      // phrase, sans diagnostic — le diagnostic, et le geste qui va avec,
      // vivent sur le tableau de bord et dans Paramètres → WhatsApp.
      addToast({
        type: failed > 0 ? "warning" : queued > 0 ? "info" : "success",
        title: queued > 0 ? "Alertes mises en attente" : "Alertes envoyées",
        message:
          queued > 0
            ? `${sent} message(s) envoyé(s), ${queued} en attente — ils partiront automatiquement. ${notif}`
            : failed > 0
              ? `${sent} message(s) WhatsApp envoyé(s), ${failed} en échec. ${notif}`
              : `${sent} message(s) WhatsApp envoyé(s) et ${notif}`,
      });
      setIsAlertLowBalanceOpen(false);
    } catch {
      addToast({
        type: "danger",
        title: "WhatsApp indisponible",
        message: `${selected.length} notification(s) créée(s) dans l'application, mais la passerelle n'a pas répondu pour l'envoi WhatsApp.`,
      });
    } finally {
      setSendingAlerts(false);
    }
  };

  const openAssign = (stu: Student) => {
    setSelectedStudent(stu);
    // Reopen on the dates already recorded, so the modal doubles as the edit
    // screen for them (an empty date falls back to today at save time).
    loadEnrollmentForm(stu);
    setIsAssignOpen(true);
    setOverlayStudentId(null);
  };

  /** Apply the "réduction groupée" to every currently ticked module at once,
   *  instead of setting each one individually. */
  const applyBulkDiscount = () => {
    if (selectedAssignIds.length === 0) {
      alert("Sélectionnez d'abord les modules concernés par la réduction.");
      return;
    }
    const next = { ...assignDiscounts };
    for (const id of selectedAssignIds) {
      if (bulkDiscountValue > 0) next[id] = { type: bulkDiscountType, value: bulkDiscountValue };
      else delete next[id];
    }
    setAssignDiscounts(next);
  };

  const clearAllDiscounts = () => {
    setAssignDiscounts({});
    setBulkDiscountValue(0);
  };

  const setItemDiscount = (id: string, patch: Partial<SubscriptionDiscount>) => {
    setAssignDiscounts((prev) => {
      const current = prev[id] ?? { type: "percent" as DiscountType, value: 0 };
      const merged = { ...current, ...patch };
      const next = { ...prev };
      if (merged.value > 0) next[id] = merged;
      else delete next[id];
      return next;
    });
  };

  const openTopup = (stu: Student) => {
    setSelectedStudent(stu);
    setTopupAmount(0);
    setTopupDesc("Dépôt solde");
    setSettleReg(false);
    setIsTopupOpen(true);
    setOverlayStudentId(null);
  };

  const openPrintPayments = (stu: Student) => {
    setSelectedStudent(stu);
    setPrintPayStart("");
    setPrintPayEnd("");
    setIsPrintPayOpen(true);
    setOverlayStudentId(null);
  };

  const handlePrintPayments = () => {
    if (!selectedStudent) return;
    printHtmlDocument(
      buildStudentPaymentsReport({
        student: selectedStudent,
        school,
        lang: language,
        startDate: printPayStart,
        endDate: printPayEnd,
        balanceTx,
        subscriptions,
        sessions,
        classes,
        modules,
        groups,
        parents,
      }),
    );
    setIsPrintPayOpen(false);
  };

  const openPayDebt = (stu: Student) => {
    // Ce que la RPC sait régler : le solde négatif et l'inscription due — la
    // fenêtre propose ce total et annonce la répartition avant d'encaisser.
    setPayDebtStudentId(stu.id);
    setOverlayStudentId(null);
  };

  /** Enrollment dates for EVERY module: the registration day (informative) and
   *  the day billing opens — a séance attended before it is recorded but never
   *  charged. Formations additionally get an expiry derived from their period.
   *
   *  An expiry is written ONLY when the formation actually declares a duration.
   *  A formation left without `periodMonths` used to get `addMonths(start, 0)`,
   *  i.e. an expiry on its own start date: the inscription was born expired and
   *  the card was refused with « abonnement expiré » from the next day on. */
  const buildEnrollmentDates = (ids: string[]) => {
    const subscriptionDates: Record<string, SubscriptionDates> = {};
    for (const subId of ids) {
      // Stages ("coursework") are not subscriptions — they carry no dates.
      if (!subscriptions.some((s) => s.id === subId)) continue;
      const startDate = assignStartDates[subId] || todayIso();
      subscriptionDates[subId] = {
        subscribedAt: assignSubDates[subId] || todayIso(),
        startDate,
        expiryDate: enrollmentExpiry(startDate, getFormationSub(subId)?.periodMonths),
      };
    }
    return subscriptionDates;
  };

  /** Only the reductions that still belong to a selected module. */
  const buildEnrollmentDiscounts = (ids: string[]) => {
    const subscriptionDiscounts: Record<string, SubscriptionDiscount> = {};
    for (const subId of ids) {
      const d = assignDiscounts[subId];
      if (d && d.value > 0) subscriptionDiscounts[subId] = d;
    }
    return subscriptionDiscounts;
  };

  const handleAssignSubmit = () => {
    if (!selectedStudent) return;

    // The registration fee is NOT charged here. Which of the two tariffs a
    // student owes — or none — is decided once, on his creation screen, so
    // adding a module afterwards must never re-charge an inscription he has
    // already been billed for (or deliberately exempted from).
    updateItem("students", selectedStudent.id, {
      subscriptionIds: selectedAssignIds,
      subscriptionDates: buildEnrollmentDates(selectedAssignIds),
      subscriptionDiscounts: buildEnrollmentDiscounts(selectedAssignIds),
    });

    setIsAssignOpen(false);
    resetForm();
  };

  const enrolledCountFor = (subId: string) =>
    students.filter((st) => st.subscriptionIds.includes(subId)).length;

  /** A séance libre may cover several classes at once, so a timing belongs to a
   *  class either through `classId` or through its `classIds` list. */
  const sessionCoversClass = (s: { classId: string; classIds?: string[] }, classId: string) =>
    s.classId === classId || !!s.classIds?.includes(classId);

  /**
   * Assignable courses + séances libres + stages.
   *  - `search` matches everything printed on the card: module, class, level,
   *    filière, teacher, group, salle, day and time.
   *  - `classIds` restricts the list to the timings of those classes — that is
   *    what the creation screen uses once niveau/année/filière are picked.
   *    Stages are then left out: they belong to no class.
   */
  const getAssignableItems = (opts: { search?: string; classIds?: string[] } = {}): AssignItem[] => {
    const search = (opts.search ?? "").trim().toLowerCase();
    const byCourse = new Map<string, AssignItem>();

    subscriptions.forEach((sub) => {
      const s = sessions.find((se) => se.id === sub.sessionId);
      if (!s) return;
      // Une séance libre dont la période est terminée ne s'attribue plus : elle
      // sort de la liste des cours proposés à l'inscription.
      if (isExpiredOpenSeance(s)) return;
      if (opts.classIds && !opts.classIds.some((cid) => sessionCoversClass(s, cid))) return;
      const cls = classes.find((c) => c.id === s.classId);
      const mod = modules.find((m) => m.id === s.moduleId);
      const t = teachers.find((te) => te.id === s.teacherId);
      const gr = groups.find((g) => g.id === s.groupId);
      const sa = salles.find((sl) => sl.id === s.salleId);
      const fil = cls?.filiereId ? filieres.find((f) => f.id === cls.filiereId)?.name ?? "" : "";
      const isFormation = cls?.type === "formation";
      const levelLabel = (cls?.type === "cours" ? cls.coursLevel : cls?.formationLevel) ?? "";
      const daysLabel = formatDays(s.days);

      const haystack = [
        mod?.name,
        cls?.name,
        levelLabel,
        fil,
        cls?.year,
        t ? `${t.firstName} ${t.lastName}` : "",
        gr?.name,
        sa?.name,
        daysLabel,
        `${s.startTime}-${s.endTime}`,
        s.title,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (search && !haystack.includes(search)) return;

      const option: AssignGroupOption = {
        id: sub.id,
        sessionId: s.id,
        groupName: gr?.name ?? "-",
        salleName: sa?.name ?? "-",
        daysLabel: daysLabel || "—",
        time: `${s.startTime}-${s.endTime}`,
        enrolled: enrolledCountFor(sub.id),
      };

      const key = courseKeyOf(s);
      const existing = byCourse.get(key);
      if (existing) {
        existing.groupOptions.push(option);
        return;
      }

      byCourse.set(key, {
        id: sub.id,
        key,
        label: `${mod?.name ?? "Module"} (${cls?.name ?? "Classe"})`,
        moduleName: mod?.name ?? "Module",
        className: cls?.name ?? "Classe",
        levelLabel,
        filiereLabel: fil,
        teacherName: t ? `${t.firstName} ${t.lastName}` : "-",
        details: `Ens: ${t?.firstName ?? ""} ${t?.lastName ?? ""} | Salle: ${sa?.name ?? "-"}`,
        price: isFormation ? sub.levelPrice ?? 0 : sub.pricePerSession,
        isCoursework: false,
        isFormation,
        isOpen: !!s.isOpen,
        periodMonths: sub.periodMonths,
        periodLabel: s.isOpen && s.periodStart ? `${formatDateFr(s.periodStart)} → ${formatDateFr(s.periodEnd)}` : "",
        groupOptions: [option],
      });
    });

    const list = [...byCourse.values()];
    list.forEach((item) => item.groupOptions.sort((a, b) => a.groupName.localeCompare(b.groupName)));
    list.sort((a, b) => a.moduleName.localeCompare(b.moduleName));

    // Stages belong to no class, so they never show up in a class-scoped list.
    if (opts.classIds) return list;

    coursework.forEach((cw) => {
      const t = teachers.find((te) => te.id === cw.teacherId);
      const haystack = `${cw.name} ${t?.firstName ?? ""} ${t?.lastName ?? ""}`.toLowerCase();
      if (search && !haystack.includes(search)) return;

      list.push({
        id: cw.id,
        key: `cw-${cw.id}`,
        label: `Stage: ${cw.name}`,
        moduleName: cw.name,
        className: "Stage intensif",
        levelLabel: "",
        filiereLabel: "",
        teacherName: t ? `${t.firstName} ${t.lastName}` : "-",
        details: `Enseignant: ${t ? `${t.firstName} ${t.lastName}` : "-"} | ${cw.dates.length} séances`,
        price: cw.total,
        isCoursework: true,
        groupOptions: [],
      });
    });

    return list;
  };

  /** Which subscription (i.e. which group) of this cours the student is on. */
  const selectedGroupOf = (item: AssignItem) => selectedGroupIn(item, selectedAssignIds);

  /** Enrolling in a cours = picking ONE of its groups. Picking another group
   *  moves the student instead of enrolling him twice in the same cours. */
  const pickGroup = (item: AssignItem, groupSubId: string, mode: StudentFormMode = "assign") => {
    // À la création, un créneau d'une autre classe / année / filière que celle
    // déjà retenue est REFUSÉ, avec l'explication : la fiche partirait sinon
    // avec deux scolarités incompatibles.
    if (mode === "create") {
      const target = classOfSubscription(groupSubId);
      const lockedKey = classScopeKeyOf(lockedScopeClass);
      if (target && lockedScopeClass && lockedKey && classScopeKeyOf(target) !== lockedKey) {
        alert(
          `Scolarité déjà fixée : « ${classFullLabel(lockedScopeClass)} ».\n\n` +
            `« ${classFullLabel(target)} » relève d'une autre classe, année ou filière.\n` +
            "Un même étudiant ne peut pas être inscrit sur deux scolarités à la création.\n\n" +
            "Retirez d'abord les inscriptions retenues (croix sur les puces « Inscriptions retenues ») " +
            "s'il faut vraiment changer de scolarité.",
        );
        return;
      }
    }
    const siblingIds = item.groupOptions.map((g) => g.id);
    const current = selectedGroupOf(item);
    const withoutCourse = selectedAssignIds.filter((id) => !siblingIds.includes(id));
    if (current === groupSubId) {
      setSelectedAssignIds(withoutCourse);
      return;
    }
    setSelectedAssignIds([...withoutCourse, groupSubId]);
    // A newly ticked module starts today by default; moving the student to
    // another group of the same cours keeps the dates already chosen. Both stay
    // editable right under the group picker.
    setAssignStartDates({
      ...assignStartDates,
      [groupSubId]:
        assignStartDates[groupSubId] ?? (current ? assignStartDates[current] : undefined) ?? todayIso(),
    });
    setAssignSubDates({
      ...assignSubDates,
      [groupSubId]:
        assignSubDates[groupSubId] ?? (current ? assignSubDates[current] : undefined) ?? todayIso(),
    });
  };

  const toggleCoursework = (item: AssignItem) => {
    if (selectedAssignIds.includes(item.id)) {
      setSelectedAssignIds(selectedAssignIds.filter((id) => id !== item.id));
    } else {
      setSelectedAssignIds([...selectedAssignIds, item.id]);
    }
  };

  /** Drops one inscription from the current selection (recap chips). */
  const unselectEnrollment = (subId: string) =>
    setSelectedAssignIds(selectedAssignIds.filter((id) => id !== subId));

  /** What the selected inscriptions cost per séance once reductions apply
   *  (formations count their level price, stages their total). */
  const selectedEnrollmentTotal = (ids: string[]) =>
    ids.reduce((sum, id) => {
      const sub = subscriptions.find((s) => s.id === id);
      if (sub) {
        const sess = sessions.find((se) => se.id === sub.sessionId);
        const cls = sess ? classes.find((c) => c.id === sess.classId) : undefined;
        const base = cls?.type === "formation" ? sub.levelPrice ?? 0 : sub.pricePerSession;
        return sum + netPriceFor(base, assignDiscounts[id]);
      }
      const cw = coursework.find((c) => c.id === id);
      return sum + netPriceFor(cw?.total ?? 0, assignDiscounts[id]);
    }, 0);

  // ---- Frais d'inscription pris à la création ------------------------------
  // The school offers up to two tariffs (Abonnements → « Frais d'inscription
  // uniques »). Reception picks the one this student pays — a student on
  // "études gratuites" never pays any — and says whether he settles it now.
  const createFeeOptions = registrationFeeOptions(school);

  /** The class one créneau belongs to (a séance libre can cover several: the
   *  first one it names is the one that identifies its schooling). */
  const classOfSubscription = (subId: string): SchoolClass | undefined => {
    const sub = subscriptions.find((su) => su.id === subId);
    const sess = sub ? sessions.find((se) => se.id === sub.sessionId) : undefined;
    if (!sess) return undefined;
    const ids = sess.classIds?.length ? sess.classIds : [sess.classId];
    return classes.find((c) => ids.includes(c.id));
  };

  const isThirdYearSecondaryClass = (cls?: SchoolClass) =>
    cls?.type === "cours" && cls.coursLevel === "lycee" && cls.year === "3eme";

  // ---- Verrou de scolarité (écran de création) ------------------------------
  // Un élève relève d'UNE scolarité : la PREMIÈRE inscription retenue fixe la
  // classe, l'année ET la filière, et toutes les suivantes doivent en relever.
  // Sans ce garde-fou une même fiche pouvait cumuler des créneaux de niveaux
  // différents — impossible à tarifer, à pointer et à facturer proprement.
  const classScopeKeyOf = (cls?: SchoolClass) =>
    !cls
      ? ""
      : cls.type === "formation"
        ? `f:${cls.formationLevel ?? ""}`
        : `c:${cls.coursLevel ?? ""}:${cls.year ?? ""}:${cls.filiereId ?? ""}`;

  /** La scolarité déjà fixée par les inscriptions retenues, s'il y en a une.
   *  Un stage ne porte aucune classe : il n'en fixe pas et n'y est pas soumis. */
  const lockedScopeClass: SchoolClass | undefined = (() => {
    for (const id of selectedAssignIds) {
      const cls = classOfSubscription(id);
      if (cls) return cls;
    }
    return undefined;
  })();

  /** L'étudiant est en 3e année secondaire — soit parce que la cascade de
   *  l'écran pointe dessus, soit parce qu'un créneau déjà sélectionné en vient. */
  const isThirdYearSecondary =
    (createLevel === "lycee" && createYear === "3eme") ||
    selectedAssignIds.some((id) => isThirdYearSecondaryClass(classOfSubscription(id)));

  const hasFirstFee = createFeeOptions.some((o) => o.key === "fee1");

  // Règle de l'école : une 3e année secondaire relève du frais d'inscription
  // de TYPE 1. Ce n'est qu'une PRÉ-sélection : dès que la réception choisit un
  // tarif elle-même (`createFeeTouched`), son choix l'emporte et plus rien ne
  // le change — ni un ajout de créneau, ni un changement de scolarité.
  const autoFeeKey: RegistrationFeeKey | undefined =
    isThirdYearSecondary && hasFirstFee ? "fee1" : undefined;
  const effectiveCreateFeeKey = createFeeTouched ? createFeeKey : autoFeeKey;

  /** The picked tariff, or undefined: « aucun frais », none offered, or free. */
  const createFeeOption = isFree
    ? undefined
    : effectiveCreateFeeKey === undefined
      ? createFeeOptions[0]
      : createFeeOptions.find((o) => o.key === effectiveCreateFeeKey);
  const createRegistrationFee = createFeeOption?.amount ?? 0;
  /** Settling only makes sense against a real fee. */
  const settleRegistrationOnCreate = createFeePayNow && createRegistrationFee > 0;

  // Same three questions on the edit screen, read against what the student
  // already owes: which tariff applies now, and is it cashed on this save.
  /** What is still due on the open student's file. */
  const editCurrentDue = selectedStudent?.registrationDue ?? 0;
  const editFeeOption =
    isFree || editFeeKey === null || editFeeKey === "current"
      ? undefined
      : createFeeOptions.find((o) => o.key === editFeeKey);
  /** Amount the student will owe once the form is saved. */
  const editRegistrationFee = isFree
    ? 0
    : editFeeKey === "current"
      ? editCurrentDue
      : editFeeOption?.amount ?? 0;
  const editFeeLabel = editFeeOption?.label ?? "Frais d'inscription";
  const settleRegistrationOnEdit = editFeePayNow && editRegistrationFee > 0;

  // ---- Creation screen: niveau → année → filière, then the créneaux ---------
  // Reception picks the student's schooling the way it is spoken about: the
  // level first (primaire / moyen / lycée), then the year of that level, then
  // the filière. Every timing created on that combination is then listed. The
  // search box above short-circuits the three steps: "lycée 2eme sciences"
  // jumps straight to the same list.

  /** Name of one filière, "Sans filière" for classes that carry none. */
  const filiereLabelOf = (filiereId?: string) =>
    filiereId ? filieres.find((f) => f.id === filiereId)?.name ?? "Filière inconnue" : "Sans filière";

  /** "Lycée · 2eme Année · Sciences" — what the direct search matches on. */
  const classFullLabel = (cls: SchoolClass) =>
    classCascadeLabel(cls, cls.filiereId ? filiereLabelOf(cls.filiereId) : "");

  /** How many priced créneaux one class actually offers. A class with none
   *  cannot be enrolled on, so every step advertises the count it leads to. */
  const timingCountOf = (classId: string) =>
    subscriptions.filter((sub) => {
      const s = sessions.find((se) => se.id === sub.sessionId);
      return !!s && sessionCoversClass(s, classId);
    }).length;

  const timingCountFor = (list: SchoolClass[]) =>
    list.reduce((sum, cls) => sum + timingCountOf(cls.id), 0);

  /** Classes of the level currently picked (formations are their own branch). */
  const createLevelClasses = () =>
    createLevel === "formation"
      ? classes.filter((c) => c.type === "formation")
      : classes.filter((c) => c.type === "cours" && c.coursLevel === createLevel);

  /** Step 1 options — only the levels the school actually has classes for. */
  const createLevelOptions = () => {
    const options = COURS_LEVELS.map((level) => ({
      value: level as "" | CoursLevel | "formation",
      label: COURS_LEVEL_LABELS[level],
      classes: classes.filter((c) => c.type === "cours" && c.coursLevel === level),
    }));
    const formations = classes.filter((c) => c.type === "formation");
    if (formations.length > 0) {
      options.push({ value: "formation", label: "Formations", classes: formations });
    }
    return options
      .filter((o) => o.classes.length > 0)
      .map((o) => ({ value: o.value, label: o.label, count: timingCountFor(o.classes) }));
  };

  /** Groups the classes of the picked level by their second axis: the année —
   *  or, on the formations branch, their level (A1, B2…), which `createYear`
   *  holds all the same. */
  const createYearOptions = () => {
    const byKey = new Map<string, SchoolClass[]>();
    for (const cls of createLevelClasses()) {
      const key = (createLevel === "formation" ? cls.formationLevel : cls.year) ?? "";
      if (!key) continue;
      byKey.set(key, [...(byKey.get(key) ?? []), cls]);
    }
    return [...byKey.entries()]
      .map(([value, list]) => ({
        value,
        label: createLevel === "formation" ? `Niveau ${value}` : `${value} Année`,
        count: timingCountFor(list),
      }))
      .sort((a, b) => {
        const ia = YEAR_ORDER.indexOf(a.value);
        const ib = YEAR_ORDER.indexOf(b.value);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        return a.value.localeCompare(b.value);
      });
  };

  /** Step 3 options: the filières taught on the picked level + année. */
  const createFiliereOptions = () => {
    const byKey = new Map<string, SchoolClass[]>();
    for (const cls of createLevelClasses()) {
      if ((cls.year ?? "") !== createYear) continue;
      const key = cls.filiereId || "none";
      byKey.set(key, [...(byKey.get(key) ?? []), cls]);
    }
    return [...byKey.entries()]
      .map(([value, list]) => ({
        value,
        label: value === "none" ? "Sans filière" : filiereLabelOf(value),
        count: timingCountFor(list),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  };

  /**
   * The classes whose créneaux the creation screen must list: the ones matching
   * the direct search when it carries text, otherwise the ones matching the
   * niveau → année → filière cascade. Several classes can share a combination,
   * so this always returns a list.
   */
  const createMatchedClasses = (): SchoolClass[] => {
    const query = createClassSearch.trim();
    if (query) {
      // Every word must match, in any order: "2eme lycee sciences" works too.
      return classes.filter((cls) =>
        matchesAllWords(`${classFullLabel(cls)} ${cls.name} ${cls.description ?? ""}`, query),
      );
    }
    if (!createLevel || !createYear) return [];
    if (createLevel === "formation") {
      return createLevelClasses().filter((c) => (c.formationLevel ?? "") === createYear);
    }
    if (!createFiliereId) return [];
    return createLevelClasses().filter(
      (c) =>
        (c.year ?? "") === createYear &&
        (createFiliereId === "none" ? !c.filiereId : c.filiereId === createFiliereId),
    );
  };

  /** Going back up the cascade clears every step below it. */
  const pickCreateLevel = (level: "" | CoursLevel | "formation") => {
    setCreateLevel(level);
    setCreateYear("");
    setCreateFiliereId("");
  };
  const pickCreateYear = (year: string) => {
    setCreateYear(year);
    setCreateFiliereId("");
  };

  // ---- Blocs partagés « Ajouter » / « Modifier » ----------------------------
  // Both screens render the very same three blocks — frais d'inscription,
  // versement, inscriptions — so a student's file is edited exactly the way it
  // was created. Only the wording changes ("à la création" / "maintenant") and,
  // on the edit screen, the amounts are read against what the student already
  // owes and already has on his balance.

  /** 1. Frais d'inscription : quel tarif, encaissé tout de suite ou laissé dû. */
  /**
   * Le dossier COMPLET d'un homonyme, affiché dans l'écran de création.
   *
   * Il répond à la seule question qui compte à cet instant : « est-ce que
   * c'est le même élève ? » — et pour ça il faut voir son emploi du temps, son
   * argent et sa présence, pas seulement son nom. Tout est en lecture seule :
   * on ne modifie jamais un dossier existant depuis l'écran de création d'un
   * autre.
   */
  const renderDuplicateDossier = (stu: Student) => {
    const debt = debtOf(stu);
    const parent = parents.find((pa) => pa.id === stu.parentId);
    const myTx = balanceTx
      .filter((t) => t.studentId === stu.id)
      .sort((a, b) => b.date.localeCompare(a.date));
    const myAtt = attendance
      .filter((a) => a.studentId === stu.id)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const myPenalties = absencePenalties
      .filter((x) => x.studentId === stu.id)
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
    const presents = myAtt.filter((a) => a.status !== "absent").length;
    const absents = myAtt.filter((a) => a.status === "absent").length;
    const totalPaid = myTx.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const totalSpent = myTx.filter((t) => t.amount < 0).reduce((sum, t) => sum + -t.amount, 0);

    /** Ses créneaux, tirés de ses inscriptions — ce que « son emploi du temps »
     *  veut dire concrètement : quels jours, à quelle heure, avec qui. */
    const myTimings = stu.subscriptionIds
      .map((subId) => {
        const sub = subscriptions.find((x) => x.id === subId);
        const sess = sub ? sessions.find((se) => se.id === sub.sessionId) : undefined;
        if (!sess) return null;
        const dates = stu.subscriptionDates?.[subId];
        const discount = stu.subscriptionDiscounts?.[subId];
        return {
          subId,
          sess,
          price: netPriceFor(sub?.pricePerSession ?? 0, discount),
          basePrice: sub?.pricePerSession ?? 0,
          dates,
          moduleName: modules.find((m) => m.id === sess.moduleId)?.name ?? "Module",
          className: classes.find((c) => c.id === sess.classId)?.name ?? "—",
          groupName: groups.find((g) => g.id === sess.groupId)?.name ?? "—",
          salleName: salles.find((sa) => sa.id === sess.salleId)?.name ?? "—",
          teacherName: (() => {
            const t = teachers.find((x) => x.id === sess.teacherId);
            return t ? `${t.firstName} ${t.lastName}` : "—";
          })(),
        };
      })
      .filter(Boolean) as Array<{
      subId: string;
      sess: (typeof sessions)[number];
      price: number;
      basePrice: number;
      dates?: SubscriptionDates;
      moduleName: string;
      className: string;
      groupName: string;
      salleName: string;
      teacherName: string;
    }>;

    return (
      <div className="space-y-3 rounded-xl border border-warning/40 bg-surface p-3">
        {/* ---- Identité ---- */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
          <div className="min-w-0">
            <strong className="block text-sm text-ink">
              {stu.firstName} {stu.lastName}
            </strong>
            <span className="mt-0.5 block text-[10px] text-muted">
              Carte : <span className="font-mono text-ink">{stu.rfid || "aucune"}</span> · Né(e) le{" "}
              {stu.birthDate ? formatDateFr(stu.birthDate) : "—"} · Tél{" "}
              <span className="font-mono">{stu.phone || "—"}</span>
            </span>
            <span className="mt-0.5 block text-[10px] text-muted">
              {stu.email || "sans email"}
              {parent && ` · Parent : ${parent.firstName} ${parent.lastName}`}
              {stu.createdAt && ` · Inscrit le ${formatDateFr(stu.createdAt.slice(0, 10))}`}
            </span>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {stu.isFree && <Badge tone="success" className="text-[9px] font-bold">Études gratuites</Badge>}
            <Badge tone={stu.balance < 0 ? "danger" : "primary"} className="font-mono text-[10px] font-bold">
              Solde {stu.balance} DA
            </Badge>
            {debt.alert && (
              <Badge tone="danger" className="font-mono text-[10px] font-bold">
                Dette {debt.total} DA
              </Badge>
            )}
          </div>
        </div>

        {/* ---- Les chiffres du dossier ---- */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Inscriptions", value: `${myTimings.length}`, tone: "text-ink" },
            { label: "Présences", value: `${presents}`, tone: "text-success" },
            { label: "Absences", value: `${absents + myPenalties.length}`, tone: "text-danger" },
            { label: "Total versé", value: `${totalPaid} DA`, tone: "text-primary" },
          ].map((k) => (
            <div key={k.label} className="rounded-lg border border-line bg-canvas/40 p-2 text-center">
              <span className="block text-[9px] uppercase text-muted">{k.label}</span>
              <strong className={`font-mono text-sm ${k.tone}`}>{k.value}</strong>
            </div>
          ))}
        </div>

        {debt.alert && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-2 text-[10px] leading-relaxed text-danger">
            <strong>Cet élève doit {debt.total} DA.</strong>{" "}
            {debt.sessions > 0 && `Séances suivies non payées : ${debt.sessions} DA. `}
            {debt.registration > 0 && `Frais d'inscription impayés : ${debt.registration} DA. `}
            Si c&apos;est bien la même personne, réglez sa dette depuis sa fiche au lieu de
            créer un second dossier.
          </div>
        )}

        {/* ---- Emploi du temps ---- */}
        <div>
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted">
            📅 Emploi du temps ({myTimings.length})
          </span>
          {myTimings.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line py-3 text-center text-[10px] italic text-muted">
              Aucune inscription — cet élève n&apos;a pas d&apos;emploi du temps.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {myTimings.map((t) => (
                <div key={t.subId} className="rounded-lg border border-line bg-canvas/30 p-2 text-[10px]">
                  <strong className="block truncate text-ink">
                    {t.sess.isOpen && "🎯 "}
                    {t.sess.title || t.moduleName}
                  </strong>
                  <span className="block truncate text-muted">
                    {t.className} · Gr: {t.groupName} · {t.salleName}
                  </span>
                  <span className="block truncate text-muted">
                    {t.teacherName} ·{" "}
                    <span className="font-mono">
                      {t.sess.startTime}-{t.sess.endTime}
                    </span>
                  </span>
                  <span className="block truncate text-muted">{formatDays(t.sess.days) || "—"}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    <Badge tone="primary" className="font-mono text-[9px] font-bold">
                      {t.price} DA / séance
                    </Badge>
                    {t.price !== t.basePrice && (
                      <Badge tone="success" className="text-[9px] font-bold">
                        remise
                      </Badge>
                    )}
                    {t.dates?.startDate && (
                      <Badge tone="neutral" className="text-[9px]">
                        dès {formatDateFr(t.dates.startDate)}
                      </Badge>
                    )}
                    {t.dates?.expiryDate && (
                      <Badge tone="warning" className="text-[9px]">
                        exp. {formatDateFr(t.dates.expiryDate)}
                      </Badge>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ---- Présences & absences ---- */}
        <div>
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted">
            ✅ Présences &amp; absences ({myAtt.length + myPenalties.length})
          </span>
          {myAtt.length === 0 && myPenalties.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line py-3 text-center text-[10px] italic text-muted">
              Aucune présence enregistrée.
            </p>
          ) : (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-line">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-canvas">
                  <tr className="text-left uppercase text-muted">
                    <th className="p-1.5">Date</th>
                    <th className="p-1.5">Séance</th>
                    <th className="p-1.5">Statut</th>
                    <th className="p-1.5 text-right">Débité</th>
                  </tr>
                </thead>
                <tbody>
                  {myAtt.slice(0, 40).map((a) => {
                    const sess = sessions.find((se) => se.id === a.sessionId);
                    const free = freeReasonOf(a, {
                      studentIsFree: stu.isFree,
                      sessionIsFree: !!sess?.isFree,
                    });
                    return (
                      <tr key={a.id} className="border-t border-line/50">
                        <td className="p-1.5 font-mono">
                          {new Date(a.timestamp).toLocaleDateString("fr-FR")}
                        </td>
                        <td className="max-w-[10rem] truncate p-1.5 text-ink">
                          {sess?.title || modules.find((m) => m.id === sess?.moduleId)?.name || "Séance"}
                        </td>
                        <td className="p-1.5">
                          <Badge
                            tone={
                              a.status === "absent" ? "danger" : a.status === "late" ? "warning" : "success"
                            }
                            className="text-[9px]"
                          >
                            {a.status === "absent" ? "Absent" : a.status === "late" ? "Retard" : "Présent"}
                          </Badge>
                        </td>
                        <td className="p-1.5 text-right font-mono">
                          {a.amountDeducted > 0 ? (
                            `${a.amountDeducted} DA`
                          ) : (
                            <span className="text-success" title={free ? FREE_REASON_HINTS[free] : undefined}>
                              🎁 {free ? FREE_REASON_LABELS[free] : "0 DA"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {myPenalties.slice(0, 15).map((pen) => (
                    <tr key={pen.id} className="border-t border-line/50 bg-danger/5">
                      <td className="p-1.5 font-mono">{formatDateFr(pen.periodEnd)}</td>
                      <td className="max-w-[10rem] truncate p-1.5 text-ink">
                        Absence semaine · {modules.find((m) => m.id === pen.moduleId)?.name ?? "module"}
                      </td>
                      <td className="p-1.5">
                        <Badge tone="danger" className="text-[9px]">Absence facturée</Badge>
                      </td>
                      <td className="p-1.5 text-right font-mono text-danger">{pen.amount} DA</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ---- Paiements & dettes ---- */}
        <div>
          <span className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-muted">
            <span>💵 Paiements &amp; transactions ({myTx.length})</span>
            <span className="font-mono normal-case">
              <span className="text-success">+{totalPaid} DA</span> ·{" "}
              <span className="text-danger">-{totalSpent} DA</span>
            </span>
          </span>
          {myTx.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line py-3 text-center text-[10px] italic text-muted">
              Aucune transaction.
            </p>
          ) : (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-line">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-canvas">
                  <tr className="text-left uppercase text-muted">
                    <th className="p-1.5">Date</th>
                    <th className="p-1.5">Type</th>
                    <th className="p-1.5">Libellé</th>
                    <th className="p-1.5 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {myTx.slice(0, 40).map((t) => (
                    <tr key={t.id} className="border-t border-line/50">
                      <td className="p-1.5 font-mono">
                        {new Date(t.date).toLocaleDateString("fr-FR")}
                      </td>
                      <td className="p-1.5 text-muted">{TX_TYPE_LABELS[t.type]}</td>
                      <td className="max-w-[12rem] truncate p-1.5 text-ink">{t.description}</td>
                      <td
                        className={`p-1.5 text-right font-mono font-bold ${
                          t.amount > 0 ? "text-success" : "text-danger"
                        }`}
                      >
                        {t.amount > 0 ? "+" : ""}
                        {t.amount} DA
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  };

  /**
   * L'alerte d'homonymie de l'écran de création.
   *
   * Elle n'EMPÊCHE rien : deux élèves peuvent porter le même nom, et le
   * bouton « Créer » reste actif. Elle rend simplement impossible de créer un
   * doublon SANS L'AVOIR VU.
   */
  const renderDuplicateAlert = () => {
    if (nameDuplicates.length === 0) return null;
    return (
      <div className="mt-4 space-y-3 rounded-xl border-2 border-warning/50 bg-warning/10 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 animate-pulse text-warning" />
          <div className="min-w-0">
            <strong className="block text-xs text-warning">
              {nameDuplicates.length === 1
                ? "Un élève porte déjà exactement ce nom"
                : `${nameDuplicates.length} élèves portent déjà exactement ce nom`}
            </strong>
            <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">
              Cliquez sur une fiche pour voir son dossier complet — emploi du temps, présences,
              paiements et dettes — sans quitter cet écran. Si ce n&apos;est pas la même
              personne, continuez : <strong className="text-ink">rien n&apos;est bloqué</strong>.
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {nameDuplicates.map((st) => {
            const open = duplicateOpenId === st.id;
            const d = debtOf(st);
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => setDuplicateOpenId(open ? null : st.id)}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition-colors ${
                  open
                    ? "border-primary bg-primary text-white"
                    : "border-warning/40 bg-surface text-ink hover:bg-warning/20"
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                <span>
                  {st.firstName} {st.lastName}
                </span>
                <span className={`font-mono ${open ? "text-white/80" : "text-muted"}`}>
                  {st.rfid || "sans carte"}
                </span>
                {d.alert && (
                  <span className={open ? "text-white" : "text-danger"}>· {d.total} DA dus</span>
                )}
              </button>
            );
          })}
        </div>

        {openDuplicate && renderDuplicateDossier(openDuplicate)}
      </div>
    );
  };

  const renderFeeSection = (mode: "create" | "edit") => {
    const editing = mode === "edit";
    const option = editing ? editFeeOption : createFeeOption;
    const fee = editing ? editRegistrationFee : createRegistrationFee;
    const payNow = editing ? editFeePayNow : createFeePayNow;
    const setPayNow = editing ? setEditFeePayNow : setCreateFeePayNow;
    const settles = editing ? settleRegistrationOnEdit : settleRegistrationOnCreate;
    const pickKey = (key: RegistrationFeeKey | null) => {
      if (editing) {
        setEditFeeKey(key);
        return;
      }
      // Choix explicite : il fait foi jusqu'à la fin de la création.
      setCreateFeeTouched(true);
      setCreateFeeKey(key);
    };
    const isActiveKey = (key: RegistrationFeeKey) =>
      editing ? editFeeKey === key : createFeeOption?.key === key;
    const noneActive = editing ? editFeeKey === null : !isFree && !createFeeOption;
    // A due amount matching none of the school's tariffs (an older file, or a
    // tariff changed since) stays offered as-is: saving must never re-price an
    // inscription the desk did not touch.
    const keepsCurrent =
      editing && editCurrentDue > 0 && !createFeeOptions.some((o) => o.amount === editCurrentDue);
    const feeLabel = option?.label ?? (editing && editFeeKey === "current" ? "Montant actuel" : "");

    return (
      <div className="mt-5 rounded-xl border border-warning/30 bg-warning/5 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-warning">
            <CreditCard className="h-3.5 w-3.5" /> Frais d&apos;inscription
          </span>
          <span className="text-[10px] text-muted">
            {editing ? `Actuellement dû : ${editCurrentDue} DA` : "Une seule fois par étudiant"}
          </span>
        </div>

        {/* La règle de l'école appliquée d'elle-même : elle doit se VOIR, et
            rester un simple point de départ que la réception peut changer. */}
        {!editing && !isFree && autoFeeKey && !createFeeTouched && createFeeOption && (
          <p className="rounded-lg border border-primary/30 bg-primary-50/60 px-3 py-2 text-[11px] text-ink">
            <strong>3e année secondaire</strong> : «&nbsp;{createFeeOption.label}&nbsp;» (
            {createFeeOption.amount} DA) est pré-sélectionné automatiquement. Choisissez un autre tarif
            ci-dessous si ce n&apos;est pas celui-ci.
          </p>
        )}

        {isFree ? (
          <p className="rounded-lg border border-line bg-surface px-3 py-2 text-[11px] text-muted">
            Études gratuites : <strong className="text-ink">aucun frais d&apos;inscription</strong> n&apos;est
            facturé à cet étudiant.
          </p>
        ) : createFeeOptions.length === 0 && !keepsCurrent ? (
          <p className="rounded-lg border border-line bg-surface px-3 py-2 text-[11px] text-muted">
            Aucun tarif d&apos;inscription n&apos;est défini. Renseignez-le dans{" "}
            <strong className="text-ink">Abonnements → Frais d&apos;inscription uniques</strong> pour pouvoir
            le facturer ici.
          </p>
        ) : (
          <>
            <div>
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Type d&apos;inscription facturé
              </span>
              <div className="flex flex-wrap gap-1.5">
                {keepsCurrent && (
                  <button
                    onClick={() => setEditFeeKey("current")}
                    className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                      editFeeKey === "current"
                        ? "border-warning bg-warning text-white"
                        : "border-line bg-surface text-ink hover:bg-warning/10"
                    }`}
                  >
                    Montant actuel
                    <span className={editFeeKey === "current" ? "ms-1.5 text-white/80" : "ms-1.5 text-muted"}>
                      {editCurrentDue} DA
                    </span>
                  </button>
                )}
                {createFeeOptions.map((opt) => {
                  const active = isActiveKey(opt.key);
                  return (
                    <button
                      key={opt.key}
                      onClick={() => pickKey(opt.key)}
                      className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                        active
                          ? "border-warning bg-warning text-white"
                          : "border-line bg-surface text-ink hover:bg-warning/10"
                      }`}
                    >
                      {opt.label}
                      <span className={active ? "ms-1.5 text-white/80" : "ms-1.5 text-muted"}>
                        {opt.amount} DA
                      </span>
                    </button>
                  );
                })}
                <button
                  onClick={() => pickKey(null)}
                  className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                    noneActive
                      ? "border-warning bg-warning text-white"
                      : "border-line bg-surface text-ink hover:bg-warning/10"
                  }`}
                >
                  Aucun frais
                </button>
              </div>
            </div>

            {fee > 0 && (
              <div>
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                  {editing ? "Réglé maintenant ?" : "Réglé à la création de l'étudiant ?"}
                </span>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  <button
                    onClick={() => setPayNow(true)}
                    className={`rounded-lg border p-2 text-start text-[11px] transition-colors ${
                      payNow
                        ? "border-success bg-success text-white"
                        : "border-line bg-surface text-ink hover:bg-success/10"
                    }`}
                  >
                    <strong className="block">Oui, payé maintenant</strong>
                    <span className={payNow ? "text-white/80" : "text-muted"}>
                      {initialTopup > 0
                        ? `Déduit du ${editing ? "" : "premier "}versement ci-dessous.`
                        : "Encaissé seul en caisse, solde inchangé."}
                    </span>
                  </button>
                  <button
                    onClick={() => setPayNow(false)}
                    className={`rounded-lg border p-2 text-start text-[11px] transition-colors ${
                      !payNow
                        ? "border-danger bg-danger text-white"
                        : "border-line bg-surface text-ink hover:bg-danger/10"
                    }`}
                  >
                    <strong className="block">Non, à régler plus tard</strong>
                    <span className={!payNow ? "text-white/80" : "text-muted"}>
                      Reste dû sur sa fiche, réglable depuis «&nbsp;Recharge&nbsp;».
                    </span>
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-lg border border-line bg-surface p-2.5 text-xs">
              {fee === 0 ? (
                <span className="text-muted">
                  {editing && editCurrentDue > 0
                    ? `Les ${editCurrentDue} DA encore dus seront effacés de sa fiche.`
                    : "Aucun frais d'inscription ne sera facturé à cet étudiant."}
                </span>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-muted">
                    {feeLabel} —{" "}
                    {payNow
                      ? editing
                        ? "encaissé à l'enregistrement"
                        : "encaissé à la création"
                      : "laissé en dette"}
                  </span>
                  <strong className={payNow ? "text-success" : "text-danger"}>{fee} DA</strong>
                </div>
              )}
              {settles && initialTopup > 0 && initialTopup < fee && (
                <p className="mt-1.5 text-[10px] font-semibold text-danger">
                  Le {editing ? "" : "premier "}versement ({Math.round(initialTopup)} DA) ne couvre pas ces
                  frais : le solde de l&apos;étudiant {editing ? "descendra d'autant" : "partira en négatif"}.
                </p>
              )}
            </div>

            {/* ALARME : les frais d'inscription ne sont PAS réglés. Elle reste
                affichée tant que la réception n'a pas coché « payé », pour
                qu'aucune fiche ne parte du guichet avec une inscription
                impayée sans que ce soit vu. */}
            {fee > 0 && !payNow && (
              <div className="flex items-start gap-2.5 rounded-xl border-2 border-danger bg-danger/10 p-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 animate-pulse text-danger" />
                <div className="text-[11px] leading-relaxed">
                  <strong className="block text-xs text-danger">
                    ⚠️ Frais d&apos;inscription NON PAYÉS — {fee} DA
                  </strong>
                  <span className="text-muted">
                    {feeLabel} reste{feeLabel.endsWith("s") ? "nt" : ""} dû à l&apos;école.
                    L&apos;étudiant sera signalé <strong className="text-danger">« inscription impayée »</strong>{" "}
                    sur sa fiche et dans la liste, jusqu&apos;à son règlement depuis
                    «&nbsp;Recharge&nbsp;». Cochez «&nbsp;Oui, payé maintenant&nbsp;» s&apos;il règle au
                    guichet.
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  /** 2. Versement encaissé depuis l'écran — même RPC que « Recharge ». */
  const renderTopupSection = (mode: "create" | "edit") => {
    const editing = mode === "edit";
    const fee = editing ? editRegistrationFee : createRegistrationFee;
    const feeLabel = editing ? editFeeLabel : createFeeOption?.label ?? "";
    const settles = editing ? settleRegistrationOnEdit : settleRegistrationOnCreate;
    const currentBalance = editing ? selectedStudent?.balance ?? 0 : 0;
    const topup = Math.round(initialTopup || 0);
    // Exactly what the save will move — same helper as the two save handlers,
    // so the preview can never drift from what is actually written.
    const nextBalance = currentBalance + deskPaymentFor(topup, fee, settles).balanceDelta;

    return (
      <div className="mt-5 rounded-xl border border-success/30 bg-success/5 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-success">
            <DollarSign className="h-3.5 w-3.5" />{" "}
            {editing ? "Nouveau versement (recharge du solde)" : "Premier versement (recharge du solde)"}
          </span>
          <span className="text-[10px] text-muted">
            {editing ? `Solde actuel : ${currentBalance} DA` : "Facultatif"}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Montant à verser (DA)</label>
            <Input
              type="number"
              min={0}
              value={initialTopup || ""}
              onChange={(e) => setInitialTopup(Number(e.target.value))}
              placeholder="Ex: 5000"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Description</label>
            <Input
              value={initialTopupDesc}
              onChange={(e) => setInitialTopupDesc(e.target.value)}
              placeholder={editing ? "Versement" : "Premier versement"}
            />
          </div>
        </div>
        {/* The fee settled here is taken out of this very payment, so the
            resulting balance is what is left once it is deducted. */}
        {(initialTopup > 0 || settles) && (
          <div className="flex items-center justify-between rounded-lg border border-line bg-surface p-2.5 text-xs">
            <div>
              <span className="text-muted font-semibold block">
                {editing ? "Solde après enregistrement" : "Solde de départ de l'étudiant"}
              </span>
              {settles && (
                <span className="text-[10px] text-muted">
                  {topup > 0
                    ? `Après déduction de ${fee} DA (${feeLabel}).`
                    : `${feeLabel} encaissés seuls (${fee} DA) : le solde ne bouge pas.`}
                </span>
              )}
            </div>
            <strong className={`text-sm ${nextBalance < 0 ? "text-danger" : "text-success"}`}>
              {nextBalance} DA
            </strong>
          </div>
        )}
        <p className="text-[10px] leading-relaxed text-muted">
          Le versement est enregistré comme une transaction «&nbsp;Versement / Recharge&nbsp;» dans
          l&apos;<strong className="text-ink">historique de l&apos;étudiant</strong> et dans la caisse, exactement
          comme une recharge faite depuis sa fiche. Laissez à 0 pour {editing ? "n'encaisser aucun versement" : "créer l'étudiant sans versement"}.
        </p>
      </div>
    );
  };

  /** 3. Inscriptions : niveau → année → filière, puis les créneaux de cette
   *  combinaison. Partagé par « Ajouter », « Modifier » et « Inscriptions »,
   *  pour que l'élève soit inscrit partout de la même façon. */
  const renderEnrollmentPicker = (mode: StudentFormMode) => {
    const matched = createMatchedClasses();
    const searching = !!createClassSearch.trim();
    const matchedItems =
      matched.length > 0 ? getAssignableItems({ classIds: matched.map((c) => c.id), search: "" }) : [];
    // Stages belong to no class, so the cascade never reaches them: they get
    // their own list, filtered by whatever is typed in the search box.
    const stageItems =
      coursework.length > 0
        ? getAssignableItems({ search: createClassSearch.trim() }).filter((i) => i.isCoursework)
        : [];

    // Everything already retained that neither list shows (another niveau, a
    // stage, an inscription taken earlier) stays visible and editable below,
    // instead of surviving only as a chip.
    const shownIds = new Set<string>();
    [...matchedItems, ...stageItems].forEach((i) => {
      shownIds.add(i.id);
      i.groupOptions.forEach((g) => shownIds.add(g.id));
    });
    const hiddenIds = selectedAssignIds.filter((id) => !shownIds.has(id));
    const hiddenItems =
      hiddenIds.length > 0
        ? getAssignableItems({ search: "" }).filter(
            (i) => hiddenIds.includes(i.id) || i.groupOptions.some((g) => hiddenIds.includes(g.id)),
          )
        : [];

    /** Le mode voyage avec le clic : seul l'écran de création verrouille la
     *  scolarité, les écrans « Modifier » et « Affecter » servent aussi à la
     *  corriger. */
    const onPickGroupInMode = (item: AssignItem, groupSubId: string) => pickGroup(item, groupSubId, mode);

    const fee = mode === "create" ? createRegistrationFee : mode === "edit" ? editRegistrationFee : 0;
    const feeLabel = mode === "create" ? createFeeOption?.label ?? "" : editFeeLabel;
    const feePayNow = mode === "create" ? createFeePayNow : editFeePayNow;

    return (
      <div className="mt-4 rounded-xl border border-primary/25 bg-primary-50/40 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
            <BookOpen className="h-3.5 w-3.5" /> Inscriptions ({selectedAssignIds.length} sélectionnée(s))
          </span>
          <span className="text-[10px] text-muted">{mode === "assign" ? "Modifiable à tout moment" : "Facultatif"}</span>
        </div>

        {/* La scolarité retenue, affichée dès la première inscription : c'est
            elle qui décide de ce qui peut encore être coché. */}
        {mode === "create" && lockedScopeClass && (
          <p className="rounded-lg border border-primary/30 bg-primary-50/60 px-3 py-2 text-[11px] text-ink">
            <strong>Scolarité de l&apos;étudiant : {classFullLabel(lockedScopeClass)}.</strong> Les créneaux
            d&apos;une autre classe, année ou filière seront refusés — retirez les inscriptions retenues
            ci-dessous pour en changer.
          </p>
        )}

        {/* Direct search: "lycee 2eme sciences" lands on the same créneaux
            as walking the three steps below, in any word order. */}
        <div>
          <label className="block text-[10px] font-semibold text-muted mb-1">
            Recherche directe : niveau + année + filière (ou nom d&apos;un stage)
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
            <Input
              value={createClassSearch}
              onChange={(e) => setCreateClassSearch(e.target.value)}
              placeholder="Ex: lycee 2eme sciences"
              className="pl-9 pr-20"
            />
            {createClassSearch && (
              <button
                onClick={() => setCreateClassSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-primary hover:underline"
              >
                Effacer
              </button>
            )}
          </div>
        </div>

        {/* Steps 1→3, hidden while the search box drives the list itself. */}
        {!searching && (
          <div className="space-y-2.5">
            <div>
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                1. Niveau scolaire
              </span>
              <div className="flex flex-wrap gap-1.5">
                {createLevelOptions().length === 0 ? (
                  <p className="text-xs italic text-muted">Aucune classe enregistrée dans l&apos;école.</p>
                ) : (
                  createLevelOptions().map((opt) => {
                    const active = createLevel === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => pickCreateLevel(active ? "" : opt.value)}
                        className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                          active
                            ? "border-primary bg-primary text-white"
                            : "border-line bg-surface text-ink hover:bg-primary-50"
                        }`}
                      >
                        {opt.label}
                        <span className={active ? "ms-1.5 text-white/75" : "ms-1.5 text-muted"}>
                          {opt.count} créneau{opt.count > 1 ? "x" : ""}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {createLevel && (
              <div>
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                  2. {createLevel === "formation" ? "Niveau de formation" : "Année"}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {createYearOptions().length === 0 ? (
                    <p className="text-xs italic text-muted">Aucune classe pour ce niveau.</p>
                  ) : (
                    createYearOptions().map((opt) => {
                      const active = createYear === opt.value;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => pickCreateYear(active ? "" : opt.value)}
                          className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                            active
                              ? "border-primary bg-primary text-white"
                              : "border-line bg-surface text-ink hover:bg-primary-50"
                          }`}
                        >
                          {opt.label}
                          <span className={active ? "ms-1.5 text-white/75" : "ms-1.5 text-muted"}>
                            {opt.count} créneau{opt.count > 1 ? "x" : ""}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Formations carry no filière — their level is the last step. */}
            {createLevel && createLevel !== "formation" && createYear && (
              <div>
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                  3. Filière
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {createFiliereOptions().length === 0 ? (
                    <p className="text-xs italic text-muted">Aucune classe pour cette année.</p>
                  ) : (
                    createFiliereOptions().map((opt) => {
                      const active = createFiliereId === opt.value;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => setCreateFiliereId(active ? "" : opt.value)}
                          className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                            active
                              ? "border-primary bg-primary text-white"
                              : "border-line bg-surface text-ink hover:bg-primary-50"
                          }`}
                        >
                          {opt.label}
                          <span className={active ? "ms-1.5 text-white/75" : "ms-1.5 text-muted"}>
                            {opt.count} créneau{opt.count > 1 ? "x" : ""}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Every créneau created on the matched niveau + année + filière */}
        {matched.length === 0 && searching && stageItems.length === 0 ? (
          <p className="rounded-xl border border-line bg-canvas/30 px-3 py-2.5 text-xs italic text-muted">
            Aucune classe ne correspond à «&nbsp;{createClassSearch.trim()}&nbsp;». Essayez «&nbsp;niveau
            année filière&nbsp;», par exemple «&nbsp;lycee 2eme sciences&nbsp;».
          </p>
        ) : matched.length > 0 ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                Créneaux de{" "}
                <strong className="text-ink">
                  {matched.slice(0, 3).map((c) => classFullLabel(c)).join(" / ")}
                  {matched.length > 3 ? ` +${matched.length - 3} autre(s)` : ""}
                </strong>{" "}
                — cochez ceux de l&apos;étudiant
              </span>
              <span className="text-[10px] text-muted">
                {matched.reduce((sum, c) => sum + timingCountOf(c.id), 0)} créneau(x)
              </span>
            </div>

            <EnrollmentCards
              items={matchedItems}
              selectedIds={selectedAssignIds}
              subDates={assignSubDates}
              startDates={assignStartDates}
              discounts={assignDiscounts}
              onPickGroup={onPickGroupInMode}
              onToggleCoursework={toggleCoursework}
              onSubDateChange={(id, value) => setAssignSubDates({ ...assignSubDates, [id]: value })}
              onStartDateChange={(id, value) => setAssignStartDates({ ...assignStartDates, [id]: value })}
              onDiscountChange={setItemDiscount}
              emptyLabel="Aucun créneau tarifé ici — définissez d'abord son tarif dans « Abonnements »."
              className="max-h-72"
            />
          </div>
        ) : null}

        {/* Stages intensifs — hors cascade, ils n'appartiennent à aucune classe */}
        {stageItems.length > 0 && (
          <div className="space-y-2">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-muted">
              Stages intensifs — cochez ceux de l&apos;étudiant
            </span>
            <EnrollmentCards
              items={stageItems}
              selectedIds={selectedAssignIds}
              subDates={assignSubDates}
              startDates={assignStartDates}
              discounts={assignDiscounts}
              onPickGroup={onPickGroupInMode}
              onToggleCoursework={toggleCoursework}
              onSubDateChange={(id, value) => setAssignSubDates({ ...assignSubDates, [id]: value })}
              onStartDateChange={(id, value) => setAssignStartDates({ ...assignStartDates, [id]: value })}
              onDiscountChange={setItemDiscount}
              emptyLabel="Aucun stage ne correspond à cette recherche."
              className="max-h-56"
            />
          </div>
        )}

        {/* Inscriptions retenues qui ne sont pas dans les listes ci-dessus :
            elles restent modifiables (créneau, dates, réduction) sans avoir à
            retrouver leur niveau. */}
        {hiddenItems.length > 0 && (
          <div className="space-y-2">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-muted">
              Inscriptions déjà retenues ({hiddenIds.length}) — hors de la liste ci-dessus
            </span>
            <EnrollmentCards
              items={hiddenItems}
              selectedIds={selectedAssignIds}
              subDates={assignSubDates}
              startDates={assignStartDates}
              discounts={assignDiscounts}
              onPickGroup={onPickGroupInMode}
              onToggleCoursework={toggleCoursework}
              onSubDateChange={(id, value) => setAssignSubDates({ ...assignSubDates, [id]: value })}
              onStartDateChange={(id, value) => setAssignStartDates({ ...assignStartDates, [id]: value })}
              onDiscountChange={setItemDiscount}
              emptyLabel=""
              className="max-h-72"
            />
          </div>
        )}

        {/* Recap: the selection survives changing niveau/année/filière, so a
            student can be enrolled across several classes in one pass. */}
        {selectedAssignIds.length > 0 && (
          <div className="rounded-xl border border-line bg-surface p-2.5 space-y-2">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-muted">
              Inscriptions retenues
            </span>
            <div className="flex flex-wrap gap-1.5">
              {selectedAssignIds.map((subId) => (
                <span
                  key={subId}
                  className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary-50 px-2.5 py-1 text-[10px] font-semibold text-primary"
                >
                  {getSubLabel(subId)}
                  <button
                    onClick={() => unselectEnrollment(subId)}
                    className="text-danger hover:underline"
                    aria-label="Retirer cette inscription"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-line pt-2 text-xs">
              <span className="font-semibold text-muted">Total par séance après réductions</span>
              <strong className="text-primary text-sm">{selectedEnrollmentTotal(selectedAssignIds)} DA</strong>
            </div>
            {fee > 0 && (
              <p className="text-[10px] leading-relaxed text-muted">
                S&apos;y ajoutent les frais d&apos;inscription{" "}
                <strong className="text-ink">
                  {feeLabel} ({fee} DA)
                </strong>
                ,{" "}
                {feePayNow
                  ? mode === "create"
                    ? "encaissés à la création"
                    : "encaissés à l'enregistrement"
                  : "laissés en dette sur sa fiche"}
                .
              </p>
            )}
          </div>
        )}

        <p className="text-[10px] leading-relaxed text-muted">
          📅 Chaque créneau retenu est enregistré sur l&apos;étudiant avec sa{" "}
          <strong className="text-ink">date d&apos;inscription</strong> et sa{" "}
          <strong className="text-ink">date de début de facturation</strong>, puis apparaît dans l&apos;onglet
          «&nbsp;Abonnements&nbsp;» de sa fiche. Tant que la date de début n&apos;est pas atteinte, la présence
          est enregistrée sans rien retirer du solde. Tout reste modifiable ensuite depuis
          «&nbsp;Modifier&nbsp;» ou «&nbsp;Inscriptions&nbsp;».
        </p>
      </div>
    );
  };

  const handlePrintStudent = (stu: Student) => {
    const studentTx = balanceTx.filter((t) => t.studentId === stu.id);
    const parentObj = parents.find((p) => p.id === stu.parentId);

    // Get detailed subscriptions
    const subDetails = stu.subscriptionIds.map((subId) => {
      const sub = subscriptions.find((s) => s.id === subId);
      const sess = sub ? sessions.find((se) => se.id === sub.sessionId) : null;
      const cl = sess ? classes.find((c) => c.id === sess.classId) : null;
      const mod = sess ? modules.find((m) => m.id === sess.moduleId) : null;
      const t = sess ? teachers.find((te) => te.id === sess.teacherId) : null;
      const gr = sess ? groups.find((g) => g.id === sess.groupId) : null;
      const sa = sess ? salles.find((sl) => sl.id === sess.salleId) : null;

      const daysMapping: Record<string, string> = {
        sunday: "Dimanche",
        monday: "Lundi",
        tuesday: "Mardi",
        wednesday: "Mercredi",
        thursday: "Jeudi",
        friday: "Vendredi",
        saturday: "Samedi",
      };

      const daysText = sess ? sess.days.map(d => daysMapping[d] || d).join(", ") : "-";
      const schedule = sess ? `${daysText} (${sess.startTime} - ${sess.endTime})` : "-";

      return {
        moduleName: mod?.name ?? "-",
        className: cl?.name ?? "-",
        teacherName: t ? `${t.firstName} ${t.lastName}` : "-",
        groupName: gr?.name ?? "-",
        salleName: sa?.name ?? "-",
        price: sub?.pricePerSession ?? 0,
        schedule,
      };
    });

    // Get attendance records
    const studentAttendance = attendance.filter((a) => a.studentId === stu.id);
    // Automatic weekly-absence charges (shown in the presence table too).
    const studentPenalties = absencePenalties.filter((p) => p.studentId === stu.id);

    // Financial totals
    const totalTopups = studentTx.filter(t => t.type === "topup").reduce((sum, t) => sum + t.amount, 0);
    const totalDeductions = Math.abs(studentTx.filter(t => t.type === "deduction").reduce((sum, t) => sum + t.amount, 0));

    const formatDate = (dateStr: string) => {
      if (!dateStr) return "";
      const d = new Date(dateStr);
      return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
    };

    const formatDateTime = (dateStr: string) => {
      if (!dateStr) return "";
      const d = new Date(dateStr);
      return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) + " à " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    };

    const logoHtml = school.logo
      ? `<img src="${school.logo}" alt="logo" class="school-logo" />`
      : `<div class="school-logo-fallback">🏫</div>`;

    const html = `
      <html>
        <head>
          <title>Fiche Étudiant - ${stu.firstName} ${stu.lastName}</title>
          <style>
            @media print {
              body { padding: 0; margin: 0; background: #fff; color: #000; font-size: 11px; }
              .no-print { display: none; }
              .page-break { page-break-before: always; }
            }
            * { box-sizing: border-box; }
            body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 25px; color: #1e1b4b; background-color: #faf9ff; }
            
            /* Letterhead Header */
            .letterhead { display: flex; justify-content: space-between; align-items: stretch; border: 1px solid #e8e6f4; background: #fff; padding: 15px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
            .school-identity { display: flex; align-items: center; gap: 15px; }
            .school-logo, .school-logo-fallback { width: 65px; height: 65px; border-radius: 12px; object-fit: cover; }
            .school-logo-fallback { background: #f5f3ff; border: 1px solid #ddd; display: flex; align-items: center; justify-content: center; font-size: 2.2em; }
            .school-details h2 { margin: 0; font-size: 1.4em; color: #7c3aed; font-weight: 800; }
            .school-details p { margin: 2px 0; font-size: 0.85em; color: #5c567a; }
            
            .school-tax-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; border-left: 2px solid #7c3aed; padding-left: 15px; align-items: center; }
            .tax-item { font-size: 0.78em; color: #5c567a; }
            .tax-item strong { color: #1e1b4b; font-family: monospace; }
            
            /* Document title banner */
            .doc-title-banner { background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: #fff; padding: 15px; border-radius: 12px; margin-bottom: 20px; text-align: center; }
            .doc-title-banner h1 { margin: 0; font-size: 1.5em; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
            .doc-title-banner p { margin: 5px 0 0; font-size: 0.9em; opacity: 0.9; }

            /* Grid Layout of Frames */
            .frames-grid { display: grid; grid-template-columns: 1fr; gap: 20px; }
            .frame { border: 1px solid #e8e6f4; border-top: 4px solid #7c3aed; background: #fff; padding: 16px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
            .frame-info { border-top-color: #3b82f6; }
            .frame-success { border-top-color: #22c55e; }
            .frame h3 { margin: 0 0 12px; font-size: 1.05em; color: #1e1b4b; border-bottom: 1px dashed #e8e6f4; padding-bottom: 6px; }
            
            /* Tables styled inside frames */
            table { width: 100%; border-collapse: collapse; margin-top: 5px; font-size: 0.9em; }
            th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #f1f0fb; }
            th { background-color: #fcfbff; font-weight: 700; color: #5c567a; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.3px; }
            tr:last-child td { border-bottom: 0; }
            
            /* Badges */
            .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75em; font-weight: bold; text-align: center; }
            .badge-primary { background-color: #f5f3ff; color: #7c3aed; }
            .badge-success { background-color: #dcfce7; color: #15803d; }
            .badge-danger { background-color: #fee2e2; color: #b91c1c; }
            .badge-warning { background-color: #fef9c3; color: #854d0e; }
            
            /* Account Card */
            .summary-card { background: #fdfcff; border: 2px solid #7c3aed; border-radius: 12px; padding: 15px; margin-top: 20px; }
            .summary-line { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f1f0fb; font-size: 0.95em; }
            .summary-line:last-child { border-bottom: 0; padding-bottom: 0; }
            .balance-box { display: flex; justify-content: space-between; border-radius: 10px; padding: 12px; margin-top: 10px; font-size: 1.15em; font-weight: 800; }
            .balance-positive { background: #f0fdf4; border: 2px solid #22c55e; color: #15803d; }
            .balance-negative { background: #fdf2f2; border: 2px solid #ef4444; color: #b91c1c; }
            
            /* Signatures block */
            .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; }
            .signature-block { border: 1px dashed #c0b6e9; border-radius: 10px; background: #fff; padding: 15px; height: 100px; display: flex; flex-direction: column; justify-content: space-between; }
            .signature-label { font-size: 0.8em; font-weight: bold; text-transform: uppercase; color: #5c567a; text-align: center; }
            
            .meta-text { text-align: center; font-size: 0.75em; color: #999; margin-top: 30px; font-style: italic; }
          </style>
        </head>
        <body>
          <!-- School Letterhead -->
          <div class="letterhead">
            <div class="school-identity">
              ${logoHtml}
              <div class="school-details">
                <h2>${school.name}</h2>
                <p>${school.description}</p>
                <p>📍 ${school.address} | 📞 ${school.phone}</p>
                <p>✉️ ${school.email}</p>
              </div>
            </div>
            <div class="school-tax-grid">
              <div class="tax-item">NIF: <strong>${school.nif || "-"}</strong></div>
              <div class="tax-item">NIS: <strong>${school.nis || "-"}</strong></div>
              <div class="tax-item">RC: <strong>${school.registreCommerce || "-"}</strong></div>
              <div class="tax-item">Art. Fiscal: <strong>${school.articleFiscal || "-"}</strong></div>
            </div>
          </div>

          <!-- Document Title -->
          <div class="doc-title-banner">
            <h1>Dossier & Relevé de Compte Élève</h1>
            <p>Date d'édition : <strong>${new Date().toLocaleDateString("fr-DZ")}</strong></p>
          </div>

          <!-- Student Profile Frame -->
          <div class="frame frame-info" style="margin-bottom: 20px;">
            <h3>Informations Personnelles de l'Élève</h3>
            <table style="margin-top:0;">
              <tr>
                <td style="width:15%; font-weight:bold; color:#5c567a;">Nom Complet :</td>
                <td style="width:35%; font-weight:bold; font-size:1.1em;">${stu.lastName} ${stu.firstName}</td>
                <td style="width:15%; font-weight:bold; color:#5c567a;">ID Unique / RFID :</td>
                <td style="width:35%; font-family:monospace;">${stu.id} / ${stu.rfid || "-"}</td>
              </tr>
              <tr>
                <td style="font-weight:bold; color:#5c567a;">Date de Naiss. :</td>
                <td>${formatDate(stu.birthDate)}</td>
                <td style="font-weight:bold; color:#5c567a;">Téléphone Élève :</td>
                <td style="font-family:monospace;">${stu.phone || "-"}</td>
              </tr>
              <tr>
                <td style="font-weight:bold; color:#5c567a;">Parent / Tuteur :</td>
                <td>${parentObj ? `${parentObj.lastName} ${parentObj.firstName}` : "-"}</td>
                <td style="font-weight:bold; color:#5c567a;">Tél Parent :</td>
                <td style="font-family:monospace;">${parentObj ? parentObj.phone : "-"}</td>
              </tr>
              <tr>
                <td style="font-weight:bold; color:#5c567a;">Statut Spécial :</td>
                <td colspan="3">
                  <span class="badge ${stu.isFree ? "badge-warning" : "badge-success"}">
                    ${stu.isFree ? "Bénéficiaire (Accès Gratuit)" : "Standard (Payant)"}
                  </span>
                </td>
              </tr>
            </table>
          </div>

          <div class="frames-grid">
            
            <!-- Courses Subscriptions Frame -->
            <div class="frame">
              <h3>Abonnements Académiques Actifs</h3>
              <table>
                <thead>
                  <tr>
                    <th>Module (Classe)</th>
                    <th>Enseignant</th>
                    <th>Groupe & Salle</th>
                    <th style="text-align:right;">Tarif Séance</th>
                    <th>Horaires & Planification</th>
                  </tr>
                </thead>
                <tbody>
                  ${subDetails.length === 0 
                    ? `<tr><td colspan="5" style="text-align:center; font-style:italic; color:#999;">Aucune inscription active.</td></tr>`
                    : subDetails.map(sub => `
                        <tr>
                          <td style="font-weight:bold;">${sub.moduleName} (${sub.className})</td>
                          <td>${sub.teacherName}</td>
                          <td>${sub.groupName} <span style="font-size:0.85em; color:#888;">(Salle ${sub.salleName})</span></td>
                          <td style="text-align:right; font-weight:bold;">${stu.isFree ? 0 : sub.price} DA</td>
                          <td style="font-size:0.85em; color:#5c567a;">${sub.schedule}</td>
                        </tr>
                      `).join("")
                  }
                </tbody>
              </table>
            </div>

            <!-- Attendance History Frame -->
            <div class="frame">
              <h3>Historique Récent des Présences (Scans)</h3>
              <table>
                <thead>
                  <tr>
                    <th>Date & Heure</th>
                    <th>Cours / Séance</th>
                    <th style="text-align:center;">Statut</th>
                    <th style="text-align:right;">Déduction</th>
                  </tr>
                </thead>
                <tbody>
                  ${(() => {
                    const fmtDay = (d: string) => d.split("-").reverse().join("/");
                    const presenceRows = [
                      ...studentAttendance.map((a) => {
                        const sess = sessions.find(s => s.id === a.sessionId);
                        const mod = sess ? modules.find(m => m.id === sess.moduleId)?.name : "";
                        const cls = sess ? classes.find(c => c.id === sess.classId)?.name : "";
                        return {
                          sort: new Date(a.timestamp).getTime(),
                          html: `
                          <tr>
                            <td>${formatDateTime(a.timestamp)}</td>
                            <td style="font-weight:bold;">${mod} <span style="font-size:0.85em; font-weight:normal; color:#888;">(${cls})</span></td>
                            <td style="text-align:center;">
                              <span class="badge ${a.status === "present" ? "badge-success" : "badge-warning"}">
                                ${a.status === "present" ? "Présent" : "En Retard"}
                              </span>
                            </td>
                            <td style="text-align:right; font-weight:bold; color:#b91c1c;">-${a.amountDeducted} DA</td>
                          </tr>`,
                        };
                      }),
                      ...studentPenalties.map((p) => {
                        const mod = modules.find(m => m.id === p.moduleId)?.name ?? "";
                        return {
                          sort: new Date(`${p.periodEnd}T12:00:00`).getTime(),
                          html: `
                          <tr>
                            <td>${fmtDay(p.periodStart)} → ${fmtDay(p.periodEnd)}</td>
                            <td style="font-weight:bold;">${mod} <span style="font-size:0.85em; font-weight:normal; color:#888;">(Absence semaine)</span></td>
                            <td style="text-align:center;">
                              <span class="badge badge-warning" style="background:#fee2e2; color:#b91c1c;">Absent</span>
                            </td>
                            <td style="text-align:right; font-weight:bold; color:#b91c1c;">-${p.amount} DA</td>
                          </tr>`,
                        };
                      }),
                    ].sort((a, b) => b.sort - a.sort);
                    return presenceRows.length === 0
                      ? `<tr><td colspan="4" style="text-align:center; font-style:italic; color:#999;">Aucune présence scannée.</td></tr>`
                      : presenceRows.slice(0, 8).map(r => r.html).join("");
                  })()}
                </tbody>
              </table>
            </div>

            <!-- Payments & Transactions Frame -->
            <div class="frame">
              <h3>Historique Financier du Compte (Rechargements & Débits)</h3>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Mode / Type</th>
                    <th style="text-align:right;">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  ${studentTx.length === 0
                    ? `<tr><td colspan="4" style="text-align:center; font-style:italic; color:#999;">Aucune transaction sur ce compte.</td></tr>`
                    : studentTx.slice(-10).reverse().map(tx => {
                        const isAbsence = tx.amount < 0 && tx.description.startsWith("Absence hebdomadaire");
                        const typeLabel = tx.type === "topup" ? "Rechargement" : isAbsence ? "Absence (semaine)" : "Dépense / Séance";
                        const typeClass = tx.type === "topup" ? "badge-success" : "badge-primary";
                        return `
                        <tr>
                          <td>${formatDate(tx.date)}</td>
                          <td>${tx.description}</td>
                          <td>
                            <span class="badge ${typeClass}"${isAbsence ? ' style="background:#fef3c7; color:#b45309;"' : ""}>
                              ${typeLabel}
                            </span>
                          </td>
                          <td style="text-align:right; font-weight:bold; color:${tx.amount >= 0 ? "#15803d" : "#b91c1c"};">
                            ${tx.amount >= 0 ? "+" : ""}${tx.amount} DA
                          </td>
                        </tr>
                      `;
                      }).join("")
                  }
                </tbody>
              </table>
            </div>

          </div>

          <!-- Final Account Balance calculations -->
          <div class="summary-card">
            <h3 style="margin-top:0; border-bottom:1px solid #7c3aed; padding-bottom:6px; color:#7c3aed;">Situation de Caisse de l'Élève</h3>
            <div class="summary-line">
              <span>Total cumulé des rechargements (Versement) :</span>
              <strong style="color:#15803d;">+${totalTopups} DA</strong>
            </div>
            <div class="summary-line">
              <span>Total consommé en séances de cours :</span>
              <strong style="color:#b91c1c;">-${totalDeductions} DA</strong>
            </div>
            ${stu.registrationDue !== undefined && stu.registrationDue > 0 
              ? `
                <div class="summary-line" style="color:#b91c1c;">
                  <span>Frais d'inscription annuels restants :</span>
                  <strong>-${stu.registrationDue} DA</strong>
                </div>
              `
              : ""
            }
            
            <div class="balance-box ${stu.balance >= 0 ? "balance-positive" : "balance-negative"}">
              <span>SOLDE DU COMPTE ÉLÈVE :</span>
              <span>${stu.balance} DA</span>
            </div>
          </div>

          <!-- Signature blocks -->
          <div class="signatures">
            <div class="signature-block">
              <span class="signature-label">Signature de l'Élève / Parent</span>
            </div>
            <div class="signature-block">
              <span class="signature-label">Le Secrétariat / Caisse</span>
            </div>
          </div>

          <div class="meta-text">
            Fiche éditée par le système centralisé de l'école ${school.name} le ${new Date().toLocaleString("fr-DZ")}
          </div>
        </body>
      </html>
    `;
    printHtmlDocument(html);
  };

  /** Bon de chargement de solde — ticket de caisse 80 mm.
   *
   *  Une recharge se règle en trente secondes au guichet : la preuve remise à
   *  la famille est un ticket étroit, pas une facture. L'ancien reçu tirait une
   *  page entière (en-tête fiscal, tableau des modules souscrits, deux cadres de
   *  signature) pour annoncer un seul montant — sur la thermique 80 mm de la
   *  réception cela sortait en dizaines de centimètres de papier.
   *
   *  Le contenu est arrêté dans lib/reports/rechargeTicket.ts ; ici on ne fait
   *  que réunir ce que l'écran connaît de l'élève. */
  const handlePrintInvoice = (stu: Student, amount: number, desc: string, settledReg: boolean) => {
    // `stu` est la photo d'AVANT l'écriture (voir handleTopup) : le solde
    // d'après se relit dans le magasin, une fois l'opération passée.
    const updatedStu = useData.getState().students.find((s) => s.id === stu.id) ?? stu;

    // La scolarité de l'élève, telle qu'on en parle au guichet : la première
    // inscription qui porte une classe la fixe pour tout le dossier (verrou de
    // scolarité), les suivantes en relèvent forcément.
    const scopeClass = updatedStu.subscriptionIds
      .map((id) => classOfSubscription(id))
      .find((c): c is SchoolClass => Boolean(c));

    printHtmlDocument(
      buildRechargeTicket({
        school,
        student: updatedStu,
        password: studentCredentials.find((c) => c.studentId === stu.id)?.password ?? "",
        schooling: scopeClass
          ? classCascadeLabel(
              scopeClass,
              filieres.find((f) => f.id === scopeClass.filiereId)?.name ?? "",
            )
          : "",
        amount,
        description: desc,
        balanceBefore: stu.balance,
        balanceAfter: updatedStu.balance,
        registrationSettled: settledReg ? stu.registrationDue ?? 0 : 0,
        language,
      }),
    );
  };

  // ---- Ce que les cartes déclenchent, en un objet STABLE ----------------------
  // Les fonctions ci-dessus sont recréées à chaque rendu ; les passer telles
  // quelles aux cartes forcerait chacune à se redessiner à chaque lettre tapée.
  // Les cartes reçoivent donc un objet qui ne change jamais, et qui appelle la
  // version la plus récente de chaque fonction.
  const latestActions = useRef<Omit<StudentCardActions, "setOverlay"> | null>(null);
  useEffect(() => {
    latestActions.current = {
      openWhatsApp,
      openDetails,
      openAssign,
      openTopup,
      openPayDebt,
      printStudent: handlePrintStudent,
      openEdit,
      openPrintPayments,
      deleteStudent: handleDelete,
      openRegFee,
    };
  });
  const cardActions = useMemo<StudentCardActions>(
    () => ({
      openWhatsApp: (stu, focus) => latestActions.current?.openWhatsApp(stu, focus),
      openDetails: (stu) => latestActions.current?.openDetails(stu),
      openAssign: (stu) => latestActions.current?.openAssign(stu),
      openTopup: (stu) => latestActions.current?.openTopup(stu),
      openPayDebt: (stu) => latestActions.current?.openPayDebt(stu),
      printStudent: (stu) => latestActions.current?.printStudent(stu),
      openEdit: (stu) => latestActions.current?.openEdit(stu),
      openPrintPayments: (stu) => latestActions.current?.openPrintPayments(stu),
      deleteStudent: (id) => latestActions.current?.deleteStudent(id),
      openRegFee: (stu) => latestActions.current?.openRegFee(stu),
      // Un `setState` de React ne change jamais : il peut être passé tel quel.
      setOverlay: setOverlayStudentId,
    }),
    [],
  );

  const parentById = useMemo(() => new Map(parents.map((p) => [p.id, p])), [parents]);

  // Formations expirées ou sur le point de l'être — calculé quand les élèves
  // changent, pas à chaque frappe.
  const expiryAlerts = useMemo(
    () =>
      students
        .flatMap((stu) =>
          stu.subscriptionIds.flatMap((subId) => {
            const dates = stu.subscriptionDates?.[subId];
            if (!dates?.expiryDate) return [];
            const daysLeft = daysUntil(dates.expiryDate);
            if (daysLeft > EXPIRY_WARNING_DAYS) return [];
            return [{ stu, subId, label: getModuleLabel(subId), expiryDate: dates.expiryDate, daysLeft }];
          }),
        )
        .sort((a, b) => a.daysLeft - b.daysLeft),
    [students, getModuleLabel],
  );

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <PageHeader emoji="🎓" title="Étudiants" subtitle="Gérer les inscriptions et abonnements des élèves" />

        <div className="flex items-center gap-2">
          {/* Qui a étudié sans provision ? La question se posait fiche par fiche.
              Elle a maintenant son bouton, avec le nombre d'élèves concernés
              lisible sans ouvrir quoi que ce soit. */}
          <Button
            onClick={() => setIsDebtorsOpen(true)}
            variant="outline"
            title={
              debtors.length > 0
                ? `${debtors.length} élève(s) en dette — ${totalOwed} DA à recouvrer`
                : "Aucun élève en dette"
            }
            className="flex items-center gap-2 border-danger/30 hover:border-danger hover:bg-danger/10 text-danger relative"
          >
            <AlertTriangle className="h-4 w-4 text-danger" /> Élèves en dette
            {debtors.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-danger text-white text-[9px] font-bold h-4.5 w-4.5 rounded-full flex items-center justify-center pulse-glow">
                {debtors.length}
              </span>
            )}
          </Button>
          <Button
            onClick={() => {
              const lowStus = soonStudents;
              setSelectedAlertStudentIds(lowStus.map((s) => s.id));
              setIsAlertLowBalanceOpen(true);
            }}
            variant="outline"
            className="flex items-center gap-2 border-danger/30 hover:border-danger hover:bg-danger/10 text-danger relative"
          >
            <Bell className="h-4 w-4 text-danger" /> Alertes Soldes
            {soonStudents.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-danger text-white text-[9px] font-bold h-4.5 w-4.5 rounded-full flex items-center justify-center pulse-glow">
                {soonStudents.length}
              </span>
            )}
          </Button>
          <Button onClick={() => setIsScanOpen(true)} variant="secondary" className="flex items-center gap-2">
            <Scan className="h-4 w-4" /> Scanner RFID
          </Button>
          <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> Nouvel Étudiant
          </Button>
        </div>
      </div>

      {/* Un scan qui ne débite rien n'est presque jamais une panne : c'est une
          gratuité active. Elle se voit donc ici, sur l'écran qui scanne. */}
      <div className="mb-6">
        <FreeBillingBanner />
      </div>

      {/* Filter panel */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6 bg-surface border border-line p-3 rounded-2xl">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher par nom, carte RFID, téléphone ou email..."
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant={filterType === "all" ? "primary" : "outline"} onClick={() => setFilterType("all")}>
            Tous
          </Button>
          <Button size="sm" variant={filterType === "soon" ? "primary" : "outline"} onClick={() => setFilterType("soon")}>
            Presque Épuisé
          </Button>
          <Button size="sm" variant={filterType === "debt" ? "primary" : "outline"} onClick={() => setFilterType("debt")}>
            En dette
          </Button>
          <Button size="sm" variant={filterType === "paid" ? "primary" : "outline"} onClick={() => setFilterType("paid")}>
            À jour
          </Button>
          <Button size="sm" variant={filterType === "free" ? "primary" : "outline"} onClick={() => setFilterType("free")}>
            Cas Spéciaux
          </Button>
        </div>
      </div>

      {/* Formation expiry alerts */}
      {(() => {
        const alerts = expiryAlerts;
        if (alerts.length === 0) return null;
        return (
          <Card className="mb-6">
            <CardBody>
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-warning/15 p-2.5 text-warning">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-ink">Alertes d&apos;expiration des formations</h3>
                  <p className="mt-0.5 text-xs text-muted">
                    Formations expirées ou qui expirent dans les {EXPIRY_WARNING_DAYS} prochains jours.
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {alerts.map((a) => (
                      <div
                        key={`${a.stu.id}-${a.subId}`}
                        className="flex flex-wrap items-center justify-between gap-2 text-xs bg-canvas/40 border border-line rounded-lg px-3 py-1.5"
                      >
                        <span>
                          <strong className="text-ink">
                            {a.stu.firstName} {a.stu.lastName}
                          </strong>
                          <span className="text-muted"> — {a.label}</span>
                        </span>
                        <Badge tone={a.daysLeft < 0 ? "danger" : "warning"} className="text-[10px]">
                          {a.daysLeft < 0
                            ? `Expirée le ${formatDateFr(a.expiryDate)}`
                            : a.daysLeft === 0
                              ? "Expire aujourd'hui"
                              : `Expire dans ${a.daysLeft} j (${formatDateFr(a.expiryDate)})`}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>
        );
      })()}

      {/* Students list — cartes mémorisées, affichées par tranches : taper dans
          une fenêtre ne redessine plus des centaines de cartes derrière elle. */}
      <StudentCardGrid
        students={filteredStudents}
        debtOf={debtOf}
        overlayStudentId={overlayStudentId}
        parentById={parentById}
        labelOf={getModuleLabel}
        actions={cardActions}
        resetKey={`${deferredSearch}|${filterType}`}
      />

      {/* Creation Modal */}
      <Modal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Ajouter un étudiant" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Prénom *</label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Nom de famille *</label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom de famille" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date de naissance *</label>
            <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Téléphone *</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+213 5XX XX XX XX" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Numéro Carte RFID *</label>
            <Input value={rfid} onChange={(e) => setRfid(e.target.value)} placeholder="Ex: RFID-0010" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Email</label>
            <Input
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setIsEmailDirty(true);
              }}
              placeholder="email@ecole.com"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Mot de passe</label>
            <Input
              type="text"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setIsPasswordDirty(true);
              }}
              placeholder="Mot de passe"
            />
          </div>

          <div className="md:col-span-2 bg-primary-50/50 p-3 rounded-xl border border-line flex items-center justify-between mt-2">
            <div>
              <strong className="text-ink text-xs block">Cas spécial (Études gratuites)</strong>
              <span className="text-[10px] text-muted">L'étudiant étudie gratuitement, aucun frais ne sera déduit.</span>
            </div>
            <input
              type="checkbox"
              checked={isFree}
              onChange={(e) => setIsFree(e.target.checked)}
              className="h-5 w-5 rounded border-line text-primary focus:ring-primary"
            />
          </div>
        </div>

        {/* Homonymes : l'alerte qui manquait, juste sous l'identité saisie. */}
        {renderDuplicateAlert()}

        {/* La scolarité d'abord : c'est le niveau + l'année qui décident du
            tarif d'inscription (une 3e année secondaire est pré-tarifée), donc
            la réception choisit la classe AVANT de voir les frais. */}
        {renderEnrollmentPicker("create")}

        {renderFeeSection("create")}

        {renderTopupSection("create")}

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleCreateStudent}>Créer</Button>
        </div>
      </Modal>

      {/* Edit Modal — le même écran que « Ajouter un étudiant », ouvert sur un
          dossier existant : identité, frais d'inscription, versement et
          inscriptions. Tout est prérempli avec ce que l'élève a déjà, donc
          enregistrer sans toucher à un bloc ne change rien. */}
      <Modal open={isEditOpen} onClose={closeEdit} title="Modifier l'étudiant" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Prénom *</label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Nom de famille *</label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom de famille" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date de naissance *</label>
            <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Téléphone *</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+213 5XX XX XX XX" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Numéro Carte RFID *</label>
            <Input value={rfid} onChange={(e) => setRfid(e.target.value)} placeholder="Ex: RFID-0010" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Email</label>
            <Input
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setIsEmailDirty(true);
              }}
              placeholder="email@ecole.com"
            />
          </div>

          {/* Le mot de passe n'est jamais relu depuis le compte : le laisser
              vide garde celui en place, le remplir le remplace partout. */}
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Nouveau mot de passe</label>
            <Input
              type="text"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setIsPasswordDirty(true);
              }}
              placeholder="Laisser vide pour ne pas le changer"
            />
          </div>

          <div className="md:col-span-2 bg-primary-50/50 p-3 rounded-xl border border-line flex items-center justify-between mt-2">
            <div>
              <strong className="text-ink text-xs block">Cas spécial (Études gratuites)</strong>
              <span className="text-[10px] text-muted">
                L&apos;étudiant étudie gratuitement, aucun frais ne sera déduit.
              </span>
            </div>
            <input
              type="checkbox"
              checked={isFree}
              onChange={(e) => setIsFree(e.target.checked)}
              className="h-5 w-5 rounded border-line text-primary focus:ring-primary"
            />
          </div>
        </div>

        {renderFeeSection("edit")}

        {renderTopupSection("edit")}

        {renderEnrollmentPicker("edit")}

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={closeEdit}>
            Annuler
          </Button>
          <Button onClick={handleEditStudent}>Enregistrer les modifications</Button>
        </div>
      </Modal>

      {/* Fiche Étudiant — la même fenêtre que sur la fiche d'une classe :
          onglets, corrections de transactions et de présences, dette. */}
      <StudentDetailsModal
        studentId={detailsStudentId}
        open={!!detailsStudentId}
        onClose={() => setDetailsStudentId(null)}
      />

      {/* Inscriptions Modal — les créneaux se choisissent ici exactement comme
          sur l'écran « Ajouter un étudiant » : niveau → année → filière, puis
          les créneaux de cette combinaison. La réduction groupée reste propre à
          cet écran, pour retarifer plusieurs modules en une fois. */}
      <Modal
        open={isAssignOpen}
        onClose={() => {
          setIsAssignOpen(false);
          resetForm();
        }}
        title="Inscriptions de l'étudiant"
        wide
      >
        <div className="space-y-4">
          {selectedStudent && (
            <div className="bg-canvas border border-line rounded-xl p-3 text-xs">
              <span className="text-[10px] text-muted block uppercase">Élève</span>
              <strong className="text-ink block mt-0.5">
                {selectedStudent.firstName} {selectedStudent.lastName}
              </strong>
              <span className="text-muted">
                {selectedStudent.subscriptionIds.length} inscription(s) enregistrée(s) · Solde:{" "}
                {selectedStudent.balance} DA
              </span>
            </div>
          )}

          {renderEnrollmentPicker("assign")}

          {/* Bulk reduction: one rate for every ticked module, in one go —
              instead of opening each module and setting it individually. */}
          <div className="rounded-xl border border-primary/25 bg-primary-50/40 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5" /> Réduction groupée ({selectedAssignIds.length} module(s) sélectionné(s))
              </span>
              {Object.keys(assignDiscounts).length > 0 && (
                <button onClick={clearAllDiscounts} className="text-[10px] font-bold text-danger hover:underline">
                  Tout réinitialiser
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-muted mb-1">Type</label>
                <Select
                  value={bulkDiscountType}
                  onChange={(e) => setBulkDiscountType(e.target.value as DiscountType)}
                  className="w-40"
                >
                  <option value="percent">Pourcentage (%)</option>
                  <option value="amount">Montant fixe (DA)</option>
                </Select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-muted mb-1">
                  Valeur {bulkDiscountType === "percent" ? "(%)" : "(DA)"}
                </label>
                <Input
                  type="number"
                  min={0}
                  max={bulkDiscountType === "percent" ? 100 : undefined}
                  value={bulkDiscountValue || ""}
                  onChange={(e) => setBulkDiscountValue(Number(e.target.value))}
                  placeholder={bulkDiscountType === "percent" ? "Ex: 20" : "Ex: 500"}
                  className="w-32"
                />
              </div>
              <Button size="sm" onClick={applyBulkDiscount} className="mb-0.5">
                Appliquer à la sélection
              </Button>
            </div>
            <p className="text-[10px] leading-relaxed text-muted">
              Cochez plusieurs modules ci-dessus puis appliquez la réduction une seule fois. Chaque module
              reste modifiable individuellement sur sa carte. Le tarif réduit est celui réellement débité au
              scan, en présence manuelle et par la facturation d&apos;absence hebdomadaire.
            </p>
          </div>

          <div className="rounded-xl border border-line bg-canvas/40 p-3 text-[10px] leading-relaxed text-muted">
            📅 <strong className="text-ink">Dates d&apos;inscription :</strong> la{" "}
            <strong className="text-ink">date d&apos;inscription</strong> est le jour où l&apos;élève est enregistré
            sur le module (information de suivi). La <strong className="text-ink">date de début</strong> est le jour
            où la facturation commence : tant qu&apos;elle n&apos;est pas atteinte, la carte est acceptée, la présence
            est enregistrée mais <strong className="text-ink">aucun montant n&apos;est retiré du solde</strong>. Les
            deux dates restent modifiables ici à tout moment.
          </div>

          <div className="rounded-xl border border-line bg-canvas/40 p-3 text-[10px] leading-relaxed text-muted">
            🔁 <strong className="text-ink">Groupe et rattrapage :</strong> l&apos;étudiant est inscrit sur le groupe
            choisi ci-dessus, mais sa carte est acceptée sur <strong className="text-ink">n&apos;importe quel autre
            groupe du même cours</strong> (même classe, même module, même enseignant). La présence est alors
            enregistrée sur le groupe réellement suivi, au tarif de son inscription.
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setIsAssignOpen(false);
                resetForm();
              }}
            >
              Annuler
            </Button>
            <Button onClick={handleAssignSubmit}>Confirmer les inscriptions</Button>
          </div>
        </div>
      </Modal>

      {/* Topup (Charger solde) Modal */}
      <Modal open={isTopupOpen} onClose={() => setIsTopupOpen(false)} title="Nouveau versement (Recharge)">
        <div className="space-y-4">
          {selectedStudent && (
            <div className="bg-canvas border border-line rounded-xl p-3 text-xs">
              <span className="text-[10px] text-muted block uppercase">Élève</span>
              <strong className="text-ink block mt-0.5">{selectedStudent.firstName} {selectedStudent.lastName}</strong>
              <span className={debtOf(selectedStudent).sessions > 0 ? "font-bold text-danger" : "text-muted"}>
                Solde actuel: {selectedStudent.balance} DA
              </span>
            </div>
          )}

          {/* Recharger REMBOURSE la dette avant de créditer quoi que ce soit :
              le solde remonte de zéro, pas du montant versé. Sans ce rappel
              chiffré, le guichet croit à une recharge « perdue ». */}
          {selectedStudent && debtOf(selectedStudent).sessions > 0 && (() => {
            const debt = debtOf(selectedStudent);
            const paid = Math.max(Math.round(topupAmount) || 0, 0);
            const toRegistration = settleReg ? Math.min(debt.registration, paid) : 0;
            const toSessions = Math.min(debt.sessions, paid - toRegistration);
            const nextBalance = selectedStudent.balance + paid - toRegistration;
            return (
              <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-[10px] leading-relaxed text-danger space-y-1">
                <strong className="block text-xs">
                  DETTE EN COURS : {debt.sessions} DA de séances suivies non payées
                </strong>
                <span className="block text-danger/90">
                  Ce versement éponge la dette d&apos;abord : le solde ne remonte qu&apos;au-delà.
                </span>
                {paid > 0 && (
                  <div className="mt-1 space-y-0.5 rounded-lg border border-danger/30 bg-surface/60 p-2 text-ink">
                    {toRegistration > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted">Frais d&apos;inscription réglés :</span>
                        <strong>{toRegistration} DA</strong>
                      </div>
                    )}
                    {toSessions > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted">Dette épongée :</span>
                        <strong>{toSessions} DA</strong>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-line/50 pt-1">
                      <span className="text-muted">Nouveau solde :</span>
                      <strong className={nextBalance < 0 ? "text-danger" : "text-success"}>
                        {nextBalance} DA
                      </strong>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Montant à verser (DA) *</label>
            <Input
              type="number"
              value={topupAmount || ""}
              onChange={(e) => setTopupAmount(Number(e.target.value))}
              placeholder="Ex: 5000"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Description</label>
            <Input value={topupDesc} onChange={(e) => setTopupDesc(e.target.value)} placeholder="Recharge de solde" />
          </div>

          {/* UNE RECHARGE NE PAIE PLUS L'INSCRIPTION SANS QU'ON LE DEMANDE.
              Le versement va au solde, un point c'est tout : les frais restent
              dus tant que la deuxième option n'est pas choisie ici — ou réglés
              à part depuis l'alerte de sa carte. */}
          {selectedStudent && (selectedStudent.registrationDue ?? 0) > 0 ? (
            <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/10 p-3">
              <strong className="block text-xs text-warning">
                Frais d&apos;inscription encore dus : {selectedStudent.registrationDue} DA
              </strong>
              <label
                className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-xs transition-colors ${
                  settleReg ? "border-line bg-surface/40" : "border-primary bg-surface"
                }`}
              >
                <input
                  type="radio"
                  name="topup-registration"
                  checked={!settleReg}
                  onChange={() => setSettleReg(false)}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <strong className="block text-ink">Recharger le solde seulement</strong>
                  <span className="text-[10px] text-muted">
                    La totalité du versement va au solde. Les frais d&apos;inscription restent
                    dus et peuvent être réglés à part, depuis l&apos;alerte de sa carte.
                  </span>
                </span>
              </label>
              <label
                className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-xs transition-colors ${
                  settleReg ? "border-primary bg-surface" : "border-line bg-surface/40"
                }`}
              >
                <input
                  type="radio"
                  name="topup-registration"
                  checked={settleReg}
                  onChange={() => setSettleReg(true)}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <strong className="block text-ink">
                    Recharger ET régler les frais d&apos;inscription
                  </strong>
                  <span className="text-[10px] text-muted">
                    {selectedStudent.registrationDue} DA sont prélevés sur ce versement :
                    seuls{" "}
                    {Math.max(
                      Math.round(topupAmount || 0) - (selectedStudent.registrationDue ?? 0),
                      0,
                    )}{" "}
                    DA iront au solde.
                  </span>
                </span>
              </label>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsTopupOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleTopup}>Valider le dépôt</Button>
          </div>
        </div>
      </Modal>

      {/* Frais d'inscription : DEUX PORTES, jamais confondues */}
      <Modal
        open={isRegFeeOpen}
        onClose={() => setIsRegFeeOpen(false)}
        title="Régler les frais d'inscription"
      >
        {regFeeLive && (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-canvas p-3 text-xs">
              <span className="block text-[10px] uppercase text-muted">Élève</span>
              <strong className="mt-0.5 block text-ink">
                {regFeeLive.firstName} {regFeeLive.lastName}
              </strong>
              <div className="mt-2 flex justify-between border-t border-line/50 pt-1.5">
                <span className="text-muted">Frais d&apos;inscription dus :</span>
                <strong className="text-danger">{regFeeDue} DA</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Solde actuel :</span>
                <strong className={regFeeLive.balance < 0 ? "text-danger" : "text-success"}>
                  {regFeeLive.balance} DA
                </strong>
              </div>
            </div>

            <p className="text-[11px] leading-relaxed text-muted">
              Deux façons de régler, et elles ne font pas la même chose à l&apos;argent de
              l&apos;élève. Choisissez celle qui décrit ce qui vient de se passer au guichet.
            </p>

            {/* 1. Sur le solde — l'argent était déjà entré en caisse le jour de
                la recharge : rien n'y rentre aujourd'hui. */}
            <button
              type="button"
              disabled={regFeeBusy}
              onClick={() => handleRegFeePayment("balance")}
              className="w-full rounded-xl border border-line bg-surface p-3 text-start transition-colors hover:border-primary hover:bg-primary-50/50 disabled:opacity-60"
            >
              <span className="flex items-center gap-2 text-xs font-bold text-ink">
                <Wallet className="h-4 w-4 text-primary" /> Régler sur le solde de l&apos;élève
              </span>
              <span className="mt-1 block text-[10px] leading-relaxed text-muted">
                {regFeeDue} DA sont retirés de son solde ({regFeeLive.balance} DA →{" "}
                <strong
                  className={regFeeLive.balance - regFeeDue < 0 ? "text-danger" : "text-success"}
                >
                  {regFeeLive.balance - regFeeDue} DA
                </strong>
                ). Rien n&apos;entre en caisse aujourd&apos;hui : l&apos;argent y est entré le
                jour de sa recharge.
              </span>
              {regFeeLive.balance - regFeeDue < 0 && (
                <span className="mt-1.5 flex items-start gap-1 rounded-lg border border-danger/40 bg-danger/10 p-1.5 text-[10px] font-semibold text-danger">
                  <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                  Son solde ne couvre pas les frais : il passera en dette de{" "}
                  {regFeeDue - regFeeLive.balance} DA.
                </span>
              )}
            </button>

            {/* 2. À part — l'élève sort l'argent des frais, sa recharge reste
                intacte pour ses séances. */}
            <button
              type="button"
              disabled={regFeeBusy}
              onClick={() => handleRegFeePayment("cash")}
              className="w-full rounded-xl border border-line bg-surface p-3 text-start transition-colors hover:border-success hover:bg-success/10 disabled:opacity-60"
            >
              <span className="flex items-center gap-2 text-xs font-bold text-ink">
                <DollarSign className="h-4 w-4 text-success" /> Encaisser les frais à part
              </span>
              <span className="mt-1 block text-[10px] leading-relaxed text-muted">
                L&apos;élève paie les {regFeeDue} DA séparément : la somme entre en caisse
                aujourd&apos;hui et son solde ne bouge pas — il reste à{" "}
                <strong>{regFeeLive.balance} DA</strong> pour ses séances.
              </span>
            </button>

            <div className="flex justify-end pt-1">
              <Button variant="outline" onClick={() => setIsRegFeeOpen(false)} disabled={regFeeBusy}>
                Annuler
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Pay Debt (Régler dette) — fenêtre partagée avec la fiche élève et la
          fiche classe : la répartition annoncée est celle que la base fera. */}
      <PayDebtModal studentId={payDebtStudentId} onClose={() => setPayDebtStudentId(null)} />

      {/* Card scanner Modal */}
      <Modal
        open={isScanOpen}
        onClose={() => { setIsScanOpen(false); setScanResult(null); setScanRfidInput(""); }}
        title="Scanner de carte RFID"
      >
        <div className="space-y-4">
          <p className="text-xs text-muted">
            Passez la carte devant le lecteur, ou saisissez son code à la main. Le traitement est
            exactement celui du lecteur physique : présence, débit du solde, annonce vocale et
            alerte automatique au parent.
          </p>

          <div className="flex gap-2">
            <Input
              // Marqueur lu par GlobalRFIDListener : quand ce champ a le focus,
              // l'écouteur global laisse le champ soumettre le code lui-même,
              // au lieu de traiter le même passage une seconde fois (ce qui
              // renvoyait « Échec du scan » sur le doublon).
              data-scan-input="true"
              value={scanRfidInput}
              onChange={(e) => setScanRfidInput(e.target.value)}
              placeholder="RFID-XXXX"
              className="flex-1 font-mono"
              onKeyDown={(e) => e.key === "Enter" && handleScanCard()}
              autoFocus
            />
            <Button onClick={handleScanCard} disabled={scanBusy || !scanRfidInput.trim()}>
              {scanBusy ? "..." : "Valider"}
            </Button>
          </div>

          {scanResult && (
            <div
              className={`space-y-2 rounded-xl border p-4 text-xs ${
                scanResult.neutral
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : scanResult.ok
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-danger/30 bg-danger/10 text-danger"
              }`}
            >
              <h4 className="flex items-center gap-1.5 font-bold">
                {scanResult.neutral ? "ℹ Info" : scanResult.ok ? "✔ Succès" : "❌ Échec"}
              </h4>
              <p><strong>Élève:</strong> {scanResult.studentName}</p>
              {scanResult.session && <p><strong>Séance:</strong> {scanResult.session}</p>}
              <p>{scanResult.msg}</p>
              {scanResult.ok && (scanResult.cost ?? 0) > 0 && (
                <p><strong>Prix séance débité:</strong> {scanResult.cost} DA</p>
              )}
              {scanResult.ok && (scanResult.cost ?? 0) === 0 && (scanResult.waived ?? 0) > 0 && (
                <p><strong>Séance offerte:</strong> {scanResult.waived} DA non débités</p>
              )}
              {scanResult.ok && scanResult.newBalance !== undefined && (
                <p><strong>Nouveau solde:</strong> {scanResult.newBalance} DA</p>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Les élèves à qui l'école réclame quelque chose, et le guichet à côté
          de chaque nom : c'est la liste qu'on ouvre pour relancer, pas une
          bannière qu'on referme. */}
      <Modal
        open={isDebtorsOpen}
        onClose={() => setIsDebtorsOpen(false)}
        title={
          debtors.length > 0
            ? `Élèves en dette — ${debtors.length} élève(s), ${totalOwed} DA à recouvrer`
            : "Élèves en dette"
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-muted">
            Séances suivies sans provision, frais d&apos;inscription impayés, et soldes qui
            n&apos;ont pas enregistré une séance pourtant facturée. Cliquez un nom pour ouvrir
            sa fiche, ou réglez directement au guichet.
          </p>

          {debtors.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-xs font-bold text-success">
              <CheckCircle className="h-8 w-8" />
              <span>Aucun élève en dette — tout le monde est à jour.</span>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {debtors.map(({ stu, debt, owed }) => (
                <div
                  key={stu.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger/20 bg-danger/5 px-3 py-2 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setIsDebtorsOpen(false);
                      openDetails(stu);
                    }}
                    className="min-w-0 flex-1 text-start transition-colors hover:text-primary"
                  >
                    <strong className="block truncate text-ink">
                      {stu.firstName} {stu.lastName}
                    </strong>
                    <span className="block text-[10px] text-muted">
                      {[
                        debt.sessions > 0 ? `Séances non payées : ${debt.sessions} DA` : "",
                        debt.registration > 0 ? `Inscription : ${debt.registration} DA` : "",
                        debt.drift !== 0
                          ? `Solde à vérifier : ${Math.abs(debt.drift)} DA d'écart avec l'historique`
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone="danger" className="font-mono text-[10px]">
                      {owed} DA
                    </Badge>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        setIsDebtorsOpen(false);
                        openPayDebt(stu);
                      }}
                    >
                      Régler
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="outline" onClick={() => setIsDebtorsOpen(false)}>
              Fermer
            </Button>
            {debtors.length > 0 && (
              <Button
                onClick={() => {
                  setIsDebtorsOpen(false);
                  setFilterType("debt");
                }}
              >
                Voir leurs fiches dans la liste
              </Button>
            )}
          </div>
        </div>
      </Modal>

      {/* Alert Low Balance Modal */}
      <Modal
        open={isAlertLowBalanceOpen}
        onClose={() => setIsAlertLowBalanceOpen(false)}
        title="Alerte Soldes Presque Épuisés"
      >
        <div className="space-y-4">
          <p className="text-xs text-muted">
            Les étudiants suivants ont un solde presque épuisé (inférieur à 2 séances).
            Chaque élève sélectionné reçoit une notification dans l&apos;application et un message
            WhatsApp personnalisé — envoyé au parent rattaché, ou à l&apos;élève à défaut.
            Les envois sont espacés pour protéger le numéro WhatsApp de l&apos;école :
            comptez environ 5 secondes par destinataire.
          </p>

          {/* Automatic alert settings (Email & WhatsApp toggles) */}
          <div className="bg-canvas border border-line p-3.5 rounded-2xl space-y-2.5">
            <h4 className="text-[11px] uppercase font-bold text-muted tracking-wider">Alertes Automatiques (au passage de carte)</h4>
            <div className="flex flex-col sm:flex-row gap-4">
              <label className="flex items-center gap-2 text-xs text-ink cursor-pointer font-medium">
                <input
                  type="checkbox"
                  checked={autoSendWhatsapp}
                  onChange={(e) => setAutoSendWhatsapp(e.target.checked)}
                  className="rounded text-primary focus:ring-primary border-line h-4 w-4 bg-surface"
                />
                Envoi automatique WhatsApp
              </label>
              <label className="flex items-center gap-2 text-xs text-ink cursor-pointer font-medium">
                <input
                  type="checkbox"
                  checked={autoSendEmail}
                  onChange={(e) => setAutoSendEmail(e.target.checked)}
                  className="rounded text-primary focus:ring-primary border-line h-4 w-4 bg-surface"
                />
                Envoi automatique Email
              </label>
            </div>
          </div>

          {/* List of low balance students */}
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {soonStudents.length === 0 ? (
              <p className="text-xs text-muted italic p-4 text-center">Aucun étudiant n'a son solde presque épuisé en ce moment.</p>
            ) : (
              <>
                <div className="flex justify-between items-center px-1 pb-1">
                  <label className="flex items-center gap-2 text-xs font-bold text-ink cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedAlertStudentIds.length === soonStudents.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedAlertStudentIds(soonStudents.map(s => s.id));
                        } else {
                          setSelectedAlertStudentIds([]);
                        }
                      }}
                      className="rounded text-primary focus:ring-primary border-line h-4 w-4 bg-surface"
                    />
                    Tout Sélectionner
                  </label>
                  <span className="text-[10px] text-muted font-mono">
                    {selectedAlertStudentIds.length} / {soonStudents.length} élèves
                  </span>
                </div>

                {soonStudents.map((stu) => {
                  const isChecked = selectedAlertStudentIds.includes(stu.id);
                  const parentObj = parents.find((p) => p.id === stu.parentId);

                  return (
                    <div
                      key={stu.id}
                      className="flex items-center justify-between p-2.5 bg-canvas/30 border border-line rounded-xl gap-3 hover:bg-primary-50/10 transition-colors"
                    >
                      <label className="flex items-center gap-2.5 cursor-pointer flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            if (isChecked) {
                              setSelectedAlertStudentIds(selectedAlertStudentIds.filter(id => id !== stu.id));
                            } else {
                              setSelectedAlertStudentIds([...selectedAlertStudentIds, stu.id]);
                            }
                          }}
                          className="rounded text-primary focus:ring-primary border-line h-4 w-4 bg-surface"
                        />
                        <div className="min-w-0">
                          <strong className="text-xs text-ink block truncate">{stu.firstName} {stu.lastName}</strong>
                          <span className="text-[10px] text-muted block truncate">
                            Parent: {parentObj ? `${parentObj.firstName} (${parentObj.phone})` : "Aucun"}
                          </span>
                        </div>
                      </label>
                      <Badge tone="danger" className="font-mono text-[10px]">
                        {stu.balance} DA
                      </Badge>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* Action button */}
          <div className="flex justify-end gap-2 pt-4 border-t border-line">
            <Button variant="outline" onClick={() => setIsAlertLowBalanceOpen(false)}>
              Fermer
            </Button>
            <Button
              disabled={selectedAlertStudentIds.length === 0 || sendingAlerts}
              onClick={handleSendLowBalanceAlerts}
              className="flex items-center gap-2"
            >
              <Send className="h-4 w-4" />
              {sendingAlerts
                ? "Envoi en cours…"
                : `Envoyer les alertes (${selectedAlertStudentIds.length})`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Print payments over a period — pick range, generate, print */}
      <Modal
        open={isPrintPayOpen}
        onClose={() => setIsPrintPayOpen(false)}
        title="Imprimer les paiements — sélectionner la période"
      >
        <div className="space-y-4">
          {selectedStudent && (
            <div className="bg-canvas border border-line rounded-xl p-3 text-xs">
              <span className="text-[10px] text-muted block uppercase">Élève</span>
              <strong className="text-ink block mt-0.5">
                {selectedStudent.firstName} {selectedStudent.lastName}
              </strong>
              <span className="text-muted">Solde actuel: {selectedStudent.balance} DA</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Date de début</label>
              <Input type="date" value={printPayStart} onChange={(e) => setPrintPayStart(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Date de fin</label>
              <Input type="date" value={printPayEnd} onChange={(e) => setPrintPayEnd(e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsPrintPayOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handlePrintPayments} className="flex items-center gap-2">
              <Printer className="h-4 w-4" /> Générer & Imprimer
            </Button>
          </div>
        </div>
      </Modal>

      {/* Custom Print Invoice Confirmation Modal */}
      <Modal 
        open={printConfirmData !== null} 
        onClose={() => setPrintConfirmData(null)} 
        title="Bon de chargement de solde"
      >
        <div className="space-y-6 text-center py-4">
          <div className="mx-auto w-12 h-12 bg-primary-50 rounded-full flex items-center justify-center text-primary text-xl">
            🖨️
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-ink">Rechargement effectué avec succès !</h3>
            <p className="text-xs text-muted max-w-sm mx-auto leading-relaxed">
              Le solde de l'élève <strong>{printConfirmData?.student.firstName} {printConfirmData?.student.lastName}</strong> a été rechargé de <strong>{printConfirmData?.amount} DA</strong>. 
              Souhaitez-vous imprimer le bon de chargement (ticket 80&nbsp;mm) ?
            </p>
          </div>
          
          <div className="flex justify-center gap-3 pt-4 border-t border-line">
            <Button 
              variant="outline" 
              onClick={() => setPrintConfirmData(null)}
              className="px-5 py-2 rounded-xl text-xs font-bold"
            >
              Ignorer
            </Button>
            <Button 
              onClick={() => {
                if (printConfirmData) {
                  handlePrintInvoice(
                    printConfirmData.student, 
                    printConfirmData.amount, 
                    printConfirmData.description, 
                    printConfirmData.settledReg
                  );
                }
                setPrintConfirmData(null);
              }}
              className="px-5 py-2 rounded-xl text-xs font-bold"
            >
              Imprimer le bon
            </Button>
          </div>
        </div>
      </Modal>

      {/* Envoi WhatsApp (élève et/ou parent rattaché) */}
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
