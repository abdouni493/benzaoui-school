"use client";

import { useState } from "react";
import { useData, uid } from "@/lib/store/data";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import { Trash2, Edit, Plus, Filter, Tag, Calendar } from "lucide-react";
import type { Expense, ExpenseCategory } from "@/lib/types";

export function ExpensesPage() {
  const { expenses, categories, push, deleteFrom, updateItem } = useData();

  // Filters
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("all");

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);

  // Inline Category
  const [newCatName, setNewCatName] = useState("");
  const [showAddCat, setShowAddCat] = useState(false);

  const getCategoryName = (cid: string) => categories.find((c) => c.id === cid)?.name ?? "-";

  const handleCreateCategory = () => {
    if (!newCatName.trim()) return;
    const newId = uid("cat");
    push("categories", { id: newId, name: newCatName });
    setCategoryId(newId);
    setNewCatName("");
    setShowAddCat(false);
  };

  const handleCreateExpense = () => {
    if (!name || !categoryId || amount <= 0) {
      alert("Veuillez remplir tous les champs obligatoires.");
      return;
    }

    const expenseId = uid("exp");
    const newExpense: Expense = {
      id: expenseId,
      name,
      categoryId,
      amount,
      date,
    };

    push("expenses", newExpense);

    // Record directly in cash register as withdraw/expense
    push("cash", {
      id: uid("csh"),
      type: "expense",
      amount: -amount,
      date: new Date().toISOString(),
      description: `Dépense : ${name} (${getCategoryName(categoryId)})`,
    });

    setIsCreateOpen(false);
    resetForm();
  };

  const handleEditExpense = () => {
    if (!selectedExpense || amount <= 0) return;
    updateItem("expenses", selectedExpense.id, {
      name,
      categoryId,
      amount,
      date,
    });
    setIsEditOpen(false);
    resetForm();
  };

  const handleDelete = (id: string) => {
    if (confirm("Supprimer cette dépense ?")) {
      deleteFrom("expenses", id);
    }
  };

  const openEdit = (exp: Expense) => {
    setSelectedExpense(exp);
    setName(exp.name);
    setCategoryId(exp.categoryId);
    setAmount(exp.amount);
    setDate(exp.date);
    setIsEditOpen(true);
  };

  const resetForm = () => {
    setName("");
    setCategoryId("");
    setAmount(0);
    setDate(new Date().toISOString().split("T")[0]);
    setSelectedExpense(null);
  };

  const getFilteredExpenses = () => {
    return expenses.filter((e) => {
      if (selectedCategoryFilter !== "all" && e.categoryId !== selectedCategoryFilter) return false;
      return true;
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <PageHeader emoji="💸" title="Dépenses" subtitle="Suivi des frais de fonctionnement de l'établissement" />
        <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} className="flex items-center gap-2">
          <Plus className="h-4 w-4" /> Nouvelle Dépense
        </Button>
      </div>

      {/* Filter panel */}
      <div className="flex items-center gap-3 mb-6 bg-surface border border-line p-3 rounded-2xl text-xs">
        <span className="text-muted font-bold flex items-center gap-1">
          <Filter className="h-4 w-4" /> Filtrer par catégorie:
        </span>
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant={selectedCategoryFilter === "all" ? "primary" : "outline"}
            onClick={() => setSelectedCategoryFilter("all")}
          >
            Tous
          </Button>
          {categories.map((c) => (
            <Button
              key={c.id}
              size="sm"
              variant={selectedCategoryFilter === c.id ? "primary" : "outline"}
              onClick={() => setSelectedCategoryFilter(c.id)}
            >
              {c.name}
            </Button>
          ))}
        </div>
      </div>

      {getFilteredExpenses().length === 0 ? (
        <Card className="p-8 text-center bg-canvas/30 border border-line">
          <Tag className="h-10 w-10 text-muted mx-auto mb-2" />
          <h3 className="font-bold text-ink">Aucune dépense enregistrée</h3>
          <p className="text-xs text-muted mt-1">Enregistrez vos factures, salaires d'appoint ou achats de matériel.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {getFilteredExpenses().map((exp) => (
            <Card key={exp.id}>
              <CardBody className="flex flex-col justify-between h-40">
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <Badge tone="danger">{getCategoryName(exp.categoryId)}</Badge>
                      <h4 className="text-sm font-bold text-ink mt-1.5">{exp.name}</h4>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(exp)} className="p-1 rounded-lg hover:bg-primary-50 text-muted hover:text-ink">
                        <Edit className="h-4 w-4" />
                      </button>
                      <button onClick={() => handleDelete(exp.id)} className="p-1 rounded-lg hover:bg-danger/10 text-danger">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="border-t border-line pt-2.5 mt-2.5 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1 text-muted text-[10px]">
                    <Calendar className="h-3 w-3" />
                    <span>{exp.date}</span>
                  </div>
                  <strong className="text-danger font-extrabold text-sm">-{exp.amount} DA</strong>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Creation Modal */}
      <Modal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Enregistrer une dépense">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Désignation / Nom *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Facture électricité" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-muted font-sans">Catégorie *</label>
              <button onClick={() => setShowAddCat(!showAddCat)} className="text-xs text-primary hover:underline">
                + Nouvelle catégorie
              </button>
            </div>
            {showAddCat ? (
              <div className="flex gap-2">
                <Input
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="Nom de la catégorie"
                  className="flex-1"
                />
                <Button size="sm" onClick={handleCreateCategory}>
                  Créer
                </Button>
              </div>
            ) : (
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full">
                <option value="">Sélectionner une catégorie</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Montant (DA) *</label>
              <Input
                type="number"
                value={amount || ""}
                onChange={(e) => setAmount(Number(e.target.value))}
                placeholder="Ex: 1500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Date *</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreateExpense}>Enregistrer</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Modifier la dépense">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Nom</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Catégorie</label>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full">
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Montant (DA)</label>
              <Input type="number" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Date</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleEditExpense}>Enregistrer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
