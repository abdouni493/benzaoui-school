import { describe, expect, it } from "vitest";
import { fetchWholeTable, type PagedSource } from "@/lib/store/data";

/**
 * LA PANNE QUE CES TESTS INTERDISENT DE REVIVRE
 * ---------------------------------------------
 * PostgREST plafonne toute réponse à `db-max-rows` (1000 chez Supabase) et ne
 * le signale PAS : la requête réussit, `error` est nul, il manque simplement
 * des lignes. Le jour où `balance_tx` a dépassé 1000 lignes, l'application a
 * commencé à travailler sur un historique amputé de ses lignes les plus
 * récentes — et à annoncer des dettes de plusieurs centaines de dinars à des
 * élèves parfaitement à jour, parce qu'elle voyait leurs débits sans leurs
 * recettes.
 *
 * Une lecture partielle qui se fait passer pour complète est donc pire qu'une
 * lecture en échec : c'est ce que vérifient ces tests.
 */

/** Une table factice de `total` lignes, qui applique le plafond de PostgREST
 *  exactement comme le vrai : silencieusement. */
function fakeSource(opts: {
  total: number;
  maxRows?: number;
  failAtOffset?: number;
}): PagedSource & { calls: [number, number][] } {
  const calls: [number, number][] = [];
  return {
    calls,
    from() {
      return {
        select() {
          return {
            order() {
              return {
                range(from: number, to: number) {
                  calls.push([from, to]);
                  if (opts.failAtOffset === from) {
                    return Promise.resolve({ data: null, error: { message: "boom" } });
                  }
                  const cap = Math.min(to - from + 1, opts.maxRows ?? Infinity);
                  const rows = [];
                  for (let i = from; i < Math.min(from + cap, opts.total); i++) {
                    rows.push({ id: `row-${i}` });
                  }
                  return Promise.resolve({ data: rows, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
}

const cfg = { table: "balance_tx", select: "*" };

describe("fetchWholeTable", () => {
  it("rend TOUTES les lignes d'une table qui dépasse le plafond de PostgREST", async () => {
    // 1117 lignes : le cas réel qui a déclenché la panne.
    const src = fakeSource({ total: 1117, maxRows: 1000 });
    const out = await fetchWholeTable(src, cfg);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows).toHaveLength(1117);
    // Aucune ligne perdue, aucune en double.
    expect(new Set(out.rows.map((r) => r.id)).size).toBe(1117);
  });

  it("lit une petite table en une seule requête", async () => {
    const src = fakeSource({ total: 12 });
    const out = await fetchWholeTable(src, cfg);

    expect(out.ok).toBe(true);
    expect(src.calls).toHaveLength(1);
  });

  it("s'arrête dès qu'une page revient incomplète", async () => {
    const src = fakeSource({ total: 501 });
    const out = await fetchWholeTable(src, cfg);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows).toHaveLength(501);
    // Une page pleine, une page d'une ligne : pas de troisième requête inutile.
    expect(src.calls).toHaveLength(2);
  });

  it("demande des pages qui se suivent, sans trou ni recouvrement", async () => {
    const src = fakeSource({ total: 1200 });
    await fetchWholeTable(src, cfg);

    for (let i = 1; i < src.calls.length; i++) {
      expect(src.calls[i][0]).toBe(src.calls[i - 1][1] + 1);
    }
  });

  it("ÉCHOUE plutôt que de rendre une demi-table", async () => {
    // C'est tout l'enjeu : une lecture partielle passée pour complète est ce
    // qui faisait inventer des dettes. L'appelant garde alors ses lignes
    // précédentes et n'affiche aucun recoupement.
    const src = fakeSource({ total: 1200, failAtOffset: 500 });
    const out = await fetchWholeTable(src, cfg);

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("boom");
  });

  it("rend une table vide sans erreur", async () => {
    const out = await fetchWholeTable(fakeSource({ total: 0 }), cfg);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows).toEqual([]);
  });
});
