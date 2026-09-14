import { describe, it, expect } from "vitest";

import { buildPayMatrix, shortDate } from "@/lib/teacherPayMatrix";
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

describe("shortDate — l'en-tête d'une colonne", () => {
  it("garde le jour et le mois, jamais le millésime (vingt colonnes à tenir)", () => {
    expect(shortDate("2026-09-14")).toBe("14/09");
  });

  it("rend la valeur telle quelle quand elle n'est pas une date", () => {
    expect(shortDate("")).toBe("");
    expect(shortDate("n/a")).toBe("n/a");
  });
});
