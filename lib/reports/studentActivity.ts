"use client";

/**
 * RAPPORT D'ACTIVITÉ D'UN ÉLÈVE, sur une période et une sélection d'emplois
 * du temps.
 *
 * Deux moitiés qui ne se mélangent pas :
 *  - l'argent qui ENTRE (versements, recharges, règlements de dette) — il
 *    n'appartient à aucun cours, il alimente le solde ;
 *  - ce que chaque EMPLOI DU TEMPS a coûté (présences débitées, absences
 *    facturées), créneau par créneau, avec ce qui en reste à payer.
 *
 * DÉSINSCRIRE N'EFFACE RIEN
 * -------------------------
 * Désinscrire un élève d'un emploi du temps retire son inscription, pas son
 * passé : ses présences, ses absences facturées et ses débits restent en base.
 * Le rapport ne partait pourtant que des inscriptions du jour — un cours quitté
 * disparaissait du rapport avec tout ce qu'il avait coûté. Les emplois du temps
 * se lisent donc ici depuis l'HISTORIQUE autant que depuis les inscriptions :
 *  - « inscrit » : il y est inscrit aujourd'hui ;
 *  - « désinscrit » : il n'y est plus, mais il y a une présence, une absence
 *    ou un débit ;
 *  - « supprimé » : le créneau lui-même n'existe plus, seul l'argent pris en
 *    garde la trace.
 *
 * Le calcul est une fonction pure partagée par l'écran et le document imprimé :
 * ce qu'on voit est exactement ce qu'on imprime.
 */

import type {
  AbsencePenalty,
  AttendanceRecord,
  AttendanceStatus,
  BalanceTransaction,
  BalanceTxType,
  Group,
  Module,
  Parent,
  Salle,
  ScheduleSession,
  School,
  SchoolClass,
  Student,
  Subscription,
  Teacher,
} from "@/lib/types";
import type { Language } from "@/lib/store/settings";
import { chargesWithoutPresence, isSeanceCharge, pairAbsenceLines } from "@/lib/studentRepair";
import { discountLabel, formatDays, netPriceFor, schoolDateKey } from "@/lib/helpers";
import {
  bannerHtml,
  escapeHtml,
  fmtDate,
  fmtDateTime,
  letterheadHtml,
  metaFooterHtml,
  printDocument,
  signaturesHtml,
} from "@/lib/printTemplates";

export type ReportPeriod =
  | { mode: "all" }
  | { mode: "month"; year: number; month: number } // month: 1..12
  | { mode: "range"; start: string; end: string }; // YYYY-MM-DD

