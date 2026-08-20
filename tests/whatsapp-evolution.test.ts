import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `client.ts` importe `server-only` (qui lève hors bundle serveur) et ne doit
// JAMAIS toucher la vraie passerelle en test : on neutralise l'un et on
// remplace `fetch`.
vi.mock("server-only", () => ({}));

import {
  WhatsAppError,
  createInstance,
  getConfig,
  getWebhookInfo,
  getConnectionState,
  isKnownServerUrl,
  mapEvolutionStatus,
  maskId,
  networkErrorCode,
  normalizeBaseUrl,
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
  // Les reprises attendent 250 ms puis 900 ms. Rendre l'attente immediate
  // garde la suite rapide sans rien changer a la logique testee. Le stub vit
  // ICI et non au niveau du module : afterEach appelle vi.unstubAllGlobals().
  vi.stubGlobal("setTimeout", ((fn: () => void) => {
    fn();
    return 0;
  }) as unknown as typeof setTimeout);
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


// ---------------------------------------------------------------------------
// EVOLUTION_BASE_URL — les deux fautes de saisie qui se déguisaient en panne
// ---------------------------------------------------------------------------

describe("normalizeBaseUrl", () => {
  it("ajoute https:// quand le schéma a été oublié", () => {
    const out = normalizeBaseUrl("wa.exemple.dz");
    expect(out?.baseUrl).toBe("https://wa.exemple.dz");
    expect(out?.note).toMatch(/https/);
  });

  it("relève http:// en https:// vers un hôte public (un tunnel ne publie que le 443)", () => {
    const out = normalizeBaseUrl("http://benzaoui-wa.tail6ac334.ts.net");
    expect(out?.baseUrl).toBe("https://benzaoui-wa.tail6ac334.ts.net");
    expect(out?.note).toMatch(/https/);
  });

  it("laisse http:// intact sur localhost et sur le réseau local", () => {
    expect(normalizeBaseUrl("http://localhost:8080")?.baseUrl).toBe("http://localhost:8080");
    expect(normalizeBaseUrl("http://192.168.1.10:8080")?.baseUrl).toBe("http://192.168.1.10:8080");
    expect(normalizeBaseUrl("http://127.0.0.1:8080")?.note).toBeUndefined();
  });

  it("retire les slashs finaux sans toucher au chemin", () => {
    expect(normalizeBaseUrl("https://wa.exemple.dz///")?.baseUrl).toBe("https://wa.exemple.dz");
    expect(normalizeBaseUrl("https://wa.exemple.dz/evo/")?.baseUrl).toBe(
      "https://wa.exemple.dz/evo",
    );
  });

  it("null sur une valeur vide ou inexploitable", () => {
    expect(normalizeBaseUrl("")).toBeNull();
    expect(normalizeBaseUrl(undefined)).toBeNull();
    expect(normalizeBaseUrl("ftp://wa.exemple.dz")).toBeNull();
  });

  it("getConfig signale la correction appliquée", () => {
    vi.stubEnv("EVOLUTION_BASE_URL", "http://wa.exemple.dz");
    const cfg = getConfig();
    expect(cfg?.baseUrl).toBe("https://wa.exemple.dz");
    expect(cfg?.baseUrlNote).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Cause réelle d'un échec réseau
// ---------------------------------------------------------------------------

/** `fetch` masque tout derrière « TypeError: fetch failed » : la vraie cause
 *  vit dans `cause.code`. */
function fetchThatFails(code: string | undefined, ...thenResolves: unknown[]) {
  let call = 0;
  const fn = vi.fn(async () => {
    if (call++ === 0 || thenResolves.length === 0) {
      const err = new TypeError("fetch failed");
      (err as { cause?: unknown }).cause = code ? Object.assign(new Error("boom"), { code }) : undefined;
      throw err;
    }
    return { ok: true, status: 200, json: async () => thenResolves[0] };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("networkErrorCode", () => {
  it("descend la chaîne des causes jusqu'au code système", () => {
    const inner = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const outer = Object.assign(new TypeError("fetch failed"), { cause: inner });
    expect(networkErrorCode(outer)).toBe("ECONNREFUSED");
  });

  it("traduit un abandon sur délai en ETIMEDOUT", () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    expect(networkErrorCode(err)).toBe("ETIMEDOUT");
  });

  it("null quand aucune cause n'est exploitable", () => {
    expect(networkErrorCode(new Error("rien"))).toBeNull();
  });

  it("ne boucle pas sur une chaîne de causes circulaire", () => {
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(networkErrorCode(a)).toBeNull();
  });
});

describe("passerelle injoignable — le message porte l'hôte et le code", () => {
  it("expose le code système et l'hôte visé, jamais la clé API", async () => {
    fetchThatFails("ECONNREFUSED");
    const err = await getConnectionState().catch((e) => e);

    expect(err).toBeInstanceOf(WhatsAppError);
    expect((err as WhatsAppError).status).toBe(503);
    expect((err as WhatsAppError).networkCode).toBe("ECONNREFUSED");
    expect((err as WhatsAppError).message).toContain("wa.exemple.dz");
    expect((err as WhatsAppError).message).toContain("ECONNREFUSED");
    expect((err as WhatsAppError).message).not.toContain(API_KEY);
  });

  it("rejoue une lecture après une coupure passagère", async () => {
    const fetchMock = fetchThatFails("ECONNRESET", { instance: { state: "open" } });
    await expect(getConnectionState()).resolves.toEqual({ state: "open" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("va jusqu'à deux reprises avant d'abandonner", async () => {
    // Le cas de production : une fonction réveillée réutilise une socket que
    // la passerelle a fermée entre-temps. Une seule reprise ne suffisait pas
    // toujours — le pool pouvait servir une deuxième socket morte.
    const fetchMock = fetchThatFails("ECONNRESET");
    await expect(getConnectionState()).rejects.toBeInstanceOf(WhatsAppError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("ne rejoue JAMAIS un envoi : un message posté deux fois est pire qu'un échec", async () => {
    const fetchMock = fetchThatFails("ECONNRESET");
    await expect(sendTextMessage("213555111222", "Bonjour")).rejects.toBeInstanceOf(WhatsAppError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejoue « Initialiser l'instance », qui est idempotent malgré son POST", async () => {
    // L'idempotence est déclarée par appel, pas déduite du verbe : c'est le
    // bouton sur lequel la réception tombe quand la liaison est instable.
    const fetchMock = fetchThatFails("ECONNRESET", {});
    await expect(createInstance("https://ecole.example/api/whatsapp/webhook")).resolves
      .toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("n'insiste pas sur une panne franche : ECONNREFUSED n'est pas passager", async () => {
    const fetchMock = fetchThatFails("ECONNREFUSED");
    await expect(getConnectionState()).rejects.toBeInstanceOf(WhatsAppError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Le webhook REELLEMENT enregistre sur la passerelle
// ---------------------------------------------------------------------------

/** La reponse d'Evolution a /webhook/find/{instance}. */
const webhookRow = (token: string | null, url = "https://ecole.example/api/whatsapp/webhook") => ({
  enabled: true,
  url,
  events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"],
  headers: token === null ? {} : { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
});

describe("getWebhookInfo — la panne muette", () => {
  it("confirme un jeton identique des deux côtés", async () => {
    mockFetchOnce(webhookRow(WEBHOOK_TOKEN));
    await expect(getWebhookInfo()).resolves.toEqual({
      url: "https://ecole.example/api/whatsapp/webhook",
      tokenMatches: true,
    });
  });

  it("détecte un jeton divergent — messages partis, aucun accusé revenu", async () => {
    // Le cas constaté en production : la variable a été régénérée côté
    // hébergeur sans réenregistrer le webhook. L'écran affichait « prête ».
    mockFetchOnce(webhookRow("UN-AUTRE-JETON-DE-64-CARACTERES"));
    const info = await getWebhookInfo();
    expect(info.tokenMatches).toBe(false);
    expect(info.url).toBe("https://ecole.example/api/whatsapp/webhook");
  });

  it("compte un webhook sans en-tête Authorization comme divergent", async () => {
    mockFetchOnce(webhookRow(null));
    expect((await getWebhookInfo()).tokenMatches).toBe(false);
  });

  it("lit aussi la forme imbriquée sous `webhook`", async () => {
    mockFetchOnce({ webhook: webhookRow(WEBHOOK_TOKEN) });
    expect((await getWebhookInfo()).tokenMatches).toBe(true);
  });

  it("ne lève jamais : une passerelle muette laisse l'écran affichable", async () => {
    fetchThatFails("ECONNRESET");
    await expect(getWebhookInfo()).resolves.toEqual({ url: null, tokenMatches: null });
  });

  it("ne conclut rien quand l'application n'a pas de jeton configuré", async () => {
    // Sans EVOLUTION_WEBHOOK_TOKEN, aucun événement ne peut être authentifié :
    // la comparaison doit dire « non », pas « oui ».
    vi.stubEnv("EVOLUTION_WEBHOOK_TOKEN", "");
    mockFetchOnce(webhookRow("N-IMPORTE-QUOI"));
    expect((await getWebhookInfo()).tokenMatches).toBe(false);
  });
});
