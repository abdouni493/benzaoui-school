import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/** Client de l'API WhatsApp Cloud officielle de Meta (Graph API).
 *
 *  Toute l'infrastructure WhatsApp est désormais hébergée par Meta : plus de
 *  service séparé, plus de session WhatsApp Web, plus de QR code. Ce module
 *  parle directement à `https://graph.facebook.com/{version}/{phoneNumberId}`.
 *
 *  Server-only strict : le jeton d'accès et l'App Secret ne quittent JAMAIS le
 *  serveur. Tous les appels partent des route handlers app/api/whatsapp/*. */

import {
  META_TEMPLATE_CONFIG,
  isAlertTemplate,
  type AlertTemplateId,
  type MessageLanguage,
  type WhatsAppTemplateId,
} from "./templates";

const GRAPH_HOST = "https://graph.facebook.com";
/** Version de repli si WHATSAPP_API_VERSION n'est pas renseignée. Volontairement
 *  une version stable connue, pas la dernière annoncée : à ajuster via l'env. */
const DEFAULT_API_VERSION = "v21.0";
const REQUEST_TIMEOUT_MS = 15_000;

/** Erreur remontée telle quelle au client, avec un code HTTP exploitable et,
 *  éventuellement, le code d'erreur Meta pour le journal (jamais de secret). */
export class WhatsAppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly metaCode?: number,
  ) {
    super(message);
    this.name = "WhatsAppError";
  }
}

export interface MetaConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
  businessAccountId?: string;
  appSecret?: string;
}

function normalizeApiVersion(raw: string | undefined): string {
  const v = raw?.trim();
  if (!v) return DEFAULT_API_VERSION;
  return v.startsWith("v") ? v : `v${v}`;
}

/** Configuration minimale pour ENVOYER : jeton d'accès + Phone Number ID.
 *  `null` si l'une manque — les routes renvoient alors une 503 explicite. */
export function getConfig(): MetaConfig | null {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!accessToken || !phoneNumberId) return null;

  return {
    accessToken,
    phoneNumberId,
    apiVersion: normalizeApiVersion(process.env.WHATSAPP_API_VERSION),
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || undefined,
    appSecret: process.env.META_APP_SECRET?.trim() || undefined,
  };
}

function requireConfig(): MetaConfig {
  const config = getConfig();
  if (!config) {
    throw new WhatsAppError(
      "WhatsApp non configuré. Renseigner WHATSAPP_ACCESS_TOKEN et WHATSAPP_PHONE_NUMBER_ID (voir README).",
      503,
    );
  }
  return config;
}

/** Code de langue Meta pour la langue applicative. Surchargeable par l'env, car
 *  Meta impose que le code corresponde EXACTEMENT à celui du modèle approuvé
 *  (ex. « fr » ou « ar », parfois « fr_FR »). */
export function metaLanguageCode(lang: MessageLanguage): string {
  if (lang === "ar") return process.env.WHATSAPP_TEMPLATE_LANG_AR?.trim() || "ar";
  return process.env.WHATSAPP_TEMPLATE_LANG_FR?.trim() || "fr";
}

/** Nom du modèle Meta approuvé pour un modèle d'alerte, ou `null` s'il n'est pas
 *  configuré. On ne devine JAMAIS un nom : sans configuration, l'envoi échoue. */
export function resolveTemplateName(id: AlertTemplateId): string | null {
  return process.env[META_TEMPLATE_CONFIG[id].envKey]?.trim() || null;
}

/** Liste des modèles d'alerte effectivement configurés (nom Meta présent). */
export function getConfiguredTemplates(): AlertTemplateId[] {
  return (Object.keys(META_TEMPLATE_CONFIG) as AlertTemplateId[]).filter(
    (id) => resolveTemplateName(id) !== null,
  );
}

export function hasWebhookVerifyToken(): boolean {
  return Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim());
}

