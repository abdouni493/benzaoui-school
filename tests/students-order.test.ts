import { describe, it, expect } from "vitest";

import { byNewestFirst, createdAtMs } from "@/lib/helpers";

/** Une fiche réduite à ce que le tri regarde. */
const at = (id: string, createdAt?: string) => ({ id, createdAt });

const order = (rows: Array<{ id: string; createdAt?: string }>) =>
  [...rows].sort(byNewestFirst).map((r) => r.id);

describe("createdAtMs", () => {
  it("lit l'horodatage ISO rendu par Postgres", () => {
    // PostgREST sérialise un timestamptz avec le décalage explicite ; le client
    // écrit un « Z ». Les deux doivent donner le même instant.
    expect(createdAtMs({ createdAt: "2026-08-21T02:40:11.000+00:00" })).toBe(
      createdAtMs({ createdAt: "2026-08-21T02:40:11.000Z" }),
    );
  });

  it("traite une date absente ou illisible comme la plus récente", () => {
    expect(createdAtMs({})).toBe(Number.POSITIVE_INFINITY);
    expect(createdAtMs({ createdAt: "" })).toBe(Number.POSITIVE_INFINITY);
    expect(createdAtMs({ createdAt: "pas une date" })).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("byNewestFirst", () => {
  it("range du plus récemment inscrit au plus ancien", () => {
    expect(
      order([
        at("ancien", "2024-01-05T08:00:00Z"),
        at("recent", "2026-08-21T09:30:00Z"),
        at("milieu", "2025-06-10T12:00:00Z"),
      ]),
    ).toEqual(["recent", "milieu", "ancien"]);
  });

  it("met en tête la fiche que la base n'a pas encore relue", () => {
    // `push` ajoute la nouvelle fiche EN FIN de tableau : sans ce tri elle
    // sortait dernière, hors de l'écran.
    expect(
      order([
        at("a", "2026-01-01T00:00:00Z"),
        at("b", "2026-05-01T00:00:00Z"),
        at("toute-neuve"),
      ]),
    ).toEqual(["toute-neuve", "b", "a"]);
  });

  it("ne casse pas quand aucune fiche n'a de date (base sans created_at)", () => {
    // Infinity - Infinity vaudrait NaN : le comparateur doit rendre 0 et
    // laisser l'ordre d'origine, pas produire un classement arbitraire.
    const rows = [at("a"), at("b"), at("c")];
    expect(order(rows)).toEqual(["a", "b", "c"]);
    expect(byNewestFirst(at("a"), at("b"))).toBe(0);
  });

  it("rend 0 sur deux dates identiques", () => {
    const same = "2026-03-03T10:00:00Z";
    expect(byNewestFirst(at("a", same), at("b", same))).toBe(0);
  });

  it("ne touche pas au tableau d'origine", () => {
    const rows = [at("a", "2024-01-01T00:00:00Z"), at("b", "2026-01-01T00:00:00Z")];
    order(rows);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
