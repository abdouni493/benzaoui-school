import { describe, expect, it } from "vitest";

import { canAttendSession, studentSessionRank } from "@/lib/seanceAudience";
import type { ScheduleSession, SchoolClass, Student, Subscription } from "@/lib/types";

/**
 * CHACUN SUR SON EMPLOI DU TEMPS.
 *
 * Un cours ordinaire n'admet plus que ses propres inscrits : ni un autre
 * groupe du même cours, ni une classe jumelle — même niveau, même année, même
 * filière. Les séances libres, elles, gardent exactement leurs règles : c'est
 * la moitié du test qui ne doit JAMAIS changer.
 *
 * Miroir de `student_session_rank`
 * (supabase/migrations/20260910_own_timetable_only_scan_and_presence.sql).
 */

const classes: SchoolClass[] = [
  { id: "c-sci-1", type: "cours", name: "3AS Sciences A", description: "", coursLevel: "lycee", year: "3", filiereId: "f-sci" },
  { id: "c-sci-2", type: "cours", name: "3AS Sciences B", description: "", coursLevel: "lycee", year: "3", filiereId: "f-sci" },
  { id: "c-let", type: "cours", name: "3AS Lettres", description: "", coursLevel: "lycee", year: "3", filiereId: "f-let" },
];

const timing = (id: string, classId: string, groupId: string): ScheduleSession => ({
  id,
  classId,
  moduleId: "maths",
  groupId,
  salleId: "salle",
  teacherId: "tch",
  days: ["monday"],
  startTime: "08:00",
  endTime: "10:00",
});

/** Deux emplois du temps du MÊME cours, pour la MÊME classe, deux groupes. */
const coursG1 = timing("cours-g1", "c-sci-1", "g1");
const coursG2 = timing("cours-g2", "c-sci-1", "g2");
/** Un troisième, sur la classe jumelle : même niveau, même année, même filière. */
const coursJumelle = timing("cours-jumelle", "c-sci-2", "g3");

/** La séance libre, ouverte à la promotion (règles inchangées). */
const seanceLibre: ScheduleSession = {
  ...timing("libre-1", "c-sci-1", "g1"),
  isOpen: true,
  title: "Séance Libre — Maths",
  classIds: ["c-sci-1"],
  groupIds: ["g1"],
  openPrice: 800,
};

const sessions: ScheduleSession[] = [coursG1, coursG2, coursJumelle, seanceLibre];

const subscriptions: Subscription[] = sessions.map((s) => ({
  id: `sub-${s.id}`,
  sessionId: s.id,
  pricePerSession: 500,
}));

const student = (id: string, subIds: string[]): Student => ({
  id,
  firstName: "Élève",
  lastName: id,
  birthDate: "2008-01-01",
  phone: "",
  email: "",
  rfid: "",
  balance: 0,
  isFree: false,
  subscriptionIds: subIds,
});

/** Inscrit sur le groupe G1 du cours, et sur rien d'autre. */
const inscritG1 = student("g1", ["sub-cours-g1"]);
/** Inscrit sur la classe jumelle : même niveau, même année, même filière. */
const jumeau = student("jumeau", ["sub-cours-jumelle"]);
/** Aucun emploi du temps du tout. */
const nouveau = student("nouveau", []);

const rank = (session: ScheduleSession, stu: Student) =>
  studentSessionRank({ session, student: stu, sessions, subscriptions, classes });

const can = (session: ScheduleSession, stu: Student) =>
  canAttendSession({ session, student: stu, sessions, subscriptions, classes });

describe("cours ordinaire — chacun sur son emploi du temps", () => {
  it("accepte l'élève inscrit sur le créneau", () => {
    expect(rank(coursG1, inscritG1)).toBe(0);
    expect(can(coursG1, inscritG1).allowed).toBe(true);
  });

  it("REFUSE un autre groupe du même cours et de la même classe", () => {
    // Le rattrapage : même module, même classe, autre créneau. C'était le
    // rang 1 ; sur un cours ordinaire il n'existe plus.
    expect(rank(coursG2, inscritG1)).toBeUndefined();
    expect(can(coursG2, inscritG1).allowed).toBe(false);
  });

  it("REFUSE une classe jumelle — même niveau, même année, même filière", () => {
    // C'était le rang 2, ouvert par le public du créneau.
    expect(rank(coursG1, jumeau)).toBeUndefined();
    expect(rank(coursJumelle, inscritG1)).toBeUndefined();
    expect(can(coursG1, jumeau).allowed).toBe(false);
  });

  it("refuse l'élève sans aucun emploi du temps", () => {
    expect(rank(coursG1, nouveau)).toBeUndefined();
    expect(can(coursG1, nouveau).allowed).toBe(false);
  });

  it("dit à la réception que le créneau n'est pas le sien", () => {
    const verdict = can(coursG2, inscritG1);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/emploi du temps/);
  });
});

describe("séance libre — règles inchangées", () => {
  it("accepte l'élève inscrit sur la séance libre (rang 0)", () => {
    const abonne = student("abonne", ["sub-libre-1"]);
    expect(rank(seanceLibre, abonne)).toBe(0);
  });

  it("garde le rattrapage : même cours, même classe, autre groupe (rang 1)", () => {
    // `inscritG1` suit le cours de maths de sa classe : la séance libre de
    // maths de cette même classe lui reste ouverte à ce titre.
    expect(rank(seanceLibre, inscritG1)).toBe(1);
    expect(can(seanceLibre, inscritG1).allowed).toBe(true);
  });

  it("garde l'admission par la classe du public (rang 2)", () => {
    // La classe jumelle n'est pas celle du créneau et ne suit pas le même
    // cours : elle entre par le public de la séance libre — la promotion.
    expect(rank(seanceLibre, jumeau)).toBe(2);
    expect(can(seanceLibre, jumeau).allowed).toBe(true);
  });

  it("garde l'ouverture à toute la promotion, filière comprise", () => {
    const lettres = student("lettres", ["sub-cours-let"]);
    const coursLettres = timing("cours-let", "c-let", "g4");
    const withLettres = [...sessions, coursLettres];
    const subs = [...subscriptions, { id: "sub-cours-let", sessionId: "cours-let", pricePerSession: 500 }];
    expect(
      studentSessionRank({
        session: seanceLibre,
        student: lettres,
        sessions: withLettres,
        subscriptions: subs,
        classes,
      }),
    ).toBe(2);
  });

  it("refuse toujours celui qui n'entre dans aucun public", () => {
    expect(rank(seanceLibre, nouveau)).toBeUndefined();
    expect(can(seanceLibre, nouveau).allowed).toBe(false);
  });
});
