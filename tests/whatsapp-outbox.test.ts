import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** File d'attente WhatsApp.
 *
 *  Le comportement le plus subtil — et le seul qui puisse ruiner la
 *  fonctionnalité en silence — est la règle de comptage des tentatives : une
 *  passerelle injoignable ne doit JAMAIS consommer de tentative. Sans cela, un
 *  week-end hors ligne suffirait à épuiser le compteur de toute la file et à
 *  abandonner des messages parfaitement valides. */

// La classe d'erreur vit DANS le bloc hoisté : les fabriques `vi.mock` sont
// remontées en tête de fichier, et une classe déclarée au niveau du module y
// serait encore dans sa zone morte temporelle.
const shared = vi.hoisted(() => {
  class MockWhatsAppError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  }
  return {
    MockWhatsAppError,
    rows: [] as Record<string, unknown>[],
    inserts: [] as Record<string, unknown>[][],
    updates: [] as { filters: Record<string, unknown>; patch: Record<string, unknown> }[],
    state: "open" as string,
    stateThrows: false,
    send: null as null | (() => Promise<{ messageId: string }>),
  };
});

const MockWhatsAppError = shared.MockWhatsAppError;

function resolveOp(st: Record<string, any>) {
  const pending = () => shared.rows.filter((r) => r.status === "pending");

  if (st.op === "insert") {
    shared.inserts.push(st.rows);
    for (const r of st.rows) shared.rows.push({ ...r, id: `row-${shared.rows.length}`, attempts: 0 });
    return { data: st.rows.map((_: unknown, i: number) => ({ id: `new-${i}` })), error: null };
  }

  if (st.op === "update") {
    shared.updates.push({ filters: { ...st.filters, ...(st.lt ? { __lt: st.lt } : {}) }, patch: st.patch });
    // expireStale : update ... .lt(created_at) — rien de périmé dans ces tests
    if (st.lt) return { data: [], error: null };
    const target = shared.rows.find((r) => r.id === st.filters.id);
    if (target) Object.assign(target, st.patch);
    return { data: [], error: null };
  }

  if (st.head) return { count: pending().length, error: null };

  if (st.filters.id) {
    return { data: shared.rows.find((r) => r.id === st.filters.id) ?? null, error: null };
  }

  return { data: pending().slice(0, st.limit ?? 50), error: null };
}

function makeBuilder() {
  const st: Record<string, any> = { op: null, filters: {} };
  const b: Record<string, any> = {
    insert(rows: Record<string, unknown>[]) {
      st.op = "insert";
      st.rows = rows;
      return b;
    },
    update(patch: Record<string, unknown>) {
      st.op = "update";
      st.patch = patch;
      return b;
    },
    select(_cols?: unknown, opts?: { head?: boolean }) {
      if (!st.op) st.op = "select";
      st.head = Boolean(opts?.head);
      return b;
    },
    eq(k: string, v: unknown) {
      st.filters[k] = v;
      return b;
    },
    lt(k: string, v: unknown) {
      st.lt = [k, v];
      return b;
    },
    order() {
      return b;
    },
    limit(n: number) {
      st.limit = n;
      return b;
    },
    maybeSingle: async () => resolveOp(st),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(resolveOp(st)).then(res, rej),
  };
  return b;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => makeBuilder() }),
}));

vi.mock("@/lib/whatsapp/log", () => ({ logOutgoingMessage: vi.fn(async () => {}) }));

vi.mock("@/lib/whatsapp/client", () => ({
  WhatsAppError: shared.MockWhatsAppError,
  getConfig: () => ({ instance: "test", baseUrl: "https://x", apiKey: "k" }),
  getConnectionState: async () => {
    if (shared.stateThrows) throw new Error("passerelle injoignable");
    return { state: shared.state };
  },
  sendTextMessage: async () => {
    if (!shared.send) return { messageId: "mid-1" };
    return shared.send();
  },
}));

// Pas d'attente réelle entre destinataires : la cadence est testée ailleurs,
// et 3 à 7 secondes par message rendrait cette suite inutilisable.
vi.mock("@/lib/whatsapp/pacing", () => ({
  GAP_MIN_MS: 0,
  GAP_MAX_MS: 0,
  TYPING_DELAY_MS: 0,
  sleep: async () => {},
  randomGap: () => 0,
}));

import { flushOutbox, pendingCount, queueMessages } from "@/lib/whatsapp/outbox";

