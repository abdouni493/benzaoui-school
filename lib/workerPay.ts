/**
 * Ce qu'un travailleur a gagné, et ce qu'on lui doit encore.
 *
 * POURQUOI CE FICHIER EXISTE — la panne qu'il répare
 * --------------------------------------------------
 * « Ce mois est-il payé ? » se répondait en cherchant le NOM du travailleur
 * dans le libellé libre des mouvements de caisse :
 *
 *     cash.some(c => c.type === "teacher_payment"
 *                 && c.description.includes(staff.lastName)
 *                 && c.description.includes("09/2026"))
 *
 * Trois façons de se tromper, toutes vues en vrai :
 *   · deux travailleurs qui partagent un nom de famille — payer l'un marquait
 *     l'autre payé ;
 *   · un nom corrigé après coup (accent, faute de frappe) — le mois déjà réglé
 *     redevenait dû, et l'école payait deux fois ;
 *   · un libellé saisi à la main sans le mois — le mois restait dû pour
 *     toujours.
 *
 * Depuis la migration du 12/09/2026, un règlement est une LIGNE (`worker_payments`)
 * qui porte la période qu'elle couvre. Ce module la lit, et rien d'autre.
 *
 * Il est partagé par l'écran Travailleurs et le tableau de bord, pour que les
 * deux annoncent exactement le même retard — deux calculs séparés finissaient
 * toujours par diverger.
 */

import type {
  Day,
  ReceptionStaff,
  WorkerPayment,
  WorkerPaymentDetail,
  WorkerShift,
} from "@/lib/types";

