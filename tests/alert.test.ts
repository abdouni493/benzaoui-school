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

  it("privilégie le parent joignable (adresse « parent »)", () => {
    const parent = { firstName: "Karim", lastName: "Meziane", phone: "0661333444" };
    const out = buildBalanceAlert({ student, parent, school, lang: "fr", low: false });
    expect(out).not.toBeNull();
    expect(out!.phone).toBe("0661333444");
    expect(out!.name).toBe("Karim Meziane");
    expect(out!.text).toContain("cher parent");
    expect(out!.text).toContain("Yacine Meziane");
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

describe("buildBalanceAlert — contenu du message", () => {
  it("solde faible positif → modèle balance_low (pas un simple bonjour)", () => {
    const out = buildBalanceAlert({
      student: { firstName: "Sara", lastName: "Bakhti", balance: 700, phone: "0555000111" },
      lang: "fr",
      low: true,
    });
    expect(out!.text).toContain("épuisement");
    expect(out!.text).toContain("Sara Bakhti");
  });

  it("dette → mentionne le montant dû et le nom de l'école", () => {
    const out = buildBalanceAlert({
      student: { firstName: "Sara", lastName: "Bakhti", balance: -1500, phone: "0555000111" },
      school,
      lang: "fr",
    });
    expect(out!.text).toContain("dette");
    expect(out!.text).toContain("École Benzaoui");
  });

  it("langue arabe : le corps est en arabe", () => {
    const out = buildBalanceAlert({
      student: { firstName: "Sara", lastName: "Bakhti", balance: -1500, phone: "0555000111" },
      school,
      lang: "ar",
    });
    // Présence de caractères arabes.
    expect(/[؀-ۿ]/.test(out!.text)).toBe(true);
  });

  it("situation saine sans modèle explicite → null (aucun envoi)", () => {
    const out = buildBalanceAlert({
      student: { firstName: "Sara", lastName: "Bakhti", balance: 9000, phone: "0555000111" },
      lang: "fr",
    });
    expect(out).toBeNull();
  });

  it("modèle explicite forcé (parité avec l'envoi groupé de la fiche élève)", () => {
    const out = buildBalanceAlert({
      student: { firstName: "Sara", lastName: "Bakhti", balance: 9000, phone: "0555000111" },
      lang: "fr",
      templateId: "custom",
    });
    // Le modèle « custom » ne produit que la formule d'adresse.
    expect(out).not.toBeNull();
    expect(out!.text.trim()).toBe("Bonjour Sara Bakhti,");
  });
});
