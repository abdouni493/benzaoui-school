import { describe, it, expect } from "vitest";

import {
  cascadeOfClass,
  classesOfLevel,
  filiereOptionsOf,
  levelOptionsOf,
  matchedClassesOf,
  yearOptionsOf,
} from "@/lib/classCascade";
import type { SchoolClass } from "@/lib/types";

const cours = (o: Partial<SchoolClass> & { id: string }): SchoolClass => ({
  type: "cours",
  name: o.id,
  description: "",
  ...o,
});

/** Une école avec du primaire sans filière, du lycée avec filières, et une
 *  formation — de quoi exercer les trois branches de la cascade. */
const CLASSES: SchoolClass[] = [
  cours({ id: "prim4", name: "4e Primaire", coursLevel: "primaire", year: "4eme" }),
  cours({
    id: "lyc3s",
    name: "3AS Sciences",
    coursLevel: "lycee",
    year: "3eme",
    filiereId: "f-sciences",
  }),
  cours({
    id: "lyc3m",
    name: "3AS Maths",
    coursLevel: "lycee",
    year: "3eme",
    filiereId: "f-maths",
  }),
  // Deux classes partagent la MÊME combinaison : la cascade doit rendre les deux.
  cours({
    id: "lyc3s-b",
    name: "3AS Sciences B",
    coursLevel: "lycee",
    year: "3eme",
    filiereId: "f-sciences",
  }),
  cours({ id: "lyc1", name: "1AS", coursLevel: "lycee", year: "1er" }),
  {
    id: "form-b1",
    type: "formation",
    name: "Anglais B1",
    description: "",
    formationLevel: "B1",
  },
];

const filiereName = (id: string) =>
  ({ "f-sciences": "Sciences", "f-maths": "Maths" })[id] ?? "";

describe("levelOptionsOf — seulement ce que l'école a", () => {
  it("n'offre pas un niveau sans classe", () => {
    // Pas de « moyen » dans ce jeu : il ne doit pas apparaître.
    expect(levelOptionsOf(CLASSES).map((o) => o.value)).toEqual([
      "primaire",
      "lycee",
      "formation",
    ]);
  });

  it("garde l'ordre de la scolarité, formations en dernier", () => {
    const withMoyen = [...CLASSES, cours({ id: "m1", coursLevel: "moyen", year: "1er" })];
    expect(levelOptionsOf(withMoyen).map((o) => o.value)).toEqual([
      "primaire",
      "moyen",
      "lycee",
      "formation",
    ]);
  });

  it("ne rend rien du tout quand l'école n'a aucune classe", () => {
    expect(levelOptionsOf([])).toEqual([]);
  });
});

describe("classesOfLevel / yearOptionsOf", () => {
  it("les formations sont leur propre branche", () => {
    expect(classesOfLevel(CLASSES, "formation").map((c) => c.id)).toEqual(["form-b1"]);
    expect(classesOfLevel(CLASSES, "lycee").map((c) => c.id)).not.toContain("form-b1");
  });

  it("les années suivent l'ordre de la scolarité, pas l'alphabet", () => {
    // « 1er » avant « 3eme » : l'alphabet les inverserait.
    expect(yearOptionsOf(CLASSES, "lycee").map((o) => o.value)).toEqual(["1er", "3eme"]);
  });

  it("sur la branche formations, l'année porte le NIVEAU (A1, B1…)", () => {
    expect(yearOptionsOf(CLASSES, "formation").map((o) => o.value)).toEqual(["B1"]);
    expect(yearOptionsOf(CLASSES, "formation")[0].label).toBe("Niveau B1");
  });

  it("rien tant qu'aucun niveau n'est choisi", () => {
    expect(yearOptionsOf(CLASSES, "")).toEqual([]);
    expect(classesOfLevel(CLASSES, "")).toEqual([]);
  });
});

describe("filiereOptionsOf", () => {
  it("nomme les filières du niveau ET de l'année choisis", () => {
    expect(
      filiereOptionsOf(CLASSES, "lycee", "3eme", filiereName).map((o) => o.label),
    ).toEqual(["Maths", "Sciences"]);
  });

  it("« Sans filière » est une option, pas un trou", () => {
    // Sans elle, une classe de primaire serait inatteignable.
    const opts = filiereOptionsOf(CLASSES, "primaire", "4eme", filiereName);
    expect(opts.map((o) => o.value)).toEqual(["none"]);
    expect(opts[0].label).toBe("Sans filière");
  });
});

describe("matchedClassesOf — la cascade désigne une LISTE", () => {
  it("rend toutes les classes qui partagent la combinaison", () => {
    const hit = matchedClassesOf(CLASSES, "lycee", "3eme", "f-sciences");
    expect(hit.map((c) => c.id).sort()).toEqual(["lyc3s", "lyc3s-b"]);
  });

  it("« none » ne désigne que les classes SANS filière", () => {
    expect(matchedClassesOf(CLASSES, "lycee", "1er", "none").map((c) => c.id)).toEqual(["lyc1"]);
    expect(matchedClassesOf(CLASSES, "lycee", "3eme", "none")).toEqual([]);
  });

  it("sur la branche formations, l'année suffit à conclure", () => {
    expect(matchedClassesOf(CLASSES, "formation", "B1", "").map((c) => c.id)).toEqual(["form-b1"]);
  });

  it("ne devine rien tant que la cascade n'est pas conclue", () => {
    expect(matchedClassesOf(CLASSES, "lycee", "", "")).toEqual([]);
    expect(matchedClassesOf(CLASSES, "lycee", "3eme", "")).toEqual([]);
  });
});

describe("cascadeOfClass — pré-remplir depuis la scolarité connue", () => {
  it("ouvre les trois listes sur la classe d'un élève inscrit", () => {
    expect(cascadeOfClass(CLASSES.find((c) => c.id === "lyc3s"))).toEqual({
      level: "lycee",
      year: "3eme",
      filiereId: "f-sciences",
    });
  });

  it("une classe sans filière se décrit avec « none » — la même valeur que l'option", () => {
    expect(cascadeOfClass(CLASSES.find((c) => c.id === "prim4"))).toEqual({
      level: "primaire",
      year: "4eme",
      filiereId: "none",
    });
  });

  it("une formation se décrit par son niveau, sans filière", () => {
    expect(cascadeOfClass(CLASSES.find((c) => c.id === "form-b1"))).toEqual({
      level: "formation",
      year: "B1",
      filiereId: "",
    });
  });

  it("un élève sans classe connue laisse la cascade fermée", () => {
    expect(cascadeOfClass(undefined)).toEqual({ level: "", year: "", filiereId: "" });
  });

  it("le tour complet : décrire une classe, puis la retrouver", () => {
    // C'est la garantie qui compte : ce que `cascadeOfClass` annonce doit
    // permettre à `matchedClassesOf` de retomber sur la même classe.
    for (const cls of CLASSES) {
      const pos = cascadeOfClass(cls);
      const back = matchedClassesOf(CLASSES, pos.level, pos.year, pos.filiereId);
      expect(back.map((c) => c.id)).toContain(cls.id);
    }
  });
});
