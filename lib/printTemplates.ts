"use client";

/**
 * Shared building blocks for the printable documents (teacher pay report,
 * student payments invoice, timetable sheet, séance libre receipt).
 *
 * Every document is a full HTML string passed to `printHtmlDocument()` from
 * lib/print.ts (same-tab hidden-iframe printing — never window.open).
 * Templates are bilingual-aware: pass the app language ("fr" | "ar") and the
 * document flips to RTL with Arabic chrome labels.
 */

import type { School } from "@/lib/types";
import type { Language } from "@/lib/store/settings";

/** A4-oriented base stylesheet shared by all print documents. Uses logical
 *  text-align (start/end) so the same rules work in RTL. */
export const PRINT_BASE_CSS = `
  @page { size: A4; margin: 10mm; }
  @media print {
    body { padding: 0; margin: 0; background: #fff; color: #000; font-size: 11px; }
    .no-print { display: none; }
    .page-break { page-break-before: always; }
    tr { page-break-inside: avoid; }
  }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Roboto, Helvetica, Arial, sans-serif; padding: 25px; color: #1e1b4b; background-color: #faf9ff; }

  /* Letterhead */
  .letterhead { display: flex; justify-content: space-between; align-items: stretch; gap: 12px; border: 1px solid #e8e6f4; background: #fff; padding: 15px; border-radius: 12px; margin-bottom: 20px; }
  .school-identity { display: flex; align-items: center; gap: 15px; }
  .school-logo, .school-logo-fallback { width: 65px; height: 65px; border-radius: 12px; object-fit: cover; }
  .school-logo-fallback { background: #f5f3ff; border: 1px solid #ddd; display: flex; align-items: center; justify-content: center; font-size: 2.2em; }
  .school-details h2 { margin: 0; font-size: 1.4em; color: #7c3aed; font-weight: 800; }
  .school-details p { margin: 2px 0; font-size: 0.85em; color: #5c567a; }
  .school-tax-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; border-inline-start: 2px solid #7c3aed; padding-inline-start: 15px; align-items: center; }
  .tax-item { font-size: 0.78em; color: #5c567a; }
  .tax-item strong { color: #1e1b4b; font-family: monospace; }

  /* Title banner */
  .doc-title-banner { background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: #fff; padding: 15px; border-radius: 12px; margin-bottom: 20px; text-align: center; }
  .doc-title-banner h1 { margin: 0; font-size: 1.5em; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
  .doc-title-banner p { margin: 5px 0 0; font-size: 0.9em; opacity: 0.92; }

  /* Frames */
  .frames-grid { display: grid; grid-template-columns: 1fr; gap: 20px; }
  .frame { border: 1px solid #e8e6f4; border-top: 4px solid #7c3aed; background: #fff; padding: 16px; border-radius: 12px; }
  .frame-info { border-top-color: #3b82f6; }
  .frame-success { border-top-color: #22c55e; }
  .frame-warning { border-top-color: #eab308; }
  .frame-danger { border-top-color: #ef4444; }
  .frame h3 { margin: 0 0 12px; font-size: 1.05em; color: #1e1b4b; border-bottom: 1px dashed #e8e6f4; padding-bottom: 6px; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; margin-top: 5px; font-size: 0.9em; }
  th, td { padding: 8px 10px; text-align: start; border-bottom: 1px solid #f1f0fb; }
  th { background-color: #fcfbff; font-weight: 700; color: #5c567a; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.3px; }
  tr:last-child td { border-bottom: 0; }
  .num { text-align: end; font-family: monospace; font-weight: 700; }
  .ctr { text-align: center; }

  /* Badges */
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75em; font-weight: bold; text-align: center; }
  .badge-primary { background-color: #f5f3ff; color: #7c3aed; }
  .badge-success { background-color: #dcfce7; color: #15803d; }
  .badge-danger { background-color: #fee2e2; color: #b91c1c; }
  .badge-warning { background-color: #fef9c3; color: #854d0e; }

  /* Summary card */
  .summary-card { background: #fdfcff; border: 2px solid #7c3aed; border-radius: 12px; padding: 15px; margin-top: 20px; }
  .summary-card h3 { margin-top: 0; border-bottom: 1px solid #7c3aed; padding-bottom: 6px; color: #7c3aed; }
  .summary-line { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f1f0fb; font-size: 0.95em; }
  .summary-line:last-child { border-bottom: 0; padding-bottom: 0; }
  .net-pay-box { display: flex; justify-content: space-between; background: #f0fdf4; border: 2px solid #22c55e; border-radius: 10px; padding: 12px; margin-top: 10px; color: #15803d; font-size: 1.15em; font-weight: 800; }
  .net-pay-box.negative { background: #fdf2f2; border-color: #ef4444; color: #b91c1c; }

  /* Signatures */
  .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; }
  .signature-block { border: 1px dashed #c0b6e9; border-radius: 10px; background: #fff; padding: 15px; height: 100px; display: flex; flex-direction: column; justify-content: space-between; }
  .signature-label { font-size: 0.8em; font-weight: bold; text-transform: uppercase; color: #5c567a; text-align: center; }

  .meta-text { text-align: center; font-size: 0.75em; color: #999; margin-top: 30px; font-style: italic; }
`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Full-document wrapper: doctype, dir/lang, base CSS, body. */
export function printDocument(opts: {
  title: string;
  lang: Language;
  bodyHtml: string;
  extraCss?: string;
}): string {
  const dir = opts.lang === "ar" ? "rtl" : "ltr";
  return `<!DOCTYPE html>
<html lang="${opts.lang}" dir="${dir}">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(opts.title)}</title>
    <style>${PRINT_BASE_CSS}${opts.extraCss ?? ""}</style>
  </head>
  <body>${opts.bodyHtml}</body>
</html>`;
}

