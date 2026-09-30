import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * LE MOTEUR DE SYNCHRONISATION, contre un faux Supabase.
 *
 * C'est lui qui a remplacé « relire les 38 tables après chaque clic » : après
 * une écriture, seules les lignes changées reviennent (`sync_changes`). S'il
 * se trompait, l'écran afficherait un solde d'avant le scan, une présence
 * annulée, ou une dette déjà réglée. Ces tests le font tourner de bout en
 * bout : chargement complet, delta, suppressions, repli sans la migration,
 * conservation des objets inchangés, et écritures locales en cours.
 */

type Row = Record<string, unknown>;
type RpcAnswer = { data: unknown; error: { code?: string; message: string } | null };

interface Fake {
  db: Record<string, Row[]>;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  selectCount: number;
  rpc: (name: string, args: Record<string, unknown>) => RpcAnswer;
  /** retient une écriture `update` jusqu'à ce qu'on la libère */
  holdUpdates?: Promise<void>;
}

let fake: Fake;

function makeClient() {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      fake.rpcCalls.push({ name, args });
      return Promise.resolve(fake.rpc(name, args));
    },
    from(table: string) {
      return {
        select() {
          fake.selectCount++;
          return {
            order(column: string) {
              const f: { from?: string; to?: string; after?: string; limit: number } = { limit: Infinity };
              const q = {
                gte(_c: string, v: string) {
                  f.from = v;
                  return q;
                },
                lt(_c: string, v: string) {
                  f.to = v;
                  return q;
                },
                gt(_c: string, v: string) {
                  f.after = v;
                  return q;
                },
                limit(n: number) {
                  f.limit = n;
                  return q;
                },
                then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
                  const rows = (fake.db[table] ?? [])
                    .filter((r) => {
                      const k = String(r[column]);
                      return (
                        (f.from === undefined || k >= f.from) &&
                        (f.to === undefined || k < f.to) &&
                        (f.after === undefined || k > f.after)
                      );
                    })
                    .sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1))
                    .slice(0, f.limit);
                  return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(resolve, reject);
                },
              };
              return q;
            },
          };
        },
        insert(row: Row) {
          (fake.db[table] ??= []).push({ ...row });
          return Promise.resolve({ error: null });
        },
        update(patch: Row) {
          return {
            async eq(col: string, value: string) {
              if (fake.holdUpdates) await fake.holdUpdates;
              for (const r of fake.db[table] ?? []) if (r[col] === value) Object.assign(r, patch);
              return { error: null };
            },
          };
        },
      };
    },
  };
}

vi.mock("@/lib/supabase/client", () => ({ createClient: () => makeClient() }));

/** Un store neuf à chaque test : le moteur garde son curseur au niveau du module. */
async function freshStore() {
  vi.resetModules();
  const mod = await import("@/lib/store/data");
  return mod.useData;
}

const student = (id: string, balance: number): Row => ({
  id,
  first_name: id,
  last_name: "X",
  phone: "",
  email: "",
  rfid: id,
  balance,
  is_free: false,
  registration_due: 0,
  student_subscriptions: [],
});

beforeEach(() => {
  fake = {
    db: {
      students: [student("00000000-0000-0000-0000-00000000000a", 1000)],
      balance_tx: [
        { id: "10000000-0000-0000-0000-000000000001", student_id: "00000000-0000-0000-0000-00000000000a", amount: 1000, date: "2026-09-01T10:00:00Z", type: "topup", description: "v" },
      ],
      attendance: [],
      classes: [{ id: "20000000-0000-0000-0000-000000000001", type: "cours", name: "3eme", description: "" }],
    },
    rpcCalls: [],
    selectCount: 0,
    rpc: (name, args) =>
      name === "sync_changes" && args.p_since === null
        ? { data: { now: "2026-10-01T10:00:00Z", tables: {}, deleted: [] }, error: null }
        : { data: { now: "2026-10-01T10:00:00Z", tables: {}, deleted: [] }, error: null },
  };
});

