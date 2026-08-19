import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

// État + espions partagés pour le client Supabase simulé.
const shared = vi.hoisted(() => ({
  selectData: null as unknown,
  updateSpy: vi.fn(),
  upsertSpy: vi.fn(),
  insertSpy: vi.fn(),
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
      insert: async (row: unknown) => {
        shared.insertSpy(row);
        return {};
      },
    }),
  }),
}));

import { logOutgoingMessage, updateMessageStatus } from "@/lib/whatsapp/log";

beforeEach(() => {
  shared.selectData = null;
  shared.updateSpy.mockClear();
  shared.upsertSpy.mockClear();
  shared.insertSpy.mockClear();
});

describe("updateMessageStatus — idempotence / pas de régression de statut", () => {
  it("n'écrit rien si le message est inconnu (identifiant absent du journal)", async () => {
    shared.selectData = null;
    await updateMessageStatus("BAE5UNKNOWN", "delivered");
    expect(shared.updateSpy).not.toHaveBeenCalled();
  });

  it("ne rétrograde pas un statut (read -> sent ignoré)", async () => {
    shared.selectData = { status: "read" };
    await updateMessageStatus("BAE51", "sent");
    expect(shared.updateSpy).not.toHaveBeenCalled();
  });

  it("avance un statut (sent -> delivered)", async () => {
    shared.selectData = { status: "sent" };
    await updateMessageStatus("BAE51", "delivered", { timestamp: "2026-08-19T10:00:00.000Z" });
    expect(shared.updateSpy).toHaveBeenCalledTimes(1);
    expect(shared.updateSpy.mock.calls[0][0]).toMatchObject({
      status: "delivered",
      delivered_at: "2026-08-19T10:00:00.000Z",
    });
  });

  it("avance depuis le statut initial « queued »", async () => {
    shared.selectData = { status: "queued" };
    await updateMessageStatus("BAE51", "sent");
    expect(shared.updateSpy).toHaveBeenCalledTimes(1);
    expect(shared.updateSpy.mock.calls[0][0]).toMatchObject({ status: "sent" });
  });

  it("un même statut rejoué n'écrit rien (idempotent)", async () => {
    shared.selectData = { status: "delivered" };
    await updateMessageStatus("BAE51", "delivered");
    expect(shared.updateSpy).not.toHaveBeenCalled();
  });

  it("échec : toujours écrit, avec code/erreur", async () => {
    shared.selectData = { status: "sent" };
    await updateMessageStatus("BAE51", "failed", {
      errorCode: "500",
      errorMessage: "passerelle indisponible",
    });
    expect(shared.updateSpy).toHaveBeenCalledTimes(1);
    expect(shared.updateSpy.mock.calls[0][0]).toMatchObject({
      status: "failed",
      error_code: "500",
      error_message: "passerelle indisponible",
    });
  });
});

describe("logOutgoingMessage — provenance et horodatage", () => {
  it("marque la provenance « evolution » et renseigne l'instance", async () => {
    await logOutgoingMessage({
      recipientPhone: "213555123456",
      messageType: "text",
      instance: "benzaoui",
      messageId: "BAE5ABC",
      status: "queued",
    });
    expect(shared.insertSpy).toHaveBeenCalledTimes(1);
    expect(shared.insertSpy.mock.calls[0][0]).toMatchObject({
      provider: "evolution",
      instance: "benzaoui",
      message_id: "BAE5ABC",
      status: "queued",
    });
  });

  it("« queued » renseigne sent_at (le message est parti vers la passerelle)", async () => {
    await logOutgoingMessage({
      recipientPhone: "213555123456",
      messageType: "text",
      status: "queued",
    });
    expect(shared.insertSpy.mock.calls[0][0].sent_at).toBeTruthy();
    expect(shared.insertSpy.mock.calls[0][0].failed_at).toBeNull();
  });

  it("« failed » renseigne failed_at et laisse sent_at vide", async () => {
    await logOutgoingMessage({
      recipientPhone: "213555123456",
      messageType: "text",
      status: "failed",
      errorMessage: "Numéro invalide",
    });
    expect(shared.insertSpy.mock.calls[0][0].sent_at).toBeNull();
    expect(shared.insertSpy.mock.calls[0][0].failed_at).toBeTruthy();
  });
});
