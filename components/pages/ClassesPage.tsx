"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useData, uid } from "@/lib/store/data";
import { useShallow } from "zustand/react/shallow";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import { ClassDetailsModal } from "@/components/classes/ClassDetailsModal";
import {
  AlertTriangle,
  CalendarDays,
  Edit,
  Eye,
  MoreVertical,
  Plus,
  Search,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import {
  COURS_LEVEL_LABELS,
  isExpiredOpenSeance,
  normalizeSearchText,
  studentDebtOf,
  type StudentDebt,
} from "@/lib/helpers";
import { buildSessionStats, sessionsOfClass, summarizeClass, type ClassSummary } from "@/lib/classStats";
import type { SchoolClass, CoursLevel, FormationLevel } from "@/lib/types";

type SortKey = "name" | "students" | "debt";

export function ClassesPage() {
  const {
    classes,
    filieres,
    students,
    subscriptions,
    sessions,
    attendance,
    absencePenalties,
    unpaidTeacher,
    push,
    deleteFrom,
    updateItem,
  } = useData(
    useShallow((s) => ({
      classes: s.classes,
      filieres: s.filieres,
      students: s.students,
      subscriptions: s.subscriptions,
      sessions: s.sessions,
      attendance: s.attendance,
      absencePenalties: s.absencePenalties,
      unpaidTeacher: s.unpaidTeacher,
      push: s.push,
      deleteFrom: s.deleteFrom,
      updateItem: s.updateItem,
    })),
  );

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [detailsClassId, setDetailsClassId] = useState<string | null>(null);
  const [selectedClass, setSelectedClass] = useState<SchoolClass | null>(null);

  // Form states
  const [type, setType] = useState<"cours" | "formation">("cours");
  const [coursLevel, setCoursLevel] = useState<CoursLevel>("primaire");
  const [year, setYear] = useState("1er");
  const [filiereId, setFiliereId] = useState("");
  const [formationLevel, setFormationLevel] = useState<FormationLevel>("A1");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Inline creations
  const [newFiliereName, setNewFiliereName] = useState("");
  const [showAddFiliere, setShowAddFiliere] = useState(false);
  const [formationLevelsList, setFormationLevelsList] = useState<string[]>(["A1", "A2", "B1", "B2", "C1", "C2"]);
  const [newLevelName, setNewLevelName] = useState("");
  const [showAddLevel, setShowAddLevel] = useState(false);

  // Active menu dropdown index
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // List filters
  const [filterFiliereId, setFilterFiliereId] = useState<string>("all");
  const [filterType, setFilterType] = useState<"all" | "cours" | "formation">("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [sort, setSort] = useState<SortKey>("name");

  // ---- Les chiffres de TOUTES les classes, en une passe ---------------------------
  // (l'ancien écran reparcourait élèves × abonnements × créneaux pour chaque
  // carte, à chaque rendu)
  const debtById = useMemo(() => {
    const map = new Map<string, StudentDebt>();
    for (const s of students) map.set(s.id, studentDebtOf(s));
    return map;
  }, [students]);

  const summaries = useMemo(() => {
    const stats = buildSessionStats({
      sessions,
      subscriptions,
      students,
      attendance,
      absencePenalties,
      unpaidTeacher,
      debtOf: (s) => debtById.get(s.id) ?? studentDebtOf(s),
    });
    const out = new Map<string, ClassSummary>();
    for (const cls of classes) {
      // Les séances libres terminées ne comptent plus dans les chiffres courants.
      const current = sessionsOfClass(sessions, cls.id).filter((s) => !isExpiredOpenSeance(s));
      out.set(cls.id, summarizeClass(current, stats, (id) => debtById.get(id)));
    }
    return out;
  }, [classes, sessions, subscriptions, students, attendance, absencePenalties, unpaidTeacher, debtById]);

  const overall = useMemo(() => {
    const studentsSet = new Set<string>();
    const debtorSet = new Set<string>();
    for (const s of summaries.values()) {
      s.studentIds.forEach((id) => studentsSet.add(id));
      s.debtorIds.forEach((id) => debtorSet.add(id));
    }
    let totalDebt = 0;
    for (const id of debtorSet) totalDebt += debtById.get(id)?.total ?? 0;
    return { students: studentsSet.size, debtors: debtorSet.size, totalDebt };
  }, [summaries, debtById]);

  const getFiliereName = (fid?: string) => {
    return filieres.find((f) => f.id === fid)?.name ?? "-";
  };

  const handleCreateFiliere = () => {
    if (!newFiliereName.trim()) return;
    const newId = uid("fil");
    push("filieres", { id: newId, name: newFiliereName });
    setFiliereId(newId);
    setNewFiliereName("");
    setShowAddFiliere(false);
  };

  const handleCreateLevel = () => {
    if (!newLevelName.trim()) return;
    if (!formationLevelsList.includes(newLevelName)) {
      setFormationLevelsList([...formationLevelsList, newLevelName]);
    }
    setFormationLevel(newLevelName as FormationLevel);
    setNewLevelName("");
    setShowAddLevel(false);
  };

  const handleCreateClass = () => {
    const classId = uid("cls");
    const newClass: SchoolClass = {
      id: classId,
      type,
      name: type === "cours" ? `${year} Année${filiereId ? " - " + getFiliereName(filiereId) : ""}` : name,
      description,
      ...(type === "cours" ? { coursLevel, year, filiereId } : { formationLevel }),
    };

    push("classes", newClass);
    setIsCreateOpen(false);
    resetForm();
  };

  const handleEditClass = () => {
    if (!selectedClass) return;
    const updated: Partial<SchoolClass> = {
      type,
      name: type === "cours" ? `${year} Année${filiereId ? " - " + getFiliereName(filiereId) : ""}` : name,
      description,
      coursLevel: type === "cours" ? coursLevel : undefined,
      year: type === "cours" ? year : undefined,
      filiereId: type === "cours" ? filiereId : undefined,
      formationLevel: type === "formation" ? formationLevel : undefined,
    };
    updateItem("classes", selectedClass.id, updated);
    setIsEditOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setType("cours");
    setCoursLevel("primaire");
    setYear("1er");
    setFiliereId("");
    setFormationLevel("A1");
    setName("");
    setDescription("");
    setSelectedClass(null);
    setShowAddFiliere(false);
    setNewFiliereName("");
  };

  const openEdit = (cls: SchoolClass) => {
    setSelectedClass(cls);
    setShowAddFiliere(false);
    setNewFiliereName("");
    setType(cls.type);
    setDescription(cls.description);
    if (cls.type === "cours") {
      setCoursLevel(cls.coursLevel || "primaire");
      setYear(cls.year || "1er");
      setFiliereId(cls.filiereId || "");
    } else {
      setName(cls.name);
      setFormationLevel(cls.formationLevel || "A1");
    }
    setIsEditOpen(true);
    setActiveMenuId(null);
  };

  const openDetails = (cls: SchoolClass) => {
    setDetailsClassId(cls.id);
    setActiveMenuId(null);
  };

  const handleDelete = (id: string) => {
    if (confirm("Êtes-vous sûr de vouloir supprimer cette classe ?")) {
      deleteFrom("classes", id);
      setActiveMenuId(null);
    }
  };

  // Get year options depending on selected coursLevel
  const getYearOptions = () => {
    if (coursLevel === "primaire") return ["1er", "2eme", "3eme", "4eme", "5eme"];
    if (coursLevel === "moyen") return ["1er", "2eme", "3eme", "4eme"];
    return ["1er", "2eme", "3eme"]; // lycée
  };

  // Classes shown in the grid: filière, type, search, then the chosen order.
  const visibleClasses = useMemo(() => {
    const q = normalizeSearchText(deferredSearch.trim());
    const list = classes.filter((c) => {
      if (filterFiliereId !== "all" && c.filiereId !== filterFiliereId) return false;
      if (filterType !== "all" && c.type !== filterType) return false;
      if (!q) return true;
      const fil = c.filiereId ? filieres.find((f) => f.id === c.filiereId)?.name ?? "" : "";
      const level = c.coursLevel ? COURS_LEVEL_LABELS[c.coursLevel] : c.formationLevel ?? "";
      return normalizeSearchText(`${c.name} ${fil} ${level} ${c.description}`).includes(q);
    });
    const studentCount = (c: SchoolClass) => summaries.get(c.id)?.studentIds.length ?? 0;
    const debt = (c: SchoolClass) => summaries.get(c.id)?.totalDebt ?? 0;
    return list.sort((a, b) => {
      if (sort === "students") return studentCount(b) - studentCount(a) || a.name.localeCompare(b.name);
      if (sort === "debt") return debt(b) - debt(a) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name, "fr", { numeric: true });
    });
  }, [classes, filieres, filterFiliereId, filterType, deferredSearch, sort, summaries]);

  const filtersActive = filterFiliereId !== "all" || filterType !== "all" || search.trim() !== "";

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <PageHeader emoji="🏫" title="Classes" subtitle="Gérer les classes et formations" />
        <Button
          onClick={() => {
            resetForm();
            setIsCreateOpen(true);
          }}
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" /> Nouvelle Classe
        </Button>
      </div>

      {/* Chiffres de toutes les classes */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Classes" value={classes.length} icon="🏫" tone="primary" />
        <SummaryTile label="Élèves inscrits" value={overall.students} icon="🎓" tone="success" />
        <SummaryTile
          label="Élèves en dette"
          value={overall.debtors}
          icon="⚠️"
          tone={overall.debtors > 0 ? "danger" : "success"}
        />
        <SummaryTile
          label="Dettes à recouvrer"
          value={`${overall.totalDebt} DA`}
          icon="💰"
          tone={overall.totalDebt > 0 ? "warning" : "success"}
        />
      </div>

      {/* Filtres */}
      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted ltr:left-3 rtl:right-3" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une classe (nom, niveau, filière)…"
            className="ltr:pl-9 rtl:pr-9"
          />
        </div>
        <div className="flex gap-1">
          {(
            [
              ["all", "Toutes"],
              ["cours", "Cours"],
              ["formation", "Formations"],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              variant={filterType === key ? "primary" : "outline"}
              onClick={() => setFilterType(key)}
            >
              {label}
            </Button>
          ))}
        </div>
        <Select value={filterFiliereId} onChange={(e) => setFilterFiliereId(e.target.value)} className="min-w-[180px]">
          <option value="all">Toutes les filières</option>
          {filieres.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="min-w-[160px]">
          <option value="name">Trier par nom</option>
          <option value="students">Plus d&apos;élèves</option>
          <option value="debt">Plus de dettes</option>
        </Select>
        {filtersActive && (
          <button
            onClick={() => {
              setFilterFiliereId("all");
              setFilterType("all");
              setSearch("");
            }}
            className="text-xs text-primary hover:underline"
          >
            Réinitialiser
          </button>
        )}
        <span className="ms-auto text-xs text-muted">
          {visibleClasses.length} classe{visibleClasses.length > 1 ? "s" : ""}
        </span>
      </div>

      {/* Grid of classes */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {visibleClasses.map((cls) => {
          const summary = summaries.get(cls.id);
          const studentCount = summary?.studentIds.length ?? 0;
          const debtors = summary?.debtorIds.length ?? 0;
          const fil = cls.filiereId ? getFiliereName(cls.filiereId) : "";
          return (
            <Card key={cls.id} className="relative flex flex-col overflow-visible">
              <CardBody className="flex flex-1 flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => openDetails(cls)} className="min-w-0 text-start">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={cls.type === "cours" ? "primary" : "success"}>
                        {cls.type === "cours" ? "Cours" : "Formation"}
                      </Badge>
                      {cls.type === "cours" && cls.coursLevel && (
                        <span className="rounded-md border border-line px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                          {COURS_LEVEL_LABELS[cls.coursLevel]}
                        </span>
                      )}
                      {fil && fil !== "-" && (
                        <span className="rounded-md border border-line px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                          {fil}
                        </span>
                      )}
                      {cls.type === "formation" && cls.formationLevel && (
                        <span className="rounded-md border border-line px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                          Niveau {cls.formationLevel}
                        </span>
                      )}
                    </div>
                    <h3 className="mt-2 truncate text-lg font-bold text-ink hover:text-primary">{cls.name}</h3>
                  </button>
                  {/* Action Menu (Three dots) */}
                  <div className="relative">
                    <button
                      onClick={() => setActiveMenuId(activeMenuId === cls.id ? null : cls.id)}
                      className="rounded-lg p-1 text-muted transition-colors hover:bg-primary-50 hover:text-ink"
                      aria-label="Actions"
                    >
                      <MoreVertical className="h-5 w-5" />
                    </button>
                    {activeMenuId === cls.id && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setActiveMenuId(null)} />
                        <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
                          <button
                            onClick={() => openDetails(cls)}
                            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-ink hover:bg-primary-50"
                          >
                            <Eye className="h-4 w-4" /> Détails
                          </button>
                          <button
                            onClick={() => openEdit(cls)}
                            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-ink hover:bg-primary-50"
                          >
                            <Edit className="h-4 w-4" /> Modifier
                          </button>
                          <button
                            onClick={() => handleDelete(cls.id)}
                            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-danger hover:bg-danger/10"
                          >
                            <Trash2 className="h-4 w-4" /> Supprimer
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <p className="line-clamp-2 text-xs text-muted">{cls.description || "Aucune description"}</p>

                <div className="grid grid-cols-3 gap-2">
                  <MiniStat icon={<Users className="h-3.5 w-3.5" />} label="Élèves" value={studentCount} />
                  <MiniStat
                    icon={<CalendarDays className="h-3.5 w-3.5" />}
                    label="Emplois"
                    value={summary?.sessionIds.length ?? 0}
                  />
                  <MiniStat
                    icon={<Wallet className="h-3.5 w-3.5" />}
                    label="Dettes"
                    value={`${summary?.totalDebt ?? 0} DA`}
                    danger={(summary?.totalDebt ?? 0) > 0}
                  />
                </div>

                {debtors > 0 && (
                  <button
                    type="button"
                    onClick={() => openDetails(cls)}
                    className="flex items-center justify-between gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-start transition-colors hover:bg-danger/15"
                  >
                    <span className="flex items-center gap-1.5 text-[11px] font-bold text-danger">
                      <AlertTriangle className="h-3.5 w-3.5 animate-pulse" />
                      {debtors} élève(s) en dette
                    </span>
                    <span className="text-[10px] font-semibold text-danger underline">Voir</span>
                  </button>
                )}

                <div className="mt-auto pt-1">
                  <Button className="w-full" onClick={() => openDetails(cls)}>
                    <Eye className="h-4 w-4" /> Voir les détails
                  </Button>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {visibleClasses.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line py-14 text-center">
          <p className="text-sm text-muted">
            {classes.length === 0
              ? "Aucune classe. Créez la première avec « Nouvelle Classe »."
              : "Aucune classe pour ces filtres."}
          </p>
        </div>
      )}

      {/* Fiche d'une classe : emplois du temps, élèves, dettes, paiements */}
      <ClassDetailsModal
        classId={detailsClassId}
        onClose={() => setDetailsClassId(null)}
        onEdit={(cls) => {
          setDetailsClassId(null);
          openEdit(cls);
        }}
      />

      {/* Creation Modal */}
      <Modal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Créer une nouvelle classe">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Type de classe</label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={type === "cours" ? "primary" : "outline"}
                onClick={() => setType("cours")}
                className="w-full text-center"
              >
                Cours (Soutien scolaire)
              </Button>
              <Button
                variant={type === "formation" ? "primary" : "outline"}
                onClick={() => setType("formation")}
                className="w-full text-center"
              >
                Formation (Langues, Pro)
              </Button>
            </div>
          </div>

          {type === "cours" ? (
            <>
              <div>
                <label className="mb-1 block font-sans text-xs font-semibold text-muted">Niveau scolaire</label>
                <Select
                  value={coursLevel}
                  onChange={(e) => {
                    setCoursLevel(e.target.value as CoursLevel);
                    setYear("1er");
                  }}
                  className="w-full"
                >
                  <option value="primaire">Primaire</option>
                  <option value="moyen">Moyen (Sem)</option>
                  <option value="lycee">Lycée</option>
                </Select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Année</label>
                <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-full">
                  {getYearOptions().map((opt) => (
                    <option key={opt} value={opt}>
                      {opt} Année
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-xs font-semibold text-muted">Filière</label>
                  <button
                    onClick={() => setShowAddFiliere(!showAddFiliere)}
                    className="text-xs text-primary hover:underline"
                  >
                    {showAddFiliere ? "Choisir existante" : "+ Nouvelle filière"}
                  </button>
                </div>
                {showAddFiliere ? (
                  <div className="flex gap-2">
                    <Input
                      value={newFiliereName}
                      onChange={(e) => setNewFiliereName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCreateFiliere()}
                      placeholder="Nom de la filière"
                      className="flex-1"
                    />
                    <Button size="sm" onClick={handleCreateFiliere}>
                      Créer
                    </Button>
                  </div>
                ) : (
                  <Select value={filiereId} onChange={(e) => setFiliereId(e.target.value)} className="w-full">
                    <option value="">Sélectionner une filière</option>
                    {filieres.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Nom de la classe</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Anglais débutants A1" />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-xs font-semibold text-muted">Niveau de formation</label>
                  <button onClick={() => setShowAddLevel(!showAddLevel)} className="text-xs text-primary hover:underline">
                    + Nouveau niveau
                  </button>
                </div>
                {showAddLevel ? (
                  <div className="flex gap-2">
                    <Input
                      value={newLevelName}
                      onChange={(e) => setNewLevelName(e.target.value)}
                      placeholder="Nom du niveau (ex: C2)"
                      className="flex-1"
                    />
                    <Button size="sm" onClick={handleCreateLevel}>
                      Créer
                    </Button>
                  </div>
                ) : (
                  <Select
                    value={formationLevel}
                    onChange={(e) => setFormationLevel(e.target.value as FormationLevel)}
                    className="w-full"
                  >
                    {formationLevelsList.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        Niveau {lvl}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            </>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description ou détails additionnels..."
              rows={3}
              className="w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink outline-none transition-colors focus:border-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreateClass}>Créer</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Modifier la classe">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Type de classe</label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={type === "cours" ? "primary" : "outline"}
                onClick={() => setType("cours")}
                className="w-full text-center"
              >
                Cours (Soutien scolaire)
              </Button>
              <Button
                variant={type === "formation" ? "primary" : "outline"}
                onClick={() => setType("formation")}
                className="w-full text-center"
              >
                Formation (Langues, Pro)
              </Button>
            </div>
          </div>

          {type === "cours" ? (
            <>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Niveau scolaire</label>
                <Select
                  value={coursLevel}
                  onChange={(e) => {
                    setCoursLevel(e.target.value as CoursLevel);
                    setYear("1er");
                  }}
                  className="w-full"
                >
                  <option value="primaire">Primaire</option>
                  <option value="moyen">Moyen (Sem)</option>
                  <option value="lycee">Lycée</option>
                </Select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Année</label>
                <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-full">
                  {getYearOptions().map((opt) => (
                    <option key={opt} value={opt}>
                      {opt} Année
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-xs font-semibold text-muted">Filière</label>
                  <button
                    onClick={() => setShowAddFiliere(!showAddFiliere)}
                    className="text-xs text-primary hover:underline"
                  >
                    {showAddFiliere ? "Choisir existante" : "+ Nouvelle filière"}
                  </button>
                </div>
                {showAddFiliere ? (
                  <div className="flex gap-2">
                    <Input
                      value={newFiliereName}
                      onChange={(e) => setNewFiliereName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCreateFiliere()}
                      placeholder="Nom de la filière"
                      className="flex-1"
                    />
                    <Button size="sm" onClick={handleCreateFiliere}>
                      Créer
                    </Button>
                  </div>
                ) : (
                  <Select value={filiereId} onChange={(e) => setFiliereId(e.target.value)} className="w-full">
                    <option value="">Sélectionner une filière</option>
                    {filieres.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Nom de la classe</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Anglais débutants A1" />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Niveau de formation</label>
                <Select
                  value={formationLevel}
                  onChange={(e) => setFormationLevel(e.target.value as FormationLevel)}
                  className="w-full"
                >
                  {formationLevelsList.map((lvl) => (
                    <option key={lvl} value={lvl}>
                      Niveau {lvl}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description ou détails additionnels..."
              rows={3}
              className="w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink outline-none transition-colors focus:border-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleEditClass}>Enregistrer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

const SUMMARY_TONES = {
  primary: "bg-gradient-primary",
  success: "bg-gradient-success",
  warning: "bg-gradient-warning",
  danger: "bg-gradient-danger",
} as const;

function SummaryTile({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: string;
  tone: keyof typeof SUMMARY_TONES;
}) {
  return (
    <div className={`${SUMMARY_TONES[tone]} relative overflow-hidden rounded-2xl p-4 text-white card-shadow`}>
      <span className="absolute -end-2 -top-2 text-5xl opacity-20">{icon}</span>
      <p className="text-[11px] font-bold uppercase tracking-wide text-white/85">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  danger?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-2 ${danger ? "border-danger/30 bg-danger/5" : "border-line bg-canvas/40"}`}>
      <span
        className={`flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide ${danger ? "text-danger" : "text-muted"}`}
      >
        {icon} {label}
      </span>
      <strong className={`mt-0.5 block truncate text-sm font-black ${danger ? "text-danger" : "text-ink"}`}>
        {value}
      </strong>
    </div>
  );
}
