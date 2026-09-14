"use client";

/**
 * Bon de séance libre — ticket de caisse 80 mm.
 *
 * Le même papier que le « bon de chargement de solde » (`rechargeTicket.ts`) :
 * un seul rectangle, l'école en tête, les informations de la séance en
 * dessous, le montant en gros, la date en pied. La famille reconnaît le format
 * d'un guichet à l'autre, et l'imprimante thermique sort dix centimètres de
 * papier au lieu d'une page A4.
 *
 * Ce qui change, c'est le contenu : qui a suivi la séance, sur quel emploi du
 * temps, avec quel enseignant, et — quand le guichet l'a posée — la part
 * revenant à cet enseignant sur CETTE séance.
 */

import type { School } from "@/lib/types";
import type { Language } from "@/lib/store/settings";
import { TICKET_PAGE_CSS, escapeHtml, printDocument } from "@/lib/printTemplates";
import { fmtAmount } from "@/lib/reports/rechargeTicket";

/** Feuille de style reprise trait pour trait du bon de chargement : c'est ce
 *  qui fait que les deux bons sortent identiques de la même imprimante. */
const TICKET_CSS = `
  ${TICKET_PAGE_CSS}

  /* Noir franc et gras partout : une tête thermique trame les gris en points
     et les rend délavés. La hiérarchie se joue sur la graisse et la taille. */
  body { padding: 1mm 0; font-size: 12px; line-height: 1.3; font-weight: 600; }

  .bon { width: 100%; border: 1.2px solid #000; border-radius: 3px; padding: 1.5mm 2mm; }

  .bon .head { display: flex; align-items: center; gap: 2mm; padding-bottom: 1.5mm; border-bottom: 1.2px solid #000; }
  .bon .logo, .bon .logo-fallback { width: 14mm; height: 14mm; flex: none; }
  .bon .logo { object-fit: contain; }
  .bon .logo-fallback { display: flex; align-items: center; justify-content: center; font-size: 20px; border: 1px dashed #000; border-radius: 3px; }
  .bon .school { min-width: 0; }
  .bon .school b { display: block; font-size: 14px; font-weight: 800; line-height: 1.15; }
  .bon .school span { display: block; font-size: 10px; font-weight: 700; line-height: 1.25; }

  .bon .title { margin: 1.5mm 0 0; text-align: center; font-size: 12.5px; font-weight: 800; letter-spacing: .4px; text-transform: uppercase; }
  .bon .num { text-align: center; font-family: monospace; font-size: 10px; font-weight: 700; }

  .bon .sec { margin-top: 1.5mm; padding-top: 1.2mm; border-top: 1px dashed #000; }
  .bon .sec-title { font-size: 9.5px; font-weight: 800; letter-spacing: .5px; text-transform: uppercase; margin-bottom: .8mm; }

  .bon table { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 0; }
  .bon th, .bon td { padding: .5mm 0; border: 0; background: none; vertical-align: top; text-transform: none; letter-spacing: 0; font-size: 11.5px; line-height: 1.25; color: #000; }
  .bon th { width: 36%; text-align: start; font-weight: 700; }
  .bon td { text-align: end; font-weight: 800; word-break: break-word; }
  .bon td.mono { font-family: monospace; font-size: 11px; }

  .bon .amount { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; margin-top: 1.5mm; padding: 1.2mm 2mm; border: 1.8px solid #000; border-radius: 3px; }
  .bon .amount.free { border-style: dashed; }
  .bon .amount span { font-size: 10.5px; font-weight: 800; letter-spacing: .3px; text-transform: uppercase; }
  .bon .amount strong { font-size: 18px; font-weight: 800; white-space: nowrap; }

  .bon .stamp { margin-top: 1.5mm; padding-top: 1.2mm; border-top: 1px dashed #000; display: flex; justify-content: space-between; gap: 2mm; font-size: 10px; font-weight: 700; }
  .bon .note { margin: 1.2mm 0 0; text-align: center; font-size: 9px; font-weight: 700; font-style: italic; line-height: 1.25; }
`;