export const MONTHS_FR = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];
const MONTHS_AR = [
  "جانفي",
  "فيفري",
  "مارس",
  "أفريل",
  "ماي",
  "جوان",
  "جويلية",
  "أوت",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

/** Bornes [start, end] de la période, en heure locale ; null = sans borne. */
export function periodBounds(p: ReportPeriod): { start: Date | null; end: Date | null } {
  if (p.mode === "month") {
    return {
      start: new Date(p.year, p.month - 1, 1, 0, 0, 0, 0),
      end: new Date(p.year, p.month, 0, 23, 59, 59, 999),
    };
  }
  if (p.mode === "range") {
    return {
      start: p.start ? new Date(`${p.start}T00:00:00`) : null,
      end: p.end ? new Date(`${p.end}T23:59:59.999`) : null,
    };
  }
  return { start: null, end: null };
}

export function periodLabel(p: ReportPeriod, lang: Language): string {
  const ar = lang === "ar";
  if (p.mode === "month") return `${(ar ? MONTHS_AR : MONTHS_FR)[p.month - 1]} ${p.year}`;
  if (p.mode === "range") {
    const s = p.start ? fmtDate(p.start, lang) : ar ? "البداية" : "le début";
    const e = p.end ? fmtDate(p.end, lang) : ar ? "اليوم" : "aujourd'hui";
    return ar ? `من ${s} إلى ${e}` : `Du ${s} au ${e}`;
  }
  return ar ? "كل الفترات" : "Toute la période";
}

export interface ReportPayment {
  id: string;
  date: string;
  type: BalanceTxType;
  description: string;
  amount: number;
}

export interface ReportLine {
  id: string;
  kind: "presence" | "absence" | "penalty";
  /** ISO date-time (présence) ou fin de semaine (absence facturée) */
  date: string;
  status?: AttendanceStatus;
  group?: string;
  time?: string;
  /** semaine facturée (absence hebdomadaire) */
  weekStart?: string;
  weekEnd?: string;
  cost: number;
  /** séance offerte : montant non facturé et raison lisible */
  waived?: number;
  free?: boolean;
  substitute?: boolean;
  /** séance débitée dont la présence a disparu avec son emploi du temps
   *  (supprimé depuis) : l'argent a été pris, la ligne reste au rapport */
  deletedSlot?: boolean;
  /** part de ce débit que les versements n'ont pas encore couverte (dette) */
  unpaid?: number;
}

/** Où en est l'élève avec un emploi du temps. */
export type TimetableStatus = "current" | "left" | "deleted";

/** Un emploi du temps que l'élève suit, ou a suivi. */
export interface StudentTimetable {
  /** l'id du créneau ; `module:<id>` quand le créneau a été supprimé */
  key: string;
  sessionId?: string;
  moduleId?: string;
  status: TimetableStatus;
  /** créneau « séance libre » */
  isOpen?: boolean;
  /** la matière (ou le titre d'une séance libre) */
  name: string;
  className?: string;
  group?: string;
  teacher?: string;
  salle?: string;
  days?: string;
  time?: string;
  /** tarif d'une séance (inscriptions en cours seulement) */
  price?: number;
  /** ce que l'élève paie la séance, réduction comprise */
  netPrice?: number;
  /** « -20% », « -200 DA » */
  discount?: string;
  /** formation : prix du niveau et durée */
  levelPrice?: number;
  periodMonths?: number;
  subscribedAt?: string;
  startDate?: string;
  expiryDate?: string;
}

export interface ReportTimetable extends StudentTimetable {
  presences: number;
  late: number;
  absences: number;
  totalCost: number;
  /** ce qui reste dû AUJOURD'HUI sur cet emploi du temps (toutes périodes) */
  unpaid: number;
  /** première et dernière séance (ou absence) connues, toutes périodes */
  firstDate?: string;
  lastDate?: string;
  lines: ReportLine[];
}

export interface StudentReport {
  payments: ReportPayment[];
  totalPayments: number;
  timetables: ReportTimetable[];
  totalCost: number;
  /** dette des séances : somme des `unpaid` + `otherUnpaid` */
  unpaidTotal: number;
  /** débits non couverts qui n'appartiennent à aucun emploi du temps
   *  (frais d'inscription pris sur le solde, débit manuel sans matière) */
  otherUnpaid: number;
}

/** Ce que le rapport lit dans le store. */
export interface StudentReportData {
  student: Student;
  balanceTx: BalanceTransaction[];
  attendance: AttendanceRecord[];
  absencePenalties: AbsencePenalty[];
  sessions: ScheduleSession[];
  subscriptions: Subscription[];
  modules: Module[];
  groups: Group[];
  classes?: SchoolClass[];
  teachers?: Teacher[];
  salles?: Salle[];
}

/** Une ligne de l'historique, rangée sous son emploi du temps. */
interface PlacedLine {
  key: string;
  line: ReportLine;
}

interface StudentHistory {
  timetables: Map<string, StudentTimetable>;
  lines: PlacedLine[];
  /** ce qui reste dû, par emploi du temps */
  unpaidByKey: Map<string, number>;
  otherUnpaid: number;
}

const byDateThenId = (a: BalanceTransaction, b: BalanceTransaction) =>
  a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

/**
 * Ce qui reste à payer de chaque débit.
 *
 * Les versements paient les débits dans l'ordre où ils sont arrivés : un
 * versement règle d'abord la plus ancienne séance non payée, et l'excédent
 * reste en crédit pour les suivantes. Ce qui n'est couvert par rien est la
 * dette — sa somme vaut exactement le solde négatif de l'historique.
 */
export function unpaidCharges(txs: BalanceTransaction[]): Map<string, number> {
  let credit = 0;
  const queue: Array<{ id: string; left: number }> = [];
  for (const tx of [...txs].sort(byDateThenId)) {
    if (tx.amount > 0) {
      let c = tx.amount;
      while (c > 0 && queue.length > 0) {
        const head = queue[0];
        const pay = Math.min(c, head.left);
        head.left -= pay;
        c -= pay;
        if (head.left === 0) queue.shift();
      }
      credit += c;
    } else if (tx.amount < 0) {
      let d = -tx.amount;
      const used = Math.min(credit, d);
      credit -= used;
      d -= used;
      if (d > 0) queue.push({ id: tx.id, left: d });
    }
  }
  return new Map(queue.map((q) => [q.id, q.left]));
}

/** Tout l'historique d'un élève, rangé par emploi du temps — toutes périodes. */
function studentHistoryOf(data: StudentReportData): StudentHistory {
  const { student } = data;
  const sid = student.id;
  const sessionById = new Map(data.sessions.map((s) => [s.id, s]));
  const subById = new Map(data.subscriptions.map((s) => [s.id, s]));
  const moduleName = (id?: string) => (id ? data.modules.find((m) => m.id === id)?.name : undefined);
  const groupName = (id?: string) => (id ? data.groups.find((g) => g.id === id)?.name : undefined);

  const myAtt = data.attendance.filter((a) => a.studentId === sid);
  const myPen = data.absencePenalties.filter((p) => p.studentId === sid);
  const myTx = data.balanceTx.filter((t) => t.studentId === sid);

  // ---- Les emplois du temps ---------------------------------------------------
  const timetables = new Map<string, StudentTimetable>();

  const describe = (s: ScheduleSession, status: TimetableStatus): StudentTimetable => {
    const cls = data.classes?.find((c) => c.id === s.classId);
    const extraClasses = (s.classIds ?? []).filter((id) => id !== s.classId).length;
    const teacher = data.teachers?.find((t) => t.id === s.teacherId);
    return {
      key: s.id,
      sessionId: s.id,
      moduleId: s.moduleId,
      status,
      isOpen: s.isOpen || undefined,
      name: (s.isOpen && s.title) || moduleName(s.moduleId) || "Matière",
      className: cls ? `${cls.name}${extraClasses > 0 ? ` +${extraClasses}` : ""}` : undefined,
      group: groupName(s.groupId),
      teacher: teacher ? `${teacher.firstName} ${teacher.lastName}` : undefined,
      salle: data.salles?.find((x) => x.id === s.salleId)?.name,
      days: formatDays(s.days) || undefined,
      time: `${s.startTime}-${s.endTime}`,
    };
  };

  // 1. Les inscriptions du jour (dans l'ordre de la fiche).
  for (const subId of student.subscriptionIds) {
    const sub = subById.get(subId);
    const s = sub ? sessionById.get(sub.sessionId) : undefined;
    if (!sub || !s || timetables.has(s.id)) continue;
    const t = describe(s, "current");
    const discount = student.subscriptionDiscounts?.[subId];
    const dates = student.subscriptionDates?.[subId];
    t.price = sub.pricePerSession;
    t.netPrice = netPriceFor(sub.pricePerSession, discount);
    t.discount = discountLabel(discount) || undefined;
    if (sub.levelPrice || sub.periodMonths) {
      t.levelPrice = sub.levelPrice;
      t.periodMonths = sub.periodMonths;
    }
    t.subscribedAt = dates?.subscribedAt;
    t.startDate = dates?.startDate;
    t.expiryDate = dates?.expiryDate;
    timetables.set(s.id, t);
  }

  // 2. L'historique : un créneau où il a une trace et où il n'est plus inscrit.
  const ensureSession = (sessionId: string): string | null => {
    if (timetables.has(sessionId)) return sessionId;
    const s = sessionById.get(sessionId);
    if (!s) return null;
    timetables.set(sessionId, describe(s, "left"));
    return sessionId;
  };
  const ensureDeleted = (moduleId?: string): string => {
    const key = `module:${moduleId ?? "?"}`;
    if (!timetables.has(key)) {
      timetables.set(key, {
        key,
        moduleId,
        status: "deleted",
        name: moduleName(moduleId) ?? "Matière inconnue",
      });
    }
    return key;
  };
  /** Un débit rattaché à une matière seulement : l'emploi du temps de cette
   *  matière (celui en cours d'abord), sinon la trace « supprimé ». */
  const keyOfModule = (moduleId?: string): string => {
    const known = [...timetables.values()].filter((t) => t.sessionId && t.moduleId === moduleId);
    const current = known.find((t) => t.status === "current");
    return (current ?? known[0])?.key ?? ensureDeleted(moduleId);
  };

  // ---- Les lignes -------------------------------------------------------------
  const lines: PlacedLine[] = [];
  const attLine = new Map<string, ReportLine>();
  for (const att of myAtt) {
    const s = sessionById.get(att.sessionId);
    const key = ensureSession(att.sessionId) ?? ensureDeleted(undefined);
    const absent = att.status === "absent";
    const line: ReportLine = {
      id: att.id,
      kind: absent ? "absence" : "presence",
      date: att.timestamp,
      status: att.status,
      group: groupName(s?.groupId),
      time: s ? `${s.startTime}-${s.endTime}` : undefined,
      cost: att.amountDeducted,
      waived: att.waivedAmount,
      free: att.amountDeducted === 0 && !absent,
      substitute: att.substituteGroup,
    };
    attLine.set(att.id, line);
    lines.push({ key, line });
  }

  // Les séances PAYÉES dont la présence n'existe plus : l'emploi du temps a
  // été supprimé et ses présences avec lui, mais le débit est resté au solde.
  // Sans elles, le rapport taisait une séance que l'élève a bel et bien suivie.
  const orphans = chargesWithoutPresence({
    studentId: sid,
    balanceTx: myTx,
    attendance: myAtt,
    sessions: data.sessions,
  });
  const txLine = new Map<string, ReportLine>();
  for (const tx of orphans) {
    // « Séance science (B) (16:00-18:00) » : le groupe et l'horaire d'alors.
    const m = tx.description.match(/\(([^()]+)\)\s*\((\d{1,2}:\d{2}-\d{1,2}:\d{2})\)/);
    const line: ReportLine = {
      id: tx.id,
      kind: "presence",
      date: tx.date,
      status: "present",
      group: m?.[1],
      time: m?.[2],
      cost: -tx.amount,
      deletedSlot: true,
    };
    txLine.set(tx.id, line);
    lines.push({ key: ensureDeleted(tx.moduleId), line });
  }

  const penLine = new Map<string, ReportLine>();
  for (const pen of myPen) {
    const fromSub = pen.subscriptionId ? subById.get(pen.subscriptionId)?.sessionId : undefined;
    const key =
      (pen.sessionId && ensureSession(pen.sessionId)) ||
      (fromSub && ensureSession(fromSub)) ||
      ensureDeleted(pen.moduleId);
    const s = pen.sessionId ? sessionById.get(pen.sessionId) : undefined;
    const line: ReportLine = {
      id: pen.id,
      kind: "penalty",
      date: `${pen.periodEnd}T12:00:00`,
      group: groupName(s?.groupId),
      weekStart: pen.periodStart,
      weekEnd: pen.periodEnd,
      cost: pen.amount,
    };
    penLine.set(pen.id, line);
    lines.push({ key, line });
  }

  // ---- Ce qui reste à payer, débit par débit -----------------------------------
  const unpaid = unpaidCharges(myTx);
  const unpaidByKey = new Map<string, number>();
  let otherUnpaid = 0;
  if (unpaid.size > 0) {
    // Débit d'absence → SON absence (même appariement que la réparation).
    const groupOfPen = (pen: AbsencePenalty) => {
      const s = pen.sessionId ? sessionById.get(pen.sessionId) : undefined;
      return groupName(s?.groupId);
    };
    const penOfTx = new Map<string, string>();
    for (const [penId, txId] of pairAbsenceLines(myPen, myTx, groupOfPen)) penOfTx.set(txId, penId);

    // Débit de séance → une présence facturée de ce jour-là sur cette matière.
    const billedAtt = new Map<string, AttendanceRecord[]>();
    for (const a of myAtt) {
      if (a.amountDeducted <= 0) continue;
      const s = sessionById.get(a.sessionId);
      if (!s) continue;
      const k = `${schoolDateKey(a.timestamp)}|${s.moduleId}`;
      billedAtt.set(k, [...(billedAtt.get(k) ?? []), a]);
    }
    const lineOfCharge = (tx: BalanceTransaction): ReportLine | undefined => {
      const orphan = txLine.get(tx.id);
      if (orphan) return orphan;
      const penId = penOfTx.get(tx.id);
      if (penId) return penLine.get(penId);
      if (!isSeanceCharge(tx)) return undefined;
      const pool = billedAtt.get(`${schoolDateKey(tx.date)}|${tx.moduleId}`);
      if (!pool || pool.length === 0) return undefined;
      // Le même montant d'abord : deux groupes du même cours le même jour.
      const i = Math.max(0, pool.findIndex((a) => a.amountDeducted === -tx.amount));
      const [att] = pool.splice(i, 1);
      return attLine.get(att.id);
    };

    const keyOfLine = new Map<ReportLine, string>(lines.map((p) => [p.line, p.key]));
    for (const tx of [...myTx].sort(byDateThenId)) {
      if (tx.amount >= 0) continue;
      const line = lineOfCharge(tx);
      const left = unpaid.get(tx.id);
      if (!left) continue;
      const key = line ? keyOfLine.get(line) : tx.moduleId ? keyOfModule(tx.moduleId) : undefined;
      if (line) line.unpaid = (line.unpaid ?? 0) + left;
      if (key) unpaidByKey.set(key, (unpaidByKey.get(key) ?? 0) + left);
      else otherUnpaid += left;
    }
  }

  return { timetables, lines, unpaidByKey, otherUnpaid };
}

const STATUS_ORDER: Record<TimetableStatus, number> = { current: 0, left: 1, deleted: 2 };

/**
 * Les emplois du temps de l'élève : ceux où il est inscrit, puis ceux qu'il a
 * quittés (ou dont le créneau a été supprimé) et dont l'historique garde une
 * trace. C'est la liste que le rapport propose de cocher.
 */
export function studentTimetablesOf(data: StudentReportData): StudentTimetable[] {
  const history = studentHistoryOf(data);
  const last = new Map<string, string>();
  for (const { key, line } of history.lines) {
    if ((last.get(key) ?? "") < line.date) last.set(key, line.date);
  }
  const order = [...history.timetables.keys()];
  return [...history.timetables.values()].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      // Inscrits : l'ordre de la fiche. Quittés : le plus récent d'abord.
      (a.status === "current"
        ? order.indexOf(a.key) - order.indexOf(b.key)
        : (last.get(b.key) ?? "").localeCompare(last.get(a.key) ?? "")),
  );
}

