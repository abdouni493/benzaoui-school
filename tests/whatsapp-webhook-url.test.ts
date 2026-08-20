import { describe, it, expect, vi, beforeEach } from "vitest";

// `session.ts` importe `server-only`, qui lève hors bundle serveur.
vi.mock("server-only", () => ({}));

import { WhatsAppError } from "@/lib/whatsapp/client";
import { ignoredOriginVars, resolveWebhookUrl } from "@/lib/whatsapp/session";

/** L'adresse que la passerelle rappellera pour livrer les statuts et les
 *  messages entrants.
 *
 *  C'est la pièce qui décide si l'hébergement de la passerelle fonctionne :
 *  la passerelle vit ailleurs que l'application (Railway, tunnel, VPS) et n'a
 *  aucun autre moyen de savoir où joindre Vercel. Une erreur ici ne casse rien
 *  visiblement — les messages partent — mais les statuts restent bloqués sur
 *  « En attente » et les réponses des parents n'arrivent jamais.
 *
 *  Deux propriétés comptent particulièrement, et sont testées ici :
 *   - le domaine de PRODUCTION l'emporte sur l'URL du déploiement courant,
 *     sinon un simple aperçu Vercel détournerait le webhook de l'école ;
 *   - l'adresse ne vient JAMAIS d'un en-tête de requête (voir le commentaire
 *     de sécurité dans session.ts) : elle est ici dérivée uniquement de
 *     l'environnement serveur. */

/** Aucune de ces variables ne doit fuiter d'un test à l'autre, ni de la machine
 *  qui exécute la suite. */
function clearOrigins() {
  vi.stubEnv("EVOLUTION_WEBHOOK_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
  vi.stubEnv("VERCEL_URL", "");
}

beforeEach(() => {
  vi.unstubAllEnvs();
  clearOrigins();
});

describe("resolveWebhookUrl — hébergement de la passerelle hors de Vercel", () => {
  it("dérive l'adresse du domaine de production Vercel", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "benzaoui-school.vercel.app");
    expect(resolveWebhookUrl()).toBe("https://benzaoui-school.vercel.app/api/whatsapp/webhook");
  });

  it("garde le domaine de production même sur un déploiement d'aperçu", () => {
    // Sans cette priorité, chaque aperçu Vercel réenregistrerait le webhook
    // vers son URL éphémère : la production cesserait de recevoir les statuts
    // dès l'aperçu supprimé, sans message d'erreur nulle part.
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "benzaoui-school.vercel.app");
    vi.stubEnv("VERCEL_URL", "benzaoui-school-git-abc123.vercel.app");
    expect(resolveWebhookUrl()).toBe("https://benzaoui-school.vercel.app/api/whatsapp/webhook");
  });

  it("se rabat sur VERCEL_URL quand le domaine de production est inconnu", () => {
    vi.stubEnv("VERCEL_URL", "benzaoui-school-git-abc123.vercel.app");
    expect(resolveWebhookUrl()).toBe(
      "https://benzaoui-school-git-abc123.vercel.app/api/whatsapp/webhook",
    );
  });

  it("préfère NEXT_PUBLIC_SITE_URL aux domaines Vercel (domaine propre à l'école)", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://ecole.benzaoui.dz");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "benzaoui-school.vercel.app");
    expect(resolveWebhookUrl()).toBe("https://ecole.benzaoui.dz/api/whatsapp/webhook");
  });

  it("laisse EVOLUTION_WEBHOOK_URL primer sur tout le reste", () => {
    vi.stubEnv("EVOLUTION_WEBHOOK_URL", "https://forcee.example");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://ecole.benzaoui.dz");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "benzaoui-school.vercel.app");
    expect(resolveWebhookUrl()).toBe("https://forcee.example/api/whatsapp/webhook");
  });

  it("ne double pas le chemin quand l'URL le porte déjà", () => {
    // Cas réel du montage local, où l'on renseigne l'adresse complète.
    vi.stubEnv("EVOLUTION_WEBHOOK_URL", "http://host.docker.internal:3000/api/whatsapp/webhook");
    expect(resolveWebhookUrl()).toBe("http://host.docker.internal:3000/api/whatsapp/webhook");
  });

  it("tolère un slash final dans l'origine configurée", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://ecole.benzaoui.dz///");
    expect(resolveWebhookUrl()).toBe("https://ecole.benzaoui.dz/api/whatsapp/webhook");
  });

  it("échoue explicitement quand aucune origine n'est configurée", () => {
    // Mieux vaut une erreur lisible dans Paramètres qu'un webhook enregistré
    // vers une adresse inventée.
    expect(() => resolveWebhookUrl()).toThrow(WhatsAppError);
    try {
      resolveWebhookUrl();
    } catch (err) {
      expect((err as WhatsAppError).status).toBe(503);
    }
  });

  it("écarte une adresse non-HTTPS en production, faute d'autre origine", () => {
    // Une passerelle hébergée ne peut pas joindre « http://localhost » : sans
    // ce garde-fou, l'enregistrement réussirait et rien ne remonterait jamais.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EVOLUTION_WEBHOOK_URL", "http://localhost:3000/api/whatsapp/webhook");
    try {
      resolveWebhookUrl();
      expect.unreachable("une URL http:// doit être écartée en production");
    } catch (err) {
      expect(err).toBeInstanceOf(WhatsAppError);
      // 503 « origine inconnue », et non plus 400 « pas en HTTPS » : la valeur
      // fautive est ignorée, il ne reste donc plus AUCUNE origine.
      expect((err as WhatsAppError).status).toBe(503);
    }
  });

  it("ignore l'adresse du poste de développement au profit du domaine Vercel", () => {
    // Le cas qui a réellement cassé la mise en service : `.env.local` transféré
    // en bloc vers Vercel, EVOLUTION_WEBHOOK_URL comprise. « Initialiser
    // l'instance » répondait 400 sans désigner la variable fautive.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EVOLUTION_WEBHOOK_URL", "http://host.docker.internal:3000/api/whatsapp/webhook");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "benzaoui-school.vercel.app");
    expect(resolveWebhookUrl()).toBe("https://benzaoui-school.vercel.app/api/whatsapp/webhook");
    expect(ignoredOriginVars()).toEqual(["EVOLUTION_WEBHOOK_URL"]);
  });

  it("écarte aussi un NEXT_PUBLIC_SITE_URL local recopié du poste", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "benzaoui-school.vercel.app");
    expect(resolveWebhookUrl()).toBe("https://benzaoui-school.vercel.app/api/whatsapp/webhook");
    expect(ignoredOriginVars()).toEqual(["NEXT_PUBLIC_SITE_URL"]);
  });

  it("n'écarte RIEN hors production : c'est là que ces adresses servent", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("EVOLUTION_WEBHOOK_URL", "http://host.docker.internal:3000/api/whatsapp/webhook");
    expect(ignoredOriginVars()).toEqual([]);
    expect(resolveWebhookUrl()).toBe("http://host.docker.internal:3000/api/whatsapp/webhook");
  });

  it("garde une origine HTTPS publique, même explicite", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EVOLUTION_WEBHOOK_URL", "https://ecole.benzaoui.dz/api/whatsapp/webhook");
    expect(ignoredOriginVars()).toEqual([]);
    expect(resolveWebhookUrl()).toBe("https://ecole.benzaoui.dz/api/whatsapp/webhook");
  });

  it("accepte une adresse http hors production (développement local)", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("EVOLUTION_WEBHOOK_URL", "http://host.docker.internal:3000");
    expect(resolveWebhookUrl()).toBe("http://host.docker.internal:3000/api/whatsapp/webhook");
  });
});
