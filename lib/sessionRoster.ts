/**
 * LES ÉLÈVES D'UNE FEUILLE DE PRÉSENCE.
 *
 * Un élève désinscrit d'un emploi du temps restait sur sa feuille : il y
 * avait une présence ce jour-là, et la feuille ajoutait à ses inscrits tous
 * ceux qui y avaient une présence — en « hors de son emploi du temps ». La
 * réception le voyait donc encore sur un créneau qu'il venait de quitter.
 *
 * La règle est maintenant celle de l'inscription :
 *  - un COURS ordinaire ne montre que ses inscrits du moment. Désinscrire un
 *    élève le retire de la feuille ; ses présences passées restent en base,
 *    sur sa fiche et dans son rapport.
 *  - une SÉANCE LIBRE garde aussi ceux qui y ont une présence ce jour-là sans
 *    y être inscrits : son public (promotion, filière) et les passagers y
 *    badgent sans inscription, c'est sa raison d'être.
 *
 * Fonction pure, testée dans tests/session-roster.test.ts.
 */

import type { AttendanceRecord, ScheduleSession, Student, Subscription } from "@/lib/types";

export function sessionRoster<S extends Pick<Student, "id" | "subscriptionIds">>(
  session: Pick<ScheduleSession, "id" | "isOpen">,
  students: readonly S[],
  subscriptions: readonly Pick<Subscription, "id" | "sessionId">[],
  /** les présences du JOUR de la feuille */
  dayAttendance: readonly Pick<AttendanceRecord, "studentId" | "sessionId">[],
): S[] {
  const subIds = new Set(subscriptions.filter((su) => su.sessionId === session.id).map((su) => su.id));
  const enrolled = students.filter((stu) => stu.subscriptionIds.some((id) => subIds.has(id)));
  if (!session.isOpen) return enrolled;

  const enrolledIds = new Set(enrolled.map((s) => s.id));
  const visitorIds = new Set(
    dayAttendance
      .filter((a) => a.sessionId === session.id && !enrolledIds.has(a.studentId))
      .map((a) => a.studentId),
  );
  return [...enrolled, ...students.filter((s) => visitorIds.has(s.id))];
}
