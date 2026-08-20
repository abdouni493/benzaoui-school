"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/store/data";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import type { Day, ScheduleSession } from "@/lib/types";
import { DAY_LABELS_FR, classCascadeLabel, sessionSalleIds } from "@/lib/helpers";

const DAY_KEYS: Day[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** YYYY-MM-DD d'une Date, en heure LOCALE (jamais décalé en UTC). */
const isoOf = (d: Date) => d.toLocaleDateString("fr-CA");
const dayOfIso = (iso: string): Day => DAY_KEYS[new Date(`${iso}T12:00:00`).getDay()];
const longDateFr = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/**
 * Les séances d'UNE journée, présentées comme un emploi du temps : une ligne
 * par créneau, triée par heure de début, avec l'état du pointage.
 *
 * La date est navigable : le tableau de bord ouvre sur aujourd'hui, et les
 * flèches (ou le sélecteur) remontent aussi loin qu'on veut dans le passé —
 * c'est ce qui manquait pour vérifier une journée écoulée sans quitter l'écran.
 */
export function DaySchedulePanel() {
  const { sessions, modules, groups, teachers, salles, classes, filieres, subscriptions, students, attendance } =
    useData();

  const todayIso = isoOf(new Date());
  const [date, setDate] = useState<string>(todayIso);
  const day = dayOfIso(date);

  const moduleName = (id?: string) => modules.find((m) => m.id === id)?.name ?? "Matière";
  const groupName = (id?: string) => groups.find((g) => g.id === id)?.name ?? "—";
  const teacherName = (id?: string) => {
    const t = teachers.find((x) => x.id === id);
    return t ? `${t.firstName} ${t.lastName}`.trim() : "Non spécifié";
  };
  const salleLabel = (s: ScheduleSession) =>
    sessionSalleIds(s)
      .map((id) => salles.find((sa) => sa.id === id)?.name ?? "Salle")
      .join(" · ") || "—";
  const className = (id?: string) => {
    const c = classes.find((x) => x.id === id);
    if (!c) return "—";
    const fil = c.filiereId ? filieres.find((f) => f.id === c.filiereId)?.name ?? "" : "";
    return classCascadeLabel(c, fil) || c.name;
  };

  // Un créneau n'existe ce jour-là que s'il tombe sur ce jour de semaine et,
  // pour une séance libre, à l'intérieur de sa période de dates.
  const daySessions = useMemo(
    () =>
      sessions
        .filter((s) => s.days.includes(day))
        .filter((s) => !s.periodStart || s.periodStart <= date)
        .filter((s) => !s.periodEnd || s.periodEnd >= date)
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [sessions, day, date],
  );

  /** Pointages enregistrés ce jour-là, séance par séance. */
  const markedBySession = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of attendance) {
      if (new Date(a.timestamp).toLocaleDateString("fr-CA") !== date) continue;
      map[a.sessionId] = (map[a.sessionId] ?? 0) + 1;
    }
    return map;
  }, [attendance, date]);

  const rosterOf = (sessionId: string) => {
    const subIds = subscriptions.filter((su) => su.sessionId === sessionId).map((su) => su.id);
    if (subIds.length === 0) return 0;
    return students.filter((stu) => stu.subscriptionIds.some((id) => subIds.includes(id))).length;
  };

  const shiftDate = (days: number) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + days);
    setDate(isoOf(d));
  };

  const totalMarked = daySessions.reduce((n, s) => n + (markedBySession[s.id] ?? 0), 0);

  return (
    <Card className="border border-line card-shadow">
      <CardBody className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
          <h3 className="flex items-center gap-2 font-bold text-ink">
            <Clock className="h-4.5 w-4.5 text-primary" />
            Séances du {DAY_LABELS_FR[day].toLowerCase()} {longDateFr(date)}
          </h3>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => shiftDate(-1)} title="Jour précédent">
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || todayIso)}
              className="h-8 rounded-lg border border-line bg-surface px-2.5 text-xs text-ink outline-none focus:border-primary"
            />
            <Button variant="outline" size="sm" onClick={() => shiftDate(1)} title="Jour suivant">
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            {date !== todayIso && (
              <Button variant="outline" size="sm" onClick={() => setDate(todayIso)}>
                Aujourd&apos;hui
              </Button>
            )}
          </div>
        </div>

        {daySessions.length === 0 ? (
          <p className="py-10 text-center text-xs italic text-muted">
            Aucune séance programmée le {DAY_LABELS_FR[day].toLowerCase()} {longDateFr(date)}.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-xs">
                <thead>
                  <tr className="bg-canvas/50 text-[10px] uppercase tracking-wider text-muted">
                    <th className="border-b border-line p-2 text-start font-bold">Horaire</th>
                    <th className="border-b border-line p-2 text-start font-bold">Séance</th>
                    <th className="border-b border-line p-2 text-start font-bold">Classe</th>
                    <th className="border-b border-line p-2 text-start font-bold">Groupe</th>
                    <th className="border-b border-line p-2 text-start font-bold">Enseignant</th>
                    <th className="border-b border-line p-2 text-start font-bold">Salle</th>
                    <th className="border-b border-line p-2 text-center font-bold">Pointés</th>
                  </tr>
                </thead>
                <tbody>
                  {daySessions.map((s) => {
                    const marked = markedBySession[s.id] ?? 0;
                    const roster = rosterOf(s.id);
                    return (
                      <tr key={s.id} className="hover:bg-primary-50/40">
                        <td className="border-b border-line p-2 font-mono font-bold text-primary whitespace-nowrap">
                          {s.startTime} - {s.endTime}
                        </td>
                        <td className="border-b border-line p-2">
                          <strong className="text-ink">
                            {s.isOpen && <span className="me-1">🎯</span>}
                            {s.isOpen ? s.title || `Séance libre — ${moduleName(s.moduleId)}` : moduleName(s.moduleId)}
                          </strong>
                        </td>
                        <td className="border-b border-line p-2 text-muted">{className(s.classId)}</td>
                        <td className="border-b border-line p-2 text-muted">{groupName(s.groupId)}</td>
                        <td className="border-b border-line p-2 text-muted">{teacherName(s.teacherId)}</td>
                        <td className="border-b border-line p-2 text-muted">{salleLabel(s)}</td>
                        <td className="border-b border-line p-2 text-center">
                          <Badge tone={marked > 0 ? "success" : "neutral"} className="font-mono text-[10px]">
                            {marked} / {roster}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted">
              <span>
                <strong className="text-ink">{daySessions.length}</strong> séance(s) ·{" "}
                <strong className="text-success">{totalMarked}</strong> pointage(s) enregistré(s)
              </span>
              <span>Vue par salle et par heure : « Répartition des Salles » dans le menu.</span>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
