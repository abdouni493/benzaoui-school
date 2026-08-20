"use client";

/**
 * Bon de chargement de solde — ticket de caisse 80 mm.
 *
 * Une recharge est une transaction de trente secondes au guichet : la preuve
 * qu'on remet à la famille est un ticket étroit, pas une facture A4. Le
 * précédent reçu tirait une page entière (en-tête fiscal, tableau des modules,
 * deux cadres de signature) pour dire « +5 000 DA » — sur une imprimante
 * thermique de 80 mm cela sortait en plusieurs dizaines de centimètres de
 * papier, illisible et coûteux.
 *
 * Ce ticket tient dans un seul rectangle, dans cet ordre :
 *   école (logo + nom) · élève · scolarité · accès en ligne · montant · date.
 *
 * Rien d'autre : ce qui ne sert pas à la famille au moment où on lui tend le
 * papier n'y figure pas. Le relevé détaillé reste imprimable depuis la fiche
 * de l'élève.
 */

import type { School, Student } from "@/lib/types";
import type { Language } from "@/lib/store/settings";
import { escapeHtml, printDocument } from "@/lib/printTemplates";

/** Largeur du papier. 80 mm de bobine = 72 mm réellement imprimables sur la
 *  quasi-totalité des têtes thermiques ; 3 mm de marge de chaque côté nous
 *  laissent 74 mm de contenu sans rogner les bords. */
const TICKET_CSS = `
  @page { size: 80mm auto; margin: 3mm; }
  @media print { body { margin: 0; padding: 0; font-size: 10px; } }

  body {
    width: 74mm; margin: 0 auto; padding: 4px 0;
    background: #fff; color: #000;
    font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 10.5px; line-height: 1.25;
  }

  /* Le rectangle unique : tout le bon tient dedans. */
  .bon { border: 1px solid #000; border-radius: 3px; padding: 5px 6px; }

  .bon .head { display: flex; align-items: center; gap: 6px; padding-bottom: 4px; border-bottom: 1px solid #000; }
  .bon .logo { width: 12mm; height: 12mm; object-fit: contain; flex: none; }
  .bon .logo-fallback { width: 12mm; height: 12mm; flex: none; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 1px dashed #999; border-radius: 3px; }
  .bon .school { min-width: 0; }
  .bon .school b { display: block; font-size: 12px; font-weight: 800; line-height: 1.15; }
  .bon .school span { display: block; font-size: 8.5px; color: #333; }

  .bon .title { margin: 4px 0 0; text-align: center; font-size: 10.5px; font-weight: 800; letter-spacing: .4px; text-transform: uppercase; }
  .bon .num { text-align: center; font-family: monospace; font-size: 8.5px; color: #333; }

  /* Sections : un filet pointillé, pas un cadre de plus — chaque bordure
     supplémentaire coûte deux millimètres de papier. */
  .bon .sec { margin-top: 4px; padding-top: 3px; border-top: 1px dashed #888; }
  .bon .sec-title { font-size: 8px; font-weight: 800; letter-spacing: .5px; text-transform: uppercase; color: #444; margin-bottom: 2px; }

  .bon table { width: 100%; border-collapse: collapse; font-size: 10px; margin: 0; }
  .bon th, .bon td { padding: 1px 0; border: 0; background: none; vertical-align: top; text-transform: none; letter-spacing: 0; font-size: 10px; }
  .bon th { width: 34%; text-align: start; font-weight: 500; color: #444; }
  .bon td { text-align: end; font-weight: 700; word-break: break-word; }
  .bon td.mono { font-family: monospace; }

  /* Le montant : la seule ligne qu'on doit pouvoir lire à bout de bras. */
  .bon .amount { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; margin-top: 4px; padding: 3px 5px; border: 1.5px solid #000; border-radius: 3px; }
  .bon .amount span { font-size: 9px; font-weight: 800; letter-spacing: .3px; text-transform: uppercase; }
  .bon .amount strong { font-size: 14px; font-weight: 800; white-space: nowrap; }

  .bon .stamp { margin-top: 4px; padding-top: 3px; border-top: 1px dashed #888; display: flex; justify-content: space-between; font-size: 9px; }
  .bon .note { margin: 3px 0 0; text-align: center; font-size: 7.5px; font-style: italic; color: #444; line-height: 1.2; }
`;

const LABELS = {
  fr: {
    docTitle: "Bon de chargement de solde",
    receiptNo: "N°",
    student: "Élève",
    born: "Né(e) le",
    phone: "Téléphone",
    rfid: "Carte RFID",
    schooling: "Scolarité",
    accessTitle: "Accès à l'espace en ligne",
    email: "Identifiant",
    password: "Mot de passe",
    noPassword: "— non enregistré",
    operation: "Opération",
    amount: "Montant chargé",
    oldBalance: "Ancien solde",
    registration: "Frais d'inscription",
    newBalance: "Nouveau solde",
    cashier: "Caisse",
    note: "Document confidentiel — à remettre en main propre au parent ou à l'élève.",
    da: "DA",
  },
  ar: {
    docTitle: "وصل شحن الرصيد",
    receiptNo: "رقم",
    student: "التلميذ",
    born: "تاريخ الميلاد",
    phone: "الهاتف",
    rfid: "البطاقة",
    schooling: "المستوى",
    accessTitle: "الدخول إلى الفضاء الرقمي",
    email: "المعرّف",
    password: "كلمة المرور",
    noPassword: "— غير مسجلة",
    operation: "العملية",
    amount: "المبلغ المشحون",
    oldBalance: "الرصيد السابق",
    registration: "حقوق التسجيل",
    newBalance: "الرصيد الجديد",
    cashier: "الصندوق",
    note: "وثيقة سرية — تُسلّم مباشرة إلى الولي أو التلميذ.",
    da: "دج",
  },
} as const;

