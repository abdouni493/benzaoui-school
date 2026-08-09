"use client";

/**
 * Teacher payment report (printable) — deliberately SHORT.
 *
 * Only four blocks, in this order:
 *   1. School letterhead + logo
 *   2. Teacher identity card
 *   3. ONE table: per group, the total number of students who were present over
 *      the period, the revenue they generated and the teacher's share for that
 *      group (share = revenue × his percentage)
 *   4. The final amount to pay
 *
 * The old per-séance breakdown, the paid/unpaid split and the acompte/absence
 * lines were removed on purpose: this document is the payment slip, not an
 * audit trail.
 */

import type {
  AttendanceRecord,
  Group,
  Module,
  ScheduleSession,
  School,
  SchoolClass,
  Teacher,
  UnpaidTeacherSession,
} from "@/lib/types";
import type { Language } from "@/lib/store/settings";
import {
  bannerHtml,
  fmtDate,
  letterheadHtml,
  metaFooterHtml,
  printDocument,
  signaturesHtml,
} from "@/lib/printTemplates";

const LABELS = {
  fr: {
    docTitle: "Bon de Paiement Enseignant",
    period: (s: string, e: string) => `Période du <strong>${s}</strong> au <strong>${e}</strong>`,
    teacherInfo: "Informations de l'Enseignant",
    fullName: "Nom Complet :",
    phone: "Téléphone :",
    email: "Email :",
    contract: "Rémunération :",
    monthlyContract: (a: number) => `Fixe Mensuel (${a} DA/mois)`,
    percentContract: (p: number) => `Pourcentage — ${p}% par élève présent`,
    passagerContract: "Enseignant passager (réglé à la séance)",
    tableTitle: "Récapitulatif par Groupe",
    group: "Groupe",
    module: "Module",
    classLevel: "Classe / Niveau",
    presents: "Élèves présents",
    revenue: "Montant généré",
    share: "Part enseignant",
    noRows: "Aucune présence enregistrée sur cette période.",
    totals: "TOTAL",
    finalTitle: "Montant à Payer",
    totalPresents: "Total des élèves présents :",
    totalRevenue: "Total généré par les séances :",
    rate: "Taux appliqué :",
    monthlySalary: "Salaire mensuel contractuel :",
    net: "TOTAL À PAYER À L'ENSEIGNANT :",
    signTeacher: "Signature de l'Enseignant",
    signCashier: "Le Secrétariat / Caisse",
    da: "DA",
  },
  ar: {
    docTitle: "وصل دفع الأستاذ",
    period: (s: string, e: string) => `الفترة من <strong>${s}</strong> إلى <strong>${e}</strong>`,
    teacherInfo: "معلومات الأستاذ",
    fullName: "الاسم الكامل :",
    phone: "الهاتف :",
    email: "البريد الإلكتروني :",
    contract: "الأجر :",
    monthlyContract: (a: number) => `أجر شهري ثابت (${a} دج/شهر)`,
    percentContract: (p: number) => `نسبة مئوية — ${p}٪ عن كل تلميذ حاضر`,
    passagerContract: "أستاذ عابر (يُدفع له بالحصة)",
    tableTitle: "ملخص حسب الفوج",
    group: "الفوج",
    module: "المادة",
    classLevel: "القسم / المستوى",
    presents: "التلاميذ الحاضرون",
    revenue: "المبلغ المحقق",
    share: "نصيب الأستاذ",
    noRows: "لا يوجد حضور مسجل في هذه الفترة.",
    totals: "المجموع",
    finalTitle: "المبلغ الواجب دفعه",
    totalPresents: "إجمالي التلاميذ الحاضرين :",
    totalRevenue: "إجمالي ما حققته الحصص :",
    rate: "النسبة المطبقة :",
    monthlySalary: "الراتب الشهري التعاقدي :",
    net: "الإجمالي المستحق للأستاذ :",
    signTeacher: "إمضاء الأستاذ",
    signCashier: "الأمانة / الصندوق",
    da: "دج",
  },
} as const;

