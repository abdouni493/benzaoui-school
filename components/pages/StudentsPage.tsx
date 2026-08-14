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
  MessageCircle,
  Clock,
  MapPin,
  Users,
  Repeat,
} from "lucide-react";
import type {
  AbsencePenalty,
  AttendanceRecord,
  AttendanceStatus,
  Student,
  Subscription,
  SubscriptionDates,
  SubscriptionDiscount,
  DiscountType,
  Coursework,
  BalanceTransaction,
  BalanceTxType,
} from "@/lib/types";
import {
  addMonths,
  courseKeyOf,
  daysUntil,
  discountLabel,
  formatDateFr,
  formatDays,
  netPriceFor,
  todayIso,
  EXPIRY_WARNING_DAYS,
} from "@/lib/helpers";
import { useSettings } from "@/lib/store/settings";
import { printHtmlDocument } from "@/lib/print";
import { buildStudentPaymentsReport } from "@/lib/reports/studentPayments";
import { speakMessage, speechCaseForScan } from "@/lib/speech";
import { useToast } from "@/lib/store/toast";
import {
  WhatsAppMessageModal,
  type WhatsAppRecipient,
  type WhatsAppStudentContext,
} from "@/components/whatsapp/WhatsAppMessageModal";
import { isSendablePhone } from "@/lib/whatsapp/phone";
import { suggestTemplate } from "@/lib/whatsapp/templates";
import { buildBalanceAlert } from "@/lib/whatsapp/alert";
import type { SendResponse } from "@/lib/whatsapp/types";