export function computeStudentReport(
  input: StudentReportData & {
    period: ReportPeriod;
    /** emplois du temps retenus (`StudentTimetable.key`), dans l'ordre voulu */
    timetableKeys: string[];
  },
): StudentReport {
  const { start, end } = periodBounds(input.period);
  const inPeriod = (d: Date) => (!start || d >= start) && (!end || d <= end);
  const sid = input.student.id;

  // ---- L'argent qui entre --------------------------------------------------------
  const payments: ReportPayment[] = input.balanceTx
    .filter((t) => t.studentId === sid && t.amount > 0 && t.type !== "deduction")
    .filter((t) => inPeriod(new Date(t.date)))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => ({ id: t.id, date: t.date, type: t.type, description: t.description, amount: t.amount }));
  const totalPayments = payments.reduce((s, p) => s + p.amount, 0);

  // ---- Ce que chaque emploi du temps a coûté -------------------------------------
  const history = studentHistoryOf(input);
  const byKey = new Map<string, ReportTimetable>();
  for (const key of input.timetableKeys) {
    const t = history.timetables.get(key);
    if (!t) continue;
    byKey.set(key, {
      ...t,
      presences: 0,
      late: 0,
      absences: 0,
      totalCost: 0,
      unpaid: history.unpaidByKey.get(key) ?? 0,
      lines: [],
    });
  }

  for (const { key, line } of history.lines) {
    const t = byKey.get(key);
    if (!t) continue;
    if (!t.firstDate || line.date < t.firstDate) t.firstDate = line.date;
    if (!t.lastDate || line.date > t.lastDate) t.lastDate = line.date;
    if (!inPeriod(new Date(line.date))) continue;
    if (line.kind === "presence") t.presences++;
    else t.absences++;
    if (line.status === "late") t.late++;
    t.totalCost += line.cost;
    t.lines.push(line);
  }

  const timetables = [...byKey.values()];
  for (const t of timetables) t.lines.sort((a, b) => a.date.localeCompare(b.date));
  const totalCost = timetables.reduce((s, t) => s + t.totalCost, 0);
  // La dette est celle d'AUJOURD'HUI, tous emplois du temps confondus.
  let unpaidTotal = history.otherUnpaid;
  for (const v of history.unpaidByKey.values()) unpaidTotal += v;

  return { payments, totalPayments, timetables, totalCost, unpaidTotal, otherUnpaid: history.otherUnpaid };
}

