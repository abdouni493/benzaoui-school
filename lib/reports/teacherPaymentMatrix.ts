"use client";

/**
 * Bon de paiement d'un enseignant — LE TABLEAU.
 *
 * Le bon précédent (`teacherSettlement.ts`) listait une ligne par séance
 * datée : sur un mois de cours, trente lignes qu'il fallait additionner à la
 * main pour vérifier un total. L'enseignant signait un chiffre qu'il ne
 * pouvait pas recalculer.
 *
 * Celui-ci imprime exactement ce que l'écran de règlement a montré :
 *
 *   · en-tête : école (logo + identité fiscale) et enseignant ;
 *   · le tableau : un emploi du temps par ligne, une date de séance par
 *     colonne, le nombre d'élèves dans chaque case, puis le total d'élèves et
 *     le montant calculé ;
 *   · sous chaque ligne, la formule en clair : tarif × pourcentage × élèves ;
 *   · le récapitulatif : brut, acomptes, retenues, net versé ;
 *   · deux cadres de signature.
 *
 * La colonne « séances libres » n'est imprimée que s'il y en a — une école qui
 * n'utilise pas les pourcentages dédiés ne veut pas d'une colonne de zéros.
 *
 * Le tableau est construit par `buildPayMatrix()` à partir de l'instantané figé
 * du règlement : imprimer aujourd'hui ou réimprimer dans six mois donne le
 * même papier, au dinar près.
 */

import type { School, Teacher, TeacherPaymentDetail } from "@/lib/types";
import type { Language } from "@/lib/store/settings";
import { buildPayMatrix, shortDate } from "@/lib/teacherPayMatrix";
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

const LABELS = {
  fr: {
    docTitle: "Bon de Paiement — Enseignant",
    receiptNo: "Bon N° :",
    teacherInfo: "Informations de l'Enseignant",
    fullName: "Nom & Prénom :",
    phone: "Téléphone :",
    status: "Statut :",
    passager: "Enseignant passager",
    regular: "Enseignant de l'école",
    rate: "Rémunération :",
    ratePercent: (p: number) => `${p} % par élève présent`,
    rateFixed: "Montant fixe convenu",
    period: "Période réglée :",
    tableTitle: "Détail du calcul — élèves présents par séance",
    level: "Niveau (emploi du temps)",
    unit: "Tarif séance",
    pct: "%",
    seances: "Séances",
    totalStudents: "Total élèves",
    freeCol: "Séances libres (part dédiée)",
    amount: "Montant calculé",
    totals: "TOTAL GÉNÉRAL",
    noRows: "Aucune séance détaillée sur ce règlement.",
    formula: (unit: number, pct: number, students: number, total: number, da: string) =>
      `${unit} ${da} × ${pct} % × ${students} élève(s) = ${total} ${da}`,
    recapTitle: "Récapitulatif du règlement",
    gross: "Part enseignant brute :",
    acomptes: "Acomptes déjà versés :",
    retenues: "Retenues / absences :",
    paidOn: "Payé le :",
    net: "MONTANT NET VERSÉ À L'ENSEIGNANT :",
    signTeacher: "Signature de l'Enseignant",
    signCashier: "La Caisse / Direction",
    datesNote: (from: string, to: string) => `Dates des séances : du ${from} au ${to}.`,
    freeNote:
      "« Séances libres (part dédiée) » : séances libres réglées à leur propre " +
      "pourcentage, distinct du taux habituel de l'enseignant.",
    da: "DA",
  },
  ar: {
    docTitle: "وصل دفع — الأستاذ",
    receiptNo: "وصل رقم :",
    teacherInfo: "معلومات الأستاذ",
    fullName: "الاسم واللقب :",
    phone: "الهاتف :",
    status: "الحالة :",
    passager: "أستاذ عابر",
    regular: "أستاذ بالمدرسة",
    rate: "الأجر :",
    ratePercent: (p: number) => `${p} ٪ عن كل تلميذ حاضر`,
    rateFixed: "مبلغ ثابت متفق عليه",
    period: "الفترة المدفوعة :",
    tableTitle: "تفصيل الحساب — التلاميذ الحاضرون في كل حصة",
    level: "المستوى (جدول التوقيت)",
    unit: "سعر الحصة",
    pct: "٪",
    seances: "الحصص",
    totalStudents: "مجموع التلاميذ",
    freeCol: "الحصص الحرة (نسبة خاصة)",
    amount: "المبلغ المحسوب",
    totals: "المجموع العام",
    noRows: "لا توجد حصص مفصلة في هذا الدفع.",
    formula: (unit: number, pct: number, students: number, total: number, da: string) =>
      `${unit} ${da} × ${pct} ٪ × ${students} تلميذ = ${total} ${da}`,
    recapTitle: "ملخص الدفع",
    gross: "نصيب الأستاذ الإجمالي :",
    acomptes: "التسبيقات المدفوعة :",
    retenues: "الخصومات / الغيابات :",
    paidOn: "تاريخ الدفع :",
    net: "المبلغ الصافي المدفوع للأستاذ :",
    signTeacher: "إمضاء الأستاذ",
    signCashier: "الصندوق / الإدارة",
    datesNote: (from: string, to: string) => `تواريخ الحصص : من ${from} إلى ${to}.`,
    freeNote:
      "« الحصص الحرة (نسبة خاصة) » : حصص حرة تُحتسب بنسبتها الخاصة، " +
      "المختلفة عن النسبة المعتادة للأستاذ.",
    da: "دج",
  },
} as const;

