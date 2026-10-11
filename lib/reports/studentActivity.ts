"use client";

/**
 * RAPPORT D'ACTIVITÉ D'UN ÉLÈVE, sur une période et une sélection de matières.
 *
 * Deux moitiés qui ne se mélangent pas :
 *  - l'argent qui ENTRE (versements, recharges, règlements de dette) — il
 *    n'appartient à aucune matière, il alimente le solde ;
 *  - ce que chaque matière a COÛTÉ (présences débitées, absences facturées),
 *    matière par matière.
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
  ScheduleSession,
  School,
  Student,
} from "@/lib/types";
import type { Language } from "@/lib/store/settings";
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
}

export interface ReportModule {
  moduleId: string;
  name: string;
  presences: number;
  late: number;
  absences: number;
  totalCost: number;
  lines: ReportLine[];
}

export interface StudentReport {
  payments: ReportPayment[];
  totalPayments: number;
  modules: ReportModule[];
  totalCost: number;
}

export function computeStudentReport(input: {
  studentId: string;
  period: ReportPeriod;
  moduleIds: string[];
  balanceTx: BalanceTransaction[];
  attendance: AttendanceRecord[];
  absencePenalties: AbsencePenalty[];
  sessions: ScheduleSession[];
  modules: Module[];
  groups: Group[];
}): StudentReport {
  const { start, end } = periodBounds(input.period);
  const inPeriod = (d: Date) => (!start || d >= start) && (!end || d <= end);
  const sessionById = new Map(input.sessions.map((s) => [s.id, s]));
  const groupName = (id?: string) => (id ? input.groups.find((g) => g.id === id)?.name : undefined);

  // ---- L'argent qui entre --------------------------------------------------------
  const payments: ReportPayment[] = input.balanceTx
    .filter((t) => t.studentId === input.studentId && t.amount > 0 && t.type !== "deduction")
    .filter((t) => inPeriod(new Date(t.date)))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => ({ id: t.id, date: t.date, type: t.type, description: t.description, amount: t.amount }));
  const totalPayments = payments.reduce((s, p) => s + p.amount, 0);

  // ---- Ce que chaque matière a coûté ---------------------------------------------
  const byModule = new Map<string, ReportModule>();
  for (const id of input.moduleIds) {
    byModule.set(id, {
      moduleId: id,
      name: input.modules.find((m) => m.id === id)?.name ?? "Matière",
      presences: 0,
      late: 0,
      absences: 0,
      totalCost: 0,
      lines: [],
    });
  }

  for (const att of input.attendance) {
    if (att.studentId !== input.studentId) continue;
    const sess = sessionById.get(att.sessionId);
    const mod = sess ? byModule.get(sess.moduleId) : undefined;
    if (!mod || !inPeriod(new Date(att.timestamp))) continue;
    const absent = att.status === "absent";
    if (absent) mod.absences++;
    else mod.presences++;
    if (att.status === "late") mod.late++;
    mod.totalCost += att.amountDeducted;
    mod.lines.push({
      id: att.id,
      kind: absent ? "absence" : "presence",
      date: att.timestamp,
      status: att.status,
      group: groupName(sess?.groupId),
      time: sess ? `${sess.startTime}-${sess.endTime}` : undefined,
      cost: att.amountDeducted,
      waived: att.waivedAmount,
      free: att.amountDeducted === 0 && !absent,
      substitute: att.substituteGroup,
    });
  }

  for (const pen of input.absencePenalties) {
    if (pen.studentId !== input.studentId || !pen.moduleId) continue;
    const mod = byModule.get(pen.moduleId);
    if (!mod || !inPeriod(new Date(`${pen.periodEnd}T12:00:00`))) continue;
    const sess = pen.sessionId ? sessionById.get(pen.sessionId) : undefined;
    mod.absences++;
    mod.totalCost += pen.amount;
    mod.lines.push({
      id: pen.id,
      kind: "penalty",
      date: `${pen.periodEnd}T12:00:00`,
      group: groupName(sess?.groupId),
      weekStart: pen.periodStart,
      weekEnd: pen.periodEnd,
      cost: pen.amount,
    });
  }

  const modules = [...byModule.values()];
  for (const m of modules) m.lines.sort((a, b) => a.date.localeCompare(b.date));
  const totalCost = modules.reduce((s, m) => s + m.totalCost, 0);

  return { payments, totalPayments, modules, totalCost };
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
    subjects: "Matières du rapport :",
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
    noLines: "Aucune présence ni absence sur cette période.",
    subtotal: "Sous-total",
    summaryTitle: "Récapitulatif",
    printedOn: "Imprimé le :",
    signParent: "Signature du Parent / Élève",
    signSchool: "Cachet & Signature de l'École",
    da: "DA",
    tx: { topup: "Versement", debt_payment: "Règl. dette", registration: "Inscription", deduction: "Débit" },
  },
  ar: {
    docTitle: "تقرير مفصل للتلميذ",
    studentInfo: "معلومات التلميذ",
    fullName: "الاسم الكامل :",
    card: "رقم البطاقة :",
    phone: "الهاتف :",
    parent: "الولي :",
    subjects: "مواد التقرير :",
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
    noLines: "لا يوجد حضور أو غياب في هذه الفترة.",
    subtotal: "المجموع الجزئي",
    summaryTitle: "الملخص",
    printedOn: "تاريخ الطباعة :",
    signParent: "إمضاء الولي / التلميذ",
    signSchool: "ختم وإمضاء المدرسة",
    da: "دج",
    tx: { topup: "دفع", debt_payment: "تسديد دين", registration: "تسجيل", deduction: "خصم" },
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
  .mod-kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin-bottom: 20px; }
  .mod-kpi { border: 1px solid #e8e6f4; border-inline-start: 4px solid #7c3aed; border-radius: 10px; padding: 8px 10px; background: #fff; }
  .mod-kpi b { display: block; font-size: 0.85em; }
  .mod-kpi small { color: #5c567a; font-size: 0.72em; }
  .mod-kpi .c { float: inline-end; font-family: monospace; font-weight: 800; color: #b91c1c; }
  .module-frame { margin-top: 16px; page-break-inside: auto; }
  .module-head { display: flex; justify-content: space-between; align-items: center; }
  .module-head .stats { font-size: 0.8em; color: #5c567a; }
  .subtotal td { background: #fcfbff; font-weight: 800; }
  .section-title { margin: 22px 0 8px; font-size: 1.05em; color: #5b21b6; font-weight: 800; }
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

  const statusBadge = (line: ReportLine) => {
    if (line.kind === "penalty") return `<span class="badge badge-danger">${L.penalty}</span>`;
    if (line.status === "absent") return `<span class="badge badge-danger">${L.absent}</span>`;
    if (line.status === "late") return `<span class="badge badge-warning">${L.lateS}</span>`;
    return `<span class="badge badge-success">${L.present}</span>`;
  };

  const moduleHtml = (m: ReportModule) => `
    <div class="frame module-frame">
      <div class="module-head">
        <h3 style="border:0; margin:0;">📘 ${e(m.name)}</h3>
        <span class="stats">${L.presences}: <b>${m.presences}</b> · ${L.late}: <b>${m.late}</b> · ${L.absences}: <b>${m.absences}</b></span>
      </div>
      <table>
        <thead><tr>
          <th>${L.date}</th><th>${L.group}</th><th>${L.schedule}</th><th class="ctr">${L.status}</th><th class="num">${L.cost}</th>
        </tr></thead>
        <tbody>
          ${
            m.lines.length === 0
              ? `<tr><td colspan="5" style="text-align:center; font-style:italic; color:#999;">${L.noLines}</td></tr>`
              : m.lines
                  .map(
                    (l) => `<tr>
              <td>${l.kind === "penalty" ? L.week(fmtDate(l.weekStart, lang), fmtDate(l.weekEnd, lang)) : fmtDateTime(l.date, lang)}</td>
              <td>${e(l.group ?? "-")}${l.substitute ? ` <span class="badge badge-primary">${L.substitute}</span>` : ""}</td>
              <td>${l.time ?? "-"}</td>
              <td class="ctr">${statusBadge(l)}</td>
              <td class="num" style="color:${l.cost > 0 ? "#b91c1c" : "#15803d"};">${
                l.cost > 0 ? `-${money(l.cost)}` : l.free ? `${L.offered}${l.waived ? ` (${money(l.waived)})` : ""}` : money(0)
              }</td>
            </tr>`,
                  )
                  .join("")
          }
          <tr class="subtotal"><td colspan="4">${L.subtotal} — ${e(m.name)}</td><td class="num" style="color:#b91c1c;">-${money(m.totalCost)}</td></tr>
        </tbody>
      </table>
    </div>`;

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
          <td colspan="3">${report.modules.map((m) => e(m.name)).join(" · ") || "-"}</td>
        </tr>
      </table>
    </div>

    <div class="kpis">
      <div class="kpi green"><span>${L.totalPayments}</span><strong>${money(report.totalPayments)}</strong></div>
      <div class="kpi red"><span>${L.totalCost}</span><strong>${money(report.totalCost)}</strong></div>
      <div class="kpi violet"><span>${L.periodNet}</span><strong>${net > 0 ? "+" : ""}${money(net)}</strong></div>
      <div class="kpi ${data.debtTotal > 0 ? "red" : "amber"}"><span>${L.debt}</span><strong>${money(data.debtTotal)}</strong></div>
    </div>

    <div class="mod-kpis">
      ${report.modules
        .map(
          (m) => `<div class="mod-kpi"><span class="c">${money(m.totalCost)}</span><b>${e(m.name)}</b>
          <small>${L.presences} ${m.presences} · ${L.absences} ${m.absences}</small></div>`,
        )
        .join("")}
    </div>

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

    ${report.modules.map(moduleHtml).join("")}

    <div class="summary-card">
      <h3>${L.summaryTitle}</h3>
      ${report.modules
        .map((m) => `<div class="summary-line"><span>${L.costOf} — ${e(m.name)}</span><strong>-${money(m.totalCost)}</strong></div>`)
        .join("")}
      <div class="summary-line" style="color:#b91c1c;"><span>${L.totalCost}</span><strong>-${money(report.totalCost)}</strong></div>
      <div class="summary-line" style="color:#15803d;"><span>${L.totalPayments}</span><strong>+${money(report.totalPayments)}</strong></div>
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