// =============================================================================
// Document imprimable
// =============================================================================

const LABELS = {
  fr: {
    docTitle: "Rapport Détaillé de l'Élève",
    studentInfo: "Informations de l'Élève",
    fullName: "Nom complet :",
    card: "N° Carte / RFID :",
    phone: "Téléphone :",
    parent: "Parent / Tuteur :",
    subjects: "Emplois du temps du rapport :",
    period: "Période :",
    totalPayments: "Total versé",
    totalCost: "Total consommé",
    periodNet: "Solde de la période",
    debt: "Dette actuelle",
    balance: "Solde actuel",
    costOf: "Coût",
    paymentsTitle: "Paiements & Recharges du Solde",
    date: "Date",
    designation: "Désignation",
    type: "Type",
    amount: "Montant",
    noPayments: "Aucun paiement sur cette période.",
    presences: "Présences",
    late: "Retards",
    absences: "Absences",
    group: "Groupe",
    schedule: "Horaire",
    status: "Statut",
    cost: "Coût",
    present: "Présent",
    lateS: "En retard",
    absent: "Absent",
    penalty: "Absence facturée",
    week: (s: string, e: string) => `Semaine du ${s} au ${e}`,
    offered: "Offerte",
    substitute: "Autre groupe",
    deletedSlot: "Emploi du temps supprimé",
    noLines: "Aucune présence ni absence sur cette période.",
    subtotal: "Sous-total",
    summaryTitle: "Récapitulatif",
    printedOn: "Imprimé le :",
    signParent: "Signature du Parent / Élève",
    signSchool: "Cachet & Signature de l'École",
    da: "DA",
    tx: { topup: "Versement", debt_payment: "Règl. dette", registration: "Inscription", deduction: "Débit" },
    currentTitle: "Emplois du temps actuels",
    pastTitle: "Emplois du temps quittés — historique conservé",
    statusLabel: { current: "Inscrit", left: "Désinscrit", deleted: "Emploi du temps supprimé" },
    openSeance: "Séance libre",
    classe: "Classe",
    teacher: "Enseignant",
    salle: "Salle",
    days: "Jours",
    tariff: "Tarif",
    perSeance: "/ séance",
    formation: (price: number, months: number) => `Formation : ${price} DA / ${months} mois`,
    subscribedAt: "Inscrit le",
    startDate: "Début de facturation",
    expiryDate: "Fin",
    activity: "Activité",
    fromTo: (s: string, e: string) => `du ${s} au ${e}`,
    noActivity: "Aucune séance enregistrée",
    unpaid: "Reste dû",
    unpaidLine: "Impayé",
    otherUnpaid: "Autres débits non réglés (sans emploi du temps)",
    registrationDue: "Frais d'inscription dus",
  },
  ar: {
    docTitle: "تقرير مفصل للتلميذ",
    studentInfo: "معلومات التلميذ",
    fullName: "الاسم الكامل :",
    card: "رقم البطاقة :",
    phone: "الهاتف :",
    parent: "الولي :",
    subjects: "استعمالات الزمن في التقرير :",
    period: "الفترة :",
    totalPayments: "إجمالي المدفوع",
    totalCost: "إجمالي المستهلك",
    periodNet: "رصيد الفترة",
    debt: "الدين الحالي",
    balance: "الرصيد الحالي",
    costOf: "تكلفة",
    paymentsTitle: "المدفوعات وتعبئة الرصيد",
    date: "التاريخ",
    designation: "البيان",
    type: "النوع",
    amount: "المبلغ",
    noPayments: "لا توجد مدفوعات في هذه الفترة.",
    presences: "الحضور",
    late: "التأخر",
    absences: "الغياب",
    group: "الفوج",
    schedule: "التوقيت",
    status: "الحالة",
    cost: "التكلفة",
    present: "حاضر",
    lateS: "متأخر",
    absent: "غائب",
    penalty: "غياب مفوتر",
    week: (s: string, e: string) => `أسبوع ${s} - ${e}`,
    offered: "مجانية",
    substitute: "فوج آخر",
    deletedSlot: "استعمال زمن محذوف",
    noLines: "لا يوجد حضور أو غياب في هذه الفترة.",
    subtotal: "المجموع الجزئي",
    summaryTitle: "الملخص",
    printedOn: "تاريخ الطباعة :",
    signParent: "إمضاء الولي / التلميذ",
    signSchool: "ختم وإمضاء المدرسة",
    da: "دج",
    tx: { topup: "دفع", debt_payment: "تسديد دين", registration: "تسجيل", deduction: "خصم" },
    currentTitle: "استعمالات الزمن الحالية",
    pastTitle: "استعمالات زمن سابقة — السجل محفوظ",
    statusLabel: { current: "مسجل", left: "ألغي تسجيله", deleted: "استعمال زمن محذوف" },
    openSeance: "حصة حرة",
    classe: "القسم",
    teacher: "الأستاذ",
    salle: "القاعة",
    days: "الأيام",
    tariff: "السعر",
    perSeance: "/ حصة",
    formation: (price: number, months: number) => `تكوين : ${price} دج / ${months} أشهر`,
    subscribedAt: "تاريخ التسجيل",
    startDate: "بداية الفوترة",
    expiryDate: "النهاية",
    activity: "النشاط",
    fromTo: (s: string, e: string) => `من ${s} إلى ${e}`,
    noActivity: "لا توجد حصص مسجلة",
    unpaid: "المتبقي",
    unpaidLine: "غير مدفوع",
    otherUnpaid: "اقتطاعات أخرى غير مسددة (بدون استعمال زمن)",
    registrationDue: "حقوق التسجيل المستحقة",
  },
} as const;

