import { describe, it, expect } from "vitest";

import { computeStudentReport, studentTimetablesOf, unpaidCharges } from "@/lib/reports/studentActivity";
import type {
  AbsencePenalty,
  AttendanceRecord,
  BalanceTransaction,
  ScheduleSession,
  Student,
  Subscription,
} from "@/lib/types";

const MATHS = "mod-maths";
const PHYS = "mod-phys";
const CHIMIE = "mod-chimie";

const session = (o: Partial<ScheduleSession>) =>
  ({
    id: "se-maths",
    classId: "cls-3s",
    moduleId: MATHS,
    groupId: "grp-1",
    salleId: "sal-1",
    teacherId: "tea-1",
    days: ["tuesday"],
    startTime: "16:00",
    endTime: "18:00",
    ...o,
  }) as ScheduleSession;

const sessions = [session({}), session({ id: "se-phys", moduleId: PHYS, teacherId: "tea-2", days: ["saturday"] })];
// L'emploi du temps de chimie a été supprimé : seule sa ligne d'argent reste.
const subscriptions: Subscription[] = [
  { id: "sub-maths", sessionId: "se-maths", pricePerSession: 500 },
  { id: "sub-phys", sessionId: "se-phys", pricePerSession: 500 },
];

// Inscrit en maths (réduction de 100 DA) ; désinscrit de physique depuis.
const student = {
  id: "stu-1",
  firstName: "Amine",
  lastName: "Test",
  phone: "",
  email: "",
  rfid: "0001",
  balance: -900,
  isFree: false,
  subscriptionIds: ["sub-maths"],
  subscriptionDates: { "sub-maths": { subscribedAt: "2026-10-15", startDate: "2026-10-15" } },
  subscriptionDiscounts: { "sub-maths": { type: "amount", value: 100 } },
} as unknown as Student;

const att = (id: string, sessionId: string, timestamp: string, amountDeducted: number): AttendanceRecord => ({
  id,
  studentId: "stu-1",
  sessionId,
  timestamp,
  amountDeducted,
  status: "present",
});
const attendance = [
  att("att-p1", "se-phys", "2026-10-06T15:00:00.000Z", 500),
  att("att-p2", "se-phys", "2026-10-13T15:00:00.000Z", 500),
  att("att-m1", "se-maths", "2026-10-20T15:00:00.000Z", 400),
];

const tx = (
  id: string,
  date: string,
  amount: number,
  type: BalanceTransaction["type"],
  description: string,
  moduleId?: string,
): BalanceTransaction => ({ id, studentId: "stu-1", date, amount, type, description, moduleId });
const balanceTx = [
  tx("tx-topup", "2026-09-30T08:00:00.000Z", 600, "topup", "Versement"),
  tx("tx-chimie", "2026-10-01T08:00:00.000Z", -300, "deduction", "Séance chimie (A) (09:00-11:00)", CHIMIE),
  tx("tx-p1", "2026-10-06T15:00:00.000Z", -500, "deduction", "Séance physique (Groupe 1) (16:00-18:00)", PHYS),
  tx("tx-p2", "2026-10-13T15:00:00.000Z", -500, "deduction", "Séance physique (Groupe 1) (16:00-18:00)", PHYS),
  tx("tx-m1", "2026-10-20T15:00:00.000Z", -400, "deduction", "Séance maths (Groupe 1) (16:00-18:00)", MATHS),
  tx(
    "tx-abs",
    "2026-10-23T07:00:00.000Z",
    -500,
    "deduction",
    "Absence hebdomadaire — physique (Groupe 1) — semaine du 16/10/2026 au 22/10/2026",
    PHYS,
  ),
  tx("tx-debt", "2026-10-24T08:00:00.000Z", 700, "debt_payment", "Règlement de dette"),
];
const absencePenalties: AbsencePenalty[] = [
  {
    id: "pen-1",
    studentId: "stu-1",
    subscriptionId: "sub-phys",
    sessionId: "se-phys",
    moduleId: PHYS,
    periodStart: "2026-10-16",
    periodEnd: "2026-10-22",
    amount: 500,
    balanceAfter: -1600,
    createdAt: "2026-10-23T07:00:00.000Z",
  },
];

const data = {
  student,
  balanceTx,
  attendance,
  absencePenalties,
  sessions,
  subscriptions,
  modules: [
    { id: MATHS, name: "Maths" },
    { id: PHYS, name: "Physique" },
    { id: CHIMIE, name: "Chimie" },
  ],
  groups: [{ id: "grp-1", name: "Groupe 1" }],
  classes: [{ id: "cls-3s", type: "cours", name: "3AS Sciences", description: "" }],
  teachers: [
    { id: "tea-1", firstName: "Karim", lastName: "B" },
    { id: "tea-2", firstName: "Nadia", lastName: "K" },
  ],
  salles: [{ id: "sal-1", name: "Salle 1" }],
} as unknown as Parameters<typeof studentTimetablesOf>[0];

