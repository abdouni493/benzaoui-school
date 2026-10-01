/**
 * Le tableau d'un règlement d'enseignant : un emploi du temps par ligne, une
 * date de séance par colonne.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * L'écran de règlement listait une ligne par séance datée : « 12/09 — Maths »,
 * « 14/09 — Maths », « 14/09 — Physique »… trente lignes plates. On ne pouvait
 * pas répondre à la seule question que pose un enseignant qu'on paie : « sur
 * MON cours de maths, combien d'élèves sont venus, à quelles dates, et combien
 * ça me fait ? »
 *
 * Le tableau répond exactement à ça :
 *
 *     Niveau (emploi du temps) │ 12/09 │ 14/09 │ 19/09 │ Total │ Montant
 *     Maths — 3AS Sciences     │   12  │   14  │   11  │   37  │  9 250
 *
 * et le montant se lit à voix haute : « tarif de la séance × pourcentage du
 * prof × nombre total d'élèves ».
 *
 * Le tableau est construit à partir de l'INSTANTANÉ FIGÉ du règlement
 * (`TeacherPaymentDetail[]`, une ligne par séance datée), le même que celui
 * déjà stocké sur `teacher_payments.details`. Conséquence voulue : l'écran de
 * paiement et le bon imprimé — aujourd'hui comme à la réimpression dans six
 * mois — composent le MÊME tableau à partir de la MÊME donnée. Aucune des deux
 * faces ne peut se mettre à afficher un total que l'autre ignore.
 */

import type { PriceCount, TeacherPaymentDetail } from "@/lib/types";

// ---- Les montants : exacts au centime, arrondis UNE fois ----------------------

/** Ramène une somme au centime : additionner des 437,5 en virgule flottante
 *  laisse traîner des 0,000001 qui finiraient affichés. */
export const roundCents = (v: number): number =>
  Math.round(((Number.isFinite(v) ? v : 0) + Number.EPSILON) * 100) / 100;

/** « 80272,5 » / « 9188 » — le centime n'apparaît que s'il existe. */
export function formatAmount(v: number): string {
  const r = roundCents(v);
  if (Number.isInteger(r)) return String(r);
  return r.toFixed(2).replace(/0+$/, "").replace(".", ",");
}

/**
 * Les tarifs réellement payés, regroupés : `[625, 625, 700]` →
 * `[{ price: 625, count: 2 }, { price: 700, count: 1 }]`, le tarif le plus
 * fréquent en tête.
 */