/** Vérifie la signature d'un événement webhook Meta (`X-Hub-Signature-256`).
 *
 *  Meta signe le corps BRUT (octets exacts reçus) avec l'App Secret en HMAC
 *  SHA-256. On ne fait donc jamais confiance à une POST arbitraire :
 *   - App Secret non configuré → impossible de vérifier → refus.
 *   - en-tête absent/malformé → refus.
 *   - comparaison en temps constant pour éviter les fuites par timing. */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appSecret) {
    console.error("[whatsapp] webhook refusé : META_APP_SECRET non configuré, signature invérifiable.");
    return false;
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.slice("sha256=".length);

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

/** Compare le jeton de vérification du webhook (requête GET de Meta) en temps
 *  constant. `false` si le jeton n'est pas configuré. */
export function verifyWebhookToken(provided: string | null): boolean {
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim();
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Masque un identifiant pour un affichage sans fuite (garde les 4 derniers). */
export function maskId(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "•".repeat(trimmed.length);
  return `${"•".repeat(Math.min(6, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

/** Traduit une erreur Meta en message court et code HTTP exploitable côté
 *  interface. On ne renvoie jamais la réponse brute ni le jeton. Références :
 *  https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes */
function mapMetaError(code: number | undefined, fallback: string): { message: string; status: number } {
  switch (code) {
    case 190:
      // Jeton invalide/expiré : problème de configuration serveur, pas de session
      // navigateur — d'où 502 plutôt que 401.
      return { message: "Jeton d'accès WhatsApp invalide ou expiré. Vérifier la configuration serveur.", status: 502 };
    case 200:
    case 10:
      return { message: "Permissions WhatsApp insuffisantes pour ce numéro. Vérifier la configuration serveur.", status: 502 };
    case 131030:
      return { message: "Ce numéro n'est pas autorisé à recevoir des messages (liste des destinataires de test).", status: 422 };
    case 131026:
      return { message: "Le destinataire ne peut pas recevoir ce message WhatsApp.", status: 422 };
    case 131047:
    case 131051:
      return {
        message:
          "Fenêtre de service client fermée : un message libre n'est possible que si la famille a écrit à l'école dans les dernières 24 h. Utiliser un modèle approuvé.",
        status: 422,
      };
    case 132000:
    case 132001:
      return { message: "Modèle WhatsApp introuvable ou non approuvé pour ce numéro.", status: 422 };
    case 132005:
    case 132007:
    case 132012:
    case 132015:
    case 132016:
      return { message: "Le modèle WhatsApp est refusé, en pause ou ses variables ne correspondent pas.", status: 422 };
    case 130429:
    case 131056:
    case 80007:
      return { message: "Limite d'envoi WhatsApp atteinte. Réessayer un peu plus tard.", status: 429 };
    case 100:
      return { message: "Requête WhatsApp invalide (numéro ou paramètres). Vérifier le destinataire.", status: 422 };
    case 131000:
    case 133000:
      return { message: "Service WhatsApp momentanément indisponible côté Meta. Réessayer.", status: 502 };
    default:
      return { message: fallback, status: 502 };
  }
}

interface MetaErrorShape {
  error?: { message?: string; code?: number; type?: string; error_subcode?: number };
}

async function graphRequest<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  const config = requireConfig();
  const { method = "GET", body } = init;

  let response: Response;
  try {
    response = await fetch(`${GRAPH_HOST}/${config.apiVersion}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new WhatsAppError(
      timedOut ? "Meta n'a pas répondu à temps." : "Service WhatsApp de Meta injoignable.",
      503,
    );
  }

  const payload = (await response.json().catch(() => null)) as (T & MetaErrorShape) | null;

  if (!response.ok) {
    const metaCode = payload?.error?.code;
    const { message, status } = mapMetaError(
      metaCode,
      `Meta a répondu ${response.status}.`,
    );
    // Journal serveur SANS secret : code + type Meta suffisent au diagnostic.
    console.error(
      `[whatsapp] Meta API ${response.status} (code=${metaCode ?? "?"}, type=${payload?.error?.type ?? "?"})`,
    );
    throw new WhatsAppError(message, status, metaCode);
  }

  return payload as T;
}

export interface SendResult {
  /** identifiant Meta du message (wamid.…) */
  messageId: string;
}

interface MetaSendResponse {
  messages?: Array<{ id: string }>;
  contacts?: Array<{ wa_id: string }>;
}

function firstMessageId(res: MetaSendResponse): string {
  const id = res.messages?.[0]?.id;
  if (!id) throw new WhatsAppError("Réponse Meta sans identifiant de message.", 502);
  return id;
}

/** Envoie un message TEXTE libre. Meta ne l'accepte que dans une fenêtre de
 *  service client ouverte ; hors fenêtre, l'appel échoue avec un code 131047.
 *  Un retour sans erreur signifie « accepté par Meta », pas « remis ». */
export async function sendTextMessage(to: string, text: string): Promise<SendResult> {
  const res = await graphRequest<MetaSendResponse>(`/${requireConfig().phoneNumberId}/messages`, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: text, preview_url: false },
    },
  });
  return { messageId: firstMessageId(res) };
}

