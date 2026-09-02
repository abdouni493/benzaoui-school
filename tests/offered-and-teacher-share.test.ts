import { describe, it, expect } from "vitest";

import { freePeriodCovering, liveDueFee, teacherShareOf } from "@/lib/helpers";
import type { Student, Subscription } from "@/lib/types";

/** Une période gratuite réduite à ce que la règle regarde. */
const period = (o: Partial<Parameters<typeof freePeriodCovering>[0][number]> = {}) => ({
  active: true,
  startDate: "2026-09-01",
  endDate: "2026-09-07",
  allClasses: false,
  classIds: ["c1"],
  ...o,
});

describe("freePeriodCovering — la règle de gratuité, une seule fois", () => {
  it("couvre les bornes de la fenêtre, incluses", () => {
    const p = [period()];
    expect(freePeriodCovering(p, ["c1"], "2026-09-01")).toBeDefined();
    expect(freePeriodCovering(p, ["c1"], "2026-09-07")).toBeDefined();
    expect(freePeriodCovering(p, ["c1"], "2026-08-31")).toBeUndefined();
    expect(freePeriodCovering(p, ["c1"], "2026-09-08")).toBeUndefined();
  });

  it("ignore une période suspendue", () => {
    expect(freePeriodCovering([period({ active: false })], ["c1"], "2026-09-03")).toBeUndefined();
  });

  it("ne couvre que les classes cochées", () => {
    const p = [period()];
    expect(freePeriodCovering(p, ["c2"], "2026-09-03")).toBeUndefined();
    // Un créneau de séance libre porte PLUSIEURS classes : une seule couverte
    // suffit — c'est ce que fait `class_ids && p_class_ids` côté SQL.
    expect(freePeriodCovering(p, ["c2", "c1"], "2026-09-03")).toBeDefined();
  });

  it("couvre tout le monde quand allClasses est coché, liste vide comprise", () => {
    const p = [period({ allClasses: true, classIds: [] })];
    expect(freePeriodCovering(p, ["c9"], "2026-09-03")).toBeDefined();
  });

  it("ne se laisse pas piéger par une classe absente du créneau", () => {
    // `classId` d'un créneau supprimé arrive à undefined : il ne doit jamais
    // faire correspondre une période par accident.
    const p = [period({ classIds: [] })];
    expect(freePeriodCovering(p, [undefined], "2026-09-03")).toBeUndefined();
  });
});

describe("teacherShareOf — le pourcentage ne porte que sur ce qui a été encaissé", () => {
  it("applique le pourcentage présence par présence", () => {
    expect(
      teacherShareOf(
        [
          { fee: 500, billable: true },
          { fee: 500, billable: true },
        ],
        50,
      ),
    ).toBe(500);
  });

  it("ignore une présence offerte, même si elle a une valeur", () => {
    // Le cas signalé : le créneau montre l'élève, mais l'école n'a rien
    // encaissé sur lui — il ne peut pas faire monter le versement.
    expect(
      teacherShareOf(
        [
          { fee: 600, billable: true },
          { fee: 600, billable: false },
        ],
        50,
      ),
    ).toBe(300);
  });

  it("arrondit chaque présence, comme le scan", () => {
    // 3 × round(325 × 0,5) = 3 × 163 = 489, et non round(975 × 0,5) = 488.
    expect(
      teacherShareOf(
        [
          { fee: 325, billable: true },
          { fee: 325, billable: true },
          { fee: 325, billable: true },
        ],
        50,
      ),
    ).toBe(489);
  });

  it("borne le pourcentage entre 0 et 100", () => {
    expect(teacherShareOf([{ fee: 500, billable: true }], -20)).toBe(0);
    expect(teacherShareOf([{ fee: 500, billable: true }], 250)).toBe(500);
    expect(teacherShareOf([{ fee: 500, billable: true }], NaN)).toBe(0);
  });

  it("rend 0 sur un créneau entièrement offert", () => {
    expect(
      teacherShareOf(
        [
          { fee: 600, billable: false },
          { fee: 600, billable: false },
        ],
        50,
      ),
    ).toBe(0);
  });
});

describe("liveDueFee — une séance non réglée suit le tarif ACTUEL, pas celui du scan", () => {
  const sub = (price: number): Subscription => ({
    id: "sub1",
    sessionId: "ses1",
    pricePerSession: price,
  });
  const student = (discount?: Student["subscriptionDiscounts"]): Student => ({
    id: "stu1",
    firstName: "A",
    lastName: "B",
    birthDate: "",
    phone: "",
    email: "",
    rfid: "",
    balance: 0,
    isFree: false,
    subscriptionIds: ["sub1"],
    subscriptionDiscounts: discount,
  });

  it("chiffre au nouveau prix de l'abonnement, en ignorant le montant figé", () => {
    // Tarif passé de 100 à 200 : la séance encore due vaut 200, pas les 100
    // débités au scan (frozenFee).
    expect(liveDueFee(sub(200), student(), 100)).toBe(200);
  });

  it("applique la remise de l'élève sur le tarif courant", () => {
    // 200 DA, remise -20 % ⇒ 160 DA, exactement ce que le guichet débiterait.
    expect(liveDueFee(sub(200), student({ sub1: { type: "percent", value: 20 } }), 100)).toBe(160);
  });

  it("retombe sur le montant figé quand l'abonnement a disparu", () => {
    expect(liveDueFee(undefined, student(), 100)).toBe(100);
  });

  it("retombe sur le montant figé quand l'élève a disparu", () => {
    expect(liveDueFee(sub(200), undefined, 100)).toBe(100);
  });

  it("compose avec teacherShareOf : nouveau tarif × % × nombre d'élèves", () => {
    // 3 élèves présents, tarif corrigé à 200 DA, prof à 50 %.
    const rows = [1, 2, 3].map(() => ({
      fee: liveDueFee(sub(200), student(), 100),
      billable: true,
    }));
    // 3 × round(200 × 0,5) = 300, et non 3 × round(100 × 0,5) = 150.
    expect(teacherShareOf(rows, 50)).toBe(300);
  });
});
