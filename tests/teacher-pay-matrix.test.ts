import { describe, it, expect } from "vitest";

import {
  apportion,
  apportionByGroup,
  buildPayMatrix,
  formatAmount,
  priceBreakdown,
  roundCents,
  rowFormulaTerms,
  shortDate,
} from "@/lib/teacherPayMatrix";
import type { TeacherPaymentDetail } from "@/lib/types";

/** Une ligne de l'instantané figé d'un règlement, réduite à ce que le tableau
 *  regarde. */
const detail = (o: Partial<TeacherPaymentDetail> = {}): TeacherPaymentDetail => ({
  dateKey: "2026-09-14",
  sessionId: "s1",
  title: "Maths",
  moduleName: "Maths",
  groupName: "G1",
  className: "3AS Sciences",
  startTime: "08:00",
  endTime: "10:00",
  presents: 0,
  passagers: 0,
  gross: 0,
  share: 0,
  ...o,
});

describe("buildPayMatrix — un cours par ligne, une date par colonne", () => {
  it("construit les colonnes à partir de l'UNION des dates, triées", () => {
    const m = buildPayMatrix([
      detail({ dateKey: "2026-09-19", sessionId: "s1" }),
      detail({ dateKey: "2026-09-12", sessionId: "s1" }),
      // Une date que seul l'AUTRE cours a vue doit quand même être une colonne,
      // sinon la ligne du premier cours n'aurait pas la même largeur.
      detail({ dateKey: "2026-09-15", sessionId: "s2", title: "Physique" }),
    ]);
    expect(m.dates).toEqual(["2026-09-12", "2026-09-15", "2026-09-19"]);
  });

  it("une case vide (pas de séance ce jour-là) se distingue d'une case à zéro", () => {
    const m = buildPayMatrix([
      detail({ dateKey: "2026-09-12", sessionId: "s1", presents: 12 }),
      detail({ dateKey: "2026-09-15", sessionId: "s2", title: "Physique", presents: 0 }),
    ]);
    const maths = m.rows.find((r) => r.sessionId === "s1")!;
    // Maths n'avait pas séance le 15 : la case n'existe pas du tout.
    expect(maths.cells.get("2026-09-15")).toBeUndefined();
    // Physique avait séance le 15, mais personne n'est venu : 0, pas « rien ».
    const phys = m.rows.find((r) => r.sessionId === "s2")!;
    expect(phys.cells.get("2026-09-15")?.students).toBe(0);
  });

  it("le montant se lit « tarif × pourcentage × élèves » de l'exemple du guichet", () => {
    // 100 élèves sur toutes les séances, 500 DA la séance, 50 % pour le prof.
    // 500 × 50 % = 250, × 100 = 25 000.
    const rows = Array.from({ length: 4 }, (_, i) =>
      detail({
        dateKey: `2026-09-0${i + 1}`,
        presents: 25,
        gross: 25 * 500,
        share: 25 * 250,
        unitPrice: 500,
        percentage: 50,
      }),
    );
    const m = buildPayMatrix(rows);
    expect(m.totalStudents).toBe(100);
    expect(m.rows[0].unitPrice).toBe(500);
    expect(m.rows[0].percentage).toBe(50);
    expect(m.amount).toBe(25_000);
  });

  it("fusionne deux lignes du même (date, créneau) au lieu d'en faire deux", () => {
    const m = buildPayMatrix([
      detail({ presents: 3, share: 300 }),
      detail({ presents: 2, share: 200, freeShare: 240, freeCount: 1 }),
    ]);
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].cells.size).toBe(1);
    expect(m.rows[0].totalStudents).toBe(5);
    expect(m.rows[0].totalShare).toBe(500);
    expect(m.rows[0].freeShare).toBe(240);
    // Le montant de la ligne inclut les séances libres à taux dédié.
    expect(m.rows[0].amount).toBe(740);
  });

  it("la colonne « séances libres » n'existe QUE s'il y en a", () => {
    const sans = buildPayMatrix([detail({ presents: 4, share: 400 })]);
    expect(sans.hasFreeColumn).toBe(false);

    const avec = buildPayMatrix([
      detail({ presents: 4, share: 400, freeCount: 1, freeShare: 240 }),
    ]);
    expect(avec.hasFreeColumn).toBe(true);
    expect(avec.freeShare).toBe(240);
  });

  it("retient le tarif et le taux même quand une ligne ancienne les ignore", () => {
    // Les règlements écrits AVANT le tableau n'ont ni `unitPrice` ni
    // `percentage`. Une seule ligne qui les porte suffit à expliquer la ligne.
    const m = buildPayMatrix([
      detail({ dateKey: "2026-09-12", presents: 5, share: 500 }),
      detail({ dateKey: "2026-09-19", presents: 5, share: 500, unitPrice: 500, percentage: 50 }),
    ]);
    expect(m.rows[0].unitPrice).toBe(500);
    expect(m.rows[0].percentage).toBe(50);
  });

  it("ignore une ligne sans créneau plutôt que d'inventer une ligne fantôme", () => {
    const m = buildPayMatrix([detail({ sessionId: "" }), detail({ presents: 2, share: 200 })]);
    expect(m.rows).toHaveLength(1);
    expect(m.totalStudents).toBe(2);
  });

  it("un instantané vide donne un tableau vide, pas une erreur", () => {
    const m = buildPayMatrix([]);
    expect(m.rows).toEqual([]);
    expect(m.dates).toEqual([]);
    expect(m.amount).toBe(0);
    expect(m.hasFreeColumn).toBe(false);
  });

  it("les lignes descendent du montant le plus élevé au plus faible", () => {
    const m = buildPayMatrix([
      detail({ sessionId: "s1", title: "Maths", share: 100 }),
      detail({ sessionId: "s2", title: "Physique", share: 900 }),
    ]);
    expect(m.rows.map((r) => r.title)).toEqual(["Physique", "Maths"]);
  });
});

