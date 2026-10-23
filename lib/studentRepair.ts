/**
 * LA SITUATION D'UN ÉLÈVE, CONTRÔLÉE.
 *
 * Trois incohérences ont été trouvées en base (octobre 2026), toutes nées de la
 * même chose : une présence saisie APRÈS coup.
 *
 *  1. La facturation des absences tourne le vendredi matin sur la semaine
 *     vendredi → jeudi qui vient de finir. L'appel d'une classe saisi le
 *     lundi suivant pose bien la présence du mardi… mais l'absence de cette
 *     semaine reste facturée. L'élève paie une séance où il était présent ET
 *     une absence pour la même semaine.
 *  2. En retirant ces absences à la main, la réception supprimait d'abord la
 *     ligne au solde (remboursée), puis l'absence elle-même — et
 *     `delete_absence_penalty` remboursait une SECONDE fois, faute de ligne à
 *     retrouver. Le solde s'écartait alors de son historique (« Solde à
 *     vérifier »).
 *  3. Un emploi du temps supprimé emporte ses présences (cascade), mais pas les
 *     débits de l'historique : la séance payée disparaît du rapport de l'élève.
 *
 * Ce module est la partie PURE de la réparation : il dit ce qui cloche, sans
 * rien écrire. Les écritures vivent dans le store (`lib/store/data.ts`).
 */

import { schoolDateKey } from "@/lib/helpers";
import type { AbsencePenalty, AttendanceRecord, BalanceTransaction, ScheduleSession } from "@/lib/types";

/** Début de la description que la facturation donne à une absence. */
export const ABSENCE_TX_PREFIX = "Absence hebdomadaire";

/** "2026-10-09" → "09/10/2026" */
export const frDay = (iso: string): string => iso.split("-").reverse().join("/");

/** Cette ligne du solde est-elle la facturation d'une absence hebdomadaire ? */
export const isAbsenceTx = (tx: Pick<BalanceTransaction, "description">): boolean =>
  tx.description.startsWith(ABSENCE_TX_PREFIX);

/**
 * La ligne du solde peut-elle être celle de CETTE absence ? Même règle que
 * `delete_absence_penalty` (élève, module, semaine écrite dans la description),
 * sans exiger le montant : une ligne corrigée à la main reste la sienne.
 */
export function isAbsenceTxOf(
  tx: Pick<BalanceTransaction, "studentId" | "description" | "moduleId">,
  pen: Pick<AbsencePenalty, "studentId" | "moduleId" | "periodStart">,
): boolean {
  return (
    tx.studentId === pen.studentId &&
    isAbsenceTx(tx) &&
    tx.description.includes(frDay(pen.periodStart)) &&
    (tx.moduleId ?? null) === (pen.moduleId ?? null)
  );
}

/**
 * Associe chaque absence à SA ligne du solde, une ligne ne servant qu'une fois.
 *
 * Un élève inscrit deux fois au même module (deux groupes) reçoit deux
 * absences la même semaine, et deux lignes presque identiques : seul le nom du
 * groupe les distingue. On préfère donc la ligne qui porte le bon groupe et le
 * bon montant, puis n'importe quelle ligne encore libre.
 */
export function pairAbsenceLines(
  penalties: AbsencePenalty[],
  txs: BalanceTransaction[],
  groupOfPenalty: (pen: AbsencePenalty) => string | undefined = () => undefined,
): Map<string, string> {
  const used = new Set<string>();
  const pairs = new Map<string, string>();
  const ordered = [...penalties].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  for (const pen of ordered) {
    const candidates = txs.filter((t) => !used.has(t.id) && isAbsenceTxOf(t, pen));
    if (candidates.length === 0) continue;
    const group = groupOfPenalty(pen);
    const score = (t: BalanceTransaction) =>
      (group && t.description.includes(`(${group})`) ? 2 : 0) + (t.amount === -pen.amount ? 1 : 0);
    const best = candidates.reduce((a, b) => (score(b) > score(a) ? b : a));
    used.add(best.id);
    pairs.set(pen.id, best.id);
  }
  return pairs;
}

const counts = (a: Pick<AttendanceRecord, "status">) => a.status === "present" || a.status === "late";

/**
 * Les présences qui CONTREDISENT une absence facturée : même module, même
 * classe que le créneau de l'inscription, un jour de la semaine facturée.
 * C'est exactement le test de `process_weekly_absences` — une seule présence
 * dans la semaine et elle n'aurait jamais été facturée.
 */
