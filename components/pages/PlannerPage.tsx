"use client";

import { useState } from "react";
import { useData, uid } from "@/lib/store/data";
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
  Calendar as CalendarIcon, 
  User, 
  MapPin, 
  Users, 
  Clock, 
  BookOpen,
  Filter,
  X
} from "lucide-react";
import type { ScheduleSession, Day } from "@/lib/types";

const WEEKDAYS: { key: Day; label: string }[] = [
  { key: "saturday", label: "Samedi" },
  { key: "sunday", label: "Dimanche" },
  { key: "monday", label: "Lundi" },
  { key: "tuesday", label: "Mardi" },
  { key: "wednesday", label: "Mercredi" },
  { key: "thursday", label: "Jeudi" },
  { key: "friday", label: "Vendredi" },
];

export function PlannerPage() {
  const {
    sessions,
    classes,
    modules,
    groups,
    salles,
    teachers,
    students,
    subscriptions,
    push,
    deleteFrom,
    updateItem,
  } = useData();

  // View mode toggle
  const [viewMode, setViewMode] = useState<"calendar" | "cards">("calendar");

  // Filters
  const [filterSessionId, setFilterSessionId] = useState("");
  const [filterTeacherId, setFilterTeacherId] = useState("");
  const [filterSalleId, setFilterSalleId] = useState("");
  const [filterClassId, setFilterClassId] = useState("");

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<ScheduleSession | null>(null);

  // Form states
  const [classId, setClassId] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [salleId, setSalleId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [selectedDays, setSelectedDays] = useState<Day[]>([]);
  const [startHour, setStartHour] = useState("08");
  const [startMin, setStartMin] = useState("00");
  const [endHour, setEndHour] = useState("10");
  const [endMin, setEndMin] = useState("00");

  // Inline creations
  const [newModuleName, setNewModuleName] = useState("");
  const [showAddModule, setShowAddModule] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [newSalleName, setNewSalleName] = useState("");
  const [showAddSalle, setShowAddSalle] = useState(false);

  // Helper: consistent coloring by module ID
  const getSessionColor = (modId: string) => {
    let hash = 0;
    for (let i = 0; i < modId.length; i++) {
      hash = modId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = [
      "border-l-4 border-l-blue-500 bg-blue-50/70 text-blue-900 dark:bg-blue-950/20 dark:text-blue-200 border-blue-100",
      "border-l-4 border-l-emerald-500 bg-emerald-50/70 text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200 border-emerald-100",
      "border-l-4 border-l-amber-500 bg-amber-50/70 text-amber-900 dark:bg-amber-950/20 dark:text-amber-200 border-amber-100",
      "border-l-4 border-l-rose-500 bg-rose-50/70 text-rose-900 dark:bg-rose-950/20 dark:text-rose-200 border-rose-100",
      "border-l-4 border-l-purple-500 bg-purple-50/70 text-purple-900 dark:bg-purple-950/20 dark:text-purple-200 border-purple-100",
      "border-l-4 border-l-cyan-500 bg-cyan-50/70 text-cyan-900 dark:bg-cyan-950/20 dark:text-cyan-200 border-cyan-100",
      "border-l-4 border-l-indigo-500 bg-indigo-50/70 text-indigo-900 dark:bg-indigo-950/20 dark:text-indigo-200 border-indigo-100",
    ];
    return colors[Math.abs(hash) % colors.length];
  };

  // Helpers
  const getClassName = (cid: string) => {
    const cls = classes.find((c) => c.id === cid);
    if (!cls) return "-";
    const lvl = cls.type === "cours" ? cls.coursLevel : cls.formationLevel;
    return `${cls.name} (${lvl})`;
  };

  const getModuleName = (mid: string) => modules.find((m) => m.id === mid)?.name ?? "-";
  const getGroupName = (gid: string) => groups.find((g) => g.id === gid)?.name ?? "-";
  const getSalleName = (sid: string) => salles.find((s) => s.id === sid)?.name ?? "-";
  const getTeacherName = (tid: string) => {
    const t = teachers.find((te) => te.id === tid);
    return t ? `${t.firstName} ${t.lastName}` : "-";
  };

  const toggleDay = (day: Day) => {
    if (selectedDays.includes(day)) {
      setSelectedDays(selectedDays.filter((d) => d !== day));
    } else {
      setSelectedDays([...selectedDays, day]);
    }
  };

  const handleCreateModule = () => {
    if (!newModuleName.trim()) return;
    const newId = uid("mod");
    push("modules", { id: newId, name: newModuleName });
    setModuleId(newId);
    setNewModuleName("");
    setShowAddModule(false);
  };

  const handleCreateGroup = () => {
    if (!newGroupName.trim()) return;
    const newId = uid("grp");
    push("groups", { id: newId, name: newGroupName });
    setGroupId(newId);
    setNewGroupName("");
    setShowAddGroup(false);
  };

  const handleCreateSalle = () => {
    if (!newSalleName.trim()) return;
    const newId = uid("salle");
    push("salles", { id: newId, name: newSalleName });
    setSalleId(newId);
    setNewSalleName("");
    setShowAddSalle(false);
  };

  const handleCreateSession = () => {
    if (!classId || !moduleId || !groupId || !salleId || !teacherId || selectedDays.length === 0) {
      alert("Veuillez remplir tous les champs obligatoires et sélectionner au moins un jour.");
      return;
    }
    const newSession: ScheduleSession = {
      id: uid("ses"),
      classId,
      moduleId,
      groupId,
      salleId,
      teacherId,
      days: selectedDays,
      startTime: `${startHour}:${startMin}`,
      endTime: `${endHour}:${endMin}`,
    };
    push("sessions", newSession);
    setIsCreateOpen(false);
    resetForm();
  };

  const handleEditSession = () => {
    if (!selectedSession) return;
    if (!classId || !moduleId || !groupId || !salleId || !teacherId || selectedDays.length === 0) {
      alert("Veuillez remplir tous les champs obligatoires.");
      return;
    }
    const updated: Partial<ScheduleSession> = {
      classId,
      moduleId,
      groupId,
      salleId,
      teacherId,
      days: selectedDays,
      startTime: `${startHour}:${startMin}`,
      endTime: `${endHour}:${endMin}`,
    };
    updateItem("sessions", selectedSession.id, updated);
    setIsEditOpen(false);
    resetForm();
  };

  const handleDelete = (id: string) => {
    if (confirm("Êtes-vous sûr de vouloir supprimer cet emploi du temps ?")) {
      deleteFrom("sessions", id);
      setIsDetailsOpen(false);
    }
  };

  const resetForm = () => {
    setClassId("");
    setModuleId("");
    setGroupId("");
    setSalleId("");
    setTeacherId("");
    setSelectedDays([]);
    setStartHour("08");
    setStartMin("00");
    setEndHour("10");
    setEndMin("00");
    setSelectedSession(null);
  };

  const openEdit = (s: ScheduleSession) => {
    setSelectedSession(s);
    setClassId(s.classId);
    setModuleId(s.moduleId);
    setGroupId(s.groupId);
    setSalleId(s.salleId);
    setTeacherId(s.teacherId);
    setSelectedDays(s.days);
    const [sh, sm] = s.startTime.split(":");
    const [eh, em] = s.endTime.split(":");
    setStartHour(sh);
    setStartMin(sm);
    setEndHour(eh);
    setEndMin(em);
    setIsEditOpen(true);
    setIsDetailsOpen(false);
  };

  const openDetails = (s: ScheduleSession) => {
    setSelectedSession(s);
    setIsDetailsOpen(true);
  };

  const getSessionStudents = (sessionId: string) => {
    const sub = subscriptions.find((su) => su.sessionId === sessionId);
    if (!sub) return [];
    return students.filter((stu) => stu.subscriptionIds.includes(sub.id));
  };

  const getHours = () => Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const getMinutes = () => ["00", "15", "30", "45"];

  const clearFilters = () => {
    setFilterSessionId("");
    setFilterTeacherId("");
    setFilterSalleId("");
    setFilterClassId("");
  };

  // Filter sessions
  const filteredSessions = sessions.filter((s) => {
    if (filterSessionId && s.id !== filterSessionId) return false;
    if (filterTeacherId && s.teacherId !== filterTeacherId) return false;
    if (filterSalleId && s.salleId !== filterSalleId) return false;
    if (filterClassId && s.classId !== filterClassId) return false;
    return true;
  });

  return (
    <div className="space-y-6 text-xs">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader emoji="📅" title="Emploi du Temps" subtitle="Visualisation du calendrier hebdomadaire et planification" />
        <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} className="flex items-center gap-2 self-start sm:self-center">
          <Plus className="h-4 w-4" /> Créer une Séance
        </Button>
      </div>

      {/* Advanced Filter Toolbar */}
      <Card className="border border-line shadow-sm">
        <CardBody className="p-4 space-y-3.5">
          <div className="flex items-center justify-between border-b border-line pb-2.5">
            <span className="font-bold text-ink uppercase tracking-wider text-[10px] flex items-center gap-1.5">
              <Filter className="h-4 w-4 text-primary" /> Filtrer le Calendrier
            </span>
            {(filterSessionId || filterTeacherId || filterClassId || filterSalleId) && (
              <button onClick={clearFilters} className="text-primary hover:underline font-bold text-[10px] flex items-center gap-1">
                <X className="h-3 w-3" /> Réinitialiser
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Filter by specific emploi du temps */}
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Séance Spécifique</label>
              <Select value={filterSessionId} onChange={(e) => setFilterSessionId(e.target.value)} className="w-full">
                <option value="">Tous les cours</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {getModuleName(s.moduleId)} - {getGroupName(s.groupId)}
                  </option>
                ))}
              </Select>
            </div>

            {/* Filter by Teacher */}
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Enseignant</label>
              <Select value={filterTeacherId} onChange={(e) => setFilterTeacherId(e.target.value)} className="w-full">
                <option value="">Tous les enseignants</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.firstName} {t.lastName}
                  </option>
                ))}
              </Select>
            </div>

            {/* Filter by Classroom */}
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Salle de Cours</label>
              <Select value={filterSalleId} onChange={(e) => setFilterSalleId(e.target.value)} className="w-full">
                <option value="">Toutes les salles</option>
                {salles.map((sa) => (
                  <option key={sa.id} value={sa.id}>
                    {sa.name}
                  </option>
                ))}
              </Select>
            </div>

            {/* Filter by Class */}
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Classe & Niveau</label>
              <Select value={filterClassId} onChange={(e) => setFilterClassId(e.target.value)} className="w-full">
                <option value="">Toutes les classes</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.type === "cours" ? c.coursLevel : c.formationLevel})
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Layout View Toggle */}
      <div className="flex justify-end items-center gap-2">
        <span className="text-[10px] uppercase font-bold text-muted font-sans mr-1">Affichage :</span>
        <div className="bg-canvas border border-line p-1 rounded-xl flex gap-1">
          <button
            onClick={() => setViewMode("calendar")}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
              viewMode === "calendar"
                ? "bg-primary text-white shadow-sm"
                : "text-muted hover:text-ink hover:bg-canvas/50"
            }`}
          >
            Vue Calendrier
          </button>
          <button
            onClick={() => setViewMode("cards")}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
              viewMode === "cards"
                ? "bg-primary text-white shadow-sm"
                : "text-muted hover:text-ink hover:bg-canvas/50"
            }`}
          >
            Vue Cartes
          </button>
        </div>
      </div>

      {viewMode === "calendar" ? (
        /* TIMETABLE BOARD COLUMN GRID */
        <div className="overflow-x-auto pb-4">
          <div className="grid grid-cols-1 md:grid-cols-7 gap-4 min-w-[900px] md:min-w-0">
            {WEEKDAYS.map((day) => {
              // Filter and sort sessions chronologically for this day
              const daySessions = filteredSessions
                .filter((s) => s.days.includes(day.key))
                .sort((a, b) => a.startTime.localeCompare(b.startTime));

              return (
                <div key={day.key} className="flex flex-col bg-canvas/30 rounded-2xl border border-line p-3 min-h-[420px] space-y-3.5">
                  {/* Column Header */}
                  <div className="border-b border-line pb-2.5 text-center flex justify-between items-center px-1">
                    <span className="font-extrabold text-ink uppercase text-[10px] tracking-wider block capitalize">
                      {day.label}
                    </span>
                    <Badge tone={daySessions.length > 0 ? "primary" : "neutral"} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                      {daySessions.length}
                    </Badge>
                  </div>

                  {/* Day Timetable Cards list */}
                  <div className="flex-1 space-y-2.5 overflow-y-auto max-h-[500px] pr-0.5">
                    {daySessions.length === 0 ? (
                      <div className="h-full flex items-center justify-center py-16 text-center text-muted font-medium italic text-[10px]">
                        Libre
                      </div>
                    ) : (
                      daySessions.map((s) => {
                        const enrolledCount = getSessionStudents(s.id).length;
                        return (
                          <div
                            key={s.id}
                            onClick={() => openDetails(s)}
                            className={`p-3 rounded-xl border cursor-pointer hover:shadow-sm hover:scale-[1.01] transition-all duration-200 space-y-2 ${getSessionColor(
                              s.moduleId
                            )}`}
                          >
                            {/* Timings */}
                            <div className="flex items-center gap-1 text-[9px] font-bold font-mono">
                              <Clock className="h-3 w-3 shrink-0" />
                              <span>{s.startTime} - {s.endTime}</span>
                            </div>

                            {/* Module & Class Info */}
                            <div className="space-y-0.5">
                              <strong className="block text-[11px] font-black leading-tight line-clamp-2">
                                {getModuleName(s.moduleId)}
                              </strong>
                              <span className="block text-[9px] opacity-80 font-bold truncate">
                                {getClassName(s.classId)}
                              </span>
                            </div>

                            {/* Room & Teacher */}
                            <div className="text-[9px] opacity-90 space-y-1 pt-1.5 border-t border-black/5 dark:border-white/5">
                              <div className="flex items-center gap-1">
                                <User className="h-3 w-3 shrink-0" />
                                <span className="truncate">{getTeacherName(s.teacherId)}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-1 truncate max-w-[65%]">
                                  <MapPin className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{getSalleName(s.salleId)}</span>
                                </span>
                                <Badge tone="success" className="text-[8px] px-1 py-0 font-bold">
                                  {enrolledCount} él.
                                </Badge>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* DETAILED CARDS VIEW */
        <div>
          {filteredSessions.length === 0 ? (
            <div className="text-center p-12 bg-canvas/30 border border-line border-dashed rounded-2xl text-muted text-xs">
              Aucune séance d'emploi du temps ne correspond aux filtres actuels.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSessions.map((s) => {
                const enrolledCount = getSessionStudents(s.id).length;
                return (
                  <Card key={s.id} className={`hover:shadow-md transition-all duration-200 ${getSessionColor(s.moduleId)}`}>
                    <CardBody className="p-4 space-y-3 flex flex-col justify-between h-full">
                      <div className="space-y-2">
                        {/* Header: Module + Group Badge */}
                        <div className="flex justify-between items-start">
                          <div className="min-w-0">
                            <strong className="block text-sm font-black text-ink leading-tight truncate">
                              {getModuleName(s.moduleId)}
                            </strong>
                            <span className="text-[10px] font-bold opacity-80 mt-0.5 block truncate">
                              {getClassName(s.classId)}
                            </span>
                          </div>
                          <Badge tone="primary" className="font-bold shrink-0">
                            {getGroupName(s.groupId)}
                          </Badge>
                        </div>

                        {/* Room & Teacher & Schedule info */}
                        <div className="space-y-1.5 pt-2 border-t border-black/5 dark:border-white/5 text-[11px] text-ink/90">
                          <div className="flex items-center gap-2">
                            <User className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span>Enseignant: <strong>{getTeacherName(s.teacherId)}</strong></span>
                          </div>
                          <div className="flex items-center gap-2">
                            <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span>Salle: <strong>{getSalleName(s.salleId)}</strong></span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span>Horaires: <strong className="font-mono">{s.startTime} - {s.endTime}</strong></span>
                          </div>
                        </div>

                        {/* Days list */}
                        <div className="pt-1 flex flex-wrap gap-1">
                          {s.days.map((dayKey) => (
                            <Badge key={dayKey} tone="neutral" className="text-[9px] font-bold uppercase">
                              {WEEKDAYS.find((wd) => wd.key === dayKey)?.label || dayKey}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      {/* Footer Actions & Count */}
                      <div className="flex justify-between items-center pt-3 border-t border-black/5 dark:border-white/5 mt-auto">
                        <Badge tone="success" className="text-[10px] font-bold flex items-center gap-1">
                          <Users className="h-3 w-3" /> {enrolledCount} élève(s)
                        </Badge>

                        <div className="flex gap-1.5">
                          <button
                            onClick={() => openDetails(s)}
                            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-ink/80 transition-colors"
                            title="Consulter les détails"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => openEdit(s)}
                            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-primary transition-colors"
                            title="Modifier"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(s.id)}
                            className="p-1.5 rounded-lg hover:bg-danger/10 text-danger transition-colors"
                            title="Supprimer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Creation Modal */}
      <Modal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Créer un emploi du temps" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left panel - core drop downs */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Classe</label>
              <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-full">
                <option value="">Sélectionner une classe</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.type === "cours" ? c.coursLevel : c.formationLevel})
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-muted font-sans">Module</label>
                <button onClick={() => setShowAddModule(!showAddModule)} className="text-xs text-primary hover:underline">
                  + Nouveau module
                </button>
              </div>
              {showAddModule ? (
                <div className="flex gap-2">
                  <Input
                    value={newModuleName}
                    onChange={(e) => setNewModuleName(e.target.value)}
                    placeholder="Nom du module"
                    className="flex-1"
                  />
                  <Button size="sm" onClick={handleCreateModule}>Créer</Button>
                </div>
              ) : (
                <Select value={moduleId} onChange={(e) => setModuleId(e.target.value)} className="w-full">
                  <option value="">Sélectionner un module</option>
                  {modules.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-muted font-sans">Groupe</label>
                <button onClick={() => setShowAddGroup(!showAddGroup)} className="text-xs text-primary hover:underline">
                  + Nouveau groupe
                </button>
              </div>
              {showAddGroup ? (
                <div className="flex gap-2">
                  <Input
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="Nom du groupe (ex: Groupe C)"
                    className="flex-1"
                  />
                  <Button size="sm" onClick={handleCreateGroup}>Créer</Button>
                </div>
              ) : (
                <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="w-full">
                  <option value="">Sélectionner un groupe</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-muted font-sans">Salle</label>
                <button onClick={() => setShowAddSalle(!showAddSalle)} className="text-xs text-primary hover:underline">
                  + Nouvelle salle
                </button>
              </div>
              {showAddSalle ? (
                <div className="flex gap-2">
                  <Input
                    value={newSalleName}
                    onChange={(e) => setNewSalleName(e.target.value)}
                    placeholder="Nom de la salle"
                    className="flex-1"
                  />
                  <Button size="sm" onClick={handleCreateSalle}>Créer</Button>
                </div>
              ) : (
                <Select value={salleId} onChange={(e) => setSalleId(e.target.value)} className="w-full">
                  <option value="">Sélectionner une salle</option>
                  {salles.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Enseignant</label>
              <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="w-full">
                <option value="">Sélectionner un enseignant</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.firstName} {t.lastName}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* Right panel - days & times */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-2 font-sans">Sélectionner les jours de cours</label>
              <div className="grid grid-cols-2 gap-2">
                {WEEKDAYS.map((day) => {
                  const active = selectedDays.includes(day.key);
                  return (
                    <Button
                      key={day.key}
                      variant={active ? "primary" : "outline"}
                      onClick={() => toggleDay(day.key)}
                      size="sm"
                      className="w-full text-start py-2 justify-between"
                    >
                      <span>{day.label}</span>
                      {active && <span className="text-[10px] bg-white/25 px-1.5 rounded">✔</span>}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Heure de début</label>
              <div className="flex gap-2">
                <Select value={startHour} onChange={(e) => setStartHour(e.target.value)} className="flex-1">
                  {getHours().map((h) => <option key={h} value={h}>{h} H</option>)}
                </Select>
                <Select value={startMin} onChange={(e) => setStartMin(e.target.value)} className="flex-1">
                  {getMinutes().map((m) => <option key={m} value={m}>{m} Min</option>)}
                </Select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Heure de fin</label>
              <div className="flex gap-2">
                <Select value={endHour} onChange={(e) => setEndHour(e.target.value)} className="flex-1">
                  {getHours().map((h) => <option key={h} value={h}>{h} H</option>)}
                </Select>
                <Select value={endMin} onChange={(e) => setEndMin(e.target.value)} className="flex-1">
                  {getMinutes().map((m) => <option key={m} value={m}>{m} Min</option>)}
                </Select>
              </div>
            </div>

            {/* Generated Name Preview */}
            <div className="bg-canvas/50 border border-line rounded-xl p-3 text-xs">
              <span className="text-[10px] text-muted block font-semibold mb-1 font-sans">Nom suggéré de l'emploi</span>
              <div className="font-bold text-ink line-clamp-2">
                {classId ? classes.find((c) => c.id === classId)?.name : "?"} -{" "}
                {moduleId ? getModuleName(moduleId) : "?"} (Gr: {groupId ? getGroupName(groupId) : "?"} / Salle:{" "}
                {salleId ? getSalleName(salleId) : "?"}) par {teacherId ? getTeacherName(teacherId) : "?"}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleCreateSession}>Créer</Button>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Modifier l'emploi du temps" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Classe</label>
              <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-full">
                <option value="">Sélectionner une classe</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.type === "cours" ? c.coursLevel : c.formationLevel})
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Module</label>
              <Select value={moduleId} onChange={(e) => setModuleId(e.target.value)} className="w-full">
                <option value="">Sélectionner un module</option>
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Groupe</label>
              <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="w-full">
                <option value="">Sélectionner un groupe</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Salle</label>
              <Select value={salleId} onChange={(e) => setSalleId(e.target.value)} className="w-full">
                <option value="">Sélectionner une salle</option>
                {salles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Enseignant</label>
              <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="w-full">
                <option value="">Sélectionner un enseignant</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.firstName} {t.lastName}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-2 font-sans">Sélectionner les jours</label>
              <div className="grid grid-cols-2 gap-2">
                {WEEKDAYS.map((day) => {
                  const active = selectedDays.includes(day.key);
                  return (
                    <Button
                      key={day.key}
                      variant={active ? "primary" : "outline"}
                      onClick={() => toggleDay(day.key)}
                      size="sm"
                      className="w-full text-start py-2 justify-between"
                    >
                      <span>{day.label}</span>
                      {active && <span className="text-[10px]">✔</span>}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Heure de début</label>
              <div className="flex gap-2">
                <Select value={startHour} onChange={(e) => setStartHour(e.target.value)} className="flex-1">
                  {getHours().map((h) => <option key={h} value={h}>{h} H</option>)}
                </Select>
                <Select value={startMin} onChange={(e) => setStartMin(e.target.value)} className="flex-1">
                  {getMinutes().map((m) => <option key={m} value={m}>{m} Min</option>)}
                </Select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Heure de fin</label>
              <div className="flex gap-2">
                <Select value={endHour} onChange={(e) => setEndHour(e.target.value)} className="flex-1">
                  {getHours().map((h) => <option key={h} value={h}>{h} H</option>)}
                </Select>
                <Select value={endMin} onChange={(e) => setEndMin(e.target.value)} className="flex-1">
                  {getMinutes().map((m) => <option key={m} value={m}>{m} Min</option>)}
                </Select>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsEditOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleEditSession}>Enregistrer</Button>
        </div>
      </Modal>

      {/* Details Modal */}
      <Modal open={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Détails de la Séance" wide>
        {selectedSession && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-primary-50/50 rounded-xl p-4 border border-line">
              <div>
                <span className="text-[10px] text-muted block uppercase font-sans">Module / Matière</span>
                <span className="font-bold text-ink">{getModuleName(selectedSession.moduleId)}</span>
              </div>
              <div>
                <span className="text-[10px] text-muted block uppercase font-sans">Classe & Niveau</span>
                <span className="font-semibold text-ink">{getClassName(selectedSession.classId)}</span>
              </div>
              <div>
                <span className="text-[10px] text-muted block uppercase font-sans">Groupe / Salle</span>
                <span className="font-semibold text-ink">
                  {getGroupName(selectedSession.groupId)} - {getSalleName(selectedSession.salleId)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-muted block uppercase font-sans">Enseignant</span>
                <span className="font-semibold text-ink">{getTeacherName(selectedSession.teacherId)}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-bold text-ink mb-2.5 flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-primary" /> Jours & Horaires
                </h4>
                <div className="bg-surface border border-line p-4 rounded-xl space-y-3">
                  <div className="flex justify-between items-center text-xs border-b border-line pb-2">
                    <span className="text-muted">Heure de début:</span>
                    <strong className="text-primary font-bold">{selectedSession.startTime}</strong>
                  </div>
                  <div className="flex justify-between items-center text-xs border-b border-line pb-2">
                    <span className="text-muted">Heure de fin:</span>
                    <strong className="text-primary font-bold">{selectedSession.endTime}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted block mb-1.5 font-sans">Jours programmés:</span>
                    <div className="flex flex-wrap gap-1">
                      {selectedSession.days.map((d) => (
                        <Badge key={d} tone="primary" className="uppercase text-[9px] font-bold">
                          {WEEKDAYS.find((wd) => wd.key === d)?.label || d}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-ink mb-2.5 flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-primary" /> Étudiants Inscrits ({getSessionStudents(selectedSession.id).length})
                </h4>
                <div className="bg-surface border border-line p-3 rounded-xl max-h-48 overflow-y-auto space-y-2">
                  {getSessionStudents(selectedSession.id).length === 0 ? (
                    <p className="text-xs text-muted italic p-4 text-center">Aucun étudiant inscrit à cette séance.</p>
                  ) : (
                    getSessionStudents(selectedSession.id).map((stu) => (
                      <div key={stu.id} className="flex justify-between items-center text-xs bg-canvas/30 p-2.5 rounded-lg border border-line/50">
                        <div>
                          <span className="font-bold text-ink block">{stu.firstName} {stu.lastName}</span>
                          <span className="text-[10px] text-muted">{stu.phone}</span>
                        </div>
                        <Badge tone={stu.balance < 0 ? "danger" : "primary"} className="font-bold">
                          {stu.balance} DA
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Admin actions block */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-4 border-t border-line">
              <div className="flex gap-2">
                <Button variant="outline" className="flex items-center gap-1 text-xs text-ink" onClick={() => openEdit(selectedSession)}>
                  <Edit className="h-4 w-4" /> Modifier
                </Button>
                <Button variant="outline" className="flex items-center gap-1 text-xs text-danger border-danger/20 hover:bg-danger/5" onClick={() => handleDelete(selectedSession.id)}>
                  <Trash2 className="h-4 w-4 text-danger" /> Supprimer la Séance
                </Button>
              </div>
              <Button onClick={() => setIsDetailsOpen(false)}>Fermer</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
