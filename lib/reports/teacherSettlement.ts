"use client";

/**
 * Receipt printed right after a teacher settlement is validated.
 *
 * Contents, in order (the brief for the séance libre payouts):
 *   1. School information + logo
 *   2. Teacher information
 *   3. The timings that were just settled, with the total number of students
 *      present on each
 *   4. How much the teacher is paid (fixed amount, or the percentage
 *      calculation detailed per timing)
 *
 * The rows come from the frozen `details` snapshot stored on the payment, so
 * reprinting an old receipt shows exactly what was paid at the time.
 */

import type { School, Teacher, TeacherPaymentDetail } from "@/lib/types";
import type { Language } from "@/lib/store/settings";
import {
  bannerHtml,
  fmtDate,
  fmtDateTime,
  letterheadHtml,
  metaFooterHtml,
  printDocument,
  signaturesHtml,
} from "@/lib/printTemplates";

const LABELS = {
  fr: {
    docTitle: "Bon de Paiement — Séances",
    receiptNo: "Bon N° :",
    teacherInfo: "Informations de l'Enseignant",
    fullName: "Nom Complet :",
    phone: "Téléphone :",
    status: "Statut :",
    passager: "Enseignant passager (sans compte)",
    regular: "Enseignant de l'école",
    method: "Mode de calcul :",
    methodFixed: "Montant fixe saisi",
    methodPercent: (p: number) => `Pourcentage — ${p}% du montant généré`,
    timingsTitle: "Créneaux Réglés",
    date: "Date",
    timing: "Créneau",
    time: "Horaire",
    group: "Groupe",
    presents: "Élèves présents",
    passagers: "dont passagers",
    revenue: "Montant généré",
    share: "Part enseignant",
    noRows: "Aucun créneau détaillé.",
    totals: "TOTAL",
    payTitle: "Règlement",
    totalTimings: "Nombre de créneaux réglés :",
    totalPresents: "Total des élèves présents :",
    paidOn: "Payé le :",
    net: "MONTANT VERSÉ À L'ENSEIGNANT :",
    signTeacher: "Signature de l'Enseignant",
    signCashier: "La Caisse / Direction",
    da: "DA",
  },
  ar: {
    docTitle: "وصل دفع — الحصص",
    receiptNo: "وصل رقم :",
    teacherInfo: "معلومات الأستاذ",
    fullName: "الاسم الكامل :",
    phone: "الهاتف :",
    status: "الحالة :",
    passager: "أستاذ عابر (بدون حساب)",
    regular: "أستاذ بالمدرسة",
    method: "طريقة الحساب :",
    methodFixed: "مبلغ ثابت",
    methodPercent: (p: number) => `نسبة مئوية — ${p}٪ من المبلغ المحقق`,
    timingsTitle: "الحصص المدفوعة",
    date: "التاريخ",
    timing: "الحصة",
    time: "التوقيت",
    group: "الفوج",
    presents: "التلاميذ الحاضرون",
    passagers: "منهم عابرون",
    revenue: "المبلغ المحقق",
    share: "نصيب الأستاذ",
    noRows: "لا توجد تفاصيل.",
    totals: "المجموع",
    payTitle: "الدفع",
    totalTimings: "عدد الحصص المدفوعة :",
    totalPresents: "إجمالي التلاميذ الحاضرين :",
    paidOn: "تاريخ الدفع :",
    net: "المبلغ المدفوع للأستاذ :",
    signTeacher: "إمضاء الأستاذ",
    signCashier: "الصندوق / الإدارة",
    da: "دج",
  },
} as const;

export interface TeacherSettlementReceiptData {
  teacher: Teacher;
  school: School;
  lang: Language;
  amount: number;
  method: "fixed" | "percent";
  percentage?: number;
  details: TeacherPaymentDetail[];
  paidAt: string;
  receiptNo?: string;
}

export function buildTeacherSettlementReceipt(data: TeacherSettlementReceiptData): string {
  const { teacher, school, lang } = data;
  const L = LABELS[lang];
  const receiptNo =
    data.receiptNo ?? `PAY-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

  const rows = data.details;
  const totalPresents = rows.reduce((s, r) => s + r.presents, 0);
  const totalPassagers = rows.reduce((s, r) => s + r.passagers, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.gross, 0);
  const totalShare = rows.reduce((s, r) => s + r.share, 0);

  const bodyHtml = `
    ${letterheadHtml(school)}
    ${bannerHtml(L.docTitle, `${L.receiptNo} <strong style="font-family:monospace;">${receiptNo}</strong>`)}

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
          <td style="font-weight:bold; color:#5c567a;">${L.status}</td>
          <td>
            <span class="badge ${teacher.isPassager ? "badge-warning" : "badge-primary"}">
              ${teacher.isPassager ? L.passager : L.regular}
            </span>
          </td>
          <td style="font-weight:bold; color:#5c567a;">${L.method}</td>
          <td>
            <span class="badge badge-success">
              ${data.method === "percent" ? L.methodPercent(data.percentage ?? 0) : L.methodFixed}
            </span>
          </td>
        </tr>
      </table>
    </div>

    <div class="frame">
      <h3>${L.timingsTitle}</h3>
      <table>
        <thead>
          <tr>
            <th>${L.date}</th>
            <th>${L.timing}</th>
            <th>${L.group}</th>
            <th class="ctr">${L.time}</th>
            <th class="ctr">${L.presents}</th>
            <th class="num">${L.revenue}</th>
            <th class="num">${L.share}</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length === 0
              ? `<tr><td colspan="7" style="text-align:center; font-style:italic; color:#999;">${L.noRows}</td></tr>`
              : rows
                  .map(
                    (r) => `
          <tr>
            <td style="font-weight:bold;">${fmtDate(r.dateKey, lang)}</td>
            <td>${r.title || r.moduleName}</td>
            <td>${r.groupName}</td>
            <td class="ctr" style="font-family:monospace;">${r.startTime} - ${r.endTime}</td>
            <td class="ctr">
              <strong>${r.presents}</strong>
              ${r.passagers > 0 ? `<br/><span style="font-size:0.8em;color:#888;">${r.passagers} ${L.passagers}</span>` : ""}
            </td>
            <td class="num">${r.gross} ${L.da}</td>
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
            <td colspan="4" style="font-weight:800; text-transform:uppercase;">${L.totals}</td>
            <td class="ctr" style="font-weight:800;">${totalPresents}${totalPassagers > 0 ? ` (${totalPassagers})` : ""}</td>
            <td class="num" style="font-weight:800;">${totalRevenue} ${L.da}</td>
            <td class="num" style="font-weight:800; color:#7c3aed;">${totalShare} ${L.da}</td>
          </tr>
        </tfoot>`
        }
      </table>
    </div>

    <div class="summary-card">
      <h3>${L.payTitle}</h3>
      <div class="summary-line"><span>${L.totalTimings}</span><strong>${rows.length}</strong></div>
      <div class="summary-line"><span>${L.totalPresents}</span><strong>${totalPresents}</strong></div>
      <div class="summary-line"><span>${L.paidOn}</span><strong>${fmtDateTime(data.paidAt, lang)}</strong></div>
      <div class="net-pay-box">
        <span>${L.net}</span>
        <span>${data.amount} ${L.da}</span>
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
