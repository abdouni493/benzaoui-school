import { describe, it, expect } from "vitest";
import {
  isRollCallOpen,
  rollCallOpensAt,
  minutesToTime,
  timeToMinutes,
  type RollCallPolicy,
} from "@/lib/helpers";

// Quand la feuille de pointage d'une séance s'ouvre. L'école choisit entre une
// ouverture automatique (N minutes avant la séance, ou à heure fixe) et une
// ouverture manuelle ; dans tous les cas la réception peut ouvrir plus tôt.

const lead = (leadMinutes: number): RollCallPolicy => ({
  mode: "lead",
  leadMinutes,
  fixedTime: "08:00",
});
const fixed = (fixedTime: string): RollCallPolicy => ({ mode: "fixed", leadMinutes: 30, fixedTime });
const manual: RollCallPolicy = { mode: "manual", leadMinutes: 30, fixedTime: "08:00" };

describe("timeToMinutes / minutesToTime", () => {
  it("converts both ways", () => {
    expect(timeToMinutes("08:30")).toBe(510);
    expect(minutesToTime(510)).toBe("08:30");
    expect(minutesToTime(0)).toBe("00:00");
  });

  it("never leaves the day, and reads an unusable time as midnight", () => {
    expect(minutesToTime(-90)).toBe("00:00");
    expect(minutesToTime(99_999)).toBe("23:59");
    expect(timeToMinutes("")).toBe(0);
    expect(timeToMinutes("plus tard")).toBe(0);
  });
});

describe("rollCallOpensAt", () => {
  it("takes the lead off the séance start", () => {
    expect(rollCallOpensAt("09:00", lead(30))).toBe("08:30");
    expect(rollCallOpensAt("09:00", lead(0))).toBe("09:00");
    expect(rollCallOpensAt("09:00", lead(90))).toBe("07:30");
  });

  it("never walks back past midnight", () => {
    expect(rollCallOpensAt("00:15", lead(60))).toBe("00:00");
  });

  it("ignores the séance start when the school fixed one hour for the day", () => {
    expect(rollCallOpensAt("09:00", fixed("07:45"))).toBe("07:45");
    expect(rollCallOpensAt("17:00", fixed("07:45"))).toBe("07:45");
  });

  it("opens at no hour at all in manual mode", () => {
    expect(rollCallOpensAt("09:00", manual)).toBeNull();
  });
});

describe("isRollCallOpen", () => {
  const base = {
    sheetDate: "2026-08-21",
    today: "2026-08-21",
    sessionStart: "09:00",
    startedManually: false,
  };

  it("opens by itself once the lead is reached, and not a minute earlier", () => {
    const at = (nowMinutes: number) => isRollCallOpen({ ...base, nowMinutes, policy: lead(30) });
    expect(at(timeToMinutes("08:29"))).toBe(false);
    expect(at(timeToMinutes("08:30"))).toBe(true);
    expect(at(timeToMinutes("09:30"))).toBe(true);
  });

  it("opens at the fixed hour whatever the séance start is", () => {
    const at = (nowMinutes: number) => isRollCallOpen({ ...base, nowMinutes, policy: fixed("08:00") });
    expect(at(timeToMinutes("07:59"))).toBe(false);
    expect(at(timeToMinutes("08:00"))).toBe(true);
  });

  it("stays shut all day in manual mode until the desk starts it", () => {
    const at = (nowMinutes: number, startedManually = false) =>
      isRollCallOpen({ ...base, nowMinutes, startedManually, policy: manual });
    expect(at(timeToMinutes("23:59"))).toBe(false);
    expect(at(timeToMinutes("06:00"), true)).toBe(true);
  });

  it("lets the desk open a séance ahead of its automatic hour", () => {
    expect(
      isRollCallOpen({ ...base, nowMinutes: timeToMinutes("06:00"), policy: lead(30) }),
    ).toBe(false);
    expect(
      isRollCallOpen({
        ...base,
        nowMinutes: timeToMinutes("06:00"),
        startedManually: true,
        policy: lead(30),
      }),
    ).toBe(true);
  });

  it("never opens a day that has not come yet, even started by hand", () => {
    const tomorrow = { ...base, sheetDate: "2026-08-22", nowMinutes: timeToMinutes("23:00") };
    expect(isRollCallOpen({ ...tomorrow, policy: lead(30) })).toBe(false);
    expect(isRollCallOpen({ ...tomorrow, startedManually: true, policy: lead(30) })).toBe(false);
  });

  it("always leaves a past day open, so an oversight can be corrected", () => {
    const yesterday = { ...base, sheetDate: "2026-08-20", nowMinutes: timeToMinutes("00:05") };
    expect(isRollCallOpen({ ...yesterday, policy: lead(30) })).toBe(true);
    expect(isRollCallOpen({ ...yesterday, policy: manual })).toBe(true);
  });
});
