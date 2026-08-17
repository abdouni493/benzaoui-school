import { describe, it, expect } from "vitest";
import { REGISTRATION_FEE_LABELS, registrationFeeOptions } from "@/lib/helpers";
import type { School } from "@/lib/types";

const school = (patch: Partial<School>): Partial<School> => patch;

describe("registrationFeeOptions", () => {
  it("offers nothing when the school charges no inscription", () => {
    expect(registrationFeeOptions(school({}))).toEqual([]);
    expect(registrationFeeOptions(school({ registrationFee: 0, registrationFee2: 0 }))).toEqual([]);
  });

  it("offers nothing when the school row has not loaded yet", () => {
    expect(registrationFeeOptions(undefined)).toEqual([]);
  });

  it("keeps only the tariffs that carry an amount", () => {
    const opts = registrationFeeOptions(
      school({ registrationFee: 0, registrationFee2: 1500, registrationFee2Label: "Semestrielle" }),
    );
    expect(opts).toEqual([{ key: "fee2", label: "Semestrielle", amount: 1500 }]);
  });

  it("names an unnamed tariff after its rank", () => {
    const opts = registrationFeeOptions(school({ registrationFee: 1000, registrationFee2: 600 }));
    expect(opts.map((o) => o.label)).toEqual([
      REGISTRATION_FEE_LABELS.fee1,
      REGISTRATION_FEE_LABELS.fee2,
    ]);
  });

  it("ignores a label made of spaces, and rounds the amounts", () => {
    const opts = registrationFeeOptions(
      school({ registrationFee: 999.6, registrationFeeLabel: "   ", registrationFee2: 0 }),
    );
    expect(opts).toEqual([{ key: "fee1", label: REGISTRATION_FEE_LABELS.fee1, amount: 1000 }]);
  });

  it("never offers a negative tariff", () => {
    expect(registrationFeeOptions(school({ registrationFee: -500 }))).toEqual([]);
  });

  it("lists both tariffs in order when both are charged", () => {
    const opts = registrationFeeOptions(
      school({
        registrationFee: 2000,
        registrationFeeLabel: "Annuelle",
        registrationFee2: 1200,
        registrationFee2Label: "Semestrielle",
      }),
    );
    expect(opts).toEqual([
      { key: "fee1", label: "Annuelle", amount: 2000 },
      { key: "fee2", label: "Semestrielle", amount: 1200 },
    ]);
  });
});
