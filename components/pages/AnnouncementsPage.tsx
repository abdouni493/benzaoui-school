"use client";

import { useMemo, useState } from "react";
import { useData, uid } from "@/lib/store/data";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import { Trash2, Edit, Plus, Megaphone, Calendar, Search, Filter, X, Users, Check } from "lucide-react";
import type { Announcement, Audience } from "@/lib/types";
import { formatDateFr } from "@/lib/helpers";

const AUDIENCE_LABELS: Record<Audience, string> = {
  all: "Tous",
  students: "Élèves",
  teachers: "Enseignants",
  parents: "Parents",
};

export function AnnouncementsPage() {
  const { announcements, groups, sessions, subscriptions, students, push, deleteFrom, updateItem } = useData();

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);

  // Form states
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState<Audience>("all");
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [targetGroupIds, setTargetGroupIds] = useState<string[]>([]);
  const [includeParents, setIncludeParents] = useState(true);
  const [groupSearch, setGroupSearch] = useState("");

  // List filters
  const [listSearch, setListSearch] = useState("");
  const [audienceFilter, setAudienceFilter] = useState<"all" | Audience>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "expired">("all");
  const [groupFilter, setGroupFilter] = useState("all");

  /** How many students each group holds — shown next to the group so the agent
   *  knows the real reach of the announcement before publishing. */
  const groupStudentCount = useMemo(() => {
    const counts = new Map<string, number>();
    students.forEach((st) => {
      const seen = new Set<string>();
      st.subscriptionIds.forEach((subId) => {
        const sub = subscriptions.find((s) => s.id === subId);
        const sess = sub ? sessions.find((se) => se.id === sub.sessionId) : undefined;
        if (!sess) return;
        // A séance libre covers several groups at once.
        const ids = sess.isOpen && sess.groupIds?.length ? sess.groupIds : [sess.groupId];
        ids.forEach((gid) => seen.add(gid));
      });
      seen.forEach((gid) => counts.set(gid, (counts.get(gid) ?? 0) + 1));
    });
    return counts;
  }, [students, subscriptions, sessions]);

  const reachOf = (ids: string[]) => ids.reduce((s, id) => s + (groupStudentCount.get(id) ?? 0), 0);

  const groupNames = (ids?: string[]) =>
    (ids ?? []).map((id) => groups.find((g) => g.id === id)?.name ?? "—");

  const filteredGroups = groups.filter(
    (g) => !groupSearch.trim() || g.name.toLowerCase().includes(groupSearch.toLowerCase()),
  );

  const toggleGroup = (id: string) =>
    setTargetGroupIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

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
      targetGroupIds,
      includeParents,
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
      targetGroupIds,
      includeParents,
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
    setTargetGroupIds(ann.targetGroupIds ?? []);
    setIncludeParents(ann.includeParents ?? true);
    setGroupSearch("");
    setIsEditOpen(true);
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setAudience("all");
    setEndDate(new Date().toISOString().split("T")[0]);
    setTargetGroupIds([]);
    setIncludeParents(true);
    setGroupSearch("");
    setSelectedAnnouncement(null);
  };

  const clearFilters = () => {
    setListSearch("");
    setAudienceFilter("all");
    setStatusFilter("all");
    setGroupFilter("all");
  };

  const filteredAnnouncements = announcements.filter((ann) => {
    const expired = new Date(ann.endDate) < new Date();
    if (listSearch.trim() && !`${ann.title} ${ann.description}`.toLowerCase().includes(listSearch.toLowerCase()))
      return false;
    if (audienceFilter !== "all" && ann.audience !== audienceFilter) return false;
    if (statusFilter === "active" && expired) return false;
    if (statusFilter === "expired" && !expired) return false;
    if (groupFilter === "school" && (ann.targetGroupIds?.length ?? 0) > 0) return false;
    if (groupFilter !== "all" && groupFilter !== "school" && !(ann.targetGroupIds ?? []).includes(groupFilter))
      return false;
    return true;
  });

  /** Group multi-select + audience switch, shared by the create/edit modals. */
  const targetingBlock = (
    <>
      <div>
        <label className="block text-xs font-semibold text-muted mb-1.5 font-sans">Audience cible</label>
        <div className="grid grid-cols-2 gap-2">
          {(["all", "students", "teachers", "parents"] as Audience[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAudience(a)}
              className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${
                audience === a ? "border-primary bg-primary/10 text-primary" : "border-line bg-surface text-muted"
              }`}
            >
              {a === "all" ? "Tout le monde" : a === "teachers" ? "Enseignants uniquement" : AUDIENCE_LABELS[a]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-semibold text-muted font-sans">
            Groupes concernés{" "}
            <span className="font-normal">({targetGroupIds.length === 0 ? "toute l'école" : `${targetGroupIds.length} sélectionné(s)`})</span>
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => setTargetGroupIds(filteredGroups.map((g) => g.id))}
              className="text-[10px] font-bold text-primary hover:underline"
            >
              Tout sélectionner
            </button>
            {targetGroupIds.length > 0 && (
              <button onClick={() => setTargetGroupIds([])} className="text-[10px] font-bold text-danger hover:underline">
                Effacer
              </button>
            )}
          </div>
        </div>
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <Input
            value={groupSearch}
            onChange={(e) => setGroupSearch(e.target.value)}
            placeholder="Rechercher un groupe..."
            className="pl-9"
          />
        </div>
        <div className="border border-line rounded-xl max-h-40 overflow-y-auto p-1.5 bg-canvas/30 space-y-1">
          {filteredGroups.length === 0 ? (
            <p className="text-[10px] text-muted italic p-2">Aucun groupe.</p>
          ) : (
            filteredGroups.map((g) => {
              const active = targetGroupIds.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => toggleGroup(g.id)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                    active ? "bg-primary text-white font-bold" : "hover:bg-primary-50 text-ink"
                  }`}
                >
                  <span className="truncate">{g.name}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className={active ? "text-white/80" : "text-muted"}>
                      {groupStudentCount.get(g.id) ?? 0} élève(s)
                    </span>
                    {active && <Check className="h-3.5 w-3.5" />}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <p className="text-[10px] text-muted mt-1 leading-relaxed">
          Aucun groupe coché = l&apos;annonce est visible par toute l&apos;école. Sinon, seuls les élèves de
          ces groupes (et leurs parents si l&apos;option ci-dessous est active) la verront.
        </p>
      </div>

      <label className="flex items-center justify-between gap-3 rounded-xl border border-line bg-canvas/40 p-3 cursor-pointer">
        <span className="text-xs">
          <strong className="text-ink block">Rendre l&apos;annonce visible aux parents</strong>
          <span className="text-[10px] text-muted">
            Les parents des élèves des groupes ciblés reçoivent aussi l&apos;annonce.
          </span>
        </span>
        <input
          type="checkbox"
          checked={includeParents}
          onChange={(e) => setIncludeParents(e.target.checked)}
          className="h-4 w-4 shrink-0"
        />
      </label>

      {targetGroupIds.length > 0 && (
        <div className="rounded-xl border border-primary/25 bg-primary-50/40 p-3 text-xs flex items-center justify-between">
          <span className="text-muted font-semibold flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-primary" /> Portée estimée
          </span>
          <strong className="text-primary">
            {reachOf(targetGroupIds)} élève(s){includeParents ? " + leurs parents" : ""}
          </strong>
        </div>
      )}
    </>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <PageHeader emoji="📢" title="Annonces" subtitle="Publier des annonces ciblées par groupe, rôle ou école entière" />
        <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} className="flex items-center gap-2">
          <Plus className="h-4 w-4" /> Nouvelle Annonce
        </Button>
      </div>

      {/* Filters */}
      <Card className="border border-line mb-6">
        <CardBody className="p-4 space-y-3.5">
          <div className="flex items-center justify-between border-b border-line pb-2.5">
            <span className="font-bold text-ink uppercase tracking-wider text-[10px] flex items-center gap-1.5">
              <Filter className="h-4 w-4 text-primary" /> Rechercher & Filtrer
            </span>
            {(listSearch || audienceFilter !== "all" || statusFilter !== "all" || groupFilter !== "all") && (
              <button onClick={clearFilters} className="text-primary hover:underline font-bold text-[10px] flex items-center gap-1">
                <X className="h-3 w-3" /> Réinitialiser
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Recherche</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                <Input
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  placeholder="Titre ou contenu..."
                  className="pl-9"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Audience</label>
              <Select value={audienceFilter} onChange={(e) => setAudienceFilter(e.target.value as typeof audienceFilter)} className="w-full">
                <option value="all">Toutes les audiences</option>
                <option value="students">Élèves</option>
                <option value="parents">Parents</option>
                <option value="teachers">Enseignants</option>
              </Select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Groupe ciblé</label>
              <Select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="w-full">
                <option value="all">Tous</option>
                <option value="school">Toute l&apos;école (sans groupe)</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Statut</label>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="w-full">
                <option value="all">Toutes</option>
                <option value="active">En cours</option>
                <option value="expired">Expirées</option>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
            <Badge tone="primary" className="font-bold">{filteredAnnouncements.length} annonce(s)</Badge>
            <Badge tone="success" className="font-bold">
              {filteredAnnouncements.filter((a) => new Date(a.endDate) >= new Date()).length} en cours
            </Badge>
          </div>
        </CardBody>
      </Card>

      {filteredAnnouncements.length === 0 ? (
        <Card className="p-8 text-center bg-canvas/30 border border-line">
          <Megaphone className="h-10 w-10 text-muted mx-auto mb-2" />
          <h3 className="font-bold text-ink">Aucune annonce</h3>
          <p className="text-xs text-muted mt-1">
            {announcements.length === 0
              ? "Créez votre première annonce pour informer vos élèves, parents ou profs."
              : "Aucune annonce ne correspond aux filtres actuels."}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAnnouncements.map((ann) => {
            const isExpired = new Date(ann.endDate) < new Date();
            const targets = ann.targetGroupIds ?? [];

            return (
              <Card key={ann.id} className={isExpired ? "opacity-60 border border-line" : "border border-line"}>
                <CardBody className="flex flex-col justify-between min-h-[13rem]">
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <Megaphone className="h-4 w-4 text-primary shrink-0" />
                        <h4 className="text-sm font-bold text-ink truncate">{ann.title}</h4>
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

                    {/* Targeted groups */}
                    <div className="mt-2.5 flex flex-wrap gap-1">
                      {targets.length === 0 ? (
                        <Badge tone="neutral" className="text-[9px]">Toute l&apos;école</Badge>
                      ) : (
                        <>
                          {groupNames(targets).slice(0, 3).map((n) => (
                            <Badge key={n} tone="primary" className="text-[9px]">{n}</Badge>
                          ))}
                          {targets.length > 3 && (
                            <Badge tone="neutral" className="text-[9px]">+{targets.length - 3}</Badge>
                          )}
                        </>
                      )}
                      {ann.includeParents !== false && targets.length > 0 && (
                        <Badge tone="success" className="text-[9px]">+ parents</Badge>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-line pt-2.5 mt-2.5 flex items-center justify-between text-[10px]">
                    <div className="flex items-center gap-1 text-muted">
                      <Calendar className="h-3 w-3" />
                      <span>Expire le: {formatDateFr(ann.endDate)}</span>
                    </div>
                    <Badge tone={ann.audience === "all" ? "primary" : ann.audience === "teachers" ? "warning" : "success"}>
                      Cible: {AUDIENCE_LABELS[ann.audience]}
                    </Badge>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {/* Creation Modal */}
      <Modal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Publier une annonce" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Titre de l&apos;annonce *</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre descriptif" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Date d&apos;expiration *</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Message</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Contenu de votre annonce..."
                rows={8}
                className="w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink outline-none focus:border-primary"
              />
            </div>
          </div>
          <div className="space-y-4">{targetingBlock}</div>
        </div>
        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Annuler</Button>
          <Button onClick={handleCreateAnnouncement}>Publier</Button>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Modifier l'annonce" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Titre</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Date d&apos;expiration</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Message</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={8}
                className="w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink outline-none focus:border-primary"
              />
            </div>
          </div>
          <div className="space-y-4">{targetingBlock}</div>
        </div>
        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsEditOpen(false)}>Annuler</Button>
          <Button onClick={handleEditAnnouncement}>Enregistrer</Button>
        </div>
      </Modal>
    </div>
  );
}
