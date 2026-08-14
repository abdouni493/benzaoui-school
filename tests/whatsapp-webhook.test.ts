import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";

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

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "verify-tok-123";

function sign(raw: string): string {
  return "sha256=" + createHmac("sha256", APP_SECRET).update(raw, "utf8").digest("hex");
}

function post(raw: string, signature: string | null): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature) headers["x-hub-signature-256"] = signature;
  return new Request("https://school.test/api/whatsapp/webhook", { method: "POST", body: raw, headers });
}

beforeEach(() => {
  vi.stubEnv("META_APP_SECRET", APP_SECRET);
  vi.stubEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", VERIFY_TOKEN);
  updateMessageStatus.mockClear();
  recordInboundMessage.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET — vérification d'abonnement Meta", () => {
  it("renvoie le challenge quand le jeton correspond", async () => {
    const url = `https://school.test/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=42`;
    const res = await GET(new Request(url));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("42");
  });

  it("refuse (403) quand le jeton est faux", async () => {
    const url = `https://school.test/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=42`;
    const res = await GET(new Request(url));
    expect(res.status).toBe(403);
  });

  it("refuse (403) quand le mode n'est pas subscribe", async () => {
    const url = `https://school.test/api/whatsapp/webhook?hub.mode=x&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=42`;
    const res = await GET(new Request(url));
    expect(res.status).toBe(403);
  });
});

describe("POST — signature", () => {
  it("refuse (403) une requête non signée ou mal signée", async () => {
    const raw = JSON.stringify({ entry: [] });
    expect((await POST(post(raw, null))).status).toBe(403);
    expect((await POST(post(raw, "sha256=deadbeef"))).status).toBe(403);
    expect(updateMessageStatus).not.toHaveBeenCalled();
  });
});

describe("POST — traitement des événements", () => {
  it("met à jour le statut d'un message (accusé)", async () => {
    const raw = JSON.stringify({
      entry: [
        {
          changes: [
            { value: { statuses: [{ id: "wamid.1", status: "delivered", timestamp: "1700000000" }] } },
          ],
        },
      ],
    });
    const res = await POST(post(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(updateMessageStatus).toHaveBeenCalledTimes(1);
    expect(updateMessageStatus.mock.calls[0][0]).toBe("wamid.1");
    expect(updateMessageStatus.mock.calls[0][1]).toBe("delivered");
  });

  it("enregistre un message entrant (fenêtre de service client)", async () => {
    const raw = JSON.stringify({
      entry: [
        {
          changes: [
            { value: { messages: [{ from: "213555123456", id: "wamid.in", timestamp: "1700000000" }] } },
          ],
        },
      ],
    });
    const res = await POST(post(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(recordInboundMessage).toHaveBeenCalledWith("213555123456", "wamid.in", "1700000000");
  });

  it("ignore un statut inconnu sans planter", async () => {
    const raw = JSON.stringify({
      entry: [{ changes: [{ value: { statuses: [{ id: "wamid.x", status: "bogus" }] } }] }],
    });
    const res = await POST(post(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(updateMessageStatus).not.toHaveBeenCalled();
  });

  it("acquitte un corps JSON invalide (signature valide) sans traiter", async () => {
    const raw = "pas du json";
    const res = await POST(post(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(updateMessageStatus).not.toHaveBeenCalled();
  });

  it("un événement livré deux fois est retransmis sans erreur (idempotence déléguée)", async () => {
    const raw = JSON.stringify({
      entry: [{ changes: [{ value: { statuses: [{ id: "wamid.dup", status: "read", timestamp: "1700000000" }] } }] }],
    });
    const sig = sign(raw);
    expect((await POST(post(raw, sig))).status).toBe(200);
    expect((await POST(post(raw, sig))).status).toBe(200);
    expect(updateMessageStatus).toHaveBeenCalledTimes(2);
    expect(updateMessageStatus.mock.calls[0]).toEqual(updateMessageStatus.mock.calls[1]);
  });
});
