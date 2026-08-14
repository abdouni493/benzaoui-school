import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

// État partagé, injecté dans les clients Supabase simulés.
const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profile: null as { role: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: state.profile }) }) }),
    }),
  }),
}));

import { assertCanSendWhatsApp } from "@/lib/whatsapp/auth";

beforeEach(() => {
  state.user = { id: "u1" };
  state.profile = null;
});

describe("assertCanSendWhatsApp — autorisation d'envoi WhatsApp", () => {
  it("401 si non authentifié", async () => {
    state.user = null;
    await expect(assertCanSendWhatsApp()).rejects.toMatchObject({ status: 401 });
  });

  it("403 pour un enseignant", async () => {
    state.profile = { role: "teacher" };
    await expect(assertCanSendWhatsApp()).rejects.toMatchObject({ status: 403 });
  });

  it("403 pour un élève et un parent", async () => {
    state.profile = { role: "student" };
    await expect(assertCanSendWhatsApp()).rejects.toMatchObject({ status: 403 });
    state.profile = { role: "parent" };
    await expect(assertCanSendWhatsApp()).rejects.toMatchObject({ status: 403 });
  });

  it("403 si aucun rôle", async () => {
    state.profile = null;
    await expect(assertCanSendWhatsApp()).rejects.toMatchObject({ status: 403 });
  });

  it("autorise l'administration", async () => {
    state.profile = { role: "admin" };
    await expect(assertCanSendWhatsApp()).resolves.toBeUndefined();
  });

  it("autorise la réception", async () => {
    state.profile = { role: "reception" };
    await expect(assertCanSendWhatsApp()).resolves.toBeUndefined();
  });
});