const LABELS = {
  fr: {
    docTitle: "Bon de séance libre",
    receiptNo: "N°",
    who: "Élève / Passager",
    registered: "Élève inscrit",
    passenger: "Passager",
    anonymous: "Passager (sans nom)",
    phone: "Téléphone",
    rfid: "Carte RFID",
    schooling: "Scolarité",
    seanceTitle: "La séance",
    seance: "Emploi du temps",
    moduleName: "Module",
    teacher: "Enseignant",
    room: "Salle",
    time: "Horaire",
    date: "Date",
    method: "Règlement",
    cash: "Espèces",
    amount: "Montant encaissé",
    offered: "Séance offerte",
    offeredNote: (v: string) => `Valeur offerte par l'école : ${v}`,
    balanceTitle: "Solde de l'élève",
    balanceBefore: "Solde avant",
    balanceAfter: "Solde après",
    freeStudent: "Élève gratuit — aucun débit",
    teacherShareTitle: "Part de l'enseignant",
    teacherPct: "Pourcentage",
    teacherAmount: "Part sur cette séance",
    cashier: "Caisse",
    note: "Merci de conserver ce bon.",
    da: "DA",
  },
  ar: {
    docTitle: "وصل حصة حرة",
    receiptNo: "رقم",
    who: "التلميذ / الزائر",
    registered: "تلميذ مسجل",
    passenger: "زائر",
    anonymous: "زائر (بدون اسم)",
    phone: "الهاتف",
    rfid: "البطاقة",
    schooling: "المستوى",
    seanceTitle: "الحصة",
    seance: "جدول التوقيت",
    moduleName: "المادة",
    teacher: "الأستاذ",
    room: "القاعة",
    time: "التوقيت",
    date: "التاريخ",
    method: "الدفع",
    cash: "نقدًا",
    amount: "المبلغ المحصل",
    offered: "حصة مجانية",
    offeredNote: (v: string) => `قيمة الحصة المقدمة من المدرسة : ${v}`,
    balanceTitle: "رصيد التلميذ",
    balanceBefore: "الرصيد السابق",
    balanceAfter: "الرصيد الجديد",
    freeStudent: "تلميذ مجاني — بدون خصم",
    teacherShareTitle: "نصيب الأستاذ",
    teacherPct: "النسبة",
    teacherAmount: "النصيب من هذه الحصة",
    cashier: "الصندوق",
    note: "يرجى الاحتفاظ بهذا الوصل.",
    da: "دج",
  },
} as const;

export interface FreeSeanceTicketData {
  school: School;
  language: Language;
  /** nom affiché : élève inscrit, passager nommé, ou passager anonyme */
  personName: string;
  isRegisteredStudent: boolean;
  isAnonymous: boolean;
  phone?: string;
  rfid?: string;
  /** scolarité en clair : « Lycée · 3eme Année · Sciences » */
  schooling?: string;
  /** libellé de l'emploi du temps suivi */
  seanceLabel: string;
  moduleName?: string;
  teacherName?: string;
  salleName?: string;
  timeLabel?: string;
  date: string;
  createdAt: string;
  /** encaissé (0 sur une séance offerte) */
  price: number;
  isFree?: boolean;
  /** ce que la séance aurait coûté quand elle est offerte */
  waived?: number;
  /** solde de l'élève inscrit avant / après (absents pour un passager) */
  balanceBefore?: number;
  balanceAfter?: number;
  studentIsFree?: boolean;
  /** part de l'enseignant posée sur CETTE séance (undefined = taux habituel) */
  teacherPercentage?: number;
  teacherAmount?: number;
}

/** Numéro de bon, tiré à l'impression — jamais pendant un rendu React, où deux
 *  passages donneraient deux numéros pour la même séance. */
