"use client";

import { useState } from "react";
import { useData, uid } from "@/lib/store/data";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Plus,
  DollarSign,
  Calendar,
  TrendingUp,
  TrendingDown,
  Trash2,
  Edit,
  Search,
  Filter,
  ArrowUpDown,
  BookOpen,
  UserCheck,
  Receipt,
  AlertTriangle,
  X
} from "lucide-react";
import type { CashTransaction, CashTxType } from "@/lib/types";

export function CashPage() {
  const { cash, cashMove, deleteFrom, updateItem } = useData();

  // Helper for timezone-safe local date string (YYYY-MM-DD)
  const getLocalDateString = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // Filters
  const [filterPeriod, setFilterPeriod] = useState<"today" | "week" | "month" | "custom">("today");
  const [customStart, setCustomStart] = useState(getLocalDateString(new Date()));
  const [customEnd, setCustomEnd] = useState(getLocalDateString(new Date()));
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "students" | "teachers" | "school_expenses" | "manual">("all");

  // Modals
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);

  // Form states (Deposit & Withdrawal)
  const [amount, setAmount] = useState<number>(0);
  const [description, setDescription] = useState("");
  const [txDate, setTxDate] = useState(getLocalDateString(new Date()));

  // Form states (Edit Transaction)
  const [selectedTx, setSelectedTx] = useState<CashTransaction | null>(null);
  const [editAmount, setEditAmount] = useState<number>(0);
  const [editDescription, setEditDescription] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editType, setEditType] = useState<CashTxType>("deposit");

  const resetForm = () => {
    setAmount(0);
    setDescription("");
    setTxDate(getLocalDateString(new Date()));
  };

  // Filtering transactions
  const getFilteredTransactions = () => {
    const now = new Date();
    
    return cash.filter((tx) => {
      const txDateStr = tx.date.substring(0, 10); // YYYY-MM-DD
      
      let inPeriod = false;
      if (filterPeriod === "today") {
        const todayStr = getLocalDateString(now);
        inPeriod = txDateStr === todayStr;
      } else if (filterPeriod === "week") {
        const startOfWeek = new Date();
        startOfWeek.setDate(now.getDate() - 7);
        const startStr = getLocalDateString(startOfWeek);
        const todayStr = getLocalDateString(now);
        inPeriod = txDateStr >= startStr && txDateStr <= todayStr;
      } else if (filterPeriod === "month") {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startStr = getLocalDateString(startOfMonth);
        const todayStr = getLocalDateString(now);
        inPeriod = txDateStr >= startStr && txDateStr <= todayStr;
      } else {
        // Custom
        const startStr = customStart || "1970-01-01";
        const endStr = customEnd || getLocalDateString(now);
        inPeriod = txDateStr >= startStr && txDateStr <= endStr;
      }

      if (!inPeriod) return false;

      // Filter by search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return (
          tx.description.toLowerCase().includes(query) ||
          tx.type.toLowerCase().includes(query) ||
          tx.amount.toString().includes(query)
        );
      }

      return true;
    });
  };

  const filteredTx = getFilteredTransactions();

  // 1. Overall Application Totals (All-Time)
  const totalEarningsAllTime = cash
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpensesAllTime = cash
    .filter((t) => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const currentCashBalance = totalEarningsAllTime - totalExpensesAllTime;

  // 2. Filtered Period Totals
  const periodInflows = filteredTx
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);

  const periodOutflows = filteredTx
    .filter((t) => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const periodNetFlow = periodInflows - periodOutflows;

  // 3. Specific breakdowns for filtered period
  const studentPaymentsPeriod = filteredTx
    .filter((t) => t.type === "student_payment")
    .reduce((sum, t) => sum + t.amount, 0);

  const teacherPaymentsPeriod = filteredTx
    .filter((t) => t.type === "teacher_payment" || t.type === "acompte")
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const schoolExpensesPeriod = filteredTx
    .filter((t) => t.type === "expense" || t.type === "withdraw")
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  // Tab Filtering
  const getTabFilteredTransactions = () => {
    switch (activeTab) {
      case "students":
        return filteredTx.filter((t) => t.type === "student_payment");
      case "teachers":
        return filteredTx.filter((t) => t.type === "teacher_payment" || t.type === "acompte");
      case "school_expenses":
        return filteredTx.filter((t) => t.type === "expense");
      case "manual":
        return filteredTx.filter((t) => t.type === "deposit" || t.type === "withdraw");
      default:
        return filteredTx;
    }
  };

  const tabTxList = getTabFilteredTransactions();

  // Create Transaction Handlers
  const handleDepositSubmit = () => {
    if (amount <= 0 || !description) {
      alert("Veuillez saisir un montant et une description valides.");
      return;
    }
    cashMove("deposit", amount, description, txDate);
    setIsDepositOpen(false);
    resetForm();
  };

  const handleWithdrawSubmit = () => {
    if (amount <= 0 || !description) {
      alert("Veuillez saisir un montant et une description valides.");
      return;
    }
    cashMove("withdraw", amount, description, txDate);
    setIsWithdrawOpen(false);
    resetForm();
  };

  // Edit / Delete Handlers
  const openEdit = (tx: CashTransaction) => {
    setSelectedTx(tx);
    setEditAmount(Math.abs(tx.amount));
    setEditDescription(tx.description);
    setEditDate(tx.date.substring(0, 10));
    setEditType(tx.type);
    setIsEditOpen(true);
  };

  const handleSaveEdit = () => {
    if (!selectedTx || editAmount <= 0 || !editDescription || !editDate) {
      alert("Veuillez remplir tous les champs obligatoires.");
      return;
    }

    const isOutflow = ["withdraw", "expense", "teacher_payment", "acompte"].includes(editType);
    const signedAmount = isOutflow ? -Math.abs(editAmount) : Math.abs(editAmount);

    let isoDate = selectedTx.date;
    if (editDate !== selectedTx.date.substring(0, 10)) {
      const currentTime = new Date().toISOString().substring(11);
      isoDate = `${editDate}T${currentTime}`;
    }

    updateItem("cash", selectedTx.id, {
      type: editType,
      amount: signedAmount,
      description: editDescription,
      date: isoDate,
    });

    setIsEditOpen(false);
    setSelectedTx(null);
  };

  const handleDelete = (id: string) => {
    if (confirm("Voulez-vous vraiment supprimer cette transaction ? Cette action est irréversible.")) {
      deleteFrom("cash", id);
    }
  };

  const getTxTypeBadge = (type: string) => {
    const labels: Record<string, { label: string; style: string }> = {
      deposit: { label: "Dépôt manuel", style: "bg-success/15 text-success border border-success/30" },
      withdraw: { label: "Retrait manuel", style: "bg-danger/15 text-danger border border-danger/30" },
      expense: { label: "Dépense école", style: "bg-rose-500/15 text-rose-600 border border-rose-500/30" },
      student_payment: { label: "Paiement élève", style: "bg-primary-50 text-primary border border-primary/20" },
      teacher_payment: { label: "Règlement prof / staff", style: "bg-warning/15 text-warning border border-warning/30" },
      acompte: { label: "Acompte", style: "bg-warning/15 text-warning border border-warning/30" },
      registration: { label: "Inscription", style: "bg-success/15 text-success border border-success/30" },
    };
    const info = labels[type] ?? { label: type, style: "bg-canvas text-ink border border-line" };
    return <span className={`px-2.5 py-1 rounded-xl text-[10px] font-bold ${info.style}`}>{info.label}</span>;
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader emoji="🏦" title="Caisse" subtitle="Suivi des flux de trésorerie en temps réel" />

        <div className="flex items-center gap-2">
          <Button
            onClick={() => { resetForm(); setIsDepositOpen(true); }}
            className="bg-success hover:bg-success/90 shadow-md hover:shadow-lg transition-all duration-300 flex items-center gap-2 py-2.5 rounded-xl text-xs font-bold text-white border-none"
          >
            <Plus className="h-4 w-4" /> Dépôt Caisse
          </Button>
          <Button
            onClick={() => { resetForm(); setIsWithdrawOpen(true); }}
            className="bg-danger hover:bg-danger/90 shadow-md hover:shadow-lg transition-all duration-300 flex items-center gap-2 py-2.5 rounded-xl text-xs font-bold text-white border-none"
          >
            <ArrowDownLeft className="h-4 w-4" /> Retrait Caisse
          </Button>
        </div>
      </div>

      {/* Main KPI Stats Dashboard */}
      <div className="space-y-6">
        {/* Row 1: Period Metrics */}
        <div>
          <span className="text-[10px] text-muted font-bold uppercase tracking-wider block mb-2.5">
            Flux Périodiques ({filterPeriod === "today" ? "Aujourd'hui" : filterPeriod === "week" ? "7 derniers jours" : filterPeriod === "month" ? "Ce mois-ci" : "Personnalisé"})
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border border-line bg-surface card-shadow hover:translate-y-[-2px] transition-transform duration-300">
              <CardBody className="flex justify-between items-center p-5">
                <div>
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Flux Net Période</span>
                  <strong className={`text-2xl font-black block mt-1.5 ${periodNetFlow >= 0 ? "text-success" : "text-danger"}`}>
                    {periodNetFlow >= 0 ? "+" : ""}{periodNetFlow} DA
                  </strong>
                </div>
                <div className={`h-11 w-11 rounded-2xl flex items-center justify-center ${periodNetFlow >= 0 ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
                  {periodNetFlow >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                </div>
              </CardBody>
            </Card>

            <Card className="border border-line bg-surface card-shadow hover:translate-y-[-2px] transition-transform duration-300">
              <CardBody className="flex justify-between items-center p-5">
                <div>
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Paiements Élèves</span>
                  <strong className="text-2xl font-black text-primary block mt-1.5">
                    {studentPaymentsPeriod} DA
                  </strong>
                </div>
                <div className="h-11 w-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                  <UserCheck className="h-5 w-5" />
                </div>
              </CardBody>
            </Card>

            <Card className="border border-line bg-surface card-shadow hover:translate-y-[-2px] transition-transform duration-300">
              <CardBody className="flex justify-between items-center p-5">
                <div>
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Règlements Profs</span>
                  <strong className="text-2xl font-black text-warning block mt-1.5">
                    -{teacherPaymentsPeriod} DA
                  </strong>
                </div>
                <div className="h-11 w-11 rounded-2xl bg-warning/10 text-warning flex items-center justify-center">
                  <BookOpen className="h-5 w-5" />
                </div>
              </CardBody>
            </Card>

            <Card className="border border-line bg-surface card-shadow hover:translate-y-[-2px] transition-transform duration-300">
              <CardBody className="flex justify-between items-center p-5">
                <div>
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Dépenses & Retraits</span>
                  <strong className="text-2xl font-black text-danger block mt-1.5">
                    -{schoolExpensesPeriod} DA
                  </strong>
                </div>
                <div className="h-11 w-11 rounded-2xl bg-rose-500/10 text-rose-600 flex items-center justify-center">
                  <Receipt className="h-5 w-5" />
                </div>
              </CardBody>
            </Card>
          </div>
        </div>

        {/* Row 2: All-Time Application Cash Flow */}
        <div>
          <span className="text-[10px] text-muted font-bold uppercase tracking-wider block mb-2.5">
            Flux Globaux (Toutes Périodes)
          </span>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <Card className="relative overflow-hidden bg-gradient-to-br from-primary-600 to-primary-750 text-white border-none card-shadow hover:translate-y-[-2px] transition-transform duration-300">
              <div className="absolute right-[-15px] bottom-[-15px] opacity-15 text-white">
                <DollarSign className="h-32 w-32" />
              </div>
              <CardBody className="flex justify-between items-center p-5 h-28 relative z-10">
                <div>
                  <span className="text-xs text-white/80 font-bold uppercase tracking-wider block">Solde Caisse Réel</span>
                  <strong className="text-3xl font-black block mt-1.5">{currentCashBalance} DA</strong>
                </div>
                <div className="h-12 w-12 rounded-2xl bg-white/10 flex items-center justify-center shadow-inner">
                  <DollarSign className="h-6 w-6" />
                </div>
              </CardBody>
            </Card>

            <Card className="border border-success/20 bg-success/5 hover:translate-y-[-2px] transition-transform duration-300">
              <CardBody className="flex justify-between items-center p-5 h-28">
                <div>
                  <span className="text-xs text-success/80 font-bold uppercase tracking-wider block">Total Recettes Application</span>
                  <strong className="text-2xl font-black text-success block mt-1.5">+{totalEarningsAllTime} DA</strong>
                </div>
                <div className="h-11 w-11 rounded-2xl bg-success/15 text-success flex items-center justify-center">
                  <ArrowUpRight className="h-5 w-5" />
                </div>
              </CardBody>
            </Card>

            <Card className="border border-danger/20 bg-danger/5 hover:translate-y-[-2px] transition-transform duration-300">
              <CardBody className="flex justify-between items-center p-5 h-28">
                <div>
                  <span className="text-xs text-danger/80 font-bold uppercase tracking-wider block font-sans">Total Dépenses Application</span>
                  <strong className="text-2xl font-black text-danger block mt-1.5">-{totalExpensesAllTime} DA</strong>
                </div>
                <div className="h-11 w-11 rounded-2xl bg-danger/15 text-danger flex items-center justify-center">
                  <ArrowDownLeft className="h-5 w-5" />
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>

      {/* Toolbar: Filters, Search, Custom Dates */}
      <div className="bg-surface border border-line p-4 rounded-2xl flex flex-col xl:flex-row xl:items-center justify-between gap-4 text-xs">
        {/* Time period filter */}
        <div className="flex flex-wrap items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant={filterPeriod === "today" ? "primary" : "outline"}
            onClick={() => setFilterPeriod("today")}
            className="rounded-xl font-bold py-1.5 px-3"
          >
            Aujourd'hui
          </Button>
          <Button
            size="sm"
            variant={filterPeriod === "week" ? "primary" : "outline"}
            onClick={() => setFilterPeriod("week")}
            className="rounded-xl font-bold py-1.5 px-3"
          >
            7 derniers jours
          </Button>
          <Button
            size="sm"
            variant={filterPeriod === "month" ? "primary" : "outline"}
            onClick={() => setFilterPeriod("month")}
            className="rounded-xl font-bold py-1.5 px-3"
          >
            Ce mois-ci
          </Button>
          <Button
            size="sm"
            variant={filterPeriod === "custom" ? "primary" : "outline"}
            onClick={() => setFilterPeriod("custom")}
            className="rounded-xl font-bold py-1.5 px-3"
          >
            Période personnalisée
          </Button>
        </div>

        {/* Custom date range fields */}
        {filterPeriod === "custom" && (
          <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-200">
            <div>
              <label className="block text-[10px] text-muted mb-1 font-bold">Début</label>
              <Input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="py-1 text-xs rounded-xl"
              />
            </div>
            <div>
              <label className="block text-[10px] text-muted mb-1 font-bold">Fin</label>
              <Input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="py-1 text-xs rounded-xl"
              />
            </div>
          </div>
        )}

        {/* Search bar */}
        <div className="relative flex-1 max-w-md xl:ml-auto">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted">
            <Search className="h-4 w-4" />
          </span>
          <Input
            type="text"
            placeholder="Rechercher par description, montant, type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-4 py-2 text-xs rounded-xl w-full"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Tabs & Table */}
      <div className="bg-surface border border-line rounded-2xl overflow-hidden card-shadow">
        {/* Tab List */}
        <div className="flex border-b border-line bg-canvas/30 px-4 pt-3 gap-1 scrollbar-none overflow-x-auto">
          {[
            { id: "all", label: "Toutes les Transactions", count: filteredTx.length },
            { id: "students", label: "Paiements Élèves", count: filteredTx.filter((t) => t.type === "student_payment").length },
            { id: "teachers", label: "Règlements Profs/Staff", count: filteredTx.filter((t) => t.type === "teacher_payment" || t.type === "acompte").length },
            { id: "school_expenses", label: "Dépenses École", count: filteredTx.filter((t) => t.type === "expense").length },
            { id: "manual", label: "Dépôts & Retraits", count: filteredTx.filter((t) => t.type === "deposit" || t.type === "withdraw").length },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all border-b-2 -mb-0.5 whitespace-nowrap flex items-center gap-2 ${
                activeTab === tab.id
                  ? "border-primary text-primary bg-surface shadow-sm"
                  : "border-transparent text-muted hover:text-ink hover:bg-canvas/45"
              }`}
            >
              {tab.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                activeTab === tab.id ? "bg-primary/10 text-primary" : "bg-canvas text-muted"
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Transaction Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-canvas/50 border-b border-line text-muted font-bold text-[10px] uppercase tracking-wider">
                <th className="p-4 pl-6">Date / Heure</th>
                <th className="p-4">Type</th>
                <th className="p-4">Description</th>
                <th className="p-4 text-right">Montant</th>
                <th className="p-4 text-center pr-6 w-28">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tabTxList.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-muted italic bg-surface/30">
                    <div className="max-w-sm mx-auto flex flex-col items-center gap-2">
                      <AlertTriangle className="h-8 w-8 text-muted/65" />
                      <span className="block font-bold mt-1.5">Aucune transaction trouvée</span>
                      <span className="text-[11px] block text-muted/80 font-sans">
                        Aucune transaction ne correspond aux critères pour cette période.
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                tabTxList.slice().reverse().map((tx) => (
                  <tr key={tx.id} className="hover:bg-primary-50/10 transition-colors group">
                    <td className="p-4 pl-6 font-mono text-[10px] text-muted">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-muted/70 shrink-0" />
                        <span>{tx.date.substring(0, 16).replace("T", " ")}</span>
                      </div>
                    </td>
                    <td className="p-4">{getTxTypeBadge(tx.type)}</td>
                    <td className="p-4 font-semibold text-ink max-w-md truncate">{tx.description}</td>
                    <td className={`p-4 text-right font-extrabold text-sm ${tx.amount > 0 ? "text-success" : "text-danger"}`}>
                      {tx.amount > 0 ? `+${tx.amount}` : tx.amount} DA
                    </td>
                    <td className="p-4 text-center pr-6">
                      <div className="flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEdit(tx)}
                          className="p-1.5 rounded-lg hover:bg-primary-50 text-muted hover:text-primary transition-colors"
                          title="Modifier"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(tx.id)}
                          className="p-1.5 rounded-lg hover:bg-danger/10 text-muted hover:text-danger transition-colors"
                          title="Supprimer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Deposit Modal */}
      <Modal open={isDepositOpen} onClose={() => setIsDepositOpen(false)} title="Nouveau dépôt en caisse">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Montant du dépôt (DA) *</label>
            <Input
              type="number"
              value={amount || ""}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder="Ex: 10000"
              className="rounded-xl"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Description *</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: Fonds de roulement ou apport initial"
              className="rounded-xl"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date du dépôt *</label>
            <Input
              type="date"
              value={txDate}
              onChange={(e) => setTxDate(e.target.value)}
              className="rounded-xl"
            />
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t border-line">
            <Button variant="outline" onClick={() => setIsDepositOpen(false)} className="rounded-xl">
              Annuler
            </Button>
            <Button onClick={handleDepositSubmit} className="rounded-xl">
              Confirmer le dépôt
            </Button>
          </div>
        </div>
      </Modal>

      {/* Withdraw Modal */}
      <Modal open={isWithdrawOpen} onClose={() => setIsWithdrawOpen(false)} title="Nouveau retrait de caisse">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Montant du retrait (DA) *</label>
            <Input
              type="number"
              value={amount || ""}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder="Ex: 5000"
              className="rounded-xl"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Description *</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: Achat de papier ou fournitures"
              className="rounded-xl"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date du retrait *</label>
            <Input
              type="date"
              value={txDate}
              onChange={(e) => setTxDate(e.target.value)}
              className="rounded-xl"
            />
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t border-line">
            <Button variant="outline" onClick={() => setIsWithdrawOpen(false)} className="rounded-xl">
              Annuler
            </Button>
            <Button onClick={handleWithdrawSubmit} className="bg-danger hover:bg-danger/90 border-none rounded-xl">
              Confirmer le retrait
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Modifier la transaction">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Type de transaction *</label>
            <Select
              value={editType}
              onChange={(e) => setEditType(e.target.value as CashTxType)}
              className="w-full rounded-xl"
            >
              <option value="deposit">Dépôt manuel</option>
              <option value="withdraw">Retrait manuel</option>
              <option value="expense">Dépense école</option>
              <option value="student_payment">Paiement élève</option>
              <option value="teacher_payment">Règlement prof / staff</option>
              <option value="acompte">Acompte prof</option>
            </Select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Montant (DA) *</label>
            <Input
              type="number"
              value={editAmount || ""}
              onChange={(e) => setEditAmount(Number(e.target.value))}
              className="rounded-xl"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Description *</label>
            <Input
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="rounded-xl"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date *</label>
            <Input
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              className="rounded-xl"
            />
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t border-line">
            <Button variant="outline" onClick={() => setIsEditOpen(false)} className="rounded-xl">
              Annuler
            </Button>
            <Button onClick={handleSaveEdit} className="rounded-xl">
              Enregistrer
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
