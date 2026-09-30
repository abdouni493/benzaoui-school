import { describe, expect, it } from "vitest";
import {
  attendanceRate,
  buildSessionStats,
  sessionsOfClass,
  summarizeClass,
} from "@/lib/classStats";
import { studentDebtOf } from "@/lib/helpers";
import type {
  AbsencePenalty,
  AttendanceRecord,
  ScheduleSession,
  Student,
  Subscription,
  UnpaidTeacherSession,
} from "@/lib/types";

/**
 * Les chiffres de la fiche classe : qui est inscrit à quel emploi du temps,
 * qui doit combien, et ce que chaque créneau a rapporté. Une erreur ici fait
 * relancer une famille qui ne doit rien — ou oublier celle qui doit.
 */

const session = (id: string, classId: string, extra: Partial<ScheduleSession> = {}): ScheduleSession => ({
  id,
  classId,
  moduleId: `mod-${id}`,
  groupId: "g1",
  salleId: "s1",
  teacherId: `t-${id}`,
  days: ["saturday"],
  startTime: "08:00",
  endTime: "10:00",
  ...extra,
});

const student = (id: string, balance: number, subs: string[], extra: Partial<Student> = {}): Student => ({
  id,
  firstName: id,
  lastName: id.toUpperCase(),
  birthDate: "",
  phone: "",
  email: "",
  rfid: id,
  balance,
  isFree: false,
  subscriptionIds: subs,
  ...extra,
});

const att = (
  id: string,
  studentId: string,
  sessionId: string,
  timestamp: string,
  amount: number,
  status: AttendanceRecord["status"] = "present",
): AttendanceRecord => ({ id, studentId, sessionId, timestamp, amountDeducted: amount, status });

const NOW = new Date("2026-10-01T12:00:00Z");

function fixture() {
  const sessions = [
    session("A", "c1"),
    session("B", "c1"),
    session("C", "c2"),
    // séance libre couvrant deux classes
    session("L", "c2", { isOpen: true, classIds: ["c2", "c1"] }),
  ];
  const subscriptions: Subscription[] = [
    { id: "subA", sessionId: "A", pricePerSession: 500 },
    { id: "subB", sessionId: "B", pricePerSession: 400 },
    { id: "subC", sessionId: "C", pricePerSession: 300 },
    { id: "subL", sessionId: "L", pricePerSession: 200 },
  ];
  const students = [
    student("ali", -500, ["subA", "subB"]), // en dette, deux créneaux de c1
    student("bia", 1200, ["subA"]),
    student("cam", 0, ["subB"], { registrationDue: 1000 }), // inscription due
    student("dan", 300, ["subC"]),
  ];
  const attendance = [
    att("1", "ali", "A", "2026-09-28T08:05:00Z", 500),
    att("2", "bia", "A", "2026-09-28T08:07:00Z", 500),
    att("3", "ali", "A", "2026-09-21T08:05:00Z", 500),
    att("4", "bia", "A", "2026-09-21T08:07:00Z", 0, "absent"),
    att("5", "cam", "B", "2026-06-01T08:00:00Z", 400), // hors fenêtre récente
    att("6", "dan", "C", "2026-09-29T08:00:00Z", 300),
  ];
  const absencePenalties: AbsencePenalty[] = [
    {
      id: "p1",
      studentId: "cam",
      sessionId: "B",
      moduleId: "mod-B",
      periodStart: "2026-09-20",
      periodEnd: "2026-09-26",
      amount: 400,
      balanceAfter: 0,
      createdAt: "2026-09-27T00:00:00Z",
    },
  ];
  const unpaidTeacher: UnpaidTeacherSession[] = [
    { id: "u1", teacherId: "t-A", sessionId: "A", studentId: "ali", amount: 250, date: "", paid: false },
    { id: "u2", teacherId: "t-A", sessionId: "A", studentId: "bia", amount: 250, date: "", paid: true },
  ];
  return { sessions, subscriptions, students, attendance, absencePenalties, unpaidTeacher };
}