/** Ordre de `Date.getDay()` : 0 = dimanche. */
const DOW: Day[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** Les jours ouvrés par défaut quand le travailleur n'a jamais été configuré :
 *  tous sauf le vendredi, le repos hebdomadaire ici. */
export const DEFAULT_WORK_DAYS: Day[] = [
  "saturday",
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
];

/** YYYY-MM-DD en heure LOCALE — `toISOString()` bascule d'un jour selon le
 *  fuseau, et une journée de travail décalée d'un jour fausse tout le calcul. */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayKey(): string {
  return dayKey(new Date());
}

/** Ce travailleur est-il attendu ce jour-là ? Miroir exact de la fonction SQL
 *  `worker_works_on`, pour que l'écran et le relevé automatique des absences
 *  soient toujours d'accord. */
export function worksOn(worker: Pick<ReceptionStaff, "workDays" | "startDate">, date: string): boolean {
  if (worker.startDate && date < worker.startDate) return false;
  const days = worker.workDays?.length ? worker.workDays : DEFAULT_WORK_DAYS;
  const d = new Date(`${date}T12:00:00`);
  return days.includes(DOW[d.getDay()]);
}

/** Nombre de jours ouvrés d'une période, bornes incluses. */
export function workDaysBetween(
  worker: Pick<ReceptionStaff, "workDays" | "startDate">,
  start: string,
  end: string,
): number {
  let count = 0;
  const d = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  while (d <= last) {
    if (worksOn(worker, dayKey(d))) count += 1;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

/** "2026-09-12" → "12/09/2026" */
export function frDate(iso: string): string {
  return iso ? iso.split("-").reverse().join("/") : "—";
}

/** Minutes → "7 h 30". */
export function fmtHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

/** Une période de travail qui reste à régler. */
export interface WorkerPeriod {
  /** ce qui rend la période unique en base (vide pour un règlement horaire,
   *  qui couvre un ensemble de journées choisies et non une période nommée) */
  key: string;
  label: string;
  start: string;
  end: string;
  /** rémunération avant acomptes, retenues et déduction d'absences */
  amount: number;
  /** ce que les absences de la période coûteraient si on les déduisait */
  absenceDeduction: number;
  shiftIds: string[];
  minutes: number;
  present: number;
  absent: number;
  /** jours ouvrés attendus sur la période */
  expected: number;
  /** le jour où l'argent est dû */
  dueDate: string;
  /** la période n'est pas encore terminée (mois en cours) */
  running: boolean;
}

/** L'urgence d'une période due. */
export type PayUrgency = "late" | "soon" | "ok";

export interface WorkerPayAlert {
  worker: ReceptionStaff;
  period: WorkerPeriod;
  urgency: PayUrgency;
  /** négatif = en retard de N jours ; positif = dû dans N jours */
  daysLeft: number;
}

function shiftsIn(shifts: WorkerShift[], workerId: string, start: string, end: string) {
  return shifts.filter(
    (s) => s.workerId === workerId && s.workDate >= start && s.workDate <= end,
  );
}

/** Dernier jour du mois de `d`, en YYYY-MM-DD. */
function endOfMonth(year: number, month: number): string {
  return dayKey(new Date(year, month + 1, 0));
}

/**
 * Les périodes que ce travailleur n'a pas encore été payé, de la plus ancienne
 * à la plus récente.
 *
 * Aucune ne remonte avant son embauche, et aucune ne dépasse aujourd'hui : on
 * ne réclame pas le salaire d'un mois qui n'a pas commencé.
 */
export function unpaidPeriodsOf(
  worker: ReceptionStaff,
  shifts: WorkerShift[],
  payments: WorkerPayment[],
  today = todayKey(),
): WorkerPeriod[] {
  if (!worker.startDate) return [];
  const mine = payments.filter((p) => p.workerId === worker.id);
  const isPaid = (key: string) => key !== "" && mine.some((p) => p.periodKey === key);

  // ---- Horaire : les journées pointées, réglées en bloc ---------------------
  // Pas de période nommée : on paie un ensemble de journées complètes. Ce sont
  // les journées elles-mêmes qui portent le « déjà payé » (`shift.paid`).
  if (worker.paymentType === "hourly") {
    const payable = shifts
      .filter(
        (s) =>
          s.workerId === worker.id &&
          !s.paid &&
          !s.frozen &&
          s.status !== "absent" &&
          s.endAt,
      )
      .sort((a, b) => a.workDate.localeCompare(b.workDate));
    if (payable.length === 0) return [];

    const minutes = payable.reduce((sum, s) => sum + s.minutes, 0);
    const start = payable[0].workDate;
    const end = payable[payable.length - 1].workDate;
    const absent = shiftsIn(shifts, worker.id, start, end).filter(
      (s) => s.status === "absent" && !s.paid,
    );
    return [
      {
        key: "",
        label:
          payable.length === 1
            ? `Journée du ${frDate(start)}`
            : `${payable.length} journées — ${frDate(start)} → ${frDate(end)}`,
        start,
        end,
        amount: Math.round((minutes / 60) * (worker.hourlyRate ?? 0)),
        absenceDeduction: 0,
        shiftIds: [...payable.map((s) => s.id), ...absent.map((s) => s.id)],
        minutes,
        present: payable.length,
        absent: absent.length,
        expected: workDaysBetween(worker, start, end),
        dueDate: end,
        running: false,
      },
    ];
  }

  // ---- Mensuel : un mois = une période ---------------------------------------
  if (worker.paymentType === "monthly") {
    const out: WorkerPeriod[] = [];
    const first = new Date(`${worker.startDate}T12:00:00`);
    const cursor = new Date(first.getFullYear(), first.getMonth(), 1);
    const now = new Date(`${today}T12:00:00`);
    // 24 mois en arrière au plus : au-delà, la liste devient illisible et ne
    // correspond plus à une paie qu'on va réellement régler.
    let guard = 0;
    while (cursor <= now && guard < 240) {
      guard += 1;
      const y = cursor.getFullYear();
      const m = cursor.getMonth();
      const key = `${String(m + 1).padStart(2, "0")}/${y}`;
      const start = dayKey(new Date(y, m, 1));
      const end = endOfMonth(y, m);

      if (!isPaid(key)) {
        // Le mois d'embauche est proratisé sur les jours réellement attendus.
        const from = start < worker.startDate ? worker.startDate : start;
        const rows = shiftsIn(shifts, worker.id, from, end);
        const present = rows.filter((r) => r.status !== "absent").length;
        const absent = rows.filter((r) => r.status === "absent").length;
        const expected = workDaysBetween(worker, from, end > today ? today : end);
        // Ce qu'une journée d'absence coûterait, si l'école choisit de la
        // déduire : le salaire réparti sur les jours ouvrés du mois entier.
        const monthDays = workDaysBetween(worker, from, end) || 1;
        out.push({
          key,
          label: cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
          start: from,
          end,
          amount: worker.salary,
          absenceDeduction: Math.round((worker.salary / monthDays) * absent),
          shiftIds: rows.filter((r) => !r.paid).map((r) => r.id),
          minutes: rows.reduce((sum, r) => sum + r.minutes, 0),
          present,
          absent,
          expected,
          dueDate: end,
          running: end > today,
        });
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return out;
  }

  // ---- Journalier / demi-journée : un jour travaillé = une période ----------
  // Une ABSENCE n'est jamais une période due : on ne paie pas un jour qui n'a
  // pas été travaillé. Elle reste visible dans l'onglet Pointage.
  const out: WorkerPeriod[] = [];
  const worked = shifts
    .filter(
      (s) => s.workerId === worker.id && s.status !== "absent" && s.workDate <= today,
    )
    .sort((a, b) => a.workDate.localeCompare(b.workDate));

  for (const s of worked) {
    if (isPaid(s.workDate) || s.paid) continue;
    out.push({
      key: s.workDate,
      label: new Date(`${s.workDate}T12:00:00`).toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      start: s.workDate,
      end: s.workDate,
      amount: worker.salary,
      absenceDeduction: 0,
      shiftIds: [s.id],
      minutes: s.minutes,
      present: 1,
      absent: 0,
      expected: 1,
      dueDate: s.workDate,
      running: false,
    });
  }
  return out;
}

/** Écart en jours entre deux dates ISO (b - a). */
export function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime();
  return Math.round(ms / 86400000);
}

/**
 * L'urgence d'une période : en retard, bientôt due, ou tranquille.
 *
 * `payAlertDays` (réglable par travailleur, 3 jours par défaut) est le délai
 * de prévenance : on veut savoir qu'un salaire tombe AVANT qu'il tombe, pas le
 * lendemain du jour où l'employé le réclame.
 */
export function urgencyOf(
  period: WorkerPeriod,
  worker: Pick<ReceptionStaff, "payAlertDays">,
  today = todayKey(),
): { urgency: PayUrgency; daysLeft: number } {
  const window = worker.payAlertDays ?? 3;
  const daysLeft = daysBetween(today, period.dueDate);
  if (daysLeft < 0) return { urgency: "late", daysLeft };
  if (daysLeft <= window) return { urgency: "soon", daysLeft };
  return { urgency: "ok", daysLeft };
}

/**
 * Toutes les alertes de paie de l'école, les plus urgentes d'abord.
 *
 * C'est cette liste que l'écran Travailleurs ET le tableau de bord affichent —
 * une seule source, donc jamais deux comptes différents du même retard.
 */
export function payAlertsOf(
  workers: ReceptionStaff[],
  shifts: WorkerShift[],
  payments: WorkerPayment[],
  today = todayKey(),
): WorkerPayAlert[] {
  const out: WorkerPayAlert[] = [];
  for (const worker of workers) {
    for (const period of unpaidPeriodsOf(worker, shifts, payments, today)) {
      // Un mois EN COURS n'est pas en retard : il n'est simplement pas fini.
      if (period.running) continue;
      const { urgency, daysLeft } = urgencyOf(period, worker, today);
      if (urgency === "ok") continue;
      out.push({ worker, period, urgency, daysLeft });
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

/** L'instantané figé qu'un règlement emporte, pour que le bulletin puisse être
 *  réimprimé à l'identique dans six mois. */
export function buildPaymentDetails(
  shifts: WorkerShift[],
  ids: string[],
  amountOf: (shift: WorkerShift) => number,
): WorkerPaymentDetail[] {
  return shifts
    .filter((s) => ids.includes(s.id))
    .sort((a, b) => a.workDate.localeCompare(b.workDate))
    .map((s) => ({
      workDate: s.workDate,
      startAt: s.startAt,
      endAt: s.endAt,
      minutes: s.minutes,
      status: s.status ?? "present",
      source: s.source ?? "scan",
      amount: amountOf(s),
    }));
}
