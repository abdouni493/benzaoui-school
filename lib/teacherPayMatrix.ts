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

import type { TeacherPaymentDetail } from "@/lib/types";

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
      row.totalStudents += cell.students;
      row.totalShare += cell.share;
      row.freeShare += cell.freeShare;
      row.freeCount += cell.freeCount;
      row.gross += cell.gross;
    }
    // `share` d'une séance inclut déjà la part des présences rémunérées ; la
    // part des séances libres à taux dédié se calcule à part et s'ajoute.
    row.amount = row.totalShare + row.freeShare;
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
    hasFreeColumn: totals.freeCount > 0 || totals.freeShare > 0,
  };
}

/** "2026-09-12" → "12/09" — l'en-tête d'une colonne de dates, où le millésime
 *  tiendrait mal sur vingt colonnes (il est rappelé sous le tableau). */
export function shortDate(dateKey: string): string {
  const [, m, d] = (dateKey || "").split("-");
  return m && d ? `${d}/${m}` : dateKey;
}