export interface RechargeTicketData {
  school: School;
  student: Student;
  /** identifiants de l'espace en ligne ; `password` vide quand la réception ne
   *  l'a jamais enregistré (comptes créés avant la fonctionnalité) */
  password: string;
  /** scolarité en clair : « Lycée · 3eme Année · Sciences » */
  schooling: string;
  /** montant versé, toujours positif */
  amount: number;
  /** libellé saisi au guichet (« Recharge de solde », « Premier versement »…) */
  description: string;
  /** solde AVANT l'opération */
  balanceBefore: number;
  /** solde après l'opération, relu dans le magasin après l'écriture */
  balanceAfter: number;
  /** frais d'inscription réglés au passage (0 = aucun) */
  registrationSettled: number;
  language: Language;
}

/** Numéro de bon, tiré à l'impression — jamais pendant un rendu React, où deux
 *  passages donneraient deux numéros pour le même versement. */
export function makeRechargeNumber(now = new Date()): string {
  return `BCS-${now.getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
}

/** Séparateur de milliers par espace : « 12 500 ». `Intl` insère une espace
 *  insécable étroite (U+202F) que certains pilotes thermiques rendent en
 *  point d'interrogation. */
export function fmtAmount(value: number): string {
  const n = Math.round(value);
  const sign = n < 0 ? "-" : "";
  return sign + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Le bon complet, prêt pour `printHtmlDocument`. */
export function buildRechargeTicket(data: RechargeTicketData, now = new Date()): string {
  const L = LABELS[data.language];
  const { school, student } = data;
  const receiptNo = makeRechargeNumber(now);
  const locale = data.language === "ar" ? "ar-DZ" : "fr-FR";

  const money = (v: number) => `${fmtAmount(v)} ${L.da}`;

  /** Une ligne du tableau, omise quand la donnée manque : une étiquette suivie
   *  d'un tiret n'apprend rien et coûte du papier. */
  const row = (label: string, value: string | undefined | null, mono = false) =>
    value && value.trim()
      ? `<tr><th>${label}</th><td${mono ? ' class="mono"' : ""}>${escapeHtml(value.trim())}</td></tr>`
      : "";

  const born = student.birthDate
    ? new Date(
        student.birthDate.length === 10 ? `${student.birthDate}T12:00:00` : student.birthDate,
      )
    : null;
  const bornLabel =
    born && !isNaN(born.getTime())
      ? born.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" })
      : "";

  const logo = school.logo
    ? `<img src="${escapeHtml(school.logo)}" alt="" class="logo" />`
    : `<div class="logo-fallback">🏫</div>`;

  const contact = [school.phone, school.address].filter(Boolean).map(escapeHtml);

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
      <div class="num">${L.receiptNo} ${receiptNo}</div>

      <div class="sec">
        <table>
          ${row(L.student, `${student.lastName} ${student.firstName}`)}
          ${row(L.born, bornLabel)}
          ${row(L.phone, student.phone, true)}
          ${row(L.rfid, student.rfid, true)}
          ${row(L.schooling, data.schooling)}
        </table>
      </div>

      <div class="sec">
        <div class="sec-title">${L.accessTitle}</div>
        <table>
          ${row(L.email, student.email, true)}
          <tr>
            <th>${L.password}</th>
            <td class="mono">${data.password ? escapeHtml(data.password) : L.noPassword}</td>
          </tr>
        </table>
      </div>

      <div class="amount">
        <span>${L.amount}</span>
        <strong>+${money(data.amount)}</strong>
      </div>

      <div class="sec">
        <table>
          ${row(L.operation, data.description)}
          <tr><th>${L.oldBalance}</th><td>${money(data.balanceBefore)}</td></tr>
          ${
            data.registrationSettled > 0
              ? `<tr><th>${L.registration}</th><td>-${money(data.registrationSettled)}</td></tr>`
              : ""
          }
          <tr><th>${L.newBalance}</th><td>${money(data.balanceAfter)}</td></tr>
        </table>
      </div>

      <div class="stamp">
        <span>${now.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" })} ${now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</span>
        <span>${L.cashier}</span>
      </div>

      <p class="note">${L.note}</p>
    </div>
  `;

  return printDocument({
    title: `${L.docTitle} — ${student.lastName} ${student.firstName}`,
    lang: data.language,
    bodyHtml,
    extraCss: TICKET_CSS,
  });
}
