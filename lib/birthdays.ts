/**
 * Les anniversaires des élèves — et surtout : QUI est attendu en classe le jour
 * même.
 *
 * L'école connaît la date de naissance de chaque élève depuis toujours, mais
 * elle dormait au fond d'une fiche. Personne à l'accueil ne pouvait savoir, en
 * ouvrant l'application le matin, qu'un des élèves qui va badger dans l'heure
 * fête ses quinze ans.
 *
 * CE QUI DÉCLENCHE UNE ALERTE, ET CE QUI N'EN DÉCLENCHE PAS
 * ---------------------------------------------------------
 * Une alerte ne se justifie que si l'élève VIENT. Un anniversaire un jour où
 * l'élève n'a aucune séance ne s'affiche donc pas en alerte : il reste sur la
 * page Anniversaires, dans une liste à part. C'est la même règle que partout
 * ailleurs dans l'application — l'emploi du temps du jour (`sessionsOnDate`)
 * fait foi, et les élèves rattachés à une séance sont ses INSCRITS, ceux dont
 * un abonnement porte cette séance.
 *
 * LE 29 FÉVRIER
 * -------------
 * Trois années sur quatre, il n'existe pas. Un élève né un 29 février est fêté
 * le 28 : ne rien afficher pendant trois ans reviendrait à perdre l'élève tous
 * les ans sauf un.
 */

import type { ScheduleSession, Student, Subscription } from "@/lib/types";
import { sessionsOnDate } from "@/lib/helpers";

/** "MM-DD" d'une date ISO, ou null quand la fiche n'en porte pas (la colonne
 *  `birth_date` est facultative en base : beaucoup de fiches sont vides). */
