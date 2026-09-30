import { describe, expect, it } from "vitest";
import {
  applyRowDelta,
  reconcileRows,
  sameValue,
  uuidPartitions,
} from "@/lib/store/merge";

/**
 * La fusion est ce qui rend la synchronisation BON MARCHÉ côté écran : une
 * ligne inchangée garde son objet, une table inchangée garde son tableau, et
 * React n'a rien à recalculer. Si elle rendait des objets neufs à chaque fois,
 * chaque synchronisation redessinerait toute l'application — c'était la
 * lenteur d'avant.
 */

type Row = { id: string; name: string; tags?: string[]; meta?: Record<string, unknown> };
const key = (r: Row) => r.id;

describe("sameValue", () => {
  it("ignore l'ordre des clés et les champs undefined", () => {
    expect(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameValue({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });

  it("voit les différences profondes", () => {
    expect(sameValue({ a: { b: [1, 2] } }, { a: { b: [1, 3] } })).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: 0 })).toBe(false);
    expect(sameValue([1, 2], [1, 2, 3])).toBe(false);
    expect(sameValue(null, {})).toBe(false);
  });
});

describe("reconcileRows", () => {
  it("garde le MÊME tableau quand rien n'a changé", () => {
    const prev: Row[] = [{ id: "1", name: "a" }, { id: "2", name: "b" }];
    const next: Row[] = [{ id: "1", name: "a" }, { id: "2", name: "b" }];
    expect(reconcileRows(prev, next, key)).toBe(prev);
  });

  it("garde les objets inchangés, remplace seulement la ligne modifiée", () => {
    const prev: Row[] = [{ id: "1", name: "a" }, { id: "2", name: "b" }];
    const next: Row[] = [{ id: "1", name: "a" }, { id: "2", name: "B" }];
    const out = reconcileRows(prev, next, key);
    expect(out).not.toBe(prev);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).toEqual({ id: "2", name: "B" });
  });

  it("retire une ligne disparue et dédoublonne une ligne lue deux fois", () => {
    const prev: Row[] = [{ id: "1", name: "a" }, { id: "2", name: "b" }];
    const next: Row[] = [{ id: "1", name: "a" }, { id: "1", name: "a" }];
    const out = reconcileRows(prev, next, key);
    expect(out).toEqual([{ id: "1", name: "a" }]);
  });

  it("ne fait pas disparaître une ligne dont l'écriture n'est pas finie", () => {
    const prev: Row[] = [{ id: "1", name: "a" }, { id: "new", name: "tout juste ajoutée" }];
    const next: Row[] = [{ id: "1", name: "a" }];
    const out = reconcileRows(prev, next, key, (k) => k === "new");
    expect(out.map((r) => r.id)).toEqual(["1", "new"]);
  });

  it("garde la version locale d'une ligne en cours d'écriture", () => {
    const prev: Row[] = [{ id: "1", name: "modifiée à l'écran" }];
    const next: Row[] = [{ id: "1", name: "ancienne version serveur" }];
    const out = reconcileRows(prev, next, key, () => true);
    expect(out[0].name).toBe("modifiée à l'écran");
  });
});

describe("applyRowDelta", () => {
  it("ne touche à rien sur un delta vide", () => {
    const prev: Row[] = [{ id: "1", name: "a" }];
    expect(applyRowDelta(prev, [], new Set(), key)).toBe(prev);
  });

  it("garde le tableau quand le delta ne fait que répéter l'existant", () => {
    const prev: Row[] = [{ id: "1", name: "a", tags: ["x"] }];
    expect(applyRowDelta(prev, [{ id: "1", name: "a", tags: ["x"] }], new Set(), key)).toBe(prev);
  });

  it("modifie sur place, ajoute à la fin, retire les supprimées", () => {
    const prev: Row[] = [{ id: "1", name: "a" }, { id: "2", name: "b" }, { id: "3", name: "c" }];
    const out = applyRowDelta(
      prev,
      [{ id: "2", name: "B" }, { id: "4", name: "d" }],
      new Set(["3"]),
      key,
    );
    expect(out.map((r) => `${r.id}:${r.name}`)).toEqual(["1:a", "2:B", "4:d"]);
    expect(out[0]).toBe(prev[0]);
  });

  it("une ligne à la fois supprimée ET rendue existe (recréée dans l'intervalle)", () => {
    const prev: Row[] = [{ id: "1", name: "a" }];
    const out = applyRowDelta(prev, [{ id: "1", name: "a2" }], new Set(["1"]), key);
    expect(out).toEqual([{ id: "1", name: "a2" }]);
  });

  it("n'écrase pas une ligne en cours d'écriture, ne la supprime pas non plus", () => {
    const prev: Row[] = [{ id: "1", name: "locale" }, { id: "2", name: "b" }];
    const out = applyRowDelta(
      prev,
      [{ id: "1", name: "serveur" }],
      new Set(["2"]),
      key,
      (k) => k === "1" || k === "2",
    );
    expect(out).toBe(prev);
  });
});

describe("uuidPartitions", () => {
  it("couvre tout l'espace, sans trou ni recouvrement", () => {
    for (const n of [1, 2, 3, 4, 8, 16, 40]) {
      const parts = uuidPartitions(n);
      expect(parts[0].from).toBeUndefined();
      expect(parts[parts.length - 1].to).toBeUndefined();
      for (let i = 1; i < parts.length; i++) {
        expect(parts[i].from).toBe(parts[i - 1].to);
      }
    }
  });

  it("ramène le nombre de tranches à une puissance de 2, 16 au plus", () => {
    expect(uuidPartitions(3)).toHaveLength(2);
    expect(uuidPartitions(8)).toHaveLength(8);
    expect(uuidPartitions(100)).toHaveLength(16);
    expect(uuidPartitions(0)).toHaveLength(1);
  });
});
