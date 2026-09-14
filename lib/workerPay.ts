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
  WorkerShiftSource,
  WorkerShiftStatus,
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
  /**
   * Ce que les absences de la période retiennent DÉJÀ, d'après les décisions
   * prises dessus — pour AFFICHAGE seulement.
   *
   * Ce champ portait une heuristique : le salaire divisé par les jours ouvrés,
   * multiplié par le nombre d'absences, que l'écran déduisait sur une case à
   * cocher. Depuis qu'une absence se TRANCHE (elle écrit sa retenue dans
   * `teacher_absences`), la même absence était comptée DEUX FOIS : une fois par
   * l'heuristique, une fois par la retenue. Le travailleur perdait deux
   * journées pour une.
   *
   * La retenue ne vit donc plus qu'à UN endroit — la décision écrite — et ce
   * champ ne fait que la résumer à l'écran.
   */
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
  /** Les journées de la période, arrivée et sortie comprises.
   *
   *  Sur un travailleur payé À LA JOURNÉE, l'écran de règlement doit montrer
   *  à quelle heure il est arrivé et à quelle heure il est parti : c'est ce
   *  qui fait qu'une journée se paie, et la seule chose qu'on puisse lui
   *  opposer s'il la contexte. */
  days: WorkerPeriodDay[];
  /** Absences de la période dont la retenue n'a jamais été tranchée. Le
   *  règlement doit les faire trancher avant de se conclure : une absence
   *  oubliée est un mois payé en trop. */
  pendingAbsences: WorkerPeriodDay[];
}

