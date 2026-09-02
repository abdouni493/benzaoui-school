import { describe, it, expect } from "vitest";

import { freePeriodCovering, teacherShareOf } from "@/lib/helpers";

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