beforeEach(() => {
  shared.rows = [];
  shared.inserts = [];
  shared.updates = [];
  shared.state = "open";
  shared.stateThrows = false;
  shared.send = null;
});

describe("queueMessages", () => {
  it("enregistre les messages en attente plutôt que de les perdre", async () => {
    const n = await queueMessages([
      { recipientPhone: "213555111222", body: "Bonjour" },
      { recipientPhone: "213555333444", body: "Rappel" },
    ]);

    expect(n).toBe(2);
    expect(shared.inserts[0]).toHaveLength(2);
    expect(shared.inserts[0][0]).toMatchObject({
      recipient_phone: "213555111222",
      body: "Bonjour",
      status: "pending",
    });
  });

  it("ne fait rien, sans erreur, sur une liste vide", async () => {
    expect(await queueMessages([])).toBe(0);
    expect(shared.inserts).toHaveLength(0);
  });
});

describe("flushOutbox — passerelle injoignable", () => {
  it("signale « offline » sans rien tenter quand la session n'est pas ouverte", async () => {
    await queueMessages([{ recipientPhone: "213555111222", body: "Bonjour" }]);
    shared.state = "close";

    const outcome = await flushOutbox();

    expect(outcome.offline).toBe(true);
    expect(outcome.sent).toBe(0);
    expect(outcome.remaining).toBe(1);
    // Le message est INTACT : ni tentative consommée, ni abandon.
    expect(shared.rows[0].status).toBe("pending");
    expect(shared.rows[0].attempts).toBe(0);
  });

  it("signale « offline » quand la passerelle ne répond pas du tout", async () => {
    await queueMessages([{ recipientPhone: "213555111222", body: "Bonjour" }]);
    shared.stateThrows = true;

    const outcome = await flushOutbox();

    expect(outcome.offline).toBe(true);
    expect(shared.rows[0].status).toBe("pending");
  });
});

describe("flushOutbox — envoi", () => {
  it("envoie les messages en attente et les marque « sent »", async () => {
    await queueMessages([{ recipientPhone: "213555111222", body: "Bonjour" }]);

    const outcome = await flushOutbox();

    expect(outcome.sent).toBe(1);
    expect(outcome.offline).toBe(false);
    expect(shared.rows[0].status).toBe("sent");
  });

  it("ne consomme AUCUNE tentative si la passerelle retombe en cours de vidage", async () => {
    await queueMessages([{ recipientPhone: "213555111222", body: "Bonjour" }]);
    shared.send = async () => {
      throw new MockWhatsAppError("passerelle injoignable", 503);
    };

    const outcome = await flushOutbox();

    expect(outcome.offline).toBe(true);
    expect(outcome.sent).toBe(0);
    // LE POINT CRITIQUE : le message reste intact et repartira. Compter une
    // tentative ici ferait abandonner des messages valides après trois
    // coupures — un long week-end suffirait.
    expect(shared.rows[0].status).toBe("pending");
    expect(shared.rows[0].attempts ?? 0).toBe(0);
  });

  it("compte une tentative sur un échec propre au destinataire", async () => {
    await queueMessages([{ recipientPhone: "213555111222", body: "Bonjour" }]);
    shared.send = async () => {
      throw new Error("Aucun compte WhatsApp sur ce numéro");
    };

    const outcome = await flushOutbox();

    expect(outcome.failed).toBe(1);
    expect(outcome.offline).toBe(false);
    expect(shared.rows[0].attempts).toBe(1);
    expect(shared.rows[0].status).toBe("pending"); // encore deux essais
  });

  it("abandonne au bout de trois tentatives, sans réessayer indéfiniment", async () => {
    await queueMessages([{ recipientPhone: "213555111222", body: "Bonjour" }]);
    shared.rows[0].attempts = 2; // deux échecs déjà encaissés
    shared.send = async () => {
      throw new Error("Aucun compte WhatsApp sur ce numéro");
    };

    await flushOutbox();

    expect(shared.rows[0].status).toBe("abandoned");
    expect(String(shared.rows[0].abandoned_reason)).toContain("3 tentatives");
  });
});

describe("pendingCount", () => {
  it("ne compte que les messages encore en attente", async () => {
    await queueMessages([
      { recipientPhone: "213555111222", body: "A" },
      { recipientPhone: "213555333444", body: "B" },
    ]);
    shared.rows[0].status = "sent";

    expect(await pendingCount()).toBe(1);
  });
});
