import { describe, expect, it } from "vitest";

import { allocateDebtPayment, studentDebtOf } from "@/lib/helpers";
import type { Student } from "@/lib/types";

/** Un élève réduit à ce que la caisse regarde. */
const stu = (balance: number, registrationDue = 0) =>
  ({ balance, registrationDue }) as Student;

describe("studentDebtOf", () => {
  it("ne voit aucune dette sur un solde positif", () => {
    expect(studentDebtOf(stu(1500))).toEqual({ sessions: 0, registration: 0, total: 0 });
  });

  it("compte les séances suivies non payées", () => {
    // Le cas signalé : l'élève a étudié sans provision, le solde est négatif.
    expect(studentDebtOf(stu(-625))).toEqual({ sessions: 625, registration: 0, total: 625 });
  });

  it("additionne l'inscription impayée et les séances", () => {
    expect(studentDebtOf(stu(-625, 1000))).toEqual({
      sessions: 625,
      registration: 1000,
      total: 1625,
    });
  });

  it("réclame l'inscription même quand le solde est créditeur", () => {
    // Un solde positif ne « paie » pas l'inscription tout seul : elle vit dans
    // sa propre colonne, et reste due tant qu'elle n'est pas encaissée.
    expect(studentDebtOf(stu(2000, 1000)).total).toBe(1000);
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
