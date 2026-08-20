import "server-only";

import { timingSafeEqual } from "node:crypto";

/** Client REST de la passerelle WhatsApp Evolution API (auto-hébergée).
 *
 *  Evolution pilote une vraie session WhatsApp Web (moteur Baileys) et l'expose
 *  en HTTP. On lui parle avec un en-tête `apikey` ; elle envoie les messages
 *  depuis le numéro de l'école et rappelle l'application par webhook pour les
 *  statuts de remise et les messages entrants.
 *
 *  Trois différences avec l'ancienne API Cloud de Meta, à garder en tête :
 *   - aucun modèle à faire approuver : tout part en texte libre ;
 *   - aucune fenêtre de service client de 24 h ;
 *   - la passerelle tourne sur NOTRE machine : si elle est éteinte, rien ne part.
 *
 *  Et un point de sécurité : contrairement à Meta, Evolution NE SIGNE PAS ses
 *  webhooks. L'authenticité d'un événement entrant repose entièrement sur le
 *  jeton partagé vérifié par `verifyWebhookToken` et sur `isKnownServerUrl`.
 *
 *  Server-only strict : la clé API et le jeton de webhook ne quittent JAMAIS le
 *  serveur. Tous les appels partent des route handlers app/api/whatsapp/*. */

import type { ConnectionState, MessageStatus } from "./types";

const REQUEST_TIMEOUT_MS = 20_000;
/** Nom d'instance par défaut si EVOLUTION_INSTANCE n'est pas renseignée. */
const DEFAULT_INSTANCE = "benzaoui";
/** Temporisation demandée à la passerelle avant l'envoi : elle simule la frappe,
 *  ce qui rend le comportement plus humain (utile contre le bannissement). */
const DEFAULT_TYPING_DELAY_MS = 1200;

/** Erreur remontée telle quelle au client, avec un code HTTP exploitable et,
 *  éventuellement, le code HTTP rendu par la passerelle (jamais de secret). */
export class WhatsAppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly providerCode?: number,
    /** code système de l'échec réseau ("ECONNREFUSED", "ENOTFOUND"…), quand la
     *  requête n'a même pas pu atteindre la passerelle. C'est LUI qui distingue
     *  un poste éteint d'une variable d'environnement mal saisie. */
    readonly networkCode?: string,
  ) {
    super(message);
    this.name = "WhatsAppError";
  }
}

export interface EvolutionConfig {
  /** racine de l'API, sans slash final (ex. "https://wa.exemple.dz") */
  baseUrl: string;
  apiKey: string;
  instance: string;
  webhookToken?: string;
  /** ce que la normalisation a dû corriger dans EVOLUTION_BASE_URL, s'il y a
   *  lieu. Affiché dans le diagnostic : une variable mal saisie se voit alors,
   *  au lieu de se déguiser en « passerelle injoignable ». */
  baseUrlNote?: string;
}

/** Hôte qui n'existe QUE sur la machine de développement ou sur le réseau
 *  local : `http://` y reste légitime (pas de certificat TLS), mais une telle
 *  adresse est injoignable depuis l'extérieur — un hébergeur ou une passerelle
 *  distante ne pourra jamais la rappeler. */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h === "::1" ||
    h === "host.docker.internal" ||
    h.endsWith(".local") ||
    h.endsWith(".localhost") ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

/** Normalise EVOLUTION_BASE_URL. `null` si elle est inexploitable.
 *
 *  Deux fautes de saisie coûtaient jusqu'ici une demi-journée de diagnostic,
 *  parce qu'elles se présentaient toutes les deux comme « passerelle
 *  injoignable » alors que la passerelle allait très bien :
 *   - le schéma oublié (`wa.exemple.dz`) : `fetch` refuse l'URL ;
 *   - `http://` vers un hôte public : un tunnel (Tailscale Funnel, Cloudflare)
 *     ne publie QUE le port 443, la connexion est donc refusée.
 *
 *  On corrige les deux, et on dit ce qui a été corrigé (`note`). */
