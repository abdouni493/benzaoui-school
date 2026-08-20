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
  getWebhookInfo,
  isLocalHost,
  maskId,
} from "./client";
import type { WhatsAppDiagnostics, WhatsAppSessionState } from "./types";

/** URL publique du webhook, dérivée UNIQUEMENT de la configuration serveur.
 *
 *  SÉCURITÉ — ne jamais construire cette URL à partir d'un en-tête de requête
 *  (`Origin`, `Host`, `X-Forwarded-Host`) : ils sont contrôlés par l'appelant.
 *  Un compte réception pourrait alors faire réenregistrer le webhook de l'école
 *  vers un serveur tiers, qui recevrait tous les numéros des familles, les
 *  statuts de remise et les messages entrants. */
/** Une origine recopiée du poste de développement, inutilisable en production.
 *
 *  `.env.local` pointe `EVOLUTION_WEBHOOK_URL` vers
 *  `http://host.docker.internal:3000` — l'adresse du poste de développement vue
 *  depuis le conteneur. Transférer un `.env` vers Vercel en bloc est le geste
 *  naturel, et cette ligne suivait avec le reste : « Initialiser l'instance »
 *  échouait alors en 400, sans que rien ne désigne la variable fautive.
 *
 *  En production on écarte purement et simplement une telle valeur : dériver
 *  l'adresse du domaine de l'application est toujours ce qu'on voulait. Hors
 *  production, rien n'est écarté — c'est justement là que ces adresses servent. */
export function isUnusableOrigin(raw: string | undefined | null): boolean {
  const value = raw?.trim();
  if (!value) return false;
  if (process.env.NODE_ENV !== "production") return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return true; // illisible : inutilisable de toute façon
  }
  // En production la passerelle doit joindre l'application en HTTPS public.
  return url.protocol !== "https:" || isLocalHost(url.hostname);
}

/** Nomme les variables écartées, pour que le diagnostic le dise au lieu de
 *  laisser croire à une adresse choisie au hasard. */
export function ignoredOriginVars(): string[] {
  return (["EVOLUTION_WEBHOOK_URL", "NEXT_PUBLIC_SITE_URL"] as const).filter((name) =>
    isUnusableOrigin(process.env[name]),
  );
}

export function resolveWebhookUrl(): string {
  const usable = (raw: string | undefined) =>
    raw?.trim() && !isUnusableOrigin(raw) ? raw.trim() : "";

  const origin =
    usable(process.env.EVOLUTION_WEBHOOK_URL) ||
    usable(process.env.NEXT_PUBLIC_SITE_URL) ||
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

/** Variables serveur attendues, et lesquelles manquent réellement.
 *  EVOLUTION_INSTANCE est volontairement absente de la liste : elle a une
 *  valeur par défaut, son absence n'est donc pas une anomalie. */
function missingEnv(): string[] {
  const required = ["EVOLUTION_BASE_URL", "EVOLUTION_API_KEY", "EVOLUTION_WEBHOOK_TOKEN"];
  return required.filter((name) => !process.env[name]?.trim());
}

/** Diagnostic non secret, calculé sans jamais toucher le réseau. */
function diagnose(baseUrl: string | null, note: string | null, errorCode: string | null): WhatsAppDiagnostics {
  let scheme: string | null = null;
  try {
    if (baseUrl) scheme = new URL(baseUrl).protocol.replace(":", "");
  } catch {
    scheme = null;
  }

  let webhookUrl: string | null = null;
  let webhookUrlError: string | null = null;
  try {
    webhookUrl = resolveWebhookUrl();
  } catch (err) {
    webhookUrlError =
      err instanceof WhatsAppError ? err.message : "Adresse publique de l'application inconnue.";
  }

  const ignored = ignoredOriginVars();
  const webhookUrlNote =
    ignored.length > 0
      ? `${ignored.join(" et ")} ${ignored.length > 1 ? "portent" : "porte"} une adresse locale ou non-HTTPS : ${ignored.length > 1 ? "elles sont ignorées" : "elle est ignorée"} en production.`
      : null;

  return {
    scheme,
    baseUrlNote: note,
    missingEnv: missingEnv(),
    errorCode,
    webhookUrl,
    webhookUrlError,
    webhookUrlNote,
  };
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
      webhookTokenMatches: null,
      webhookUrlOnGateway: null,
      error: null,
      diagnostics: diagnose(null, null, null),
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
    const open = state === "open";
    // Le numéro lié n'a de sens que sur une session ouverte ; le webhook
    // enregistré, lui, mérite d'être relu à ce moment précis — c'est le seul
    // endroit d'où l'on peut constater que la passerelle et l'application ne
    // partagent plus le même jeton.
    const [info, webhook] = await Promise.all([
      open ? getInstanceInfo() : Promise.resolve({ ownerNumber: null, profileName: null }),
      open ? getWebhookInfo() : Promise.resolve({ url: null, tokenMatches: null }),
    ]);

    return {
      ...base,
      state,
      connected: open,
      linkedNumber: info.ownerNumber,
      profileName: info.profileName,
      webhookTokenMatches: webhook.tokenMatches,
      webhookUrlOnGateway: webhook.url,
      error: null,
      diagnostics: diagnose(config.baseUrl, config.baseUrlNote ?? null, null),
    };
  } catch (err) {
    return {
      ...base,
      state: "unknown",
      connected: false,
      linkedNumber: null,
      profileName: null,
      webhookTokenMatches: null,
      webhookUrlOnGateway: null,
      error: err instanceof WhatsAppError ? err.message : "Passerelle WhatsApp injoignable.",
      diagnostics: diagnose(
        config.baseUrl,
        config.baseUrlNote ?? null,
        err instanceof WhatsAppError ? err.networkCode ?? null : null,
      ),
    };
  }
}