export function makeFreeSeanceNumber(now = new Date()): string {
  return `BSL-${now.getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
}

export function buildFreeSeanceTicket(data: FreeSeanceTicketData, now = new Date()): string {
  const L = LABELS[data.language];
  const { school } = data;
  const locale = data.language === "ar" ? "ar-DZ" : "fr-FR";
  const money = (v: number) => `${fmtAmount(v)} ${L.da}`;

  /** Une ligne, omise quand la donnée manque : une étiquette suivie d'un tiret
   *  n'apprend rien et coûte du papier. */
  const row = (label: string, value: string | undefined | null, mono = false) =>
    value && String(value).trim()
      ? `<tr><th>${label}</th><td${mono ? ' class="mono"' : ""}>${escapeHtml(String(value).trim())}</td></tr>`
      : "";

  const logo = school.logo
    ? `<img src="${escapeHtml(school.logo)}" alt="" class="logo" />`
    : `<div class="logo-fallback">🏫</div>`;

  const contact = [school.phone, school.address].filter(Boolean).map((v) => escapeHtml(String(v)));

  const who = data.isRegisteredStudent
    ? L.registered
    : data.isAnonymous
      ? L.anonymous
      : L.passenger;

  const dateLabel = (() => {
    const d = new Date(data.date.length === 10 ? `${data.date}T12:00:00` : data.date);
    return isNaN(d.getTime())
      ? data.date
      : d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
  })();

  const balanceSection =
    data.isRegisteredStudent && data.balanceBefore !== undefined
      ? `
      <div class="sec">
        <div class="sec-title">${L.balanceTitle}</div>
        <table>
          <tr><th>${L.balanceBefore}</th><td>${money(data.balanceBefore)}</td></tr>
          <tr><th>${L.balanceAfter}</th><td>${money(data.balanceAfter ?? data.balanceBefore)}</td></tr>
        </table>
        ${data.studentIsFree ? `<p class="note">${L.freeStudent}</p>` : ""}
      </div>`
      : "";

  // La part de l'enseignant n'est imprimée que si le guichet l'a POSÉE sur
  // cette séance : sans elle, la séance rejoint les présences du créneau et
  // c'est le taux habituel du prof qui s'applique — rien de propre à ce bon.
  const teacherShareSection =
    data.teacherPercentage !== undefined && data.teacherPercentage !== null
      ? `
      <div class="sec">
        <div class="sec-title">${L.teacherShareTitle}</div>
        <table>
          <tr><th>${L.teacher}</th><td>${escapeHtml(data.teacherName || "-")}</td></tr>
          <tr><th>${L.teacherPct}</th><td>${data.teacherPercentage} %</td></tr>
          <tr><th>${L.teacherAmount}</th><td>${money(data.teacherAmount ?? 0)}</td></tr>
        </table>
      </div>`
      : "";

  const bodyHtml = `
    <div class="bon">
      <div class="head">
        ${logo}
        <div class="school">
          <b>${escapeHtml(school.name || "")}</b>
          ${contact.map((line) => `<span>${line}</span>`).join("")}
        </div>
      </div>

      <div class="title">${L.docTitle}</div>
      <div class="num">${L.receiptNo} ${escapeHtml(makeFreeSeanceNumber(now))}</div>

      <div class="sec">
        <table>
          ${row(L.who, data.personName)}
          <tr><th></th><td>${who}</td></tr>
          ${row(L.phone, data.phone, true)}
          ${row(L.rfid, data.rfid, true)}
          ${row(L.schooling, data.schooling)}
        </table>
      </div>

      <div class="sec">
        <div class="sec-title">${L.seanceTitle}</div>
        <table>
          ${row(L.seance, data.seanceLabel)}
          ${row(L.moduleName, data.moduleName)}
          ${row(L.teacher, data.teacherName)}
          ${row(L.room, data.salleName)}
          ${row(L.time, data.timeLabel, true)}
          ${row(L.date, dateLabel)}
          ${data.isFree ? "" : row(L.method, L.cash)}
        </table>
      </div>

      <div class="amount${data.isFree ? " free" : ""}">
        <span>${data.isFree ? L.offered : L.amount}</span>
        <strong>${money(data.price)}</strong>
      </div>
      ${data.isFree ? `<p class="note">${L.offeredNote(money(data.waived ?? 0))}</p>` : ""}

      ${balanceSection}
      ${teacherShareSection}

      <div class="stamp">
        <span>${now.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" })} ${now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</span>
        <span>${L.cashier}</span>
      </div>

      <p class="note">${L.note}</p>
    </div>
  `;

  return printDocument({
    title: `${L.docTitle} — ${data.personName}`,
    lang: data.language,
    bodyHtml,
    extraCss: TICKET_CSS,
    baseCss: false,
  });
}