describe("unpaidCharges — les versements paient les plus anciennes séances d'abord", () => {
  it("laisse impayés exactement les derniers débits, pour le solde négatif", () => {
    const unpaid = unpaidCharges(balanceTx);
    expect([...unpaid.entries()]).toEqual([
      ["tx-m1", 400],
      ["tx-abs", 500],
    ]);
    const ledger = balanceTx.reduce((s, t) => s + t.amount, 0);
    expect([...unpaid.values()].reduce((s, v) => s + v, 0)).toBe(-ledger);
  });

  it("ne rend rien quand le solde de l'historique est positif", () => {
    expect(unpaidCharges([balanceTx[0], balanceTx[1]]).size).toBe(0);
  });
});

describe("studentTimetablesOf — un emploi du temps quitté reste dans le rapport", () => {
  const timetables = studentTimetablesOf(data);

  it("liste les inscriptions, puis les emplois du temps quittés, puis les supprimés", () => {
    expect(timetables.map((t) => [t.key, t.status])).toEqual([
      ["se-maths", "current"],
      ["se-phys", "left"],
      [`module:${CHIMIE}`, "deleted"],
    ]);
  });

  it("décrit le créneau d'aujourd'hui : enseignant, horaire, tarif et réduction, dates", () => {
    const maths = timetables[0];
    expect(maths).toMatchObject({
      name: "Maths",
      className: "3AS Sciences",
      group: "Groupe 1",
      teacher: "Karim B",
      salle: "Salle 1",
      time: "16:00-18:00",
      price: 500,
      netPrice: 400,
      discount: "-100 DA",
      subscribedAt: "2026-10-15",
    });
  });

  it("décrit aussi le créneau quitté (sans tarif : il n'y est plus inscrit)", () => {
    const phys = timetables[1];
    expect(phys).toMatchObject({ name: "Physique", teacher: "Nadia K", time: "16:00-18:00" });
    expect(phys.price).toBeUndefined();
  });
});

describe("computeStudentReport — présences, absences et dette par emploi du temps", () => {
  const report = computeStudentReport({
    ...data,
    period: { mode: "all" },
    timetableKeys: studentTimetablesOf(data).map((t) => t.key),
  });
  const byKey = new Map(report.timetables.map((t) => [t.key, t]));

  it("garde les présences et l'absence facturée de l'emploi du temps quitté", () => {
    const phys = byKey.get("se-phys");
    expect(phys).toMatchObject({ status: "left", presences: 2, absences: 1, totalCost: 1500 });
    expect(phys?.lines.map((l) => l.id)).toEqual(["att-p1", "att-p2", "pen-1"]);
    expect(phys?.firstDate).toBe("2026-10-06T15:00:00.000Z");
  });

  it("rattache à chaque emploi du temps ce qui en reste à payer", () => {
    expect(byKey.get("se-phys")?.unpaid).toBe(500);
    expect(byKey.get("se-phys")?.lines.find((l) => l.id === "pen-1")?.unpaid).toBe(500);
    expect(byKey.get("se-maths")?.unpaid).toBe(400);
    expect(byKey.get("se-maths")?.lines[0].unpaid).toBe(400);
    expect(byKey.get(`module:${CHIMIE}`)?.unpaid).toBe(0);
    expect(report.unpaidTotal).toBe(900);
    expect(report.otherUnpaid).toBe(0);
  });

  it("montre la séance payée d'un emploi du temps supprimé", () => {
    const chimie = byKey.get(`module:${CHIMIE}`);
    expect(chimie?.lines).toHaveLength(1);
    expect(chimie?.lines[0]).toMatchObject({ deletedSlot: true, cost: 300, group: "A", time: "09:00-11:00" });
  });

  it("compte tous les versements, et le coût de tous les emplois du temps", () => {
    expect(report.totalPayments).toBe(1300);
    expect(report.totalCost).toBe(2200);
  });

  it("une période ne retient que ses lignes, la dette reste celle d'aujourd'hui", () => {
    const october13 = computeStudentReport({
      ...data,
      period: { mode: "range", start: "2026-10-10", end: "2026-10-14" },
      timetableKeys: ["se-phys"],
    });
    expect(october13.timetables).toHaveLength(1);
    expect(october13.timetables[0]).toMatchObject({ presences: 1, absences: 0, totalCost: 500, unpaid: 500 });
  });

  it("un débit sans emploi du temps ni matière reste à part", () => {
    const withFee = computeStudentReport({
      ...data,
      balanceTx: [...balanceTx, tx("tx-fee", "2026-10-25T08:00:00.000Z", -1000, "registration", "Frais d'inscription")],
      period: { mode: "all" },
      timetableKeys: ["se-maths"],
    });
    expect(withFee.otherUnpaid).toBe(1000);
    expect(withFee.unpaidTotal).toBe(1900);
  });
});
