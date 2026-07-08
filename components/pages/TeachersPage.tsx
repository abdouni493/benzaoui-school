"use client";

import { useState } from "react";
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
  Briefcase,
  DollarSign,
  Calendar,
  Percent,
  ListMinus,
  FileSpreadsheet,
  Printer,
  X,
} from "lucide-react";
import type { Teacher, TeacherAcompte, TeacherAbsence, UnpaidTeacherSession } from "@/lib/types";
import { printHtmlDocument } from "@/lib/print";
import { buildTeacherPaymentReport } from "@/lib/reports/teacherPayment";
import { useSettings } from "@/lib/store/settings";

export function TeachersPage() {
  const {
    teachers,
    sessions,
    subscriptions,
    modules,
    groups,
    classes,
    salles,
    students,
    unpaidTeacher,
    acomptes,
    absences,
    cash,
    attendance,
    school,
    push,
    deleteFrom,
    updateItem,
    settleTeacherPercentage,
  } = useData();
  const { language } = useSettings();

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isAcompteOpen, setIsAcompteOpen] = useState(false);
  const [isAbsenceOpen, setIsAbsenceOpen] = useState(false);
  const [isPayOpen, setIsPayOpen] = useState(false);
  const [isUnpaidDetailOpen, setIsUnpaidDetailOpen] = useState(false);
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null);

  // Form: Create/Edit Teacher
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [paymentType, setPaymentType] = useState<"monthly" | "percentage">("percentage");
  const [monthlyAmount, setMonthlyAmount] = useState<number>(0);
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [percentage, setPercentage] = useState<number>(50);

  // Form: Acompte & Absence
  const [amount, setAmount] = useState<number>(0);
  const [description, setDescription] = useState("");
  const [actionDate, setActionDate] = useState(new Date().toISOString().split("T")[0]);

  // Form: Print
  const [printStart, setPrintStart] = useState("");
  const [printEnd, setPrintEnd] = useState("");

  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [detailsTab, setDetailsTab] = useState<"info" | "finance" | "sessions">("info");
  const [sessionFilter, setSessionFilter] = useState<"all" | "paid" | "unpaid">("all");

  // Helpers
  const getTeacherUnpaidSessions = (tid: string) => {
    return unpaidTeacher.filter((u) => u.teacherId === tid && !u.paid);
  };

  const getTeacherAcomptes = (tid: string) => {
    return acomptes.filter((a) => a.teacherId === tid);
  };

  const getTeacherAbsences = (tid: string) => {
    return absences.filter((a) => a.teacherId === tid);
  };

  // Group a teacher's UNPAID séances by day + timing, with each student's
  // exact scan time, fee and teacher share — the "calculation detail" view
  // shown before validating a percentage payment.
  const buildUnpaidDetail = (tid: string) => {
    const rows = unpaidTeacher.filter((u) => u.teacherId === tid && !u.paid);
    const map: Record<string, {
      dateKey: string;
      sessionId: string;
      moduleName: string;
      className: string;
      groupName: string;
      startTime: string;
      endTime: string;
      students: { name: string; time: string; status: string; fee: number; share: number }[];
      totalFees: number;
      totalPayout: number;
    }> = {};

    rows.forEach((u) => {
      const dateKey = new Date(u.date).toLocaleDateString("fr-CA");
      const key = `${dateKey}_${u.sessionId}`;
      const sess = sessions.find((s) => s.id === u.sessionId);
      if (!map[key]) {
        map[key] = {
          dateKey,
          sessionId: u.sessionId,
          moduleName: sess ? modules.find((m) => m.id === sess.moduleId)?.name ?? "Séance" : "Séance",
          className: sess ? classes.find((c) => c.id === sess.classId)?.name ?? "-" : "-",
          groupName: sess ? groups.find((g) => g.id === sess.groupId)?.name ?? "-" : "-",
          startTime: sess?.startTime ?? "",
          endTime: sess?.endTime ?? "",
          students: [],
          totalFees: 0,
          totalPayout: 0,
        };
      }
      const stu = students.find((st) => st.id === u.studentId);
      const att = attendance.find(
        (a) =>
          a.studentId === u.studentId &&
          a.sessionId === u.sessionId &&
          new Date(a.timestamp).toLocaleDateString("fr-CA") === dateKey
      );
      map[key].students.push({
        name: stu ? `${stu.firstName} ${stu.lastName}` : "Élève inconnu",
        time: new Date(att?.timestamp ?? u.date).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        status: att?.status === "late" ? "En Retard" : "Présent",
        fee: att?.amountDeducted ?? 0,
        share: u.amount,
      });
      map[key].totalFees += att?.amountDeducted ?? 0;
      map[key].totalPayout += u.amount;
    });

    return Object.values(map).sort(
      (a, b) => b.dateKey.localeCompare(a.dateKey) || a.startTime.localeCompare(b.startTime)
    );
  };

  // Get months between startDate and now
  const getUnpaidMonthsList = (teacher: Teacher) => {
    if (teacher.paymentType !== "monthly" || !teacher.startDate) return [];
    const start = new Date(teacher.startDate);
    const end = new Date();
    const months: { label: string; key: string; amount: number }[] = [];

    let current = new Date(start.getFullYear(), start.getMonth(), 1);
    while (current <= end) {
      const monthLabel = current.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
      const monthKey = `${String(current.getMonth() + 1).padStart(2, "0")}/${current.getFullYear()}`;

      // Check if cash database has a record for this teacher and this month
      const paymentExists = cash.some(
        (c) =>
          c.type === "teacher_payment" &&
          c.description.includes(teacher.lastName) &&
          c.description.includes(monthKey)
      );

      if (!paymentExists) {
        months.push({
          label: monthLabel,
          key: monthKey,
          amount: teacher.monthlyAmount ?? 0,
        });
      }

      current.setMonth(current.getMonth() + 1);
    }

    return months;
  };

  const handleCreateTeacher = async () => {
    if (!firstName || !lastName || !phone || !email) {
      alert("Veuillez remplir tous les champs obligatoires.");
      return;
    }
    if (password.length < 6) {
      alert("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }

    try {
      const { id: teacherId } = await createRoleUser({
        role: "teacher",
        email,
        password,
        firstName,
        lastName,
        phone,
        paymentType,
        ...(paymentType === "monthly" ? { monthlyAmount, startDate } : { percentage }),
      });

      const newTeacher: Teacher = {
        id: teacherId,
        firstName,
        lastName,
        phone,
        email,
        paymentType,
        ...(paymentType === "monthly" ? { monthlyAmount, startDate } : { percentage }),
      };
      push("teachers", newTeacher);

      setIsCreateOpen(false);
      resetForm();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur lors de la création du compte.");
    }
  };

  const handleEditTeacher = async () => {
    if (!selectedTeacher) return;

    if (password) {
      try {
        await resetUserPassword(selectedTeacher.id, password);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Erreur lors du changement de mot de passe.");
        return;
      }
    }

    updateItem("teachers", selectedTeacher.id, {
      firstName,
      lastName,
      phone,
      email,
      paymentType,
      monthlyAmount: paymentType === "monthly" ? monthlyAmount : undefined,
      startDate: paymentType === "monthly" ? startDate : undefined,
      percentage: paymentType === "percentage" ? percentage : undefined,
    });
    setIsEditOpen(false);
    resetForm();
  };

  const handleDelete = (id: string) => {
    if (confirm("Êtes-vous sûr de vouloir supprimer cet enseignant ?")) {
      deleteFrom("teachers", id);
      setActiveMenuId(null);
    }
  };

  const handleCreateAcompte = () => {
    if (!selectedTeacher || amount <= 0) return;
    push("acomptes", {
      id: uid("ac"),
      teacherId: selectedTeacher.id,
      amount,
      description: description || "Avance sur salaire",
      date: actionDate,
    });

    // Deduct directly from cash register
    push("cash", {
      id: uid("csh"),
      type: "acompte",
      amount: -amount,
      date: new Date().toISOString(),
      description: `Acompte versé à ${selectedTeacher.firstName} ${selectedTeacher.lastName} (${description || "Acompte"})`,
    });

    setIsAcompteOpen(false);
    setAmount(0);
    setDescription("");
  };

  const handleCreateAbsence = () => {
    if (!selectedTeacher || amount <= 0) return;
    push("absences", {
      id: uid("ab"),
      teacherId: selectedTeacher.id,
      cost: amount,
      description: description || "Absence non justifiée",
      date: actionDate,
    });

    setIsAbsenceOpen(false);
    setAmount(0);
    setDescription("");
  };

  const handlePaymentSubmit = async (monthKey?: string) => {
    if (!selectedTeacher) return;

    if (selectedTeacher.paymentType === "percentage") {
      // Atomic settlement server-side (settle_teacher_percentage RPC): marks
      // every unpaid séance as paid, consumes acomptes/absences and writes
      // the cash movement in a single transaction.
      const res = await settleTeacherPercentage(selectedTeacher.id);
      if (!res.ok) {
        alert(
          res.messageKey === "pay.nothingDue"
            ? `Le solde net à payer est inférieur ou égal à 0 DA (net: ${res.net ?? 0} DA).`
            : "Le paiement a échoué — veuillez réessayer."
        );
        return;
      }
      alert(
        `Paiement validé : ${res.net} DA versés (${res.sessions} présence(s), brut ${res.gross} DA, acomptes -${res.acomptes} DA, absences -${res.absences} DA).`
      );
    } else {
      // Monthly payment
      if (!monthKey) return;
      const netAmount = selectedTeacher.monthlyAmount ?? 0;

      // Record in cash register with month signature
      push("cash", {
        id: uid("csh"),
        type: "teacher_payment",
        amount: -netAmount,
        date: new Date().toISOString(),
        description: `Salaire mensuel ${selectedTeacher.firstName} ${selectedTeacher.lastName} - ${monthKey}`,
      });
    }

    setIsPayOpen(false);
    setIsUnpaidDetailOpen(false);
  };

  const handlePrintTeacherReport = () => {
    if (!selectedTeacher) return;
    printHtmlDocument(
      buildTeacherPaymentReport({
        teacher: selectedTeacher,
        school,
        lang: language,
        startDate: printStart,
        endDate: printEnd,
        sessions,
        subscriptions,
        students,
        attendance,
        unpaidTeacher,
        acomptes,
        absences,
        modules,
        groups,
        classes,
        salles,
      }),
    );
    setIsPrintOpen(false);
  };

  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setPhone("");
    setEmail("");
    setPassword("");
    setPaymentType("percentage");
    setMonthlyAmount(0);
    setPercentage(50);
    setSelectedTeacher(null);
  };

  const openEdit = (t: Teacher) => {
    setSelectedTeacher(t);
    setFirstName(t.firstName);
    setLastName(t.lastName);
    setPhone(t.phone);
    setEmail(t.email);
    setPassword("");
    setPaymentType(t.paymentType);
    if (t.paymentType === "monthly") {
      setMonthlyAmount(t.monthlyAmount || 0);
      setStartDate(t.startDate || "");
    } else {
      setPercentage(t.percentage || 50);
    }
    setIsEditOpen(true);
    setActiveMenuId(null);
  };

  const openDetails = (t: Teacher) => {
    setSelectedTeacher(t);
    setDetailsTab("info");
    setSessionFilter("all");
    setIsDetailsOpen(true);
    setActiveMenuId(null);
  };

  const openAcompte = (t: Teacher) => {
    setSelectedTeacher(t);
    setAmount(0);
    setDescription("Avance sur salaire");
    setIsAcompteOpen(true);
    setActiveMenuId(null);
  };

  const openAbsence = (t: Teacher) => {
    setSelectedTeacher(t);
    setAmount(0);
    setDescription("Absence non justifiée");
    setIsAbsenceOpen(true);
    setActiveMenuId(null);
  };

  const openPay = (t: Teacher) => {
    setSelectedTeacher(t);
    setIsPayOpen(true);
    setActiveMenuId(null);
  };

  const openPrint = (t: Teacher) => {
    setSelectedTeacher(t);
    setPrintStart("");
    setPrintEnd("");
    setIsPrintOpen(true);
    setActiveMenuId(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <PageHeader emoji="👨‍🏫" title="Enseignants" subtitle="Gérer le corps enseignant et leurs salaires" />
        <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} className="flex items-center gap-2">
          <Plus className="h-4 w-4" /> Nouvel Enseignant
        </Button>
      </div>

      {/* Grid of teachers */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {teachers.map((t) => {
          const unpaidSess = getTeacherUnpaidSessions(t.id);
          const unpaidMonths = getUnpaidMonthsList(t);

          return (
            <Card
              key={t.id}
              className={`relative transition-all duration-300 ${
                activeMenuId === t.id
                  ? "z-30 scale-[1.02] ring-2 ring-primary/45 shadow-2xl"
                  : "z-10 hover:z-20 hover:shadow-lg hover:-translate-y-0.5 border border-line"
              }`}
            >
              <CardBody className="flex flex-col justify-between min-h-[220px] relative p-5">
                {/* Actions overlay panel */}
                {activeMenuId === t.id && (
                  <div className="absolute inset-0 bg-surface/98 backdrop-blur-md rounded-2xl p-4 flex flex-col justify-between z-20 animate-in fade-in zoom-in-95 duration-200 border border-primary/20">
                    <div className="flex justify-between items-center border-b border-line pb-2">
                      <span className="font-bold text-[10px] text-muted uppercase tracking-wider">
                        Actions: {t.firstName} {t.lastName}
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
                        onClick={() => openDetails(t)}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                      >
                        <Eye className="h-3.5 w-3.5" /> Détails
                      </button>
                      <button
                        onClick={() => openPay(t)}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-success/15 text-success border border-success/30 hover:bg-success/25 transition-colors"
                      >
                        <DollarSign className="h-3.5 w-3.5" /> Payer
                      </button>
                      <button
                        onClick={() => openAcompte(t)}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" /> Acompte
                      </button>
                      <button
                        onClick={() => openAbsence(t)}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25 transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" /> Absence
                      </button>
                      <button
                        onClick={() => openPrint(t)}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                      >
                        <Printer className="h-3.5 w-3.5" /> Rapport
                      </button>
                      <button
                        onClick={() => openEdit(t)}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                      >
                        <Edit className="h-3.5 w-3.5" /> Modifier
                      </button>
                    </div>

                    <div className="border-t border-line pt-2">
                      <button
                        onClick={() => handleDelete(t.id)}
                        className="flex items-center justify-center gap-1.5 w-full py-2 px-3 text-xs font-bold rounded-xl bg-danger text-white hover:bg-danger/90 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Supprimer
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 border border-primary/20 text-primary font-bold text-xs flex items-center justify-center tracking-wider shrink-0">
                        {t.firstName.charAt(0).toUpperCase()}{t.lastName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-ink hover:text-primary transition-colors truncate">
                          {t.firstName} {t.lastName}
                        </h4>
                        <span className="text-[10px] text-muted block font-mono truncate">{t.phone}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => setActiveMenuId(activeMenuId === t.id ? null : t.id)}
                      className="p-1.5 rounded-lg hover:bg-primary-50 text-muted hover:text-ink transition-colors shrink-0"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-xs bg-canvas/30 border border-line/60 rounded-xl p-2.5">
                      <div>
                        <span className="text-[10px] text-muted block uppercase font-semibold">Contrat</span>
                        <span className="font-semibold text-ink">
                          {t.paymentType === "monthly" ? "Fixe Mensuel" : "Pourcentage"}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-muted block uppercase font-semibold">Rémunération</span>
                        <span className="font-bold text-primary">
                          {t.paymentType === "monthly" ? `${t.monthlyAmount} DA/m` : `${t.percentage}% / élève`}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl flex flex-col justify-between">
                        <span className="text-muted block text-[9px] uppercase">Dernier acompte</span>
                        <strong className="text-ink mt-0.5">{getTeacherAcomptes(t.id).slice(-1)[0]?.amount ?? 0} DA</strong>
                      </div>
                      <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl flex flex-col justify-between">
                        <span className="text-muted block text-[9px] uppercase">Absences (Coût)</span>
                        <strong className="text-danger mt-0.5">
                          {getTeacherAbsences(t.id).length} ({getTeacherAbsences(t.id).reduce((s, a) => s + a.cost, 0)} DA)
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-line/60 pt-3 mt-4 flex items-center justify-between">
                  <span className="text-[10px] text-muted flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${unpaidMonths.length > 0 || unpaidSess.length > 0 ? "bg-warning animate-pulse" : "bg-success"}`} />
                    {t.paymentType === "monthly" ? `${unpaidMonths.length} mois dus` : `${unpaidSess.length} séances dues`}
                  </span>

                  <Badge tone={unpaidMonths.length > 0 || unpaidSess.length > 0 ? "warning" : "success"} className="font-mono font-bold text-[10px]">
                    {t.paymentType === "monthly"
                      ? `${unpaidMonths.length * (t.monthlyAmount ?? 0)} DA`
                      : `${unpaidSess.reduce((sum, s) => sum + s.amount, 0)} DA`}
                  </Badge>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/* Creation Modal */}
      <Modal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Créer un enseignant" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Prénom *</label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Nom *</label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Téléphone *</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+213 5XX XX XX XX" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Email (Login) *</label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@ecole.com" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Mot de passe *</label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6 caractères min." />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Type de rémunération</label>
            <Select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as "monthly" | "percentage")}
              className="w-full"
            >
              <option value="percentage">Pourcentage par élève/présence</option>
              <option value="monthly">Fixe mensuel</option>
            </Select>
          </div>

          {paymentType === "monthly" ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Montant mensuel (DA)</label>
                <Input
                  type="number"
                  value={monthlyAmount || ""}
                  onChange={(e) => setMonthlyAmount(Number(e.target.value))}
                  placeholder="Ex: 45000"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Date de début de contrat</label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Pourcentage par séance (%)</label>
              <Input
                type="number"
                value={percentage || ""}
                onChange={(e) => setPercentage(Number(e.target.value))}
                placeholder="Ex: 55"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleCreateTeacher}>Créer</Button>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Modifier l'enseignant" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Prénom</label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Nom</label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Téléphone</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Email</label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Nouveau mot de passe</label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Laisser vide pour ne pas changer" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Type de rémunération</label>
            <Select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as "monthly" | "percentage")}
              className="w-full"
            >
              <option value="percentage">Pourcentage</option>
              <option value="monthly">Fixe mensuel</option>
            </Select>
          </div>
          {paymentType === "monthly" ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Salaire mensuel (DA)</label>
                <Input
                  type="number"
                  value={monthlyAmount || ""}
                  onChange={(e) => setMonthlyAmount(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Date début</label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Pourcentage (%)</label>
              <Input
                type="number"
                value={percentage || ""}
                onChange={(e) => setPercentage(Number(e.target.value))}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsEditOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleEditTeacher}>Enregistrer</Button>
        </div>
      </Modal>

      {/* Details Modal */}
      <Modal open={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Détails de l'Enseignant" wide>
        {selectedTeacher && (
          <div className="space-y-5">
            {/* Header info */}
            <div className="bg-canvas border border-line p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-primary/10 border border-primary/20 text-primary font-bold text-sm flex items-center justify-center tracking-wider">
                  {selectedTeacher.firstName.charAt(0).toUpperCase()}{selectedTeacher.lastName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-bold text-base text-ink">{selectedTeacher.firstName} {selectedTeacher.lastName}</h3>
                  <span className="text-xs text-muted block">Téléphone: {selectedTeacher.phone} | Email: {selectedTeacher.email}</span>
                </div>
              </div>
              <Badge tone="primary" className="text-xs px-3 py-1 font-bold">
                {selectedTeacher.paymentType === "monthly"
                  ? `Salaire Fixe: ${selectedTeacher.monthlyAmount} DA / mois`
                  : `Rémunération: ${selectedTeacher.percentage}% / séance`}
              </Badge>
            </div>

            {/* Modal Tabs navigation */}
            <div className="flex border-b border-line gap-1.5 pb-0.5">
              <button
                onClick={() => setDetailsTab("info")}
                className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-colors border-b-2 -mb-0.5 ${
                  detailsTab === "info"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted hover:text-ink hover:bg-canvas/50"
                }`}
              >
                📅 Emploi du Temps
              </button>
              <button
                onClick={() => setDetailsTab("finance")}
                className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-colors border-b-2 -mb-0.5 ${
                  detailsTab === "finance"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted hover:text-ink hover:bg-canvas/50"
                }`}
              >
                💸 Historique Financier
              </button>
              <button
                onClick={() => setDetailsTab("sessions")}
                className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-colors border-b-2 -mb-0.5 ${
                  detailsTab === "sessions"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted hover:text-ink hover:bg-canvas/50"
                }`}
              >
                📊 Historique des Séances
              </button>
            </div>

            {/* TAB CONTENT: Info / Schedule */}
            {detailsTab === "info" && (
              <div className="space-y-4">
                <div className="border border-line rounded-2xl p-4 bg-surface">
                  <h4 className="font-bold text-ink mb-3 flex items-center gap-2 text-xs uppercase tracking-wider text-muted">
                    📅 Séances de cours programmées
                  </h4>
                  {sessions.filter((s) => s.teacherId === selectedTeacher.id).length === 0 ? (
                    <p className="text-xs text-muted italic text-center py-6">Aucune séance programmée pour cet enseignant.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
                      {sessions
                        .filter((s) => s.teacherId === selectedTeacher.id)
                        .map((s) => (
                          <div key={s.id} className="text-xs bg-canvas/30 p-3 rounded-xl border border-line flex flex-col justify-between gap-1">
                            <div>
                              <strong className="text-ink block text-sm">
                                {modules.find((m) => m.id === s.moduleId)?.name}
                              </strong>
                              <span className="text-muted block text-[10px] uppercase font-semibold mt-0.5">
                                Groupe: {groups.find((g) => g.id === s.groupId)?.name || "Inconnu"} | Salle: {classes.find((c) => c.id === s.classId)?.name}
                              </span>
                            </div>
                            <div className="text-primary font-bold mt-1 text-[11px] font-mono">
                              Horaires: {s.startTime} - {s.endTime}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT: Finance History */}
            {detailsTab === "finance" && (() => {
              const teacherAcomptes = getTeacherAcomptes(selectedTeacher.id).map(ac => ({
                id: ac.id,
                type: "acompte" as const,
                title: "Acompte (Avance)",
                amount: ac.amount,
                date: ac.date,
                description: ac.description,
                color: "text-warning bg-warning/5 border-warning/20",
              }));

              const teacherAbsences = getTeacherAbsences(selectedTeacher.id).map(ab => ({
                id: ab.id,
                type: "absence" as const,
                title: "Retenue pour Absence",
                amount: ab.cost,
                date: ab.date,
                description: ab.description,
                color: "text-danger bg-danger/5 border-danger/20",
              }));

              const teacherPayments = cash
                .filter(c => c.type === "teacher_payment" && (c.description.toLowerCase().includes(selectedTeacher.lastName.toLowerCase()) || c.description.toLowerCase().includes(selectedTeacher.firstName.toLowerCase())))
                .map(pay => ({
                  id: pay.id,
                  type: "payment" as const,
                  title: "Règlement de Salaire",
                  amount: Math.abs(pay.amount),
                  date: pay.date.split("T")[0],
                  description: pay.description,
                  color: "text-success bg-success/5 border-success/20",
                }));

              const allFinancialLogs = [...teacherAcomptes, ...teacherAbsences, ...teacherPayments].sort(
                (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
              );

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold">Total Acomptes</span>
                      <strong className="text-warning text-base font-mono">{teacherAcomptes.reduce((s, a) => s + a.amount, 0)} DA</strong>
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold">Total Absences</span>
                      <strong className="text-danger text-base font-mono">{teacherAbsences.reduce((s, a) => s + a.amount, 0)} DA</strong>
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold">Total Payé</span>
                      <strong className="text-success text-base font-mono">{teacherPayments.reduce((s, a) => s + a.amount, 0)} DA</strong>
                    </div>
                  </div>

                  <div className="border border-line rounded-2xl p-4 bg-surface">
                    <h4 className="font-bold text-ink mb-3 text-xs uppercase tracking-wider text-muted">
                      🕒 Journal des transactions financières
                    </h4>
                    {allFinancialLogs.length === 0 ? (
                      <p className="text-xs text-muted italic text-center py-6">Aucun acompte, absence ou paiement enregistré.</p>
                    ) : (
                      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {allFinancialLogs.map((log, index) => (
                          <div
                            key={`${log.id}-${index}`}
                            className={`flex items-center justify-between p-3 rounded-xl border text-xs gap-3 ${log.color}`}
                          >
                            <div className="min-w-0">
                              <span className="font-bold block text-ink">{log.title}</span>
                              <span className="text-[10px] text-muted block truncate mt-0.5">{log.description}</span>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="font-mono font-bold block text-sm">
                                {log.type === "absence" ? "-" : ""}{log.amount} DA
                              </span>
                              <span className="text-[9px] text-muted block font-mono">{log.date}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* TAB CONTENT: Sessions History */}
            {detailsTab === "sessions" && (() => {
              const allTeacherSessions = unpaidTeacher.filter((u) => u.teacherId === selectedTeacher.id);
              const unpaidSessions = allTeacherSessions.filter((u) => !u.paid);
              const paidSessions = allTeacherSessions.filter((u) => u.paid);

              const filteredSessionsList = allTeacherSessions.filter((u) => {
                if (sessionFilter === "paid") return u.paid;
                if (sessionFilter === "unpaid") return !u.paid;
                return true;
              }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-canvas border border-line p-3 rounded-xl flex items-center justify-between">
                      <div>
                        <span className="text-muted text-[10px] uppercase block font-semibold">Total Séances</span>
                        <strong className="text-ink text-base font-mono">{allTeacherSessions.length}</strong>
                      </div>
                      <Badge tone="primary">Toutes</Badge>
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl flex items-center justify-between">
                      <div>
                        <span className="text-muted text-[10px] uppercase block font-semibold">Réglées / Payées</span>
                        <strong className="text-success text-base font-mono">{paidSessions.length}</strong>
                      </div>
                      <Badge tone="success">Payé</Badge>
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl flex items-center justify-between">
                      <div>
                        <span className="text-muted text-[10px] uppercase block font-semibold">En attente</span>
                        <strong className="text-warning text-base font-mono">{unpaidSessions.length}</strong>
                      </div>
                      <Badge tone="warning">Dues ({unpaidSessions.reduce((s, a) => s + a.amount, 0)} DA)</Badge>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={sessionFilter === "all" ? "primary" : "outline"}
                      onClick={() => setSessionFilter("all")}
                    >
                      Toutes ({allTeacherSessions.length})
                    </Button>
                    <Button
                      size="sm"
                      variant={sessionFilter === "paid" ? "primary" : "outline"}
                      onClick={() => setSessionFilter("paid")}
                    >
                      Payées ({paidSessions.length})
                    </Button>
                    <Button
                      size="sm"
                      variant={sessionFilter === "unpaid" ? "primary" : "outline"}
                      onClick={() => setSessionFilter("unpaid")}
                    >
                      Dues ({unpaidSessions.length})
                    </Button>
                  </div>

                  <div className="border border-line rounded-2xl overflow-hidden bg-surface">
                    <div className="max-h-60 overflow-y-auto">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead>
                          <tr className="bg-canvas border-b border-line text-[10px] text-muted uppercase font-bold tracking-wider">
                            <th className="p-3">Date</th>
                            <th className="p-3">Module / Groupe</th>
                            <th className="p-3">Montant Dû</th>
                            <th className="p-3 text-right">Statut</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredSessionsList.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="p-6 text-center text-muted italic">Aucune séance enregistrée pour cet enseignant.</td>
                            </tr>
                          ) : (
                            filteredSessionsList.map((u) => {
                              const moduleName = modules.find((m) => m.id === sessions.find((s) => s.id === u.sessionId)?.moduleId)?.name || "Séance";
                              const groupName = groups.find((g) => g.id === sessions.find((s) => s.id === u.sessionId)?.groupId)?.name || "Groupe";

                              return (
                                <tr key={u.id} className="border-b border-line last:border-0 hover:bg-canvas/30 transition-colors">
                                  <td className="p-3 font-mono text-[10px] text-ink">{u.date}</td>
                                  <td className="p-3">
                                    <span className="font-bold text-ink block">{moduleName}</span>
                                    <span className="text-[10px] text-muted">{groupName}</span>
                                  </td>
                                  <td className="p-3 font-bold text-primary font-mono">{u.amount} DA</td>
                                  <td className="p-3 text-right">
                                    <Badge tone={u.paid ? "success" : "warning"} className="font-bold">
                                      {u.paid ? "Payée" : "En attente"}
                                    </Badge>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="flex justify-end pt-3 border-t border-line">
              <Button onClick={() => setIsDetailsOpen(false)}>Fermer</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Acompte Modal */}
      <Modal open={isAcompteOpen} onClose={() => setIsAcompteOpen(false)} title="Enregistrer un acompte">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Montant de l'acompte (DA) *</label>
            <Input
              type="number"
              value={amount || ""}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder="Ex: 5000"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Description / Motif</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Avance" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date</label>
            <Input type="date" value={actionDate} onChange={(e) => setActionDate(e.target.value)} />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsAcompteOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreateAcompte}>Confirmer</Button>
          </div>
        </div>
      </Modal>

      {/* Absence Modal */}
      <Modal open={isAbsenceOpen} onClose={() => setIsAbsenceOpen(false)} title="Signaler une absence / retenue">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Retenue financière (Coût - DA)</label>
            <Input
              type="number"
              value={amount || ""}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder="Ex: 1000"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Motif de l'absence</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Absence non justifiée" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date</label>
            <Input type="date" value={actionDate} onChange={(e) => setActionDate(e.target.value)} />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsAbsenceOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreateAbsence}>Enregistrer</Button>
          </div>
        </div>
      </Modal>

      {/* Salary Payment Settlement Modal */}
      <Modal open={isPayOpen} onClose={() => setIsPayOpen(false)} title="Règlement financier de l'enseignant">
        <div className="space-y-4">
          {selectedTeacher && (
            <>
              <div className="bg-canvas border border-line p-4 rounded-xl text-xs space-y-2">
                <span className="text-[10px] text-muted block uppercase">Contrat</span>
                <strong className="text-ink text-sm block">
                  {selectedTeacher.firstName} {selectedTeacher.lastName}
                </strong>
                <span className="text-muted block">
                  Type: {selectedTeacher.paymentType === "monthly" ? "Fixe Mensuel" : "Au Pourcentage"}
                </span>

                {selectedTeacher.paymentType === "percentage" ? (
                  <>
                    <div className="flex justify-between border-t border-line/50 pt-2 mt-2">
                      <span>Séances impayées accumulées:</span>
                      <strong className="text-ink">{getTeacherUnpaidSessions(selectedTeacher.id).length} séances</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Rémunération séances brute:</span>
                      <strong className="text-primary">
                        {getTeacherUnpaidSessions(selectedTeacher.id).reduce((sum, s) => sum + s.amount, 0)} DA
                      </strong>
                    </div>
                    <div className="flex justify-between text-danger">
                      <span>Déduction Acomptes:</span>
                      <strong>
                        -{getTeacherAcomptes(selectedTeacher.id).reduce((sum, a) => sum + a.amount, 0)} DA
                      </strong>
                    </div>
                    <div className="flex justify-between text-danger">
                      <span>Déduction Absences:</span>
                      <strong>
                        -{getTeacherAbsences(selectedTeacher.id).reduce((sum, ab) => sum + ab.cost, 0)} DA
                      </strong>
                    </div>
                    <div className="flex justify-between border-t border-line pt-2 font-bold text-sm text-success">
                      <span>Net à Payer:</span>
                      <span>
                        {getTeacherUnpaidSessions(selectedTeacher.id).reduce((sum, s) => sum + s.amount, 0) -
                          getTeacherAcomptes(selectedTeacher.id).reduce((sum, a) => sum + a.amount, 0) -
                          getTeacherAbsences(selectedTeacher.id).reduce((sum, ab) => sum + ab.cost, 0)}{" "}
                        DA
                      </span>
                    </div>

                    <div className="pt-4 flex flex-col sm:flex-row justify-end gap-2">
                      <Button variant="outline" onClick={() => setIsUnpaidDetailOpen(true)}>
                        📋 Calculer & voir le détail des séances
                      </Button>
                      <Button onClick={() => handlePaymentSubmit()}>Valider le paiement de séance</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="border-t border-line/50 pt-2 mt-2">
                      <span className="block text-[10px] text-muted uppercase mb-1">Mois impayés</span>
                      {getUnpaidMonthsList(selectedTeacher).length === 0 ? (
                        <p className="text-xs text-success italic font-bold">À jour pour tous les mois.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {getUnpaidMonthsList(selectedTeacher).map((m) => (
                            <div key={m.key} className="flex justify-between items-center p-2 bg-surface border border-line rounded-lg">
                              <div>
                                <span className="font-bold text-ink">{m.label}</span>
                                <span className="text-[10px] text-muted block">{m.amount} DA</span>
                              </div>
                              <Button
                                size="sm"
                                onClick={() => handlePaymentSubmit(m.key)}
                                className="text-xs"
                              >
                                Payer {m.amount} DA
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Unpaid séances calculation detail — every timing, student, hour and amount */}
      <Modal
        open={isUnpaidDetailOpen}
        onClose={() => setIsUnpaidDetailOpen(false)}
        title="Calcul des séances non payées"
        wide
      >
        {selectedTeacher && (() => {
          const detail = buildUnpaidDetail(selectedTeacher.id);
          const totalShare = detail.reduce((s, d) => s + d.totalPayout, 0);
          const totalFees = detail.reduce((s, d) => s + d.totalFees, 0);
          const totalPresences = detail.reduce((s, d) => s + d.students.length, 0);
          const totAcomptes = getTeacherAcomptes(selectedTeacher.id).reduce((s, a) => s + a.amount, 0);
          const totAbsences = getTeacherAbsences(selectedTeacher.id).reduce((s, a) => s + a.cost, 0);
          const net = totalShare - totAcomptes - totAbsences;

          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                  <span className="text-muted text-[10px] uppercase block font-semibold">Séances dues</span>
                  <strong className="text-ink text-base font-mono">{detail.length}</strong>
                </div>
                <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                  <span className="text-muted text-[10px] uppercase block font-semibold">Présences</span>
                  <strong className="text-ink text-base font-mono">{totalPresences}</strong>
                </div>
                <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                  <span className="text-muted text-[10px] uppercase block font-semibold">Revenu élèves</span>
                  <strong className="text-success text-base font-mono">{totalFees} DA</strong>
                </div>
                <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                  <span className="text-muted text-[10px] uppercase block font-semibold">Part enseignant</span>
                  <strong className="text-primary text-base font-mono">{totalShare} DA</strong>
                </div>
              </div>

              {detail.length === 0 ? (
                <p className="text-xs text-muted italic text-center py-6">
                  Aucune séance non payée pour cet enseignant.
                </p>
              ) : (
                <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
                  {detail.map((d) => (
                    <div key={`${d.dateKey}_${d.sessionId}`} className="border border-line rounded-2xl bg-canvas/20 p-3">
                      <div className="flex flex-wrap justify-between items-center gap-2 border-b border-line pb-2 mb-2 text-xs">
                        <div>
                          <strong className="text-ink block text-sm">
                            📅 {new Date(`${d.dateKey}T12:00:00`).toLocaleDateString("fr-FR")} — {d.moduleName}
                          </strong>
                          <span className="text-muted">
                            {d.className} | Groupe: {d.groupName} |{" "}
                            <span className="font-mono">{d.startTime} - {d.endTime}</span>
                          </span>
                        </div>
                        <Badge tone="primary" className="font-mono font-bold">+{d.totalPayout} DA</Badge>
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-[10px] uppercase text-muted font-bold text-left">
                            <th className="py-1">Élève</th>
                            <th className="py-1">Heure</th>
                            <th className="py-1">Statut</th>
                            <th className="py-1 text-right">Tarif élève</th>
                            <th className="py-1 text-right">Part prof ({selectedTeacher.percentage ?? 0}%)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.students.map((st, i) => (
                            <tr key={i} className="border-t border-line/50">
                              <td className="py-1.5 font-semibold text-ink">{st.name}</td>
                              <td className="py-1.5 font-mono">{st.time}</td>
                              <td className="py-1.5">
                                <Badge tone={st.status === "En Retard" ? "warning" : "success"} className="text-[9px]">
                                  {st.status}
                                </Badge>
                              </td>
                              <td className="py-1.5 text-right font-mono">{st.fee} DA</td>
                              <td className="py-1.5 text-right font-mono font-bold text-primary">{st.share} DA</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-canvas border border-line rounded-2xl p-3 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span>Part enseignant brute ({detail.length} séance(s), {totalPresences} présence(s)) :</span>
                  <strong className="text-primary">{totalShare} DA</strong>
                </div>
                <div className="flex justify-between text-danger">
                  <span>Acomptes à déduire :</span>
                  <strong>-{totAcomptes} DA</strong>
                </div>
                <div className="flex justify-between text-danger">
                  <span>Retenues d'absences :</span>
                  <strong>-{totAbsences} DA</strong>
                </div>
                <div className="flex justify-between border-t border-line pt-1.5 font-bold text-sm text-success">
                  <span>NET À PAYER :</span>
                  <span>{net} DA</span>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsUnpaidDetailOpen(false)}>Fermer</Button>
                <Button onClick={() => handlePaymentSubmit()} disabled={net <= 0}>
                  Payer {net} DA maintenant
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Print Salary Modal */}
      <Modal open={isPrintOpen} onClose={() => setIsPrintOpen(false)} title="Sélectionner la période d'impression">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Date de début</label>
              <Input type="date" value={printStart} onChange={(e) => setPrintStart(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Date de fin</label>
              <Input type="date" value={printEnd} onChange={(e) => setPrintEnd(e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsPrintOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handlePrintTeacherReport}>Générer & Imprimer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
