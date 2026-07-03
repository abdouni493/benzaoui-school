"use client";

import { useState } from "react";
import { useData, uid } from "@/lib/store/data";
import { uploadImage } from "@/lib/supabase/uploadImage";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import { Trash2, Eye, Plus, CheckSquare, Square, FileText, Upload, Image as ImageIcon } from "lucide-react";
import type { Subject } from "@/lib/types";

export function SubjectsPage() {
  const { subjects, sessions, modules, groups, classes, push, deleteFrom } = useData();

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);

  // Form states
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [imagePlaceholder, setImagePlaceholder] = useState("https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=300&auto=format&fit=crop&q=60");
  const [imageUploading, setImageUploading] = useState(false);

  // Selection state for bulk delete
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Helpers
  const getSessionLabel = (sesId: string) => {
    const s = sessions.find((se) => se.id === sesId);
    if (!s) return "-";
    const mod = modules.find((m) => m.id === s.moduleId)?.name ?? "Module";
    const cl = classes.find((c) => c.id === s.classId)?.name ?? "Classe";
    const gr = groups.find((g) => g.id === s.groupId)?.name ?? "Groupe";
    return `${cl} - ${mod} (${gr})`;
  };

  const handleCreateSubject = () => {
    if (!title || !sessionId) {
      alert("Le titre et le groupe sont obligatoires.");
      return;
    }

    const newSubject: Subject = {
      id: uid("sbj"),
      title,
      description,
      sessionId,
      image: imagePlaceholder,
      date: new Date().toISOString(),
    };

    push("subjects", newSubject);
    setIsCreateOpen(false);
    resetForm();
  };

  const handleDeleteSingle = (id: string) => {
    if (confirm("Supprimer ce document / exercice ?")) {
      deleteFrom("subjects", id);
      setSelectedIds(selectedIds.filter((x) => x !== id));
    }
  };

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;
    if (confirm(`Voulez-vous supprimer les ${selectedIds.length} documents sélectionnés ?`)) {
      selectedIds.forEach((id) => {
        deleteFrom("subjects", id);
      });
      setSelectedIds([]);
    }
  };

  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((x) => x !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === subjects.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(subjects.map((s) => s.id));
    }
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setSessionId("");
    setSelectedSubject(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <PageHeader emoji="📚" title="Sujets & Exercices" subtitle="Partager des fiches d'exercices et devoirs" />

        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <Button variant="danger" onClick={handleBulkDelete} className="flex items-center gap-2">
              <Trash2 className="h-4 w-4" /> Supprimer ({selectedIds.length})
            </Button>
          )}
          <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> Nouveau Sujet
          </Button>
        </div>
      </div>

      {subjects.length === 0 ? (
        <Card className="p-8 text-center bg-canvas/30 border border-line">
          <FileText className="h-10 w-10 text-muted mx-auto mb-2" />
          <h3 className="font-bold text-ink">Aucun document disponible</h3>
          <p className="text-xs text-muted mt-1">Créez votre premier sujet ou exercice pour vos groupes.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Select All Bar */}
          <div className="flex items-center justify-between bg-surface border border-line px-4 py-3 rounded-2xl text-xs">
            <button onClick={toggleSelectAll} className="flex items-center gap-2 font-bold text-ink">
              {selectedIds.length === subjects.length ? (
                <CheckSquare className="h-4 w-4 text-primary" />
              ) : (
                <Square className="h-4 w-4 text-muted" />
              )}
              Tout Sélectionner ({selectedIds.length} / {subjects.length})
            </button>
          </div>

          {/* Grid of subjects */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {subjects.map((sbj) => {
              const isSelected = selectedIds.includes(sbj.id);

              return (
                <Card
                  key={sbj.id}
                  className={`relative border transition-all ${
                    isSelected ? "border-primary bg-primary-50/10" : "border-line"
                  }`}
                >
                  <CardBody className="flex flex-col justify-between h-64">
                    <div>
                      {/* Image placeholder or uploaded image */}
                      {sbj.image && (
                        <div className="h-28 w-full rounded-xl overflow-hidden mb-3 relative bg-canvas">
                          <img src={sbj.image} alt={sbj.title} className="w-full h-full object-cover" />
                          <button
                            onClick={() => toggleSelect(sbj.id)}
                            className="absolute top-2 left-2 p-1.5 rounded-lg bg-surface/80 text-primary border border-line z-10"
                          >
                            {isSelected ? (
                              <CheckSquare className="h-4 w-4" />
                            ) : (
                              <Square className="h-4 w-4 text-muted" />
                            )}
                          </button>
                        </div>
                      )}

                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="text-sm font-bold text-ink line-clamp-1">{sbj.title}</h4>
                          <span className="text-[10px] text-muted block mt-0.5">
                            Créé le {new Date(sbj.date).toLocaleDateString()}
                          </span>
                        </div>
                      </div>

                      <p className="text-xs text-muted mt-2 line-clamp-2">{sbj.description || "Pas de description"}</p>
                    </div>

                    <div className="border-t border-line pt-3 mt-3 flex items-center justify-between text-xs">
                      <Badge tone="neutral" className="text-[9px] truncate max-w-[150px]">
                        {getSessionLabel(sbj.sessionId)}
                      </Badge>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setSelectedSubject(sbj);
                            setIsDetailsOpen(true);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDeleteSingle(sbj.id)} className="text-danger">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Creation Modal */}
      <Modal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Créer un sujet / exercice" wide>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Titre de la fiche *</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Devoir de Mathématiques Trimestre 1" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Groupe / Séance concerné *</label>
            <Select value={sessionId} onChange={(e) => setSessionId(e.target.value)} className="w-full">
              <option value="">Sélectionner le groupe d'élèves</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {getSessionLabel(s.id)}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-2">Image d'illustration / Exercice</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Device upload zone */}
              <div className="border-2 border-dashed border-line rounded-2xl p-4 bg-canvas/30 hover:bg-canvas/50 transition-colors flex flex-col items-center justify-center text-center cursor-pointer relative group">
                <input
                  type="file"
                  accept="image/*"
                  disabled={imageUploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setImageUploading(true);
                    try {
                      const url = await uploadImage("subjects", file);
                      setImagePlaceholder(url);
                    } catch (err) {
                      alert(err instanceof Error ? err.message : "Échec de l'envoi de l'image.");
                    } finally {
                      setImageUploading(false);
                    }
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer z-10"
                />
                <div className="space-y-1.5 pointer-events-none">
                  <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
                    <Upload className="h-4 w-4" />
                  </div>
                  <span className="text-xs font-bold text-ink block">
                    {imageUploading ? "Envoi en cours..." : "Téléverser depuis l'appareil"}
                  </span>
                  <span className="text-[10px] text-muted block">Sélectionner une photo</span>
                </div>
              </div>

              {/* URL Input & Preview zone */}
              <div className="border border-line rounded-2xl p-3 bg-surface flex flex-col justify-between gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-muted uppercase mb-1">Ou saisir l'adresse URL</label>
                  <Input
                    value={imagePlaceholder}
                    onChange={(e) => setImagePlaceholder(e.target.value)}
                    placeholder="https://images.unsplash.com/..."
                  />
                </div>
                
                {imagePlaceholder && (
                  <div className="h-16 w-full rounded-xl overflow-hidden relative bg-canvas border border-line flex items-center justify-center">
                    <img src={imagePlaceholder} alt="Aperçu" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setImagePlaceholder("")}
                      className="absolute top-1 right-1 p-1 rounded-md bg-danger text-white hover:bg-danger/90 text-[10px] font-bold z-20"
                    >
                      Supprimer
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Description / Exercice / Devoir</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Saisissez les questions, les consignes ou les liens de téléchargement..."
              rows={4}
              className="w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink outline-none transition-colors focus:border-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreateSubject}>Publier</Button>
          </div>
        </div>
      </Modal>

      {/* Details Modal */}
      <Modal open={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Consulter le Sujet / Exercice" wide>
        {selectedSubject && (
          <div className="space-y-4 text-xs">
            {selectedSubject.image && (
              <div className="h-48 w-full rounded-xl overflow-hidden bg-canvas">
                <img src={selectedSubject.image} alt={selectedSubject.title} className="w-full h-full object-cover" />
              </div>
            )}

            <div>
              <span className="text-[10px] text-muted block uppercase">Titre</span>
              <strong className="text-sm font-bold text-ink block">{selectedSubject.title}</strong>
            </div>

            <div>
              <span className="text-[10px] text-muted block uppercase">Destinataires</span>
              <Badge tone="primary" className="mt-1">
                {getSessionLabel(selectedSubject.sessionId)}
              </Badge>
            </div>

            <div>
              <span className="text-[10px] text-muted block uppercase font-sans">Date de publication</span>
              <span className="font-semibold text-ink">{new Date(selectedSubject.date).toLocaleString()}</span>
            </div>

            <div className="border-t border-line pt-3">
              <span className="text-[10px] text-muted block uppercase mb-1">Contenu / Description</span>
              <p className="text-sm text-ink bg-canvas border border-line p-4 rounded-xl whitespace-pre-wrap">
                {selectedSubject.description || "Aucun contenu textuel."}
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={() => setIsDetailsOpen(false)}>Fermer</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
