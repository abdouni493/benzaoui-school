"use client";

import { useMemo } from "react";
import { useData } from "@/lib/store/data";
import { Clock, MapPin, User, Users } from "lucide-react";
import type { Day, ScheduleSession, SchoolClass } from "@/lib/types";
import { DAYS } from "@/lib/types";
import { classCascadeLabel } from "@/lib/helpers";

/** Short weekday chips — full names never fit inside a séance card. */
const DAY_SHORT: Record<Day, string> = {
  saturday: "Sam",
  sunday: "Dim",
  monday: "Lun",
  tuesday: "Mar",
  wednesday: "Mer",
  thursday: "Jeu",
  friday: "Ven",
};

/** Consistent color per matière, so the same module reads the same everywhere.
 *  Used in "admin" mode (no per-student highlight). */
function moduleColor(mid: string): string {
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
}

/** Student mode: the séances of the student's own classe + filière + groupe. */
const OWN_STYLE =
  "border-l-primary bg-primary-50 text-ink ring-1 ring-primary/40 dark:bg-primary-950/30 dark:text-primary-100";
/** Student mode: every other séance of the same niveau + année. */
const OTHER_STYLE =
  "border-l-line bg-canvas/40 text-muted dark:bg-canvas/20";

export interface MatiereTimetableProps {
  /** The séances to display — already filtered by the caller. */
  sessions: ScheduleSession[];
  /** Opens the details of a séance. */
  onSelect: (s: ScheduleSession) => void;
  /**
   * Student mode: returns true for the séances that are the student's own
   * (classe + filière + groupe). Those are painted in a distinct color while the
   * others stay muted. Omit it entirely for the admin board, where every matière
   * gets its own stable color instead.
   */
  isHighlighted?: (s: ScheduleSession) => boolean;
  emptyLabel?: string;
}

/**
 * The « Emplois de Temps » board, one row per **matière**: the first column
 * carries the module name, the second lists every available séance of that
 * matière as a clickable card showing its horaire, enseignant, classe / année /
 * filière, groupe and salle. The same component drives the admin Timetables
 * screen and the student portal (there with the student's own créneaux
 * highlighted), so both read identically.
 */
