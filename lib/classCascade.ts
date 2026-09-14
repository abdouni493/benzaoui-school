/**
 * La cascade « niveau → année → filière ».
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * C'est la façon dont une école parle de la scolarité d'un élève : « Lycée,
 * 3e année, Sciences ». Le modèle de données, lui, ne connaît qu'une table
 * `classes` dont chaque ligne porte les trois axes à la fois — plusieurs
 * lignes peuvent donc partager la même combinaison.
 *
 * L'écran Étudiants avait sa propre copie de cette logique. Les écrans Séance
 * libre et Particulier en avaient besoin à leur tour, et une troisième copie
 * aurait fini par diverger : il suffit qu'un écran oublie « Sans filière »
 * pour qu'une classe devienne introuvable là et trouvable ailleurs.
 *
 * Tout est pur : aucune dépendance au store, donc testable sans base.
 */

import type { CoursLevel, SchoolClass } from "@/lib/types";
import { COURS_LEVELS, COURS_LEVEL_LABELS, YEAR_ORDER } from "@/lib/helpers";

/** Premier axe de la cascade : un niveau de cours, ou la branche formations. */
export type LevelKey = "" | CoursLevel | "formation";

/** Une marche de la cascade, avec les classes qu'elle recouvre. */
export interface CascadeOption {
  value: string;
  label: string;
  classes: SchoolClass[];
}

/** Ce que porte une classe, exprimé dans les termes de la cascade. Sert à
 *  PRÉ-REMPLIR les trois listes depuis la scolarité déjà connue d'un élève. */
export interface CascadePosition {
  level: LevelKey;
  year: string;
  /** "none" quand la classe n'a pas de filière — la même valeur que l'option */
  filiereId: string;
}

/** Les classes du niveau choisi (les formations sont leur propre branche). */
export function classesOfLevel(classes: SchoolClass[], level: LevelKey): SchoolClass[] {
  if (!level) return [];
  if (level === "formation") return classes.filter((c) => c.type === "formation");
  return classes.filter((c) => c.type === "cours" && c.coursLevel === level);
}

/** Étape 1 — seulement les niveaux pour lesquels l'école a des classes. */
export function levelOptionsOf(classes: SchoolClass[]): CascadeOption[] {
  const out: CascadeOption[] = COURS_LEVELS.map((level) => ({
    value: level as string,
    label: COURS_LEVEL_LABELS[level],
    classes: classes.filter((c) => c.type === "cours" && c.coursLevel === level),
  }));
  const formations = classes.filter((c) => c.type === "formation");
  if (formations.length > 0) {
    out.push({ value: "formation", label: "Formations", classes: formations });
  }
  return out.filter((o) => o.classes.length > 0);
}

/** L'année d'une classe, ou — sur la branche formations — son niveau (A1, B2…),
 *  que la cascade range au même endroit. */
function yearKeyOf(cls: SchoolClass, level: LevelKey): string {
  return (level === "formation" ? cls.formationLevel : cls.year) ?? "";
}

/** Étape 2 — les années effectivement ouvertes sur ce niveau. */
export function yearOptionsOf(classes: SchoolClass[], level: LevelKey): CascadeOption[] {
  const byKey = new Map<string, SchoolClass[]>();
  for (const cls of classesOfLevel(classes, level)) {
    const key = yearKeyOf(cls, level);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), cls]);
  }
  return [...byKey.entries()]
    .map(([value, list]) => ({
      value,
      label: level === "formation" ? `Niveau ${value}` : `${value} Année`,
      classes: list,
    }))
    .sort((a, b) => {
      const ia = YEAR_ORDER.indexOf(a.value);
      const ib = YEAR_ORDER.indexOf(b.value);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.value.localeCompare(b.value);
    });
}

/**
 * Étape 3 — les filières enseignées sur ce niveau ET cette année.
 *
 * « Sans filière » est une option à part entière, pas un trou : une classe de
 * primaire n'a pas de filière, et sans cette option elle serait inatteignable.
 */
export function filiereOptionsOf(
  classes: SchoolClass[],
  level: LevelKey,
  year: string,
  filiereLabel: (id: string) => string,
): CascadeOption[] {
  const byKey = new Map<string, SchoolClass[]>();
  for (const cls of classesOfLevel(classes, level)) {
    if (yearKeyOf(cls, level) !== year) continue;
    const key = cls.filiereId || "none";
    byKey.set(key, [...(byKey.get(key) ?? []), cls]);
  }
  return [...byKey.entries()]
    .map(([value, list]) => ({
      value,
      label: value === "none" ? "Sans filière" : filiereLabel(value) || "Filière",
      classes: list,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Les classes que la cascade désigne. Plusieurs lignes peuvent partager la même
 * combinaison — d'où une liste, jamais une classe unique.
 *
 * Sur la branche formations, la filière n'existe pas : l'année (le niveau A1…)
 * suffit à conclure la cascade.
 */
export function matchedClassesOf(
  classes: SchoolClass[],
  level: LevelKey,
  year: string,
  filiereId: string,
): SchoolClass[] {
  if (!level || !year) return [];
  const pool = classesOfLevel(classes, level);
  if (level === "formation") {
    return pool.filter((c) => (c.formationLevel ?? "") === year);
  }
  if (!filiereId) return [];
  return pool.filter(
    (c) =>
      (c.year ?? "") === year &&
      (filiereId === "none" ? !c.filiereId : c.filiereId === filiereId),
  );
}

/** Où une classe se situe dans la cascade — pour ouvrir les trois listes déjà
 *  remplies sur la scolarité d'un élève qu'on vient de sélectionner. */
export function cascadeOfClass(cls: SchoolClass | undefined): CascadePosition {
  if (!cls) return { level: "", year: "", filiereId: "" };
  if (cls.type === "formation") {
    return { level: "formation", year: cls.formationLevel ?? "", filiereId: "" };
  }
  return {
    level: cls.coursLevel ?? "",
    year: cls.year ?? "",
    filiereId: cls.filiereId || "none",
  };
}
