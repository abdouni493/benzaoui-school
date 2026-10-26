import { describe, it, expect } from "vitest";

import { confirmsStudentDeletion, deletionRefusal, ROLE_OF_STORE_KEY } from "@/lib/accountDeletion";

describe("deletionRefusal — un élève ne part que par sa propre porte", () => {
  it("laisse passer la suppression d'un élève annoncée comme telle", () => {
    expect(deletionRefusal("student", "student")).toBeNull();
  });

  it("refuse un élève supprimé sans rôle, ou sous un autre rôle", () => {
    expect(deletionRefusal("student", null)).toMatch(/ÉLÈVE/);
    expect(deletionRefusal("student", "parent")).toMatch(/ÉLÈVE/);
    expect(deletionRefusal("student", "reception")).toMatch(/ÉLÈVE/);
    expect(deletionRefusal("student", "teacher")).toMatch(/ÉLÈVE/);
  });

  it("refuse un compte dont le rôle ne correspond pas à celui annoncé", () => {
    expect(deletionRefusal("parent", "teacher")).not.toBeNull();
    expect(deletionRefusal("teacher", "parent")).not.toBeNull();
  });

  it("ne supprime jamais un administrateur depuis l'application", () => {
    expect(deletionRefusal("admin", "reception")).not.toBeNull();
    expect(deletionRefusal("admin", null)).not.toBeNull();
  });

  it("laisse passer un travailleur ou un passager sans connexion (aucun profil)", () => {
    expect(deletionRefusal(null, "reception")).toBeNull();
    expect(deletionRefusal(null, "teacher")).toBeNull();
  });

  it("annonce le bon rôle pour chaque table reliée à une connexion", () => {
    expect(ROLE_OF_STORE_KEY).toEqual({
      students: "student",
      teachers: "teacher",
      parents: "parent",
      reception: "reception",
    });
  });
});

describe("confirmsStudentDeletion — ni un badge ni Entrée ne confirment", () => {
  it("n'accepte que le mot SUPPRIMER (casse et espaces indifférents)", () => {
    expect(confirmsStudentDeletion("SUPPRIMER")).toBe(true);
    expect(confirmsStudentDeletion("  supprimer ")).toBe(true);
  });

  it("refuse une saisie vide ou un code de carte tapé par le lecteur", () => {
    expect(confirmsStudentDeletion("")).toBe(false);
    expect(confirmsStudentDeletion("0012345678")).toBe(false);
    expect(confirmsStudentDeletion("RFID-0042")).toBe(false);
    expect(confirmsStudentDeletion("SUPPRIMER0012345678")).toBe(false);
  });
});
