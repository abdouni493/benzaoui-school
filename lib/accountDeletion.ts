/**
 * QUI A LE DROIT DE SUPPRIMER UN COMPTE — et lequel.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * Supprimer la connexion d'un élève (auth.users) emporte, par cascade, sa
 * fiche, ses présences, son historique d'argent et ses absences : il n'existe
 * aucune corbeille. Entre le 30 septembre et le 23 octobre 2026, plus de
 * trente fiches ont disparu ainsi, dont des élèves qui venaient de payer — la
 * caisse gardait leurs versements, la base n'avait plus l'élève.
 *
 * La route de suppression acceptait n'importe quel identifiant, sans savoir ce
 * qu'elle supprimait. Elle exige désormais que l'appel DISE ce qu'il supprime
 * (`?role=student`), et refuse dès que le compte réel ne correspond pas : un
 * élève ne peut plus partir par le bouton « supprimer un parent », « supprimer
 * un travailleur » ou un appel sans rôle.
 *
 * Fonction pure, testée dans tests/account-deletion.test.ts.
 */

export type AccountRole = "admin" | "reception" | "teacher" | "student" | "parent";

/** Le mot à taper pour supprimer un élève. Un mot, pas « OK » : ni un badge
 *  (le lecteur tape un code puis Entrée) ni Entrée seule ne peuvent l'écrire. */
export const DELETE_STUDENT_WORD = "SUPPRIMER";

/** La saisie confirme-t-elle la suppression ? (casse et espaces indifférents) */
export function confirmsStudentDeletion(typed: string): boolean {
  return typed.trim().toUpperCase() === DELETE_STUDENT_WORD;
}

/** Le rôle à annoncer pour chaque table du store reliée à une connexion. */
export const ROLE_OF_STORE_KEY: Record<string, AccountRole> = {
  students: "student",
  teachers: "teacher",
  parents: "parent",
  reception: "reception",
};

/**
 * Pourquoi la suppression est refusée, ou `null` si elle peut passer.
 *
 * `actual` : le rôle du compte en base (`null` = aucun profil, ce qui est
 * normal pour un travailleur ou un enseignant passager sans connexion).
 * `expected` : le rôle que l'appel déclare supprimer.
 */
export function deletionRefusal(actual: string | null, expected: string | null): string | null {
  if (actual === "admin") {
    return "Un compte administrateur ne se supprime pas depuis cet écran.";
  }
  if (actual === "student" && expected !== "student") {
    return (
      "Ce compte est celui d'un ÉLÈVE : il ne peut être supprimé que depuis sa fiche " +
      "(écran Étudiants → « Supprimer l'élève »), avec confirmation."
    );
  }
  if (actual && expected && actual !== expected) {
    return `Ce compte est un compte « ${actual} », pas « ${expected} » : suppression refusée.`;
  }
  return null;
}
