import { defineConfig } from "vitest/config";
import path from "node:path";

/** Tests unitaires (logique pure : normalisation des numéros, résolution des
 *  alertes de solde). Volontairement isolés de la build Next : les fichiers de
 *  `tests/` sont exclus de tsconfig et d'ESLint, et Vercel ne lance que
 *  `next build`. Lancer : `npm test`. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // vitest s'exécute depuis la racine du projet (là où vit package.json).
      "@": path.resolve(process.cwd()),
    },
  },
});
