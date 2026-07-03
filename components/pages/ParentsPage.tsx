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
import { Trash2, Edit, Eye, Plus, Send, Phone, Search, Users, Check, MoreVertical } from "lucide-react";
import type { Parent, Student } from "@/lib/types";

export function ParentsPage() {
  const { parents, students, push, deleteFrom, updateItem } = useData();

  // Search
  const [searchQuery, setSearchQuery] = useState("");

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isMessageOpen, setIsMessageOpen] = useState(false);
  const [selectedParent, setSelectedParent] = useState<Parent | null>(null);

  // Form: Create/Edit Parent
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState("");

  // Form: Message
  const [msgTitle, setMsgTitle] = useState("");
  const [msgDescription, setMsgDescription] = useState("");

  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Helpers
  const getParentChildren = (parent: Parent) => {
    return students.filter((s) => parent.childIds.includes(s.id));
  };

  const getFilteredParents = () => {
    return parents.filter((p) => {
      const nameMatch = `${p.firstName} ${p.lastName}`.toLowerCase().includes(searchQuery.toLowerCase());
      const phoneMatch = p.phone.includes(searchQuery);
      return nameMatch || phoneMatch;
    });
  };

  const handleCreateParent = async () => {
    if (!firstName || !lastName || !phone || !email) {
      alert("Veuillez remplir les champs obligatoires.");
      return;
    }
    if (password.length < 6) {
      alert("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }

    try {
      const { id: parentId } = await createRoleUser({
        role: "parent",
        email,
        password,
        firstName,
        lastName,
        phone,
      });

      const newParent: Parent = {
        id: parentId,
        firstName,
        lastName,
        phone,
        email,
        childIds: selectedChildIds,
      };
      push("parents", newParent);

      // Update parentId in selected students
      selectedChildIds.forEach((sid) => {
        updateItem("students", sid, { parentId });
      });

      setIsCreateOpen(false);
      resetForm();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur lors de la création du compte.");
    }
  };

  const handleEditParent = async () => {
    if (!selectedParent) return;

    if (password) {
      try {
        await resetUserPassword(selectedParent.id, password);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Erreur lors du changement de mot de passe.");
        return;
      }
    }

    // Reset parentId in old students
    selectedParent.childIds.forEach((sid) => {
      updateItem("students", sid, { parentId: undefined });
    });

    // Update parent info
    updateItem("parents", selectedParent.id, {
      firstName,
      lastName,
      phone,
      email,
    });

    // Set parentId in newly selected students
    selectedChildIds.forEach((sid) => {
      updateItem("students", sid, { parentId: selectedParent.id });
    });

    setIsEditOpen(false);
    resetForm();
  };

  const handleDelete = (id: string) => {
    if (confirm("Supprimer ce parent ?")) {
      deleteFrom("parents", id);
      // Reset parentId in children
      students
        .filter((s) => s.parentId === id)
        .forEach((s) => updateItem("students", s.id, { parentId: undefined }));
      setActiveMenuId(null);
    }
  };

  const handleSendMessage = () => {
    if (!selectedParent || !msgTitle || !msgDescription) return;

    push("notifications", {
      id: uid("n"),
      parentId: selectedParent.id,
      title: msgTitle,
      description: msgDescription,
      date: new Date().toISOString(),
      read: false,
      auto: false, // direct admin message
    });

    setIsMessageOpen(false);
    setMsgTitle("");
    setMsgDescription("");
  };

  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setPhone("");
    setEmail("");
    setPassword("");
    setSelectedChildIds([]);
    setStudentSearch("");
    setSelectedParent(null);
  };

  const openEdit = (p: Parent) => {
    setSelectedParent(p);
    setFirstName(p.firstName);
    setLastName(p.lastName);
    setPhone(p.phone);
    setEmail(p.email);
    setPassword("");
    setSelectedChildIds(p.childIds);
    setStudentSearch("");
    setIsEditOpen(true);
    setActiveMenuId(null);
  };

  const openDetails = (p: Parent) => {
    setSelectedParent(p);
    setIsDetailsOpen(true);
    setActiveMenuId(null);
  };

  const openMessage = (p: Parent) => {
    setSelectedParent(p);
    setMsgTitle("");
    setMsgDescription("");
    setIsMessageOpen(true);
    setActiveMenuId(null);
  };

  const getFilteredStudentsForLinking = () => {
    return students.filter((s) => {
      const fullName = `${s.firstName} ${s.lastName}`.toLowerCase();
      const matchesSearch = fullName.includes(studentSearch.toLowerCase());
      // Show if matches search and (either has no parent, or is already selected by this parent)
      return matchesSearch && (!s.parentId || selectedChildIds.includes(s.id));
    });
  };

  const toggleChildLink = (sid: string) => {
    if (selectedChildIds.includes(sid)) {
      setSelectedChildIds(selectedChildIds.filter((x) => x !== sid));
    } else {
      setSelectedChildIds([...selectedChildIds, sid]);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <PageHeader emoji="👨‍👩-👧" title="Parents" subtitle="Gérer les comptes des tuteurs d'élèves" />
        <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} className="flex items-center gap-2">
          <Plus className="h-4 w-4" /> Nouveau Parent
        </Button>
      </div>

      {/* Search panel */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Rechercher par nom ou numéro de téléphone du parent..."
          className="pl-9 w-full"
        />
      </div>

      {/* Parents Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {getFilteredParents().map((p) => {
          const children = getParentChildren(p);

          return (
            <Card key={p.id} className="relative overflow-visible">
              <CardBody className="flex flex-col justify-between h-48">
                <div>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="h-5 w-5 text-primary" />
                      <div>
                        <h4 className="text-sm font-bold text-ink">
                          {p.firstName} {p.lastName}
                        </h4>
                        <span className="text-[10px] text-muted block flex items-center gap-1">
                          <Phone className="h-3 w-3 inline" /> {p.phone}
                        </span>
                      </div>
                    </div>

                    {/* Actions Menu */}
                    <div className="relative">
                      <button
                        onClick={() => setActiveMenuId(activeMenuId === p.id ? null : p.id)}
                        className="p-1 rounded-lg hover:bg-primary-50 text-muted hover:text-ink transition-colors"
                      >
                        <MoreVertical className="h-5 w-5" />
                      </button>
                      {activeMenuId === p.id && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setActiveMenuId(null)} />
                          <div className="absolute right-0 mt-1 w-44 bg-surface border border-line rounded-xl shadow-lg z-20 overflow-hidden">
                            <button
                              onClick={() => openDetails(p)}
                              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-ink hover:bg-primary-50 text-left"
                            >
                              <Eye className="h-4 w-4" /> Voir Détails
                            </button>
                            <button
                              onClick={() => openMessage(p)}
                              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-primary hover:bg-primary-50 text-left"
                            >
                              <Send className="h-4 w-4" /> Envoyer Message
                            </button>
                            <button
                              onClick={() => openEdit(p)}
                              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-ink hover:bg-primary-50 text-left"
                            >
                              <Edit className="h-4 w-4" /> Modifier
                            </button>
                            <button
                              onClick={() => handleDelete(p.id)}
                              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-danger hover:bg-danger/10 text-left"
                            >
                              <Trash2 className="h-4 w-4" /> Supprimer
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 text-xs">
                    <span className="text-muted block font-semibold mb-1">Enfants rattachés ({children.length}) :</span>
                    {children.length === 0 ? (
                      <span className="text-[10px] text-muted italic">Aucun élève lié</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {children.map((c) => (
                          <Badge key={c.id} tone={c.balance < 0 ? "danger" : "primary"} className="text-[9px]">
                            {c.firstName} {c.lastName}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-line pt-2 mt-2 text-[10px] text-muted flex justify-between">
                  <span>Email: {p.email}</span>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/* Creation Modal */}
      <Modal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Créer un compte Parent" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Prénom *</label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Nom *</label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Téléphone *</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+213 XXXXXXXXX" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Email (Identifiant) *</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="parent@ecole.com" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Mot de passe *</label>
              <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6 caractères min." />
            </div>
          </div>

          <div className="space-y-3">
            <label className="block text-xs font-semibold text-muted">Sélectionner les enfants *</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
              <Input
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                placeholder="Rechercher élève par nom, téléphone..."
                className="pl-8 text-xs py-1"
              />
            </div>
            <div className="border border-line rounded-xl max-h-48 overflow-y-auto p-1.5 bg-canvas/30 space-y-1">
              {getFilteredStudentsForLinking().map((s) => {
                const isLinked = selectedChildIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleChildLink(s.id)}
                    className={`w-full text-start p-2 rounded-lg text-xs flex justify-between items-center transition-all ${
                      isLinked ? "bg-primary/10 border border-primary/20 text-ink" : "hover:bg-primary-50 text-ink"
                    }`}
                  >
                    <div>
                      <span className="font-bold block text-ink">{s.firstName} {s.lastName}</span>
                      <span className="text-[9px] text-muted block mt-0.5">
                        🎂 Née le: {s.birthDate || "Non spécifiée"} {s.phone ? `| 📞 ${s.phone}` : ""}
                      </span>
                    </div>
                    {isLinked && <Check className="h-4.5 w-4.5 text-primary shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleCreateParent}>Créer le Compte</Button>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Modifier le Parent" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Prénom</label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Nom</label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Téléphone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Email</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Nouveau mot de passe</label>
              <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Laisser vide pour ne pas changer" />
            </div>
          </div>

          <div className="space-y-3">
            <label className="block text-xs font-semibold text-muted font-sans">Liaison enfants</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
              <Input
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                placeholder="Rechercher élève par nom, téléphone..."
                className="pl-8 text-xs py-1"
              />
            </div>
            <div className="border border-line rounded-xl max-h-56 overflow-y-auto p-1.5 bg-canvas/30 space-y-1">
              {getFilteredStudentsForLinking().map((s) => {
                const isLinked = selectedChildIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleChildLink(s.id)}
                    className={`w-full text-start p-2 rounded-lg text-xs flex justify-between items-center transition-all ${
                      isLinked ? "bg-primary/10 border border-primary/20 text-ink" : "hover:bg-primary-50 text-ink"
                    }`}
                  >
                    <div>
                      <span className="font-bold block text-ink">{s.firstName} {s.lastName}</span>
                      <span className="text-[9px] text-muted block mt-0.5">
                        🎂 Née le: {s.birthDate || "Non spécifiée"} {s.phone ? `| 📞 ${s.phone}` : ""}
                      </span>
                    </div>
                    {isLinked && <Check className="h-4 w-4 text-primary shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsEditOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleEditParent}>Enregistrer</Button>
        </div>
      </Modal>

      {/* Details Modal */}
      <Modal open={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Fiche de Liaison Parent/Enfants" wide>
        {selectedParent && (
          <div className="space-y-6 text-xs">
            <div className="bg-primary-50/50 p-4 border border-line rounded-xl grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <span className="text-muted block font-semibold mb-0.5">Parent</span>
                <span className="font-bold text-ink">{selectedParent.firstName} {selectedParent.lastName}</span>
              </div>
              <div>
                <span className="text-muted block font-semibold mb-0.5 font-sans">Téléphone</span>
                <span className="font-semibold text-ink">{selectedParent.phone}</span>
              </div>
              <div>
                <span className="text-muted block font-semibold mb-0.5">Email</span>
                <span className="font-semibold text-ink">{selectedParent.email}</span>
              </div>
            </div>

            <div>
              <h4 className="font-bold text-ink mb-3 uppercase tracking-wider">🎓 Enfants associés ({getParentChildren(selectedParent).length})</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {getParentChildren(selectedParent).length === 0 ? (
                  <p className="text-xs text-muted italic">Aucun élève lié à ce parent.</p>
                ) : (
                  getParentChildren(selectedParent).map((c) => (
                    <div key={c.id} className="border border-line rounded-xl p-3.5 bg-surface flex justify-between items-center">
                      <div>
                        <strong className="text-ink text-sm block">{c.firstName} {c.lastName}</strong>
                        <span className="text-[10px] text-muted block mt-0.5">Carte RFID: {c.rfid}</span>
                      </div>
                      <Badge tone={c.balance < 0 ? "danger" : "primary"}>
                        {c.balance} DA
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-line">
              <Button onClick={() => setIsDetailsOpen(false)}>Fermer</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Message Send Modal */}
      <Modal open={isMessageOpen} onClose={() => setIsMessageOpen(false)} title="Envoyer un message au Parent">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Titre de la notification *</label>
            <Input value={msgTitle} onChange={(e) => setMsgTitle(e.target.value)} placeholder="Ex: Alerte solde débiteur" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Message *</label>
            <textarea
              value={msgDescription}
              onChange={(e) => setMsgDescription(e.target.value)}
              placeholder="Saisissez votre message..."
              rows={4}
              className="w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink outline-none focus:border-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsMessageOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSendMessage}>Envoyer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
