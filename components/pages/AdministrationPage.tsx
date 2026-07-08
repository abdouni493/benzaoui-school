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
  User,
  Phone,
  DollarSign,
  Calendar,
  Clock,
  History,
  X,
} from "lucide-react";
import type { ReceptionPaymentType, ReceptionStaff, TeacherAcompte, TeacherAbsence, WorkerRole } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

const ROLE_LABELS: Record<WorkerRole, string> = {
  reception: "Réception",
  security: "Agent de sécurité",
  menage: "Ménage",
};

const PAYMENT_LABELS: Record<ReceptionPaymentType, string> = {
  monthly: "Mensuel",
  daily: "Journalier",
  half_day: "Demi-journée",
};

const PAYMENT_UNITS: Record<ReceptionPaymentType, string> = {
  monthly: "m",
  daily: "j",
  half_day: "½j",
};

export function AdministrationPage() {
  const {
    reception,
    acomptes,
    absences,
    cash,
    push,
    deleteFrom,
    updateItem,
  } = useData();

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isAcompteOpen, setIsAcompteOpen] = useState(false);
  const [isAbsenceOpen, setIsAbsenceOpen] = useState(false);
  const [isPayOpen, setIsPayOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<ReceptionStaff | null>(null);

  // Form: Create/Edit Worker
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<WorkerRole>("reception");
  const [paymentType, setPaymentType] = useState<ReceptionPaymentType>("monthly");
  const [salary, setSalary] = useState<number>(0);
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);

  // Form: Acompte / Absence
  const [amount, setAmount] = useState<number>(0);
  const [description, setDescription] = useState("");
  const [actionDate, setActionDate] = useState(new Date().toISOString().split("T")[0]);

  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [detailsTab, setDetailsTab] = useState<"info" | "finance" | "unpaid">("info");

  // Helpers
  // We reuse acomptes and absences collection using staff.id as teacherId
  const getStaffAcomptes = (sid: string) => acomptes.filter((a) => a.teacherId === sid);
  const getStaffAbsences = (sid: string) => absences.filter((a) => a.teacherId === sid);

  const getPaymentHistory = (staff: ReceptionStaff) => {
    return cash.filter(
      (c) =>
        c.type === "teacher_payment" &&
        c.description.toLowerCase().includes(staff.lastName.toLowerCase())
    );
  };

  // Unpaid salary periods
  const getUnpaidPeriods = (staff: ReceptionStaff) => {
    if (!staff.startDate) return [];
    const start = new Date(staff.startDate);
    const end = new Date();

    if (staff.paymentType === "monthly") {
      const months: { label: string; key: string; amount: number }[] = [];
      let current = new Date(start.getFullYear(), start.getMonth(), 1);

      while (current <= end) {
        const monthLabel = current.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
        const monthKey = `${String(current.getMonth() + 1).padStart(2, "0")}/${current.getFullYear()}`;

        // Check if paid in cash
        const isPaid = cash.some(
          (c) =>
            c.type === "teacher_payment" &&
            c.description.includes(staff.lastName) &&
            c.description.includes(monthKey)
        );

        if (!isPaid) {
          months.push({
            label: monthLabel,
            key: monthKey,
            amount: staff.salary,
          });
        }
        current.setMonth(current.getMonth() + 1);
      }
      return months;
    } else {
      // Daily
      const days: { label: string; key: string; amount: number }[] = [];
      let current = new Date(start);
      // Limit list to last 15 days to avoid overflow
      const limitDate = new Date();
      limitDate.setDate(limitDate.getDate() - 15);
      if (current < limitDate) {
        current = limitDate;
      }

      while (current <= end) {
        const dayLabel = current.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
        const dayKey = current.toISOString().split("T")[0];

        const isPaid = cash.some(
          (c) =>
            c.type === "teacher_payment" &&
            c.description.includes(staff.lastName) &&
            c.description.includes(dayKey)
        );

        if (!isPaid) {
          days.push({
            label: dayLabel,
            key: dayKey,
            amount: staff.salary,
          });
        }
        current.setDate(current.getDate() + 1);
      }
      return days;
    }
  };

  const handleCreateStaff = async () => {
    if (!firstName || !lastName || !phone) {
      alert("Champs obligatoires manquants.");
      return;
    }

    // Ménage never gets a login; Réception / Agent de sécurité only get one
    // when the (optional) credential fields are actually filled in.
    const wantsAccount = role !== "menage" && (email.trim() !== "" || password !== "");

    if (wantsAccount) {
      if (!email.trim()) {
        alert("Veuillez saisir un email de connexion (ou laisser les deux champs vides pour créer sans compte).");
        return;
      }
      if (password.length < 6) {
        alert("Le mot de passe doit contenir au moins 6 caractères.");
        return;
      }

      try {
        const { id: staffId } = await createRoleUser({
          role: "reception",
          email,
          password,
          firstName,
          lastName,
          phone,
          paymentType,
          startDate,
          salary,
          workerRole: role,
        });
        push("reception", {
          id: staffId,
          firstName,
          lastName,
          phone,
          email,
          paymentType,
          startDate,
          salary,
          role,
        });
      } catch (err) {
        alert(err instanceof Error ? err.message : "Erreur lors de la création du compte.");
        return;
      }
    } else {
      // Worker without login: plain table row, no auth user is created.
      const workerId = uid("wrk");
      const supabase = createClient();
      const { error } = await supabase.from("reception_staff").insert({
        id: workerId,
        first_name: firstName,
        last_name: lastName,
        phone,
        email: email.trim() || null,
        payment_type: paymentType,
        start_date: startDate,
        salary,
        role,
      });
      if (error) {
        alert(`Erreur lors de la création du travailleur: ${error.message}`);
        return;
      }
      push("reception", {
        id: workerId,
        firstName,
        lastName,
        phone,
        email: email.trim(),
        paymentType,
        startDate,
        salary,
        role,
      });
    }

    setIsCreateOpen(false);
    resetForm();
  };

  const handleEditStaff = async () => {
    if (!selectedStaff) return;

    if (password && role !== "menage") {
      try {
        await resetUserPassword(selectedStaff.id, password);
      } catch (err) {
        // Workers created without credentials have no auth account to update.
        alert(
          err instanceof Error
            ? `${err.message} — ce travailleur n'a probablement pas de compte de connexion.`
            : "Erreur lors du changement de mot de passe.",
        );
        return;
      }
    }

    updateItem("reception", selectedStaff.id, {
      firstName,
      lastName,
      phone,
      email,
      role,
      paymentType,
      startDate,
      salary,
    });
    setIsEditOpen(false);
    resetForm();
  };

  const handleDelete = (id: string) => {
    if (confirm("Êtes-vous sûr de vouloir supprimer ce travailleur ?")) {
      deleteFrom("reception", id);
      setActiveMenuId(null);
    }
  };

  const handleCreateAcompte = () => {
    if (!selectedStaff || amount <= 0) return;
    push("acomptes", {
      id: uid("ac"),
      teacherId: selectedStaff.id, // staff ID
      amount,
      description: description || "Acompte réception",
      date: actionDate,
    });

    push("cash", {
      id: uid("csh"),
      type: "acompte",
      amount: -amount,
      date: new Date().toISOString(),
      description: `Acompte versé à ${selectedStaff.firstName} ${selectedStaff.lastName} (${description})`,
    });

    setIsAcompteOpen(false);
    setAmount(0);
    setDescription("");
  };

  const handleCreateAbsence = () => {
    if (!selectedStaff || amount <= 0) return;
    push("absences", {
      id: uid("ab"),
      teacherId: selectedStaff.id, // staff ID
      cost: amount,
      description: description || "Absence agent",
      date: actionDate,
    });

    setIsAbsenceOpen(false);
    setAmount(0);
    setDescription("");
  };

  const handlePaymentSubmit = (periodKey: string, baseAmount: number) => {
    if (!selectedStaff) return;

    // Fetch matching advances and absences for this staff
    const staffAcomptes = getStaffAcomptes(selectedStaff.id);
    const staffAbsences = getStaffAbsences(selectedStaff.id);

    const totalAcomptes = staffAcomptes.reduce((sum, a) => sum + a.amount, 0);
    const totalAbsences = staffAbsences.reduce((sum, ab) => sum + ab.cost, 0);

    const netAmount = baseAmount - totalAcomptes - totalAbsences;

    // Clear paid acomptes and absences
    staffAcomptes.forEach((a) => deleteFrom("acomptes", a.id));
    staffAbsences.forEach((ab) => deleteFrom("absences", ab.id));

    // Register cash payout
    push("cash", {
      id: uid("csh"),
      type: "teacher_payment", // treated as staff payout
      amount: -netAmount,
      date: new Date().toISOString(),
      description: `Règlement salaire ${selectedStaff.firstName} ${selectedStaff.lastName} pour la période: ${periodKey} (Net: ${netAmount} DA)`,
    });

    setIsPayOpen(false);
  };

  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setPhone("");
    setEmail("");
    setPassword("");
    setRole("reception");
    setPaymentType("monthly");
    setSalary(0);
    setSelectedStaff(null);
  };

  const openEdit = (staff: ReceptionStaff) => {
    setSelectedStaff(staff);
    setFirstName(staff.firstName);
    setLastName(staff.lastName);
    setPhone(staff.phone);
    setEmail(staff.email);
    setPassword("");
    setRole(staff.role ?? "reception");
    setPaymentType(staff.paymentType);
    setStartDate(staff.startDate);
    setSalary(staff.salary);
    setIsEditOpen(true);
    setActiveMenuId(null);
  };

  const openDetails = (staff: ReceptionStaff) => {
    setSelectedStaff(staff);
    setDetailsTab("info");
    setIsDetailsOpen(true);
    setActiveMenuId(null);
  };

  const openAcompte = (staff: ReceptionStaff) => {
    setSelectedStaff(staff);
    setAmount(0);
    setDescription("Avance sur salaire");
    setIsAcompteOpen(true);
    setActiveMenuId(null);
  };

  const openAbsence = (staff: ReceptionStaff) => {
    setSelectedStaff(staff);
    setAmount(0);
    setDescription("Retenue pour absence");
    setIsAbsenceOpen(true);
    setActiveMenuId(null);
  };

  const openPay = (staff: ReceptionStaff) => {
    setSelectedStaff(staff);
    setIsPayOpen(true);
    setActiveMenuId(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <PageHeader emoji="👥" title="Travailleurs" subtitle="Gérer le personnel : réception, sécurité et ménage" />
        <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} className="flex items-center gap-2">
          <Plus className="h-4 w-4" /> Nouveau Travailleur
        </Button>
      </div>

      {/* Staff Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {reception.map((staff) => {
          const unpaid = getUnpaidPeriods(staff);
          const acomptesList = getStaffAcomptes(staff.id);
          const absencesList = getStaffAbsences(staff.id);
          const totalUnpaidAmount = unpaid.reduce((sum, p) => sum + p.amount, 0);

          return (
            <Card
              key={staff.id}
              className={`relative transition-all duration-300 ${
                activeMenuId === staff.id
                  ? "z-30 scale-[1.02] ring-2 ring-primary/45 shadow-2xl"
                  : "z-10 hover:z-20 hover:shadow-lg hover:-translate-y-0.5 border border-line"
              }`}
            >
              <CardBody className="flex flex-col justify-between min-h-[220px] relative p-5">
                {/* Actions overlay panel */}
                {activeMenuId === staff.id && (
                  <div className="absolute inset-0 bg-surface/98 backdrop-blur-md rounded-2xl p-4 flex flex-col justify-between z-20 animate-in fade-in zoom-in-95 duration-200 border border-primary/20">
                    <div className="flex justify-between items-center border-b border-line pb-2">
                      <span className="font-bold text-[10px] text-muted uppercase tracking-wider">
                        Actions: {staff.firstName} {staff.lastName}
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
                        onClick={() => openDetails(staff)}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                      >
                        <Eye className="h-3.5 w-3.5" /> Détails
                      </button>
                      <button
                        onClick={() => openPay(staff)}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-success/15 text-success border border-success/30 hover:bg-success/25 transition-colors"
                      >
                        <DollarSign className="h-3.5 w-3.5" /> Payer
                      </button>
                      <button
                        onClick={() => openAcompte(staff)}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" /> Acompte
                      </button>
                      <button
                        onClick={() => openAbsence(staff)}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25 transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" /> Absence
                      </button>
                      <button
                        onClick={() => openEdit(staff)}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                      >
                        <Edit className="h-3.5 w-3.5" /> Modifier
                      </button>
                    </div>

                    <div className="border-t border-line pt-2">
                      <button
                        onClick={() => handleDelete(staff.id)}
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
                        {staff.firstName.slice(0, 1).toUpperCase()}{staff.lastName.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-ink hover:text-primary transition-colors truncate">
                          {staff.firstName} {staff.lastName}
                        </h4>
                        <span className="text-[10px] text-muted block font-mono truncate">{staff.phone}</span>
                        <Badge tone={staff.role === "menage" ? "neutral" : staff.role === "security" ? "warning" : "primary"} className="text-[9px] px-1.5 py-0 mt-0.5">
                          {ROLE_LABELS[staff.role ?? "reception"]}
                        </Badge>
                      </div>
                    </div>

                    <button
                      onClick={() => setActiveMenuId(activeMenuId === staff.id ? null : staff.id)}
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
                          {PAYMENT_LABELS[staff.paymentType]}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-muted block uppercase font-semibold">Rémunération</span>
                        <span className="font-bold text-primary">
                          {staff.salary} DA / {PAYMENT_UNITS[staff.paymentType]}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl flex flex-col justify-between">
                        <span className="text-muted block text-[9px] uppercase">Dernier acompte</span>
                        <strong className="text-ink mt-0.5">{acomptesList.slice(-1)[0]?.amount ?? 0} DA</strong>
                      </div>
                      <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl flex flex-col justify-between">
                        <span className="text-muted block text-[9px] uppercase">Absences (Coût)</span>
                        <strong className="text-danger mt-0.5">
                          {absencesList.length} ({absencesList.reduce((s, a) => s + a.cost, 0)} DA)
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-line/60 pt-3 mt-4 flex items-center justify-between">
                  <span className="text-[10px] text-muted flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${unpaid.length > 0 ? "bg-warning animate-pulse" : "bg-success"}`} />
                    {unpaid.length} période(s) due(s)
                  </span>

                  <Badge tone={unpaid.length > 0 ? "warning" : "success"} className="font-mono font-bold text-[10px]">
                    {totalUnpaidAmount} DA
                  </Badge>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/* Creation Modal */}
      <Modal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Créer un travailleur" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Prénom *</label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Nom *</label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom de famille" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Téléphone *</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+213 XXXXXXXXX" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Rôle *</label>
            <Select value={role} onChange={(e) => setRole(e.target.value as WorkerRole)} className="w-full">
              <option value="reception">Réception</option>
              <option value="security">Agent de sécurité</option>
              <option value="menage">Ménage</option>
            </Select>
          </div>

          {role !== "menage" ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Email (Login) — optionnel</label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@ecole.com" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Mot de passe — optionnel</label>
                <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6 caractères min." />
              </div>

              <div className="md:col-span-2 bg-primary-50/50 border border-line rounded-xl p-2.5 text-[10px] text-muted">
                Laissez l&apos;email et le mot de passe vides pour créer ce travailleur <strong>sans compte de connexion</strong>.
              </div>
            </>
          ) : (
            <div className="md:col-span-1 bg-canvas border border-line rounded-xl p-2.5 text-[10px] text-muted flex items-center">
              Le rôle <strong className="mx-1">Ménage</strong> n&apos;a jamais de compte de connexion.
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Type de paiement</label>
            <Select value={paymentType} onChange={(e) => setPaymentType(e.target.value as ReceptionPaymentType)} className="w-full">
              <option value="monthly">Mensuel</option>
              <option value="daily">Journalier</option>
              <option value="half_day">Demi-journée</option>
            </Select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Salaire (DA)</label>
            <Input type="number" value={salary || ""} onChange={(e) => setSalary(Number(e.target.value))} placeholder="Ex: 35000" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date d'embauche</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleCreateStaff}>Créer</Button>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Modifier le travailleur" wide>
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
            <label className="block text-xs font-semibold text-muted mb-1">Rôle</label>
            <Select value={role} onChange={(e) => setRole(e.target.value as WorkerRole)} className="w-full">
              <option value="reception">Réception</option>
              <option value="security">Agent de sécurité</option>
              <option value="menage">Ménage</option>
            </Select>
          </div>
          {role !== "menage" && (
            <>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Email</label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Nouveau mot de passe</label>
                <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Laisser vide pour ne pas changer" />
              </div>
            </>
          )}
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Type Rémunération</label>
            <Select value={paymentType} onChange={(e) => setPaymentType(e.target.value as ReceptionPaymentType)} className="w-full">
              <option value="monthly">Mensuel</option>
              <option value="daily">Journalier</option>
              <option value="half_day">Demi-journée</option>
            </Select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Salaire (DA)</label>
            <Input type="number" value={salary || ""} onChange={(e) => setSalary(Number(e.target.value))} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date embauche</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsEditOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleEditStaff}>Enregistrer</Button>
        </div>
      </Modal>

      {/* Details Modal */}
      <Modal open={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Fiche du Travailleur" wide>
        {selectedStaff && (
          <div className="space-y-5 text-xs">
            {/* Header info */}
            <div className="bg-canvas border border-line p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-primary/10 border border-primary/20 text-primary font-bold text-sm flex items-center justify-center tracking-wider">
                  {selectedStaff.firstName.slice(0, 1).toUpperCase()}{selectedStaff.lastName.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-bold text-base text-ink">{selectedStaff.firstName} {selectedStaff.lastName}</h3>
                  <span className="text-xs text-muted block">Téléphone: {selectedStaff.phone} | Email: {selectedStaff.email}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={selectedStaff.role === "menage" ? "neutral" : selectedStaff.role === "security" ? "warning" : "primary"} className="text-xs px-3 py-1 font-bold">
                  {ROLE_LABELS[selectedStaff.role ?? "reception"]}
                </Badge>
                <Badge tone="primary" className="text-xs px-3 py-1 font-bold">
                  {selectedStaff.salary} DA / {PAYMENT_LABELS[selectedStaff.paymentType]}
                </Badge>
              </div>
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
                👤 Informations & Contrat
              </button>
              <button
                onClick={() => setDetailsTab("finance")}
                className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-colors border-b-2 -mb-0.5 ${
                  detailsTab === "finance"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted hover:text-ink hover:bg-canvas/50"
                }`}
              >
                💸 Bilan Financier
              </button>
              <button
                onClick={() => setDetailsTab("unpaid")}
                className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-colors border-b-2 -mb-0.5 ${
                  detailsTab === "unpaid"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted hover:text-ink hover:bg-canvas/50"
                }`}
              >
                🗓️ Périodes Dues
              </button>
            </div>

            {/* TAB CONTENT: General info */}
            {detailsTab === "info" && (
              <div className="space-y-4">
                <div className="border border-line rounded-2xl p-4 bg-surface grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <span className="text-muted block text-[10px] uppercase font-semibold font-sans">Date d'embauche</span>
                    <strong className="text-ink text-sm block mt-1">{selectedStaff.startDate || "Non spécifiée"}</strong>
                  </div>
                  <div>
                    <span className="text-muted block text-[10px] uppercase font-semibold">Mode de paiement</span>
                    <strong className="text-primary text-sm block mt-1">{PAYMENT_LABELS[selectedStaff.paymentType]}</strong>
                  </div>
                  <div>
                    <span className="text-muted block text-[10px] uppercase font-semibold">Contact Téléphonique</span>
                    <strong className="text-ink text-sm block mt-1">{selectedStaff.phone}</strong>
                  </div>
                  <div>
                    <span className="text-muted block text-[10px] uppercase font-semibold">Identifiant de Connexion</span>
                    <strong className="text-ink text-sm block mt-1">{selectedStaff.email}</strong>
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT: Finance History */}
            {detailsTab === "finance" && (() => {
              const staffAcomptes = getStaffAcomptes(selectedStaff.id).map(ac => ({
                id: ac.id,
                type: "acompte" as const,
                title: "Acompte (Avance)",
                amount: ac.amount,
                date: ac.date,
                description: ac.description,
                color: "text-warning bg-warning/5 border-warning/20",
              }));

              const staffAbsences = getStaffAbsences(selectedStaff.id).map(ab => ({
                id: ab.id,
                type: "absence" as const,
                title: "Retenue pour Absence",
                amount: ab.cost,
                date: ab.date,
                description: ab.description,
                color: "text-danger bg-danger/5 border-danger/20",
              }));

              const staffPayments = getPaymentHistory(selectedStaff).map(pay => ({
                id: pay.id,
                type: "payment" as const,
                title: "Règlement de Salaire",
                amount: Math.abs(pay.amount),
                date: pay.date.split("T")[0],
                description: pay.description,
                color: "text-success bg-success/5 border-success/20",
              }));

              const allFinancialLogs = [...staffAcomptes, ...staffAbsences, ...staffPayments].sort(
                (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
              );

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold">Total Acomptes</span>
                      <strong className="text-warning text-base font-mono">{staffAcomptes.reduce((s, a) => s + a.amount, 0)} DA</strong>
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold font-sans">Total Absences</span>
                      <strong className="text-danger text-base font-mono">{staffAbsences.reduce((s, a) => s + a.amount, 0)} DA</strong>
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold">Total Payé</span>
                      <strong className="text-success text-base font-mono">{staffPayments.reduce((s, a) => s + a.amount, 0)} DA</strong>
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

            {/* TAB CONTENT: Unpaid Periods */}
            {detailsTab === "unpaid" && (
              <div className="space-y-4">
                <div className="border border-line rounded-2xl p-4 bg-surface">
                  <h4 className="font-bold text-ink mb-3 text-xs uppercase tracking-wider text-muted">
                    🗓️ Périodes en attente de règlement
                  </h4>
                  {getUnpaidPeriods(selectedStaff).length === 0 ? (
                    <p className="text-xs text-success font-bold text-center py-6">L'agent est entièrement à jour.</p>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {getUnpaidPeriods(selectedStaff).map((p) => (
                        <div key={p.key} className="flex justify-between items-center bg-canvas/30 p-3 rounded-xl border border-line text-xs">
                          <div>
                            <span className="font-bold text-ink block">{p.label}</span>
                            <span className="text-[10px] text-muted font-mono">{p.key}</span>
                          </div>
                          <Badge tone="warning" className="font-mono font-bold">
                            {p.amount} DA
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-line">
              <Button onClick={() => setIsDetailsOpen(false)}>Fermer</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Acompte Modal */}
      <Modal open={isAcompteOpen} onClose={() => setIsAcompteOpen(false)} title="Nouvel acompte agent">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Montant de l'acompte (DA) *</label>
            <Input type="number" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} placeholder="Ex: 3000" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Motif</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Avance" />
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
      <Modal open={isAbsenceOpen} onClose={() => setIsAbsenceOpen(false)} title="Nouvelle absence agent">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Coût de la retenue (DA) *</label>
            <Input type="number" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} placeholder="Ex: 1000" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Motif</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Absence" />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsAbsenceOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreateAbsence}>Confirmer</Button>
          </div>
        </div>
      </Modal>

      {/* Payout Settlement Modal */}
      <Modal open={isPayOpen} onClose={() => setIsPayOpen(false)} title="Verser Rémunération">
        <div className="space-y-4">
          {selectedStaff && (
            <div className="bg-canvas border border-line p-4 rounded-xl text-xs space-y-3">
              <span className="text-[10px] text-muted block uppercase">Paiement agent</span>
              <strong className="text-ink text-sm block">
                {selectedStaff.firstName} {selectedStaff.lastName}
              </strong>

              <div className="space-y-2 border-t border-line/50 pt-3">
                <span className="block text-[10px] text-muted uppercase font-bold">Sélectionner la période à payer :</span>
                {getUnpaidPeriods(selectedStaff).length === 0 ? (
                  <p className="text-xs text-success italic font-bold">L'agent est entièrement payé à ce jour.</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {getUnpaidPeriods(selectedStaff).map((p) => {
                      const net =
                        p.amount -
                        getStaffAcomptes(selectedStaff.id).reduce((sum, a) => sum + a.amount, 0) -
                        getStaffAbsences(selectedStaff.id).reduce((sum, ab) => sum + ab.cost, 0);

                      return (
                        <div key={p.key} className="flex justify-between items-center p-3 bg-surface border border-line rounded-lg">
                          <div>
                            <span className="font-bold text-ink block">{p.label}</span>
                            <span className="text-[10px] text-muted">
                              Brut: {p.amount} DA | Net calculé: {net > 0 ? net : 0} DA
                            </span>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handlePaymentSubmit(p.key, p.amount)}
                            className="text-xs"
                          >
                            Payer Rémunération
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
