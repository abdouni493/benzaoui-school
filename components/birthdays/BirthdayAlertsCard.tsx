"use client";

/** L'alerte d'anniversaire du tableau de bord.
 *
 *  Elle ne parle QUE de l'emploi du temps du jour : un élève qui fête son
 *  anniversaire un jour où il n'a aucune séance n'est pas une alerte — personne
 *  ne le croisera. Il reste listé sur la page Anniversaires, à part.
 *
 *  Rien ne s'affiche les jours sans anniversaire : une carte vide qui répète
 *  « aucun anniversaire » tous les matins finit par ne plus être lue. */

import Link from "next/link";
import { Cake, ArrowRight } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useData } from "@/lib/store/data";
import { useTodayBirthdays } from "@/lib/useTodayBirthdays";
import { sessionSalleIds } from "@/lib/helpers";
import type { ScheduleSession } from "@/lib/types";

export function BirthdayAlertsCard() {
  const { modules, salles, teachers } = useData();
  const { expected } = useTodayBirthdays();

  if (expected.length === 0) return null;

  const moduleName = (id?: string) => modules.find((m) => m.id === id)?.name ?? "Matière";
  const teacherName = (id?: string) => {
    const t = teachers.find((x) => x.id === id);
    return t ? `${t.firstName} ${t.lastName}`.trim() : "";
  };
  const salleLabel = (s: ScheduleSession) =>
    sessionSalleIds(s)
      .map((id) => salles.find((sa) => sa.id === id)?.name ?? "Salle")
      .join(" · ");
  const sessionTitle = (s: ScheduleSession) =>
    s.isOpen ? s.title || `Séance libre — ${moduleName(s.moduleId)}` : moduleName(s.moduleId);

  return (
    <Card className="border border-primary/25 bg-primary-50/40">
      <CardBody className="space-y-3.5 p-5">
        <div className="flex flex-wrap items-center gap-2 border-b border-primary/15 pb-3">
          <h3 className="flex items-center gap-2 font-bold text-ink">
            <Cake className="h-4.5 w-4.5 text-primary" />
            Anniversaires du jour
          </h3>
          <Badge tone="primary">{expected.length} élève(s) en cours aujourd&apos;hui</Badge>
          <Link
            href="/birthdays"
            className="ms-auto inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
          >
            Ouvrir les anniversaires <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="space-y-2.5">
          {expected.map(({ student, age, sessions }) => (
            <div
              key={student.id}
              className="rounded-xl border border-primary/15 bg-surface p-3 transition-colors hover:border-primary/35"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg leading-none">🎂</span>
                <strong className="text-xs text-ink">
                  {student.firstName} {student.lastName}
                </strong>
                {age !== null && <Badge tone="primary">{age} ans</Badge>}
                {student.phone && (
                  <span className="font-mono text-[10px] text-muted">📞 {student.phone}</span>
                )}
              </div>

              {/* Les séances qu'il suit AUJOURD'HUI : de quoi savoir à quelle
                  heure il passe, et dans quelle salle aller le féliciter. */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {sessions.map((s) => (
                  <span
                    key={s.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-canvas/40 px-2 py-1 text-[10px] text-muted"
                  >
                    <strong className="font-mono text-primary">
                      {s.startTime}-{s.endTime}
                    </strong>
                    <span className="text-ink">{sessionTitle(s)}</span>
                    {salleLabel(s) && <span>· {salleLabel(s)}</span>}
                    {teacherName(s.teacherId) && <span>· {teacherName(s.teacherId)}</span>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