describe("moteur de synchronisation", () => {
  it("après un chargement complet, une écriture ne relit QUE ce qui a changé", async () => {
    const useData = await freshStore();
    await useData.getState().fetchAll();
    expect(useData.getState().students[0].balance).toBe(1000);
    expect(useData.getState().balanceTx).toHaveLength(1);
    const selectsAfterLoad = fake.selectCount;
    const classesBefore = useData.getState().classes;

    // Le serveur : un scan a débité l'élève, écrit une présence, et une ligne
    // d'historique a été supprimée.
    fake.rpc = (name) => {
      if (name !== "sync_changes") return { data: null, error: { message: "?" } };
      return {
        data: {
          now: "2026-10-01T10:05:00Z",
          tables: {
            students: [student("00000000-0000-0000-0000-00000000000a", 500)],
            attendance: [
              { id: "30000000-0000-0000-0000-000000000001", student_id: "00000000-0000-0000-0000-00000000000a", session_id: "s1", occurred_at: "2026-10-01T10:02:00Z", amount_deducted: 500, status: "present" },
            ],
          },
          deleted: [{ table: "balance_tx", key: "10000000-0000-0000-0000-000000000001" }],
        },
        error: null,
      };
    };

    await useData.getState().refresh();
    // Le delta part de l'heure serveur relevée AVANT le chargement complet.
    expect(fake.rpcCalls.at(-1)?.args.p_since).toBe("2026-10-01T10:00:00Z");
    const s = useData.getState();
    expect(s.students[0].balance).toBe(500);
    expect(s.attendance).toHaveLength(1);
    expect(s.attendance[0].amountDeducted).toBe(500);
    expect(s.balanceTx).toHaveLength(0);
    // Aucune table relue en entier, et les tables inchangées gardent leur objet.
    expect(fake.selectCount).toBe(selectsAfterLoad);
    expect(s.classes).toBe(classesBefore);

    // Le curseur avance : la synchronisation suivante part de la dernière.
    fake.rpc = () => ({ data: { now: "2026-10-01T10:06:00Z", tables: {}, deleted: [] }, error: null });
    const studentsBefore = useData.getState().students;
    await useData.getState().refresh();
    expect(fake.rpcCalls.at(-1)?.args.p_since).toBe("2026-10-01T10:05:00Z");
    // Delta vide : rien n'est remplacé, rien n'est redessiné.
    expect(useData.getState().students).toBe(studentsBefore);
  });

  it("sans la migration, retombe sur la relecture complète — rien ne casse", async () => {
    fake.rpc = () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.sync_changes" } });
    const useData = await freshStore();
    await useData.getState().fetchAll();
    const selectsAfterLoad = fake.selectCount;

    fake.db.students[0].balance = 250;
    await useData.getState().refresh();

    expect(fake.selectCount).toBeGreaterThan(selectsAfterLoad);
    expect(useData.getState().students[0].balance).toBe(250);
  });

  it("une relecture complète identique ne remplace aucun tableau", async () => {
    const useData = await freshStore();
    await useData.getState().fetchAll();
    const before = useData.getState();
    await useData.getState().fetchAll();
    const after = useData.getState();
    expect(after.students).toBe(before.students);
    expect(after.balanceTx).toBe(before.balanceTx);
    expect(after.classes).toBe(before.classes);
  });

  it("une modification en cours d'écriture n'est pas écrasée par une synchronisation", async () => {
    const useData = await freshStore();
    await useData.getState().fetchAll();

    let release!: () => void;
    fake.holdUpdates = new Promise<void>((r) => (release = r));
    const write = useData
      .getState()
      .updateItem("classes", "20000000-0000-0000-0000-000000000001", { name: "Nouveau nom" });
    expect(useData.getState().classes[0].name).toBe("Nouveau nom");

    // Une synchronisation arrive AVANT que l'écriture soit en base : elle porte
    // encore l'ancien nom.
    fake.rpc = () => ({
      data: {
        now: "2026-10-01T10:07:00Z",
        tables: { classes: [{ id: "20000000-0000-0000-0000-000000000001", type: "cours", name: "3eme", description: "" }] },
        deleted: [],
      },
      error: null,
    });
    await useData.getState().refresh();
    expect(useData.getState().classes[0].name).toBe("Nouveau nom");

    release();
    await write;
    expect(fake.db.classes[0].name).toBe("Nouveau nom");
  });

  it("en fond : delta toutes les 30 s, rien si trop rapproché, relecture complète toutes les 30 min", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const useData = await freshStore();
      // Ouverture de session sans copie locale : chargement complet.
      await useData.getState().start("user-1");
      const full = fake.selectCount;
      expect(full).toBeGreaterThan(0);

      // 10 s plus tard : un delta (une requête RPC), aucune table relue.
      vi.setSystemTime(Date.now() + 10_000);
      const rpcBefore = fake.rpcCalls.length;
      await useData.getState().backgroundSync();
      expect(fake.rpcCalls.length).toBe(rpcBefore + 1);
      expect(fake.selectCount).toBe(full);

      // Aussitôt après : rien (moins de 5 s).
      await useData.getState().backgroundSync();
      expect(fake.rpcCalls.length).toBe(rpcBefore + 1);

      // 31 minutes plus tard : le filet de sécurité relit tout.
      vi.setSystemTime(Date.now() + 31 * 60_000);
      await useData.getState().backgroundSync();
      expect(fake.selectCount).toBe(full * 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("une erreur réseau garde le curseur : rien n'est perdu, la suivante rattrape", async () => {
    const useData = await freshStore();
    await useData.getState().fetchAll();
    fake.rpc = () => ({ data: null, error: { message: "Failed to fetch" } });
    await useData.getState().refresh();
    expect(useData.getState().students[0].balance).toBe(1000);

    fake.rpc = () => ({
      data: { now: "2026-10-01T10:08:00Z", tables: { students: [student("00000000-0000-0000-0000-00000000000a", 700)] }, deleted: [] },
      error: null,
    });
    await useData.getState().refresh();
    // Le curseur n'a pas bougé pendant la panne : on repart du même point.
    expect(fake.rpcCalls.at(-1)?.args.p_since).toBe("2026-10-01T10:00:00Z");
    expect(useData.getState().students[0].balance).toBe(700);
  });
});