export function normalizeBaseUrl(raw: string | undefined | null): {
  baseUrl: string;
  note?: string;
} | null {
  const trimmed = raw?.trim().replace(/\/+$/, "");
  if (!trimmed) return null;

  let note: string | undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : ((note = "schéma absent : https:// ajouté"), `https://${trimmed}`);

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  // Un hôte public en http:// ne peut pas répondre derrière un tunnel : on
  // relève en https:// plutôt que d'échouer sur un ECONNREFUSED opaque.
  if (url.protocol === "http:" && !isLocalHost(url.hostname)) {
    url.protocol = "https:";
    note = "http:// relevé en https:// (hôte public)";
  }

  const path = url.pathname.replace(/\/+$/, "");
  return { baseUrl: `${url.origin}${path}`, ...(note ? { note } : {}) };
}

/** Configuration minimale pour ENVOYER : URL de la passerelle + clé API.
 *  `null` si l'une manque — les routes renvoient alors une 503 explicite. */
export function getConfig(): EvolutionConfig | null {
  const normalized = normalizeBaseUrl(process.env.EVOLUTION_BASE_URL);
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  if (!normalized || !apiKey) return null;

  return {
    baseUrl: normalized.baseUrl,
    apiKey,
    instance: process.env.EVOLUTION_INSTANCE?.trim() || DEFAULT_INSTANCE,
    webhookToken: process.env.EVOLUTION_WEBHOOK_TOKEN?.trim() || undefined,
    ...(normalized.note ? { baseUrlNote: normalized.note } : {}),
  };
}

function requireConfig(): EvolutionConfig {
  const config = getConfig();
  if (!config) {
    throw new WhatsAppError(
      "WhatsApp non configuré. Renseigner EVOLUTION_BASE_URL et EVOLUTION_API_KEY (voir README).",
      503,
    );
  }
  return config;
}

/** Le jeton de webhook n'est pas nécessaire pour envoyer, mais il l'est pour
 *  déclarer un webhook : sans lui, la route entrante ne pourrait authentifier
 *  aucun événement et les refuserait tous. On échoue donc tôt et clairement. */
function requireWebhookToken(config: EvolutionConfig): string {
  if (!config.webhookToken) {
    throw new WhatsAppError(
      "EVOLUTION_WEBHOOK_TOKEN n'est pas configuré : sans ce jeton, les événements de la passerelle ne peuvent pas être authentifiés.",
      503,
    );
  }
  return config.webhookToken;
}

