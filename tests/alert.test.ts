import { describe, it, expect } from "vitest";
import { balanceAlertTemplate, buildBalanceAlert } from "@/lib/whatsapp/alert";

const school = { name: "École Benzaoui", phone: "+213 21 00 00 00" };

describe("balanceAlertTemplate — choix du modèle selon la situation", () => {
  it("solde négatif → dette", () => {
    expect(balanceAlertTemplate({ balance: -500 })).toBe("debt");
  });

  it("solde nul → solde épuisé", () => {
    expect(balanceAlertTemplate({ balance: 0 })).toBe("balance_empty");
  });

  it("solde faible signalé par l'appelant → solde bientôt épuisé", () => {
    expect(balanceAlertTemplate({ balance: 800 }, { low: true })).toBe("balance_low");
  });

  it("frais d'inscription dus (sans solde faible) → inscription", () => {
    expect(balanceAlertTemplate({ balance: 5000, registrationDue: 2000 })).toBe("registration");
  });

  it("situation saine → aucun modèle (null)", () => {
    expect(balanceAlertTemplate({ balance: 5000 })).toBeNull();
  });
});

describe("buildBalanceAlert — résolution du destinataire", () => {
  const student = {
    firstName: "Yacine",
    lastName: "Meziane",
    balance: -1200,
    phone: "0555111222",
  };

  it("privilégie le parent joignable et vise un modèle Meta", () => {
    const parent = { firstName: "Karim", lastName: "Meziane", phone: "0661333444" };
    const out = buildBalanceAlert({ student, parent, school, lang: "fr", low: false });
    expect(out).not.toBeNull();
    expect(out!.phone).toBe("0661333444");
    expect(out!.name).toBe("Karim Meziane");
    // Message proactif : un MODÈLE approuvé, jamais du texte libre.
    expect(out!.message.kind).toBe("template");
    if (out!.message.kind === "template") {
      expect(out!.message.templateId).toBe("debt");
      expect(out!.message.language).toBe("fr");
      // {{1}} = nom élève, {{2}} = montant, {{3}} = école
      expect(out!.message.variables[0]).toBe("Yacine Meziane");
      expect(out!.message.variables[1]).toContain("200");
      expect(out!.message.variables[2]).toBe("École Benzaoui");
    }
  });

  it("bascule sur l'élève si le parent n'a pas de numéro exploitable", () => {
    const parent = { firstName: "Karim", lastName: "Meziane", phone: "" };
    const out = buildBalanceAlert({ student, parent, school, lang: "fr", low: false });
    expect(out!.phone).toBe("0555111222");
    expect(out!.name).toBe("Yacine Meziane");
  });

  it("renvoie null si ni parent ni élève ne sont joignables", () => {
    const noPhone = { ...student, phone: "" };
    const parent = { firstName: "Karim", lastName: "Meziane", phone: "xxx" };
    expect(buildBalanceAlert({ student: noPhone, parent, school, lang: "fr" })).toBeNull();
  });
});

describe("buildBalanceAlert — modèle et aperçu", () => {
  it("solde faible positif → modèle balance_low", () => {
    const out = buildBalanceAlert({
      student: { firstName: "Sara", lastName: "Bakhti", balance: 700, phone: "0555000111" },
      lang: "fr",
      low: true,
    });
    expect(out!.message.kind).toBe("template");
    if (out!.message.kind === "template") expect(out!.message.templateId).toBe("balance_low");
    // L'aperçu lisible reste construit pour le journal / l'affichage.
    expect(out!.previewText).toContain("épuisement");
    expect(out!.previewText).toContain("Sara Bakhti");
  });

  it("dette → l'aperçu mentionne le montant dû et le nom de l'école", () => {
    const out = buildBalanceAlert({
      student: { firstName: "Sara", lastName: "Bakhti", balance: -1500, phone: "0555000111" },
      school,
      lang: "fr",
    });
    expect(out!.previewText).toContain("dette");
    expect(out!.previewText).toContain("École Benzaoui");
  });

  it("langue arabe : variables + aperçu, code langue « ar »", () => {
    const out = buildBalanceAlert({
      student: { firstName: "Sara", lastName: "Bakhti", balance: -1500, phone: "0555000111" },
      school,
      lang: "ar",
    });
    if (out!.message.kind === "template") expect(out!.message.language).toBe("ar");
    expect(/[؀-ۿ]/.test(out!.previewText)).toBe(true);
  });

  it("situation saine sans modèle explicite → null (aucun envoi)", () => {
    const out = buildBalanceAlert({
      student: { firstName: "Sara", lastName: "Bakhti", balance: 9000, phone: "0555000111" },
      lang: "fr",
    });
    expect(out).toBeNull();
  });

  it("modèle « custom » forcé → message texte libre (aperçu = formule d'adresse)", () => {
    const out = buildBalanceAlert({
      student: { firstName: "Sara", lastName: "Bakhti", balance: 9000, phone: "0555000111" },
      lang: "fr",
      templateId: "custom",
    });
    expect(out).not.toBeNull();
    expect(out!.message.kind).toBe("text");
    if (out!.message.kind === "text") expect(out!.message.text.trim()).toBe("Bonjour Sara Bakhti,");
  });
});
