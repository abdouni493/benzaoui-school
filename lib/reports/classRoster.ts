"use client";

/**
 * Liste imprimable des élèves d'une classe, ou d'un de ses emplois du temps :
 * en-tête de l'école, le créneau (module, groupe, jours, enseignant), puis un
 * tableau — solde, dette, présences — avec les totaux et les débiteurs mis en
 * évidence. C'est la feuille qu'on donne à l'enseignant ou qu'on garde au
 * guichet pour les relances.
 */

import type { School } from "@/lib/types";
import type { Language } from "@/lib/store/settings";
import {
  bannerHtml,
  escapeHtml,
  letterheadHtml,
  metaFooterHtml,
  printDocument,
  signaturesHtml,
} from "@/lib/printTemplates";

export interface RosterRow {
  name: string;
  phone: string;
  card: string;
  balance: number;
  debt: number;
  presences: number;
  absences: number;
  /** YYYY-MM-DD de la dernière présence, si connue */
  lastPresence?: string;
}

export interface RosterInfo {
  /** « 3eme Année · Sciences » */
  className: string;
  /** « Maths · G1 — Samedi 08:00-10:00 · M. Benali · Salle 3 » ; absent = toute la classe */
  scheduleLabel?: string;
  /** chiffres affichés en tête (déjà formatés) */
  figures: Array<{ label: string; value: string }>;
}

const fmtDate = (iso?: string) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

export function buildClassRosterReport(opts: {
  school: School;
  lang: Language;
  info: RosterInfo;
  rows: RosterRow[];
  /** n'imprimer que les débiteurs */
  debtorsOnly?: boolean;
}): string {
  const rows = opts.debtorsOnly ? opts.rows.filter((r) => r.debt > 0) : opts.rows;
  const totalDebt = rows.reduce((sum, r) => sum + r.debt, 0);
  const debtors = rows.filter((r) => r.debt > 0).length;

  const title = opts.debtorsOnly ? "Élèves en dette" : "Liste des élèves";
  const subtitle = [escapeHtml(opts.info.className), opts.info.scheduleLabel ? escapeHtml(opts.info.scheduleLabel) : "Toute la classe"]
    .filter(Boolean)
    .join(" — ");

  const figures = opts.info.figures
    .map(
      (f) =>
        `<div class="fig"><span>${escapeHtml(f.label)}</span><strong>${escapeHtml(f.value)}</strong></div>`,
    )
    .join("");

  const body = rows.length
    ? rows
        .map(
          (r, i) => `
        <tr class="${r.debt > 0 ? "debt" : ""}">
          <td class="ctr">${i + 1}</td>
          <td><strong>${escapeHtml(r.name)}</strong></td>
          <td>${escapeHtml(r.phone || "—")}</td>
          <td>${escapeHtml(r.card || "—")}</td>
          <td class="num ${r.balance < 0 ? "neg" : ""}">${r.balance} DA</td>
          <td class="num ${r.debt > 0 ? "neg" : ""}">${r.debt > 0 ? `${r.debt} DA` : "—"}</td>
          <td class="ctr">${r.presences}</td>
          <td class="ctr">${r.absences}</td>
          <td class="ctr">${fmtDate(r.lastPresence)}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="9" class="ctr">Aucun élève.</td></tr>`;

  const bodyHtml = `
    ${letterheadHtml(opts.school)}
    ${bannerHtml(title, subtitle)}
    <div class="figs">${figures}</div>
    <div class="frame">
      <h3>${title} (${rows.length})</h3>
      <table>
        <thead>
          <tr>
            <th class="ctr">#</th>
            <th>Élève</th>
            <th>Téléphone</th>
            <th>Carte</th>
            <th class="num">Solde</th>
            <th class="num">Dette</th>
            <th class="ctr">Présences</th>
            <th class="ctr">Absences</th>
            <th class="ctr">Dernière présence</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <div class="summary-card">
      <h3>Récapitulatif</h3>
      <div class="summary-line"><span>Élèves listés</span><strong>${rows.length}</strong></div>
      <div class="summary-line"><span>Élèves en dette</span><strong>${debtors}</strong></div>
      <div class="net-pay-box ${totalDebt > 0 ? "negative" : ""}"><span>Total des dettes</span><span>${totalDebt} DA</span></div>
    </div>
    ${signaturesHtml("Visa de l'administration", "Visa de l'enseignant")}
    ${metaFooterHtml(opts.school.name, opts.lang)}`;

  return printDocument({
    title: `${title} — ${opts.info.className}`,
    lang: opts.lang,
    bodyHtml,
    extraCss: `
      .figs { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin-bottom: 16px; }
      .fig { border: 1px solid #e8e6f4; background: #fff; border-radius: 10px; padding: 8px 10px; }
      .fig span { display: block; font-size: 0.72em; color: #5c567a; text-transform: uppercase; letter-spacing: 0.3px; }
      .fig strong { font-size: 1.05em; color: #1e1b4b; }
      tr.debt td { background: #fef2f2; }
      .neg { color: #b91c1c; }
    `,
  });
}

/** CSV (séparateur « ; », lisible directement par Excel en français). */
export function buildClassRosterCsv(rows: RosterRow[]): string {
  const cell = (v: string | number) => {
    const s = String(v ?? "");
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["Élève", "Téléphone", "Carte", "Solde (DA)", "Dette (DA)", "Présences", "Absences", "Dernière présence"];
  const lines = rows.map((r) =>
    [r.name, r.phone, r.card, r.balance, r.debt, r.presences, r.absences, fmtDate(r.lastPresence)]
      .map(cell)
      .join(";"),
  );
  // BOM : sans lui, Excel lit les accents de travers.
  return "﻿" + [header.join(";"), ...lines].join("\r\n");
}
