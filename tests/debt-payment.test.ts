import { describe, expect, it } from "vitest";

import { allocateDebtPayment, studentDebtOf, unbilledChargesByStudent } from "@/lib/helpers";
import type { Student } from "@/lib/types";

/** Un élève réduit à ce que la caisse regarde. */
const stu = (balance: number, registrationDue = 0) =>
  ({ balance, registrationDue }) as Student;

describe("studentDebtOf", () => {
  it("ne voit aucune dette sur un solde positif", () => {
    expect(studentDebtOf(stu(1500))).toEqual({
      sessions: 0,
      registration: 0,
      unbilled: 0,
      total: 0,
      alert: false,
    });
  });

  it("compte les séances suivies non payées", () => {
    // Le cas signalé : l'élève a étudié sans provision, le solde est négatif.
    expect(studentDebtOf(stu(-625))).toEqual({
      sessions: 625,
      registration: 0,
      unbilled: 0,
      total: 625,
      alert: true,
    });
  });

  it("additionne l'inscription impayée et les séances", () => {
    expect(studentDebtOf(stu(-625, 1000))).toEqual({
      sessions: 625,
      registration: 1000,
      unbilled: 0,
      total: 1625,
      alert: true,
    });
  });

  it("réclame l'inscription même quand le solde est créditeur", () => {
    // Un solde positif ne « paie » pas l'inscription tout seul : elle vit dans
    // sa propre colonne, et reste due tant qu'elle n'est pas encaissée.
    expect(studentDebtOf(stu(2000, 1000)).total).toBe(1000);
  });

  it("alerte sur un solde à 0 que des séances facturées n'ont jamais entamé", () => {
    // Le cas signalé : fiche à « 0 DA », historique de présences à 625 DA.
    const debt = studentDebtOf(stu(0), { unbilled: 625 });
    expect(debt.sessions).toBe(0);
    expect(debt.unbilled).toBe(625);
    expect(debt.alert).toBe(true);
  });

  it("laisse `total` à ce que la RPC sait régler", () => {
    // `unbilled` n'est pas une créance de plus : c'est la même dette, restée
    // hors du solde. L'ajouter au total ferait encaisser deux fois.
    expect(studentDebtOf(stu(-625), { unbilled: 625 }).total).toBe(625);
  });
});

describe("unbilledChargesByStudent", () => {
  const att = (studentId: string, amountDeducted: number) => ({ studentId, amountDeducted });
  const tx = (studentId: string, amount: number, type = "deduction") => ({ studentId, amount, type });

  it("ne signale rien quand chaque présence a sa ligne d'historique", () => {
    const gaps = unbilledChargesByStudent({
      attendance: [att("a", 625), att("a", 625)],
      balanceTx: [tx("a", 2000, "topup"), tx("a", -625), tx("a", -625)],
    });
    expect(gaps.get("a")).toBeUndefined();
  });

  it("mesure la séance facturée que l'historique ne porte pas", () => {
    const gaps = unbilledChargesByStudent({
      attendance: [att("a", 625)],
      balanceTx: [tx("a", 625, "topup"), tx("a", -625, "registration")],
    });
    expect(gaps.get("a")).toBe(625);
  });

  it("compte aussi les absences hebdomadaires facturées", () => {
    const gaps = unbilledChargesByStudent({
      attendance: [],
      absencePenalties: [{ studentId: "a", amount: 400 }],
      balanceTx: [],
    });
    expect(gaps.get("a")).toBe(400);
  });

  it("ne signale rien après un remboursement, qui pousse l'écart dans l'autre sens", () => {
    // Séance devenue offerte : la déduction reste dans l'historique, un
    // 'topup' la rend, et la présence repasse à 0 DA.
    const gaps = unbilledChargesByStudent({
      attendance: [att("a", 0)],
      balanceTx: [tx("a", -625), tx("a", 625, "topup")],
    });
    expect(gaps.get("a")).toBeUndefined();
  });

  it("sépare les élèves", () => {
    const gaps = unbilledChargesByStudent({
      attendance: [att("a", 625), att("b", 300)],
      balanceTx: [tx("b", -300)],
    });
    expect(gaps.get("a")).toBe(625);
    expect(gaps.get("b")).toBeUndefined();
  });
});

describe("allocateDebtPayment", () => {
  const debt = studentDebtOf(stu(-1625, 400));

  it("règle l'inscription d'abord, les séances ensuite", () => {
    expect(allocateDebtPayment(2000, debt)).toEqual({
      registration: 400,
      sessions: 1600,
      credited: 0,
    });
  });

  it("porte le surplus au solde", () => {
    expect(allocateDebtPayment(3000, debt)).toEqual({
      registration: 400,
      sessions: 1625,
      credited: 975,
    });
  });

  it("s'arrête à l'inscription quand le versement ne va pas plus loin", () => {
    expect(allocateDebtPayment(300, debt)).toEqual({
      registration: 300,
      sessions: 0,
      credited: 0,
    });
  });

  it("porte tout au solde quand rien n'est dû", () => {
    expect(allocateDebtPayment(500, studentDebtOf(stu(200)))).toEqual({
      registration: 0,
      sessions: 0,
      credited: 500,
    });
  });

  it("ne rend jamais de part négative", () => {
    for (const amount of [0, -100, Number.NaN]) {
      const split = allocateDebtPayment(amount, debt);
      expect(split.registration).toBe(0);
      expect(split.sessions).toBe(0);
      expect(split.credited).toBe(0);
    }
  });

  it("répartit exactement le versement, sans perte ni création", () => {
    for (const amount of [1, 399, 400, 401, 2024, 2025, 2026, 99999]) {
      const split = allocateDebtPayment(amount, debt);
      expect(split.registration + split.sessions + split.credited).toBe(amount);
    }
  });
});