/** Masque un identifiant pour un affichage sans fuite (garde les 4 derniers). */
export function maskId(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "•".repeat(trimmed.length);
  return `${"•".repeat(Math.min(6, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/** Aplatit le champ `message` d'une erreur Evolution, dont la forme varie selon
 *  la version : une chaîne, un tableau de chaînes, ou un tableau de tableaux. */
function flattenMessage(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(flattenMessage);
  if (value && typeof value === "object" && "message" in value) {
    return flattenMessage((value as { message?: unknown }).message);
  }
  return [];
}

/** Extrait un message d'erreur lisible d'une réponse Evolution. Forme usuelle :
 *  `{ status: 400, error: "Bad Request", response: { message: [...] } }`. */
function extractError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const p = payload as { error?: unknown; message?: unknown; response?: { message?: unknown } };

  const parts = [...flattenMessage(p.response?.message), ...flattenMessage(p.message)];
  if (parts.length > 0) return parts.join(" · ");
  if (typeof p.error === "string" && p.error.trim()) return p.error.trim();
  return fallback;
}

/** Remonte la chaîne des `cause` jusqu'au vrai code système. `fetch` masque
 *  tout derrière un « TypeError: fetch failed » : sans cela, un DNS qui ne
 *  résout pas, un port fermé et un poste éteint rendent le MÊME message, et le
 *  diagnostic repart de zéro à chaque fois. */
export function networkErrorCode(err: unknown): string | null {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return err instanceof Error && err.name === "TimeoutError" ? "ETIMEDOUT" : null;
}

/** Ce que chaque code veut dire, en clair : le message affiché dans Paramètres
 *  doit dire QUOI FAIRE, pas seulement que ça ne marche pas. */
const NETWORK_HINTS: Record<string, string> = {
  ENOTFOUND: "le nom de la passerelle ne se résout pas (DNS) — vérifier EVOLUTION_BASE_URL",
  EAI_AGAIN: "résolution DNS temporairement impossible — réessayer dans un instant",
  ECONNREFUSED:
    "connexion refusée par l'hôte — port fermé, ou EVOLUTION_BASE_URL en http:// alors que le tunnel ne publie que le 443",
  ECONNRESET:
    "connexion coupée en cours de route — liaison instable entre l'hébergeur et la passerelle, en général passager",
  ENETUNREACH: "réseau injoignable — adresse IPv6 sans route depuis l'hébergeur",
  EHOSTUNREACH: "hôte injoignable",
  ETIMEDOUT:
    "aucune réponse — le poste qui héberge la passerelle est éteint, en veille ou sans Internet",
  UND_ERR_CONNECT_TIMEOUT: "la connexion n'a pas pu s'établir à temps",
  CERT_HAS_EXPIRED: "le certificat TLS de la passerelle a expiré",
  DEPTH_ZERO_SELF_SIGNED_CERT:
    "certificat TLS auto-signé : la passerelle doit servir un vrai certificat",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "certificat TLS invérifiable",
  ERR_INVALID_URL: "EVOLUTION_BASE_URL n'est pas une URL valide",
};

/** Échecs qui peuvent disparaître au coup suivant.
 *
 *  ECONNRESET est de loin le plus fréquent en production : l'application vit
 *  dans des fonctions gelées entre deux appels, dont le pool de connexions
 *  garde des sockets que la passerelle a fermées entre-temps. La première
 *  requête d'une fonction réveillée tombe alors sur une socket morte. Rejouer
 *  suffit — le pool en ouvre une neuve. */
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** Attentes entre deux tentatives : deux reprises, pas plus. Une socket morte
 *  se rejoue tout de suite ; une passerelle qui redémarre a besoin d'un souffle. */
const RETRY_DELAYS_MS = [250, 900];

/** Temps total qu'on s'autorise, marge comprise, sous les 60 s de
 *  `maxDuration`. Au-delà l'hébergeur coupe la fonction et le navigateur reçoit
 *  une 504 opaque à la place de notre message. */
const RETRY_BUDGET_MS = 40_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Bascule la résolution DNS en IPv4 d'abord, une seule fois par processus.
 *
 *  La passerelle est publiée par un tunnel qui annonce A **et** AAAA. Un
 *  hébergeur sans route IPv6 tente alors l'AAAA et échoue en ENETUNREACH, alors
 *  que l'IPv4 juste à côté répond. On ne touche à l'ordre de résolution que
 *  lorsque ce cas se produit réellement — jamais par précaution. */
let ipv4Forced = false;
async function forceIpv4Once(): Promise<void> {
  if (ipv4Forced) return;
  ipv4Forced = true;
  try {
    const dns = await import("node:dns");
    dns.setDefaultResultOrder("ipv4first");
    console.error("[whatsapp] IPv6 injoignable : résolution DNS basculée en ipv4first.");
  } catch {
    /* environnement sans node:dns : on retentera simplement à l'identique */
  }
}

async function evolutionRequest<T>(
  path: string,
  init: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    timeoutMs?: number;
    /** l'appel peut être rejoué sans conséquence. Déclaré PAR APPEL et non
     *  déduit du verbe HTTP : `/instance/create` est un POST parfaitement
     *  idempotent, alors que `/message/sendText` est un GET qu'on ne rejouerait
     *  pour rien au monde s'il en était un. Par défaut, seules les lectures. */
    idempotent?: boolean;
  } = {},
): Promise<T> {
  const config = requireConfig();
  const {
    method = "GET",
    body,
    timeoutMs = REQUEST_TIMEOUT_MS,
    idempotent = method === "GET",
  } = init;

  const attempt = () =>
    fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        apikey: config.apiKey,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });

  const startedAt = Date.now();
  let response: Response | null = null;
  let lastCode: string | null = null;

  for (let tries = 0; response === null; tries++) {
    try {
      response = await attempt();
    } catch (err) {
      const code = networkErrorCode(err);
      lastCode = code ?? lastCode;
      // ENETUNREACH sur un nom qui porte A et AAAA : c'est l'IPv6 qui manque
      // de route, pas la passerelle qui est absente.
      if (code === "ENETUNREACH" || code === "EHOSTUNREACH") await forceIpv4Once();

      const delay = RETRY_DELAYS_MS[tries];
      const worstCase = Date.now() - startedAt + (delay ?? 0) + timeoutMs;
      const worthRetrying =
        delay !== undefined &&
        idempotent &&
        (code === null || TRANSIENT_CODES.has(code)) &&
        worstCase < RETRY_BUDGET_MS;

      if (!worthRetrying) throw unreachable(config, lastCode);
      await sleep(delay);
    }
  }

  const payload = (await response.json().catch(() => null)) as T | null;

  if (!response.ok) {
    const detail = extractError(payload, `La passerelle a répondu ${response.status}.`);
    // Journal serveur SANS secret : chemin + code suffisent au diagnostic.
    console.error(`[whatsapp] Evolution ${response.status} sur ${path}`);

    // 401 vient de la clé API du SERVEUR, pas de la session du navigateur : on
    // remappe en 502 pour ne pas faire croire à l'utilisateur qu'il est
    // déconnecté de l'application.
    if (response.status === 401) {
      throw new WhatsAppError(
        "Clé API refusée par la passerelle WhatsApp. Vérifier EVOLUTION_API_KEY côté serveur.",
        502,
        401,
      );
    }

    // Instance absente : ce n'est pas une panne, c'est une étape de mise en
    // service qui manque. Le message doit dire quoi faire.
    if (response.status === 404 && /does not exist|not found/i.test(detail)) {
      throw new WhatsAppError(
        "Instance WhatsApp introuvable sur la passerelle. Créer et connecter l'instance depuis Paramètres → WhatsApp.",
        503,
        404,
      );
    }

    // 403 conserve son détail : c'est ainsi que `createInstance` reconnaît une
    // instance déjà existante et reste idempotente.
    throw new WhatsAppError(detail, response.status >= 500 ? 502 : 422, response.status);
  }

  return payload as T;
}

/** Message d'échec réseau : toujours l'hôte visé ET le code système, jamais la
 *  clé API. C'est le seul moyen, depuis l'écran Paramètres, de distinguer « le
 *  poste est éteint » de « la variable Vercel est fausse ». */
function unreachable(config: EvolutionConfig, code: string | null): WhatsAppError {
  let host = config.baseUrl;
  try {
    host = new URL(config.baseUrl).host;
  } catch {
    /* baseUrl est déjà normalisée : ce cas ne devrait pas se produire */
  }
  const hint = code ? NETWORK_HINTS[code] : undefined;
  const detail = [code, hint].filter(Boolean).join(" — ");
  console.error(`[whatsapp] passerelle injoignable (${code ?? "cause inconnue"}) sur ${host}`);

  return new WhatsAppError(
    `Passerelle WhatsApp injoignable sur ${host}${detail ? ` : ${detail}` : "."}`,
    503,
    undefined,
    code ?? undefined,
  );
}

// ---------------------------------------------------------------------------
// Envoi
// ---------------------------------------------------------------------------

export interface SendResult {
  /** identifiant du message rendu par la passerelle (clé Baileys) */
  messageId: string;
}

interface EvolutionSendResponse {
  key?: { id?: string; remoteJid?: string; fromMe?: boolean };
  status?: string;
  messageTimestamp?: string | number;
}

/** Envoie un message TEXTE. Un retour sans erreur signifie « pris en charge par
 *  la passerelle », pas « remis » : la remise réelle remonte par le webhook. */
export async function sendTextMessage(
  to: string,
  text: string,
  opts: { delayMs?: number } = {},
): Promise<SendResult> {
  const config = requireConfig();
  const delay = opts.delayMs ?? DEFAULT_TYPING_DELAY_MS;

  const res = await evolutionRequest<EvolutionSendResponse>(
    `/message/sendText/${encodeURIComponent(config.instance)}`,
    {
      method: "POST",
      body: { number: to, text, delay, linkPreview: false },
      // Explicite, et non par défaut : un message parti deux fois chez une
      // famille est pire qu'un envoi manqué, que la file d'attente rattrape.
      idempotent: false,
      // La passerelle TIENT ce délai avant d'envoyer : il s'ajoute au temps de
      // réponse, le timeout doit donc en tenir compte.
      timeoutMs: REQUEST_TIMEOUT_MS + delay,
    },
  );

  const messageId = res.key?.id;
  if (!messageId) {
    throw new WhatsAppError("Réponse de la passerelle sans identifiant de message.", 502);
  }
  return { messageId };
}

/** Numéros réellement joignables sur WhatsApp, parmi ceux fournis.
 *
 *  Meta refusait explicitement un numéro sans compte WhatsApp ; Baileys, lui,
 *  accepte souvent l'envoi et le message part dans le vide. Sans cette
 *  vérification, le compte rendu afficherait « Envoyé » pour un message qui
 *  n'existe pas. Ne lève jamais : en cas d'échec on renvoie `null`, et
 *  l'appelant tente l'envoi comme avant. */
export async function filterWhatsAppNumbers(numbers: string[]): Promise<Set<string> | null> {
  if (numbers.length === 0) return new Set();
  try {
    const config = requireConfig();
    const res = await evolutionRequest<
      Array<{ exists?: boolean; number?: string; jid?: string }> | null
    >(`/chat/whatsappNumbers/${encodeURIComponent(config.instance)}`, {
      method: "POST",
      body: { numbers },
      // POST par convention d'Evolution, mais c'est une simple consultation.
      idempotent: true,
    });
    if (!Array.isArray(res)) return null;

    const reachable = new Set<string>();
    for (const entry of res) {
      if (entry?.exists === false) continue;
      // On réindexe sur le numéro demandé : `jid` porte un suffixe "@s.whatsapp.net"
      // et peut être normalisé différemment par WhatsApp.
      const digits = (entry?.number ?? entry?.jid ?? "").split("@")[0].replace(/\D/g, "");
      if (digits) reachable.add(digits);
    }
    return reachable;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

const KNOWN_STATES = ["open", "close", "connecting"] as const;

function normalizeState(raw: unknown): ConnectionState {
  return typeof raw === "string" && (KNOWN_STATES as readonly string[]).includes(raw)
    ? (raw as ConnectionState)
    : "unknown";
}

/** État de la session WhatsApp. Une instance pas encore créée n'est pas une
 *  panne : on renvoie « close » pour que le panneau Paramètres reste affichable
 *  et propose l'initialisation. */
export async function getConnectionState(): Promise<{ state: ConnectionState }> {
  const config = requireConfig();
  try {
    const res = await evolutionRequest<{ instance?: { state?: string }; state?: string }>(
      `/instance/connectionState/${encodeURIComponent(config.instance)}`,
    );
    return { state: normalizeState(res.instance?.state ?? res.state) };
  } catch (err) {
    if (err instanceof WhatsAppError && err.providerCode === 404) return { state: "close" };
    throw err;
  }
}

export interface InstanceInfo {
  ownerNumber: string | null;
  profileName: string | null;
}

/** Numéro et nom de profil liés à la session. Purement informatif : ne lève
 *  jamais, renvoie des `null` si la passerelle ne répond pas ou change de forme
 *  (la réponse est un tableau ou un objet selon la version). */
export async function getInstanceInfo(): Promise<InstanceInfo> {
  const empty: InstanceInfo = { ownerNumber: null, profileName: null };
  try {
    const config = requireConfig();
    const res = await evolutionRequest<unknown>(
      `/instance/fetchInstances?instanceName=${encodeURIComponent(config.instance)}`,
    );

    const first = Array.isArray(res) ? res[0] : res;
    if (!first || typeof first !== "object") return empty;

    const outer = first as Record<string, unknown>;
    // Certaines versions imbriquent les champs sous `instance`.
    const node = (
      outer.instance && typeof outer.instance === "object" ? outer.instance : outer
    ) as Record<string, unknown>;

    const str = (v: unknown): string | null =>
      typeof v === "string" && v.trim() ? v.trim() : null;

    const ownerJid = str(node.ownerJid) ?? str(node.owner);
    return {
      ownerNumber: ownerJid ? ownerJid.split("@")[0] || null : null,
      profileName: str(node.profileName) ?? str(node.profilePictureName),
    };
  } catch {
    return empty;
  }
}

export interface WebhookInfo {
  /** adresse que la passerelle rappellera, telle qu'ELLE la connaît */
  url: string | null;
  /** le jeton qu'elle enverra est bien celui que cette application attend.
   *  `null` = la passerelle n'a pas répondu, on ne sait pas. */
  tokenMatches: boolean | null;
}

/** Ce que la passerelle a RÉELLEMENT enregistré comme webhook.
 *
 *  Sans cette lecture, l'écran Paramètres ne pouvait qu'affirmer « le jeton est
 *  configuré côté serveur » — ce qui ne dit rien de ce que la passerelle, elle,
 *  enverra. Les deux divergent dès qu'on régénère la variable dans l'hébergeur
 *  sans réenregistrer le webhook, ou qu'on l'enregistre depuis le poste de
 *  développement. L'application refuse alors chaque événement en 401 : les
 *  messages partent, aucun accusé ne revient, et rien à l'écran ne le dit.
 *
 *  Purement informatif : ne lève jamais. */
export async function getWebhookInfo(): Promise<WebhookInfo> {
  const empty: WebhookInfo = { url: null, tokenMatches: null };
  try {
    const config = requireConfig();
    const res = await evolutionRequest<unknown>(
      `/webhook/find/${encodeURIComponent(config.instance)}`,
    );
    if (!res || typeof res !== "object") return empty;

    const outer = res as Record<string, unknown>;
    // Selon la version, la réponse est plate ou imbriquée sous `webhook`.
    const node = (
      outer.webhook && typeof outer.webhook === "object" ? outer.webhook : outer
    ) as Record<string, unknown>;

    const url = typeof node.url === "string" && node.url.trim() ? node.url.trim() : null;

    const headers = (node.headers ?? {}) as Record<string, unknown>;
    const auth = headers.Authorization ?? headers.authorization;

    return {
      url,
      // Comparaison en temps constant, et contre une donnée venue du réseau :
      // on réutilise la vérification des événements entrants plutôt que d'en
      // écrire une seconde, forcément moins soignée.
      tokenMatches: typeof auth === "string" ? verifyWebhookToken(auth) : false,
    };
  } catch {
    return empty;
  }
}

export interface ConnectResult {
  /** QR en data-URI prêt pour un `<img src>`, ou `null` si déjà connecté */
  qrBase64: string | null;
  pairingCode: string | null;
  state: ConnectionState;
}

/** Demande un QR code (ou un code d'appairage) pour lier le téléphone. Si la
 *  session est déjà ouverte, la passerelle renvoie l'état sans QR. */
export async function connectInstance(): Promise<ConnectResult> {
  const config = requireConfig();
  const res = await evolutionRequest<{
    base64?: string;
    code?: string;
    pairingCode?: string;
    qrcode?: { base64?: string; code?: string; pairingCode?: string };
    instance?: { state?: string };
  }>(`/instance/connect/${encodeURIComponent(config.instance)}`, { timeoutMs: 30_000 });

  const qr = res.qrcode ?? res;
  const rawBase64 = qr.base64?.trim() || null;

  return {
    qrBase64: rawBase64
      ? rawBase64.startsWith("data:image")
        ? rawBase64
        : `data:image/png;base64,${rawBase64}`
      : null,
    pairingCode: qr.pairingCode?.trim() || null,
    state: res.instance?.state
      ? normalizeState(res.instance.state)
      : rawBase64
        ? "connecting"
        : "unknown",
  };
}

/** Bloc `webhook` commun à la création d'instance et à la reconfiguration.
 *  L'en-tête Authorization est la SEULE preuve d'origine des événements : sans
 *  lui, n'importe qui pourrait POSTer sur /api/whatsapp/webhook. */
function webhookPayload(webhookUrl: string, token: string) {
  return {
    enabled: true,
    url: webhookUrl,
    byEvents: false,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"],
  };
}

/** Crée l'instance sur la passerelle et y enregistre l'URL du webhook.
 *  Idempotent : réappeler « Initialiser » sur une instance existante ne doit pas
 *  échouer — c'est le geste naturel après un changement de domaine. */
export async function createInstance(webhookUrl: string): Promise<void> {
  const config = requireConfig();
  const token = requireWebhookToken(config);
  try {
    await evolutionRequest<unknown>("/instance/create", {
      method: "POST",
      body: {
        instanceName: config.instance,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        webhook: webhookPayload(webhookUrl, token),
      },
      timeoutMs: 30_000,
      // Réappeler « Initialiser » sur une instance existante est déjà sans
      // effet (voir le catch plus bas) : la rejouer l'est tout autant.
      idempotent: true,
    });
  } catch (err) {
    if (err instanceof WhatsAppError && /already in use|already exists/i.test(err.message)) return;
    throw err;
  }
}

/** Réenregistre l'URL du webhook sur une instance existante. Sert après un
 *  changement de domaine Vercel, sans toucher à la session en cours. */
export async function setWebhook(webhookUrl: string): Promise<void> {
  const config = requireConfig();
  const token = requireWebhookToken(config);
  await evolutionRequest<unknown>(`/webhook/set/${encodeURIComponent(config.instance)}`, {
    method: "POST",
    body: { webhook: webhookPayload(webhookUrl, token) },
    // Écrit toujours exactement la même valeur : la rejouer ne change rien.
    idempotent: true,
  });
}

/** Délie le téléphone. Tous les envois s'arrêtent jusqu'à un nouveau scan. */
export async function logoutInstance(): Promise<void> {
  const config = requireConfig();
  await evolutionRequest<unknown>(`/instance/logout/${encodeURIComponent(config.instance)}`, {
    method: "DELETE",
    idempotent: true,
  });
}

/** Redémarre la session sans délier le téléphone — premier réflexe quand la
 *  connexion est « connecting » depuis trop longtemps. */
export async function restartInstance(): Promise<void> {
  const config = requireConfig();
  await evolutionRequest<unknown>(`/instance/restart/${encodeURIComponent(config.instance)}`, {
    method: "POST",
    idempotent: true,
  });
}

// ---------------------------------------------------------------------------
// Webhooks entrants
// ---------------------------------------------------------------------------

/** Vérifie l'en-tête `Authorization: Bearer <EVOLUTION_WEBHOOK_TOKEN>` d'un
 *  événement entrant, en TEMPS CONSTANT.
 *
 *  Evolution ne signe pas ses webhooks (Meta le faisait en HMAC) : ce jeton est
 *  la barrière principale. Sans jeton configuré, on refuse tout — mieux vaut un
 *  journal muet qu'un journal empoisonné par un tiers. */
export function verifyWebhookToken(header: string | null): boolean {
  const expected = process.env.EVOLUTION_WEBHOOK_TOKEN?.trim();
  if (!expected) {
    console.error(
      "[whatsapp] webhook refusé : EVOLUTION_WEBHOOK_TOKEN non configuré, origine invérifiable.",
    );
    return false;
  }
  if (!header) return false;

  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : header.trim();

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  // `timingSafeEqual` exige des longueurs égales. Comparer d'abord la longueur
  // ne fuite rien d'exploitable : elle est publique dès qu'on choisit le jeton.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** `true` si l'événement dit venir de NOTRE passerelle. Deuxième barrière,
 *  après le jeton. Tolérant : certaines versions n'envoient pas `server_url` —
 *  le jeton reste alors la seule preuve, ce qui est acceptable. */
export function isKnownServerUrl(serverUrl: string | undefined | null): boolean {
  if (!serverUrl) return true;

  const base = process.env.EVOLUTION_BASE_URL?.trim();
  if (!base) return false;
  try {
    return new URL(serverUrl).host === new URL(base).host;
  } catch {
    return false;
  }
}

/** Statuts Baileys nommés → statuts applicatifs. */
const BAILEYS_STATUS: Record<string, MessageStatus> = {
  PENDING: "queued",
  SERVER_ACK: "sent",
  DELIVERY_ACK: "delivered",
  READ: "read",
  PLAYED: "read",
  ERROR: "failed",
};

/** Mêmes statuts quand Baileys les numérote au lieu de les nommer. */
const BAILEYS_NUMERIC: MessageStatus[] = ["queued", "sent", "delivered", "read", "read"];

/** Traduit le statut brut d'un événement MESSAGES_UPDATE. `null` = libellé
 *  inconnu, à ignorer sans erreur (une version future peut en ajouter). */
export function mapEvolutionStatus(raw: string | number | undefined | null): MessageStatus | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "number") return BAILEYS_NUMERIC[raw] ?? null;

  const key = raw.trim().toUpperCase();
  return BAILEYS_STATUS[key] ?? null;
}