/** School letterhead: logo, name, address, phone, e-mail + fiscal identifiers. */
export function letterheadHtml(school: School): string {
  const logo = school.logo
    ? `<img src="${school.logo}" alt="logo" class="school-logo" />`
    : `<div class="school-logo-fallback">🏫</div>`;
  return `
    <div class="letterhead">
      <div class="school-identity">
        ${logo}
        <div class="school-details">
          <h2>${escapeHtml(school.name)}</h2>
          <p>${escapeHtml(school.description || "")}</p>
          <p>📍 ${escapeHtml(school.address || "-")} | 📞 ${escapeHtml(school.phone || "-")}</p>
          <p>✉️ ${escapeHtml(school.email || "-")}</p>
        </div>
      </div>
      <div class="school-tax-grid">
        <div class="tax-item">NIF: <strong>${escapeHtml(school.nif || "-")}</strong></div>
        <div class="tax-item">NIS: <strong>${escapeHtml(school.nis || "-")}</strong></div>
        <div class="tax-item">RC: <strong>${escapeHtml(school.registreCommerce || "-")}</strong></div>
        <div class="tax-item">Art. Fiscal: <strong>${escapeHtml(school.articleFiscal || "-")}</strong></div>
      </div>
    </div>`;
}

export function bannerHtml(title: string, subtitle?: string): string {
  return `
    <div class="doc-title-banner">
      <h1>${title}</h1>
      ${subtitle ? `<p>${subtitle}</p>` : ""}
    </div>`;
}

export function signaturesHtml(leftLabel: string, rightLabel: string): string {
  return `
    <div class="signatures">
      <div class="signature-block"><span class="signature-label">${leftLabel}</span></div>
      <div class="signature-block"><span class="signature-label">${rightLabel}</span></div>
    </div>`;
}

export function metaFooterHtml(schoolName: string, lang: Language): string {
  const stamp = new Date().toLocaleString(lang === "ar" ? "ar-DZ" : "fr-DZ");
  const text =
    lang === "ar"
      ? `وثيقة صادرة إلكترونيًا عن نظام تسيير مدرسة ${escapeHtml(schoolName)} بتاريخ ${stamp}`
      : `Document généré électroniquement par le système de gestion de l'école ${escapeHtml(schoolName)} le ${stamp}`;
  return `<div class="meta-text">${text}</div>`;
}

/** dd/mm/yyyy in the document's language conventions. */
export function fmtDate(dateStr: string | undefined, lang: Language): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr.length === 10 ? `${dateStr}T12:00:00` : dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(lang === "ar" ? "ar-DZ" : "fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function fmtDateTime(dateStr: string | undefined, lang: Language): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const locale = lang === "ar" ? "ar-DZ" : "fr-FR";
  return `${d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" })} ${d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
}