const debtOf = (s: Student) => studentDebtOf(s);

describe("sessionsOfClass", () => {
  it("retient les créneaux de la classe ET les séances libres qui la couvrent", () => {
    const { sessions } = fixture();
    expect(sessionsOfClass(sessions, "c1").map((s) => s.id)).toEqual(["A", "B", "L"]);
    expect(sessionsOfClass(sessions, "c2").map((s) => s.id)).toEqual(["C", "L"]);
  });
});

describe("buildSessionStats", () => {
  const stats = buildSessionStats({ ...fixture(), debtOf, now: NOW });

  it("compte les inscrits de chaque créneau, les débiteurs en tête", () => {
    expect(stats.get("A")?.studentIds).toEqual(["ali", "bia"]);
    expect(stats.get("B")?.studentIds).toEqual(["cam", "ali"]); // cam doit 1000, ali 500
    expect(stats.get("L")?.studentIds).toEqual([]);
  });

  it("additionne les dettes des élèves du créneau (solde négatif + inscription due)", () => {
    expect(stats.get("A")?.debtorIds).toEqual(["ali"]);
    expect(stats.get("A")?.totalDebt).toBe(500);
    expect(stats.get("B")?.debtorIds).toEqual(["cam", "ali"]);
    expect(stats.get("B")?.totalDebt).toBe(1500);
  });

  it("chiffre ce que les séances ont coûté, absences facturées comprises", () => {
    expect(stats.get("A")?.totalPaid).toBe(1500);
    expect(stats.get("B")?.totalPaid).toBe(800);
  });

  it("compte présences, absences, séances tenues et dernière séance", () => {
    const a = stats.get("A")!;
    expect(a.presences).toBe(3);
    expect(a.absences).toBe(1);
    expect(a.seancesHeld).toBe(2);
    expect(a.lastSeanceDate).toBe("2026-09-28");
    // cam : une présence ancienne (hors 30 j) + une absence facturée récente
    const b = stats.get("B")!;
    expect(b.presencesRecent).toBe(0);
    expect(b.absencesRecent).toBe(1);
  });

  it("détaille chaque élève sur le créneau", () => {
    const ali = stats.get("A")!.perStudent.get("ali")!;
    expect(ali.presences).toBe(2);
    expect(ali.paid).toBe(1000);
    expect(ali.lastPresence).toBe("2026-09-28T08:05:00Z");
    expect(stats.get("A")!.perStudent.get("bia")!.absences).toBe(1);
  });

  it("ne compte que ce qui reste dû à l'enseignant", () => {
    expect(stats.get("A")?.teacherDue).toBe(250);
  });
});

describe("summarizeClass", () => {
  it("compte chaque élève UNE fois, même inscrit à plusieurs créneaux", () => {
    const f = fixture();
    const stats = buildSessionStats({ ...f, debtOf, now: NOW });
    const byId = new Map(f.students.map((s) => [s.id, s]));
    const summary = summarizeClass(sessionsOfClass(f.sessions, "c1"), stats, (id) => {
      const s = byId.get(id);
      return s ? debtOf(s) : undefined;
    });
    expect(summary.studentIds.sort()).toEqual(["ali", "bia", "cam"]);
    expect(summary.debtorIds).toEqual(["cam", "ali"]);
    // ali n'est compté qu'une fois : 1000 (cam) + 500 (ali)
    expect(summary.totalDebt).toBe(1500);
    expect(summary.totalPaid).toBe(1500 + 800);
    expect(summary.moduleIds).toHaveLength(3);
  });
});

describe("attendanceRate", () => {
  it("rend un pourcentage, ou null quand rien n'a été pointé", () => {
    expect(attendanceRate(3, 1)).toBe(75);
    expect(attendanceRate(0, 0)).toBeNull();
  });
});
