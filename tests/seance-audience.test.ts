import { describe, expect, it } from "vitest";

import {
  checkOpenSeanceAudience,
  classPeerIds,
  enrolledSessionsOf,
  openSeanceClassIds,
  openSeanceGroupIds,
  sessionAudienceClassIds,
  studentClassIds,
} from "@/lib/seanceAudience";
import type { ScheduleSession, SchoolClass, Student, Subscription } from "@/lib/types";

/**
 * Une école à deux filières. « Sciences » a deux classes de 3AS suivies dans
 * deux groupes différents (les jumelles : même niveau, même année, même
 * filière), plus une 2AS de la même filière. « Lettres » n'a rien à voir avec
 * le créneau testé.
 */
const classes: SchoolClass[] = [
  { id: "c-sci-1", type: "cours", name: "3AS Sciences A", description: "", coursLevel: "lycee", year: "3", filiereId: "f-sci" },
  { id: "c-sci-2", type: "cours", name: "3AS Sciences B", description: "", coursLevel: "lycee", year: "3", filiereId: "f-sci" },
  { id: "c-sci-2e", type: "cours", name: "2AS Sciences", description: "", coursLevel: "lycee", year: "2", filiereId: "f-sci" },
  { id: "c-let", type: "cours", name: "3AS Lettres", description: "", coursLevel: "lycee", year: "3", filiereId: "f-let" },
  { id: "c-form", type: "formation", name: "Anglais B1", description: "", formationLevel: "B1" },
];

const timing = (id: string, classId: string, groupId: string): ScheduleSession => ({
  id,
  classId,
  moduleId: "mod",
  groupId,
  salleId: "salle",
  teacherId: "tch",
  days: ["monday"],
  startTime: "08:00",
  endTime: "10:00",
});

/** Le créneau de séance libre : classe Sciences A seulement, groupe G1. */
const openSeance: ScheduleSession = {
  ...timing("open-1", "c-sci-1", "g1"),
  isOpen: true,
  title: "Séance Libre — Maths",
  classIds: ["c-sci-1"],
  groupIds: ["g1"],
  salleIds: ["salle"],
  openPrice: 800,
};

const sessions: ScheduleSession[] = [
  openSeance,
  timing("reg-sci1-g1", "c-sci-1", "g1"),
  timing("reg-sci2-g2", "c-sci-2", "g2"),
  timing("reg-sci2e-g1", "c-sci-2e", "g1"),
  timing("reg-let-g1", "c-let", "g1"),
  timing("reg-form", "c-form", "g1"),
];

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

const sciG1 = student("sci-g1", ["sub-reg-sci1-g1"]);
const sciG2 = student("sci-g2", ["sub-reg-sci2-g2"]);
const sci2e = student("sci-2e", ["sub-reg-sci2e-g1"]);
const lettres = student("lettres", ["sub-reg-let-g1"]);
const formation = student("formation", ["sub-reg-form"]);
const nouveau = student("nouveau", []);

const check = (session: ScheduleSession, stu: Student) =>
  checkOpenSeanceAudience({ session, student: stu, sessions, subscriptions, classes });

describe("openSeanceClassIds / openSeanceGroupIds", () => {
  it("réunit la colonne simple et le tableau, sans doublon", () => {
    const deuxClasses = { ...openSeance, classIds: ["c-sci-1", "c-sci-2"] };
    expect(openSeanceClassIds(deuxClasses)).toEqual(["c-sci-1", "c-sci-2"]);
    expect(openSeanceGroupIds(deuxClasses)).toEqual(["g1"]);
  });

  it("se contente de la colonne simple quand la base n'a pas les tableaux", () => {
    // Migration multi-classes pas encore passée : `class_ids` revient vide.
    const legacy = { ...openSeance, classIds: undefined, groupIds: undefined };
    expect(openSeanceClassIds(legacy)).toEqual(["c-sci-1"]);
    expect(openSeanceGroupIds(legacy)).toEqual(["g1"]);
  });
});

describe("classPeerIds", () => {
  it("réunit les classes de même niveau, même année et même filière", () => {
    expect(classPeerIds(["c-sci-1"], classes).sort()).toEqual(["c-sci-1", "c-sci-2"]);
  });

  it("sépare une autre année de la même filière", () => {
    expect(classPeerIds(["c-sci-1"], classes)).not.toContain("c-sci-2e");
  });

  it("sépare une autre filière et les formations", () => {
    const peers = classPeerIds(["c-sci-1"], classes);
    expect(peers).not.toContain("c-let");
    expect(peers).not.toContain("c-form");
  });

  it("ne réunit pas deux formations de niveaux différents", () => {
    const b2: SchoolClass = { ...classes[4], id: "c-form-b2", formationLevel: "B2" };
    expect(classPeerIds(["c-form"], [...classes, b2])).toEqual(["c-form"]);
  });
});

