"use client";

import { useState, useEffect } from "react";
import { useData, uid } from "@/lib/store/data";
import { createRoleUser, resetUserPassword } from "@/lib/supabase/createUser";
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
  MoreVertical,
  Search,
  CreditCard,
  Printer,
  DollarSign,
  User,
  BookOpen,
  History,
  CheckCircle,
  Scan,
  Bell,
  Send,
  AlertTriangle,
} from "lucide-react";
import type { Student, Subscription, SubscriptionDates, Coursework, BalanceTransaction } from "@/lib/types";
import { addMonths, daysUntil, formatDateFr, todayIso, EXPIRY_WARNING_DAYS } from "@/lib/helpers";
import { useSettings } from "@/lib/store/settings";
import { printHtmlDocument } from "@/lib/print";
import { buildStudentPaymentsReport } from "@/lib/reports/studentPayments";
import { speakMessage, speechCaseForScan } from "@/lib/speech";
import { useToast } from "@/lib/store/toast";

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
    parents,
    filieres,
    push,
    deleteFrom,
    updateItem,
    addBalance,
    payDebt,
    scanCard,
  } = useData();

  const { language, autoSendWhatsapp, autoSendEmail, setAutoSendWhatsapp, setAutoSendEmail } = useSettings();
  const { addToast } = useToast();

  // Search & Filtering
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "debt" | "paid" | "free" | "soon">("all");

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [isTopupOpen, setIsTopupOpen] = useState(false);
  const [isPayDebtOpen, setIsPayDebtOpen] = useState(false);
  const [isScanOpen, setIsScanOpen] = useState(false);
  const [isAlertLowBalanceOpen, setIsAlertLowBalanceOpen] = useState(false);
  const [selectedAlertStudentIds, setSelectedAlertStudentIds] = useState<string[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

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

  // Form: Topup
  const [topupAmount, setTopupAmount] = useState<number>(0);
  const [topupDesc, setTopupDesc] = useState("Recharge de solde");
  const [topupDate, setTopupDate] = useState(new Date().toISOString().split("T")[0]);
  const [settleReg, setSettleReg] = useState(false);

  // Form: Pay Debt
  const [payAmount, setPayAmount] = useState<number>(0);

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
  const [assignSearch, setAssignSearch] = useState("");
  const [selectedAssignIds, setSelectedAssignIds] = useState<string[]>([]); // subscription or coursework ids
  const [assignStartDates, setAssignStartDates] = useState<Record<string, string>>({}); // formation sub id -> start date

  // Active overlay actions index
  const [overlayStudentId, setOverlayStudentId] = useState<string | null>(null);

  // Scanner state
  const [scanRfidInput, setScanRfidInput] = useState("");
  const [scanResult, setScanResult] = useState<{
    ok: boolean;
    studentName?: string;
    cost?: number;
    newBalance?: number;
    msg?: string;
  } | null>(null);

  // Tab state in Details modal
  const [detailsTab, setDetailsTab] = useState<"personal" | "subs" | "payments" | "attendance">("personal");

  // Details modal filters — transactions per module; presences per module and
  // per date (by month or custom period)
  const [txModuleFilter, setTxModuleFilter] = useState<string>("all");
  const [attModuleFilter, setAttModuleFilter] = useState<string>("all");
  const [attDateMode, setAttDateMode] = useState<"all" | "month" | "range">("all");
  const [attMonth, setAttMonth] = useState("");
  const [attStart, setAttStart] = useState("");
  const [attEnd, setAttEnd] = useState("");

  // The selected student is a snapshot: re-sync it after every store refresh
  // (scan, topup, fetchAll) so the detail view never shows stale data.
  useEffect(() => {
    if (!selectedStudent) return;
    const fresh = students.find((s) => s.id === selectedStudent.id);
    if (fresh && fresh !== selectedStudent) setSelectedStudent(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students]);

  /** Modules assigned to a student (via his subscriptions), for the filters. */
  const getStudentModuleOptions = (stu: Student) => {
    const map = new Map<string, string>();
    stu.subscriptionIds.forEach((subId) => {
      const sub = subscriptions.find((s) => s.id === subId);
      const sess = sub ? sessions.find((se) => se.id === sub.sessionId) : undefined;
      if (!sess) return;
      const mod = modules.find((m) => m.id === sess.moduleId);
      if (mod) map.set(mod.id, mod.name);
    });
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  };

  // Helpers
  const getModuleLabel = (subId: string) => {
    const sub = subscriptions.find((s) => s.id === subId);
    if (!sub) {
      const cw = coursework.find((c) => c.id === subId);
      if (cw) return `Stage: ${cw.name}`;
      return "Abonnement inconnu";
    }
    const s = sessions.find((se) => se.id === sub.sessionId);
    if (!s) return "Séance inconnue";
    const mod = modules.find((m) => m.id === s.moduleId)?.name ?? "Module";
    const cls = classes.find((c) => c.id === s.classId);
    if (!cls) return mod;
    const level = cls.coursLevel || cls.formationLevel || "";
    const fil = filieres.find((f) => f.id === cls.filiereId)?.name ?? "";
    
    let classNameClean = cls.name || "";
    if (fil) {
      const regex = new RegExp(`\\s*-\\s*${fil}`, "i");
      classNameClean = classNameClean.replace(regex, "").trim();
    }
    
    const parts: string[] = [];
    if (classNameClean) parts.push(classNameClean);
    if (level) parts.push(level);
    if (fil) parts.push(fil);

    return `${mod} (${parts.join(" - ")})`;
  };

  const getSubLabel = (subId: string) => {
    const sub = subscriptions.find((s) => s.id === subId);
    if (!sub) {
      // Check if it's a coursework instead
      const cw = coursework.find((c) => c.id === subId);
      if (cw) return `Stage: ${cw.name}`;
      return "Abonnement inconnu";
    }
    const s = sessions.find((se) => se.id === sub.sessionId);
    if (!s) return "Séance inconnue";
    const mod = modules.find((m) => m.id === s.moduleId)?.name ?? "Module";
    const cls = classes.find((c) => c.id === s.classId)?.name ?? "Classe";
    return `${cls} - ${mod}`;
  };

  /** The subscription, if it belongs to a formation class (level-priced, time-limited). */
  const getFormationSub = (subId: string): Subscription | undefined => {
    const sub = subscriptions.find((s) => s.id === subId);
    if (!sub) return undefined;
    const sess = sessions.find((se) => se.id === sub.sessionId);
    const cls = sess ? classes.find((c) => c.id === sess.classId) : undefined;
    return cls?.type === "formation" || sub.periodMonths ? sub : undefined;
  };

  /** Expiry info for every formation enrollment of the student (dates only exist for formations). */
  const getFormationExpiries = (stu: Student) =>
    stu.subscriptionIds.flatMap((subId) => {
      const dates = stu.subscriptionDates?.[subId];
      if (!dates?.expiryDate) return [];
      return [
        {
          subId,
          label: getModuleLabel(subId),
          startDate: dates.startDate,
          expiryDate: dates.expiryDate,
          daysLeft: daysUntil(dates.expiryDate),
        },
      ];
    });

  // Auto-generate credentials when firstName, lastName, or birthDate changes in the creation modal
  useEffect(() => {
    if (isCreateOpen) {
      const cleanedFirst = firstName.trim().toLowerCase().replace(/\s+/g, "");
      const cleanedLast = lastName.trim().toLowerCase().replace(/\s+/g, "");
      const cleanedBirth = birthDate.replace(/-/g, "");

      if (cleanedFirst && cleanedLast && cleanedBirth) {
        if (!isEmailDirty) {
          setEmail(`${cleanedFirst}${cleanedLast}${cleanedBirth}@elilm.com`);
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

  const isSoonToRunOut = (student: Student) => {
    if (student.isFree) return false;
    const studentSubs = subscriptions.filter((sub) => student.subscriptionIds.includes(sub.id));
    const minCost = studentSubs.length > 0 ? Math.max(...studentSubs.map((s) => s.pricePerSession)) : 500;
    return student.balance >= 0 && student.balance < minCost * 2;
  };

  // Filter students based on queries
  const getFilteredStudents = () => {
    return students.filter((s) => {
      const nameMatch = `${s.firstName} ${s.lastName}`.toLowerCase().includes(searchQuery.toLowerCase());
      const phoneMatch = s.phone.includes(searchQuery);
      const emailMatch = s.email.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesSearch = nameMatch || phoneMatch || emailMatch;

      if (!matchesSearch) return false;

      if (filterType === "debt") return s.balance < 0 || (s.registrationDue && s.registrationDue > 0);
      if (filterType === "paid") return s.balance >= 0 && (!s.registrationDue || s.registrationDue === 0);
      if (filterType === "free") return s.isFree;
      if (filterType === "soon") return isSoonToRunOut(s);

      return true;
    });
  };

  const handleCreateStudent = async () => {
    if (!firstName || !lastName || !phone || !rfid) {
      alert("Prénom, nom, téléphone et carte RFID sont obligatoires.");
      return;
    }
    if (password.length < 6) {
      alert("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }

    const finalEmail = email || `${firstName.toLowerCase()}.${rfid.toLowerCase()}@elilm.com`;

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
        registrationDue: 0,
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
        registrationDue: 0,
      };
      push("students", newStudent);

      setIsCreateOpen(false);
      resetForm();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur lors de la création du compte.");
    }
  };

  const handleEditStudent = async () => {
    if (!selectedStudent) return;

    if (password) {
      try {
        await resetUserPassword(selectedStudent.id, password);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Erreur lors du changement de mot de passe.");
        return;
      }
    }

    updateItem("students", selectedStudent.id, {
      firstName,
      lastName,
      birthDate,
      phone,
      email,
      rfid,
      isFree,
    });
    setIsEditOpen(false);
    resetForm();
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

  const handlePayDebtSubmit = () => {
    if (!selectedStudent || payAmount <= 0) return;
    payDebt(selectedStudent.id, payAmount);
    setIsPayDebtOpen(false);
    setOverlayStudentId(null);
  };

  const handleSettleRegistrationCost = (student: Student) => {
    if (!student.registrationDue) return;
    if (confirm(`Régler les frais d'inscription de ${student.registrationDue} DA depuis le solde ?`)) {
      // Deduct from balance
      updateItem("students", student.id, {
        balance: student.balance - (student.registrationDue || 0),
        registrationDue: 0,
      });
      // Add balance transaction
      push("balanceTx", {
        id: uid("bt"),
        studentId: student.id,
        amount: -student.registrationDue,
        date: new Date().toISOString(),
        type: "registration",
        description: "Frais d'inscription réglés",
      });
    }
  };

  const handleScanCard = async () => {
    if (!scanRfidInput) return;
    const res = await scanCard(scanRfidInput);
    const matchedStu = students.find((s) => s.rfid === scanRfidInput || s.id === scanRfidInput);

    // Voice verdict (good / low / expired) once the check-in RPC answered.
    const speechCase = speechCaseForScan(res);
    if (speechCase) {
      speakMessage(speechCase, matchedStu ? `${matchedStu.firstName} ${matchedStu.lastName}` : "", language);
    }

    if (res.ok && matchedStu) {
      const seance = res.moduleName
        ? ` — ${res.moduleName}${res.sessionStart ? ` (${res.sessionStart} - ${res.sessionEnd})` : ""}`
        : "";
      setScanResult({
        ok: true,
        studentName: `${matchedStu.firstName} ${matchedStu.lastName}`,
        cost: res.cost,
        newBalance: res.newBalance,
        msg: res.messageKey === "scan.alreadyPresent"
          ? "Élève déjà marqué présent pour cette séance aujourd'hui (aucun débit)."
          : res.messageKey === "scan.successDebt"
          ? `Présence enregistrée${seance} — ATTENTION: le solde est passé en DETTE.`
          : res.messageKey === "scan.successLate"
          ? `Présence enregistrée (en retard)${seance}.`
          : `Présence validée et solde débité${seance} !`,
      });
    } else {
      const failureMsgs: Record<string, string> = {
        "scan.noSession": "Aucune séance programmée à cette heure.",
        "scan.noSessionToday": "Aucune séance de son niveau/module aujourd'hui.",
        "scan.noSessionNow": "Ce n'est pas l'heure de la séance de cet élève.",
        "scan.tooEarly": `Trop tôt — la séance n'a pas encore commencé.${res.nextStart ? ` Prochaine séance à ${res.nextStart}.` : ""}`,
        "scan.sessionEnded": "Séance déjà terminée — scan refusé, l'élève reste absent.",
        "scan.subscriptionExpired": "Abonnement expiré pour la séance d'aujourd'hui.",
        "scan.notEligible": "La séance en cours est d'un autre niveau ou d'un module non affecté à cet élève.",
        "scan.expired": "Solde épuisé — entrée refusée (aucune présence, aucune dette créée).",
        "scan.cooldown": "Déjà enregistré — passage ignoré (moins de 30 min depuis le dernier scan).",
        "scan.debtBlocked": "Élève EN DETTE — entrée refusée. Veuillez régler la dette.",
        "scan.notFound": "Carte introuvable.",
        "scan.error": "Erreur lors du scan — réessayez.",
      };
      setScanResult({
        ok: false,
        studentName: matchedStu ? `${matchedStu.firstName} ${matchedStu.lastName}` : "Étudiant inconnu",
        msg: failureMsgs[res.messageKey] ?? "Carte introuvable.",
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
    setPayAmount(0);
    setSelectedAssignIds([]);
    setAssignStartDates({});
    setAssignSearch("");
    setSelectedStudent(null);
    setIsEmailDirty(false);
    setIsPasswordDirty(false);
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
    setIsEditOpen(true);
    setOverlayStudentId(null);
  };

  const openDetails = (stu: Student) => {
    setSelectedStudent(stu);
    setDetailsTab("personal");
    setTxModuleFilter("all");
    setAttModuleFilter("all");
    setAttDateMode("all");
    setAttMonth("");
    setAttStart("");
    setAttEnd("");
    setIsDetailsOpen(true);
    setOverlayStudentId(null);
  };

  const openAssign = (stu: Student) => {
    setSelectedStudent(stu);
    setSelectedAssignIds(stu.subscriptionIds);
    const dates: Record<string, string> = {};
    for (const subId of stu.subscriptionIds) {
      const start = stu.subscriptionDates?.[subId]?.startDate;
      if (start) dates[subId] = start;
    }
    setAssignStartDates(dates);
    setIsAssignOpen(true);
    setOverlayStudentId(null);
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
    setSelectedStudent(stu);
    // Debt is either negative balance, or registrationDue, or both
    const debt = (stu.balance < 0 ? Math.abs(stu.balance) : 0) + (stu.registrationDue || 0);
    setPayAmount(debt);
    setIsPayDebtOpen(true);
    setOverlayStudentId(null);
  };

  const handleAssignSubmit = () => {
    if (!selectedStudent) return;

    // The one-time registration fee is charged once, on first enrollment
    // (paying students only). It is configured globally on the Abonnements page.
    const wasEnrolled = selectedStudent.subscriptionIds.length > 0;
    const willBeEnrolled = selectedAssignIds.length > 0;
    const chargeRegistration =
      !wasEnrolled && willBeEnrolled && !selectedStudent.isFree
        ? school?.registrationFee || 0
        : 0;

    // Formation enrollments: start date chosen by the user, expiry derived
    // from the formation's period.
    const subscriptionDates: Record<string, SubscriptionDates> = {};
    for (const subId of selectedAssignIds) {
      const formationSub = getFormationSub(subId);
      if (!formationSub) continue;
      const startDate = assignStartDates[subId] || todayIso();
      subscriptionDates[subId] = {
        startDate,
        expiryDate: addMonths(startDate, formationSub.periodMonths ?? 0),
      };
    }

    updateItem("students", selectedStudent.id, {
      subscriptionIds: selectedAssignIds,
      subscriptionDates,
      registrationDue: (selectedStudent.registrationDue || 0) + chargeRegistration,
    });

    setIsAssignOpen(false);
    resetForm();
  };

  // Get assignable items (subscriptions + coursework) matching search
  const getAssignableItems = () => {
    const list: {
      id: string;
      label: string;
      details: string;
      price: number;
      isCoursework: boolean;
      isFormation?: boolean;
      periodMonths?: number;
    }[] = [];

    subscriptions.forEach((sub) => {
      const s = sessions.find((se) => se.id === sub.sessionId);
      if (!s) return;
      const cls = classes.find((c) => c.id === s.classId);
      const mod = modules.find((m) => m.id === s.moduleId);
      const t = teachers.find((te) => te.id === s.teacherId);
      const gr = groups.find((g) => g.id === s.groupId);
      const sa = salles.find((sl) => sl.id === s.salleId);

      const label = `${mod?.name} ${cls?.name} ${t?.firstName} ${t?.lastName}`.toLowerCase();
      if (assignSearch && !label.includes(assignSearch.toLowerCase())) return;

      const isFormation = cls?.type === "formation";
      list.push({
        id: sub.id,
        label: `${mod?.name} (${cls?.name})`,
        details: `Ens: ${t?.firstName} ${t?.lastName} | Gr: ${gr?.name} | Salle: ${sa?.name}`,
        price: isFormation ? sub.levelPrice ?? 0 : sub.pricePerSession,
        isCoursework: false,
        isFormation,
        periodMonths: sub.periodMonths,
      });
    });

    coursework.forEach((cw) => {
      const t = teachers.find((te) => te.id === cw.teacherId);
      const label = `${cw.name} ${t?.firstName} ${t?.lastName}`.toLowerCase();
      if (assignSearch && !label.includes(assignSearch.toLowerCase())) return;

      list.push({
        id: cw.id,
        label: `Stage: ${cw.name}`,
        details: `Enseignant: ${t ? `${t.firstName} ${t.lastName}` : "-"} | ${cw.dates.length} séances`,
        price: cw.total,
        isCoursework: true,
      });
    });

    return list;
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
                  ${studentAttendance.length === 0
                    ? `<tr><td colspan="4" style="text-align:center; font-style:italic; color:#999;">Aucune présence scannée.</td></tr>`
                    : studentAttendance.slice(-8).reverse().map(a => {
                        const sess = sessions.find(s => s.id === a.sessionId);
                        const mod = sess ? modules.find(m => m.id === sess.moduleId)?.name : "";
                        const cls = sess ? classes.find(c => c.id === sess.classId)?.name : "";
                        
                        return `
                          <tr>
                            <td>${formatDateTime(a.timestamp)}</td>
                            <td style="font-weight:bold;">${mod} <span style="font-size:0.85em; font-weight:normal; color:#888;">(${cls})</span></td>
                            <td style="text-align:center;">
                              <span class="badge ${a.status === "present" ? "badge-success" : "badge-warning"}">
                                ${a.status === "present" ? "Présent" : "En Retard"}
                              </span>
                            </td>
                            <td style="text-align:right; font-weight:bold; color:#b91c1c;">-${a.amountDeducted} DA</td>
                          </tr>
                        `;
                      }).join("")
                  }
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
                    : studentTx.slice(-10).reverse().map(tx => `
                        <tr>
                          <td>${formatDate(tx.date)}</td>
                          <td>${tx.description}</td>
                          <td>
                            <span class="badge ${tx.type === "topup" ? "badge-success" : "badge-primary"}">
                              ${tx.type === "topup" ? "Rechargement" : "Dépense / Séance"}
                            </span>
                          </td>
                          <td style="text-align:right; font-weight:bold; color:${tx.amount >= 0 ? "#15803d" : "#b91c1c"};">
                            ${tx.amount >= 0 ? "+" : ""}${tx.amount} DA
                          </td>
                        </tr>
                      `).join("")
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

  const handlePrintInvoice = (stu: Student, amount: number, desc: string, settledReg: boolean) => {
    // Get fresh values from useData store
    const updatedStudents = useData.getState().students;
    const updatedStu = updatedStudents.find(s => s.id === stu.id) || stu;

    const invoiceNum = `REC-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    const logoHtml = school.logo
      ? `<img src="${school.logo}" alt="logo" class="school-logo" />`
      : `<div class="school-logo-fallback">🏫</div>`;

    const html = `
      <html>
        <head>
          <title>Reçu de Paiement - ${invoiceNum}</title>
          <style>
            @media print {
              body { padding: 0; margin: 0; background: #fff; color: #000; font-size: 11px; }
              .no-print { display: none; }
            }
            * { box-sizing: border-box; }
            body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 20px; color: #1e1b4b; background-color: #faf9ff; max-width: 600px; margin: 0 auto; }
            
            /* Letterhead Header */
            .letterhead { display: flex; justify-content: space-between; align-items: stretch; border: 1px solid #e8e6f4; background: #fff; padding: 12px; border-radius: 12px; margin-bottom: 15px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
            .school-identity { display: flex; align-items: center; gap: 12px; }
            .school-logo, .school-logo-fallback { width: 50px; height: 50px; border-radius: 10px; object-fit: cover; }
            .school-logo-fallback { background: #f5f3ff; border: 1px solid #ddd; display: flex; align-items: center; justify-content: center; font-size: 1.8em; }
            .school-details h2 { margin: 0; font-size: 1.2em; color: #7c3aed; font-weight: 800; }
            .school-details p { margin: 1px 0; font-size: 0.8em; color: #5c567a; }
            
            .school-tax-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 8px; border-left: 2px solid #7c3aed; padding-left: 12px; align-items: center; }
            .tax-item { font-size: 0.72em; color: #5c567a; }
            .tax-item strong { color: #1e1b4b; font-family: monospace; }
            
            /* Document title banner */
            .doc-title-banner { background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: #fff; padding: 10px; border-radius: 10px; margin-bottom: 15px; text-align: center; }
            .doc-title-banner h1 { margin: 0; font-size: 1.15em; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }

            /* Compact Side-by-Side Information Grid */
            .info-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 15px;
              border: 1px solid #e8e6f4;
              border-top: 4px solid #7c3aed;
              background: #fff;
              padding: 12px;
              border-radius: 12px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.02);
              margin-bottom: 15px;
            }
            .info-column {
              display: flex;
              flex-direction: column;
              gap: 6px;
            }
            .info-item {
              display: flex;
              justify-content: space-between;
              border-bottom: 1px dashed #f1f0fb;
              padding-bottom: 4px;
              font-size: 0.85em;
            }
            .info-item:last-child {
              border-bottom: 0;
              padding-bottom: 0;
            }
            .info-label {
              font-weight: bold;
              color: #5c567a;
            }
            .info-value {
              font-weight: bold;
              color: #1e1b4b;
              text-align: right;
            }
            
            /* Payment Synthesis Card */
            .synthesis-card { background: #fdfcff; border: 2px solid #7c3aed; border-radius: 12px; padding: 14px; margin-top: 15px; }
            .synthesis-line { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f1f0fb; font-size: 0.9em; }
            .synthesis-line:last-child { border-bottom: 0; padding-bottom: 0; }
            .amount-box { display: flex; justify-content: space-between; background: #f0fdf4; border: 2px solid #22c55e; color: #15803d; border-radius: 8px; padding: 10px; margin-top: 8px; font-size: 1.15em; font-weight: 800; }
            
            /* Signatures block */
            .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 25px; }
            .signature-block { border: 1px dashed #c0b6e9; border-radius: 10px; background: #fff; padding: 10px; height: 75px; display: flex; flex-direction: column; justify-content: space-between; }
            .signature-label { font-size: 0.75em; font-weight: bold; text-transform: uppercase; color: #5c567a; text-align: center; }
            
            .meta-text { text-align: center; font-size: 0.7em; color: #999; margin-top: 20px; font-style: italic; }
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
            <h1>Reçu de Versement</h1>
          </div>

          <!-- Compact Information Grid (Left & Right columns) -->
          <div class="info-grid">
            <!-- Left Column -->
            <div class="info-column">
              <div class="info-item">
                <span class="info-label">Élève :</span>
                <span class="info-value" style="color: #7c3aed;">${stu.lastName} ${stu.firstName}</span>
              </div>
              <div class="info-item">
                <span class="info-label">RFID :</span>
                <span class="info-value" style="font-family: monospace;">${stu.rfid || "-"}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Date :</span>
                <span class="info-value">${new Date().toLocaleString("fr-DZ")}</span>
              </div>
            </div>
            
            <!-- Right Column -->
            <div class="info-column">
              <div class="info-item">
                <span class="info-label">Reçu N° :</span>
                <span class="info-value" style="font-family: monospace; color: #7c3aed;">${invoiceNum}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Opération :</span>
                <span class="info-value">${settledReg ? "Rechargement + Inscr." : "Rechargement Solde"}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Désignation :</span>
                <span class="info-value">${desc}</span>
              </div>
            </div>
          </div>

          <!-- Payment Synthesis Card -->
          <div class="synthesis-card">
            <h3 style="margin-top:0; border-bottom:1px dashed #7c3aed; padding-bottom:6px; color:#7c3aed; font-size: 0.95em;">Situation Financière du Compte</h3>
            <div class="synthesis-line">
              <span>Ancien Solde :</span>
              <strong>${stu.balance} DA</strong>
            </div>
            <div class="synthesis-line">
              <span>Montant Versé :</span>
              <strong style="color: #15803d;">+${amount} DA</strong>
            </div>
            ${settledReg 
              ? `
                <div class="synthesis-line" style="color: #b91c1c;">
                  <span>Frais d'inscription déduits :</span>
                  <strong>-${school.registrationFee || 0} DA</strong>
                </div>
              ` 
              : ""
            }
            <div class="synthesis-line">
              <span>Nouveau Solde Disponible :</span>
              <strong style="color: #1e1b4b;">${updatedStu.balance} DA</strong>
            </div>
            
            <div class="amount-box">
              <span>MONTANT REÇU :</span>
              <span>${amount} DA</span>
            </div>
          </div>

          <!-- Signature blocks -->
          <div class="signatures">
            <div class="signature-block">
              <span class="signature-label">Le Parent / Élève</span>
            </div>
            <div class="signature-block">
              <span class="signature-label">La Caisse / Direction</span>
            </div>
          </div>

          <div class="meta-text">
            Reçu généré par le système centralisé de l'école ${school.name}
          </div>
        </body>
      </html>
    `;
    printHtmlDocument(html);
  };

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <PageHeader emoji="🎓" title="Étudiants" subtitle="Gérer les inscriptions et abonnements des élèves" />

        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              const lowStus = students.filter(isSoonToRunOut);
              setSelectedAlertStudentIds(lowStus.map((s) => s.id));
              setIsAlertLowBalanceOpen(true);
            }}
            variant="outline"
            className="flex items-center gap-2 border-danger/30 hover:border-danger hover:bg-danger/10 text-danger relative"
          >
            <Bell className="h-4 w-4 text-danger" /> Alertes Soldes
            {students.filter(isSoonToRunOut).length > 0 && (
              <span className="absolute -top-1 -right-1 bg-danger text-white text-[9px] font-bold h-4.5 w-4.5 rounded-full flex items-center justify-center pulse-glow">
                {students.filter(isSoonToRunOut).length}
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

      {/* Filter panel */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6 bg-surface border border-line p-3 rounded-2xl">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher par nom, téléphone ou email..."
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
        const alerts = students
          .flatMap((stu) =>
            getFormationExpiries(stu)
              .filter((f) => f.daysLeft <= EXPIRY_WARNING_DAYS)
              .map((f) => ({ stu, ...f })),
          )
          .sort((a, b) => a.daysLeft - b.daysLeft);
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

      {/* Students list */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {getFilteredStudents().map((stu) => {
          const isOverlaid = overlayStudentId === stu.id;
          const debt = stu.balance < 0 ? Math.abs(stu.balance) : 0;

          return (
            <Card key={stu.id} className="relative overflow-visible">
              <CardBody className="flex flex-col justify-between h-56 relative">
                {/* Overlay Action Buttons displayed ABOVE the card when three dots are clicked */}
                {isOverlaid && (
                  <div className="absolute inset-0 bg-primary-600/95 backdrop-blur-sm rounded-2xl z-20 flex flex-col justify-center p-4 text-white space-y-2">
                    <div className="flex justify-between items-center border-b border-white/20 pb-2 mb-1">
                      <span className="font-bold text-sm truncate">{stu.firstName} {stu.lastName}</span>
                      <button onClick={() => setOverlayStudentId(null)} className="text-xs hover:underline bg-white/10 px-2 py-0.5 rounded">
                        Fermer
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <button
                        onClick={() => openDetails(stu)}
                        className="flex items-center gap-1.5 justify-center bg-white/10 hover:bg-white/20 py-2 rounded-xl"
                      >
                        <Eye className="h-3.5 w-3.5" /> Voir Détails
                      </button>
                      <button
                        onClick={() => openAssign(stu)}
                        className="flex items-center gap-1.5 justify-center bg-white/10 hover:bg-white/20 py-2 rounded-xl"
                      >
                        <BookOpen className="h-3.5 w-3.5" /> Inscriptions
                      </button>
                      <button
                        onClick={() => openTopup(stu)}
                        className="flex items-center gap-1.5 justify-center bg-white/10 hover:bg-white/20 py-2 rounded-xl"
                      >
                        <DollarSign className="h-3.5 w-3.5" /> Charger Solde
                      </button>
                      <button
                        onClick={() => openPayDebt(stu)}
                        className="flex items-center gap-1.5 justify-center bg-white/10 hover:bg-white/20 py-2 rounded-xl"
                      >
                        <DollarSign className="h-3.5 w-3.5" /> Régler Dette
                      </button>
                      <button
                        onClick={() => handlePrintStudent(stu)}
                        className="flex items-center gap-1.5 justify-center bg-white/10 hover:bg-white/20 py-2 rounded-xl"
                      >
                        <Printer className="h-3.5 w-3.5" /> Imprimer Fiche
                      </button>
                      <button
                        onClick={() => openEdit(stu)}
                        className="flex items-center gap-1.5 justify-center bg-white/10 hover:bg-white/20 py-2 rounded-xl"
                      >
                        <Edit className="h-3.5 w-3.5" /> Modifier
                      </button>
                      <button
                        onClick={() => openPrintPayments(stu)}
                        className="flex items-center gap-1.5 justify-center bg-white/10 hover:bg-white/20 py-2 rounded-xl col-span-2"
                      >
                        <Printer className="h-3.5 w-3.5" /> Imprimer Paiements (Période)
                      </button>
                    </div>
                    <button
                      onClick={() => handleDelete(stu.id)}
                      className="flex items-center gap-1.5 justify-center bg-danger hover:bg-danger/80 py-2 rounded-xl text-xs w-full font-bold"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Supprimer l'élève
                    </button>
                  </div>
                )}

                <div>
                  <div className="flex items-start justify-between">
                    <button
                      type="button"
                      onClick={() => openDetails(stu)}
                      title="Voir la fiche de l'élève"
                      className="flex items-center gap-2 text-start rounded-xl hover:bg-primary-50/60 transition-colors p-0.5 -m-0.5"
                    >
                      <div className="h-10 w-10 bg-primary/10 rounded-xl flex items-center justify-center font-bold text-primary text-sm">
                        {stu.firstName.substring(0, 1)}{stu.lastName.substring(0, 1)}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-ink hover:text-primary transition-colors">
                          {stu.firstName} {stu.lastName}
                        </h4>
                        <span className="text-[10px] text-muted block flex items-center gap-1">
                          <CreditCard className="h-3 w-3 inline" /> {stu.rfid}
                        </span>
                      </div>
                    </button>

                    <button
                      onClick={() => setOverlayStudentId(stu.id)}
                      className="p-1 rounded-lg hover:bg-primary-50 text-muted hover:text-ink transition-colors"
                    >
                      <MoreVertical className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="mt-3 space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted">Téléphone:</span>
                      <strong className="text-ink">{stu.phone}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Solde Actuel:</span>
                      <strong className={stu.balance < 0 ? "text-danger" : "text-success"}>
                        {stu.balance} DA
                      </strong>
                    </div>

                    {stu.registrationDue && stu.registrationDue > 0 ? (
                      <div className="flex justify-between items-center bg-danger/10 p-1.5 rounded-lg">
                        <span className="text-danger text-[10px] font-bold">Frais d'inscription dus: {stu.registrationDue} DA</span>
                        <button
                          onClick={() => handleSettleRegistrationCost(stu)}
                          className="text-[9px] bg-danger text-white px-2 py-0.5 rounded font-bold hover:bg-danger/80"
                        >
                          Régler
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-between text-[10px] text-success bg-success/15 px-2 py-0.5 rounded">
                        <span>Frais d'inscription</span>
                        <strong>Payé ✔</strong>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-line pt-2 mt-2">
                  <span className="text-[10px] text-muted block mb-1">Modules/Abonnements:</span>
                  {stu.subscriptionIds.length === 0 ? (
                    <span className="text-[10px] text-muted italic">Non inscrit</span>
                  ) : (
                    <div className="flex flex-wrap gap-1 max-h-12 overflow-y-auto">
                      {stu.subscriptionIds.map((id) => {
                        const exp = stu.subscriptionDates?.[id]?.expiryDate;
                        const days = exp ? daysUntil(exp) : null;
                        const tone =
                          days === null
                            ? "neutral"
                            : days < 0
                              ? "danger"
                              : days <= EXPIRY_WARNING_DAYS
                                ? "warning"
                                : "neutral";
                        return (
                          <Badge key={id} tone={tone} className="text-[9px] px-1 py-0.5 whitespace-normal">
                            {getModuleLabel(id)}
                            {days !== null && days < 0 && " · Expirée"}
                            {days !== null && days >= 0 && days <= EXPIRY_WARNING_DAYS && ` · J-${days}`}
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

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

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleCreateStudent}>Créer</Button>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Modifier l'étudiant">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Prénom</label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Nom</label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date de naissance</label>
            <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Téléphone</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">RFID</label>
            <Input value={rfid} onChange={(e) => setRfid(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Email</label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Nouveau mot de passe</label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Laisser vide pour ne pas changer" />
          </div>
          <div className="flex items-center justify-between p-3 bg-canvas border border-line rounded-xl">
            <span className="text-xs font-bold text-ink">Cas Spécial (Études gratuites)</span>
            <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} className="h-5 w-5" />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleEditStudent}>Enregistrer</Button>
          </div>
        </div>
      </Modal>

      {/* Details Modal with subdivisions */}
      <Modal open={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Fiche Étudiant" wide>
        {selectedStudent && (
          <div className="space-y-6">
            {/* Header brief info */}
            <div className="bg-primary-50/50 p-4 border border-line rounded-xl flex items-center justify-between">
              <div>
                <h3 className="font-bold text-lg text-ink">{selectedStudent.firstName} {selectedStudent.lastName}</h3>
                <span className="text-xs text-muted">ID: {selectedStudent.id} | Carte: {selectedStudent.rfid}</span>
              </div>
              <Badge tone={selectedStudent.balance < 0 ? "danger" : selectedStudent.isFree ? "success" : "primary"} className="text-sm px-3 py-1">
                {selectedStudent.isFree ? "Études gratuites" : `${selectedStudent.balance} DA`}
              </Badge>
            </div>

            {/* Navigation Tabs inside details modal */}
            <div className="flex border-b border-line gap-2">
              <button
                onClick={() => setDetailsTab("personal")}
                className={`pb-2.5 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                  detailsTab === "personal" ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                <User className="h-4 w-4" /> Personnel
              </button>
              <button
                onClick={() => setDetailsTab("subs")}
                className={`pb-2.5 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                  detailsTab === "subs" ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                <BookOpen className="h-4 w-4" /> Abonnements ({selectedStudent.subscriptionIds.length})
              </button>
              <button
                onClick={() => setDetailsTab("payments")}
                className={`pb-2.5 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                  detailsTab === "payments" ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                <History className="h-4 w-4" /> Transactions ({balanceTx.filter((t) => t.studentId === selectedStudent.id).length})
              </button>
              <button
                onClick={() => setDetailsTab("attendance")}
                className={`pb-2.5 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                  detailsTab === "attendance" ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                <CheckCircle className="h-4 w-4" /> Présences ({attendance.filter((t) => t.studentId === selectedStudent.id).length})
              </button>
            </div>

            {/* Tab Contents */}
            <div className="min-h-[220px]">
              {detailsTab === "personal" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-muted block font-semibold mb-0.5">Date de naissance:</span>
                    <span className="text-ink font-bold">{selectedStudent.birthDate || "-"}</span>
                  </div>
                  <div>
                    <span className="text-muted block font-semibold mb-0.5">Téléphone:</span>
                    <span className="text-ink font-bold">{selectedStudent.phone}</span>
                  </div>
                  <div>
                    <span className="text-muted block font-semibold mb-0.5">Email de connexion:</span>
                    <span className="text-ink font-bold">{selectedStudent.email}</span>
                  </div>
                  <div>
                    <span className="text-muted block font-semibold mb-0.5">Mot de passe de connexion:</span>
                    <span className="text-ink font-bold text-xs italic text-muted">
                      Non affiché — utilisez « Modifier » pour définir un nouveau mot de passe.
                    </span>
                  </div>
                  <div>
                    <span className="text-muted block font-semibold mb-0.5">Tuteur affecté:</span>
                    <span className="text-ink font-bold">
                      {parents.find((p) => p.id === selectedStudent.parentId)
                        ? `${parents.find((p) => p.id === selectedStudent.parentId)?.firstName} ${
                            parents.find((p) => p.id === selectedStudent.parentId)?.lastName
                          } (${parents.find((p) => p.id === selectedStudent.parentId)?.phone})`
                        : "Aucun tuteur assigné"}
                    </span>
                  </div>
                </div>
              )}

              {detailsTab === "subs" && (
                <div className="space-y-2">
                  {selectedStudent.subscriptionIds.length === 0 ? (
                    <p className="text-xs text-muted italic">Non inscrit à des cours ou stages.</p>
                  ) : (
                    selectedStudent.subscriptionIds.map((subId) => {
                      const sub = subscriptions.find((s) => s.id === subId);
                      const isCw = !sub; // If not in subscriptions, check coursework
                      const cw = coursework.find((c) => c.id === subId);
                      const formationSub = isCw ? undefined : getFormationSub(subId);
                      const dates = selectedStudent.subscriptionDates?.[subId];
                      const days = dates?.expiryDate ? daysUntil(dates.expiryDate) : null;
                      return (
                        <div key={subId} className="flex justify-between items-center text-xs bg-canvas border border-line p-3 rounded-xl">
                          <div>
                            <strong className="text-ink block">{getSubLabel(subId)}</strong>
                            <span className="text-[10px] text-muted">
                              {isCw
                                ? "Stage Intensif"
                                : formationSub
                                  ? `Formation · Prix du niveau: ${formationSub.levelPrice ?? 0} DA · ${formationSub.periodMonths ?? 0} mois`
                                  : `Tarif: ${sub?.pricePerSession} DA / séance`}
                            </span>
                            {formationSub && dates?.expiryDate && days !== null && (
                              <span className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted">
                                Du {formatDateFr(dates.startDate)} au {formatDateFr(dates.expiryDate)}
                                <Badge
                                  tone={days < 0 ? "danger" : days <= EXPIRY_WARNING_DAYS ? "warning" : "success"}
                                  className="text-[9px] px-1.5 py-0"
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
                                updateItem("students", selectedStudent.id, {
                                  subscriptionIds: selectedStudent.subscriptionIds.filter((id) => id !== subId),
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

              {detailsTab === "payments" && (() => {
                const moduleOptions = getStudentModuleOptions(selectedStudent);
                const filterModuleName =
                  txModuleFilter === "all" ? "" : modules.find((m) => m.id === txModuleFilter)?.name ?? "";
                const txList = balanceTx.filter((t) => {
                  if (t.studentId !== selectedStudent.id) return false;
                  if (txModuleFilter === "all") return true;
                  // Rows older than balance_tx.module_id are matched by the
                  // module name embedded in their description.
                  if (t.moduleId) return t.moduleId === txModuleFilter;
                  return !!filterModuleName && t.description.toLowerCase().includes(filterModuleName.toLowerCase());
                });
                return (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2 bg-canvas/40 border border-line rounded-xl p-2">
                      <label className="text-[10px] font-bold text-muted uppercase shrink-0">Module :</label>
                      <Select value={txModuleFilter} onChange={(e) => setTxModuleFilter(e.target.value)} className="w-52">
                        <option value="all">Tous les modules</option>
                        {moduleOptions.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </Select>
                      <span className="text-[10px] text-muted ms-auto font-mono">{txList.length} transaction(s)</span>
                    </div>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {txList.length === 0 ? (
                        <p className="text-xs text-muted italic">Aucune transaction pour ce filtre.</p>
                      ) : (
                        [...txList].reverse().map((tx) => (
                          <div key={tx.id} className="flex justify-between items-center text-xs bg-canvas border border-line p-3 rounded-xl">
                            <div>
                              <strong className="text-ink block">{tx.description}</strong>
                              <span className="text-[10px] text-muted">{tx.date.substring(0, 16).replace("T", " ")}</span>
                            </div>
                            <strong className={tx.amount > 0 ? "text-success font-bold" : "text-danger font-bold"}>
                              {tx.amount > 0 ? `+${tx.amount}` : tx.amount} DA
                            </strong>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })()}

              {detailsTab === "attendance" && (() => {
                const moduleOptions = getStudentModuleOptions(selectedStudent);
                const attList = attendance.filter((att) => {
                  if (att.studentId !== selectedStudent.id) return false;
                  if (attModuleFilter !== "all") {
                    const sess = sessions.find((se) => se.id === att.sessionId);
                    if (!sess || sess.moduleId !== attModuleFilter) return false;
                  }
                  const when = new Date(att.timestamp);
                  if (attDateMode === "month" && attMonth) {
                    const key = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}`;
                    if (key !== attMonth) return false;
                  }
                  if (attDateMode === "range") {
                    if (attStart && when < new Date(`${attStart}T00:00:00`)) return false;
                    if (attEnd && when > new Date(`${attEnd}T23:59:59.999`)) return false;
                  }
                  return true;
                });
                return (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2 bg-canvas/40 border border-line rounded-xl p-2">
                      <label className="text-[10px] font-bold text-muted uppercase shrink-0">Module :</label>
                      <Select value={attModuleFilter} onChange={(e) => setAttModuleFilter(e.target.value)} className="w-44">
                        <option value="all">Tous les modules</option>
                        {moduleOptions.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </Select>

                      <label className="text-[10px] font-bold text-muted uppercase shrink-0 ms-2">Date :</label>
                      <div className="flex gap-1">
                        {([
                          ["all", "Tout"],
                          ["month", "Par mois"],
                          ["range", "Période"],
                        ] as const).map(([mode, label]) => (
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
                        <Input
                          type="month"
                          value={attMonth}
                          onChange={(e) => setAttMonth(e.target.value)}
                          className="w-40"
                        />
                      )}
                      {attDateMode === "range" && (
                        <div className="flex items-center gap-1.5">
                          <Input type="date" value={attStart} onChange={(e) => setAttStart(e.target.value)} className="w-36" />
                          <span className="text-[10px] text-muted">→</span>
                          <Input type="date" value={attEnd} onChange={(e) => setAttEnd(e.target.value)} className="w-36" />
                        </div>
                      )}

                      <span className="text-[10px] text-muted ms-auto font-mono">{attList.length} présence(s)</span>
                    </div>

                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {attList.length === 0 ? (
                        <p className="text-xs text-muted italic">Aucune présence pour ces filtres.</p>
                      ) : (
                        [...attList].reverse().map((att) => {
                          const s = sessions.find((se) => se.id === att.sessionId);
                          const modName = s ? modules.find((m) => m.id === s.moduleId)?.name : "Module";
                          const grpName = s ? groups.find((g) => g.id === s.groupId)?.name : undefined;
                          return (
                            <div key={att.id} className="flex justify-between items-center text-xs bg-canvas border border-line p-3 rounded-xl">
                              <div>
                                <strong className="text-ink block">
                                  Présence: {modName}
                                  {grpName ? <span className="text-muted font-semibold"> — {grpName}</span> : null}
                                </strong>
                                <span className="text-[10px] text-muted">{att.timestamp.substring(0, 16).replace("T", " ")}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge tone={att.status === "present" ? "success" : att.status === "late" ? "warning" : "danger"}>
                                  {att.status === "present" ? "Présent" : att.status === "late" ? "En retard" : "Absent"}
                                </Badge>
                                <span className="font-bold text-danger text-[10px]">-{att.amountDeducted} DA</span>
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

            <div className="flex justify-end pt-2 border-t border-line">
              <Button onClick={() => setIsDetailsOpen(false)}>Fermer</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Assign Subscriptions Modal */}
      <Modal open={isAssignOpen} onClose={() => setIsAssignOpen(false)} title="Affecter des abonnements / cours" wide>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Rechercher des abonnements ou stages</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
              <Input
                value={assignSearch}
                onChange={(e) => setAssignSearch(e.target.value)}
                placeholder="Rechercher par module, enseignant..."
                className="pl-9"
              />
            </div>
          </div>

          <div className="border border-line rounded-xl max-h-72 overflow-y-auto p-2 bg-canvas/30 space-y-1">
            {getAssignableItems().map((item) => {
              const isChecked = selectedAssignIds.includes(item.id);
              const startDate = assignStartDates[item.id] || todayIso();
              const expiryDate = item.isFormation ? addMonths(startDate, item.periodMonths ?? 0) : "";
              return (
                <div key={item.id}>
                  <button
                    onClick={() => {
                      if (isChecked) {
                        setSelectedAssignIds(selectedAssignIds.filter((id) => id !== item.id));
                      } else {
                        setSelectedAssignIds([...selectedAssignIds, item.id]);
                        if (item.isFormation && !assignStartDates[item.id]) {
                          setAssignStartDates({ ...assignStartDates, [item.id]: todayIso() });
                        }
                      }
                    }}
                    className={`w-full text-start p-2.5 rounded-xl text-xs transition-colors flex justify-between items-center ${
                      isChecked ? "bg-primary-50 border border-primary/20 text-ink" : "hover:bg-primary-50 text-ink border border-transparent"
                    }`}
                  >
                    <div>
                      <strong className="block font-bold text-ink">
                        {item.label}
                        {item.isFormation && (
                          <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                            Formation
                          </span>
                        )}
                      </strong>
                      <span className="text-muted block text-[10px]">{item.details}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-primary font-bold">
                        {item.price} DA
                        {item.isFormation && (
                          <span className="text-muted font-semibold"> / {item.periodMonths} mois</span>
                        )}
                      </span>
                      <input type="checkbox" checked={isChecked} readOnly className="h-4 w-4 text-primary" />
                    </div>
                  </button>

                  {/* Formation: pick the start date, expiry is derived from the period */}
                  {isChecked && item.isFormation && (
                    <div className="mt-1 mb-2 ml-4 mr-1 p-2.5 rounded-xl bg-surface border border-line flex flex-wrap items-end gap-4">
                      <div>
                        <label className="block text-[10px] font-semibold text-muted mb-1">Date de début *</label>
                        <Input
                          type="date"
                          value={startDate}
                          onChange={(e) =>
                            setAssignStartDates({ ...assignStartDates, [item.id]: e.target.value })
                          }
                          className="w-40"
                        />
                      </div>
                      <div className="pb-1.5 text-xs">
                        <span className="block text-[10px] font-semibold text-muted mb-1">
                          Date d&apos;expiration (calculée)
                        </span>
                        <strong className="text-primary">{formatDateFr(expiryDate)}</strong>
                        <span className="text-muted"> · {item.periodMonths} mois</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsAssignOpen(false)}>
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
              <span className="text-muted">Solde actuel: {selectedStudent.balance} DA</span>
            </div>
          )}

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

          {selectedStudent && selectedStudent.registrationDue && selectedStudent.registrationDue > 0 ? (
            <div className="bg-warning/10 border border-warning/20 p-3 rounded-xl flex items-center justify-between text-xs">
              <div>
                <strong className="text-warning block">Régler frais d'inscription ?</strong>
                <span className="text-[10px] text-muted">L'étudiant doit payer {selectedStudent.registrationDue} DA de frais.</span>
              </div>
              <input
                type="checkbox"
                checked={settleReg}
                onChange={(e) => setSettleReg(e.target.checked)}
                className="h-5 w-5 text-warning focus:ring-warning"
              />
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

      {/* Pay Debt (Régler dette) Modal */}
      <Modal open={isPayDebtOpen} onClose={() => setIsPayDebtOpen(false)} title="Paiement de Dette">
        <div className="space-y-4">
          {selectedStudent && (
            <div className="bg-canvas border border-line p-3 rounded-xl text-xs space-y-1">
              <div>
                <span className="text-muted block text-[10px] uppercase">Étudiant</span>
                <strong className="text-ink">{selectedStudent.firstName} {selectedStudent.lastName}</strong>
              </div>
              <div className="flex justify-between border-t border-line/50 pt-1.5 mt-1">
                <span className="text-muted">Solde:</span>
                <strong className={selectedStudent.balance < 0 ? "text-danger" : "text-success"}>
                  {selectedStudent.balance} DA
                </strong>
              </div>
              {selectedStudent.registrationDue ? (
                <div className="flex justify-between">
                  <span className="text-muted">Frais inscription:</span>
                  <strong className="text-danger">{selectedStudent.registrationDue} DA</strong>
                </div>
              ) : null}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Montant remboursé (DA) *</label>
            <Input
              type="number"
              value={payAmount || ""}
              onChange={(e) => setPayAmount(Number(e.target.value))}
              placeholder="Ex: 1000"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsPayDebtOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handlePayDebtSubmit}>Enregistrer le paiement</Button>
          </div>
        </div>
      </Modal>

      {/* Card scanner Modal */}
      <Modal open={isScanOpen} onClose={() => { setIsScanOpen(false); setScanResult(null); }} title="Scanner de carte RFID">
        <div className="space-y-4">
          <p className="text-xs text-muted">
            Scannez une carte RFID à l'aide d'un lecteur physique ou saisissez manuellement le code de la carte pour simuler.
          </p>

          <div className="flex gap-2">
            <Input
              value={scanRfidInput}
              onChange={(e) => setScanRfidInput(e.target.value)}
              placeholder="RFID-XXXX"
              className="flex-1 font-mono uppercase"
              onKeyDown={(e) => e.key === "Enter" && handleScanCard()}
              autoFocus
            />
            <Button onClick={handleScanCard}>Valider</Button>
          </div>

          {scanResult && (
            <div className={`p-4 rounded-xl border ${scanResult.ok ? "bg-success/10 border-success/30 text-success" : "bg-danger/10 border-danger/30 text-danger"} space-y-2 text-xs`}>
              <h4 className="font-bold flex items-center gap-1.5">
                {scanResult.ok ? "✔ Succès" : "❌ Échec"}
              </h4>
              <p><strong>Élève:</strong> {scanResult.studentName}</p>
              <p>{scanResult.msg}</p>
              {scanResult.ok && (
                <>
                  <p><strong>Prix séance débité:</strong> {scanResult.cost} DA</p>
                  <p><strong>Nouveau solde:</strong> {scanResult.newBalance} DA</p>
                </>
              )}
            </div>
          )}
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
            Sélectionnez les destinataires de l'alerte Email et WhatsApp.
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
            {students.filter(isSoonToRunOut).length === 0 ? (
              <p className="text-xs text-muted italic p-4 text-center">Aucun étudiant n'a son solde presque épuisé en ce moment.</p>
            ) : (
              <>
                <div className="flex justify-between items-center px-1 pb-1">
                  <label className="flex items-center gap-2 text-xs font-bold text-ink cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedAlertStudentIds.length === students.filter(isSoonToRunOut).length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedAlertStudentIds(students.filter(isSoonToRunOut).map(s => s.id));
                        } else {
                          setSelectedAlertStudentIds([]);
                        }
                      }}
                      className="rounded text-primary focus:ring-primary border-line h-4 w-4 bg-surface"
                    />
                    Tout Sélectionner
                  </label>
                  <span className="text-[10px] text-muted font-mono">
                    {selectedAlertStudentIds.length} / {students.filter(isSoonToRunOut).length} élèves
                  </span>
                </div>

                {students.filter(isSoonToRunOut).map((stu) => {
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
              disabled={selectedAlertStudentIds.length === 0}
              onClick={() => {
                const nowIso = new Date().toISOString();
                let alertSentCount = 0;

                selectedAlertStudentIds.forEach((id) => {
                  const stu = students.find((s) => s.id === id);
                  if (stu) {
                    alertSentCount++;
                    // Push notification to database for the parent/student
                    push("notifications", {
                      id: uid("ntf"),
                      parentId: stu.parentId ?? "",
                      title: "Alerte de solde faible",
                      description: `Rappel de paiement: Le solde de ${stu.firstName} ${stu.lastName} est de ${stu.balance} DA. Veuillez recharger rapidement. Accès aux cours refusé sans paiement.`,
                      date: nowIso,
                      read: false,
                      auto: false,
                    });
                  }
                });

                setIsAlertLowBalanceOpen(false);

                // Try to trigger a click-to-send WhatsApp demo for the first selected student if phone exists
                const firstId = selectedAlertStudentIds[0];
                const firstStu = students.find((s) => s.id === firstId);
                
                addToast({
                  type: "success",
                  title: "Alertes Envoyées",
                  message: `Des messages d'alerte (Email & WhatsApp) ont été envoyés avec succès à ${alertSentCount} élèves et leurs parents.`,
                });

                if (firstStu && firstStu.phone) {
                  const text = `Bonjour, le solde de l'élève ${firstStu.firstName} ${firstStu.lastName} est presque épuisé (${firstStu.balance} DA). Merci de régulariser la situation auprès de la réception. Entrée aux cours impossible sans paiement.`;
                  const url = `https://api.whatsapp.com/send?phone=${firstStu.phone}&text=${encodeURIComponent(text)}`;
                  window.open(url, "_blank");
                }
              }}
              className="flex items-center gap-2"
            >
              <Send className="h-4 w-4" /> Envoyer les alertes ({selectedAlertStudentIds.length})
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
        title="Reçu de Paiement"
      >
        <div className="space-y-6 text-center py-4">
          <div className="mx-auto w-12 h-12 bg-primary-50 rounded-full flex items-center justify-center text-primary text-xl">
            🖨️
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-ink">Rechargement effectué avec succès !</h3>
            <p className="text-xs text-muted max-w-sm mx-auto leading-relaxed">
              Le solde de l'élève <strong>{printConfirmData?.student.firstName} {printConfirmData?.student.lastName}</strong> a été rechargé de <strong>{printConfirmData?.amount} DA</strong>. 
              Souhaitez-vous imprimer le reçu de paiement ?
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
              Imprimer le Reçu
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
