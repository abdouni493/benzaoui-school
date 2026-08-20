import { describe, it, expect } from "vitest";
import { scheduleSlots, slotSpan, salleStartClashes, sessionSalleIds, layoutRow } from "@/lib/helpers";
import type { ScheduleSession } from "@/lib/types";

// Les colonnes d'un tableau d'emploi du temps sont déduites des séances du jour :
// toutes les bornes horaires triées, découpées en intervalles consécutifs.

describe("scheduleSlots", () => {
  it("cuts the day at every start and end", () => {
    expect(
      scheduleSlots([
        { startTime: "08:00", endTime: "09:00" },
        { startTime: "09:00", endTime: "11:00" },
      ]),
    ).toEqual([
      { start: "08:00", end: "09:00" },
      { start: "09:00", end: "11:00" },
    ]);
  });

  it("keeps the gap between two courses as its own column", () => {
    expect(
      scheduleSlots([
        { startTime: "08:00", endTime: "09:00" },
        { startTime: "10:00", endTime: "11:00" },
      ]),
    ).toEqual([
      { start: "08:00", end: "09:00" },
      { start: "09:00", end: "10:00" },
      { start: "10:00", end: "11:00" },
    ]);
  });

  it("splits a long séance where a shorter one starts", () => {
    expect(
      scheduleSlots([
        { startTime: "08:00", endTime: "11:00" },
        { startTime: "09:00", endTime: "10:00" },
      ]),
    ).toEqual([
      { start: "08:00", end: "09:00" },
      { start: "09:00", end: "10:00" },
      { start: "10:00", end: "11:00" },
    ]);
  });

  it("has no column at all without séances, and drops unusable hours", () => {
    expect(scheduleSlots([])).toEqual([]);
    expect(scheduleSlots([{ startTime: "10:00", endTime: "09:00" }])).toEqual([]);
    expect(scheduleSlots([{ startTime: "10:00", endTime: "10:00" }])).toEqual([]);
  });
});

