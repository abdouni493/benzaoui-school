import { describe, it, expect } from "vitest";

import { isoFromSchoolInput, schoolDateTimeInput, schoolDateTimeLabel } from "@/lib/helpers";
import {
  absenceWeekOf,
  chargesWithoutPresence,
  contradictedPenalties,
  historyTotal,
  isAbsenceTxOf,
  pairAbsenceLines,
} from "@/lib/studentRepair";
import type { AbsencePenalty, AttendanceRecord, BalanceTransaction, ScheduleSession } from "@/lib/types";

// Le cas réel d'octobre 2026, avec des identifiants de fixture : un cours de
// science, groupe D, le mardi 15 h 30 ; la classe « cls-3s ».
const SCIENCE = "mod-science";
const PHYSIQUE = "mod-physique";
const session = (o: Partial<ScheduleSession>) =>
  ({
    id: "se-d",
    classId: "cls-3s",
    moduleId: SCIENCE,
    groupId: "grp-d",
    salleId: "sal-1",
    teacherId: "tea-1",
    days: ["tuesday"],
    startTime: "15:30",
    endTime: "18:00",
    ...o,
  }) as ScheduleSession;
const sessions = [
  session({}),
  session({ id: "se-a", groupId: "grp-a", startTime: "13:30", endTime: "15:30" }),
  session({ id: "se-phys", moduleId: PHYSIQUE, days: ["saturday"], startTime: "09:00" }),
  session({ id: "se-other-class", classId: "cls-1l" }),
];

const att = (o: Partial<AttendanceRecord>) =>
  ({
    id: "att-1",
    studentId: "stu-1",
    sessionId: "se-d",
    timestamp: "2026-10-13T14:30:00+00:00",
    amountDeducted: 625,
    status: "present",
    ...o,
  }) as AttendanceRecord;

const pen = (o: Partial<AbsencePenalty>) =>
  ({
    id: "pen-1",
    studentId: "stu-1",
    subscriptionId: "sub-d",
    sessionId: "se-d",
    moduleId: SCIENCE,
    periodStart: "2026-10-09",
    periodEnd: "2026-10-15",
    amount: 625,
    balanceAfter: 625,
    createdAt: "2026-10-16T06:30:03+00:00",
    ...o,
  }) as AbsencePenalty;

const tx = (o: Partial<BalanceTransaction>) =>
  ({
    id: "tx-1",
    studentId: "stu-1",
    amount: -625,
    date: "2026-10-16T06:30:03+00:00",
    type: "deduction",
    description: "Absence hebdomadaire — science (D) — semaine du 09/10/2026 au 15/10/2026 — solde: 625 DA",
    moduleId: SCIENCE,
    ...o,
  }) as BalanceTransaction;

describe("contradictedPenalties", () => {
  it("reconnaît l'absence de la semaine du 09/10 contredite par la présence du mardi 13/10", () => {
    // La présence a été saisie le lundi 19 : après la facturation du vendredi.
    const found = contradictedPenalties({ penalties: [pen({})], attendance: [att({})], sessions });
    expect(found).toHaveLength(1);
    expect(found[0].presences.map((a) => a.id)).toEqual(["att-1"]);
  });

  it("compte une présence dans un AUTRE groupe du même cours (rattrapage)", () => {
    const found = contradictedPenalties({
      penalties: [pen({})],
      attendance: [att({ sessionId: "se-a", timestamp: "2026-10-13T12:30:00Z" })],
      sessions,
    });
    expect(found).toHaveLength(1);
  });

  it("garde l'absence quand la présence est hors de la semaine, d'un autre module ou d'une autre classe", () => {
    const attendance = [
      // jeudi 08/10 : la semaine d'AVANT
      att({ id: "a-before", timestamp: "2026-10-08T14:30:00Z" }),
      // vendredi 16/10 : la semaine d'APRÈS
      att({ id: "a-after", timestamp: "2026-10-16T08:00:00Z" }),
      att({ id: "a-phys", sessionId: "se-phys", timestamp: "2026-10-10T08:00:00Z" }),
      att({ id: "a-class", sessionId: "se-other-class" }),
      att({ id: "a-other-student", studentId: "stu-2" }),
    ];
    expect(contradictedPenalties({ penalties: [pen({})], attendance, sessions })).toEqual([]);
  });

  it("lit le jour à l'heure de l'école : 23 h 30 UTC le jeudi 15 est déjà vendredi à Alger", () => {
    const late = att({ timestamp: "2026-10-15T23:30:00Z" });
    expect(contradictedPenalties({ penalties: [pen({})], attendance: [late], sessions })).toEqual([]);
    const early = att({ timestamp: "2026-10-08T23:30:00Z" }); // vendredi 09 à 00 h 30 à Alger
    expect(contradictedPenalties({ penalties: [pen({})], attendance: [early], sessions })).toHaveLength(1);
  });

  it("ignore une absence (status absent) : elle ne prouve aucune présence", () => {
    const absent = att({ status: "absent", amountDeducted: 0 });
    expect(contradictedPenalties({ penalties: [pen({})], attendance: [absent], sessions })).toEqual([]);
  });
});