/** Le tableau est large : ses règles propres s'ajoutent à la feuille A4
 *  commune. Une colonne de dates est étroite et centrée, les colonnes de
 *  chiffres sont en chasse fixe pour que les montants s'alignent à l'œil. */
const MATRIX_CSS = `
  @page { size: A4 landscape; margin: 8mm; }
  .matrix-wrap { overflow: visible; }
  table.matrix { width: 100%; border-collapse: collapse; font-size: 0.78em; table-layout: auto; }
  table.matrix th, table.matrix td { border: 1px solid #e0dcf2; padding: 5px 6px; }
  table.matrix thead th { background: #f5f3ff; color: #4c1d95; font-size: 0.86em; text-transform: uppercase; letter-spacing: 0.2px; }
  table.matrix th.d, table.matrix td.d { text-align: center; width: 34px; font-family: monospace; }
  table.matrix td.d { font-weight: 700; }
  table.matrix td.d.zero { color: #c4c0d8; font-weight: 400; }
  table.matrix td.lvl { min-width: 150px; }
  table.matrix td.lvl strong { display: block; font-size: 1.05em; color: #1e1b4b; }
  table.matrix td.lvl span { display: block; font-size: 0.85em; color: #6b6489; }
  table.matrix td.lvl em { display: block; margin-top: 2px; font-size: 0.82em; font-style: normal; color: #7c3aed; }
  table.matrix td.n, table.matrix th.n { text-align: end; font-family: monospace; font-weight: 700; white-space: nowrap; }
  table.matrix tr.tot td { background: #fcfbff; border-top: 2px solid #7c3aed; font-weight: 800; }
  table.matrix tr.tot td.amt { color: #7c3aed; font-size: 1.15em; }
  table.matrix td.amt { color: #7c3aed; }
  .note-line { margin-top: 8px; font-size: 0.78em; color: #6b6489; font-style: italic; }
`;

export interface TeacherPaymentMatrixData {
  teacher: Teacher;
  school: School;
  lang: Language;
  /** net réellement versé */
  amount: number;
  method: "fixed" | "percent";
  percentage?: number;
  details: TeacherPaymentDetail[];
  paidAt: string;
  receiptNo?: string;
  /** retenues appliquées, pour que le net s'explique tout seul */
  acomptes?: number;
  retenues?: number;
}