const REPORT_CSS = `
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
  .kpi { background: #fff; border: 1px solid #e8e6f4; border-radius: 12px; padding: 10px 12px; }
  .kpi span { display: block; font-size: 0.72em; text-transform: uppercase; color: #5c567a; font-weight: 700; letter-spacing: 0.3px; }
  .kpi strong { display: block; font-size: 1.25em; margin-top: 3px; font-family: monospace; }
  .kpi.green { border-top: 4px solid #22c55e; } .kpi.green strong { color: #15803d; }
  .kpi.red { border-top: 4px solid #ef4444; } .kpi.red strong { color: #b91c1c; }
  .kpi.violet { border-top: 4px solid #7c3aed; } .kpi.violet strong { color: #5b21b6; }
  .kpi.amber { border-top: 4px solid #eab308; } .kpi.amber strong { color: #854d0e; }
  .mod-kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; margin-bottom: 20px; }
  .mod-kpi { border: 1px solid #e8e6f4; border-inline-start: 4px solid #7c3aed; border-radius: 10px; padding: 8px 10px; background: #fff; }
  .mod-kpi.past { border-inline-start-color: #94a3b8; background: #f8fafc; }
  .mod-kpi b { display: block; font-size: 0.85em; }
  .mod-kpi small { display: block; color: #5c567a; font-size: 0.72em; }
  .mod-kpi .c { float: inline-end; font-family: monospace; font-weight: 800; color: #b91c1c; }
  .module-frame { margin-top: 16px; page-break-inside: auto; }
  .module-frame.past { border-style: dashed; }
  .module-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .module-head .stats { font-size: 0.8em; color: #5c567a; }
  .tt-details { width: 100%; margin: 8px 0 4px; font-size: 0.82em; }
  .tt-details td { padding: 3px 6px; border: 0; }
  .tt-details td.k { color: #5c567a; font-weight: 700; width: 16%; }
  .subtotal td { background: #fcfbff; font-weight: 800; }
  .section-title { margin: 22px 0 8px; font-size: 1.05em; color: #5b21b6; font-weight: 800; }
  .section-title.past { color: #475569; }
`;