describe("sessionAudienceClassIds", () => {
  it("« classes cochées » couvre les jumelles, pas les autres années", () => {
    const restreint = { ...openSeance, openAudience: "enrolled" as const };
    expect(sessionAudienceClassIds(restreint, classes).sort()).toEqual(["c-sci-1", "c-sci-2"]);
  });

  it("« toute la filière » ajoute les autres années", () => {
    const ouvert = { ...openSeance, openAudience: "filiere" as const };
    expect(sessionAudienceClassIds(ouvert, classes).sort()).toEqual([
      "c-sci-1",
      "c-sci-2",
      "c-sci-2e",
    ]);
  });
});

describe("studentClassIds", () => {
  it("rend les classes des emplois du temps que l'élève suit", () => {
    expect(studentClassIds(sciG2, sessions, subscriptions)).toEqual(["c-sci-2"]);
    expect(studentClassIds(nouveau, sessions, subscriptions)).toEqual([]);
  });
});

describe("enrolledSessionsOf", () => {
  it("rend les emplois du temps que l'élève suit vraiment", () => {
    expect(enrolledSessionsOf(sciG1, sessions, subscriptions).map((s) => s.id)).toEqual([
      "reg-sci1-g1",
    ]);
    expect(enrolledSessionsOf(nouveau, sessions, subscriptions)).toEqual([]);
  });
});

describe("checkOpenSeanceAudience", () => {
  it("n'impose rien à un créneau créé avant le réglage", () => {
    // Compatibilité : le guichet accepte n'importe quel élève, comme avant.
    expect(check(openSeance, lettres).allowed).toBe(true);
    expect(check(openSeance, nouveau).allowed).toBe(true);
  });

  it("ne contrôle jamais un cours ordinaire", () => {
    const cours = { ...timing("reg-let-g1", "c-let", "g1"), openAudience: "enrolled" as const };
    expect(check(cours, sciG1).allowed).toBe(true);
  });

  describe("public « classes cochées »", () => {
    const restreint = { ...openSeance, openAudience: "enrolled" as const };

    it("accepte l'élève de la classe cochée", () => {
      expect(check(restreint, sciG1).allowed).toBe(true);
    });

    it("accepte la classe jumelle, quel que soit son groupe", () => {
      // LE BUG SIGNALÉ : même niveau, même année, même filière, mais groupe G2
      // et classe distincte — la carte était refusée au guichet comme au badge.
      expect(check(restreint, sciG2).allowed).toBe(true);
    });

    it("refuse une autre année de la même filière", () => {
      expect(check(restreint, sci2e).allowed).toBe(false);
    });

    it("refuse une autre filière", () => {
      const verdict = check(restreint, lettres);
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toMatch(/classes cochées/);
    });

    it("accepte l'élève inscrit sur le créneau lui-même", () => {
      const inscrit = student("inscrit", ["sub-open-1"]);
      expect(check(restreint, inscrit).allowed).toBe(true);
    });

    it("dit à la réception qu'un élève sans abonnement n'entre dans aucun public", () => {
      const verdict = check(restreint, nouveau);
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toMatch(/aucun emploi du temps/);
    });
  });

  describe("public « toute la filière »", () => {
    const ouvert = { ...openSeance, openAudience: "filiere" as const };

    it("accepte une autre année de la même filière", () => {
      expect(check(ouvert, sci2e).allowed).toBe(true);
    });

    it("garde les classes jumelles", () => {
      expect(check(ouvert, sciG1).allowed).toBe(true);
      expect(check(ouvert, sciG2).allowed).toBe(true);
    });

    it("refuse une autre filière", () => {
      const verdict = check(ouvert, lettres);
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toMatch(/filière/);
    });

    it("refuse une formation, qui n'a pas de filière à partager", () => {
      // Deux classes sans filière ne sont pas « de la même filière » : sinon
      // toutes les formations de l'école entreraient sur tous les créneaux.
      expect(check(ouvert, formation).allowed).toBe(false);
    });
  });

  it("élargir le public n'enlève personne", () => {
    const restreint = { ...openSeance, openAudience: "enrolled" as const };
    const ouvert = { ...openSeance, openAudience: "filiere" as const };
    for (const stu of [sciG1, sciG2, sci2e, lettres, formation, nouveau]) {
      if (check(restreint, stu).allowed) expect(check(ouvert, stu).allowed).toBe(true);
    }
  });

  it("un créneau sans filière reste ouvert à sa propre classe en « toute la filière »", () => {
    // Régression : la branche « filière » ignorait les classes sans filière,
    // ce qui vidait le public d'un créneau de formation.
    const formationSeance: ScheduleSession = {
      ...timing("open-form", "c-form", "g1"),
      isOpen: true,
      classIds: ["c-form"],
      groupIds: ["g1"],
      openAudience: "filiere",
    };
    expect(check(formationSeance, formation).allowed).toBe(true);
  });
});
