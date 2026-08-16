import { describe, it, expect } from "vitest";
import {
  classCascadeLabel,
  matchesAllWords,
  normalizeSearchText,
  COURS_LEVELS,
  YEAR_ORDER,
} from "@/lib/helpers";
import type { SchoolClass } from "@/lib/types";

const lycee2Sciences: SchoolClass = {
  id: "c1",
  type: "cours",
  name: "2eme Année - Sciences expérimentales",
  description: "",
  coursLevel: "lycee",
  year: "2eme",
  filiereId: "f1",
};

const moyen1: SchoolClass = {
  id: "c2",
  type: "cours",
  name: "1er Année",
  description: "",
  coursLevel: "moyen",
  year: "1er",
};

const anglaisA1: SchoolClass = {
  id: "c3",
  type: "formation",
  name: "Anglais débutants",
  description: "",
  formationLevel: "A1",
};

describe("classCascadeLabel — niveau · année · filière", () => {
  it("cours: niveau, année et filière", () => {
    expect(classCascadeLabel(lycee2Sciences, "Sciences expérimentales")).toBe(
      "Lycée · 2eme Année · Sciences expérimentales",
    );
  });

  it("cours sans filière: la partie filière disparaît", () => {
    expect(classCascadeLabel(moyen1)).toBe("Moyen · 1er Année");
  });

  it("formation: son niveau remplace année et filière", () => {
    expect(classCascadeLabel(anglaisA1)).toBe("Formation · A1 · Anglais débutants");
  });
});

describe("normalizeSearchText", () => {
  it("supprime les accents et met en minuscules", () => {
    expect(normalizeSearchText("Lycée")).toBe("lycee");
    expect(normalizeSearchText("Sciences expérimentales")).toBe("sciences experimentales");
  });

  it("laisse intact un texte déjà normalisé", () => {
    expect(normalizeSearchText("moyen 1er")).toBe("moyen 1er");
  });
});

describe("matchesAllWords — recherche directe « niveau + année + filière »", () => {
  const label = classCascadeLabel(lycee2Sciences, "Sciences expérimentales");

  it("trouve la classe avec les trois critères, sans accents", () => {
    expect(matchesAllWords(label, "lycee 2eme sciences")).toBe(true);
  });

  it("l'ordre des mots n'a pas d'importance", () => {
    expect(matchesAllWords(label, "sciences lycee 2eme")).toBe(true);
  });

  it("accepte les accents tapés par l'utilisateur", () => {
    expect(matchesAllWords(label, "Lycée Sciences expérimentales")).toBe(true);
  });

  it("recherche partielle: niveau + année seulement", () => {
    expect(matchesAllWords(label, "lycee 2eme")).toBe(true);
  });

  it("un seul mot faux suffit à exclure la classe", () => {
    expect(matchesAllWords(label, "lycee 2eme lettres")).toBe(false);
    expect(matchesAllWords(label, "moyen 2eme sciences")).toBe(false);
  });

  it("ne confond pas deux niveaux", () => {
    expect(matchesAllWords(classCascadeLabel(moyen1), "lycee 1er")).toBe(false);
    expect(matchesAllWords(classCascadeLabel(moyen1), "moyen 1er")).toBe(true);
  });

  it("une recherche vide laisse tout passer", () => {
    expect(matchesAllWords(label, "")).toBe(true);
    expect(matchesAllWords(label, "   ")).toBe(true);
  });
});

describe("ordre des niveaux et des années", () => {
  it("les niveaux suivent la scolarité", () => {
    expect(COURS_LEVELS).toEqual(["primaire", "moyen", "lycee"]);
  });

  it("les années sont triées, pas alphabétiques", () => {
    const shuffled = ["3eme", "1er", "5eme", "2eme"];
    const sorted = [...shuffled].sort((a, b) => YEAR_ORDER.indexOf(a) - YEAR_ORDER.indexOf(b));
    expect(sorted).toEqual(["1er", "2eme", "3eme", "5eme"]);
  });
});
