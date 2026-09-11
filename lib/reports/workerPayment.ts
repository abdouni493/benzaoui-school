"use client";

/**
 * Bulletin de paie d'un travailleur (réception, sécurité, ménage).
 *
 * Ce que ce document apporte et qui manquait : la PREUVE de ce qui a été payé.
 * Les règlements de travailleurs n'avaient aucun justificatif — ni pour
 * l'employé, ni pour l'école. Le bon liste, dans l'ordre :
 *   1. l'en-tête de l'école et ses identifiants fiscaux ;
 *   2. l'identité du travailleur et son contrat ;
 *   3. la période réglée, jour par jour : arrivée, sortie, heures, et les
 *      ABSENCES — payer un mois sans dire combien de jours ont été travaillés
 *      est précisément ce qui rend un salaire indiscutable après coup ;
 *   4. le décompte : brut, acomptes et retenues déduits, net versé.
 *
 * Les lignes viennent de l'instantané figé sur le règlement (`details`), donc
 * réimprimer un vieux bulletin montre exactement ce qui a été payé ce jour-là,
 * même si les heures ont été corrigées depuis.
 */

import type { ReceptionPaymentType, ReceptionStaff, School, WorkerPaymentDetail } from "@/lib/types";
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

const CONTRACT_LABELS: Record<ReceptionPaymentType, { fr: string; ar: string }> = {
  monthly: { fr: "Mensuel", ar: "شهري" },
  daily: { fr: "Journalier", ar: "يومي" },
  half_day: { fr: "Demi-journée", ar: "نصف يوم" },
  hourly: { fr: "Horaire", ar: "بالساعة" },
};

const LABELS = {
  fr: {
    docTitle: "Bulletin de Paie",
    receiptNo: "Bon N° :",
    workerInfo: "Informations du Travailleur",
    fullName: "Nom Complet :",
    phone: "Téléphone :",
    role: "Poste :",
    contract: "Contrat :",
    hired: "Embauché le :",
    period: "Période réglée :",
    daysTitle: "Détail des Journées",
    day: "Jour",
    arrival: "Arrivée",
    departure: "Sortie",
    hours: "Heures",
    source: "Origine",
    amount: "Montant",
    status: "Statut",
    present: "Présent",
    absent: "Absent",
    sourceScan: "Badge",
    sourceManual: "Saisie",
    sourceAuto: "Relevé auto",
    noRows: "Aucune journée détaillée pour cette période.",
    totals: "TOTAL",
    payTitle: "Décompte du Règlement",
    daysWorked: "Journées travaillées :",
    daysAbsent: "Journées d'absence :",
    totalHours: "Total des heures :",
    gross: "Rémunération brute :",
    acomptes: "Acomptes déjà versés :",
    deductions: "Retenues pour absence :",
    paidOn: "Payé le :",
    net: "NET VERSÉ AU TRAVAILLEUR :",
    signWorker: "Signature du Travailleur",
    signCashier: "La Caisse / Direction",
    da: "DA",
  },
  ar: {
    docTitle: "كشف الراتب",
    receiptNo: "وصل رقم :",
    workerInfo: "معلومات العامل",
    fullName: "الاسم الكامل :",
    phone: "الهاتف :",
    role: "المنصب :",
    contract: "العقد :",
    hired: "تاريخ التوظيف :",
    period: "الفترة المدفوعة :",
    daysTitle: "تفصيل الأيام",
    day: "اليوم",
    arrival: "الدخول",
    departure: "الخروج",
    hours: "الساعات",
    source: "المصدر",
    amount: "المبلغ",
    status: "الحالة",
    present: "حاضر",
    absent: "غائب",
    sourceScan: "البطاقة",
    sourceManual: "إدخال يدوي",
    sourceAuto: "تسجيل تلقائي",
    noRows: "لا توجد أيام مفصلة لهذه الفترة.",
    totals: "المجموع",
    payTitle: "تفاصيل التسوية",
    daysWorked: "أيام العمل :",
    daysAbsent: "أيام الغياب :",
    totalHours: "مجموع الساعات :",
    gross: "الأجر الإجمالي :",
    acomptes: "التسبيقات المدفوعة :",
    deductions: "اقتطاعات الغياب :",
    paidOn: "دفع في :",
    net: "الصافي المدفوع للعامل :",
    signWorker: "توقيع العامل",
    signCashier: "الصندوق / الإدارة",
    da: "دج",
  },
} as const;

const ROLE_LABELS: Record<string, { fr: string; ar: string }> = {
  reception: { fr: "Réception", ar: "الاستقبال" },
  security: { fr: "Agent de sécurité", ar: "عون أمن" },
  menage: { fr: "Ménage", ar: "النظافة" },
};

export interface WorkerPaymentReceiptData {
  worker: ReceptionStaff;
  school: School;
  lang: Language;
  /** net réellement versé */
  amount: number;
  /** rémunération avant acomptes et retenues */
  gross?: number;
  acomptes?: number;
  deductions?: number;
  periodLabel: string;
  details: WorkerPaymentDetail[];
  paidAt: string;
  receiptNo?: string;
}

/** "7 h 30" — les minutes brutes ne veulent rien dire sur un bulletin. */
function fmtHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