export function monthDayOf(iso?: string | null): string | null {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[1]}-${m[2]}` : null;
}

/** Une année bissextile, au sens du calendrier grégorien. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Le jour où cet anniversaire se fête dans une année donnée — le 28 février
 *  pour un 29 février d'année non bissextile. */
export function birthdayIsoIn(birthDate: string | undefined | null, year: number): string | null {
  const md = monthDayOf(birthDate);
  if (!md) return null;
  if (md === "02-29" && !isLeapYear(year)) return `${year}-02-28`;
  return `${year}-${md}`;
}

/** Cet élève fête-t-il son anniversaire à cette date ? */
export function isBirthdayOn(birthDate: string | undefined | null, iso: string): boolean {
  const year = Number(iso.slice(0, 4));
  if (!Number.isFinite(year)) return false;
  return birthdayIsoIn(birthDate, year) === iso;
}

/** L'âge atteint le jour de l'anniversaire de l'année de `iso`, ou null quand
 *  la date de naissance est absente ou aberrante. */
export function ageOn(birthDate: string | undefined | null, iso: string): number | null {
  const born = Number((birthDate ?? "").slice(0, 4));
  const year = Number(iso.slice(0, 4));
  if (!monthDayOf(birthDate) || !Number.isFinite(born) || !Number.isFinite(year)) return null;
  const age = year - born;
  return age >= 0 && age < 130 ? age : null;
}

/** La prochaine date à laquelle cet anniversaire tombe, à partir de `fromIso`
 *  inclus (le jour même compte). */
export function nextBirthdayIso(
  birthDate: string | undefined | null,
  fromIso: string,
): string | null {
  const year = Number(fromIso.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  for (const y of [year, year + 1]) {
    const iso = birthdayIsoIn(birthDate, y);
    if (iso && iso >= fromIso) return iso;
  }
  return null;
}

/** Jours entiers avant le prochain anniversaire (0 = aujourd'hui). */
export function daysUntilBirthday(
  birthDate: string | undefined | null,
  fromIso: string,
): number | null {
  const next = nextBirthdayIso(birthDate, fromIso);
  if (!next) return null;
  const ms = Date.parse(`${next}T12:00:00`) - Date.parse(`${fromIso}T12:00:00`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

/** Un élève qui fête son anniversaire une date donnée. */
export interface BirthdayEntry {
  student: Student;
  /** l'âge qu'il atteint ce jour-là (null si sa fiche ne porte pas d'année) */
  age: number | null;
  /** ses séances de la journée, dans l'ordre — vide s'il n'est pas attendu */
  sessions: ScheduleSession[];
}

export interface BirthdayRosterInput {
  students: Student[];
  sessions: ScheduleSession[];
  subscriptions: Subscription[];
  /** la journée observée, "YYYY-MM-DD" */
  date: string;
}

export interface BirthdayRoster {
  /** anniversaire ET séance ce jour-là : la SEULE liste qui lève une alerte */
  expected: BirthdayEntry[];
  /** anniversaire le même jour, mais aucune séance : personne à féliciter ici */
  away: BirthdayEntry[];
}

/**
 * Les anniversaires d'une journée, séparés selon que l'élève a cours ou non.
 */
export function birthdayRosterOf(input: BirthdayRosterInput): BirthdayRoster {
  const { students, sessions, subscriptions, date } = input;

  const celebrating = students.filter((s) => isBirthdayOn(s.birthDate, date));
  const expected: BirthdayEntry[] = [];
  const away: BirthdayEntry[] = [];
  // Personne ne fête rien aujourd'hui : inutile de dérouler l'emploi du temps.
  if (celebrating.length === 0) return { expected, away };

  const daySessions = sessionsOnDate(sessions, date);
  const byId = new Map(daySessions.map((s) => [s.id, s]));
  // Abonnement -> séance du jour. Un élève ne porte que des identifiants
  // d'abonnements ; c'est par eux qu'on retombe sur ses séances.
  const bySubscription = new Map<string, ScheduleSession>();
  for (const sub of subscriptions) {
    const session = byId.get(sub.sessionId);
    if (session) bySubscription.set(sub.id, session);
  }

  for (const student of celebrating) {
    const seen = new Set<string>();
    const mine: ScheduleSession[] = [];
    for (const subId of student.subscriptionIds ?? []) {
      const session = bySubscription.get(subId);
      // Deux abonnements peuvent viser la même séance : elle ne compte qu'une fois.
      if (session && !seen.has(session.id)) {
        seen.add(session.id);
        mine.push(session);
      }
    }
    mine.sort((a, b) => a.startTime.localeCompare(b.startTime));
    const entry: BirthdayEntry = { student, age: ageOn(student.birthDate, date), sessions: mine };
    (mine.length > 0 ? expected : away).push(entry);
  }

  const byName = (a: BirthdayEntry, b: BirthdayEntry) =>
    `${a.student.firstName} ${a.student.lastName}`.localeCompare(
      `${b.student.firstName} ${b.student.lastName}`,
      "fr",
    );

  // Les attendus dans l'ordre où ils arrivent à l'école : c'est l'ordre dans
  // lequel l'accueil les verra passer.
  expected.sort(
    (a, b) => a.sessions[0].startTime.localeCompare(b.sessions[0].startTime) || byName(a, b),
  );
  away.sort(byName);
  return { expected, away };
}

/** Les élèves fêtés, séance par séance — ce que l'emploi du temps du jour
 *  affiche sur ses lignes. */
export function birthdaysBySession(entries: BirthdayEntry[]): Map<string, BirthdayEntry[]> {
  const map = new Map<string, BirthdayEntry[]>();
  for (const entry of entries) {
    for (const session of entry.sessions) {
      const list = map.get(session.id);
      if (list) list.push(entry);
      else map.set(session.id, [entry]);
    }
  }
  return map;
}

/** Un anniversaire à venir, tel que la page le liste. */
export interface UpcomingBirthday {
  student: Student;
  /** la date à laquelle il sera fêté, "YYYY-MM-DD" */
  date: string;
  /** jours restants (0 = aujourd'hui) */
  inDays: number;
  /** l'âge qu'il atteindra */
  age: number | null;
}

/**
 * Les anniversaires des `days` prochains jours, aujourd'hui compris, du plus
 * proche au plus lointain.
 */
export function upcomingBirthdays(
  students: Student[],
  fromIso: string,
  days = 30,
): UpcomingBirthday[] {
  const out: UpcomingBirthday[] = [];
  for (const student of students) {
    const date = nextBirthdayIso(student.birthDate, fromIso);
    const inDays = daysUntilBirthday(student.birthDate, fromIso);
    if (!date || inDays === null || inDays > days) continue;
    out.push({ student, date, inDays, age: ageOn(student.birthDate, date) });
  }
  return out.sort(
    (a, b) =>
      a.inDays - b.inDays ||
      `${a.student.firstName} ${a.student.lastName}`.localeCompare(
        `${b.student.firstName} ${b.student.lastName}`,
        "fr",
      ),
  );
}
