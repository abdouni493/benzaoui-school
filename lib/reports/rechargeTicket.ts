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
import { TICKET_PAGE_CSS, escapeHtml, printDocument } from "@/lib/printTemplates";

/** Le ticket est composé à la largeur réelle du rouleau (voir TICKET_PAGE_CSS)
 *  et non plus mis à l'échelle depuis une page A4 : les tailles ci-dessous sont
 *  donc celles qui sortent de la tête thermique. Elles visent 72 mm utiles —
 *  assez grandes pour se lire à bout de bras, assez serrées pour que le bon
 *  tienne sur une dizaine de centimètres de papier.
 *
 *  Les écarts verticaux sont en millimètres : sur une thermique, un « padding »
 *  en pixels ne veut rien dire, une marge de 1,5 mm se compte en papier. */
const TICKET_CSS = `
  ${TICKET_PAGE_CSS}

  /* Tout est noir franc et gras. Une tête thermique ne sait pas nuancer : un
     gris est rendu en trame de points, qui à 203 ppp sort délavé et pâlit
     encore avec le papier. La hiérarchie se joue donc sur la graisse et la
     taille — jamais sur la couleur. */
  body { padding: 1mm 0; font-size: 12px; line-height: 1.3; font-weight: 600; }

  /* Le rectangle unique : tout le bon tient dedans, sur toute la largeur. */
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

  /* Sections : un filet pointillé, pas un cadre de plus — chaque bordure
     supplémentaire coûte deux millimètres de papier. */
  .bon .sec { margin-top: 1.5mm; padding-top: 1.2mm; border-top: 1px dashed #000; }
  .bon .sec-title { font-size: 9.5px; font-weight: 800; letter-spacing: .5px; text-transform: uppercase; margin-bottom: .8mm; }

  /* « table-layout: fixed » : sans lui, un identifiant long écrase la colonne des
     étiquettes au lieu de revenir à la ligne. */
  .bon table { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 0; }
  .bon th, .bon td { padding: .5mm 0; border: 0; background: none; vertical-align: top; text-transform: none; letter-spacing: 0; font-size: 11.5px; line-height: 1.25; color: #000; }
  /* L'étiquette reste plus légère que la valeur — 700 contre 800 — sinon la
     colonne de gauche pèse autant que la donnée qu'on cherche. */
  .bon th { width: 34%; text-align: start; font-weight: 700; }
  .bon td { text-align: end; font-weight: 800; word-break: break-word; }
  .bon td.mono { font-family: monospace; font-size: 11px; }

  /* Le montant : la seule ligne qu'on doit pouvoir lire à bout de bras. */
  .bon .amount { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; margin-top: 1.5mm; padding: 1.2mm 2mm; border: 1.8px solid #000; border-radius: 3px; }
  .bon .amount span { font-size: 10.5px; font-weight: 800; letter-spacing: .3px; text-transform: uppercase; }
  .bon .amount strong { font-size: 18px; font-weight: 800; white-space: nowrap; }

  .bon .stamp { margin-top: 1.5mm; padding-top: 1.2mm; border-top: 1px dashed #000; display: flex; justify-content: space-between; gap: 2mm; font-size: 10px; font-weight: 700; }
  .bon .note { margin: 1.2mm 0 0; text-align: center; font-size: 9px; font-weight: 700; font-style: italic; line-height: 1.25; }
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
    baseCss: false,
  });
}