export function buildStudentActivityReport(data: {
  student: Student;
  school: School;
  lang: Language;
  period: ReportPeriod;
  report: StudentReport;
  debtTotal: number;
  parents: Parent[];
}): string {
  const { student, school, lang, report } = data;
  const L = LABELS[lang];
  const e = escapeHtml;
  const parent = data.parents.find((p) => p.id === student.parentId);
  const net = report.totalPayments - report.totalCost;
  const money = (n: number) => `${n} ${L.da}`;
  // Un horodatage (avec fuseau) se lit au jour de l'ÉCOLE ; une date ou une
  // fin de semaine d'absence (« …T12:00:00 », sans fuseau) telle quelle.
  const day = (iso?: string) =>
    iso ? fmtDate(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? schoolDateKey(iso) : iso.slice(0, 10), lang) : "-";
  const current = report.timetables.filter((t) => t.status === "current");
  const past = report.timetables.filter((t) => t.status !== "current");

  const statusBadge = (line: ReportLine) => {
    if (line.kind === "penalty") return `<span class="badge badge-danger">${L.penalty}</span>`;
    if (line.status === "absent") return `<span class="badge badge-danger">${L.absent}</span>`;
    if (line.status === "late") return `<span class="badge badge-warning">${L.lateS}</span>`;
    return `<span class="badge badge-success">${L.present}</span>`;
  };

  const timetableBadge = (t: ReportTimetable) => {
    const tone = t.status === "current" ? "badge-success" : t.status === "left" ? "badge-warning" : "badge-danger";
    return `<span class="badge ${tone}">${L.statusLabel[t.status]}</span>${
      t.isOpen ? ` <span class="badge badge-primary">${L.openSeance}</span>` : ""
    }`;
  };

  const titleOf = (t: ReportTimetable) => [t.name, t.className, t.group].filter(Boolean).join(" · ");

  /** Les détails du créneau : qui, où, quand, à quel prix, depuis quand. */
  const detailsHtml = (t: ReportTimetable) => {
    const cells: Array<[string, string]> = [];
    if (t.className) cells.push([L.classe, e(t.className)]);
    if (t.group) cells.push([L.group, e(t.group)]);
    if (t.teacher) cells.push([L.teacher, e(t.teacher)]);
    if (t.salle) cells.push([L.salle, e(t.salle)]);
    if (t.days || t.time) cells.push([L.days, e([t.days, t.time].filter(Boolean).join(" · "))]);
    if (t.levelPrice || t.periodMonths) {
      cells.push([L.tariff, e(L.formation(t.levelPrice ?? 0, t.periodMonths ?? 0))]);
    } else if (t.price !== undefined) {
      const discounted = t.netPrice !== undefined && t.netPrice !== t.price;
      cells.push([
        L.tariff,
        `${money(t.netPrice ?? t.price)} ${L.perSeance}${discounted ? ` (${money(t.price)} ${e(t.discount ?? "")})` : ""}`,
      ]);
    }
    if (t.subscribedAt) cells.push([L.subscribedAt, day(t.subscribedAt)]);
    if (t.startDate) cells.push([L.startDate, day(t.startDate)]);
    if (t.expiryDate) cells.push([L.expiryDate, day(t.expiryDate)]);
    cells.push([L.activity, t.firstDate ? L.fromTo(day(t.firstDate), day(t.lastDate)) : L.noActivity]);
    const rows: string[] = [];
    for (let i = 0; i < cells.length; i += 3) {
      rows.push(
        `<tr>${cells
          .slice(i, i + 3)
          .map(([k, v]) => `<td class="k">${k}</td><td>${v}</td>`)
          .join("")}</tr>`,
      );
    }
    return `<table class="tt-details">${rows.join("")}</table>`;
  };

  const timetableHtml = (t: ReportTimetable) => `
    <div class="frame module-frame ${t.status === "current" ? "" : "past"}">
      <div class="module-head">
        <h3 style="border:0; margin:0;">📘 ${e(titleOf(t))} ${timetableBadge(t)}</h3>
        <span class="stats">${L.presences}: <b>${t.presences}</b> · ${L.late}: <b>${t.late}</b> · ${L.absences}: <b>${t.absences}</b></span>
      </div>
      ${detailsHtml(t)}
      <table>
        <thead><tr>
          <th>${L.date}</th><th>${L.group}</th><th>${L.schedule}</th><th class="ctr">${L.status}</th><th class="num">${L.cost}</th>
        </tr></thead>
        <tbody>
          ${
            t.lines.length === 0
              ? `<tr><td colspan="5" style="text-align:center; font-style:italic; color:#999;">${L.noLines}</td></tr>`
              : t.lines
                  .map(
                    (l) => `<tr>
              <td>${l.kind === "penalty" ? L.week(fmtDate(l.weekStart, lang), fmtDate(l.weekEnd, lang)) : fmtDateTime(l.date, lang)}</td>
              <td>${e(l.group ?? "-")}${l.substitute ? ` <span class="badge badge-primary">${L.substitute}</span>` : ""}${
                l.deletedSlot ? ` <span class="badge badge-warning">${L.deletedSlot}</span>` : ""
              }</td>
              <td>${l.time ?? "-"}</td>
              <td class="ctr">${statusBadge(l)}${l.unpaid ? ` <span class="badge badge-danger">${L.unpaidLine} ${money(l.unpaid)}</span>` : ""}</td>
              <td class="num" style="color:${l.cost > 0 ? "#b91c1c" : "#15803d"};">${
                l.cost > 0 ? `-${money(l.cost)}` : l.free ? `${L.offered}${l.waived ? ` (${money(l.waived)})` : ""}` : money(0)
              }</td>
            </tr>`,
                  )
                  .join("")
          }
          <tr class="subtotal"><td colspan="4">${L.subtotal} — ${e(t.name)}</td><td class="num" style="color:#b91c1c;">-${money(t.totalCost)}</td></tr>
          ${
            t.unpaid > 0
              ? `<tr class="subtotal"><td colspan="4" style="color:#b91c1c;">${L.unpaid} — ${e(t.name)}</td><td class="num" style="color:#b91c1c;">${money(t.unpaid)}</td></tr>`
              : ""
          }
        </tbody>
      </table>
    </div>`;

  const kpiHtml = (t: ReportTimetable) =>
    `<div class="mod-kpi ${t.status === "current" ? "" : "past"}"><span class="c">${money(t.totalCost)}</span><b>${e(titleOf(t))}</b>
      <small>${L.statusLabel[t.status]} · ${L.presences} ${t.presences} · ${L.absences} ${t.absences}</small>
      ${t.unpaid > 0 ? `<small style="color:#b91c1c; font-weight:700;">${L.unpaid} : ${money(t.unpaid)}</small>` : ""}</div>`;

  const bodyHtml = `
    ${letterheadHtml(school)}
    ${bannerHtml(L.docTitle, `${L.period} <strong>${periodLabel(data.period, lang)}</strong>`)}

    <div class="frame frame-info" style="margin-bottom:20px;">
      <h3>${L.studentInfo}</h3>
      <table style="margin-top:0;">
        <tr>
          <td style="width:18%; font-weight:bold; color:#5c567a;">${L.fullName}</td>
          <td style="width:32%; font-weight:bold; font-size:1.1em;">${e(student.lastName)} ${e(student.firstName)}</td>
          <td style="width:18%; font-weight:bold; color:#5c567a;">${L.card}</td>
          <td style="width:32%; font-family:monospace;">${e(student.rfid || "-")}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; color:#5c567a;">${L.phone}</td>
          <td style="font-family:monospace;">${e(student.phone || "-")}</td>
          <td style="font-weight:bold; color:#5c567a;">${L.parent}</td>
          <td>${parent ? `${e(parent.lastName)} ${e(parent.firstName)} (${e(parent.phone || "-")})` : "-"}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; color:#5c567a;">${L.subjects}</td>
          <td colspan="3">${report.timetables.map((t) => `${e(titleOf(t))} (${L.statusLabel[t.status]})`).join(" · ") || "-"}</td>
        </tr>
      </table>
    </div>

    <div class="kpis">
      <div class="kpi green"><span>${L.totalPayments}</span><strong>${money(report.totalPayments)}</strong></div>
      <div class="kpi red"><span>${L.totalCost}</span><strong>${money(report.totalCost)}</strong></div>
      <div class="kpi violet"><span>${L.periodNet}</span><strong>${net > 0 ? "+" : ""}${money(net)}</strong></div>
      <div class="kpi ${data.debtTotal > 0 ? "red" : "amber"}"><span>${L.debt}</span><strong>${money(data.debtTotal)}</strong></div>
    </div>

    <div class="mod-kpis">${report.timetables.map(kpiHtml).join("")}</div>

    <div class="frame frame-success">
      <h3>💰 ${L.paymentsTitle}</h3>
      <table>
        <thead><tr><th>${L.date}</th><th>${L.designation}</th><th class="ctr">${L.type}</th><th class="num">${L.amount}</th></tr></thead>
        <tbody>
          ${
            report.payments.length === 0
              ? `<tr><td colspan="4" style="text-align:center; font-style:italic; color:#999;">${L.noPayments}</td></tr>`
              : report.payments
                  .map(
                    (p) => `<tr>
              <td>${fmtDateTime(p.date, lang)}</td>
              <td>${e(p.description)}</td>
              <td class="ctr"><span class="badge badge-success">${L.tx[p.type]}</span></td>
              <td class="num" style="color:#15803d;">+${money(p.amount)}</td>
            </tr>`,
                  )
                  .join("")
          }
          <tr class="subtotal"><td colspan="3">${L.totalPayments}</td><td class="num" style="color:#15803d;">+${money(report.totalPayments)}</td></tr>
        </tbody>
      </table>
    </div>

    ${current.length > 0 ? `<div class="section-title">📗 ${L.currentTitle}</div>${current.map(timetableHtml).join("")}` : ""}
    ${past.length > 0 ? `<div class="section-title past">🗂️ ${L.pastTitle}</div>${past.map(timetableHtml).join("")}` : ""}

    <div class="summary-card">
      <h3>${L.summaryTitle}</h3>
      ${report.timetables
        .map(
          (t) =>
            `<div class="summary-line"><span>${L.costOf} — ${e(titleOf(t))} (${L.statusLabel[t.status]})</span><strong>-${money(t.totalCost)}${
              t.unpaid > 0 ? ` · ${L.unpaid} ${money(t.unpaid)}` : ""
            }</strong></div>`,
        )
        .join("")}
      <div class="summary-line" style="color:#b91c1c;"><span>${L.totalCost}</span><strong>-${money(report.totalCost)}</strong></div>
      <div class="summary-line" style="color:#15803d;"><span>${L.totalPayments}</span><strong>+${money(report.totalPayments)}</strong></div>
      ${
        report.otherUnpaid > 0
          ? `<div class="summary-line" style="color:#b91c1c;"><span>${L.otherUnpaid}</span><strong>${money(report.otherUnpaid)}</strong></div>`
          : ""
      }
      ${
        (student.registrationDue ?? 0) > 0
          ? `<div class="summary-line" style="color:#b91c1c;"><span>${L.registrationDue}</span><strong>${money(student.registrationDue ?? 0)}</strong></div>`
          : ""
      }
      <div class="summary-line"><span>${L.balance}</span><strong style="color:${student.balance < 0 ? "#b91c1c" : "#15803d"};">${money(student.balance)}</strong></div>
      <div class="summary-line"><span>${L.printedOn}</span><strong>${fmtDateTime(new Date().toISOString(), lang)}</strong></div>
      <div class="net-pay-box ${data.debtTotal > 0 ? "negative" : ""}">
        <span>${L.debt}</span>
        <span>${money(data.debtTotal)}</span>
      </div>
    </div>

    ${signaturesHtml(L.signParent, L.signSchool)}
    ${metaFooterHtml(school.name, lang)}
  `;

  return printDocument({
    title: `${L.docTitle} - ${student.firstName} ${student.lastName}`,
    lang,
    bodyHtml,
    extraCss: REPORT_CSS,
  });
}