function fmtClock(iso: string | undefined, lang: Language): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(lang === "ar" ? "ar-DZ" : "fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildWorkerPaymentReceipt(data: WorkerPaymentReceiptData): string {
  const { worker, school, lang } = data;
  const L = LABELS[lang];
  const receiptNo =
    data.receiptNo ??
    `SAL-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

  const rows = data.details;
  const worked = rows.filter((r) => r.status !== "absent");
  const absent = rows.filter((r) => r.status === "absent");
  const totalMinutes = rows.reduce((s, r) => s + r.minutes, 0);
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
  const gross = data.gross ?? data.amount;
  const acomptes = data.acomptes ?? 0;
  const deductions = data.deductions ?? 0;

  const sourceLabel = (s: string) =>
    s === "scan" ? L.sourceScan : s === "auto" ? L.sourceAuto : L.sourceManual;

  const bodyHtml = `
    ${letterheadHtml(school)}
    ${bannerHtml(L.docTitle, `${L.receiptNo} <strong style="font-family:monospace;">${receiptNo}</strong>`)}

    <div class="frame frame-info" style="margin-bottom:20px;">
      <h3>${L.workerInfo}</h3>
      <table style="margin-top:0;">
        <tr>
          <td style="width:18%; font-weight:bold; color:#5c567a;">${L.fullName}</td>
          <td style="width:32%; font-weight:bold; font-size:1.1em;">${worker.lastName} ${worker.firstName}</td>
          <td style="width:18%; font-weight:bold; color:#5c567a;">${L.phone}</td>
          <td style="width:32%; font-family:monospace;">${worker.phone || "-"}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; color:#5c567a;">${L.role}</td>
          <td>
            <span class="badge badge-primary">
              ${ROLE_LABELS[worker.role ?? "reception"]?.[lang] ?? worker.role ?? "-"}
            </span>
            ${worker.jobTitle ? `<br/><span style="font-size:0.85em;color:#5c567a;">${worker.jobTitle}</span>` : ""}
          </td>
          <td style="font-weight:bold; color:#5c567a;">${L.contract}</td>
          <td>
            <span class="badge badge-success">${CONTRACT_LABELS[worker.paymentType][lang]}</span>
            ${
              worker.paymentType === "hourly"
                ? ` <span style="font-family:monospace;">${worker.hourlyRate ?? 0} ${L.da}/h</span>`
                : ` <span style="font-family:monospace;">${worker.salary} ${L.da}</span>`
            }
          </td>
        </tr>
        <tr>
          <td style="font-weight:bold; color:#5c567a;">${L.hired}</td>
          <td>${fmtDate(worker.startDate, lang)}</td>
          <td style="font-weight:bold; color:#5c567a;">${L.period}</td>
          <td style="font-weight:bold; color:#7c3aed;">${data.periodLabel}</td>
        </tr>
      </table>
    </div>

    <div class="frame">
      <h3>${L.daysTitle}</h3>
      <table>
        <thead>
          <tr>
            <th>${L.day}</th>
            <th class="ctr">${L.status}</th>
            <th class="ctr">${L.arrival}</th>
            <th class="ctr">${L.departure}</th>
            <th class="ctr">${L.source}</th>
            <th class="num">${L.hours}</th>
            <th class="num">${L.amount}</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length === 0
              ? `<tr><td colspan="7" style="text-align:center; font-style:italic; color:#999;">${L.noRows}</td></tr>`
              : rows
                  .map(
                    (r) => `
          <tr${r.status === "absent" ? ' style="background:#fdf2f2;"' : ""}>
            <td style="font-weight:bold;">${fmtDate(r.workDate, lang)}</td>
            <td class="ctr">
              <span class="badge ${r.status === "absent" ? "badge-danger" : "badge-success"}">
                ${r.status === "absent" ? L.absent : L.present}
              </span>
            </td>
            <td class="ctr" style="font-family:monospace;">${fmtClock(r.startAt, lang)}</td>
            <td class="ctr" style="font-family:monospace;">${fmtClock(r.endAt, lang)}</td>
            <td class="ctr" style="font-size:0.85em; color:#5c567a;">${sourceLabel(r.source)}</td>
            <td class="num">${r.minutes > 0 ? fmtHours(r.minutes) : "—"}</td>
            <td class="num" style="color:${r.amount > 0 ? "#7c3aed" : "#999"};">${r.amount} ${L.da}</td>
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
            <td colspan="5" style="font-weight:800; text-transform:uppercase;">${L.totals}</td>
            <td class="num" style="font-weight:800;">${fmtHours(totalMinutes)}</td>
            <td class="num" style="font-weight:800; color:#7c3aed;">${totalAmount} ${L.da}</td>
          </tr>
        </tfoot>`
        }
      </table>
    </div>

    <div class="summary-card">
      <h3>${L.payTitle}</h3>
      <div class="summary-line"><span>${L.daysWorked}</span><strong>${worked.length}</strong></div>
      <div class="summary-line"><span>${L.daysAbsent}</span><strong style="color:#b91c1c;">${absent.length}</strong></div>
      <div class="summary-line"><span>${L.totalHours}</span><strong>${fmtHours(totalMinutes)}</strong></div>
      <div class="summary-line"><span>${L.gross}</span><strong>${gross} ${L.da}</strong></div>
      ${
        acomptes > 0
          ? `<div class="summary-line"><span>${L.acomptes}</span><strong style="color:#b91c1c;">-${acomptes} ${L.da}</strong></div>`
          : ""
      }
      ${
        deductions > 0
          ? `<div class="summary-line"><span>${L.deductions}</span><strong style="color:#b91c1c;">-${deductions} ${L.da}</strong></div>`
          : ""
      }
      <div class="summary-line"><span>${L.paidOn}</span><strong>${fmtDateTime(data.paidAt, lang)}</strong></div>
      <div class="net-pay-box">
        <span>${L.net}</span>
        <span>${data.amount} ${L.da}</span>
      </div>
    </div>

    ${signaturesHtml(L.signWorker, L.signCashier)}
    ${metaFooterHtml(school.name, lang)}
  `;

  return printDocument({
    title: `${L.docTitle} - ${worker.firstName} ${worker.lastName}`,
    lang,
    bodyHtml,
  });
}
