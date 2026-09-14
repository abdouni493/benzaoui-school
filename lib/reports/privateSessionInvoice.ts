"use client";

/**
 * Facture d'une séance particulière — page A4.
 *
 * Elle s'imprime au moment où la séance est CONCLUE : l'élève a étudié, il
 * vient payer. C'est donc une facture complète, pas un ticket de caisse —
 * l'école la garde, la famille la garde, et elle doit se relire dans un an :
 *
 *   · en-tête de l'école (logo + identité fiscale) ;
 *   · l'élève — ou LES élèves, quand plusieurs partagent la séance, chacun
 *     avec sa part et ce qu'il a versé ;
 *   · les modules : date, heure, durée, enseignant, prix ;
 *   · la répartition école / enseignants, en clair ;
 *   · versé / reste dû, et deux cadres de signature.
 */

import type {
  PrivateSession,
  PrivateSessionModule,
  PrivateSessionStudent,
  School,
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

const LABELS = {
  fr: {
    docTitle: "Facture — Séance Particulière",
    invoiceNo: "Facture N° :",
    fileTitle: "Le dossier",
    requestDate: "Date de demande :",
    receptionist: "Reçu par :",
    scheduledAt: "Séance tenue le :",
    observation: "Observation :",
    studentsTitle: "Élève(s)",
    name: "Nom complet",
    phone: "Téléphone",
    schooling: "Scolarité",
    kind: "Type",
    registered: "Élève inscrit",
    guest: "Élève de passage",
    due: "À payer",
    paid: "Versé",
    remaining: "Reste dû",
    modulesTitle: "Modules de la séance",
    moduleName: "Module",
    date: "Date & heure",
    duration: "Durée",
    teacher: "Enseignant",
    rate: "Tarif",
    flat: "forfait",
    perHour: "/ h",
    price: "Prix",
    teacherPart: "Part enseignant",
    teacherSettled: "réglé",
    teacherPending: "à régler",
    totals: "TOTAL",
    noModules: "Aucun module détaillé.",
    splitTitle: "Répartition",
    total: "Total de la séance :",
    schoolShare: (p: number) => `Part de l'école (${p} %) :`,
    teacherShare: (p: number) => `Part des enseignants (${p} %) :`,
    deposit: "Versement à la demande :",
    cashed: "Total versé :",
    balance: "RESTE DÛ :",
    settled: "SÉANCE SOLDÉE",
    signFamily: "Signature de la famille",
    signSchool: "L'École / La Caisse",
    da: "DA",
  },
  ar: {
    docTitle: "فاتورة — حصة خاصة",
    invoiceNo: "فاتورة رقم :",
    fileTitle: "الملف",
    requestDate: "تاريخ الطلب :",
    receptionist: "استلمها :",
    scheduledAt: "تاريخ الحصة :",
    observation: "ملاحظة :",
    studentsTitle: "التلميذ / التلاميذ",
    name: "الاسم الكامل",
    phone: "الهاتف",
    schooling: "المستوى",
    kind: "النوع",
    registered: "تلميذ مسجل",
    guest: "تلميذ عابر",
    due: "المطلوب",
    paid: "المدفوع",
    remaining: "الباقي",
    modulesTitle: "مواد الحصة",
    moduleName: "المادة",
    date: "التاريخ والوقت",
    duration: "المدة",
    teacher: "الأستاذ",
    rate: "التسعيرة",
    flat: "جزافي",
    perHour: "/ سا",
    price: "السعر",
    teacherPart: "نصيب الأستاذ",
    teacherSettled: "مدفوع",
    teacherPending: "غير مدفوع",
    totals: "المجموع",
    noModules: "لا توجد تفاصيل.",
    splitTitle: "التوزيع",
    total: "إجمالي الحصة :",
    schoolShare: (p: number) => `نصيب المدرسة (${p} ٪) :`,
    teacherShare: (p: number) => `نصيب الأساتذة (${p} ٪) :`,
    deposit: "الدفعة عند الطلب :",
    cashed: "إجمالي المدفوع :",
    balance: "الباقي :",
    settled: "الحصة مسدّدة",
    signFamily: "إمضاء العائلة",
    signSchool: "المدرسة / الصندوق",
    da: "دج",
  },
} as const;

/** Ce que l'écran fournit sur chaque élève : la fiche ne suffit pas, il faut
 *  le nom lisible même pour un élève de passage. */
export interface InvoiceStudentRow {
  row: PrivateSessionStudent;
  name: string;
  phone: string;
  schooling: string;
  isRegistered: boolean;
}

/** Ce que l'écran fournit sur chaque module. */
export interface InvoiceModuleRow {
  row: PrivateSessionModule;
  moduleName: string;
  teacherName: string;
}

export interface PrivateSessionInvoiceData {
  school: School;
  lang: Language;
  session: PrivateSession;
  students: InvoiceStudentRow[];
  modules: InvoiceModuleRow[];
  invoiceNo?: string;
}

const fmtDuration = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
};