export function presencesInPenaltyWeek(
  pen: AbsencePenalty,
  attendance: AttendanceRecord[],
  sessionById: Map<string, ScheduleSession>,
): AttendanceRecord[] {
  const enrolled = pen.sessionId ? sessionById.get(pen.sessionId) : undefined;
  const moduleId = pen.moduleId ?? enrolled?.moduleId;
  if (!moduleId) return [];
  return attendance.filter((a) => {
    if (a.studentId !== pen.studentId || !counts(a)) return false;
    const s = sessionById.get(a.sessionId);
    if (!s || s.moduleId !== moduleId) return false;
    // Créneau d'inscription supprimé : le module suffit à reconnaître le cours.
    if (enrolled && s.classId !== enrolled.classId) return false;
    const day = schoolDateKey(a.timestamp);
    return day >= pen.periodStart && day <= pen.periodEnd;
  });
}

export interface ContradictedPenalty {
  penalty: AbsencePenalty;
  presences: AttendanceRecord[];
}

/** Les absences facturées alors que l'élève était présent cette semaine-là. */
export function contradictedPenalties(input: {
  penalties: AbsencePenalty[];
  attendance: AttendanceRecord[];
  sessions: ScheduleSession[];
}): ContradictedPenalty[] {
  if (input.penalties.length === 0) return [];
  const sessionById = new Map(input.sessions.map((s) => [s.id, s]));
  const attendanceByStudent = new Map<string, AttendanceRecord[]>();
  for (const a of input.attendance) {
    const list = attendanceByStudent.get(a.studentId);
    if (list) list.push(a);
    else attendanceByStudent.set(a.studentId, [a]);
  }
  const out: ContradictedPenalty[] = [];
  for (const penalty of input.penalties) {
    const presences = presencesInPenaltyWeek(penalty, attendanceByStudent.get(penalty.studentId) ?? [], sessionById);
    if (presences.length > 0) out.push({ penalty, presences });
  }
  return out;
}

/** Une ligne du solde écrite par un badge ou un pointage (et non une correction). */
export const isSeanceCharge = (tx: Pick<BalanceTransaction, "type" | "amount" | "description">): boolean =>
  tx.type === "deduction" &&
  tx.amount < 0 &&
  (tx.description.startsWith("Séance") || tx.description.startsWith("Présence"));

/**
 * Les séances DÉBITÉES dont la présence n'existe plus — presque toujours parce
 * que l'emploi du temps a été supprimé et ses présences avec lui. L'argent a
 * bien été pris : le rapport doit le montrer.
 *
 * Une ligne sans module (antérieure à `balance_tx.module_id`) n'est jamais
 * signalée : impossible de dire à quel cours elle appartient.
 */
export function chargesWithoutPresence(input: {
  studentId: string;
  balanceTx: BalanceTransaction[];
  attendance: AttendanceRecord[];
  sessions: ScheduleSession[];
}): BalanceTransaction[] {
  const sessionById = new Map(input.sessions.map((s) => [s.id, s]));
  const available = new Map<string, number>();
  for (const a of input.attendance) {
    if (a.studentId !== input.studentId || a.status === "absent") continue;
    const s = sessionById.get(a.sessionId);
    if (!s) continue;
    const key = `${schoolDateKey(a.timestamp)}|${s.moduleId}`;
    available.set(key, (available.get(key) ?? 0) + 1);
  }
  const out: BalanceTransaction[] = [];
  const charges = input.balanceTx
    .filter((t) => t.studentId === input.studentId && isSeanceCharge(t) && !!t.moduleId)
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const tx of charges) {
    const key = `${schoolDateKey(tx.date)}|${tx.moduleId}`;
    const left = available.get(key) ?? 0;
    if (left > 0) available.set(key, left - 1);
    else out.push(tx);
  }
  return out;
}

/**
 * La semaine de facturation (premier et dernier jour inclus) qui contient
 * `iso`. Même ancrage que `week_anchor` côté base : la semaine commence le
 * jour `startDow` (0 = dimanche … 5 = vendredi) et dure sept jours.
 */
export function absenceWeekOf(iso: string, startDow = 5): { start: string; end: string } {
  const noon = new Date(`${iso}T12:00:00Z`);
  const back = (noon.getUTCDay() - startDow + 7) % 7;
  const start = new Date(noon.getTime() - back * 86_400_000);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** Ce que dit l'historique d'un élève : la somme de ses lignes. */
export function historyTotal(studentId: string, balanceTx: Pick<BalanceTransaction, "studentId" | "amount">[]): number {
  let total = 0;
  for (const t of balanceTx) if (t.studentId === studentId) total += t.amount;
  return total;
}
