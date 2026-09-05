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
    /** variables serveur absentes : `getConfig()` rend alors null */
    noConfig: false,
    send: null as null | (() => Promise<{ messageId: string }>),
  };
});

const MockWhatsAppError = shared.MockWhatsAppError;

function resolveOp(st: Record<string, any>) {
  /** Les lignes que les filtres posés (`eq`, `in`) désignent réellement. */
  const matching = () =>
    shared.rows.filter((r) => {
      for (const [k, v] of Object.entries(st.filters)) if (r[k] !== v) return false;
      for (const [k, vs] of Object.entries(st.ins ?? {})) {
        if (!(vs as unknown[]).includes(r[k])) return false;
      }
      return true;
    });

  if (st.op === "insert") {
    shared.inserts.push(st.rows);
    for (const r of st.rows) shared.rows.push({ ...r, id: `row-${shared.rows.length}`, attempts: 0 });
    return { data: st.rows.map((_: unknown, i: number) => ({ id: `new-${i}` })), error: null };
  }

  if (st.op === "update") {
    shared.updates.push({
      filters: { ...st.filters, ...(st.ins ?? {}), ...(st.lt ? { __lt: st.lt } : {}) },
      patch: st.patch,
    });
    // expireStale : update ... .lt(created_at) — rien de périmé dans ces tests
    if (st.lt) return { data: [], error: null };
    const targets = matching();
    for (const t of targets) Object.assign(t, st.patch);
    return { data: targets.map((t) => ({ id: t.id })), error: null };
  }

  if (st.head) return { count: matching().length, error: null };

  if (st.filters.id) {
    return { data: shared.rows.find((r) => r.id === st.filters.id) ?? null, error: null };
  }

  return { data: matching().slice(0, st.limit ?? 50), error: null };
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
    in(k: string, vs: unknown[]) {
      st.ins = { ...(st.ins ?? {}), [k]: vs };
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
  getConfig: () =>
    shared.noConfig ? null : { instance: "test", baseUrl: "https://x", apiKey: "k" },
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

import {
  approveDrafts,
  discardDrafts,
  draftCount,
  flushOutbox,
  listDrafts,
  pendingCount,
  queueMessages,
  withoutQueuedDuplicates,
} from "@/lib/whatsapp/outbox";

beforeEach(() => {
  shared.rows = [];
  shared.inserts = [];
  shared.updates = [];
  shared.state = "open";
  shared.stateThrows = false;
  shared.noConfig = false;
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

  it("dépose un BROUILLON quand on le lui demande", async () => {
    await queueMessages([{ recipientPhone: "213555111222", body: "Bonjour" }], {
      status: "draft",
    });
    expect(shared.inserts[0][0]).toMatchObject({ status: "draft" });
  });
});

/** LE COMPORTEMENT LE PLUS IMPORTANT DE TOUT CE MODULE.
 *
 *  Les alertes de solde partaient toutes seules au moment du badge : un
 *  message arrivait chez une famille sans que personne à l'école n'ait lu le
 *  texte exact qui lui était écrit. Un badge PROPOSE désormais (un brouillon),
 *  et seul un geste humain approuve.
 *
 *  Si le vidage automatique venait un jour à emporter les brouillons, la
 *  garantie tomberait EN SILENCE — rien à l'écran ne le montrerait, les
 *  messages seraient simplement partis. D'où ces tests. */
describe("brouillons — rien ne part sans approbation", () => {
  it("le vidage automatique IGNORE les brouillons, passerelle ouverte comprise", async () => {
    await queueMessages([{ recipientPhone: "213555111222", body: "Alerte auto" }], {
      status: "draft",
    });
    shared.state = "open";

    const outcome = await flushOutbox();

    expect(outcome.sent).toBe(0);
    // Le brouillon est toujours là, intact, et n'a rien tenté.
    expect(shared.rows[0].status).toBe("draft");
    expect(shared.rows[0].attempts).toBe(0);
  });

  it("compte les deux files séparément", async () => {
    await queueMessages([{ recipientPhone: "213555111222", body: "a" }], { status: "draft" });
    await queueMessages([{ recipientPhone: "213555333444", body: "b" }], { status: "pending" });

    expect(await draftCount()).toBe(1);
    expect(await pendingCount()).toBe(1);
  });

  it("approuver fait basculer le brouillon dans la file d'envoi", async () => {
    await queueMessages([{ recipientPhone: "213555111222", body: "Alerte" }], {
      status: "draft",
    });
    const [draft] = await listDrafts();

    expect(await approveDrafts([draft.id])).toBe(1);
    expect(shared.rows[0].status).toBe("pending");

    // …et c'est SEULEMENT là que le vidage l'emporte.
    const outcome = await flushOutbox();
    expect(outcome.sent).toBe(1);
    expect(shared.rows[0].status).toBe("sent");
  });

  it("approuver deux fois n'envoie pas deux fois", async () => {
    await queueMessages([{ recipientPhone: "213555111222", body: "Alerte" }], {
      status: "draft",
    });
    const [draft] = await listDrafts();

    expect(await approveDrafts([draft.id])).toBe(1);
    // Le filtre « status = draft » rend l'appel idempotent : un double clic ne
    // ressuscite pas un message déjà parti.
    expect(await approveDrafts([draft.id])).toBe(0);
  });

  it("écarter marque le message abandonné, sans jamais l'effacer", async () => {
    await queueMessages([{ recipientPhone: "213555111222", body: "Alerte" }], {
      status: "draft",
    });
    const [draft] = await listDrafts();

    expect(await discardDrafts([draft.id])).toBe(1);
    expect(shared.rows[0].status).toBe("abandoned");
    // La ligne reste : on doit toujours pouvoir dire ce qui n'est pas parti.
    expect(shared.rows).toHaveLength(1);
    expect(shared.rows[0].abandoned_reason).toBeTruthy();

    // Un message écarté ne se rattrape pas par une approbation tardive.
    expect(await approveDrafts([draft.id])).toBe(0);
    expect((await flushOutbox()).sent).toBe(0);
  });

  it("ne redépose pas le même texte pour le même numéro", async () => {
    // Un élève qui badge trois cours dans la journée ne doit pas remplir le
    // tableau de bord de trois fois la même phrase.
    await queueMessages([{ recipientPhone: "213555111222", body: "Solde faible" }], {
      status: "draft",
    });

    const fresh = await withoutQueuedDuplicates([
      { recipientPhone: "213555111222", body: "Solde faible" },
      { recipientPhone: "213555111222", body: "Autre message" },
      { recipientPhone: "213555999888", body: "Solde faible" },
    ]);

    expect(fresh).toHaveLength(2);
    expect(fresh.map((e) => e.body)).toEqual(["Autre message", "Solde faible"]);
  });

  it("écarte aussi les doublons À L'INTÉRIEUR du même lot", async () => {
    const fresh = await withoutQueuedDuplicates([
      { recipientPhone: "213555111222", body: "Solde faible" },
      { recipientPhone: "213555111222", body: "Solde faible" },
    ]);
    expect(fresh).toHaveLength(1);
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
    // LA DISTINCTION QUI MANQUAIT : la passerelle a RÉPONDU « close ». Elle va
    // très bien, c'est le téléphone qui s'est délié. Annoncer « injoignable,
    // ça repartira à son retour » laissait la file grossir pendant des jours
    // en attendant un retour qui avait déjà eu lieu.
    expect(outcome.reason).toBe("disconnected");
    // Le message est INTACT : ni tentative consommée, ni abandon.
    expect(shared.rows[0].status).toBe("pending");
    expect(shared.rows[0].attempts).toBe(0);
  });

  it("signale « offline » quand la passerelle ne répond pas du tout", async () => {
    await queueMessages([{ recipientPhone: "213555111222", body: "Bonjour" }]);
    shared.stateThrows = true;

    const outcome = await flushOutbox();

    expect(outcome.offline).toBe(true);
    // Là, et là seulement, « ça repartira à son retour » est vrai.
    expect(outcome.reason).toBe("unreachable");
    expect(shared.rows[0].status).toBe("pending");
  });

  it("distingue une passerelle absente des variables serveur", async () => {
    await queueMessages([{ recipientPhone: "213555111222", body: "Bonjour" }]);
    shared.noConfig = true;

    const outcome = await flushOutbox();

    // Rien ne partira JAMAIS tout seul : il faut renseigner les variables.
    // Conseiller d'attendre serait un conseil sans fin.
    expect(outcome.reason).toBe("unconfigured");
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
    // Un vidage qui aboutit n'a rien à expliquer.
    expect(outcome.reason).toBeUndefined();
    expect(shared.rows[0].status).toBe("sent");
  });

  it("ne consomme AUCUNE tentative si la passerelle retombe en cours de vidage", async () => {
    await queueMessages([{ recipientPhone: "213555111222", body: "Bonjour" }]);
    shared.send = async () => {
      throw new MockWhatsAppError("passerelle injoignable", 503);
    };

    const outcome = await flushOutbox();

    expect(outcome.offline).toBe(true);
    expect(outcome.reason).toBe("unreachable");
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
