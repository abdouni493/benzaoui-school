import { describe, expect, it } from "vitest";
import { fetchWholeTable, type PagedSource, type PageQuery } from "@/lib/store/data";

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
 *
 * La lecture se fait PAR CLÉ (la page suivante commence après la dernière clé
 * reçue) et, sur une grosse table, par tranches d'UUID lues en parallèle.
 */

/** Un UUID factice bien réparti sur tout l'espace (le premier chiffre
 *  hexadécimal varie), comme les vrais `gen_random_uuid()`. */
function fakeUuid(i: number): string {
  const head = ((i * 2654435761) >>> 0).toString(16).padStart(8, "0");
  const tail = i.toString(16).padStart(12, "0");
  return `${head}-0000-4000-8000-${tail}`;
}

interface Call {
  after?: string;
  from?: string;
  to?: string;
  limit?: number;
}

/** Une table factice de `total` lignes, qui applique le plafond de PostgREST
 *  exactement comme le vrai : silencieusement. */
function fakeSource(opts: {
  total: number;
  maxRows?: number;
  /** la N-ième requête (0-based) échoue */
  failAtCall?: number;
  /** La table n'a QUE ces colonnes : trier sur une autre la fait répondre 400,
   *  exactement comme PostgREST le fait pour `student_credentials.id`. */
  columns?: string[];
  keyColumn?: string;
}): PagedSource & { calls: Call[]; orderedBy: string[] } {
  const calls: Call[] = [];
  const orderedBy: string[] = [];
  const keyColumn = opts.keyColumn ?? "id";
  const all = Array.from({ length: opts.total }, (_, i) => ({ [keyColumn]: fakeUuid(i) })).sort((a, b) =>
    a[keyColumn] < b[keyColumn] ? -1 : 1,
  );

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
              const call: Call = {};
              const query: PageQuery = {
                gt(_c, v) {
                  call.after = v;
                  return query;
                },
                gte(_c, v) {
                  call.from = v;
                  return query;
                },
                lt(_c, v) {
                  call.to = v;
                  return query;
                },
                limit(n) {
                  call.limit = n;
                  return query;
                },
                then(resolve, reject) {
                  const index = calls.length;
                  calls.push(call);
                  let result: { data: unknown[] | null; error: { message: string } | null };
                  if (unknownColumn) {
                    result = { data: null, error: { message: `column ${column} does not exist` } };
                  } else if (opts.failAtCall === index) {
                    result = { data: null, error: { message: "boom" } };
                  } else {
                    const rows = all.filter(
                      (r) =>
                        (call.from === undefined || r[keyColumn] >= call.from) &&
                        (call.to === undefined || r[keyColumn] < call.to) &&
                        (call.after === undefined || r[keyColumn] > call.after),
                    );
                    const cap = Math.min(call.limit ?? Infinity, opts.maxRows ?? Infinity);
                    result = { data: rows.slice(0, cap), error: null };
                  }
                  return Promise.resolve(result).then(resolve, reject);
                },
              };
              return query;
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

  it("enchaîne les pages par clé : chacune commence après la dernière clé reçue", async () => {
    const src = fakeSource({ total: 1200 });
    const out = await fetchWholeTable(src, cfg);
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    expect(src.calls[0].after).toBeUndefined();
    expect(src.calls[1].after).toBe(out.rows[499].id);
    expect(src.calls[2].after).toBe(out.rows[999].id);
    // Et la table sort triée par clé.
    const ids = out.rows.map((r) => String(r.id));
    expect([...ids].sort()).toEqual(ids);
  });

  it("lit une grosse table par tranches parallèles, sans trou ni doublon", async () => {
    const src = fakeSource({ total: 3000 });
    const out = await fetchWholeTable(src, cfg, { sizeHint: 3000 });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows).toHaveLength(3000);
    expect(new Set(out.rows.map((r) => r.id)).size).toBe(3000);
    // Plusieurs tranches ont bien été demandées…
    const firstCalls = src.calls.filter((c) => c.after === undefined);
    expect(firstCalls.length).toBeGreaterThan(1);
    // …et la table sort toujours triée par clé.
    const ids = out.rows.map((r) => String(r.id));
    expect([...ids].sort()).toEqual(ids);
  });

  it("ne rate aucune ligne quand l'estimation est fausse (table plus grosse que prévu)", async () => {
    const src = fakeSource({ total: 4321 });
    const out = await fetchWholeTable(src, cfg, { sizeHint: 1200 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(new Set(out.rows.map((r) => r.id)).size).toBe(4321);
  });

  it("ÉCHOUE plutôt que de rendre une demi-table", async () => {
    // C'est tout l'enjeu : une lecture partielle passée pour complète est ce
    // qui faisait inventer des dettes. L'appelant garde alors ses lignes
    // précédentes et n'affiche aucun recoupement.
    const src = fakeSource({ total: 1200, failAtCall: 1 });
    const out = await fetchWholeTable(src, cfg);

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("boom");
  });

  it("ÉCHOUE aussi quand une seule tranche parallèle échoue", async () => {
    const src = fakeSource({ total: 3000, failAtCall: 2 });
    const out = await fetchWholeTable(src, cfg, { sizeHint: 3000 });
    expect(out.ok).toBe(false);
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
    const src = fakeSource({ total: 3, columns: ["student_id", "password"], keyColumn: "student_id" });
    const out = await fetchWholeTable(src, {
      table: "student_credentials",
      select: "*",
      orderBy: "student_id",
    });

    expect(src.orderedBy).toEqual(["student_id"]);
    expect(out.ok).toBe(true);
  });

  it("pagine par la clé déclarée au-delà d'une page", async () => {
    const src = fakeSource({ total: 700, keyColumn: "student_id" });
    const out = await fetchWholeTable(src, {
      table: "student_credentials",
      select: "*",
      orderBy: "student_id",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(new Set(out.rows.map((r) => r.student_id)).size).toBe(700);
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
