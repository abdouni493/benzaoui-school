import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

// Le webhook ne doit jamais toucher Supabase en test : on remplace la couche
// de journalisation par des espions. `vi.hoisted` les rend disponibles dans la
// fabrique de `vi.mock`, elle-même hissée en tête de fichier.
const { updateMessageStatus, recordInboundMessage } = vi.hoisted(() => ({
  updateMessageStatus: vi.fn(async () => {}),
  recordInboundMessage: vi.fn(async () => {}),
}));
vi.mock("@/lib/whatsapp/log", () => ({ updateMessageStatus, recordInboundMessage }));

import { GET, POST } from "@/app/api/whatsapp/webhook/route";

const BASE_URL = "https://wa.exemple.dz";
const TOKEN = "webhook-token-123";

/** Construit une requête webhook. `token: null` = en-tête absent. */
function post(body: unknown, token: string | null = TOKEN): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request("https://school.test/api/whatsapp/webhook", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers,
  });
}

/** Enveloppe commune des événements Evolution. */
function event(name: string, data: unknown, serverUrl: string = BASE_URL) {
  return { event: name, instance: "benzaoui", server_url: serverUrl, data };
}

beforeEach(() => {
  vi.stubEnv("EVOLUTION_BASE_URL", BASE_URL);
  vi.stubEnv("EVOLUTION_WEBHOOK_TOKEN", TOKEN);
  updateMessageStatus.mockClear();
  recordInboundMessage.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET — Evolution ne fait aucun handshake", () => {
  it("répond 405", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
  });
});

describe("POST — authentification par jeton", () => {
  it("accepte le bon jeton", async () => {
    const res = await POST(post(event("MESSAGES_UPDATE", [])));
    expect(res.status).toBe(200);
  });

  it("refuse (401) un mauvais jeton", async () => {
    const res = await POST(post(event("MESSAGES_UPDATE", []), "MAUVAIS"));
    expect(res.status).toBe(401);
    expect(updateMessageStatus).not.toHaveBeenCalled();
  });

  it("refuse (401) un en-tête absent", async () => {
    const res = await POST(post(event("MESSAGES_UPDATE", []), null));
    expect(res.status).toBe(401);
    expect(updateMessageStatus).not.toHaveBeenCalled();
  });

  it("refuse (401) quand le jeton n'est pas configuré côté serveur", async () => {
    vi.stubEnv("EVOLUTION_WEBHOOK_TOKEN", "");
    const res = await POST(post(event("MESSAGES_UPDATE", [])));
    expect(res.status).toBe(401);
  });

  it("refuse (403) un server_url étranger", async () => {
    const res = await POST(
      post(event("MESSAGES_UPDATE", [{ keyId: "X", status: "READ" }], "https://attaquant.example")),
    );
    expect(res.status).toBe(403);
    expect(updateMessageStatus).not.toHaveBeenCalled();
  });

  it("acquitte un corps JSON invalide sans rien traiter", async () => {
    const res = await POST(post("pas du json"));
    expect(res.status).toBe(200);
    expect(updateMessageStatus).not.toHaveBeenCalled();
  });
});

describe("POST — MESSAGES_UPDATE (statuts)", () => {
  const cases: Array<[string, string]> = [
    ["SERVER_ACK", "sent"],
    ["DELIVERY_ACK", "delivered"],
    ["READ", "read"],
    ["ERROR", "failed"],
  ];

  for (const [raw, expected] of cases) {
    it(`${raw} → ${expected}`, async () => {
      const res = await POST(post(event("MESSAGES_UPDATE", [{ keyId: "BAE51", status: raw }])));
      expect(res.status).toBe(200);
      expect(updateMessageStatus).toHaveBeenCalledTimes(1);
      expect(updateMessageStatus.mock.calls[0][0]).toBe("BAE51");
      expect(updateMessageStatus.mock.calls[0][1]).toBe(expected);
    });
  }

  it("un statut inconnu est ignoré sans erreur", async () => {
    const res = await POST(post(event("MESSAGES_UPDATE", [{ keyId: "BAE51", status: "BOGUS" }])));
    expect(res.status).toBe(200);
    expect(updateMessageStatus).not.toHaveBeenCalled();
  });

  it("lit l'identifiant depuis key.id quand keyId est absent", async () => {
    await POST(post(event("MESSAGES_UPDATE", [{ key: { id: "BAE52" }, status: "READ" }])));
    expect(updateMessageStatus.mock.calls[0][0]).toBe("BAE52");
  });

  it("lit l'identifiant depuis messageId en dernier recours", async () => {
    await POST(post(event("MESSAGES_UPDATE", [{ messageId: "BAE53", status: "READ" }])));
    expect(updateMessageStatus.mock.calls[0][0]).toBe("BAE53");
  });

  it("accepte un objet unique au lieu d'un tableau", async () => {
    await POST(post(event("MESSAGES_UPDATE", { keyId: "BAE54", status: "DELIVERY_ACK" })));
    expect(updateMessageStatus).toHaveBeenCalledTimes(1);
    expect(updateMessageStatus.mock.calls[0][0]).toBe("BAE54");
  });

  it("un événement livré deux fois est retransmis sans erreur (idempotence déléguée)", async () => {
    const body = event("MESSAGES_UPDATE", [{ keyId: "BAE5DUP", status: "READ" }]);
    expect((await POST(post(body))).status).toBe(200);
    expect((await POST(post(body))).status).toBe(200);
    expect(updateMessageStatus).toHaveBeenCalledTimes(2);
    expect(updateMessageStatus.mock.calls[0]).toEqual(updateMessageStatus.mock.calls[1]);
  });
});

describe("POST — MESSAGES_UPSERT (messages entrants)", () => {
  it("fromMe: false → enregistre le numéro sans le suffixe JID", async () => {
    const res = await POST(
      post(
        event("MESSAGES_UPSERT", [
          {
            key: { id: "BAE5IN", remoteJid: "213555123456@s.whatsapp.net", fromMe: false },
            messageTimestamp: 1700000000,
          },
        ]),
      ),
    );
    expect(res.status).toBe(200);
    expect(recordInboundMessage).toHaveBeenCalledWith("213555123456", "BAE5IN", 1700000000);
  });

  it("fromMe: true → ignoré (écho de notre propre envoi)", async () => {
    await POST(
      post(
        event("MESSAGES_UPSERT", [
          { key: { id: "BAE5OUT", remoteJid: "213555123456@s.whatsapp.net", fromMe: true } },
        ]),
      ),
    );
    expect(recordInboundMessage).not.toHaveBeenCalled();
  });

  it("JID de groupe (@g.us) → ignoré", async () => {
    await POST(
      post(
        event("MESSAGES_UPSERT", [
          { key: { id: "BAE5GRP", remoteJid: "120363000000000000@g.us", fromMe: false } },
        ]),
      ),
    );
    expect(recordInboundMessage).not.toHaveBeenCalled();
  });
});

describe("POST — CONNECTION_UPDATE", () => {
  it("acquitte sans écrire en base", async () => {
    const res = await POST(post(event("CONNECTION_UPDATE", { state: "close" })));
    expect(res.status).toBe(200);
    expect(updateMessageStatus).not.toHaveBeenCalled();
    expect(recordInboundMessage).not.toHaveBeenCalled();
  });
});

describe("POST — événement inconnu", () => {
  it("acquitte en 200 sans rien faire", async () => {
    const res = await POST(post(event("CHATS_DELETE", [{ id: "x" }])));
    expect(res.status).toBe(200);
    expect(updateMessageStatus).not.toHaveBeenCalled();
  });
});
