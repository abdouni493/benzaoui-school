import { describe, it, expect } from "vitest";

import { FREE_REASON_LABELS, freeReasonOf } from "@/lib/helpers";
import type { AttendanceRecord } from "@/lib/types";

/** Une présence réduite à ce que la facturation regarde. */
const att = (o: Partial<AttendanceRecord> = {}) =>
  ({ amountDeducted: 0, waivedAmount: 0, ...o }) as AttendanceRecord;

describe("freeReasonOf", () => {
  it("ne trouve aucune raison quand la séance a bien été facturée", () => {
    expect(freeReasonOf(att({ amountDeducted: 650 }))).toBeNull();
    // Même débitée, une séance peut porter un waivedAmount résiduel : c'est le
    // montant qui tranche, pas la colonne annexe.
    expect(freeReasonOf(att({ amountDeducted: 650, waivedAmount: 650 }))).toBeNull();
  });

  it("reconnaît une période gratuite", () => {
    expect(freeReasonOf(att({ freePeriodId: "fp-1", waivedAmount: 650 }))).toBe("freePeriod");
  });

  it("reconnaît une inscription pas encore commencée", () => {
    expect(freeReasonOf(att({ preStart: true, waivedAmount: 650 }))).toBe("preStart");
  });

  it("reconnaît un créneau offert, qui n'a AUCUNE colonne dédiée", () => {
    // Le cas qui s'affichait « -0 DA » en rouge, comme une panne : seul le
    // prix mis de côté trahit la gratuité.
    expect(freeReasonOf(att({ waivedAmount: 650 }))).toBe("freeSeance");
  });

  it("reconnaît un créneau offert SANS tarif, qui ne met rien de côté", () => {
    // Un créneau coché « offerte » à sa création écrit un tarif de 0 DA :
    // waivedAmount vaut 0 lui aussi, et l'écran annonçait « tarif à 0 ».
    expect(freeReasonOf(att(), { sessionIsFree: true })).toBe("freeSeance");
  });

  it("reconnaît un élève gratuit, qui ne met rien de côté non plus", () => {
    expect(freeReasonOf(att(), { studentIsFree: true })).toBe("freeStudent");
  });

  it("se rabat sur un tarif réellement nul", () => {
    expect(freeReasonOf(att(), { studentIsFree: false })).toBe("zeroPrice");
    expect(freeReasonOf(att())).toBe("zeroPrice");
  });

  it("classe la période gratuite avant les autres raisons cumulées", () => {
    // Un élève gratuit qui badge pendant une période gratuite avant le début
    // de son abonnement : on nomme la raison la plus spécifique.
    expect(
      freeReasonOf(att({ freePeriodId: "fp-1", preStart: true, waivedAmount: 650 }), {
        studentIsFree: true,
      }),
    ).toBe("freePeriod");
  });

  it("a un libellé pour chaque raison", () => {
    for (const reason of ["freePeriod", "preStart", "freeSeance", "freeStudent", "zeroPrice"] as const) {
      expect(FREE_REASON_LABELS[reason]).toBeTruthy();
    }
  });
});
