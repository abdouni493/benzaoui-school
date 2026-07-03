"use client";

import { useState } from "react";
import { useData, uid } from "@/lib/store/data";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import { Trash2, Edit, Plus, Megaphone, Calendar } from "lucide-react";
import type { Announcement, Audience } from "@/lib/types";

export function AnnouncementsPage() {
  const { announcements, push, deleteFrom, updateItem } = useData();

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);

  // Form states
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState<Audience>("all");
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);

  const handleCreateAnnouncement = () => {
    if (!title || !description) {
      alert("Titre et description obligatoires.");
      return;
    }

    const newAnnouncement: Announcement = {
      id: uid("ann"),
      title,
      description,
      audience,
      endDate,
      date: new Date().toISOString(),
    };

    push("announcements", newAnnouncement);
    setIsCreateOpen(false);
    resetForm();
  };

  const handleEditAnnouncement = () => {
    if (!selectedAnnouncement) return;
    updateItem("announcements", selectedAnnouncement.id, {
      title,
      description,
      audience,
      endDate,
    });
    setIsEditOpen(false);
    resetForm();
  };

  const handleDelete = (id: string) => {
    if (confirm("Supprimer cette annonce ?")) {
      deleteFrom("announcements", id);
    }
  };

  const openEdit = (ann: Announcement) => {
    setSelectedAnnouncement(ann);
    setTitle(ann.title);
    setDescription(ann.description);
    setAudience(ann.audience);
    setEndDate(ann.endDate);
    setIsEditOpen(true);
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setAudience("all");
    setEndDate(new Date().toISOString().split("T")[0]);
    setSelectedAnnouncement(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <PageHeader emoji="📢" title="Annonces" subtitle="Publier des annonces et informations générales" />
        <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} className="flex items-center gap-2">
          <Plus className="h-4 w-4" /> Nouvelle Annonce
        </Button>
      </div>

      {announcements.length === 0 ? (
        <Card className="p-8 text-center bg-canvas/30 border border-line">
          <Megaphone className="h-10 w-10 text-muted mx-auto mb-2" />
          <h3 className="font-bold text-ink">Aucune annonce publiée</h3>
          <p className="text-xs text-muted mt-1">Créez votre première annonce pour informer vos élèves, parents ou profs.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {announcements.map((ann) => {
            const isExpired = new Date(ann.endDate) < new Date();

            return (
              <Card key={ann.id} className={isExpired ? "opacity-60 border border-line" : "border border-line"}>
                <CardBody className="flex flex-col justify-between h-48">
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Megaphone className="h-4 w-4 text-primary shrink-0" />
                        <h4 className="text-sm font-bold text-ink truncate max-w-[180px]">{ann.title}</h4>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => openEdit(ann)} className="p-1 rounded-lg hover:bg-primary-50 text-muted hover:text-ink">
                          <Edit className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleDelete(ann.id)} className="p-1 rounded-lg hover:bg-danger/10 text-danger">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-muted mt-2.5 line-clamp-3">{ann.description}</p>
                  </div>

                  <div className="border-t border-line pt-2.5 mt-2.5 flex items-center justify-between text-[10px]">
                    <div className="flex items-center gap-1 text-muted">
                      <Calendar className="h-3 w-3" />
                      <span>Expire le: {ann.endDate}</span>
                    </div>
                    <Badge tone={ann.audience === "all" ? "primary" : ann.audience === "teachers" ? "warning" : "success"}>
                      Cible: {ann.audience === "all" ? "Tous" : ann.audience === "teachers" ? "Profs" : ann.audience === "students" ? "Élèves" : "Parents"}
                    </Badge>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {/* Creation Modal */}
      <Modal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Publier une annonce">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Titre de l'annonce *</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre descriptif" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Audience cible</label>
            <Select value={audience} onChange={(e) => setAudience(e.target.value as Audience)} className="w-full">
              <option value="all">Tout le monde (Tous)</option>
              <option value="students">Étudiants uniquement</option>
              <option value="parents">Parents uniquement</option>
              <option value="teachers">Enseignants uniquement</option>
            </Select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date d'expiration *</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Message</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Contenu de votre annonce..."
              rows={4}
              className="w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink outline-none focus:border-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreateAnnouncement}>Publier</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Modifier l'annonce">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Titre</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Audience</label>
            <Select value={audience} onChange={(e) => setAudience(e.target.value as Audience)} className="w-full">
              <option value="all">Tout le monde</option>
              <option value="students">Étudiants</option>
              <option value="parents">Parents</option>
              <option value="teachers">Enseignants</option>
            </Select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date d'expiration</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Message</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink outline-none focus:border-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleEditAnnouncement}>Enregistrer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