/** Une journée de la période, telle que le bulletin la montre. */
export interface WorkerPeriodDay {
  shiftId: string;
  workDate: string;
  startAt?: string;
  endAt?: string;
  minutes: number;
  status: WorkerShiftStatus;
  source: WorkerShiftSource;
  /** la journée est commencée mais jamais clôturée */
  frozen: boolean;
  /** absence : la retenue a-t-elle été tranchée (même à 0 DA) ? */
  absenceResolved: boolean;
  absenceCost: number;
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

/** La journée telle que le bulletin la montre. */
function dayOf(shift: WorkerShift): WorkerPeriodDay {
  return {
    shiftId: shift.id,
    workDate: shift.workDate,
    startAt: shift.startAt,
    endAt: shift.endAt,
    minutes: shift.minutes,
    status: shift.status ?? "present",
    source: shift.source ?? "scan",
    frozen: !!shift.frozen,
    absenceResolved: !!shift.absenceResolved,
    absenceCost: shift.absenceCost ?? 0,
  };
}

/**
 * Le jour du mois d'où part la paie d'un travailleur mensuel.
 *
 * `payStartDate` est la date que la réception pose à la création (« il est payé
 * à partir du 10 ») ; à défaut, c'est sa date d'embauche.
 */
export function payAnchorOf(
  worker: Partial<Pick<ReceptionStaff, "payStartDate" | "startDate">>,
): string {
  return worker.payStartDate || worker.startDate || "";
}

/** `date` + `months` mois, en gardant le même jour du mois — ramené au dernier
 *  jour quand le mois d'arrivée est plus court (31 janvier + 1 mois = 28/29
 *  février, jamais le 3 mars). */
export function addMonthsKeepingDay(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const lastDay = new Date(y, m - 1 + months + 1, 0).getDate();
  return dayKey(new Date(y, m - 1 + months, Math.min(d, lastDay)));
}

/** Un jour avant `date`. */
function dayBefore(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return dayKey(d);
}

/**
 * Les périodes MENSUELLES d'un travailleur, de la première à celle en cours.
 *
 * POURQUOI CE N'EST PAS « LE MOIS CIVIL »
 * ---------------------------------------
 * Un salaire se compte à partir du jour où l'employé a commencé à être payé,
 * pas à partir du 1er. Embauché le 10 septembre, il est payé le 10 octobre :
 * l'écran annonçait pourtant le salaire « dû » le 30 septembre, et le déclarait
 * en retard pendant dix jours où il n'était pas encore gagné.
 *
 * Chaque période court donc de l'anniversaire au jour qui précède le suivant
 * (10/09 → 09/10), et l'argent est dû à l'anniversaire d'après (10/10).
 *
 * LA CLÉ RESTE « MM/YYYY », celle du mois où la période COMMENCE. Deux périodes
 * consécutives commencent forcément dans deux mois différents, la clé reste
 * donc unique — et tous les mois déjà réglés avant ce changement le restent,
 * ce qui évite de repayer un salaire.
 */
function monthlyPeriods(
  worker: ReceptionStaff,
  shifts: WorkerShift[],
  isPaid: (key: string) => boolean,
  today: string,
): WorkerPeriod[] {
  const anchor = payAnchorOf(worker);
  if (!anchor) return [];

  const out: WorkerPeriod[] = [];
  const anchorDay = Number(anchor.split("-")[2]);
  // Une paie calée sur le 1er EST le mois civil : on garde alors exactement
  // l'ancien découpage, bornes comprises.
  const alignedOnFirst = anchorDay === 1;

  for (let i = 0; i < 240; i++) {
    const start = addMonthsKeepingDay(anchor, i);
    if (start > today) break;
    const nextStart = addMonthsKeepingDay(anchor, i + 1);
    const [sy, sm] = start.split("-").map(Number);
    const end = alignedOnFirst ? endOfMonth(sy, sm - 1) : dayBefore(nextStart);
    // Le salaire est dû le jour de l'anniversaire suivant ; sur un mois civil,
    // c'est le dernier jour du mois, comme avant.
    const dueDate = alignedOnFirst ? end : nextStart;
    const key = `${String(sm).padStart(2, "0")}/${sy}`;

    if (isPaid(key)) continue;

    const rows = shiftsIn(shifts, worker.id, start, end);
    const days = rows.map(dayOf).sort((a, b) => a.workDate.localeCompare(b.workDate));
    const present = days.filter((r) => r.status !== "absent");
    const absent = days.filter((r) => r.status === "absent");
    const expected = workDaysBetween(worker, start, end > today ? today : end);
    out.push({
      key,
      label: alignedOnFirst
        ? new Date(`${start}T12:00:00`).toLocaleDateString("fr-FR", {
            month: "long",
            year: "numeric",
          })
        : `${frDate(start)} → ${frDate(end)}`,
      start,
      end,
      amount: worker.salary,
      // La somme des décisions prises sur les absences de la période. Elle est
      // déjà portée par les retenues (`teacher_absences`) que le règlement
      // déduit : on ne la soustrait pas une seconde fois ici.
      absenceDeduction: absent.reduce((sum, r) => sum + r.absenceCost, 0),
      shiftIds: rows.filter((r) => !r.paid).map((r) => r.id),
      minutes: days.reduce((sum, r) => sum + r.minutes, 0),
      present: present.length,
      absent: absent.length,
      expected,
      dueDate,
      running: end > today,
      days,
      // Une absence dont la retenue n'a jamais été tranchée : le règlement doit
      // la faire trancher, sinon le mois se paie plein alors qu'il ne l'était pas.
      pendingAbsences: absent.filter((r) => !r.absenceResolved),
    });
  }
  return out;
}

/**
 * Les périodes que ce travailleur n'a pas encore été payé, de la plus ancienne
 * à la plus récente.
 *
 * Aucune ne remonte avant son embauche, et aucune ne dépasse aujourd'hui : on
 * ne réclame pas le salaire d'une période qui n'a pas commencé.
 */
export function unpaidPeriodsOf(
  worker: ReceptionStaff,
  shifts: WorkerShift[],
  payments: WorkerPayment[],
  today = todayKey(),
): WorkerPeriod[] {
  if (!worker.startDate && !worker.payStartDate) return [];
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
        days: payable.map(dayOf),
        pendingAbsences: [],
      },
    ];
  }

  // ---- Mensuel : de l'anniversaire de paie au suivant -------------------------
  if (worker.paymentType === "monthly") {
    return monthlyPeriods(worker, shifts, isPaid, today);
  }

  // ---- Journalier / demi-journée : une journée TERMINÉE = une période -------
  //
  // UNE JOURNÉE NE SE PAIE QU'UNE FOIS TERMINÉE.
  //
  // L'écran proposait de régler la journée dès le badge d'arrivée : un
  // travailleur pointé à 8 h était « dû » à 8 h 01, avant d'avoir travaillé.
  // Il faut désormais la SORTIE — second badge, ou fin de service saisie à la
  // main — pour que la journée devienne payable. Une journée commencée et
  // jamais clôturée (`frozen`) attend qu'on la corrige : la réception la voit
  // dans l'onglet Pointage, elle n'entre pas dans la paie.
  //
  // Une ABSENCE n'est jamais une période due : on ne paie pas un jour qui n'a
  // pas été travaillé.
  const out: WorkerPeriod[] = [];
  const worked = shifts
    .filter(
      (s) =>
        s.workerId === worker.id &&
        s.status !== "absent" &&
        s.workDate <= today &&
        !!s.endAt &&
        !s.frozen,
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
      days: [dayOf(s)],
      pendingAbsences: [],
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

/**
 * Les absences qu'il reste à trancher.
 *
 * POURQUOI SEULEMENT LES MENSUELS
 * -------------------------------
 * Une absence n'a de sens que là où elle COÛTE quelque chose. Un travailleur
 * au mois touche son salaire qu'il vienne ou non : c'est le seul cas où il faut
 * décider si l'on retient une journée. Un journalier, lui, est payé aux
 * journées travaillées — ne pas venir se solde tout seul, il n'y a rien à
 * retenir, et une alerte quotidienne « il est absent » ne servirait qu'à noyer
 * les vraies.
 *
 * Une absence est « tranchée » dès que quelqu'un a décidé de son coût — même
 * à 0 DA. C'est la décision qui compte, pas le montant.
 */
export interface WorkerAbsenceAlert {
  worker: ReceptionStaff;
  shift: WorkerShift;
  /** négatif = il y a N jours */
  daysAgo: number;
}

export function pendingAbsencesOf(
  workers: ReceptionStaff[],
  shifts: WorkerShift[],
  today = todayKey(),
): WorkerAbsenceAlert[] {
  const monthly = new Map(
    workers.filter((w) => w.paymentType === "monthly").map((w) => [w.id, w]),
  );
  return shifts
    .filter((s) => s.status === "absent" && !s.absenceResolved && monthly.has(s.workerId))
    .map((s) => ({
      worker: monthly.get(s.workerId)!,
      shift: s,
      daysAgo: daysBetween(s.workDate, today),
    }))
    .sort((a, b) => b.daysAgo - a.daysAgo || a.shift.workDate.localeCompare(b.shift.workDate));
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
