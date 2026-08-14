import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Garde-fou de migration : plus aucune trace d'OpenWA dans le code applicatif
 *  ni de variable d'environnement OPENWA_* dans la configuration. */

const ROOTS = ["lib", "app", "components"];
const EXTRA_FILES = [".env.example", "README.md", "package.json"];
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".md", ".json", ".sql"]);

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
    const full = path.join(cwd, root);
    try {
      walk(full, files);
    } catch {
      /* dossier absent : rien à scanner */
    }
  }
  for (const f of EXTRA_FILES) files.push(path.join(cwd, f));
  return files;
}

describe("migration — aucune trace d'OpenWA", () => {
  const files = collectFiles();

  it("aucun fichier ne mentionne « openwa »", () => {
    const offenders = files.filter((f) => {
      try {
        return /openwa/i.test(readFileSync(f, "utf8"));
      } catch {
        return false;
      }
    });
    expect(offenders).toEqual([]);
  });

  it("aucune variable d'environnement OPENWA_* ne subsiste", () => {
    const offenders = files.filter((f) => {
      try {
        return /OPENWA_(BASE_URL|API_KEY|SESSION_ID)/.test(readFileSync(f, "utf8"));
      } catch {
        return false;
      }
    });
    expect(offenders).toEqual([]);
  });

  it("aucun reste d'API de session WhatsApp Web (getQrCode / startSession)", () => {
    const offenders = files.filter((f) => {
      try {
        return /\bgetQrCode\b|\bstartSession\b/.test(readFileSync(f, "utf8"));
      } catch {
        return false;
      }
    });
    expect(offenders).toEqual([]);
  });
});
