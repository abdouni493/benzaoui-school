import { describe, expect, it } from "vitest";

import { allocateDebtPayment, balanceDriftByStudent, studentDebtOf } from "@/lib/helpers";
import type { Student } from "@/lib/types";

/** Un élève réduit à ce que la caisse regarde. */
const stu = (balance: number, registrationDue = 0) =>
  ({ balance, registrationDue }) as Student;

describe("studentDebtOf", () => {
  it("ne voit aucune dette sur un solde positif", () => {
    expect(studentDebtOf(stu(1500))).toEqual({
      sessions: 0,
      registration: 0,
      total: 0,
      drift: 0,
      alert: false,
    });
  });

  it("compte les séances suivies non payées", () => {
    // Le cas signalé : l'élève a étudié sans provision, le solde est négatif.
    expect(studentDebtOf(stu(-625))).toEqual({
      sessions: 625,
      registration: 0,
      total: 625,
      drift: 0,
      alert: true,
    });
  });

  it("additionne l'inscription impayée et les séances", () => {
    expect(studentDebtOf(stu(-625, 1000))).toEqual({
      sessions: 625,
      registration: 1000,
      total: 1625,
      drift: 0,
      alert: true,
    });
  });

  it("réclame l'inscription même quand le solde est créditeur", () => {
    // Un solde positif ne « paie » pas l'inscription tout seul : elle vit dans
    // sa propre colonne, et reste due tant qu'elle n'est pas encaissée.
    expect(studentDebtOf(stu(2000, 1000)).total).toBe(1000);
  });

  it("ne réclame RIEN à un élève au solde créditeur, quoi qu'aient coûté ses séances", () => {
    // La panne signalée : une fiche à +1250 DA annonçait « DETTE : 600 DA ».
    // Le solde porte déjà toutes les séances suivies — il n'y a rien à
    // ré-additionner par-dessus.
    const debt = studentDebtOf(stu(1250));
    expect(debt.total).toBe(0);
    expect(debt.alert).toBe(false);
  });

  it("n'ajoute JAMAIS l'écart d'historique au montant à régler", () => {
    // L'écart solde ↔ historique est une incohérence à réparer en base, pas
    // une créance. L'encaisser reviendrait à facturer un bug à la famille.
    const debt = studentDebtOf(stu(-625), { drift: -900 });
    expect(debt.total).toBe(625);
    expect(debt.drift).toBe(-900);
  });
});

describe("balanceDriftByStudent", () => {
  const st = (id: string, balance: number) => ({ id, balance });
  const tx = (studentId: string, amount: number) => ({ studentId, amount });

  it("ne signale rien quand le solde vaut la somme de son historique", () => {
    const drift = balanceDriftByStudent({
      students: [st("a", 1250)],
      balanceTx: [tx("a", 2500), tx("a", -625), tx("a", -625)],
    });
    expect(drift.get("a")).toBeUndefined();
  });

  it("mesure l'écart, avec son signe", () => {
    // Solde en retard sur l'historique : des débits n'y sont jamais arrivés.
    const drift = balanceDriftByStudent({
      students: [st("a", 0)],
      balanceTx: [tx("a", 625)],
    });
    expect(drift.get("a")).toBe(-625);
  });

  it("ne se laisse pas tromper par une correction de tarif créditée en topup", () => {
    // Le cas qui faisait inventer une dette : un changement de prix rétroactif
    // rend 25 DA par un 'topup'. L'ancien recoupement présences ↔ déductions y
    // voyait un écart ; le solde, lui, est parfaitement juste.
    const drift = balanceDriftByStudent({
      students: [st("a", 1250)],
      balanceTx: [tx("a", 1000), tx("a", -1000), tx("a", 2500), tx("a", -650), tx("a", 25), tx("a", -625)],
    });
    expect(drift.get("a")).toBeUndefined();
  });

  it("se TAIT sur un historique incomplet plutôt que d'inventer une dette", () => {
    // La panne d'origine : PostgREST plafonne à 1000 lignes sans le dire, et
    // l'application voyait les débits sans leurs recettes. Sur une table
    // amputée, on ne signale plus rien du tout.
    const drift = balanceDriftByStudent({
      students: [st("a", 1250)],
      balanceTx: [tx("a", -625)],
      complete: false,
    });
    expect(drift.size).toBe(0);
  });

  it("sépare les élèves", () => {
    const drift = balanceDriftByStudent({
      students: [st("a", 0), st("b", 300)],
      balanceTx: [tx("a", 625), tx("b", 300)],
    });
    expect(drift.get("a")).toBe(-625);
    expect(drift.get("b")).toBeUndefined();
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
