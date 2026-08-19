import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Garde-fou de migration : plus aucune trace des transports WhatsApp
 *  abandonnés — ni l'API Cloud de Meta, ni l'ancienne passerelle OpenWA.
 *
 *  On cible des JETONS PRÉCIS, jamais le mot « meta » : le code applicatif
 *  contient légitimement `navMetaForHref`, `makeBucketMeta`, `Metadata`,
 *  `metadataBase`, `logMeta`… Un test insensible à la casse sur /meta/ ne
 *  ferait que crier au loup.
 *
 *  `supabase/migrations/` n'est volontairement PAS scanné : la migration
 *  20260819 mentionne « meta » et « wamid » à dessein, pour documenter et
 *  étiqueter les lignes d'époque. De même, la colonne `last_inbound_wamid`
 *  garde son nom historique — le mot `wamid` n'est donc pas interdit. */

const ROOTS = ["lib", "app", "components"];
const EXTRA_FILES = [".env.example", "README.md", "package.json"];
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".md", ".json"]);

function walk(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (CODE_EXT.has(path.extname(full))) acc.push(full);
  }
}

function collectFiles(): string[] {
  const cwd = process.cwd();
  const files: string[] = [];
  for (const root of ROOTS) {
    try {
      walk(path.join(cwd, root), files);
    } catch {
      /* dossier absent : rien à scanner */
    }
  }
  for (const f of EXTRA_FILES) files.push(path.join(cwd, f));
  return files;
}

const FILES = collectFiles();

/** Fichiers (chemins relatifs) où le motif apparaît encore. */
function offenders(pattern: RegExp): string[] {
  const cwd = process.cwd();
  return FILES.filter((f) => {
    try {
      return pattern.test(readFileSync(f, "utf8"));
    } catch {
      return false;
    }
  }).map((f) => path.relative(cwd, f));
}

describe("migration — aucune trace de l'API Cloud de Meta", () => {
  it("aucun appel à la Graph API de Facebook", () => {
    expect(offenders(/graph\.facebook\.com/i)).toEqual([]);
  });

  it("aucune variable d'environnement Meta ne subsiste", () => {
    expect(
      offenders(
        /META_APP_(ID|SECRET)|WHATSAPP_(ACCESS_TOKEN|PHONE_NUMBER_ID|BUSINESS_ACCOUNT_ID|WEBHOOK_VERIFY_TOKEN|API_VERSION)|WHATSAPP_TEMPLATE_/,
      ),
    ).toEqual([]);
  });

  it("aucun reste de l'API de modèles approuvés", () => {
    expect(
      offenders(/META_TEMPLATE_CONFIG|\bsendTemplateMessage\b|\bresolveTemplateName\b|\bmetaLanguageCode\b/),
    ).toEqual([]);
  });

  it("aucun reste de la vérification de signature HMAC de Meta", () => {
    expect(offenders(/x-hub-signature|verifyWebhookSignature/i)).toEqual([]);
  });
});

describe("migration — aucune trace d'OpenWA", () => {
  it("aucun fichier ne mentionne « openwa »", () => {
    expect(offenders(/openwa/i)).toEqual([]);
  });

  it("aucune variable d'environnement OPENWA_* ne subsiste", () => {
    expect(offenders(/OPENWA_(BASE_URL|API_KEY|SESSION_ID)/)).toEqual([]);
  });

  it("aucun reste de l'ancienne API de session (getQrCode / startSession)", () => {
    expect(offenders(/\bgetQrCode\b|\bstartSession\b/)).toEqual([]);
  });
});

describe("discipline server-only des identifiants Evolution", () => {
  it("aucune variable EVOLUTION_* n'est préfixée NEXT_PUBLIC_", () => {
    // Un tel préfixe exposerait la clé de la passerelle dans le bundle
    // navigateur — donc à tout visiteur du site.
    expect(offenders(/NEXT_PUBLIC_EVOLUTION/)).toEqual([]);
  });

  it("aucun composant ne LIT les secrets de la passerelle", () => {
    // On cible la lecture effective (`process.env.…`), pas la simple mention du
    // nom : le panneau Paramètres cite légitimement EVOLUTION_API_KEY dans son
    // message « non configuré », pour dire à l'administrateur quoi renseigner.
    const cwd = process.cwd();
    const leaked = FILES.filter((f) => f.startsWith(path.join(cwd, "components")))
      .filter((f) => {
        try {
          return /process\.env\.EVOLUTION_(API_KEY|WEBHOOK_TOKEN)/.test(readFileSync(f, "utf8"));
        } catch {
          return false;
        }
      })
      .map((f) => path.relative(cwd, f));
    expect(leaked).toEqual([]);
  });
});
