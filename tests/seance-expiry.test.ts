import { describe, it, expect } from "vitest";
import { isExpiredOpenSeance, visibleTimetableSessions } from "@/lib/helpers";

// Une séance libre quitte l'emploi du temps quand sa période est écoulée : sa
// `periodEnd` est PASSÉE (antérieure à aujourd'hui). Le dernier jour compte
// encore comme actif, aligné sur le guichet et le pointage.

const TODAY = "2026-08-30";

describe("isExpiredOpenSeance", () => {
  it("marks a séance libre whose periodEnd is before today as expired", () => {
    expect(
      isExpiredOpenSeance({ isOpen: true, periodEnd: "2026-08-29" }, TODAY),
    ).toBe(true);
  });

  it("keeps a séance libre active on its very last day", () => {
    expect(
      isExpiredOpenSeance({ isOpen: true, periodEnd: TODAY }, TODAY),
    ).toBe(false);
  });

  it("keeps a séance libre active while its period still runs", () => {
    expect(
      isExpiredOpenSeance({ isOpen: true, periodEnd: "2026-09-15" }, TODAY),
    ).toBe(false);
  });

  it("never expires a regular cours — it carries no period", () => {
    expect(isExpiredOpenSeance({ isOpen: false, periodEnd: "2020-01-01" }, TODAY)).toBe(false);
    expect(isExpiredOpenSeance({ periodEnd: "2020-01-01" }, TODAY)).toBe(false);
  });

  it("never expires a séance libre with no end date", () => {
    expect(isExpiredOpenSeance({ isOpen: true }, TODAY)).toBe(false);
    expect(isExpiredOpenSeance({ isOpen: true, periodEnd: "" }, TODAY)).toBe(false);
  });
});

describe("visibleTimetableSessions", () => {
  it("drops expired séances libres, keeps cours and live séances libres", () => {
    const sessions = [
      { id: "cours", isOpen: false, periodEnd: undefined },
      { id: "live", isOpen: true, periodEnd: "2026-09-01" },
      { id: "lastday", isOpen: true, periodEnd: TODAY },
      { id: "expired", isOpen: true, periodEnd: "2026-08-01" },
    ];
    expect(visibleTimetableSessions(sessions, TODAY).map((s) => s.id)).toEqual([
      "cours",
      "live",
      "lastday",
    ]);
  });
});