export function priceBreakdown(fees: number[]): PriceCount[] {
  const counts = new Map<number, number>();
  for (const f of fees) {
    const price = roundCents(f);
    counts.set(price, (counts.get(price) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([price, count]) => ({ price, count }))
    .sort((a, b) => b.count - a.count || a.price - b.price);
}

/** « 625 DA × 179 + 700 DA × 4 » — ce qu'on multiplie par le pourcentage. */
export function priceTerms(prices: PriceCount[], da = "DA"): string {
  const terms = prices
    .filter((p) => p.count > 0)
    .map((p) => `${formatAmount(p.price)} ${da} × ${p.count}`);
  return terms.length > 1 ? `(${terms.join(" + ")})` : terms[0] ?? "";
}

/**
 * Répartit un montant ENTIER en parts entières proportionnelles aux poids, la
 * somme des parts valant exactement le montant (méthode du plus fort reste).
 *
 * C'est ce qui manquait au « montant fixe » : chaque séance recevait
 * `Math.round(montant × sa recette / recette totale)`, et 10 000 DA répartis
 * sur trois séances égales en faisaient 9 999 sur le bon imprimé.
 */
export function apportion(weights: number[], total: number): number[] {
  const n = weights.length;
  const target = Math.max(0, Math.round(total || 0));
  if (n === 0) return [];
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sum = w.reduce((s, x) => s + x, 0);
  // Aucun poids : parts égales, plutôt que tout sur la première ligne.
  const exact = sum > 0 ? w.map((x) => (target * x) / sum) : w.map(() => target / n);
  const out = exact.map((x) => Math.floor(x + 1e-9));
  let left = target - out.reduce((s, x) => s + x, 0);
  // Les dinars restants vont aux plus forts restes ; à égalité, à la plus
  // grosse part, puis à la première — toujours le même résultat.
  const order = exact
    .map((x, i) => ({ i, rest: x - out[i], x }))
    .sort((a, b) => b.rest - a.rest || b.x - a.x || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % n, left--) out[order[k].i] += 1;
  return out;
}

/**
 * `apportion` à deux étages : d'abord entre les groupes (les emplois du temps),
 * puis, dans chaque groupe, entre ses lignes (les séances datées). Une ligne du
 * tableau reçoit ainsi la part entière la plus proche de SA part exacte, au
 * lieu d'additionner les écarts de ses séances.
 */
export function apportionByGroup(items: { group: string; weight: number }[], total: number): number[] {
  const groups = new Map<string, number[]>();
  items.forEach((it, i) => {
    const list = groups.get(it.group);
    if (list) list.push(i);
    else groups.set(it.group, [i]);
  });
  const keys = [...groups.keys()];
  const weightOf = (i: number) => (Number.isFinite(items[i].weight) ? Math.max(items[i].weight, 0) : 0);
  const anyWeight = items.some((_, i) => weightOf(i) > 0);
  // Sans aucun poids, chaque LIGNE pèse autant : un groupe de trois séances
  // reçoit trois parts, pas une.
  const w = (i: number) => (anyWeight ? weightOf(i) : 1);
  const groupParts = apportion(
    keys.map((k) => groups.get(k)!.reduce((s, i) => s + w(i), 0)),
    total,
  );
  const out = new Array<number>(items.length).fill(0);
  keys.forEach((k, gi) => {
    const idx = groups.get(k)!;
    apportion(idx.map(w), groupParts[gi]).forEach((v, j) => {
      out[idx[j]] = v;
    });
  });
  return out;
}

/** Une case du tableau : le croisement d'un emploi du temps et d'une date. */
export interface MatrixCell {
  /** élèves présents ET rémunérés sur cette séance */
  students: number;
  /** part de l'enseignant sur ces présences */
  share: number;
  /** part due au titre des séances libres à pourcentage dédié de ce jour-là */
  freeShare: number;
  freeCount: number;
  /** ce que l'école a encaissé sur la séance */
  gross: number;
  startTime: string;
  endTime: string;
}

/** Une ligne du tableau : UN emploi du temps de l'enseignant. */
export interface MatrixRow {
  sessionId: string;
  /** libellé du créneau — « Maths », « Séance libre — Physique »… */
  title: string;
  /** la colonne « Niveau » : classe / niveau du créneau */
  className: string;
  groupName: string;
  /** prix d'UNE séance, tel qu'il a servi au calcul */
  unitPrice: number;
  percentage: number;
  /** les présences de la ligne par tarif réellement payé — vide pour un
   *  règlement écrit avant que l'instantané ne les porte */
  prices: PriceCount[];
  /** dateKey → case */
  cells: Map<string, MatrixCell>;
  /** les dates de CE créneau, du plus ancien au plus récent */
  dates: string[];
  seances: number;
  totalStudents: number;
  totalShare: number;
  freeShare: number;
  freeCount: number;
  gross: number;
  /** ce que la ligne rapporte à l'enseignant, séances libres comprises */
  amount: number;
}

export interface PayMatrix {
  /** union triée des dates de toutes les lignes — les colonnes du tableau */
  dates: string[];
  rows: MatrixRow[];
  totalStudents: number;
  totalShare: number;
  freeShare: number;
  freeCount: number;
  gross: number;
  amount: number;
  seances: number;
  /**
   * Y a-t-il au moins une séance libre à pourcentage dédié dans ce règlement ?
   *
   * La colonne correspondante ne doit apparaître QUE dans ce cas : une école
   * qui n'utilise pas cette option ne veut pas d'une colonne de zéros, et le
   * cahier des charges est explicite là-dessus.
   */
  hasFreeColumn: boolean;
}

/** Somme d'un champ numérique, en tolérant les lignes anciennes qui l'ignorent. */
const num = (v: number | undefined) => (typeof v === "number" && isFinite(v) ? v : 0);

/**
 * Le tableau, à partir des lignes figées du règlement.
 *
 * Deux lignes portant la même (date, créneau) sont fusionnées : c'est le cas
 * quand un créneau a produit une ligne « cours » et une ligne « séance libre »
 * le même jour.
 */
export function buildPayMatrix(details: TeacherPaymentDetail[]): PayMatrix {
  const rows = new Map<string, MatrixRow>();
  const allDates = new Set<string>();
  const pricesByRow = new Map<string, Map<number, number>>();

  for (const d of details ?? []) {
    if (!d || !d.sessionId) continue;
    allDates.add(d.dateKey);

    let row = rows.get(d.sessionId);
    if (!row) {
      row = {
        sessionId: d.sessionId,
        title: d.title || d.moduleName || "Séance",
        className: d.className || "—",
        groupName: d.groupName || "—",
        unitPrice: num(d.unitPrice),
        percentage: num(d.percentage),
        prices: [],
        cells: new Map(),
        dates: [],
        seances: 0,
        totalStudents: 0,
        totalShare: 0,
        freeShare: 0,
        freeCount: 0,
        gross: 0,
        amount: 0,
      };
      rows.set(d.sessionId, row);
    }
    // Le tarif et le pourcentage d'un créneau ne changent pas d'une séance à
    // l'autre ; on retient la première valeur renseignée plutôt qu'un 0 posé
    // par une ligne ancienne.
    if (row.unitPrice === 0) row.unitPrice = num(d.unitPrice);
    if (row.percentage === 0) row.percentage = num(d.percentage);

    if (Array.isArray(d.prices)) {
      const byPrice = pricesByRow.get(d.sessionId) ?? new Map<number, number>();
      for (const p of d.prices) {
        if (!p || num(p.count) <= 0) continue;
        byPrice.set(num(p.price), (byPrice.get(num(p.price)) ?? 0) + num(p.count));
      }
      pricesByRow.set(d.sessionId, byPrice);
    }

    const cell = row.cells.get(d.dateKey) ?? {
      students: 0,
      share: 0,
      freeShare: 0,
      freeCount: 0,
      gross: 0,
      startTime: d.startTime ?? "",
      endTime: d.endTime ?? "",
    };
    cell.students += num(d.presents);
    cell.share += num(d.share);
    cell.freeShare += num(d.freeShare);
    cell.freeCount += num(d.freeCount);
    cell.gross += num(d.gross);
    if (!cell.startTime) cell.startTime = d.startTime ?? "";
    if (!cell.endTime) cell.endTime = d.endTime ?? "";
    row.cells.set(d.dateKey, cell);
  }

  const out: MatrixRow[] = [];
  for (const row of rows.values()) {
    row.dates = [...row.cells.keys()].sort();
    row.seances = row.dates.length;
    for (const cell of row.cells.values()) {
      cell.share = roundCents(cell.share);
      cell.freeShare = roundCents(cell.freeShare);
      row.totalStudents += cell.students;
      row.totalShare += cell.share;
      row.freeShare += cell.freeShare;
      row.freeCount += cell.freeCount;
      row.gross += cell.gross;
    }
    row.totalShare = roundCents(row.totalShare);
    row.freeShare = roundCents(row.freeShare);
    // `share` d'une séance inclut déjà la part des présences rémunérées ; la
    // part des séances libres à taux dédié se calcule à part et s'ajoute.
    row.amount = roundCents(row.totalShare + row.freeShare);
    const byPrice = pricesByRow.get(row.sessionId);
    if (byPrice) {
      row.prices = [...byPrice.entries()]
        .map(([price, count]) => ({ price, count }))
        .sort((a, b) => b.count - a.count || a.price - b.price);
    }
    out.push(row);
  }

  out.sort((a, b) => b.amount - a.amount || a.title.localeCompare(b.title));

  const dates = [...allDates].sort();
  const totals = out.reduce(
    (acc, r) => ({
      totalStudents: acc.totalStudents + r.totalStudents,
      totalShare: acc.totalShare + r.totalShare,
      freeShare: acc.freeShare + r.freeShare,
      freeCount: acc.freeCount + r.freeCount,
      gross: acc.gross + r.gross,
      amount: acc.amount + r.amount,
      seances: acc.seances + r.seances,
    }),
    { totalStudents: 0, totalShare: 0, freeShare: 0, freeCount: 0, gross: 0, amount: 0, seances: 0 },
  );

  return {
    dates,
    rows: out,
    ...totals,
    totalShare: roundCents(totals.totalShare),
    freeShare: roundCents(totals.freeShare),
    amount: roundCents(totals.amount),
    hasFreeColumn: totals.freeCount > 0 || totals.freeShare > 0,
  };
}

/**
 * Ce que la ligne multiplie, à recalculer à la main :
 * « (625 DA × 179 + 700 DA × 4) × 70 % ».
 *
 * L'ancienne formule — « tarif du cours × % × élèves » — supposait que chaque
 * présent avait payé le tarif du cours. Un passager à 700 DA sur un cours à
 * 625 DA la faussait : « 625 × 70 % × 183 » affichait 80 362 DA quand la
 * calculatrice donnait 80 062,5. Les règlements antérieurs, sans détail des
 * tarifs, gardent l'ancienne lecture.
 */
export function rowFormulaTerms(row: MatrixRow, da = "DA"): string {
  if (row.prices.length > 0) return priceTerms(row.prices, da);
  return row.unitPrice > 0 && row.totalStudents > 0
    ? priceTerms([{ price: row.unitPrice, count: row.totalStudents }], da)
    : "";
}

/** "2026-09-12" → "12/09" — l'en-tête d'une colonne de dates, où le millésime
 *  tiendrait mal sur vingt colonnes (il est rappelé sous le tableau). */
export function shortDate(dateKey: string): string {
  const [, m, d] = (dateKey || "").split("-");
  return m && d ? `${d}/${m}` : dateKey;
}
