import { describe, expect, it } from "vitest";
import { unknownColumnOf } from "@/lib/store/data";

/**
 * PostgREST refuse la requête ENTIÈRE dès qu'une colonne lui est inconnue.
 * Une migration pas encore passée faisait donc échouer l'écriture complète d'un
 * créneau ou d'un abonnement : la ligne restait affichée, puis disparaissait au
 * rechargement suivant. On repère la colonne fautive pour réécrire sans elle.
 */
describe("unknownColumnOf", () => {
  it("reconnaît le message PostgREST d'une colonne absente", () => {
    expect(
      unknownColumnOf("Could not find the 'is_free' column of 'sessions' in the schema cache"),
    ).toBe("is_free");
    expect(
      unknownColumnOf(
        "Could not find the 'registration_fee_2' column of 'school' in the schema cache",
      ),
    ).toBe("registration_fee_2");
  });

  it("laisse passer les autres erreurs, qui ne se réparent pas en retirant une colonne", () => {
    expect(unknownColumnOf("new row violates row-level security policy")).toBeNull();
    expect(unknownColumnOf("duplicate key value violates unique constraint")).toBeNull();
    expect(unknownColumnOf("Failed to fetch")).toBeNull();
    expect(unknownColumnOf("")).toBeNull();
  });
});
