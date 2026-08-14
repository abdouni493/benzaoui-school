import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Ces modules importent `server-only` (qui lève une erreur hors bundle serveur)
// et ne doivent JAMAIS toucher le vrai réseau Meta en test : on neutralise l'un
// et on remplace `fetch`.
vi.mock("server-only", () => ({}));

import {
  WhatsAppError,
  getConfig,
  getConfiguredTemplates,
  resolveTemplateName,
  sendTemplateMessage,
  sendTextMessage,
} from "@/lib/whatsapp/client";

const TOKEN = "TEST-ACCESS-TOKEN";
const PHONE_ID = "123456789";

function mockFetchOnce(payload: unknown, ok = true, status = 200) {
  const fn = vi.fn(async () => ({
    ok,
    status,
    json: async () => payload,
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fn);
  return fn as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", TOKEN);
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", PHONE_ID);
  vi.stubEnv("WHATSAPP_API_VERSION", "v21.0");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getConfig — configuration minimale", () => {
  it("null si le jeton d'accès manque", () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
    expect(getConfig()).toBeNull();
  });

  it("null si le Phone Number ID manque", () => {
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "");
    expect(getConfig()).toBeNull();
  });

  it("présent quand jeton + Phone Number ID sont là", () => {
    const cfg = getConfig();
    expect(cfg?.accessToken).toBe(TOKEN);
    expect(cfg?.phoneNumberId).toBe(PHONE_ID);
    expect(cfg?.apiVersion).toBe("v21.0");
  });
});

describe("sendTextMessage — configuration manquante", () => {
  it("lève une WhatsAppError 503 si non configuré (aucun appel réseau)", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
    const fetchMock = mockFetchOnce({});
    await expect(sendTextMessage("213555123456", "salut")).rejects.toMatchObject({
      name: "WhatsAppError",
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendTextMessage — endpoint, en-tête et charge utile", () => {
  it("appelle le bon endpoint Graph avec Bearer et le bon corps texte", async () => {
    const fetchMock = mockFetchOnce({ messages: [{ id: "wamid.TEXT" }] });

    const res = await sendTextMessage("213555123456", "Bonjour");

    expect(res.messageId).toBe("wamid.TEXT");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://graph.facebook.com/v21.0/${PHONE_ID}/messages`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);

    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      messaging_product: "whatsapp",
      to: "213555123456",
      type: "text",
      text: { body: "Bonjour", preview_url: false },
    });
    // Le jeton ne doit jamais fuiter dans le corps.
    expect(init.body as string).not.toContain(TOKEN);
  });
});

describe("sendTemplateMessage — charge utile de modèle", () => {
  it("échoue clairement (503) si le nom de modèle n'est pas configuré", async () => {
    vi.stubEnv("WHATSAPP_TEMPLATE_BALANCE_DEBT", "");
    const fetchMock = mockFetchOnce({});
    await expect(
      sendTemplateMessage("213555123456", { templateId: "debt", variables: ["A"], language: "fr" }),
    ).rejects.toMatchObject({ name: "WhatsAppError", status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("construit le bon payload modèle (nom Meta + langue + variables ordonnées)", async () => {
    vi.stubEnv("WHATSAPP_TEMPLATE_BALANCE_DEBT", "solde_dette");
    const fetchMock = mockFetchOnce({ messages: [{ id: "wamid.TPL" }] });

    const res = await sendTemplateMessage("213555123456", {
      templateId: "debt",
      variables: ["Yacine Meziane", "1 200 DA", "École Benzaoui"],
      language: "fr",
    });

    expect(res.messageId).toBe("wamid.TPL");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("solde_dette");
    expect(body.template.language.code).toBe("fr");
    expect(body.template.components[0]).toEqual({
      type: "body",
      parameters: [
        { type: "text", text: "Yacine Meziane" },
        { type: "text", text: "1 200 DA" },
        { type: "text", text: "École Benzaoui" },
      ],
    });
  });

  it("mappe le code langue arabe", async () => {
    vi.stubEnv("WHATSAPP_TEMPLATE_BALANCE_LOW", "solde_faible");
    const fetchMock = mockFetchOnce({ messages: [{ id: "wamid.AR" }] });
    await sendTemplateMessage("213555123456", {
      templateId: "balance_low",
      variables: ["X", "500 DA", "Y"],
      language: "ar",
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).template.language.code).toBe("ar");
  });
});

describe("parsing des erreurs Meta", () => {
  it("jeton invalide (code 190) → message clair, statut 502", async () => {
    mockFetchOnce({ error: { code: 190, type: "OAuthException", message: "Bad token" } }, false, 401);
    await expect(sendTextMessage("213555123456", "x")).rejects.toMatchObject({
      name: "WhatsAppError",
      status: 502,
      metaCode: 190,
    });
    try {
      await sendTextMessage("213555123456", "x");
    } catch (err) {
      expect(err).toBeInstanceOf(WhatsAppError);
      expect((err as WhatsAppError).message).toContain("Jeton d'accès WhatsApp invalide");
    }
  });

  it("hors fenêtre de service client (code 131047) → statut 422", async () => {
    mockFetchOnce({ error: { code: 131047, message: "re-engagement" } }, false, 400);
    await expect(sendTextMessage("213555123456", "x")).rejects.toMatchObject({
      status: 422,
      metaCode: 131047,
    });
  });
});

describe("getConfiguredTemplates / resolveTemplateName", () => {
  it("ne liste que les modèles dont le nom Meta est renseigné", () => {
    vi.stubEnv("WHATSAPP_TEMPLATE_BALANCE_DEBT", "solde_dette");
    vi.stubEnv("WHATSAPP_TEMPLATE_BALANCE_EMPTY", "");
    expect(resolveTemplateName("debt")).toBe("solde_dette");
    expect(resolveTemplateName("balance_empty")).toBeNull();
    expect(getConfiguredTemplates()).toContain("debt");
    expect(getConfiguredTemplates()).not.toContain("balance_empty");
  });
});
