import { describe, it, expect } from "vitest";
import {
  ageOn,
  birthdayRosterOf,
  birthdaysBySession,
  daysUntilBirthday,
  isBirthdayOn,
  monthDayOf,
  nextBirthdayIso,
  upcomingBirthdays,
} from "@/lib/birthdays";
import type { ScheduleSession, Student, Subscription } from "@/lib/types";

const student = (over: Partial<Student> & Pick<Student, "id" | "firstName" | "birthDate">): Student => ({
  lastName: "Élève",
  phone: "",
  email: "",
  rfid: "",
  balance: 0,
  isFree: false,
  subscriptionIds: [],
  ...over,
} as Student);

const session = (over: Partial<ScheduleSession> & Pick<ScheduleSession, "id">): ScheduleSession => ({
  classId: "c1",
  moduleId: "m1",
  groupId: "g1",
  salleId: "s1",
  teacherId: "t1",
  days: ["monday"],
  startTime: "08:00",
  endTime: "09:00",
  ...over,
});

const sub = (id: string, sessionId: string): Subscription => ({
  id,
  sessionId,
  pricePerSession: 500,
});

// 2026-09-07 est un LUNDI ; 2026-09-08 un mardi.
const MONDAY = "2026-09-07";

describe("monthDayOf / isBirthdayOn", () => {
  it("lit le jour et le mois d'une date de naissance", () => {
    expect(monthDayOf("2010-09-07")).toBe("09-07");
    expect(monthDayOf("")).toBeNull();
    expect(monthDayOf(undefined)).toBeNull();
    expect(monthDayOf("pas une date")).toBeNull();
  });

  it("reconnaît l'anniversaire quel que soit l'âge", () => {
    expect(isBirthdayOn("2010-09-07", MONDAY)).toBe(true);
    expect(isBirthdayOn("1998-09-07", MONDAY)).toBe(true);
    expect(isBirthdayOn("2010-09-08", MONDAY)).toBe(false);
  });

  it("une fiche sans date de naissance ne fête jamais rien", () => {
    expect(isBirthdayOn("", MONDAY)).toBe(false);
    expect(isBirthdayOn(undefined, MONDAY)).toBe(false);
  });

  it("un 29 février se fête le 28 les années non bissextiles, le 29 sinon", () => {
    expect(isBirthdayOn("2008-02-29", "2026-02-28")).toBe(true);
    expect(isBirthdayOn("2008-02-29", "2026-02-29")).toBe(false); // n'existe pas
    expect(isBirthdayOn("2008-02-29", "2028-02-29")).toBe(true);
    expect(isBirthdayOn("2008-02-29", "2028-02-28")).toBe(false);
  });
});

describe("ageOn", () => {
  it("donne l'âge atteint le jour même", () => {
    expect(ageOn("2010-09-07", MONDAY)).toBe(16);
  });

  it("rend null sur une fiche sans date lisible", () => {
    expect(ageOn("", MONDAY)).toBeNull();
    expect(ageOn("0000-09-07", MONDAY)).toBeNull();
  });
});

describe("nextBirthdayIso / daysUntilBirthday", () => {
  it("le jour même compte pour zéro", () => {
    expect(nextBirthdayIso("2010-09-07", MONDAY)).toBe(MONDAY);
    expect(daysUntilBirthday("2010-09-07", MONDAY)).toBe(0);
  });

  it("un anniversaire passé bascule sur l'année suivante", () => {
    expect(nextBirthdayIso("2010-01-15", MONDAY)).toBe("2027-01-15");
  });

  it("compte les jours restants", () => {
    expect(daysUntilBirthday("2010-09-10", MONDAY)).toBe(3);
  });
});

