"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/store/data";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  BookOpen,
  Calendar,
  Clock,
  Filter,
  LayoutGrid,
  MapPin,
  Phone,
  Search,
  Table as TableIcon,
  User,
  Users,
  X,
} from "lucide-react";
import type { CoursLevel, Day, ScheduleSession, SchoolClass } from "@/lib/types";
import { DAYS } from "@/lib/types";
import {
  COURS_LEVELS,
  COURS_LEVEL_LABELS,
  DAY_LABELS_FR,
  YEAR_ORDER,
  classCascadeLabel,
  formatDateFr,
  formatDays,
  matchesAllWords,
} from "@/lib/helpers";

/** Short weekday headers — the board has seven columns, full names never fit. */
const DAY_SHORT: Record<Day, string> = {
  saturday: "Sam",
  sunday: "Dim",
  monday: "Lun",
  tuesday: "Mar",
  wednesday: "Mer",
  thursday: "Jeu",
  friday: "Ven",
};

/** One row of the board: every timing sharing the exact same hours. */
interface TimeRow {
  key: string;
  startTime: string;
  endTime: string;
  /** minutes, used by the weekly-volume figures */
  minutes: number;
  byDay: Record<Day, ScheduleSession[]>;
}

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const diff = (eh * 60 + em) - (sh * 60 + sm);
  return diff > 0 ? diff : 0;
}

/**
 * « Emplois de Temps » — read-only board of every timing the school runs.
 *
 * The filters are the ones reception already knows from « Ajouter un étudiant »:
 * a direct search ("lycee 2eme sciences") short-circuiting the same niveau →
 * année → filière cascade, then the classe and the module of that combination.
 * The board itself is a real timetable: one row per horaire, one column per
 * day of the week, and every cell is clickable — it opens the full file of the
 * timing (module, classe, groupe, salle, jours, tarif, élèves) and of the
 * enseignant who teaches it.
 *
 * Creating / editing timings stays on the Planner screen: this page never
 * writes anything.
 */
