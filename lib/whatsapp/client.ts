import "server-only";

/** Client HTTP de la passerelle OpenWA (https://github.com/rmyndharis/OpenWA).
 *
 *  OpenWA tourne comme un service séparé — il n'est pas embarqué dans
 *  l'application. Voir openwa/README.md pour la mise en route.
 *  La clé API ne quitte jamais le serveur : tous les appels partent des route
 *  handlers app/api/whatsapp/*. */

import type { SessionStatus } from "./types";

export type { SessionStatus };

export interface WhatsAppConfig {
  baseUrl: string;
  apiKey: string;
  sessionId: string;
}

/** Erreur remontée telle quelle au client, avec un code HTTP exploitable. */
export class WhatsAppError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WhatsAppError";
  }
}

export function getConfig(): WhatsAppConfig | null {
  const baseUrl = process.env.OPENWA_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.OPENWA_API_KEY?.trim();
  const sessionId = process.env.OPENWA_SESSION_ID?.trim();

  if (!baseUrl || !apiKey || !sessionId) return null;
  return { baseUrl, apiKey, sessionId };
}

/** Config ou erreur 503 explicite — évite de dupliquer ce test dans chaque route. */
function requireConfig(): WhatsAppConfig {
  const config = getConfig();
  if (!config) {
    throw new WhatsAppError(
      "Passerelle WhatsApp non configurée. Renseigner OPENWA_BASE_URL, OPENWA_API_KEY et OPENWA_SESSION_ID (voir openwa/README.md).",
      503,
    );
  }
  return config;
}

/** Extrait un message lisible de la réponse d'erreur NestJS d'OpenWA, dont le
 *  champ `message` est une chaîne ou un tableau de messages de validation. */
function extractError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.join(", ");
  }
  return fallback;
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const config = requireConfig();
  const { method = "GET", body, timeoutMs = 20_000 } = init;

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/api${path}`, {
      method,
      headers: {
        "X-API-Key": config.apiKey,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new WhatsAppError(
      timedOut
        ? "La passerelle WhatsApp n'a pas répondu à temps."
        : "Passerelle WhatsApp injoignable. Vérifier qu'elle est démarrée et que OPENWA_BASE_URL est correct.",
      503,
    );
  }

  const payload = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    throw new WhatsAppError(
      extractError(payload, `La passerelle WhatsApp a répondu ${response.status}.`),
      // 401/403 viennent de la clé API du serveur, pas de l'utilisateur : les
      // renvoyer tels quels ferait croire au navigateur que sa session a expiré.
      response.status === 401 || response.status === 403 ? 502 : response.status,
    );
  }

  return payload as T;
}

export interface SessionInfo {
  id: string;
  name: string;
  status: SessionStatus;
  /** numéro lié, en chiffres bruts — renseigné une fois le QR code scanné */
  phone?: string | null;
  /** nom d'affichage WhatsApp du compte lié */
  pushName?: string | null;
  lastError?: string | null;
}

export async function getSession(): Promise<SessionInfo> {
  const { sessionId } = requireConfig();
  return request<SessionInfo>(`/sessions/${sessionId}`);
}

export interface QrCode {
  /** PNG en data URL, directement affichable dans un <img> */
  qrCode: string;
  status: SessionStatus;
}

export async function getQrCode(): Promise<QrCode> {
  const { sessionId } = requireConfig();
  return request<QrCode>(`/sessions/${sessionId}/qr`);
}

/** Démarre la session (nécessaire après un `stop`, ou au premier lancement). */
export async function startSession(): Promise<SessionInfo> {
  const { sessionId } = requireConfig();
  return request<SessionInfo>(`/sessions/${sessionId}/start`, { method: "POST" });
}

export interface SendTextResult {
  messageId: string;
  timestamp: number;
}

/** Envoie un message texte.
 *
 *  Un retour sans erreur signifie « accepté par la passerelle », pas
 *  « reçu par le destinataire » : WhatsApp n'accuse la délivrance
 *  qu'ensuite, de façon asynchrone. */
export async function sendText(chatId: string, text: string): Promise<SendTextResult> {
  const { sessionId } = requireConfig();
  return request<SendTextResult>(`/sessions/${sessionId}/messages/send-text`, {
    method: "POST",
    body: { chatId, text },
  });
}

export interface ContactCheck {
  exists: boolean;
  whatsappId?: string;
}

/** Vérifie qu'un numéro est bien inscrit sur WhatsApp avant d'écrire dessus. */
export async function checkContact(msisdn: string): Promise<ContactCheck> {
  const { sessionId } = requireConfig();
  return request<ContactCheck>(`/sessions/${sessionId}/contacts/check/${msisdn}`, {
    timeoutMs: 15_000,
  });
}
