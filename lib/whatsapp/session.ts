import "server-only";

/** État de la session WhatsApp et résolution de l'URL du webhook.
 *
 *  Partagé par /api/whatsapp/status (lecture seule) et /api/whatsapp/session
 *  (lecture + actions), pour qu'une seule logique décide de ce qui est exposé
 *  à l'interface — et surtout de ce qui ne l'est pas. */

import {
  WhatsAppError,
  getConfig,
  getConnectionState,
  getInstanceInfo,
  maskId,
} from "./client";
import type { WhatsAppSessionState } from "./types";

/** URL publique du webhook, dérivée UNIQUEMENT de la configuration serveur.
 *
 *  SÉCURITÉ — ne jamais construire cette URL à partir d'un en-tête de requête
 *  (`Origin`, `Host`, `X-Forwarded-Host`) : ils sont contrôlés par l'appelant.
 *  Un compte réception pourrait alors faire réenregistrer le webhook de l'école
 *  vers un serveur tiers, qui recevrait tous les numéros des familles, les
 *  statuts de remise et les messages entrants. */
export function resolveWebhookUrl(): string {
  const explicit = process.env.EVOLUTION_WEBHOOK_URL?.trim();

  const origin =
    explicit ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`
      : "") ||
    (process.env.VERCEL_URL?.trim() ? `https://${process.env.VERCEL_URL.trim()}` : "");

  if (!origin) {
    throw new WhatsAppError(
      "URL publique de l'application inconnue. Renseigner EVOLUTION_WEBHOOK_URL (ou NEXT_PUBLIC_SITE_URL) côté serveur.",
      503,
    );
  }

  const base = origin.replace(/\/+$/, "");
  // EVOLUTION_WEBHOOK_URL peut déjà porter le chemin complet : on ne le double pas.
  const url = /\/api\/whatsapp\/webhook$/.test(base) ? base : `${base}/api/whatsapp/webhook`;

  // En production la passerelle doit joindre l'application en HTTPS public :
  // un http:// signifierait une URL de poste local, injoignable depuis le VPS.
  if (process.env.NODE_ENV === "production" && !url.startsWith("https://")) {
    throw new WhatsAppError(
      `L'URL du webhook doit être en HTTPS public en production (reçu : ${url}).`,
      400,
    );
  }
  return url;
}

/** État courant de la session. Ne lève JAMAIS : une panne de passerelle doit
 *  laisser l'écran Paramètres affichable pour expliquer le problème, pas
 *  renvoyer une erreur opaque. */
export async function sessionState(): Promise<WhatsAppSessionState> {
  const config = getConfig();
  if (!config) {
    return {
      configured: false,
      state: "close",
      connected: false,
      linkedNumber: null,
      profileName: null,
      instanceMasked: null,
      baseUrlHost: null,
      webhookConfigured: false,
      error: null,
    };
  }

  let baseUrlHost: string | null = null;
  try {
    // L'hôte SEUL : jamais l'URL complète (elle peut porter un chemin), jamais
    // la clé API.
    baseUrlHost = new URL(config.baseUrl).host;
  } catch {
    baseUrlHost = null;
  }

  const base = {
    configured: true as const,
    instanceMasked: maskId(config.instance),
    baseUrlHost,
    webhookConfigured: Boolean(config.webhookToken),
  };

  try {
    const { state } = await getConnectionState();
    // Le numéro lié n'a de sens que sur une session ouverte.
    const info =
      state === "open" ? await getInstanceInfo() : { ownerNumber: null, profileName: null };

    return {
      ...base,
      state,
      connected: state === "open",
      linkedNumber: info.ownerNumber,
      profileName: info.profileName,
      error: null,
    };
  } catch (err) {
    return {
      ...base,
      state: "unknown",
      connected: false,
      linkedNumber: null,
      profileName: null,
      error: err instanceof WhatsAppError ? err.message : "Passerelle WhatsApp injoignable.",
    };
  }
}