/** Libellés des types de ligne du solde (onglet « Transactions »). */
const TX_TYPE_LABELS: Record<BalanceTxType, string> = {
  topup: "Versement / Recharge",
  deduction: "Débit (séance, absence…)",
  debt_payment: "Règlement de dette",
  registration: "Frais d'inscription",
};

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
    push,
    deleteFrom,
    updateItem,
    addBalance,
    payDebt,
    updateBalanceTx,
    deleteBalanceTx,
    scanCard,
    cancelAttendance,
    updateAttendance,
    deleteAbsencePenalty,
    setStudentPassword,
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
  const [attKindFilter, setAttKindFilter] = useState<"all" | "present" | "absent">("all");

  // Correcting one presence / removing one billed absence
  const [editingAtt, setEditingAtt] = useState<AttendanceRecord | null>(null);
  const [deletingAtt, setDeletingAtt] = useState<AttendanceRecord | null>(null);
  const [deletingPen, setDeletingPen] = useState<AbsencePenalty | null>(null);
  const [attEditStatus, setAttEditStatus] = useState<AttendanceStatus>("present");
  const [attEditDate, setAttEditDate] = useState("");
  const [attEditAmount, setAttEditAmount] = useState<number>(0);
  const [attBusy, setAttBusy] = useState(false);

  // Correcting one line of the transaction history (edit / delete)
  const [editingTx, setEditingTx] = useState<BalanceTransaction | null>(null);
  const [deletingTx, setDeletingTx] = useState<BalanceTransaction | null>(null);
  const [txAmount, setTxAmount] = useState<number>(0);
  const [txDescription, setTxDescription] = useState("");
  const [txDate, setTxDate] = useState("");
  const [txType, setTxType] = useState<BalanceTxType>("topup");
  const [txAdjustCash, setTxAdjustCash] = useState(true);
  const [txBusy, setTxBusy] = useState(false);

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

      // Keep the portal password so the payment receipt can print the login.
      // It lives in a staff-only table — never readable by the student/parent.
      await setStudentPassword(studentId, password);

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
        // Mirror the new password into the staff-only table so the receipt
        // keeps printing credentials that actually work.
        await setStudentPassword(selectedStudent.id, password);
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

  // ---- Correcting one transaction of the student's history -------------------
  // The list renders `tx.date` raw, so the edit box works on the very same
  // string (what the row shows is what you edit).
  const txDateToInput = (iso: string) => iso.substring(0, 16);
  const txInputToIso = (value: string) => (value.length === 16 ? `${value}:00.000Z` : new Date(value).toISOString());

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
      addToast({ type: "danger", title: "Modification impossible", message: res.error ?? "La transaction n'a pas pu être modifiée." });
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
      addToast({ type: "danger", title: "Suppression impossible", message: res.error ?? "La transaction n'a pas pu être supprimée." });
      return;
    }
    addToast({
      type: "success",
      title: "Transaction supprimée",
      message: `Nouveau solde: ${res.newBalance} DA${res.cashAdjusted ? " — caisse corrigée." : ""}`,
    });
    closeTxModals();
  };

  // ---- Correcting the presence history ---------------------------------------
  // A presence carries money (it debited the séance), so editing/removing one
  // has to move the balance back by the same amount — both live in a server-side
  // RPC (update_attendance / cancel_attendance) for that reason.
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
        ? ` — ${res.moduleName}${res.groupName ? ` (${res.groupName})` : ""}${res.sessionStart ? ` (${res.sessionStart} - ${res.sessionEnd})` : ""}`
        : "";
      // Attended another group of the same cours: allowed, billed normally.
      const substitution = res.otherGroup
        ? ` Rattrapage sur le groupe ${res.groupName ?? "suivi"}${res.ownGroupName ? ` (inscrit en ${res.ownGroupName})` : ""}.`
        : "";
      setScanResult({
        ok: true,
        studentName: `${matchedStu.firstName} ${matchedStu.lastName}`,
        cost: res.cost,
        newBalance: res.newBalance,
        msg: (res.messageKey === "scan.alreadyPresent"
          ? "Élève déjà marqué présent pour cette séance aujourd'hui (aucun débit)."
          : res.messageKey === "scan.successDebt"
          ? `Présence enregistrée${seance} — ATTENTION: le solde est passé en DETTE.`
          : res.messageKey === "scan.successLate"
          ? `Présence enregistrée (en retard)${seance}.`
          : `Présence validée et solde débité${seance} !`) + substitution,
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
        "scan.cooldown": "Déjà enregistré sur cette séance — passage ignoré (moins de 30 min depuis le dernier scan sur ce créneau).",
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
    setAssignSubDates({});
    setAssignDiscounts({});
    setBulkDiscountType("percent");
    setBulkDiscountValue(0);
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
   *  sinon à l'élève lui-même. Un seul appel API pour que la passerelle garde
   *  l'espacement entre les messages. */
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
    // Même résolution destinataire + modèle que l'alerte automatique du scan
    // (lib/whatsapp/alert) : le parent rattaché s'il est joignable, sinon
    // l'élève. On force ici le modèle « suggéré » historique pour ne rien
    // changer au contenu de l'envoi groupé de cette fiche.
    const waRecipients = selected.flatMap((stu) => {
      const parent = parents.find((p) => p.id === stu.parentId);
      const payload = buildBalanceAlert({
        student: stu,
        parent,
        school,
        lang: msgLang,
        templateId: suggestTemplate(stu),
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

    try {
      const response = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients: waRecipients }),
      });
      const payload = await response.json();

      if (!response.ok) {
        addToast({
          type: "danger",
          title: "WhatsApp indisponible",
          message: `${selected.length} notification(s) créée(s) dans l'application. Envoi WhatsApp impossible : ${payload?.error ?? "erreur inconnue"}`,
        });
        return;
      }

      const { sent, failed } = payload as SendResponse;
      addToast({
        type: failed > 0 ? "warning" : "success",
        title: "Alertes envoyées",
        message:
          failed > 0
            ? `${sent} message(s) WhatsApp envoyé(s), ${failed} en échec. ${selected.length} notification(s) créée(s) dans l'application.`
            : `${sent} message(s) WhatsApp envoyé(s) et ${selected.length} notification(s) créée(s) dans l'application.`,
      });
      setIsAlertLowBalanceOpen(false);
    } catch {
      addToast({
        type: "danger",
        title: "WhatsApp indisponible",
        message: `${selected.length} notification(s) créée(s) dans l'application, mais le serveur n'a pas répondu pour l'envoi WhatsApp.`,
      });
    } finally {
      setSendingAlerts(false);
    }
  };

  const openAssign = (stu: Student) => {
    setSelectedStudent(stu);
    setSelectedAssignIds(stu.subscriptionIds);
    // Reopen on the dates already recorded, so the modal doubles as the edit
    // screen for them (an empty date falls back to today at save time).
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

    // Enrollment dates for EVERY module: the registration day (informative) and
    // the day billing opens — a séance attended before it is recorded but never
    // charged. Formations additionally get an expiry derived from their period.
    const subscriptionDates: Record<string, SubscriptionDates> = {};
    for (const subId of selectedAssignIds) {
      // Stages ("coursework") are not subscriptions — they carry no dates.
      if (!subscriptions.some((s) => s.id === subId)) continue;
      const startDate = assignStartDates[subId] || todayIso();
      const formationSub = getFormationSub(subId);
      subscriptionDates[subId] = {
        subscribedAt: assignSubDates[subId] || todayIso(),
        startDate,
        expiryDate: formationSub
          ? addMonths(startDate, formationSub.periodMonths ?? 0)
          : undefined,
      };
    }

    // Only keep reductions that still belong to a selected module.
    const subscriptionDiscounts: Record<string, SubscriptionDiscount> = {};
    for (const subId of selectedAssignIds) {
      const d = assignDiscounts[subId];
      if (d && d.value > 0) subscriptionDiscounts[subId] = d;
    }

    updateItem("students", selectedStudent.id, {
      subscriptionIds: selectedAssignIds,
      subscriptionDates,
      subscriptionDiscounts,
      registrationDue: (selectedStudent.registrationDue || 0) + chargeRegistration,
    });

    setIsAssignOpen(false);
    resetForm();
  };

  // ---- What can be assigned: one entry per COURS, one option per GROUPE -----
  // A student is enrolled in a cours (class + module + teacher) through exactly
  // ONE of its groups. Every group of a cours shares the same tariff, so the
  // price never depends on which group is picked — only the timing does.
  interface AssignGroupOption {
    /** subscription id — this is what gets stored on the student */
    id: string;
    sessionId: string;
    groupName: string;
    salleName: string;
    daysLabel: string;
    time: string;
    enrolled: number;
  }
  interface AssignItem {
    /** subscription id of the selected (or first) group — the item's own key */
    id: string;
    key: string;
    label: string;
    moduleName: string;
    className: string;
    levelLabel: string;
    filiereLabel: string;
    teacherName: string;
    details: string;
    price: number;
    isCoursework: boolean;
    isFormation?: boolean;
    isOpen?: boolean;
    periodMonths?: number;
    periodLabel?: string;
    groupOptions: AssignGroupOption[];
  }

  const enrolledCountFor = (subId: string) =>
    students.filter((st) => st.subscriptionIds.includes(subId)).length;

  /** Assignable courses + séances libres + stages, filtered by the search box.
   *  The search matches everything printed on the card: module, class, level,
   *  filière, teacher, group, salle, day and time. */
  const getAssignableItems = (): AssignItem[] => {
    const byCourse = new Map<string, AssignItem>();

    subscriptions.forEach((sub) => {
      const s = sessions.find((se) => se.id === sub.sessionId);
      if (!s) return;
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
      if (assignSearch && !haystack.includes(assignSearch.toLowerCase())) return;

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

    coursework.forEach((cw) => {
      const t = teachers.find((te) => te.id === cw.teacherId);
      const haystack = `${cw.name} ${t?.firstName ?? ""} ${t?.lastName ?? ""}`.toLowerCase();
      if (assignSearch && !haystack.includes(assignSearch.toLowerCase())) return;

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
  const selectedGroupOf = (item: AssignItem) =>
    item.isCoursework
      ? selectedAssignIds.includes(item.id)
        ? item.id
        : undefined
      : item.groupOptions.find((g) => selectedAssignIds.includes(g.id))?.id;

  /** Enrolling in a cours = picking ONE of its groups. Picking another group
   *  moves the student instead of enrolling him twice in the same cours. */
  const pickGroup = (item: AssignItem, groupSubId: string) => {
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

  /** The modules a student is enrolled in, with the price actually charged
   *  (per-module reduction applied) — printed on the payment receipt. */
  const getStudentEnrollmentRows = (stu: Student) =>
    stu.subscriptionIds.flatMap((subId) => {
      const sub = subscriptions.find((s) => s.id === subId);
      if (!sub) {
        const cw = coursework.find((c) => c.id === subId);
        return cw
          ? [{
              module: `Stage: ${cw.name}`,
              classLabel: "-",
              group: "-",
              teacher: teachers.find((t) => t.id === cw.teacherId)
                ? `${teachers.find((t) => t.id === cw.teacherId)!.firstName} ${teachers.find((t) => t.id === cw.teacherId)!.lastName}`
                : "-",
              basePrice: cw.total,
              netPrice: cw.total,
              discountLabel: "",
              unit: "total",
            }]
          : [];
      }
      const sess = sessions.find((se) => se.id === sub.sessionId);
      if (!sess) return [];
      const cls = classes.find((c) => c.id === sess.classId);
      const lvl = cls ? (cls.type === "cours" ? cls.coursLevel : cls.formationLevel) : undefined;
      const t = teachers.find((te) => te.id === sess.teacherId);
      const isFormation = cls?.type === "formation";
      const basePrice = isFormation ? sub.levelPrice ?? 0 : sub.pricePerSession;
      const disc = stu.subscriptionDiscounts?.[subId];
      return [{
        module: modules.find((m) => m.id === sess.moduleId)?.name ?? "Module",
        classLabel: cls ? (lvl ? `${cls.name} (${lvl})` : cls.name) : "-",
        group: groups.find((g) => g.id === sess.groupId)?.name ?? "-",
        teacher: t ? `${t.firstName} ${t.lastName}` : "-",
        basePrice,
        netPrice: netPriceFor(basePrice, disc),
        discountLabel: disc && disc.value > 0
          ? disc.type === "percent" ? `-${disc.value}%` : `-${disc.value} DA`
          : "",
        unit: isFormation ? `${sub.periodMonths ?? 0} mois` : "séance",
      }];
    });

  const handlePrintInvoice = (stu: Student, amount: number, desc: string, settledReg: boolean) => {
    // Get fresh values from useData store
    const updatedStudents = useData.getState().students;
    const updatedStu = updatedStudents.find(s => s.id === stu.id) || stu;

    const invoiceNum = `REC-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const portalPassword = studentCredentials.find((c) => c.studentId === stu.id)?.password ?? "";
    const enrollments = getStudentEnrollmentRows(updatedStu);

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
            
            /* Portal credentials block */
            .credentials { border: 1px solid #e8e6f4; border-top: 4px solid #3b82f6; background: #fff; border-radius: 12px; padding: 12px; margin-bottom: 15px; }
            .credentials h3 { margin: 0 0 8px; font-size: 0.9em; color: #1e40af; border-bottom: 1px dashed #e8e6f4; padding-bottom: 5px; }
            .cred-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 15px; }
            .cred-note { margin-top: 8px; font-size: 0.68em; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 5px 8px; }

            /* Modules table */
            .modules-card { border: 1px solid #e8e6f4; border-top: 4px solid #7c3aed; background: #fff; border-radius: 12px; padding: 12px; margin-bottom: 15px; }
            .modules-card h3 { margin: 0 0 8px; font-size: 0.9em; color: #7c3aed; border-bottom: 1px dashed #e8e6f4; padding-bottom: 5px; }
            table.modules { width: 100%; border-collapse: collapse; font-size: 0.78em; }
            table.modules th { background: #fcfbff; color: #5c567a; text-transform: uppercase; font-size: 0.9em; letter-spacing: 0.3px; text-align: left; padding: 6px 8px; border-bottom: 1px solid #f1f0fb; }
            table.modules td { padding: 6px 8px; border-bottom: 1px solid #f1f0fb; }
            table.modules tr:last-child td { border-bottom: 0; }
            .num { text-align: right; font-family: monospace; font-weight: 700; }
            .strike { text-decoration: line-through; color: #9ca3af; font-weight: 400; }
            .cut { color: #b91c1c; font-weight: 700; }

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

          <!-- Portal account (login the family uses on the app) -->
          <div class="credentials">
            <h3>🔐 Compte de l'Élève (Espace en ligne)</h3>
            <div class="cred-grid">
              <div class="info-item">
                <span class="info-label">Email / Identifiant :</span>
                <span class="info-value" style="font-family: monospace;">${stu.email || "-"}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Mot de passe :</span>
                <span class="info-value" style="font-family: monospace; letter-spacing: 0.5px;">${
                  portalPassword || "— (non enregistré)"
                }</span>
              </div>
            </div>
            <div class="cred-note">
              ⚠️ Document confidentiel — remettre en main propre au parent / à l'élève.
              ${portalPassword ? "Le mot de passe peut être modifié à tout moment depuis l'espace personnel." : "Le mot de passe n'a pas été enregistré à la création : réinitialisez-le depuis la fiche de l'élève pour le faire apparaître ici."}
            </div>
          </div>

          <!-- Modules the student is subscribed to -->
          <div class="modules-card">
            <h3>📚 Modules Souscrits (${enrollments.length})</h3>
            ${
              enrollments.length === 0
                ? `<p style="font-size:0.78em; color:#999; font-style:italic; margin:6px 0 0;">Aucun module souscrit pour le moment.</p>`
                : `<table class="modules">
              <thead>
                <tr>
                  <th>Module</th>
                  <th>Classe / Niveau</th>
                  <th>Groupe</th>
                  <th>Enseignant</th>
                  <th class="num">Tarif</th>
                </tr>
              </thead>
              <tbody>
                ${enrollments
                  .map(
                    (e) => `
                <tr>
                  <td style="font-weight:bold; color:#1e1b4b;">${e.module}</td>
                  <td>${e.classLabel}</td>
                  <td>${e.group}</td>
                  <td>${e.teacher}</td>
                  <td class="num">
                    ${
                      e.discountLabel
                        ? `<span class="strike">${e.basePrice}</span> ${e.netPrice} DA<br/><span class="cut" style="font-size:0.85em;">${e.discountLabel}</span>`
                        : `${e.netPrice} DA`
                    }
                    <br/><span style="font-weight:400; color:#9ca3af; font-size:0.85em;">/ ${e.unit}</span>
                  </td>
                </tr>`,
                  )
                  .join("")}
              </tbody>
            </table>`
            }
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
                  <div className="absolute inset-0 bg-primary-600/95 backdrop-blur-sm rounded-2xl z-20 flex flex-col justify-start overflow-y-auto p-4 text-white space-y-2">
                    <div className="flex justify-between items-center border-b border-white/20 pb-2 mb-1">
                      <span className="font-bold text-sm truncate">{stu.firstName} {stu.lastName}</span>
                      <button onClick={() => setOverlayStudentId(null)} className="text-xs hover:underline bg-white/10 px-2 py-0.5 rounded">
                        Fermer
                      </button>
                    </div>

                    {/* Envoi WhatsApp — mis en avant : c'est l'action de relance
                        la plus fréquente sur une fiche en dette. */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <button
                        onClick={() => openWhatsApp(stu, "student")}
                        disabled={!isSendablePhone(stu.phone)}
                        title={
                          isSendablePhone(stu.phone)
                            ? "Envoyer un message WhatsApp à l'élève"
                            : "Aucun numéro exploitable pour cet élève"
                        }
                        className="flex items-center gap-1.5 justify-center bg-emerald-500/90 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed py-2 rounded-xl font-semibold"
                      >
                        <MessageCircle className="h-3.5 w-3.5" /> WhatsApp Élève
                      </button>
                      {(() => {
                        const parent = parents.find((p) => p.id === stu.parentId);
                        const canSend = isSendablePhone(parent?.phone);
                        return (
                          <button
                            onClick={() => openWhatsApp(stu, "parent")}
                            disabled={!canSend}
                            title={
                              !parent
                                ? "Aucun parent rattaché à cet élève"
                                : canSend
                                  ? `Envoyer un message WhatsApp à ${parent.firstName} ${parent.lastName}`
                                  : "Le parent rattaché n'a pas de numéro exploitable"
                            }
                            className="flex items-center gap-1.5 justify-center bg-emerald-500/90 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed py-2 rounded-xl font-semibold"
                          >
                            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp Parent
                          </button>
                        );
                      })()}
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
                <CheckCircle className="h-4 w-4" /> Présences &amp; Absences (
                {attendance.filter((t) => t.studentId === selectedStudent.id).length +
                  absencePenalties.filter((p) => p.studentId === selectedStudent.id).length}
                )
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
                            {!isCw && (
                              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted">
                                <span>
                                  Inscrit le <strong className="text-ink">{formatDateFr(dates?.subscribedAt)}</strong>
                                </span>
                                <span>
                                  · Début <strong className="text-ink">{formatDateFr(dates?.startDate)}</strong>
                                </span>
                                {dates?.startDate && daysUntil(dates.startDate) > 0 && (
                                  <Badge tone="success" className="text-[9px] px-1.5 py-0">
                                    Pas encore commencé — séances offertes
                                  </Badge>
                                )}
                              </span>
                            )}
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
                        [...txList].reverse().map((tx) => {
                          const isAbsence = tx.amount < 0 && tx.description.startsWith("Absence hebdomadaire");
                          return (
                            <div
                              key={tx.id}
                              className={`flex justify-between items-center gap-2 text-xs p-3 rounded-xl border ${
                                isAbsence ? "bg-warning/5 border-warning/40" : "bg-canvas border-line"
                              }`}
                            >
                              <div className="min-w-0">
                                <strong className="text-ink block flex items-center gap-1.5">
                                  {isAbsence && <Badge tone="warning">Absence</Badge>}
                                  {tx.description}
                                </strong>
                                <span className="text-[10px] text-muted">
                                  {tx.date.substring(0, 16).replace("T", " ")} · {TX_TYPE_LABELS[tx.type]}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <strong className={tx.amount > 0 ? "text-success font-bold" : "text-danger font-bold"}>
                                  {tx.amount > 0 ? `+${tx.amount}` : tx.amount} DA
                                </strong>
                                {/* Correction manuelle d'une ligne (montant saisi de travers, doublon…) */}
                                <button
                                  onClick={() => openEditTx(tx)}
                                  title="Modifier cette transaction"
                                  className="p-1.5 rounded-lg text-muted hover:bg-primary-50 hover:text-primary transition-colors"
                                >
                                  <Edit className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => openDeleteTx(tx)}
                                  title="Supprimer cette transaction"
                                  className="p-1.5 rounded-lg text-muted hover:bg-danger/10 hover:text-danger transition-colors"
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

              {detailsTab === "attendance" && (() => {
                const moduleOptions = getStudentModuleOptions(selectedStudent);
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
                const attList = attendance.filter((att) => {
                  if (att.studentId !== selectedStudent.id) return false;
                  if (attModuleFilter !== "all") {
                    const sess = sessions.find((se) => se.id === att.sessionId);
                    if (!sess || sess.moduleId !== attModuleFilter) return false;
                  }
                  if (attKindFilter === "absent" && att.status !== "absent") return false;
                  if (attKindFilter === "present" && att.status === "absent") return false;
                  return inDateWindow(new Date(att.timestamp));
                });
                // Automatic weekly-absence charges, shown alongside real scans so
                // the presence history tells the whole story (a "-price DA" entry
                // for every module week the student never showed up for).
                const penList = absencePenalties.filter((pen) => {
                  if (pen.studentId !== selectedStudent.id) return false;
                  if (attModuleFilter !== "all" && pen.moduleId !== attModuleFilter) return false;
                  if (attKindFilter === "present") return false;
                  return inDateWindow(new Date(`${pen.periodEnd}T12:00:00`));
                });
                const presentCount = attList.filter((a) => a.status !== "absent").length;
                const lateCount = attList.filter((a) => a.status === "late").length;
                const absentTotal = attList.filter((a) => a.status === "absent").length + penList.length;
                const chargedTotal =
                  attList.reduce((sum, a) => sum + a.amountDeducted, 0) +
                  penList.reduce((sum, p) => sum + p.amount, 0);
                const fmtDay = (d: string) => d.split("-").reverse().join("/");
                const rows = [
                  ...attList.map((att) => ({ kind: "att" as const, id: att.id, when: new Date(att.timestamp), att })),
                  ...penList.map((pen) => ({ kind: "pen" as const, id: pen.id, when: new Date(`${pen.periodEnd}T12:00:00`), pen })),
                ].sort((a, b) => b.when.getTime() - a.when.getTime());
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

                      <label className="text-[10px] font-bold text-muted uppercase shrink-0 ms-2">Type :</label>
                      <div className="flex gap-1">
                        {([
                          ["all", "Tout"],
                          ["present", "Présences"],
                          ["absent", "Absences"],
                        ] as const).map(([mode, label]) => (
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

                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {rows.length === 0 ? (
                        <p className="text-xs text-muted italic">Aucune présence ni absence pour ces filtres.</p>
                      ) : (
                        rows.map((row) => {
                          if (row.kind === "att") {
                            const att = row.att;
                            const s = sessions.find((se) => se.id === att.sessionId);
                            const modName = s ? modules.find((m) => m.id === s.moduleId)?.name : "Module";
                            const grpName = s ? groups.find((g) => g.id === s.groupId)?.name : undefined;
                            const salleName = s ? salles.find((sl) => sl.id === s.salleId)?.name : undefined;
                            const isAbsent = att.status === "absent";
                            return (
                              <div
                                key={att.id}
                                className={`flex flex-wrap justify-between items-center gap-2 text-xs p-3 rounded-xl border ${
                                  isAbsent ? "bg-danger/5 border-danger/30" : "bg-canvas border-line"
                                }`}
                              >
                                <div className="min-w-0">
                                  <strong className="text-ink block">
                                    {isAbsent ? "Absence" : "Présence"}: {modName}
                                    {grpName ? <span className="text-muted font-semibold"> — {grpName}</span> : null}
                                    {att.substituteGroup && (
                                      <Badge tone="primary" className="ms-1.5 text-[9px] px-1.5 py-0">
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
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <Badge tone={att.status === "present" ? "success" : att.status === "late" ? "warning" : "danger"}>
                                    {att.status === "present" ? "Présent" : att.status === "late" ? "En retard" : "Absent"}
                                  </Badge>
                                  {att.preStart || att.freePeriodId ? (
                                    <span
                                      className="text-[10px] font-bold text-success"
                                      title={
                                        att.preStart
                                          ? "Séance offerte : abonnement pas encore commencé"
                                          : "Séance offerte : période gratuite"
                                      }
                                    >
                                      Offert ({att.waivedAmount ?? 0} DA)
                                    </span>
                                  ) : (
                                    <span className="font-bold text-danger text-[10px]">-{att.amountDeducted} DA</span>
                                  )}
                                  <button
                                    onClick={() => openEditAtt(att)}
                                    title="Modifier cette présence"
                                    className="p-1.5 rounded-lg text-muted hover:bg-primary-50 hover:text-primary transition-colors"
                                  >
                                    <Edit className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setDeletingAtt(att)}
                                    title="Supprimer cette présence (et rembourser)"
                                    className="p-1.5 rounded-lg text-muted hover:bg-danger/10 hover:text-danger transition-colors"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          }
                          const pen = row.pen;
                          const s = sessions.find((se) => se.id === pen.sessionId);
                          const modName = modules.find((m) => m.id === pen.moduleId)?.name ?? "Module";
                          const grpName = s ? groups.find((g) => g.id === s.groupId)?.name : undefined;
                          return (
                            <div key={pen.id} className="flex flex-wrap justify-between items-center gap-2 text-xs bg-danger/5 border border-danger/30 p-3 rounded-xl">
                              <div className="min-w-0">
                                <strong className="text-ink block">
                                  Absence facturée: {modName}
                                  {grpName ? <span className="text-muted font-semibold"> — {grpName}</span> : null}
                                </strong>
                                <span className="text-[10px] text-muted">
                                  Semaine du {fmtDay(pen.periodStart)} au {fmtDay(pen.periodEnd)}
                                  {" · "}solde après : <span className={pen.balanceAfter < 0 ? "text-danger font-bold" : ""}>{pen.balanceAfter} DA</span>
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Badge tone="danger">Absent (semaine)</Badge>
                                <span className="font-bold text-danger text-[10px]">-{pen.amount} DA</span>
                                <button
                                  onClick={() => setDeletingPen(pen)}
                                  title="Supprimer cette absence (et rembourser)"
                                  className="p-1.5 rounded-lg text-muted hover:bg-danger/10 hover:text-danger transition-colors"
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

            <div className="flex justify-end pt-2 border-t border-line">
              <Button onClick={() => setIsDetailsOpen(false)}>Fermer</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit one line of the balance history — the RPC moves students.balance
          by the same delta, so history and balance can never drift apart. */}
      <Modal open={!!editingTx} onClose={closeTxModals} title="Modifier la transaction">
        {editingTx && (() => {
          const owner = students.find((s) => s.id === editingTx.studentId);
          const previewBalance = (owner?.balance ?? 0) - editingTx.amount + Math.round(txAmount || 0);
          const delta = Math.round(txAmount || 0) - editingTx.amount;
          return (
            <div className="space-y-4">
              <div className="bg-canvas border border-line rounded-xl p-3 text-xs space-y-0.5">
                <strong className="text-ink block">
                  {owner ? `${owner.firstName} ${owner.lastName}` : "Étudiant"}
                </strong>
                <span className="text-muted block">
                  Ligne d&apos;origine : {editingTx.amount > 0 ? `+${editingTx.amount}` : editingTx.amount} DA ·{" "}
                  {editingTx.date.substring(0, 16).replace("T", " ")}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Type</label>
                <Select value={txType} onChange={(e) => setTxType(e.target.value as BalanceTxType)} className="w-full">
                  {(Object.keys(TX_TYPE_LABELS) as BalanceTxType[]).map((t) => (
                    <option key={t} value={t}>{TX_TYPE_LABELS[t]}</option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Montant (DA)</label>
                <Input
                  type="number"
                  value={txAmount}
                  onChange={(e) => setTxAmount(Number(e.target.value))}
                />
                <p className="text-[10px] text-muted mt-1">
                  Montant signé : <strong>positif</strong> pour un versement/crédit, <strong>négatif</strong> pour un débit.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Description</label>
                <Input value={txDescription} onChange={(e) => setTxDescription(e.target.value)} />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Date</label>
                <Input type="datetime-local" value={txDate} onChange={(e) => setTxDate(e.target.value)} />
              </div>

              {editingTx.type === "topup" && (
                <label className="flex items-center justify-between p-3 bg-canvas border border-line rounded-xl cursor-pointer">
                  <span className="text-xs font-bold text-ink">
                    Corriger aussi la caisse
                    <span className="block text-[10px] font-normal text-muted">
                      Écrit une écriture de correction de {delta > 0 ? `+${delta}` : delta} DA dans la caisse
                      (le versement d&apos;origine y avait été enregistré).
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
        {deletingTx && (() => {
          const owner = students.find((s) => s.id === deletingTx.studentId);
          const previewBalance = (owner?.balance ?? 0) - deletingTx.amount;
          return (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/5 p-3">
                <AlertTriangle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
                <p className="text-xs text-ink leading-relaxed">
                  Cette transaction sera définitivement supprimée et son effet sur le solde annulé.
                  {deletingTx.type === "deduction" && (
                    <span className="block mt-1 text-muted">
                      La présence liée (onglet « Présences ») n&apos;est pas supprimée pour autant.
                    </span>
                  )}
                </p>
              </div>

              <div className="bg-canvas border border-line rounded-xl p-3 text-xs space-y-0.5">
                <strong className="text-ink block">{deletingTx.description}</strong>
                <span className="text-muted block">
                  {owner ? `${owner.firstName} ${owner.lastName} · ` : ""}
                  {deletingTx.date.substring(0, 16).replace("T", " ")} · {TX_TYPE_LABELS[deletingTx.type]}
                </span>
                <strong className={deletingTx.amount > 0 ? "text-success" : "text-danger"}>
                  {deletingTx.amount > 0 ? `+${deletingTx.amount}` : deletingTx.amount} DA
                </strong>
              </div>

              {deletingTx.type === "topup" && (
                <label className="flex items-center justify-between p-3 bg-canvas border border-line rounded-xl cursor-pointer">
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
        {editingAtt && (() => {
          const s = sessions.find((se) => se.id === editingAtt.sessionId);
          const modName = s ? modules.find((m) => m.id === s.moduleId)?.name ?? "Module" : "Module";
          const grpName = s ? groups.find((g) => g.id === s.groupId)?.name ?? "-" : "-";
          const owner = students.find((st) => st.id === editingAtt.studentId);
          const delta = Math.max(0, Math.round(attEditAmount || 0)) - editingAtt.amountDeducted;
          const previewBalance = (owner?.balance ?? 0) - delta;
          return (
            <div className="space-y-4">
              <div className="rounded-xl border border-line bg-canvas p-3 text-xs space-y-0.5">
                <strong className="block text-ink">
                  {modName} — {grpName}
                  {editingAtt.substituteGroup && (
                    <Badge tone="primary" className="ms-1.5 text-[9px] px-1.5 py-0">Autre groupe</Badge>
                  )}
                </strong>
                <span className="block text-muted">
                  {owner ? `${owner.firstName} ${owner.lastName} · ` : ""}
                  {s ? `${formatDays(s.days)} · ${s.startTime}-${s.endTime}` : ""}
                </span>
                <span className="block text-muted">
                  Débit d&apos;origine : {editingAtt.amountDeducted} DA
                </span>
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
                  La différence est reportée sur le solde de l&apos;élève et tracée dans ses transactions.
                  Mettez <strong>0</strong> pour une séance offerte.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-primary/25 bg-primary-50/40 p-3 text-xs">
                <span className="font-semibold text-muted">Solde après correction</span>
                <strong className={previewBalance < 0 ? "text-danger" : "text-success"}>{previewBalance} DA</strong>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={closeAttModals} disabled={attBusy}>Annuler</Button>
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
        {deletingAtt && (() => {
          const s = sessions.find((se) => se.id === deletingAtt.sessionId);
          const modName = s ? modules.find((m) => m.id === s.moduleId)?.name ?? "Module" : "Module";
          const grpName = s ? groups.find((g) => g.id === s.groupId)?.name ?? "-" : "-";
          const owner = students.find((st) => st.id === deletingAtt.studentId);
          const previewBalance = (owner?.balance ?? 0) + deletingAtt.amountDeducted;
          return (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/5 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                <p className="text-xs leading-relaxed text-ink">
                  La présence sera supprimée, les {deletingAtt.amountDeducted} DA débités seront remboursés
                  et la part due à l&apos;enseignant pour cette séance sera annulée.
                </p>
              </div>

              <div className="rounded-xl border border-line bg-canvas p-3 text-xs space-y-0.5">
                <strong className="block text-ink">{modName} — {grpName}</strong>
                <span className="block text-muted">
                  {owner ? `${owner.firstName} ${owner.lastName} · ` : ""}
                  {deletingAtt.timestamp.substring(0, 16).replace("T", " ")}
                </span>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-primary/25 bg-primary-50/40 p-3 text-xs">
                <span className="font-semibold text-muted">Solde après suppression</span>
                <strong className={previewBalance < 0 ? "text-danger" : "text-success"}>{previewBalance} DA</strong>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={closeAttModals} disabled={attBusy}>Annuler</Button>
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
        {deletingPen && (() => {
          const modName = modules.find((m) => m.id === deletingPen.moduleId)?.name ?? "Module";
          const owner = students.find((st) => st.id === deletingPen.studentId);
          const previewBalance = (owner?.balance ?? 0) + deletingPen.amount;
          const fmt = (d: string) => d.split("-").reverse().join("/");
          return (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/5 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                <p className="text-xs leading-relaxed text-ink">
                  L&apos;absence hebdomadaire sera supprimée, les {deletingPen.amount} DA facturés seront
                  remboursés et la ligne correspondante disparaîtra de l&apos;historique du solde.
                </p>
              </div>

              <div className="rounded-xl border border-line bg-canvas p-3 text-xs space-y-0.5">
                <strong className="block text-ink">{modName}</strong>
                <span className="block text-muted">
                  {owner ? `${owner.firstName} ${owner.lastName} · ` : ""}
                  Semaine du {fmt(deletingPen.periodStart)} au {fmt(deletingPen.periodEnd)}
                </span>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-primary/25 bg-primary-50/40 p-3 text-xs">
                <span className="font-semibold text-muted">Solde après suppression</span>
                <strong className={previewBalance < 0 ? "text-danger" : "text-success"}>{previewBalance} DA</strong>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={closeAttModals} disabled={attBusy}>Annuler</Button>
                <Button variant="danger" onClick={handleDeletePenalty} disabled={attBusy}>
                  {attBusy ? "Suppression…" : "Supprimer"}
                </Button>
              </div>
            </div>
          );
        })()}
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
              Cochez plusieurs modules puis appliquez la réduction une seule fois. Chaque module reste
              modifiable individuellement ci-dessous. Le tarif réduit est celui réellement débité au scan,
              en présence manuelle et par la facturation d&apos;absence hebdomadaire.
            </p>
          </div>

          <div className="border border-line rounded-xl max-h-[26rem] overflow-y-auto p-2 bg-canvas/30 space-y-2">
            {getAssignableItems().length === 0 ? (
              <p className="px-2 py-3 text-xs italic text-muted">
                Aucun cours ou stage ne correspond à cette recherche.
              </p>
            ) : (
              getAssignableItems().map((item) => {
                const selectedId = selectedGroupOf(item);
                const isChecked = !!selectedId;
                // Reductions and enrollment dates hang off the CHOSEN group.
                const keyId = selectedId ?? item.id;
                const startDate = assignStartDates[keyId] || todayIso();
                const subDate = assignSubDates[keyId] || todayIso();
                const expiryDate = item.isFormation ? addMonths(startDate, item.periodMonths ?? 0) : "";
                // Billing has not opened yet: séances attended until then are
                // recorded but never taken off the balance.
                const startsLater = daysUntil(startDate) > 0;
                const discount = assignDiscounts[keyId];
                const net = netPriceFor(item.price, discount);
                const hasDiscount = !!discount && discount.value > 0;
                const chosen = item.groupOptions.find((g) => g.id === selectedId);

                return (
                  <div
                    key={item.key}
                    className={`rounded-xl border p-2.5 ${
                      isChecked ? "border-primary/30 bg-primary-50/60" : "border-line/70 bg-surface"
                    }`}
                  >
                    {/* ---- Course header: everything about the timing ---- */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <strong className="block text-xs font-bold text-ink">
                          {item.moduleName}
                          {item.isFormation && (
                            <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                              Formation
                            </span>
                          )}
                          {item.isOpen && (
                            <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-success/15 text-success">
                              Séance libre
                            </span>
                          )}
                          {item.isCoursework && (
                            <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-warning/15 text-warning">
                              Stage
                            </span>
                          )}
                          {hasDiscount && (
                            <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-success/15 text-success">
                              {discountLabel(discount)}
                            </span>
                          )}
                        </strong>
                        <span className="mt-0.5 block text-[10px] text-muted">
                          {item.isCoursework ? (
                            item.details
                          ) : (
                            <>
                              Classe : <strong className="text-ink">{item.className}</strong>
                              {item.levelLabel ? ` (${item.levelLabel})` : ""}
                              {item.filiereLabel ? ` · ${item.filiereLabel}` : ""} · Enseignant :{" "}
                              <strong className="text-ink">{item.teacherName}</strong>
                              {item.periodLabel ? ` · ${item.periodLabel}` : ""}
                            </>
                          )}
                        </span>
                      </div>
                      <div className="shrink-0 text-end">
                        <span className="text-xs font-bold text-primary">
                          {hasDiscount && (
                            <span className="me-1 font-normal text-muted line-through">{item.price}</span>
                          )}
                          {net} DA
                          {item.isFormation && (
                            <span className="font-semibold text-muted"> / {item.periodMonths} mois</span>
                          )}
                        </span>
                        {!item.isCoursework && (
                          <span className="block text-[9px] text-muted">
                            {item.groupOptions.length} groupe{item.groupOptions.length > 1 ? "s" : ""} · même tarif
                          </span>
                        )}
                      </div>
                    </div>

                    {/* ---- Group picker: the student joins ONE group ---- */}
                    {item.isCoursework ? (
                      <button
                        onClick={() => toggleCoursework(item)}
                        className={`mt-2 flex w-full items-center justify-between rounded-lg border p-2 text-[11px] transition-colors ${
                          isChecked
                            ? "border-primary bg-primary text-white"
                            : "border-line bg-canvas/40 text-ink hover:bg-primary-50"
                        }`}
                      >
                        <span className="font-bold">{item.label}</span>
                        <input type="checkbox" checked={isChecked} readOnly className="h-4 w-4" />
                      </button>
                    ) : (
                      <div className="mt-2 space-y-1">
                        <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-muted">
                          <Users className="h-3 w-3" /> Choisir le groupe de l&apos;étudiant
                        </span>
                        {item.groupOptions.map((g) => {
                          const active = selectedId === g.id;
                          return (
                            <button
                              key={g.id}
                              onClick={() => pickGroup(item, g.id)}
                              className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-start text-[11px] transition-colors ${
                                active
                                  ? "border-primary bg-primary text-white"
                                  : "border-line bg-canvas/40 text-ink hover:bg-primary-50"
                              }`}
                            >
                              <span className="font-bold">{g.groupName}</span>
                              <span
                                className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 ${
                                  active ? "text-white/85" : "text-muted"
                                }`}
                              >
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" /> {g.daysLabel} · {g.time}
                                </span>
                                <span className="flex items-center gap-1">
                                  <MapPin className="h-3 w-3" /> {g.salleName}
                                </span>
                                <span>{g.enrolled} inscrit(s)</span>
                              </span>
                              <input
                                type="radio"
                                checked={active}
                                readOnly
                                className="h-4 w-4 shrink-0"
                              />
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {isChecked && (
                      <div className="mt-2 flex flex-wrap items-end gap-4 rounded-xl border border-line bg-surface p-2.5">
                        {chosen && (
                          <div className="pb-1.5 text-xs">
                            <span className="mb-1 block text-[10px] font-semibold text-muted">Groupe affecté</span>
                            <strong className="text-primary">{chosen.groupName}</strong>
                            <span className="text-muted">
                              {" "}
                              · {chosen.daysLabel} · {chosen.time}
                            </span>
                          </div>
                        )}

                        {/* Enrollment dates — every module, cours or formation.
                            Both stay editable: reopening this modal reloads them. */}
                        {!item.isCoursework && (
                          <>
                            <div>
                              <label className="block text-[10px] font-semibold text-muted mb-1">
                                Date d&apos;inscription
                              </label>
                              <Input
                                type="date"
                                value={subDate}
                                onChange={(e) =>
                                  setAssignSubDates({ ...assignSubDates, [keyId]: e.target.value })
                                }
                                className="w-40"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-muted mb-1">
                                Date de début *
                              </label>
                              <Input
                                type="date"
                                value={startDate}
                                onChange={(e) =>
                                  setAssignStartDates({ ...assignStartDates, [keyId]: e.target.value })
                                }
                                className="w-40"
                              />
                              {startsLater && (
                                <span className="mt-1 block text-[9px] font-semibold text-success">
                                  Séances offertes jusqu&apos;au {formatDateFr(startDate)}
                                </span>
                              )}
                            </div>
                            {item.isFormation && (
                              <div className="pb-1.5 text-xs">
                                <span className="block text-[10px] font-semibold text-muted mb-1">
                                  Date d&apos;expiration (calculée)
                                </span>
                                <strong className="text-primary">{formatDateFr(expiryDate)}</strong>
                                <span className="text-muted"> · {item.periodMonths} mois</span>
                              </div>
                            )}
                          </>
                        )}

                        {/* Per-module reduction */}
                        <div>
                          <label className="block text-[10px] font-semibold text-muted mb-1">Réduction</label>
                          <Select
                            value={discount?.type ?? "percent"}
                            onChange={(e) => setItemDiscount(keyId, { type: e.target.value as DiscountType })}
                            className="w-36"
                          >
                            <option value="percent">Pourcentage (%)</option>
                            <option value="amount">Montant fixe (DA)</option>
                          </Select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-muted mb-1">
                            Valeur {(discount?.type ?? "percent") === "percent" ? "(%)" : "(DA)"}
                          </label>
                          <Input
                            type="number"
                            min={0}
                            max={(discount?.type ?? "percent") === "percent" ? 100 : undefined}
                            value={discount?.value || ""}
                            onChange={(e) => setItemDiscount(keyId, { value: Number(e.target.value) })}
                            placeholder="0"
                            className="w-28"
                          />
                        </div>
                        <div className="pb-1.5 text-xs">
                          <span className="block text-[10px] font-semibold text-muted mb-1">
                            Tarif après réduction
                          </span>
                          <strong className={hasDiscount ? "text-success" : "text-ink"}>{net} DA</strong>
                          {hasDiscount && (
                            <span className="text-muted"> (au lieu de {item.price} DA)</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
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

          {/* Running total of what the student will be charged per séance */}
          {selectedAssignIds.length > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-line bg-canvas/40 p-3 text-xs">
              <span className="text-muted font-semibold">
                Total par séance après réductions ({selectedAssignIds.length} module(s))
              </span>
              <strong className="text-primary text-sm">
                {selectedAssignIds.reduce((sum, id) => {
                  const sub = subscriptions.find((s) => s.id === id);
                  if (sub) {
                    const sess = sessions.find((se) => se.id === sub.sessionId);
                    const cls = sess ? classes.find((c) => c.id === sess.classId) : undefined;
                    const base = cls?.type === "formation" ? sub.levelPrice ?? 0 : sub.pricePerSession;
                    return sum + netPriceFor(base, assignDiscounts[id]);
                  }
                  const cw = coursework.find((c) => c.id === id);
                  return sum + netPriceFor(cw?.total ?? 0, assignDiscounts[id]);
                }, 0)}{" "}
                DA
              </strong>
            </div>
          )}

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
            Chaque élève sélectionné reçoit une notification dans l&apos;application et un message
            WhatsApp personnalisé — envoyé au parent rattaché, ou à l&apos;élève à défaut.
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