describe("birthdayRosterOf — qui est ATTENDU le jour de son anniversaire", () => {
  const lundi = session({ id: "ses-lundi", days: ["monday"], startTime: "10:00", endTime: "11:00" });
  const lundiTot = session({ id: "ses-tot", days: ["monday"], startTime: "08:00", endTime: "09:00" });
  const mardi = session({ id: "ses-mardi", days: ["tuesday"] });
  const subscriptions = [sub("sub-lundi", "ses-lundi"), sub("sub-tot", "ses-tot"), sub("sub-mardi", "ses-mardi")];

  it("sépare ceux qui ont cours de ceux qui n'en ont pas", () => {
    const enClasse = student({
      id: "a",
      firstName: "Amine",
      birthDate: "2010-09-07",
      subscriptionIds: ["sub-lundi"],
    });
    const absent = student({
      id: "b",
      firstName: "Bilal",
      birthDate: "2011-09-07",
      subscriptionIds: ["sub-mardi"],
    });
    const pasAujourdhui = student({
      id: "c",
      firstName: "Chaima",
      birthDate: "2011-12-01",
      subscriptionIds: ["sub-lundi"],
    });

    const roster = birthdayRosterOf({
      students: [enClasse, absent, pasAujourdhui],
      sessions: [lundi, lundiTot, mardi],
      subscriptions,
      date: MONDAY,
    });

    expect(roster.expected.map((e) => e.student.id)).toEqual(["a"]);
    expect(roster.expected[0].sessions.map((s) => s.id)).toEqual(["ses-lundi"]);
    expect(roster.expected[0].age).toBe(16);
    expect(roster.away.map((e) => e.student.id)).toEqual(["b"]);
  });

  it("range les attendus par heure d'arrivée", () => {
    const tard = student({ id: "tard", firstName: "Tarek", birthDate: "2010-09-07", subscriptionIds: ["sub-lundi"] });
    const tot = student({ id: "tot", firstName: "Sofia", birthDate: "2010-09-07", subscriptionIds: ["sub-tot"] });

    const roster = birthdayRosterOf({
      students: [tard, tot],
      sessions: [lundi, lundiTot],
      subscriptions,
      date: MONDAY,
    });
    expect(roster.expected.map((e) => e.student.id)).toEqual(["tot", "tard"]);
  });

  it("une séance libre hors de sa période ne compte pas comme un cours du jour", () => {
    const expiree = session({
      id: "ses-libre",
      days: ["monday"],
      isOpen: true,
      periodStart: "2026-01-01",
      periodEnd: "2026-06-30",
    });
    const eleve = student({
      id: "d",
      firstName: "Dina",
      birthDate: "2012-09-07",
      subscriptionIds: ["sub-libre"],
    });

    const roster = birthdayRosterOf({
      students: [eleve],
      sessions: [expiree],
      subscriptions: [sub("sub-libre", "ses-libre")],
      date: MONDAY,
    });
    expect(roster.expected).toHaveLength(0);
    expect(roster.away.map((e) => e.student.id)).toEqual(["d"]);
  });

  it("deux abonnements sur la même séance ne la comptent qu'une fois", () => {
    const eleve = student({
      id: "e",
      firstName: "Eya",
      birthDate: "2012-09-07",
      subscriptionIds: ["sub-lundi", "sub-lundi-bis"],
    });
    const roster = birthdayRosterOf({
      students: [eleve],
      sessions: [lundi],
      subscriptions: [...subscriptions, sub("sub-lundi-bis", "ses-lundi")],
      date: MONDAY,
    });
    expect(roster.expected[0].sessions).toHaveLength(1);
  });
});

describe("birthdaysBySession", () => {
  it("regroupe les fêtés par séance de la journée", () => {
    const lundi = session({ id: "ses-lundi", days: ["monday"] });
    const eleves = [
      student({ id: "a", firstName: "Amine", birthDate: "2010-09-07", subscriptionIds: ["s1"] }),
      student({ id: "b", firstName: "Bilal", birthDate: "2011-09-07", subscriptionIds: ["s1"] }),
    ];
    const roster = birthdayRosterOf({
      students: eleves,
      sessions: [lundi],
      subscriptions: [sub("s1", "ses-lundi")],
      date: MONDAY,
    });
    const map = birthdaysBySession(roster.expected);
    expect(map.get("ses-lundi")?.map((e) => e.student.id).sort()).toEqual(["a", "b"]);
  });
});

describe("upcomingBirthdays", () => {
  it("ne retient que la fenêtre demandée, du plus proche au plus lointain", () => {
    const list = upcomingBirthdays(
      [
        student({ id: "loin", firstName: "Loin", birthDate: "2010-12-25" }),
        student({ id: "demain", firstName: "Demain", birthDate: "2010-09-08" }),
        student({ id: "today", firstName: "Aujourd", birthDate: "2010-09-07" }),
        student({ id: "sans", firstName: "Sans", birthDate: "" }),
      ],
      MONDAY,
      30,
    );
    expect(list.map((b) => b.student.id)).toEqual(["today", "demain"]);
    expect(list[0].inDays).toBe(0);
    expect(list[1].inDays).toBe(1);
    expect(list[1].age).toBe(16);
  });
});