describe("slotSpan", () => {
  const slots = scheduleSlots([
    { startTime: "08:00", endTime: "11:00" },
    { startTime: "09:00", endTime: "10:00" },
  ]); // 08-09 | 09-10 | 10-11

  it("spans exactly the columns the séance covers", () => {
    expect(slotSpan({ startTime: "08:00", endTime: "11:00" }, slots)).toEqual({ index: 0, span: 3 });
    expect(slotSpan({ startTime: "09:00", endTime: "10:00" }, slots)).toEqual({ index: 1, span: 1 });
    expect(slotSpan({ startTime: "10:00", endTime: "11:00" }, slots)).toEqual({ index: 2, span: 1 });
  });

  it("returns nothing for a séance that fits in no column", () => {
    expect(slotSpan({ startTime: "14:00", endTime: "15:00" }, slots)).toBeNull();
    expect(slotSpan({ startTime: "11:00", endTime: "08:00" }, slots)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

const session = (over: Partial<ScheduleSession> & { id: string }): ScheduleSession =>
  ({
    classId: "c1",
    moduleId: "m1",
    groupId: "g1",
    salleId: "s1",
    teacherId: "t1",
    days: ["monday"],
    startTime: "08:00",
    endTime: "09:00",
    ...over,
  }) as ScheduleSession;

describe("sessionSalleIds", () => {
  it("reads the single salle of a cours and every salle of a séance libre", () => {
    expect(sessionSalleIds(session({ id: "a" }))).toEqual(["s1"]);
    expect(
      sessionSalleIds(session({ id: "b", isOpen: true, salleIds: ["s2", "s3"] })),
    ).toEqual(["s2", "s3"]);
  });
});

describe("salleStartClashes", () => {
  const existing = [
    session({ id: "a", salleId: "s1", days: ["monday", "wednesday"], startTime: "08:00" }),
    session({ id: "b", salleId: "s2", days: ["monday"], startTime: "08:00" }),
    session({ id: "c", salleId: "s1", days: ["tuesday"], startTime: "08:00" }),
    session({ id: "d", salleId: "s1", days: ["monday"], startTime: "10:00" }),
  ];

  it("catches the same salle, the same day and the same start", () => {
    const clashes = salleStartClashes(existing, {
      salleIds: ["s1"],
      days: ["monday"],
      startTime: "08:00",
    });
    expect(clashes.map((s) => s.id)).toEqual(["a"]);
  });

  it("says nothing for another salle, another day or another hour", () => {
    const args = { salleIds: ["s1"], days: ["monday"] as ScheduleSession["days"] };
    expect(salleStartClashes(existing, { ...args, startTime: "09:00" })).toEqual([]);
    expect(salleStartClashes(existing, { salleIds: ["s9"], days: ["monday"], startTime: "08:00" })).toEqual([]);
    expect(salleStartClashes(existing, { salleIds: ["s1"], days: ["friday"], startTime: "08:00" })).toEqual([]);
  });

  it("never reports the créneau against itself when it is being edited", () => {
    expect(
      salleStartClashes(existing, {
        id: "a",
        salleIds: ["s1"],
        days: ["monday"],
        startTime: "08:00",
      }),
    ).toEqual([]);
  });

  it("checks every salle of a multi-salle séance libre", () => {
    const clashes = salleStartClashes(existing, {
      salleIds: ["s7", "s2"],
      days: ["monday"],
      startTime: "08:00",
    });
    expect(clashes.map((s) => s.id)).toEqual(["b"]);
  });

  it("has nothing to check without a salle or without a day", () => {
    expect(salleStartClashes(existing, { salleIds: [], days: ["monday"], startTime: "08:00" })).toEqual([]);
    expect(salleStartClashes(existing, { salleIds: ["s1"], days: [], startTime: "08:00" })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Une ligne du tableau « Répartition des salles » : colonnes vides et séances
// posées sur exactement les colonnes qu'elles couvrent.

describe("layoutRow", () => {
  it("fills the gaps before, between and after the séances", () => {
    expect(
      layoutRow([{ item: "cours", index: 1, span: 2 }], 4),
    ).toEqual([
      { kind: "free" },
      { kind: "item", item: "cours", span: 2 },
      { kind: "free" },
    ]);
  });

  it("is all free time when nothing is placed", () => {
    expect(layoutRow([], 3)).toEqual([{ kind: "free" }, { kind: "free" }, { kind: "free" }]);
    expect(layoutRow([], 0)).toEqual([]);
  });

  it("places several séances in column order, whatever order they come in", () => {
    expect(
      layoutRow(
        [
          { item: "b", index: 2, span: 1 },
          { item: "a", index: 0, span: 1 },
        ],
        3,
      ),
    ).toEqual([
      { kind: "item", item: "a", span: 1 },
      { kind: "free" },
      { kind: "item", item: "b", span: 1 },
    ]);
  });

  it("drops a séance that overlaps the one already placed", () => {
    // Deux cours sur la même salle à la même heure : le tableau n'en montre
    // qu'un, sinon les colSpan se recouvrent et toute la ligne se décale.
    expect(
      layoutRow(
        [
          { item: "a", index: 0, span: 2 },
          { item: "b", index: 1, span: 2 },
        ],
        3,
      ),
    ).toEqual([{ kind: "item", item: "a", span: 2 }, { kind: "free" }]);
  });

  it("never spills past the last column", () => {
    const cells = layoutRow([{ item: "a", index: 1, span: 9 }], 3);
    expect(cells).toEqual([{ kind: "free" }, { kind: "item", item: "a", span: 2 }]);
  });

  it("ignores an empty span", () => {
    expect(layoutRow([{ item: "a", index: 0, span: 0 }], 2)).toEqual([
      { kind: "free" },
      { kind: "free" },
    ]);
  });
});