export function buildTeacherPaymentMatrixReceipt(data: TeacherPaymentMatrixData): string {
  const { teacher, school, lang } = data;
  const L = LABELS[lang];
  const money = (v: number) => `${Math.round(v)} ${L.da}`;
  const receiptNo =
    data.receiptNo ??
    `PAY-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

  const m = buildPayMatrix(data.details);
  const showFree = m.hasFreeColumn;
  // Nombre de colonnes fixes : Niveau, Tarif, %, Séances, Total élèves,
  // [Séances libres], Montant.
  const fixedCols = 6 + (showFree ? 1 : 0);

  const headDates = m.dates.map((d) => `<th class="d">${shortDate(d)}</th>`).join("");

  const bodyRows =
    m.rows.length === 0
      ? `<tr><td colspan="${fixedCols + m.dates.length}" style="text-align:center;font-style:italic;color:#999;">${L.noRows}</td></tr>`
      : m.rows
          .map((r) => {
            const cells = m.dates
              .map((d) => {
                const c = r.cells.get(d);
                const n = c?.students ?? 0;
                return `<td class="d${n === 0 ? " zero" : ""}">${c ? n : "—"}</td>`;
              })
              .join("");
            const formula =
              r.unitPrice > 0 && r.percentage > 0 && r.totalStudents > 0
                ? `<em>${L.formula(r.unitPrice, r.percentage, r.totalStudents, r.totalShare, L.da)}</em>`
                : "";
            return `
              <tr>
                <td class="lvl">
                  <strong>${escapeHtml(r.title)}</strong>
                  <span>${escapeHtml(r.className)}${r.groupName && r.groupName !== "—" ? ` · ${escapeHtml(r.groupName)}` : ""}</span>
                  ${formula}
                </td>
                <td class="n">${r.unitPrice > 0 ? money(r.unitPrice) : "—"}</td>
                <td class="n">${r.percentage > 0 ? `${r.percentage} ${L.pct}` : "—"}</td>
                <td class="n">${r.seances}</td>
                ${cells}
                <td class="n">${r.totalStudents}</td>
                ${showFree ? `<td class="n">${r.freeCount > 0 ? `${money(r.freeShare)} <span style="font-weight:400;font-size:0.85em;">(${r.freeCount})</span>` : "—"}</td>` : ""}
                <td class="n amt">${money(r.amount)}</td>
              </tr>`;
          })
          .join("");

  const totalCells = m.dates
    .map((d) => {
      const n = m.rows.reduce((s, r) => s + (r.cells.get(d)?.students ?? 0), 0);
      return `<td class="d">${n}</td>`;
    })
    .join("");

  const totalsRow =
    m.rows.length === 0
      ? ""
      : `
      <tr class="tot">
        <td colspan="4">${L.totals}</td>
        ${totalCells}
        <td class="n">${m.totalStudents}</td>
        ${showFree ? `<td class="n">${money(m.freeShare)}</td>` : ""}
        <td class="n amt">${money(m.amount)}</td>
      </tr>`;

  const periodLabel =
    m.dates.length > 0
      ? `${fmtDate(m.dates[0], lang)} → ${fmtDate(m.dates[m.dates.length - 1], lang)}`
      : "—";

  const bodyHtml = `
    ${letterheadHtml(school)}
    ${bannerHtml(L.docTitle, `${L.receiptNo} <strong style="font-family:monospace;">${escapeHtml(receiptNo)}</strong>`)}

    <div class="frame frame-info" style="margin-bottom:16px;">
      <h3>${L.teacherInfo}</h3>
      <table style="margin-top:0;">
        <tr>
          <td style="width:16%;font-weight:bold;color:#5c567a;">${L.fullName}</td>
          <td style="width:34%;font-weight:bold;font-size:1.1em;">${escapeHtml(`${teacher.lastName} ${teacher.firstName}`.trim())}</td>
          <td style="width:16%;font-weight:bold;color:#5c567a;">${L.phone}</td>
          <td style="width:34%;font-family:monospace;">${escapeHtml(teacher.phone || "-")}</td>
        </tr>
        <tr>
          <td style="font-weight:bold;color:#5c567a;">${L.status}</td>
          <td>
            <span class="badge ${teacher.isPassager ? "badge-warning" : "badge-primary"}">
              ${teacher.isPassager ? L.passager : L.regular}
            </span>
          </td>
          <td style="font-weight:bold;color:#5c567a;">${L.rate}</td>
          <td>
            <span class="badge badge-success">
              ${data.method === "percent" ? L.ratePercent(data.percentage ?? 0) : L.rateFixed}
            </span>
          </td>
        </tr>
        <tr>
          <td style="font-weight:bold;color:#5c567a;">${L.period}</td>
          <td colspan="3" style="font-weight:bold;font-family:monospace;">${periodLabel}</td>
        </tr>
      </table>
    </div>

    <div class="frame">
      <h3>${L.tableTitle}</h3>
      <div class="matrix-wrap">
        <table class="matrix">
          <thead>
            <tr>
              <th>${L.level}</th>
              <th class="n">${L.unit}</th>
              <th class="n">${L.pct}</th>
              <th class="n">${L.seances}</th>
              ${headDates}
              <th class="n">${L.totalStudents}</th>
              ${showFree ? `<th class="n">${L.freeCol}</th>` : ""}
              <th class="n">${L.amount}</th>
            </tr>
          </thead>
          <tbody>
            ${bodyRows}
            ${totalsRow}
          </tbody>
        </table>
      </div>
      ${
        m.dates.length > 0
          ? `<p class="note-line">${L.datesNote(fmtDate(m.dates[0], lang), fmtDate(m.dates[m.dates.length - 1], lang))}</p>`
          : ""
      }
      ${showFree ? `<p class="note-line">${L.freeNote}</p>` : ""}
    </div>

    <div class="summary-card">
      <h3>${L.recapTitle}</h3>
      <div class="summary-line"><span>${L.gross}</span><strong>${money(m.amount)}</strong></div>
      ${
        (data.acomptes ?? 0) > 0
          ? `<div class="summary-line"><span>${L.acomptes}</span><strong style="color:#b91c1c;">-${money(data.acomptes ?? 0)}</strong></div>`
          : ""
      }
      ${
        (data.retenues ?? 0) > 0
          ? `<div class="summary-line"><span>${L.retenues}</span><strong style="color:#b91c1c;">-${money(data.retenues ?? 0)}</strong></div>`
          : ""
      }
      <div class="summary-line"><span>${L.totalStudents} :</span><strong>${m.totalStudents}</strong></div>
      <div class="summary-line"><span>${L.paidOn}</span><strong>${fmtDateTime(data.paidAt, lang)}</strong></div>
      <div class="net-pay-box">
        <span>${L.net}</span>
        <span>${money(data.amount)}</span>
      </div>
    </div>

    ${signaturesHtml(L.signTeacher, L.signCashier)}
    ${metaFooterHtml(school.name, lang)}
  `;

  return printDocument({
    title: `${L.docTitle} - ${teacher.firstName} ${teacher.lastName}`,
    lang,
    bodyHtml,
    extraCss: MATRIX_CSS,
  });
}