export function MatiereTimetable({
  sessions,
  onSelect,
  isHighlighted,
  emptyLabel = "Aucun créneau ne correspond aux filtres actuels.",
}: MatiereTimetableProps) {
  const { modules, groups, salles, teachers, classes, filieres } = useData();

  const filiereLabelOf = (id?: string) =>
    id ? filieres.find((f) => f.id === id)?.name ?? "" : "";
  const moduleName = (id: string) => modules.find((m) => m.id === id)?.name ?? "Matière";
  const groupName = (id?: string) => groups.find((g) => g.id === id)?.name ?? "—";
  const salleName = (id?: string) => salles.find((s) => s.id === id)?.name ?? "—";
  const teacherName = (id: string) => {
    const t = teachers.find((x) => x.id === id);
    return t ? `${t.firstName} ${t.lastName}` : "—";
  };
  const classOf = (id?: string) => classes.find((x) => x.id === id);
  const classCascade = (cls?: SchoolClass) =>
    cls ? classCascadeLabel(cls, cls.filiereId ? filiereLabelOf(cls.filiereId) : "") || cls.name : "—";

  /** A séance libre covers every classe / groupe / salle of its selection. */
  const sessionClassIds = (s: ScheduleSession) =>
    s.isOpen && s.classIds?.length ? s.classIds : [s.classId];
  const sessionClassesLabel = (s: ScheduleSession) =>
    sessionClassIds(s).map((id) => classCascade(classOf(id))).join(" · ");
  const sessionGroupsLabel = (s: ScheduleSession) =>
    (s.isOpen && s.groupIds?.length ? s.groupIds : [s.groupId]).map(groupName).join(" · ");
  const sessionSallesLabel = (s: ScheduleSession) =>
    (s.isOpen && s.salleIds?.length ? s.salleIds : [s.salleId]).map(salleName).join(" · ");

  /** Chronological rank of a séance: earliest weekday it runs, then its hour. */
  const rank = (s: ScheduleSession) => {
    const dayIdx = Math.min(...s.days.map((d) => DAYS.indexOf(d)).filter((i) => i >= 0), 99);
    return dayIdx * 10000 + Number(s.startTime.replace(":", ""));
  };

  /** One row per matière, chronological séances inside, matières A→Z. */
  const matieres = useMemo(() => {
    const byModule = new Map<string, ScheduleSession[]>();
    for (const s of sessions) {
      byModule.set(s.moduleId, [...(byModule.get(s.moduleId) ?? []), s]);
    }
    return [...byModule.entries()]
      .map(([id, list]) => ({
        id,
        name: moduleName(id),
        list: [...list].sort((a, b) => rank(a) - rank(b)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, modules]);

  if (matieres.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-canvas/30 p-12 text-center text-xs text-muted">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-line bg-canvas text-[10px] font-bold uppercase tracking-wider text-muted">
              <th className="w-44 p-3">Matière</th>
              <th className="p-3">Séances disponibles</th>
            </tr>
          </thead>
          <tbody>
            {matieres.map((m) => (
              <tr key={m.id} className="border-b border-line align-top last:border-0">
                <td className="border-e border-line bg-canvas/40 p-3">
                  <span className="block text-[11px] font-black leading-tight text-ink">{m.name}</span>
                  <span className="mt-1 block text-[9px] font-semibold uppercase text-muted">
                    {m.list.length} séance{m.list.length > 1 ? "s" : ""}
                  </span>
                </td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-2">
                    {m.list.map((s) => {
                      const own = isHighlighted ? isHighlighted(s) : false;
                      const tone = isHighlighted
                        ? own
                          ? OWN_STYLE
                          : OTHER_STYLE
                        : moduleColor(s.moduleId);
                      return (
                        <button
                          key={s.id}
                          onClick={() => onSelect(s)}
                          title={s.isOpen ? s.title : undefined}
                          className={`w-full space-y-1 rounded-xl border border-line border-l-4 p-2.5 text-start transition-all hover:shadow-md hover:brightness-[0.98] sm:w-60 ${tone}`}
                        >
                          <span className="flex items-center justify-between gap-1.5">
                            <span className="flex items-center gap-1 font-mono text-[11px] font-black leading-tight">
                              <Clock className="h-3 w-3 shrink-0 opacity-70" />
                              {s.startTime} - {s.endTime}
                            </span>
                            {s.isOpen && (
                              <span className="shrink-0 text-[9px] font-bold">
                                {s.isFree ? "🎁 Offerte" : "🎯 Libre"}
                              </span>
                            )}
                          </span>
                          <span className="flex flex-wrap gap-1">
                            {DAYS.filter((d) => s.days.includes(d)).map((d) => (
                              <span
                                key={d}
                                className="rounded border border-current/20 bg-black/[0.03] px-1 py-0.5 text-[8px] font-bold uppercase dark:bg-white/5"
                              >
                                {DAY_SHORT[d]}
                              </span>
                            ))}
                          </span>
                          <span className="block truncate text-[10px] font-bold opacity-90">
                            {sessionClassesLabel(s)}
                          </span>
                          <span className="flex items-center gap-1 truncate text-[9px] opacity-90">
                            <User className="h-2.5 w-2.5 shrink-0" />
                            {teacherName(s.teacherId)}
                          </span>
                          <span className="flex items-center justify-between gap-1 text-[9px] opacity-90">
                            <span className="flex items-center gap-1 truncate">
                              <Users className="h-2.5 w-2.5 shrink-0" />
                              {sessionGroupsLabel(s)}
                            </span>
                            <span className="flex items-center gap-1 truncate">
                              <MapPin className="h-2.5 w-2.5 shrink-0" />
                              {sessionSallesLabel(s)}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