export interface TemplateSend {
  templateId: WhatsAppTemplateId;
  variables: string[];
  language: MessageLanguage;
}

/** Envoie un message MODÈLE approuvé par Meta — le seul chemin autorisé pour un
 *  message d'entreprise proactif (alertes de solde/inscription). Échoue de façon
 *  explicite si le nom de modèle n'est pas configuré. */
export async function sendTemplateMessage(to: string, msg: TemplateSend): Promise<SendResult> {
  if (!isAlertTemplate(msg.templateId)) {
    throw new WhatsAppError("« Message libre » n'est pas un modèle Meta ; utiliser sendTextMessage.", 400);
  }

  const name = resolveTemplateName(msg.templateId);
  if (!name) {
    const { envKey } = META_TEMPLATE_CONFIG[msg.templateId];
    throw new WhatsAppError(
      `Modèle WhatsApp « ${msg.templateId} » non configuré. Renseigner ${envKey} avec le nom du modèle approuvé par Meta.`,
      503,
    );
  }

  const components =
    msg.variables.length > 0
      ? [
          {
            type: "body",
            parameters: msg.variables.map((text) => ({ type: "text", text })),
          },
        ]
      : [];

  const res = await graphRequest<MetaSendResponse>(`/${requireConfig().phoneNumberId}/messages`, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: { name, language: { code: metaLanguageCode(msg.language) }, components },
    },
  });
  return { messageId: firstMessageId(res) };
}

/** Marque un message entrant comme lu (accusé « lu » côté famille). Optionnel :
 *  utilisé par le webhook, sans jamais bloquer son acquittement. */
export async function markMessageAsRead(messageId: string): Promise<void> {
  await graphRequest<{ success?: boolean }>(`/${requireConfig().phoneNumberId}/messages`, {
    method: "POST",
    body: { messaging_product: "whatsapp", status: "read", message_id: messageId },
  });
}

export interface PhoneNumberInfo {
  displayPhoneNumber: string | null;
  verifiedName: string | null;
}

/** Lit les infos publiques du numéro (affichage + nom vérifié) — sert à
 *  confirmer, dans les Paramètres, que le jeton et le numéro sont valides. */
export async function getPhoneNumberInfo(): Promise<PhoneNumberInfo> {
  const config = requireConfig();
  const res = await graphRequest<{ display_phone_number?: string; verified_name?: string }>(
    `/${config.phoneNumberId}?fields=display_phone_number,verified_name`,
  );
  return {
    displayPhoneNumber: res.display_phone_number ?? null,
    verifiedName: res.verified_name ?? null,
  };
}
