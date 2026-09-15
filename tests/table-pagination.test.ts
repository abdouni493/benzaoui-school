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
  /** La table n'a QUE ces colonnes : trier sur une autre la fait répondre 400,
   *  exactement comme PostgREST le fait pour `student_credentials.id`. */
  columns?: string[];
}): PagedSource & { calls: [number, number][]; orderedBy: string[] } {
  const calls: [number, number][] = [];
  const orderedBy: string[] = [];
  return {
    calls,
    orderedBy,
    from() {
      return {
        select() {
          return {
            order(column: string) {
              orderedBy.push(column);
              const unknownColumn = opts.columns && !opts.columns.includes(column);
              return {
                range(from: number, to: number) {
                  calls.push([from, to]);
                  if (unknownColumn) {
                    return Promise.resolve({
                      data: null,
                      error: { message: `column ${column} does not exist` },
                    });
                  }
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

  /**
   * LA PANNE QUE CES TROIS TESTS INTERDISENT DE REVIVRE
   * ---------------------------------------------------
   * Toutes les tables ne s'appellent pas `id`. `student_credentials` a pour
   * clé primaire `student_id`, `module_absence_rules` a `module_id`. Trier
   * leur pagination sur `id` faisait répondre 400 à PostgREST (« column
   * student_credentials.id does not exist »), donc échouer la lecture de la
   * table entière — et l'écran restait vide sans jamais se réparer.
   */
  it("trie sur `id` par défaut", async () => {
    const src = fakeSource({ total: 3 });
    await fetchWholeTable(src, cfg);
    expect(src.orderedBy).toEqual(["id"]);
  });

  it("trie sur la clé primaire déclarée quand la table n'a pas d'`id`", async () => {
    const src = fakeSource({ total: 3, columns: ["student_id", "password"] });
    const out = await fetchWholeTable(src, {
      table: "student_credentials",
      select: "*",
      orderBy: "student_id",
    });

    expect(src.orderedBy).toEqual(["student_id"]);
    expect(out.ok).toBe(true);
  });

  it("ÉCHOUE si on la trie sur une colonne que la table n'a pas", async () => {
    const src = fakeSource({ total: 3, columns: ["module_id", "enabled"] });
    const out = await fetchWholeTable(src, { table: "module_absence_rules", select: "*" });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("does not exist");
  });

  it("rend une table vide sans erreur", async () => {
    const out = await fetchWholeTable(fakeSource({ total: 0 }), cfg);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows).toEqual([]);
  });
});