export function TimetablesPage() {
  const {
    sessions,
    classes,
    modules,
    groups,
    salles,
    teachers,
    students,
    subscriptions,
    filieres,
  } = useData();

  // ---- Filters (mirroring the « Ajouter un étudiant » cascade) -------------
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<"" | CoursLevel | "formation">("");
  const [year, setYear] = useState("");
  const [filiereId, setFiliereId] = useState("");
  const [classId, setClassId] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [kind, setKind] = useState<"all" | "cours" | "open">("all");
  const [viewMode, setViewMode] = useState<"board" | "cards">("board");

  const [selected, setSelected] = useState<ScheduleSession | null>(null);

  // ---- Labels --------------------------------------------------------------

  const filiereLabelOf = (id?: string) =>
    id ? filieres.find((f) => f.id === id)?.name ?? "Filière inconnue" : "Sans filière";
  const moduleName = (id: string) => modules.find((m) => m.id === id)?.name ?? "—";
  const groupName = (id?: string) => groups.find((g) => g.id === id)?.name ?? "—";
  const salleName = (id?: string) => salles.find((s) => s.id === id)?.name ?? "—";
  const teacherOf = (id: string) => teachers.find((t) => t.id === id);
  const teacherName = (id: string) => {
    const t = teacherOf(id);
    return t ? `${t.firstName} ${t.lastName}` : "—";
  };
  const classLabelOf = (id?: string) => {
    const c = classes.find((x) => x.id === id);
    if (!c) return "—";
    const lvl = c.type === "cours" ? c.coursLevel : c.formationLevel;
    return lvl ? `${c.name} (${lvl})` : c.name;
  };
  const classFullLabel = (cls: SchoolClass) =>
    classCascadeLabel(cls, cls.filiereId ? filiereLabelOf(cls.filiereId) : "");

  /** A séance libre covers every classe / groupe / salle of its selection. */
  const sessionClassIds = (s: ScheduleSession) =>
    s.isOpen && s.classIds?.length ? s.classIds : [s.classId];
  const sessionCoversClass = (s: ScheduleSession, cid: string) => sessionClassIds(s).includes(cid);

  const sessionTitle = (s: ScheduleSession) =>
    s.isOpen ? s.title || `Séance Libre — ${moduleName(s.moduleId)}` : moduleName(s.moduleId);

  const sessionClassesLabel = (s: ScheduleSession) =>
    sessionClassIds(s).map(classLabelOf).join(" · ");
  const sessionGroupsLabel = (s: ScheduleSession) =>
    (s.isOpen && s.groupIds?.length ? s.groupIds : [s.groupId]).map(groupName).join(" · ");
  const sessionSallesLabel = (s: ScheduleSession) =>
    (s.isOpen && s.salleIds?.length ? s.salleIds : [s.salleId]).map(salleName).join(" · ");

  const sessionPrice = (s: ScheduleSession) => {
    const sub = subscriptions.find((su) => su.sessionId === s.id);
    if (sub) return sub.levelPrice ? sub.levelPrice : sub.pricePerSession;
    return s.openPrice ?? 0;
  };
  const sessionPriceLabel = (s: ScheduleSession) => {
    const sub = subscriptions.find((su) => su.sessionId === s.id);
    if (sub?.levelPrice) return `${sub.levelPrice} DA / ${sub.periodMonths ?? 0} mois`;
    return `${sessionPrice(s)} DA / séance`;
  };

  /** Students enrolled on a timing, through any of its subscriptions. */
  const enrolledOn = (sessionId: string) => {
    const subIds = subscriptions.filter((su) => su.sessionId === sessionId).map((su) => su.id);
    if (subIds.length === 0) return [];
    return students.filter((st) => st.subscriptionIds.some((id) => subIds.includes(id)));
  };

  // ---- Cascade: niveau → année → filière → classe → module -----------------

  const timingCountOf = (cid: string) => sessions.filter((s) => sessionCoversClass(s, cid)).length;
  const timingCountFor = (list: SchoolClass[]) =>
    list.reduce((sum, cls) => sum + timingCountOf(cls.id), 0);

  const levelClasses = () =>
    level === "formation"
      ? classes.filter((c) => c.type === "formation")
      : classes.filter((c) => c.type === "cours" && c.coursLevel === level);

  const levelOptions = () => {
    const options = COURS_LEVELS.map((lvl) => ({
      value: lvl as "" | CoursLevel | "formation",
      label: COURS_LEVEL_LABELS[lvl],
      classes: classes.filter((c) => c.type === "cours" && c.coursLevel === lvl),
    }));
    const formations = classes.filter((c) => c.type === "formation");
    if (formations.length > 0) {
      options.push({ value: "formation", label: "Formations", classes: formations });
    }
    return options
      .filter((o) => o.classes.length > 0)
      .map((o) => ({ value: o.value, label: o.label, count: timingCountFor(o.classes) }));
  };

  const yearOptions = () => {
    const byKey = new Map<string, SchoolClass[]>();
    for (const cls of levelClasses()) {
      const key = (level === "formation" ? cls.formationLevel : cls.year) ?? "";
      if (!key) continue;
      byKey.set(key, [...(byKey.get(key) ?? []), cls]);
    }
    return [...byKey.entries()]
      .map(([value, list]) => ({
        value,
        label: level === "formation" ? `Niveau ${value}` : `${value} Année`,
        count: timingCountFor(list),
      }))
      .sort((a, b) => {
        const ia = YEAR_ORDER.indexOf(a.value);
        const ib = YEAR_ORDER.indexOf(b.value);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        return a.value.localeCompare(b.value);
      });
  };

  const filiereOptions = () => {
    const byKey = new Map<string, SchoolClass[]>();
    for (const cls of levelClasses()) {
      if ((cls.year ?? "") !== year) continue;
      const key = cls.filiereId || "none";
      byKey.set(key, [...(byKey.get(key) ?? []), cls]);
    }
    return [...byKey.entries()]
      .map(([value, list]) => ({
        value,
        label: value === "none" ? "Sans filière" : filiereLabelOf(value),
        count: timingCountFor(list),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  };

  /**
   * The classes the board must show: the ones matching the direct search when
   * it carries text, otherwise the ones matching the cascade. Nothing picked at
   * all means "the whole school" — this screen exists to show everything first.
   */
  const matchedClasses = (): SchoolClass[] | null => {
    const query = search.trim();
    if (query) {
      return classes.filter((cls) =>
        matchesAllWords(`${classFullLabel(cls)} ${cls.name} ${cls.description ?? ""}`, query),
      );
    }
    if (!level) return null;
    const list = levelClasses();
    if (!year) return list;
    if (level === "formation") return list.filter((c) => (c.formationLevel ?? "") === year);
    const ofYear = list.filter((c) => (c.year ?? "") === year);
    if (!filiereId) return ofYear;
    return ofYear.filter((c) =>
      filiereId === "none" ? !c.filiereId : c.filiereId === filiereId,
    );
  };

  const matched = matchedClasses();

  /** Classes offered by step 4 — only those the cascade/search already kept. */
  const classOptions = () =>
    (matched ?? classes)
      .map((c) => ({ value: c.id, label: classFullLabel(c) || c.name, count: timingCountOf(c.id) }))
      .filter((o) => o.count > 0)
      .sort((a, b) => a.label.localeCompare(b.label));

  /** Modules taught on the classes kept so far — step 5. */
  const moduleOptions = () => {
    const pool = matched
      ? sessions.filter((s) => matched.some((c) => sessionCoversClass(s, c.id)))
      : sessions;
    const scoped = classId ? pool.filter((s) => sessionCoversClass(s, classId)) : pool;
    const byId = new Map<string, number>();
    scoped.forEach((s) => byId.set(s.moduleId, (byId.get(s.moduleId) ?? 0) + 1));
    return [...byId.entries()]
      .map(([value, count]) => ({ value, label: moduleName(value), count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  };

  // ---- The filtered timings -----------------------------------------------

  const filtered = useMemo(() => {
    const list = matched;
    return sessions
      .filter((s) => {
        if (kind === "cours" && s.isOpen) return false;
        if (kind === "open" && !s.isOpen) return false;
        if (list && !list.some((c) => sessionCoversClass(s, c.id))) return false;
        if (classId && !sessionCoversClass(s, classId)) return false;
        if (moduleId && s.moduleId !== moduleId) return false;
        return true;
      })
      .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, classes, search, level, year, filiereId, classId, moduleId, kind]);

  /** One row per distinct horaire, chronological — the board's backbone. */
  const rows = useMemo<TimeRow[]>(() => {
    const byRange = new Map<string, TimeRow>();
    filtered.forEach((s) => {
      const key = `${s.startTime}-${s.endTime}`;
      let row = byRange.get(key);
      if (!row) {
        row = {
          key,
          startTime: s.startTime,
          endTime: s.endTime,
          minutes: minutesBetween(s.startTime, s.endTime),
          byDay: {
            saturday: [], sunday: [], monday: [], tuesday: [],
            wednesday: [], thursday: [], friday: [],
          },
        };
        byRange.set(key, row);
      }
      s.days.forEach((d) => row!.byDay[d].push(s));
    });
    return [...byRange.values()].sort(
      (a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime),
    );
  }, [filtered]);

  /** Days that actually carry a timing — an empty day column is still drawn,
   *  the school reads its week as a whole, but the counter tells the truth. */
  const countForDay = (day: Day) => filtered.filter((s) => s.days.includes(day)).length;

  /** Weekly volume: a timing counts once per day it is held on. */
  const weeklyMinutes = filtered.reduce(
    (sum, s) => sum + minutesBetween(s.startTime, s.endTime) * s.days.length,
    0,
  );
  const weeklyHours = Math.round((weeklyMinutes / 60) * 10) / 10;
  const distinctTeachers = new Set(filtered.map((s) => s.teacherId)).size;
  const distinctSalles = new Set(filtered.flatMap((s) => sessionSallesLabel(s).split(" · "))).size;

  const hasFilters =
    !!search || !!level || !!year || !!filiereId || !!classId || !!moduleId || kind !== "all";

  const clearFilters = () => {
    setSearch("");
    setLevel("");
    setYear("");
    setFiliereId("");
    setClassId("");
    setModuleId("");
    setKind("all");
  };

  /** Going back up the cascade clears every step below it. */
  const pickLevel = (value: "" | CoursLevel | "formation") => {
    setLevel(value);
    setYear("");
    setFiliereId("");
    setClassId("");
    setModuleId("");
  };
  const pickYear = (value: string) => {
    setYear(value);
    setFiliereId("");
    setClassId("");
    setModuleId("");
  };
  const pickFiliere = (value: string) => {
    setFiliereId(value);
    setClassId("");
    setModuleId("");
  };

  /** Consistent color per module, so the same matière reads the same all week. */
  const moduleColor = (mid: string) => {
    let hash = 0;
    for (let i = 0; i < mid.length; i++) hash = mid.charCodeAt(i) + ((hash << 5) - hash);
    const palette = [
      "border-l-blue-500 bg-blue-50/70 text-blue-900 dark:bg-blue-950/25 dark:text-blue-200",
      "border-l-emerald-500 bg-emerald-50/70 text-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-200",
      "border-l-amber-500 bg-amber-50/70 text-amber-900 dark:bg-amber-950/25 dark:text-amber-200",
      "border-l-rose-500 bg-rose-50/70 text-rose-900 dark:bg-rose-950/25 dark:text-rose-200",
      "border-l-purple-500 bg-purple-50/70 text-purple-900 dark:bg-purple-950/25 dark:text-purple-200",
      "border-l-cyan-500 bg-cyan-50/70 text-cyan-900 dark:bg-cyan-950/25 dark:text-cyan-200",
      "border-l-indigo-500 bg-indigo-50/70 text-indigo-900 dark:bg-indigo-950/25 dark:text-indigo-200",
    ];
    return palette[Math.abs(hash) % palette.length];
  };

  const stepButton = (active: boolean) =>
    `rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors ${
      active ? "border-primary bg-primary text-white" : "border-line bg-surface text-ink hover:bg-primary-50"
    }`;

  return (
    <div className="space-y-6">
      <PageHeader
        emoji="🗓️"
        title="Emplois de Temps"
        subtitle="Tous les créneaux de la semaine — filtrés par classe, année, filière et module"
      />

      {/* ------------------------------------------------------------------ */}
      {/* Filters — same cascade as the « Ajouter un étudiant » screen        */}
      {/* ------------------------------------------------------------------ */}
      <Card className="border border-line">
        <CardBody className="p-4 space-y-3.5">
          <div className="flex items-center justify-between border-b border-line pb-2.5">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink">
              <Filter className="h-4 w-4 text-primary" /> Rechercher & Filtrer
            </span>
            <div className="flex items-center gap-2">
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 text-[10px] font-bold text-primary hover:underline"
                >
                  <X className="h-3 w-3" /> Réinitialiser
                </button>
              )}
              <div className="flex gap-1 rounded-xl border border-line bg-canvas p-1">
                <button
                  onClick={() => setViewMode("board")}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold transition-all ${
                    viewMode === "board" ? "bg-primary text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  <TableIcon className="h-3 w-3" /> Tableau
                </button>
                <button
                  onClick={() => setViewMode("cards")}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold transition-all ${
                    viewMode === "cards" ? "bg-primary text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  <LayoutGrid className="h-3 w-3" /> Cartes
                </button>
              </div>
            </div>
          </div>

          {/* Direct search — "lycee 2eme sciences" lands on the same créneaux
              as walking the four steps below, in any word order. */}
          <div>
            <label className="mb-1 block font-sans text-[10px] font-bold uppercase text-muted">
              Recherche directe : niveau + année + filière
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ex: lycee 2eme sciences"
                className="pl-9 pr-20"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-primary hover:underline"
                >
                  Effacer
                </button>
              )}
            </div>
          </div>

          {/* Type of timing */}
          <div className="flex flex-wrap gap-1.5">
            {([
              { key: "all", label: `Tous (${sessions.length})` },
              { key: "cours", label: `Cours (${sessions.filter((s) => !s.isOpen).length})` },
              { key: "open", label: `Séances libres (${sessions.filter((s) => s.isOpen).length})` },
            ] as const).map((k) => (
              <button
                key={k.key}
                onClick={() => setKind(k.key)}
                className={`rounded-lg px-3 py-1.5 text-[10px] font-bold transition-all ${
                  kind === k.key ? "bg-primary text-white shadow-sm" : "bg-canvas text-muted hover:text-ink"
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>

          {/* Steps 1 → 5, hidden while the search box drives the list itself */}
          {!search.trim() && (
            <div className="space-y-2.5">
              <div>
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                  1. Niveau scolaire
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {levelOptions().length === 0 ? (
                    <p className="text-xs italic text-muted">Aucune classe enregistrée dans l&apos;école.</p>
                  ) : (
                    levelOptions().map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => pickLevel(level === opt.value ? "" : opt.value)}
                        className={stepButton(level === opt.value)}
                      >
                        {opt.label}
                        <span className={level === opt.value ? "ms-1.5 text-white/75" : "ms-1.5 text-muted"}>
                          {opt.count} créneau{opt.count > 1 ? "x" : ""}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {level && (
                <div>
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                    2. {level === "formation" ? "Niveau de formation" : "Année"}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {yearOptions().length === 0 ? (
                      <p className="text-xs italic text-muted">Aucune classe pour ce niveau.</p>
                    ) : (
                      yearOptions().map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => pickYear(year === opt.value ? "" : opt.value)}
                          className={stepButton(year === opt.value)}
                        >
                          {opt.label}
                          <span className={year === opt.value ? "ms-1.5 text-white/75" : "ms-1.5 text-muted"}>
                            {opt.count} créneau{opt.count > 1 ? "x" : ""}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Formations carry no filière — their level is the last step. */}
              {level && level !== "formation" && year && (
                <div>
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                    3. Filière
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {filiereOptions().length === 0 ? (
                      <p className="text-xs italic text-muted">Aucune classe pour cette année.</p>
                    ) : (
                      filiereOptions().map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => pickFiliere(filiereId === opt.value ? "" : opt.value)}
                          className={stepButton(filiereId === opt.value)}
                        >
                          {opt.label}
                          <span className={filiereId === opt.value ? "ms-1.5 text-white/75" : "ms-1.5 text-muted"}>
                            {opt.count} créneau{opt.count > 1 ? "x" : ""}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {classOptions().length > 1 && (
                <div>
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                    4. Classe
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {classOptions().map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setClassId(classId === opt.value ? "" : opt.value);
                          setModuleId("");
                        }}
                        className={stepButton(classId === opt.value)}
                      >
                        {opt.label}
                        <span className={classId === opt.value ? "ms-1.5 text-white/75" : "ms-1.5 text-muted"}>
                          {opt.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Module: always offered — it is the last axis reception filters on,
              search box or cascade alike. */}
          {moduleOptions().length > 0 && (
            <div>
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                {search.trim() ? "Module" : "5. Module"}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {moduleOptions().map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setModuleId(moduleId === opt.value ? "" : opt.value)}
                    className={stepButton(moduleId === opt.value)}
                  >
                    {opt.label}
                    <span className={moduleId === opt.value ? "ms-1.5 text-white/75" : "ms-1.5 text-muted"}>
                      {opt.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* What the current filters lead to */}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2.5 text-[11px]">
            <Badge tone="primary" className="font-bold">{filtered.length} créneau(x)</Badge>
            <Badge tone="neutral" className="font-bold">{rows.length} horaire(s) distinct(s)</Badge>
            <Badge tone="success" className="font-bold">{weeklyHours} h / semaine</Badge>
            <Badge tone="neutral" className="font-bold">{distinctTeachers} enseignant(s)</Badge>
            <Badge tone="neutral" className="font-bold">{distinctSalles} salle(s)</Badge>
            {matched && (
              <span className="text-[10px] text-muted">
                {matched.length === 0
                  ? "Aucune classe ne correspond"
                  : `Classes : ${matched.slice(0, 3).map((c) => classFullLabel(c) || c.name).join(" / ")}${
                      matched.length > 3 ? ` +${matched.length - 3}` : ""
                    }`}
              </span>
            )}
          </div>
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* The week — one row per horaire, one column per day                  */}
      {/* ------------------------------------------------------------------ */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-canvas/30 p-12 text-center text-xs text-muted">
          Aucun créneau ne correspond aux filtres actuels. Les emplois du temps se créent depuis
          l&apos;écran <strong className="text-ink">Planner</strong>.
        </div>
      ) : viewMode === "board" ? (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-line bg-canvas text-[10px] font-bold uppercase tracking-wider text-muted">
                  <th className="w-28 p-3">Horaire</th>
                  {DAYS.map((day) => (
                    <th key={day} className="p-3 text-center">
                      <span className="block text-ink">{DAY_LABELS_FR[day]}</span>
                      <span className="text-[9px] font-semibold normal-case text-muted">
                        {countForDay(day)} créneau(x)
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b border-line align-top last:border-0">
                    <td className="border-e border-line bg-canvas/40 p-3">
                      <span className="block font-mono text-[11px] font-bold text-ink">{row.startTime}</span>
                      <span className="block font-mono text-[10px] text-muted">{row.endTime}</span>
                      <span className="mt-1 block text-[9px] font-semibold uppercase text-muted">
                        {Math.floor(row.minutes / 60)}h{String(row.minutes % 60).padStart(2, "0")}
                      </span>
                    </td>
                    {DAYS.map((day) => {
                      const cell = row.byDay[day];
                      return (
                        <td key={day} className="p-1.5">
                          {cell.length === 0 ? (
                            <div className="flex h-full min-h-[52px] items-center justify-center text-[10px] italic text-muted/60">
                              —
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              {cell.map((s) => (
                                <button
                                  key={s.id}
                                  onClick={() => setSelected(s)}
                                  className={`w-full space-y-1 rounded-xl border border-line border-l-4 p-2 text-start transition-all hover:shadow-md hover:brightness-[0.98] ${moduleColor(
                                    s.moduleId,
                                  )}`}
                                >
                                  <strong className="block truncate text-[11px] font-black leading-tight">
                                    {s.isOpen && <span className="me-1">🎯</span>}
                                    {sessionTitle(s)}
                                  </strong>
                                  <span className="block truncate text-[9px] font-bold opacity-80">
                                    {s.isOpen ? `Séance libre · ${sessionPrice(s)} DA` : sessionClassesLabel(s)}
                                  </span>
                                  <span className="flex items-center gap-1 truncate text-[9px] opacity-90">
                                    <User className="h-2.5 w-2.5 shrink-0" />
                                    {teacherName(s.teacherId)}
                                  </span>
                                  <span className="flex items-center justify-between gap-1 text-[9px] opacity-90">
                                    <span className="flex items-center gap-1 truncate">
                                      <MapPin className="h-2.5 w-2.5 shrink-0" />
                                      {sessionSallesLabel(s)}
                                    </span>
                                    <span className="flex items-center gap-1 truncate">
                                      <Users className="h-2.5 w-2.5 shrink-0" />
                                      {sessionGroupsLabel(s)}
                                    </span>
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* CARDS VIEW — one card per timing, every detail on its face */
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => {
            const enrolled = enrolledOn(s.id);
            const teacher = teacherOf(s.teacherId);
            return (
              <Card key={s.id} className="border border-line transition-all hover:-translate-y-0.5 hover:shadow-lg">
                <CardBody className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <strong className="block truncate text-sm font-bold text-ink">
                        {s.isOpen && <span className="me-1">🎯</span>}
                        {sessionTitle(s)}
                      </strong>
                      <span className="block truncate text-[10px] text-muted">{sessionClassesLabel(s)}</span>
                    </div>
                    <Badge tone={s.isOpen ? "success" : "primary"} className="shrink-0 text-[9px]">
                      {s.isOpen ? "Séance libre" : "Cours"}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {DAYS.filter((d) => s.days.includes(d)).map((d) => (
                      <span
                        key={d}
                        className="rounded-md border border-primary/25 bg-primary-50 px-1.5 py-0.5 text-[9px] font-bold text-primary"
                      >
                        {DAY_SHORT[d]}
                      </span>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="rounded-xl border border-line/60 bg-canvas/30 p-2">
                      <span className="block uppercase text-muted">Horaire</span>
                      <strong className="block font-mono text-ink">{s.startTime} - {s.endTime}</strong>
                    </div>
                    <div className="rounded-xl border border-line/60 bg-canvas/30 p-2">
                      <span className="block uppercase text-muted">Tarif</span>
                      <strong className="block text-primary">{sessionPriceLabel(s)}</strong>
                    </div>
                    <div className="rounded-xl border border-line/60 bg-canvas/30 p-2">
                      <span className="block uppercase text-muted">Salle(s)</span>
                      <strong className="block truncate text-ink">{sessionSallesLabel(s)}</strong>
                    </div>
                    <div className="rounded-xl border border-line/60 bg-canvas/30 p-2">
                      <span className="block uppercase text-muted">Groupe(s)</span>
                      <strong className="block truncate text-ink">{sessionGroupsLabel(s)}</strong>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-line/60 pt-2.5 text-[10px]">
                    <span className="flex min-w-0 items-center gap-1.5 text-muted">
                      <User className="h-3 w-3 shrink-0" />
                      <span className="truncate">{teacher ? `${teacher.firstName} ${teacher.lastName}` : "—"}</span>
                      {teacher?.isPassager && (
                        <Badge tone="warning" className="px-1 py-0 text-[8px]">Passager</Badge>
                      )}
                    </span>
                    <Badge tone="neutral" className="text-[9px] font-bold">{enrolled.length} élève(s)</Badge>
                  </div>

                  <Button
                    variant="outline"
                    className="w-full text-xs"
                    onClick={() => setSelected(s)}
                  >
                    Voir les détails
                  </Button>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Details of one timing — everything about it and about its teacher   */}
      {/* ------------------------------------------------------------------ */}
      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title="Détails du créneau"
        wide
      >
        {selected && (() => {
          const s = selected;
          const teacher = teacherOf(s.teacherId);
          const enrolled = enrolledOn(s.id);
          const weekly = minutesBetween(s.startTime, s.endTime) * s.days.length;
          return (
            <div className="space-y-5 text-xs">
              {/* Headline */}
              <div className="rounded-2xl border border-line bg-primary-50/50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-ink">
                      {s.isOpen && <span className="me-1">🎯</span>}
                      {sessionTitle(s)}
                    </h3>
                    <span className="mt-0.5 block text-[11px] text-muted">
                      {moduleName(s.moduleId)} · {sessionClassesLabel(s)}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Badge tone={s.isOpen ? "success" : "primary"} className="font-bold">
                      {s.isOpen ? "Séance libre" : "Cours régulier"}
                    </Badge>
                    <Badge tone="neutral" className="font-mono font-bold">
                      {s.startTime} - {s.endTime}
                    </Badge>
                  </div>
                </div>

                {/* Days of the week this timing is held on */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
                  <span className="me-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                    Jours de la semaine :
                  </span>
                  {DAYS.map((d) => {
                    const on = s.days.includes(d);
                    return (
                      <span
                        key={d}
                        className={`rounded-lg border px-2 py-1 text-[10px] font-bold ${
                          on
                            ? "border-primary bg-primary text-white"
                            : "border-line bg-surface text-muted/60 line-through"
                        }`}
                      >
                        {DAY_LABELS_FR[d]}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Four figures */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-line bg-canvas p-3 text-center">
                  <span className="block text-[10px] font-semibold uppercase text-muted">Séances / semaine</span>
                  <strong className="font-mono text-base text-ink">{s.days.length}</strong>
                </div>
                <div className="rounded-xl border border-line bg-canvas p-3 text-center">
                  <span className="block text-[10px] font-semibold uppercase text-muted">Volume hebdo.</span>
                  <strong className="font-mono text-base text-primary">
                    {Math.floor(weekly / 60)}h{String(weekly % 60).padStart(2, "0")}
                  </strong>
                </div>
                <div className="rounded-xl border border-line bg-canvas p-3 text-center">
                  <span className="block text-[10px] font-semibold uppercase text-muted">Élèves inscrits</span>
                  <strong className="font-mono text-base text-ink">{enrolled.length}</strong>
                </div>
                <div className="rounded-xl border border-line bg-canvas p-3 text-center">
                  <span className="block text-[10px] font-semibold uppercase text-muted">Tarif</span>
                  <strong className="font-mono text-base text-success">{sessionPrice(s)} DA</strong>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* The timing itself */}
                <div className="space-y-2 rounded-2xl border border-line bg-surface p-4">
                  <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                    <BookOpen className="h-3.5 w-3.5 text-primary" /> Le créneau
                  </h4>
                  {[
                    ["Module / Matière", moduleName(s.moduleId)],
                    ["Classe(s) / Niveau", sessionClassesLabel(s)],
                    ["Groupe(s)", sessionGroupsLabel(s)],
                    ["Salle(s)", sessionSallesLabel(s)],
                    ["Jours", formatDays(s.days) || "—"],
                    ["Horaire", `${s.startTime} - ${s.endTime}`],
                    ["Tarif", sessionPriceLabel(s)],
                    [
                      "Période",
                      s.periodStart || s.periodEnd
                        ? `${formatDateFr(s.periodStart)} → ${formatDateFr(s.periodEnd)}`
                        : "",
                    ],
                  ].map(([label, value]) =>
                    value ? (
                      <div
                        key={label}
                        className="flex justify-between gap-3 border-b border-line/50 pb-1.5 last:border-0"
                      >
                        <span className="shrink-0 text-muted">{label} :</span>
                        <strong className="text-end text-ink">{value}</strong>
                      </div>
                    ) : null,
                  )}
                </div>

                {/* The teacher */}
                <div className="space-y-2 rounded-2xl border border-line bg-surface p-4">
                  <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                    <User className="h-3.5 w-3.5 text-primary" /> L&apos;enseignant
                  </h4>
                  {!teacher ? (
                    <p className="py-6 text-center text-xs italic text-muted">
                      Aucun enseignant affecté à ce créneau.
                    </p>
                  ) : (
                    <>
                      <div className="mb-2 flex items-center gap-3 border-b border-line pb-2.5">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-xs font-bold text-primary">
                          {teacher.firstName.charAt(0).toUpperCase()}
                          {teacher.lastName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <strong className="block truncate text-sm text-ink">
                            {teacher.firstName} {teacher.lastName}
                          </strong>
                          <span className="block text-[10px] text-muted">
                            {teacher.isPassager
                              ? "Enseignant passager — réglé à la séance"
                              : teacher.paymentType === "monthly"
                                ? `Salaire fixe : ${teacher.monthlyAmount ?? 0} DA / mois`
                                : `Rémunération : ${teacher.percentage ?? 0}% par séance`}
                          </span>
                        </div>
                      </div>
                      {[
                        ["Téléphone", teacher.phone],
                        ["E-mail", teacher.email],
                        ["Depuis le", teacher.startDate ? formatDateFr(teacher.startDate) : ""],
                      ].map(([label, value]) =>
                        value ? (
                          <div
                            key={label}
                            className="flex justify-between gap-3 border-b border-line/50 pb-1.5 last:border-0"
                          >
                            <span className="shrink-0 text-muted">{label} :</span>
                            <strong className="truncate text-end text-ink">{value}</strong>
                          </div>
                        ) : null,
                      )}
                      <div className="flex justify-between gap-3 border-b border-line/50 pb-1.5">
                        <span className="text-muted">Autres créneaux :</span>
                        <strong className="text-ink">
                          {sessions.filter((x) => x.teacherId === teacher.id && x.id !== s.id).length}
                        </strong>
                      </div>
                      {teacher.phone && (
                        <a
                          href={`tel:${teacher.phone}`}
                          className="mt-1 flex items-center justify-center gap-1.5 rounded-xl border border-line bg-canvas px-3 py-2 text-[11px] font-bold text-ink transition-colors hover:bg-primary-50"
                        >
                          <Phone className="h-3.5 w-3.5" /> Appeler l&apos;enseignant
                        </a>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Every day of the week, spelled out with its hours */}
              <div className="rounded-2xl border border-line bg-surface p-4">
                <h4 className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                  <Calendar className="h-3.5 w-3.5 text-primary" /> Répartition de la semaine
                </h4>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                  {DAYS.map((d) => {
                    const on = s.days.includes(d);
                    return (
                      <div
                        key={d}
                        className={`rounded-xl border p-2.5 text-center ${
                          on ? "border-primary/30 bg-primary-50/60" : "border-line bg-canvas/30"
                        }`}
                      >
                        <span className={`block text-[10px] font-bold ${on ? "text-primary" : "text-muted"}`}>
                          {DAY_LABELS_FR[d]}
                        </span>
                        <span
                          className={`mt-0.5 block font-mono text-[10px] ${on ? "text-ink" : "text-muted/60"}`}
                        >
                          {on ? `${s.startTime} - ${s.endTime}` : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Students following this timing */}
              <div className="rounded-2xl border border-line bg-surface p-4">
                <h4 className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                  <Users className="h-3.5 w-3.5 text-primary" /> Élèves inscrits ({enrolled.length})
                </h4>
                {enrolled.length === 0 ? (
                  <p className="py-4 text-center text-xs italic text-muted">
                    Aucun élève inscrit sur ce créneau pour le moment.
                  </p>
                ) : (
                  <div className="max-h-48 space-y-1 overflow-y-auto pe-1">
                    {enrolled.map((st) => (
                      <div
                        key={st.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-line/60 bg-canvas/30 px-3 py-2"
                      >
                        <span className="truncate font-semibold text-ink">
                          {st.firstName} {st.lastName}
                        </span>
                        <span className="flex shrink-0 items-center gap-2 font-mono text-[10px] text-muted">
                          🎫 {st.rfid || "sans carte"}
                          <Badge tone={st.balance < 0 ? "danger" : "success"} className="text-[9px]">
                            {st.balance} DA
                          </Badge>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-line pt-3">
                <span className="flex items-center gap-1.5 text-[10px] text-muted">
                  <Clock className="h-3 w-3" /> Les emplois du temps se modifient depuis l&apos;écran Planner.
                </span>
                <Button onClick={() => setSelected(null)}>Fermer</Button>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