describe("la formule d'une ligne retombe sur son montant (cas Amine Mohamed)", () => {
  // 3AS Sciences / A, vendredi 14:30, 70 % : 179 présences badgées à 625 DA et
  // 4 passagers à 700 DA sur quatre vendredis. L'écran imprimait
  // « 625 × 70% × 183 = 80 362 DA » — la calculatrice en donne 80 062,5.
  const week = (dateKey: string, regular: number, passagers: number) =>
    detail({
      dateKey,
      sessionId: "sci-a",
      presents: regular + passagers,
      passagers,
      unitPrice: 625,
      percentage: 70,
      share: (regular * 625 * 70 + passagers * 700 * 70) / 100,
      prices: [
        { price: 625, count: regular },
        ...(passagers ? [{ price: 700, count: passagers }] : []),
      ],
    });

  const m = buildPayMatrix([
    week("2026-09-04", 33, 0),
    week("2026-09-11", 40, 0),
    week("2026-09-18", 51, 1),
    week("2026-09-25", 55, 3),
  ]);
  const row = m.rows[0];

  it("regroupe les présences par tarif réellement payé", () => {
    expect(row.prices).toEqual([
      { price: 625, count: 179 },
      { price: 700, count: 4 },
    ]);
    expect(row.totalStudents).toBe(183);
  });

  it("écrit une formule qu'on peut refaire à la main", () => {
    expect(rowFormulaTerms(row)).toBe("(625 DA × 179 + 700 DA × 4)");
    // (111 875 + 2 800) × 70 % = 80 272,5
    expect(row.totalShare).toBe(80_272.5);
    expect(formatAmount(row.totalShare)).toBe("80272,5");
  });

  it("garde l'ancienne lecture pour un règlement sans détail des tarifs", () => {
    const old = buildPayMatrix([detail({ presents: 21, share: 9_198, unitPrice: 625, percentage: 70 })]);
    expect(rowFormulaTerms(old.rows[0])).toBe("625 DA × 21");
  });
});

describe("formatAmount / roundCents — le centime n'apparaît que s'il existe", () => {
  it("affiche les entiers tels quels et les demi-dinars avec une virgule", () => {
    expect(formatAmount(96_898)).toBe("96898");
    expect(formatAmount(96_897.5)).toBe("96897,5");
    expect(formatAmount(406.25)).toBe("406,25");
    expect(formatAmount(-0.5)).toBe("-0,5");
  });

  it("efface les restes de virgule flottante", () => {
    expect(roundCents(0.1 + 0.2)).toBe(0.3);
    expect(priceBreakdown([625, 700, 625])).toEqual([
      { price: 625, count: 2 },
      { price: 700, count: 1 },
    ]);
  });
});

describe("apportion — un montant fixe se répartit sans perdre un dinar", () => {
  it("10 000 DA sur trois séances égales font 10 000, pas 9 999", () => {
    const parts = apportion([1, 1, 1], 10_000);
    expect(parts.reduce((s, x) => s + x, 0)).toBe(10_000);
    expect(parts.sort()).toEqual([3333, 3333, 3334]);
  });

  it("suit les poids, et partage à parts égales quand aucun poids n'existe", () => {
    expect(apportion([3_000, 1_000], 2_000)).toEqual([1_500, 500]);
    expect(apportion([0, 0], 101).reduce((s, x) => s + x, 0)).toBe(101);
    expect(apportion([], 50)).toEqual([]);
  });

  it("à deux étages, chaque emploi du temps reçoit la part entière la plus proche de la sienne", () => {
    const parts = apportionByGroup(
      [
        { group: "maths", weight: 1 },
        { group: "maths", weight: 1 },
        { group: "physique", weight: 1 },
      ],
      1_000,
    );
    expect(parts.reduce((s, x) => s + x, 0)).toBe(1_000);
    // 2/3 de 1 000 = 666,67 → 667 pour les maths, réparties sur leurs séances.
    expect(parts[0] + parts[1]).toBe(667);
    expect(parts[2]).toBe(333);
  });
});

describe("shortDate — l'en-tête d'une colonne", () => {
  it("garde le jour et le mois, jamais le millésime (vingt colonnes à tenir)", () => {
    expect(shortDate("2026-09-14")).toBe("14/09");
  });

  it("rend la valeur telle quelle quand elle n'est pas une date", () => {
    expect(shortDate("")).toBe("");
    expect(shortDate("n/a")).toBe("n/a");
  });
});
