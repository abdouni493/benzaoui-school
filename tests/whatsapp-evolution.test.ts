import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `client.ts` importe `server-only` (qui lève hors bundle serveur) et ne doit
// JAMAIS toucher la vraie passerelle en test : on neutralise l'un et on
// remplace `fetch`.
vi.mock("server-only", () => ({}));

import {
  WhatsAppError,
  getConfig,
  getConnectionState,
  isKnownServerUrl,
  mapEvolutionStatus,
  maskId,
  sendTextMessage,
  verifyWebhookToken,
} from "@/lib/whatsapp/client";

const BASE_URL = "https://wa.exemple.dz";
const API_KEY = "TEST-EVOLUTION-KEY";
const INSTANCE = "benzaoui";
const WEBHOOK_TOKEN = "TEST-WEBHOOK-TOKEN";

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
  vi.stubEnv("EVOLUTION_BASE_URL", BASE_URL);
  vi.stubEnv("EVOLUTION_API_KEY", API_KEY);
  vi.stubEnv("EVOLUTION_INSTANCE", INSTANCE);
  vi.stubEnv("EVOLUTION_WEBHOOK_TOKEN", WEBHOOK_TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getConfig — configuration minimale", () => {
  it("null si l'URL de la passerelle manque", () => {
    vi.stubEnv("EVOLUTION_BASE_URL", "");
    expect(getConfig()).toBeNull();
  });

  it("null si la clé API manque", () => {
    vi.stubEnv("EVOLUTION_API_KEY", "");
    expect(getConfig()).toBeNull();
  });

  it("présente quand URL + clé sont là", () => {
    const cfg = getConfig();
    expect(cfg?.baseUrl).toBe(BASE_URL);
    expect(cfg?.apiKey).toBe(API_KEY);
    expect(cfg?.instance).toBe(INSTANCE);
    expect(cfg?.webhookToken).toBe(WEBHOOK_TOKEN);
  });

  it("retire le slash final de l'URL (sinon les chemins seraient doublés)", () => {
    vi.stubEnv("EVOLUTION_BASE_URL", `${BASE_URL}///`);
    expect(getConfig()?.baseUrl).toBe(BASE_URL);
  });

  it("nom d'instance par défaut si EVOLUTION_INSTANCE est absente", () => {
    vi.stubEnv("EVOLUTION_INSTANCE", "");
    expect(getConfig()?.instance).toBe("benzaoui");
  });
});