describe("pairAbsenceLines", () => {
  it("retrouve la ligne d'une absence par module et semaine, sans exiger le montant", () => {
    expect(isAbsenceTxOf(tx({ amount: -300 }), pen({}))).toBe(true);
    expect(isAbsenceTxOf(tx({ moduleId: PHYSIQUE }), pen({}))).toBe(false);
    expect(isAbsenceTxOf(tx({ description: "Séance science (D)" }), pen({}))).toBe(false);
  });

  it("donne à chacune des deux absences d'un même module SA ligne, groupe compris", () => {
    // Inscrit en science A ET en science D : deux absences la même semaine.
    const penA = pen({ id: "pen-a", subscriptionId: "sub-a", sessionId: "se-a" });
    const penD = pen({ id: "pen-d", createdAt: "2026-10-16T06:30:04+00:00" });
    const lineD = tx({ id: "tx-d" });
    const lineA = tx({ id: "tx-a", description: lineD.description.replace("(D)", "(A)") });
    const groups: Record<string, string> = { "se-a": "A", "se-d": "D" };
    const pairs = pairAbsenceLines([penD, penA], [lineD, lineA], (p) => groups[p.sessionId ?? ""]);
    expect(pairs.get("pen-a")).toBe("tx-a");
    expect(pairs.get("pen-d")).toBe("tx-d");
  });

  it("ne rend AUCUNE ligne à une absence dont la ligne a déjà été supprimée", () => {
    // C'est ce qui remboursait deux fois : sans ligne, rien à rembourser.
    const pairs = pairAbsenceLines([pen({ id: "pen-a" }), pen({ id: "pen-b" })], [tx({})]);
    expect(pairs.size).toBe(1);
  });
});

describe("chargesWithoutPresence", () => {
  it("retrouve la séance du 26/09 payée mais disparue avec son emploi du temps", () => {
    const balanceTx = [
      tx({ id: "t-0926", date: "2026-09-26T15:06:16Z", description: "Séance science (B) (16:00-18:00)" }),
      tx({ id: "t-1006", date: "2026-10-06T16:38:33Z", description: "Présence: science (D) (15:30-17:30)" }),
      tx({ id: "t-topup", amount: 2500, type: "topup", description: "Dépôt solde", moduleId: undefined }),
      tx({ id: "t-old", date: "2026-09-12T08:00:00Z", description: "Séance physique (B)", moduleId: undefined }),
    ];
    const attendance = [att({ timestamp: "2026-10-06T16:38:33Z" })];
    const orphans = chargesWithoutPresence({ studentId: "stu-1", balanceTx, attendance, sessions });
    expect(orphans.map((t) => t.id)).toEqual(["t-0926"]);
  });

  it("une seule présence ne couvre qu'une seule ligne du même jour", () => {
    const balanceTx = [
      tx({ id: "t1", date: "2026-10-06T14:00:00Z", description: "Séance science (A)" }),
      tx({ id: "t2", date: "2026-10-06T16:00:00Z", description: "Séance science (D)" }),
    ];
    const orphans = chargesWithoutPresence({
      studentId: "stu-1",
      balanceTx,
      attendance: [att({ timestamp: "2026-10-06T14:00:00Z" })],
      sessions,
    });
    expect(orphans.map((t) => t.id)).toEqual(["t2"]);
  });
});

describe("absenceWeekOf", () => {
  it("ancre la semaine sur le vendredi et la ferme le jeudi", () => {
    expect(absenceWeekOf("2026-10-13")).toEqual({ start: "2026-10-09", end: "2026-10-15" });
    expect(absenceWeekOf("2026-10-09")).toEqual({ start: "2026-10-09", end: "2026-10-15" });
    expect(absenceWeekOf("2026-10-15")).toEqual({ start: "2026-10-09", end: "2026-10-15" });
    expect(absenceWeekOf("2026-10-16")).toEqual({ start: "2026-10-16", end: "2026-10-22" });
  });

  it("suit un autre jour de début", () => {
    expect(absenceWeekOf("2026-10-13", 6)).toEqual({ start: "2026-10-10", end: "2026-10-16" });
  });
});

describe("historyTotal", () => {
  it("additionne les seules lignes de l'élève", () => {
    const rows = [tx({ amount: 2500 }), tx({ amount: -625 }), tx({ studentId: "stu-2", amount: -9999 })];
    expect(historyTotal("stu-1", rows)).toBe(1875);
  });
});

describe("heure de l'école", () => {
  it("affiche 15:30 pour une séance stockée à 14:30 UTC", () => {
    expect(schoolDateTimeInput("2026-10-13T14:30:00+00:00")).toBe("2026-10-13T15:30");
    expect(schoolDateTimeLabel("2026-10-13T14:30:00+00:00")).toBe("2026-10-13 15:30");
  });

  it("relit une heure d'Alger en UTC, aller-retour exact", () => {
    expect(isoFromSchoolInput("2026-10-13T15:30")).toBe("2026-10-13T14:30:00.000Z");
    expect(schoolDateTimeInput(isoFromSchoolInput("2026-09-26T00:15"))).toBe("2026-09-26T00:15");
  });
});