export function buildPrivateSessionInvoice(data: PrivateSessionInvoiceData): string {
  const { school, lang, session } = data;
  const L = LABELS[lang];
  const money = (v: number) => `${Math.round(v || 0)} ${L.da}`;
  const invoiceNo =
    data.invoiceNo ?? `PART-${session.id.slice(0, 8).toUpperCase()}`;

  const total = session.totalPrice || 0;
  const paid = session.paidAmount || 0;
  const remaining = Math.max(0, total - paid);
  const teacherShare = session.teacherShare ?? 0;
  const schoolShare = session.schoolShare ?? Math.max(0, total - teacherShare);
  const schoolPct = session.schoolPercentage ?? 0;
  const teacherPct = Math.max(0, 100 - schoolPct);

  // Plusieurs élèves : chacun sa ligne, sa part, son versement. Un seul élève :
  // le tableau reste — c'est la même lecture, et la facture d'une séance à deux
  // ne doit pas avoir une forme différente de celle d'une séance à un.
  const studentRows =
    data.students.length === 0
      ? `<tr><td colspan="6" style="text-align:center;font-style:italic;color:#999;">—</td></tr>`
      : data.students
          .map((s) => {
            const sDue = s.row.totalPrice || 0;
            const sPaid = s.row.paidAmount || 0;
            const sLeft = Math.max(0, sDue - sPaid);
            return `
          <tr>
            <td style="font-weight:bold;">${escapeHtml(s.name)}</td>
            <td style="font-family:monospace;">${escapeHtml(s.phone || "-")}</td>
            <td>${escapeHtml(s.schooling || "-")}</td>
            <td class="ctr">
              <span class="badge ${s.isRegistered ? "badge-primary" : "badge-warning"}">
                ${s.isRegistered ? L.registered : L.guest}
              </span>
            </td>
            <td class="num">${money(sDue)}</td>
            <td class="num" style="color:${sLeft > 0 ? "#b91c1c" : "#15803d"};">
              ${money(sPaid)}${sLeft > 0 ? `<br/><span style="font-size:0.8em;">${L.remaining} ${money(sLeft)}</span>` : ""}
            </td>
          </tr>`;
          })
          .join("");

  const moduleRows =
    data.modules.length === 0
      ? `<tr><td colspan="6" style="text-align:center;font-style:italic;color:#999;">${L.noModules}</td></tr>`
      : data.modules
          .map((m) => {
            const r = m.row;
            const rate =
              (r.flatPrice ?? 0) > 0
                ? `${money(r.flatPrice ?? 0)} <span style="color:#888;">(${L.flat})</span>`
                : `${money(r.hourlyPrice)} ${L.perHour}`;
            return `
          <tr>
            <td style="font-weight:bold;">${escapeHtml(m.moduleName)}</td>
            <td style="font-family:monospace;">${r.scheduledAt ? fmtDateTime(r.scheduledAt, lang) : "-"}</td>
            <td class="ctr">${fmtDuration(r.minutes)}</td>
            <td>
              ${escapeHtml(m.teacherName)}
              ${r.teacherPhone ? `<br/><span style="font-size:0.8em;color:#888;font-family:monospace;">${escapeHtml(r.teacherPhone)}</span>` : ""}
            </td>
            <td class="num">${rate}<br/><strong>${money(r.totalPrice)}</strong></td>
            <td class="num" style="color:#7c3aed;">
              ${money(r.teacherAmount)}
              <br/><span style="font-size:0.78em;font-weight:400;color:${r.teacherPaid ? "#15803d" : "#b45309"};">
                ${r.teacherPercentage} % · ${r.teacherPaid ? L.teacherSettled : L.teacherPending}
              </span>
            </td>
          </tr>`;
          })
          .join("");

  const modulesTotal = data.modules.reduce((s, m) => s + (m.row.totalPrice || 0), 0);
  const modulesTeacher = data.modules.reduce((s, m) => s + (m.row.teacherAmount || 0), 0);

  const bodyHtml = `
    ${letterheadHtml(school)}
    ${bannerHtml(L.docTitle, `${L.invoiceNo} <strong style="font-family:monospace;">${escapeHtml(invoiceNo)}</strong>`)}

    <div class="frame frame-info" style="margin-bottom:16px;">
      <h3>${L.fileTitle}</h3>
      <table style="margin-top:0;">
        <tr>
          <td style="width:18%;font-weight:bold;color:#5c567a;">${L.requestDate}</td>
          <td style="width:32%;font-weight:bold;">${session.requestDate ? fmtDate(session.requestDate, lang) : "-"}</td>
          <td style="width:18%;font-weight:bold;color:#5c567a;">${L.receptionist}</td>
          <td style="width:32%;font-weight:bold;">${escapeHtml(session.receptionistName || "-")}</td>
        </tr>
        <tr>
          <td style="font-weight:bold;color:#5c567a;">${L.scheduledAt}</td>
          <td style="font-weight:bold;font-family:monospace;">${session.scheduledAt ? fmtDateTime(session.scheduledAt, lang) : "-"}</td>
          <td style="font-weight:bold;color:#5c567a;">${L.observation}</td>
          <td>${escapeHtml(session.observation || session.notes || "-")}</td>
        </tr>
      </table>
    </div>

    <div class="frame" style="margin-bottom:16px;">
      <h3>${L.studentsTitle} (${data.students.length})</h3>
      <table>
        <thead>
          <tr>
            <th>${L.name}</th>
            <th>${L.phone}</th>
            <th>${L.schooling}</th>
            <th class="ctr">${L.kind}</th>
            <th class="num">${L.due}</th>
            <th class="num">${L.paid}</th>
          </tr>
        </thead>
        <tbody>${studentRows}</tbody>
      </table>
    </div>

    <div class="frame">
      <h3>${L.modulesTitle}</h3>
      <table>
        <thead>
          <tr>
            <th>${L.moduleName}</th>
            <th>${L.date}</th>
            <th class="ctr">${L.duration}</th>
            <th>${L.teacher}</th>
            <th class="num">${L.price}</th>
            <th class="num">${L.teacherPart}</th>
          </tr>
        </thead>
        <tbody>${moduleRows}</tbody>
        ${
          data.modules.length === 0
            ? ""
            : `<tfoot>
          <tr style="background:#fcfbff;border-top:2px solid #7c3aed;">
            <td colspan="4" style="font-weight:800;text-transform:uppercase;">${L.totals}</td>
            <td class="num" style="font-weight:800;">${money(modulesTotal)}</td>
            <td class="num" style="font-weight:800;color:#7c3aed;">${money(modulesTeacher)}</td>
          </tr>
        </tfoot>`
        }
      </table>
    </div>

    <div class="summary-card">
      <h3>${L.splitTitle}</h3>
      <div class="summary-line"><span>${L.total}</span><strong>${money(total)}</strong></div>
      <div class="summary-line">
        <span>${L.teacherShare(teacherPct)}</span>
        <strong style="color:#7c3aed;">${money(teacherShare)}</strong>
      </div>
      <div class="summary-line">
        <span>${L.schoolShare(schoolPct)}</span>
        <strong style="color:#15803d;">${money(schoolShare)}</strong>
      </div>
      ${
        (session.depositAmount ?? 0) > 0
          ? `<div class="summary-line"><span>${L.deposit}</span><strong>${money(session.depositAmount ?? 0)}</strong></div>`
          : ""
      }
      <div class="summary-line"><span>${L.cashed}</span><strong>${money(paid)}</strong></div>
      <div class="net-pay-box${remaining > 0 ? " negative" : ""}">
        <span>${remaining > 0 ? L.balance : L.settled}</span>
        <span>${remaining > 0 ? money(remaining) : money(paid)}</span>
      </div>
    </div>

    ${signaturesHtml(L.signFamily, L.signSchool)}
    ${metaFooterHtml(school.name, lang)}
  `;

  return printDocument({
    title: `${L.docTitle} - ${data.students[0]?.name ?? ""}`,
    lang,
    bodyHtml,
  });
}