export interface TeacherReportData {
  teacher: Teacher;
  school: School;
  lang: Language;
  /** YYYY-MM-DD, empty string = open bound */
  startDate: string;
  endDate: string;
  sessions: ScheduleSession[];
  attendance: AttendanceRecord[];
  unpaidTeacher: UnpaidTeacherSession[];
  modules: Module[];
  groups: Group[];
  classes: SchoolClass[];
}

interface GroupRow {
  groupName: string;
  moduleName: string;
  classLabel: string;
  presents: number;
  revenue: number;
  share: number;
}

export function buildTeacherPaymentReport(data: TeacherReportData): string {
  const { teacher, school, lang } = data;
  const L = LABELS[lang];

  const start = data.startDate ? new Date(`${data.startDate}T00:00:00`) : new Date(0);
  // End bound is inclusive of the whole selected day.
  const end = data.endDate ? new Date(`${data.endDate}T23:59:59.999`) : new Date();
  const inRange = (iso: string) => {
    const d = new Date(iso);
    return d >= start && d <= end;
  };

  const nameOf = <T extends { id: string; name: string }>(list: T[], id: string) =>
    list.find((x) => x.id === id)?.name ?? "-";
  const classLabelOf = (id: string) => {
    const c = data.classes.find((x) => x.id === id);
    if (!c) return "-";
    const lvl = c.type === "cours" ? c.coursLevel : c.formationLevel;
    return lvl ? `${c.name} (${lvl})` : c.name;
  };

  const teacherSessions = data.sessions.filter((s) => s.teacherId === teacher.id);
  const sessionById = new Map(teacherSessions.map((s) => [s.id, s]));

  const isPercentage = teacher.paymentType === "percentage";
  const pct = teacher.percentage ?? 0;

  // ---- One row per group: presences + revenue over the period ---------------
  const rowsByGroup = new Map<string, GroupRow>();
  const rowFor = (session: ScheduleSession): GroupRow => {
    // A séance libre spans several groups; it gets its own line named after
    // the timing so it stays readable next to the regular groups.
    const key = session.isOpen ? `open-${session.id}` : `${session.groupId}-${session.moduleId}-${session.classId}`;
    let row = rowsByGroup.get(key);
    if (!row) {
      row = {
        groupName: session.isOpen
          ? session.title || `Séance libre ${session.startTime}-${session.endTime}`
          : nameOf(data.groups, session.groupId),
        moduleName: nameOf(data.modules, session.moduleId),
        classLabel: classLabelOf(session.classId),
        presents: 0,
        revenue: 0,
        share: 0,
      };
      rowsByGroup.set(key, row);
    }
    return row;
  };

  data.attendance.forEach((a) => {
    const session = sessionById.get(a.sessionId);
    if (!session || !inRange(a.timestamp)) return;
    const row = rowFor(session);
    row.presents += 1;
    row.revenue += a.amountDeducted;
  });

  // The teacher's share comes from the dues actually written per presence, so
  // the slip always matches what the settlement screen will pay out.
  data.unpaidTeacher.forEach((u) => {
    if (u.teacherId !== teacher.id || !inRange(u.date)) return;
    const session = sessionById.get(u.sessionId);
    if (!session) return;
    rowFor(session).share += u.amount;
  });

  const rows = [...rowsByGroup.values()].sort((a, b) => a.groupName.localeCompare(b.groupName));
  const totalPresents = rows.reduce((s, r) => s + r.presents, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalShare = rows.reduce((s, r) => s + r.share, 0);
  const amountToPay = isPercentage ? totalShare : teacher.monthlyAmount ?? 0;

  const contractLabel = teacher.isPassager
    ? L.passagerContract
    : isPercentage
      ? L.percentContract(pct)
      : L.monthlyContract(teacher.monthlyAmount ?? 0);

  const bodyHtml = `
    ${letterheadHtml(school)}
    ${bannerHtml(L.docTitle, L.period(fmtDate(data.startDate, lang), fmtDate(data.endDate, lang)))}

    <div class="frame frame-info" style="margin-bottom:20px;">
      <h3>${L.teacherInfo}</h3>
      <table style="margin-top:0;">
        <tr>
          <td style="width:18%; font-weight:bold; color:#5c567a;">${L.fullName}</td>
          <td style="width:32%; font-weight:bold; font-size:1.1em;">${teacher.lastName} ${teacher.firstName}</td>
          <td style="width:18%; font-weight:bold; color:#5c567a;">${L.phone}</td>
          <td style="width:32%; font-family:monospace;">${teacher.phone || "-"}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; color:#5c567a;">${L.email}</td>
          <td>${teacher.email || "-"}</td>
          <td style="font-weight:bold; color:#5c567a;">${L.contract}</td>
          <td>
            <span class="badge ${isPercentage ? "badge-success" : "badge-warning"}">${contractLabel}</span>
          </td>
        </tr>
      </table>
    </div>

    <div class="frame">
      <h3>${L.tableTitle}</h3>
      <table>
        <thead>
          <tr>
            <th>${L.group}</th>
            <th>${L.module}</th>
            <th>${L.classLevel}</th>
            <th class="ctr">${L.presents}</th>
            <th class="num">${L.revenue}</th>
            <th class="num">${L.share}${isPercentage ? ` (${pct}%)` : ""}</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length === 0
              ? `<tr><td colspan="6" style="text-align:center; font-style:italic; color:#999;">${L.noRows}</td></tr>`
              : rows
                  .map(
                    (r) => `
          <tr>
            <td style="font-weight:bold;">${r.groupName}</td>
            <td>${r.moduleName}</td>
            <td>${r.classLabel}</td>
            <td class="ctr"><strong>${r.presents}</strong></td>
            <td class="num">${r.revenue} ${L.da}</td>
            <td class="num" style="color:#7c3aed;">${r.share} ${L.da}</td>
          </tr>`,
                  )
                  .join("")
          }
        </tbody>
        ${
          rows.length === 0
            ? ""
            : `<tfoot>
          <tr style="background:#fcfbff; border-top:2px solid #7c3aed;">
            <td colspan="3" style="font-weight:800; text-transform:uppercase;">${L.totals}</td>
            <td class="ctr" style="font-weight:800;">${totalPresents}</td>
            <td class="num" style="font-weight:800;">${totalRevenue} ${L.da}</td>
            <td class="num" style="font-weight:800; color:#7c3aed;">${totalShare} ${L.da}</td>
          </tr>
        </tfoot>`
        }
      </table>
    </div>

    <div class="summary-card">
      <h3>${L.finalTitle}</h3>
      <div class="summary-line"><span>${L.totalPresents}</span><strong>${totalPresents}</strong></div>
      <div class="summary-line"><span>${L.totalRevenue}</span><strong>${totalRevenue} ${L.da}</strong></div>
      ${
        isPercentage
          ? `<div class="summary-line"><span>${L.rate}</span><strong>${pct} %</strong></div>`
          : `<div class="summary-line"><span>${L.monthlySalary}</span><strong>${teacher.monthlyAmount ?? 0} ${L.da}</strong></div>`
      }
      <div class="net-pay-box${amountToPay < 0 ? " negative" : ""}">
        <span>${L.net}</span>
        <span>${amountToPay} ${L.da}</span>
      </div>
    </div>

    ${signaturesHtml(L.signTeacher, L.signCashier)}
    ${metaFooterHtml(school.name, lang)}
  `;

  return printDocument({
    title: `${L.docTitle} - ${teacher.firstName} ${teacher.lastName}`,
    lang,
    bodyHtml,
  });
}
