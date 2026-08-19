import { describe, expect, it } from "vitest";
import { enrollmentExpiry } from "@/lib/helpers";

/**
 * Une inscription ne doit JAMAIS naître expirée.
 *
 * L'ancienne règle appelait `addMonths(start, periodMonths ?? 0)` : une
 * formation sans durée déclarée recevait une date de fin égale à sa date de
 * début. Dès le lendemain, scan_card refusait la carte avec
 * « abonnement expiré » alors que l'élève venait d'être inscrit.
 */
describe("enrollmentExpiry", () => {
  it("ne pose aucune date de fin quand la formation ne déclare pas de durée", () => {
    expect(enrollmentExpiry("2026-08-20")).toBeUndefined();
    expect(enrollmentExpiry("2026-08-20", 0)).toBeUndefined();
    expect(enrollmentExpiry("2026-08-20", undefined)).toBeUndefined();
  });

  it("ne pose aucune date de fin sur une durée négative ou absurde", () => {
    expect(enrollmentExpiry("2026-08-20", -3)).toBeUndefined();
    expect(enrollmentExpiry("2026-08-20", 0.5)).toBeUndefined();
  });

  it("décale bien la fin de la durée déclarée", () => {
    expect(enrollmentExpiry("2026-08-20", 1)).toBe("2026-09-20");
    expect(enrollmentExpiry("2026-08-20", 6)).toBe("2027-02-20");
    expect(enrollmentExpiry("2026-08-20", 12)).toBe("2027-08-20");
  });

  it("cale sur le dernier jour du mois quand la date n'existe pas", () => {
    // 31 janvier + 1 mois : février n'a pas de 31.
    expect(enrollmentExpiry("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("la date de fin est toujours POSTÉRIEURE à la date de début", () => {
    const start = "2026-08-20";
    for (const months of [1, 2, 3, 6, 9, 12, 24]) {
      expect(enrollmentExpiry(start, months)!).not.toBe(start);
      expect(enrollmentExpiry(start, months)! > start).toBe(true);
    }
  });

  it("sans date de début, il n'y a rien à calculer", () => {
    expect(enrollmentExpiry("", 6)).toBeUndefined();
  });
});
