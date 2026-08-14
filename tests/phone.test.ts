import { describe, it, expect } from "vitest";
import { toInternational, normalizePhone, isSendablePhone } from "@/lib/whatsapp/phone";

describe("toInternational — normalisation des numéros algériens", () => {
  it("numéro mobile local (0 initial) → international", () => {
    expect(toInternational("0555123456")).toBe("213555123456");
  });

  it("déjà international avec + et espaces", () => {
    expect(toInternational("+213 555 123 456")).toBe("213555123456");
  });

  it("déjà international sans +", () => {
    expect(toInternational("213555123456")).toBe("213555123456");
  });

  it("préfixe composé 00 (international)", () => {
    expect(toInternational("00213555123456")).toBe("213555123456");
  });

  it("indicatif suivi d'un 0 national parasite", () => {
    expect(toInternational("213 0555123456")).toBe("213555123456");
  });

  it("numéro nu de 9 chiffres (sans 0 ni indicatif)", () => {
    expect(toInternational("555123456")).toBe("213555123456");
  });

  it("espaces et ponctuation intercalés", () => {
    expect(toInternational("0555 12 34 56")).toBe("213555123456");
    expect(toInternational("(0555) 12-34-56")).toBe("213555123456");
  });

  it("numéro international étranger plausible conservé tel quel", () => {
    expect(toInternational("33612345678")).toBe("33612345678");
    expect(toInternational("+33 6 12 34 56 78")).toBe("33612345678");
  });

  it("numéro malformé (trop court) → null", () => {
    expect(toInternational("12345")).toBeNull();
  });

  it("chaîne vide → null", () => {
    expect(toInternational("")).toBeNull();
  });

  it("null / undefined → null", () => {
    expect(toInternational(null)).toBeNull();
    expect(toInternational(undefined)).toBeNull();
  });

  it("local trop court après le 0 → null", () => {
    expect(toInternational("0555")).toBeNull();
  });
});

describe("normalizePhone — MSISDN Meta (chiffres, sans @c.us) + affichage", () => {
  it("produit le MSISDN et l'affichage pour un local algérien", () => {
    const n = normalizePhone("0555123456");
    expect(n).not.toBeNull();
    // Meta attend le numéro en chiffres bruts, PAS un identifiant "@c.us".
    expect(n!.msisdn).toBe("213555123456");
    expect(n!.msisdn).not.toContain("@c.us");
    expect(n!.display).toBe("+213 555 123 456");
  });

  it("renvoie null sur numéro inexploitable", () => {
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("numéro étranger : affichage brut avec +", () => {
    const n = normalizePhone("33612345678");
    expect(n!.msisdn).toBe("33612345678");
    expect(n!.display).toBe("+33612345678");
  });
});

describe("isSendablePhone", () => {
  it("true pour un numéro valide", () => {
    expect(isSendablePhone("0555123456")).toBe(true);
    expect(isSendablePhone("+213555123456")).toBe(true);
  });

  it("false pour vide / null / malformé", () => {
    expect(isSendablePhone("")).toBe(false);
    expect(isSendablePhone(null)).toBe(false);
    expect(isSendablePhone("123")).toBe(false);
  });
});
