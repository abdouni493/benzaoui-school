import { describe, it, expect } from "vitest";
import { deskPaymentFor } from "@/lib/helpers";

// Ce que le guichet encaisse quand un écran prend un versement ET règle les
// frais d'inscription en une fois (« Ajouter un étudiant », « Modifier
// l'étudiant »). Les frais réglés sortent TOUJOURS du versement : la caisse ne
// reçoit jamais deux fois la même somme.
describe("deskPaymentFor", () => {
  it("cashes the versement and takes the fee out of it", () => {
    expect(deskPaymentFor(5000, 3000, true)).toEqual({ cashed: 5000, balanceDelta: 2000 });
  });

  it("cashes the fee alone when there is no versement, leaving the balance alone", () => {
    expect(deskPaymentFor(0, 3000, true)).toEqual({ cashed: 3000, balanceDelta: 0 });
  });

  it("leaves the fee due when it is not settled now", () => {
    expect(deskPaymentFor(5000, 3000, false)).toEqual({ cashed: 5000, balanceDelta: 5000 });
  });

  it("moves nothing at all when neither is asked for", () => {
    expect(deskPaymentFor(0, 3000, false)).toEqual({ cashed: 0, balanceDelta: 0 });
    expect(deskPaymentFor(0, 0, true)).toEqual({ cashed: 0, balanceDelta: 0 });
  });

  it("sends the balance negative when the versement does not cover the fee", () => {
    expect(deskPaymentFor(1000, 3000, true)).toEqual({ cashed: 1000, balanceDelta: -2000 });
  });

  it("rounds the amounts and never cashes a negative one", () => {
    expect(deskPaymentFor(999.6, 0, false)).toEqual({ cashed: 1000, balanceDelta: 1000 });
    expect(deskPaymentFor(-500, 0, false)).toEqual({ cashed: 0, balanceDelta: 0 });
    expect(deskPaymentFor(2000, -300, true)).toEqual({ cashed: 2000, balanceDelta: 2000 });
  });

  it("keeps the caisse and the balance in step: cashed - balanceDelta is the fee settled", () => {
    for (const [topup, fee] of [
      [0, 0],
      [0, 1500],
      [4000, 1500],
      [1500, 1500],
      [800, 1500],
    ] as const) {
      const settled = deskPaymentFor(topup, fee, true);
      expect(settled.cashed - settled.balanceDelta).toBe(fee);
      const left = deskPaymentFor(topup, fee, false);
      expect(left.cashed - left.balanceDelta).toBe(0);
    }
  });
});
