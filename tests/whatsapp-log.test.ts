import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

// État + espions partagés pour le client Supabase simulé.
const shared = vi.hoisted(() => ({
  selectData: null as unknown,
  updateSpy: vi.fn(),
  upsertSpy: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: shared.selectData }) }),
      }),
      update: (patch: unknown) => {
        shared.updateSpy(patch);
        return { eq: () => ({}) };
      },
      upsert: (row: unknown) => {
        shared.upsertSpy(row);
        return {};
      },
      insert: async () => ({}),
    }),
  }),
}));

import { isWithinServiceWindow, updateMessageStatus } from "@/lib/whatsapp/log";

beforeEach(() => {
  shared.selectData = null;
  shared.updateSpy.mockClear();
  shared.upsertSpy.mockClear();
});

describe("updateMessageStatus — idempotence / pas de régression de statut", () => {
  it("n'écrit rien si le message est inconnu (wamid absent du journal)", async () => {
    shared.selectData = null;
    await updateMessageStatus("wamid.unknown", "delivered");
    expect(shared.updateSpy).not.toHaveBeenCalled();
  });

  it("ne rétrograde pas un statut (read -> sent ignoré)", async () => {
    shared.selectData = { status: "read" };
    await updateMessageStatus("wamid.1", "sent");
    expect(shared.updateSpy).not.toHaveBeenCalled();
  });

  it("avance un statut (sent -> delivered)", async () => {
    shared.selectData = { status: "sent" };
    await updateMessageStatus("wamid.1", "delivered", { timestamp: "2026-08-18T10:00:00.000Z" });
    expect(shared.updateSpy).toHaveBeenCalledTimes(1);
    expect(shared.updateSpy.mock.calls[0][0]).toMatchObject({
      status: "delivered",
      delivered_at: "2026-08-18T10:00:00.000Z",
    });
  });

  it("un même statut rejoué n'écrit rien (idempotent)", async () => {
    shared.selectData = { status: "delivered" };
    await updateMessageStatus("wamid.1", "delivered");
    expect(shared.updateSpy).not.toHaveBeenCalled();
  });

  it("échec : toujours écrit, avec code/erreur", async () => {
    shared.selectData = { status: "sent" };
    await updateMessageStatus("wamid.1", "failed", { errorCode: "131047", errorMessage: "hors fenêtre" });
    expect(shared.updateSpy).toHaveBeenCalledTimes(1);
    expect(shared.updateSpy.mock.calls[0][0]).toMatchObject({
      status: "failed",
      error_code: "131047",
      error_message: "hors fenêtre",
    });
  });
});

describe("isWithinServiceWindow — fenêtre de service client de 24 h", () => {
  it("true si un message entrant date de moins de 24 h", async () => {
    shared.selectData = { last_inbound_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() };
    expect(await isWithinServiceWindow("213555123456")).toBe(true);
  });

  it("false si le dernier message entrant a plus de 24 h", async () => {
    shared.selectData = { last_inbound_at: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString() };
    expect(await isWithinServiceWindow("213555123456")).toBe(false);
  });

  it("false si le numéro n'a jamais écrit (inconnu)", async () => {
    shared.selectData = null;
    expect(await isWithinServiceWindow("213555123456")).toBe(false);
  });
});