describe("sendTextMessage — configuration manquante", () => {
  it("lève une WhatsAppError 503 si non configuré (aucun appel réseau)", async () => {
    vi.stubEnv("EVOLUTION_API_KEY", "");
    const fetchMock = mockFetchOnce({});
    await expect(sendTextMessage("213555123456", "salut")).rejects.toMatchObject({
      name: "WhatsAppError",
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendTextMessage — endpoint, en-tête et charge utile", () => {
  it("appelle sendText avec l'en-tête apikey et le bon corps", async () => {
    const fetchMock = mockFetchOnce({ key: { id: "BAE594145F4C59B4" }, status: "PENDING" });

    const res = await sendTextMessage("213555123456", "Bonjour");

    expect(res.messageId).toBe("BAE594145F4C59B4");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/message/sendText/${INSTANCE}`);
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    // Evolution attend « apikey », PAS un Bearer.
    expect(headers.apikey).toBe(API_KEY);
    expect(headers.Authorization).toBeUndefined();

    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      number: "213555123456",
      text: "Bonjour",
      linkPreview: false,
    });
    // Frappe simulée par défaut : comportement plus humain.
    expect(body.delay).toBeGreaterThan(0);
    // La clé ne doit jamais fuiter dans le corps.
    expect(init.body as string).not.toContain(API_KEY);
  });

  it("réponse sans identifiant → 502 explicite", async () => {
    mockFetchOnce({ status: "PENDING" });
    await expect(sendTextMessage("213555123456", "x")).rejects.toMatchObject({
      name: "WhatsAppError",
      status: 502,
    });
  });
});

describe("extraction des erreurs Evolution", () => {
  it("message en chaîne simple", async () => {
    mockFetchOnce({ status: 400, error: "Bad Request", response: { message: "Numéro invalide" } }, false, 400);
    await expect(sendTextMessage("x", "y")).rejects.toMatchObject({
      status: 422,
      message: "Numéro invalide",
    });
  });

  it("message en tableau de chaînes", async () => {
    mockFetchOnce(
      { status: 400, error: "Bad Request", response: { message: ["champ A requis", "champ B requis"] } },
      false,
      400,
    );
    await expect(sendTextMessage("x", "y")).rejects.toMatchObject({
      message: "champ A requis · champ B requis",
    });
  });

  it("message en tableau de tableaux", async () => {
    mockFetchOnce({ response: { message: [["erreur imbriquée"]] } }, false, 400);
    await expect(sendTextMessage("x", "y")).rejects.toMatchObject({
      message: "erreur imbriquée",
    });
  });

  it("401 (clé API du serveur) est remappé en 502, pas en 401", async () => {
    // Un 401 renvoyé tel quel ferait croire à l'utilisateur que SA session a
    // expiré, alors que c'est la configuration serveur qui est en cause.
    mockFetchOnce({ status: 401, error: "Unauthorized" }, false, 401);
    const err = await sendTextMessage("x", "y").catch((e) => e);
    expect(err).toBeInstanceOf(WhatsAppError);
    expect(err.status).toBe(502);
    expect(err.message).toContain("EVOLUTION_API_KEY");
  });

  it("404 « does not exist » → 503 avec la marche à suivre", async () => {
    mockFetchOnce(
      { status: 404, response: { message: 'Instance "benzaoui" does not exist' } },
      false,
      404,
    );
    const err = await sendTextMessage("x", "y").catch((e) => e);
    expect(err.status).toBe(503);
    expect(err.message).toContain("Paramètres");
  });
});

describe("getConnectionState", () => {
  it("normalise un état connu", async () => {
    mockFetchOnce({ instance: { instanceName: INSTANCE, state: "open" } });
    expect(await getConnectionState()).toEqual({ state: "open" });
  });

  it("un état inconnu devient « unknown »", async () => {
    mockFetchOnce({ instance: { state: "zombie" } });
    expect(await getConnectionState()).toEqual({ state: "unknown" });
  });

  it("instance inexistante → « close » plutôt qu'une erreur", async () => {
    // Le panneau Paramètres doit rester affichable pour proposer l'initialisation.
    mockFetchOnce({ response: { message: "instance does not exist" } }, false, 404);
    expect(await getConnectionState()).toEqual({ state: "close" });
  });
});

describe("mapEvolutionStatus — statuts Baileys", () => {
  it("libellés nommés", () => {
    expect(mapEvolutionStatus("PENDING")).toBe("queued");
    expect(mapEvolutionStatus("SERVER_ACK")).toBe("sent");
    expect(mapEvolutionStatus("DELIVERY_ACK")).toBe("delivered");
    expect(mapEvolutionStatus("READ")).toBe("read");
    expect(mapEvolutionStatus("PLAYED")).toBe("read");
    expect(mapEvolutionStatus("ERROR")).toBe("failed");
  });

  it("valeurs numériques", () => {
    expect(mapEvolutionStatus(0)).toBe("queued");
    expect(mapEvolutionStatus(1)).toBe("sent");
    expect(mapEvolutionStatus(2)).toBe("delivered");
    expect(mapEvolutionStatus(3)).toBe("read");
    expect(mapEvolutionStatus(4)).toBe("read");
  });

  it("valeur inconnue ou absente → null (ignorée sans erreur)", () => {
    expect(mapEvolutionStatus("BOGUS")).toBeNull();
    expect(mapEvolutionStatus(undefined)).toBeNull();
    expect(mapEvolutionStatus(null)).toBeNull();
    expect(mapEvolutionStatus(99)).toBeNull();
  });
});

describe("verifyWebhookToken — authentification des événements entrants", () => {
  it("accepte le bon jeton en Bearer", () => {
    expect(verifyWebhookToken(`Bearer ${WEBHOOK_TOKEN}`)).toBe(true);
  });

  it("accepte le jeton nu (sans préfixe Bearer)", () => {
    expect(verifyWebhookToken(WEBHOOK_TOKEN)).toBe(true);
  });

  it("refuse un mauvais jeton", () => {
    expect(verifyWebhookToken("Bearer MAUVAIS")).toBe(false);
  });

  it("refuse un jeton de longueur différente sans planter", () => {
    expect(verifyWebhookToken("Bearer court")).toBe(false);
    expect(verifyWebhookToken(`Bearer ${WEBHOOK_TOKEN}XXXXXXXX`)).toBe(false);
  });

  it("refuse un en-tête absent", () => {
    expect(verifyWebhookToken(null)).toBe(false);
  });

  it("refuse tout si le jeton n'est pas configuré côté serveur", () => {
    vi.stubEnv("EVOLUTION_WEBHOOK_TOKEN", "");
    expect(verifyWebhookToken(`Bearer ${WEBHOOK_TOKEN}`)).toBe(false);
  });
});

describe("isKnownServerUrl — seconde barrière", () => {
  it("accepte le même hôte, même si le chemin diffère", () => {
    expect(isKnownServerUrl(BASE_URL)).toBe(true);
    expect(isKnownServerUrl(`${BASE_URL}/api`)).toBe(true);
  });

  it("refuse un autre hôte", () => {
    expect(isKnownServerUrl("https://attaquant.example")).toBe(false);
  });

  it("tolère un server_url absent (certaines versions ne l'envoient pas)", () => {
    expect(isKnownServerUrl(undefined)).toBe(true);
  });

  it("refuse une valeur non analysable", () => {
    expect(isKnownServerUrl("pas-une-url")).toBe(false);
  });
});

describe("maskId", () => {
  it("ne garde que les 4 derniers caractères", () => {
    // "benzaoui" : 8 caractères, donc 4 masqués + les 4 derniers en clair.
    expect(maskId("benzaoui")).toBe("••••aoui");
    // Le masque est plafonné à 6 points, quelle que soit la longueur.
    expect(maskId("instance-tres-longue")).toBe("••••••ngue");
    expect(maskId(null)).toBeNull();
  });
});
