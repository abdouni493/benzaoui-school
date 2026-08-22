import { describe, it, expect } from "vitest";

import {
  buildRechargeTicket,
  fmtAmount,
  makeRechargeNumber,
  type RechargeTicketData,
} from "@/lib/reports/rechargeTicket";
import type { School, Student } from "@/lib/types";

const school: School = {
  id: "sch",
  name: "École Benzaoui",
  description: "Cours de soutien",
  phone: "0555 12 34 56",
  email: "contact@benzaoui.com",
  address: "12 rue des Écoles, Alger",
  nif: "0001",
  nis: "0002",
  registreCommerce: "RC-3",
  articleFiscal: "AF-4",
};

const student: Student = {
  id: "stu",
  firstName: "Amine",
  lastName: "Benali",
  birthDate: "2008-03-12",
  phone: "0661 00 11 22",
  email: "amine.benali@benzaoui.com",
  rfid: "0009876543",
  balance: 4000,
  isFree: false,
  subscriptionIds: [],
};

const base: RechargeTicketData = {
  school,
  student,
  password: "Xk9d2p",
  schooling: "Lycée · 3eme Année · Sciences",
  amount: 5000,
  description: "Recharge de solde",
  balanceBefore: 1000,
  balanceAfter: 4000,
  registrationSettled: 0,
  language: "fr",
};

const AT = new Date("2026-08-21T14:32:00");

describe("fmtAmount", () => {
  it("groupe les milliers par une espace ordinaire", () => {
    // Intl insérerait U+202F, que certains pilotes thermiques rendent en « ? ».
    expect(fmtAmount(12500)).toBe("12 500");
    expect(fmtAmount(1234567)).toBe("1 234 567");
    expect(fmtAmount(999)).toBe("999");
  });

  it("garde le signe des soldes négatifs (une dette s'imprime aussi)", () => {
    expect(fmtAmount(-2500)).toBe("-2 500");
  });
});

describe("makeRechargeNumber", () => {
  it("porte l'année du bon et un numéro à six chiffres", () => {
    expect(makeRechargeNumber(AT)).toMatch(/^BCS-2026-\d{6}$/);
  });
});

describe("buildRechargeTicket — format 80 mm", () => {
  const html = buildRechargeTicket(base, AT);

  it("impose le rouleau de 80 mm, et pas l'A4 hérité du modèle commun", () => {
    // « size: 80mm auto » n'existe pas : le navigateur jetait la déclaration,
    // gardait le « size: A4 » du modèle commun, composait le bon sur 210 mm
    // puis réduisait la page à la largeur du rouleau — le ticket sortait au
    // tiers de sa taille. La feuille A4 ne doit donc plus être là du tout.
    expect(html).toContain("@page { size: auto; margin: 0; }");
    expect(html).not.toContain("size: A4");
    expect(html).not.toContain("80mm auto");
    // 72 mm centrés dans les 80 mm de la bobine : toute la largeur imprimable,
    // les ~4 mm restants de chaque côté étant hors de portée de la tête.
    expect(html).toContain("width: 72mm");
  });

  it("n'imprime rien de la facture A4 précédente", () => {
    // Ni dans le corps, ni dans la feuille de style : le bon est un document
    // autonome, aucune règle de la facture A4 ne l'accompagne.
    for (const gone of [
      "Modules Souscrits",
      "signature-block",
      "NIF:",
      "Art. Fiscal",
      "Reçu de Versement",
      ".letterhead",
      "doc-title-banner",
    ]) {
      expect(html).not.toContain(gone);
    }
  });

  it("porte l'école, l'élève, sa scolarité et ses identifiants", () => {
    expect(html).toContain("École Benzaoui");
    expect(html).toContain("Benali Amine");
    expect(html).toContain("0009876543");
    expect(html).toContain("Lycée · 3eme Année · Sciences");
    expect(html).toContain("amine.benali@benzaoui.com");
    expect(html).toContain("Xk9d2p");
  });

  it("affiche le montant chargé, les deux soldes, la date et l'heure", () => {
    expect(html).toContain("+5 000 DA");
    expect(html).toContain("1 000 DA");
    expect(html).toContain("4 000 DA");
    expect(html).toContain("21/08/2026");
    expect(html).toContain("14:32");
  });

  it("montre le logo de l'école quand il y en a un", () => {
    const withLogo = buildRechargeTicket(
      { ...base, school: { ...school, logo: "data:image/png;base64,AAA" } },
      AT,
    );
    expect(withLogo).toContain('class="logo"');
    expect(withLogo).toContain("data:image/png;base64,AAA");
    // Sans logo, un emplacement de même taille garde la hauteur constante.
    expect(html).toContain("logo-fallback");
  });

  it("n'ajoute la ligne d'inscription que si des frais ont été réglés", () => {
    expect(html).not.toContain("Frais d'inscription");
    const settled = buildRechargeTicket({ ...base, registrationSettled: 2000 }, AT);
    expect(settled).toContain("Frais d'inscription");
    expect(settled).toContain("-2 000 DA");
  });

  it("omet les lignes sans donnée plutôt que d'imprimer un tiret", () => {
    const bare = buildRechargeTicket(
      { ...base, student: { ...student, rfid: "", phone: "", birthDate: "" }, schooling: "" },
      AT,
    );
    expect(bare).not.toContain("Carte RFID");
    expect(bare).not.toContain("Téléphone");
    expect(bare).not.toContain("Scolarité");
    // Le mot de passe, lui, reste affiché : son absence est une information.
    expect(bare).toContain("Mot de passe");
  });

  it("le dit quand le mot de passe n'a jamais été enregistré", () => {
    expect(buildRechargeTicket({ ...base, password: "" }, AT)).toContain("non enregistré");
  });

  it("échappe le balisage venu des données", () => {
    const nasty = buildRechargeTicket(
      { ...base, student: { ...student, lastName: "<script>x</script>" } },
      AT,
    );
    expect(nasty).not.toContain("<script>x</script>");
    expect(nasty).toContain("&lt;script&gt;");
  });

  it("bascule en RTL avec les libellés arabes", () => {
    const ar = buildRechargeTicket({ ...base, language: "ar" }, AT);
    expect(ar).toContain('dir="rtl"');
    expect(ar).toContain("وصل شحن الرصيد");
    expect(ar).toContain("دج");
  });
});
