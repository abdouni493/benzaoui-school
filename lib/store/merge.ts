/**
 * Fusion des lignes relues avec celles déjà affichées.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * Chaque écran lit le store et recalcule ses totaux quand une table change —
 * « change » voulant dire, pour React, « n'est plus le même objet ». Relire une
 * table, même identique, fabriquait des objets neufs : chaque rechargement
 * faisait tout recalculer et tout redessiner, écran par écran, carte par carte.
 *
 * Ici, une ligne qui n'a pas bougé GARDE son objet, et une table dont aucune
 * ligne n'a bougé garde son tableau. Un scan qui débite un élève ne redessine
 * plus que ce qui dépend de cet élève.
 *
 * Fonctions pures, testées dans tests/store-merge.test.ts.
 */

/** Égalité de valeurs JSON, indifférente à l'ordre des clés. Une clé absente
 *  et une clé à `undefined` sont la même chose (c'est ce que fait JSON). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!sameValue(a[i], b[i])) return false;
    }
    return true;
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  let aCount = 0;
  for (const k in ao) {
    if (ao[k] === undefined) continue;
    aCount++;
    if (!sameValue(ao[k], bo[k])) return false;
  }
  let bCount = 0;
  for (const k in bo) {
    if (bo[k] !== undefined) bCount++;
  }
  return aCount === bCount;
}

/**
 * Remplace une table ENTIÈRE par sa relecture, en gardant les objets qui n'ont
 * pas changé. Rend `prev` lui-même quand rien n'a bougé (ni contenu, ni ordre).
 *
 * `keep` : clés à conserver telles qu'affichées même si la relecture ne les
 * contient pas — une ligne tout juste ajoutée dont l'écriture n'est pas encore
 * confirmée ne doit pas clignoter.
 */
export function reconcileRows<T>(
  prev: readonly T[],
  next: readonly T[],
  keyOf: (row: T) => string,
  keep?: (key: string) => boolean,
): T[] {
  const prevByKey = new Map<string, T>();
  for (const row of prev) prevByKey.set(keyOf(row), row);

  const seen = new Set<string>();
  let changed = prev.length !== next.length;
  const out: T[] = [];
  for (let i = 0; i < next.length; i++) {
    const row = next[i];
    const key = keyOf(row);
    // Une relecture paginée peut rendre deux fois la même ligne : une seule compte.
    if (seen.has(key)) {
      changed = true;
      continue;
    }
    seen.add(key);
    // Une ligne en cours d'écriture garde sa version locale.
    if (keep?.(key) && prevByKey.has(key)) {
      const local = prevByKey.get(key) as T;
      if (!changed && prev[out.length] !== local) changed = true;
      out.push(local);
      continue;
    }
    const old = prevByKey.get(key);
    if (old !== undefined && sameValue(old, row)) {
      if (!changed && prev[out.length] !== old) changed = true;
      out.push(old);
    } else {
      changed = true;
      out.push(row);
    }
  }

  if (keep) {
    for (const row of prev) {
      const key = keyOf(row);
      if (!seen.has(key) && keep(key)) {
        out.push(row);
        changed = true;
      }
    }
  }

  return changed ? out : (prev as T[]);
}

/**
 * Applique un DELTA : les lignes modifiées ou créées, et les clés supprimées.
 *
 * Une ligne déjà présente reste à sa place (l'ordre affiché ne saute pas), une
 * ligne nouvelle s'ajoute à la fin — exactement comme un `push`. Une clé qui
 * figure à la fois dans les lignes et dans les suppressions EXISTE : elle a été
 * recréée après sa suppression, dans le même intervalle.
 *
 * `skip` : clés dont une écriture locale est en cours. Le serveur ne les a pas
 * encore reçues ; les écraser avec son ancienne version ferait revenir en
 * arrière ce que l'écran vient d'afficher.
 */
export function applyRowDelta<T>(
  prev: readonly T[],
  upserts: readonly T[],
  deletedKeys: ReadonlySet<string>,
  keyOf: (row: T) => string,
  skip?: (key: string) => boolean,
): T[] {
  if (upserts.length === 0 && deletedKeys.size === 0) return prev as T[];

  const incoming = new Map<string, T>();
  for (const row of upserts) {
    const key = keyOf(row);
    if (skip?.(key)) continue;
    incoming.set(key, row);
  }

  let changed = false;
  const out: T[] = [];
  for (const old of prev) {
    const key = keyOf(old);
    const fresh = incoming.get(key);
    if (fresh !== undefined) {
      incoming.delete(key);
      if (sameValue(old, fresh)) {
        out.push(old);
      } else {
        out.push(fresh);
        changed = true;
      }
      continue;
    }
    if (deletedKeys.has(key) && !skip?.(key)) {
      changed = true;
      continue;
    }
    out.push(old);
  }
  for (const fresh of incoming.values()) {
    out.push(fresh);
    changed = true;
  }
  return changed ? out : (prev as T[]);
}

/** Petite empreinte d'une chaîne (djb2) — pour dater le format d'un cache. */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * Découpe l'espace des UUID en `parts` tranches contiguës, par leur premier
 * chiffre hexadécimal : chaque tranche se lit en parallèle des autres, et
 * aucune ligne ne peut tomber entre deux. `parts` est ramené à 1, 2, 4, 8 ou 16.
 *
 * Rend les bornes [basse incluse, haute exclue] ; `undefined` = pas de borne.
 */
export function uuidPartitions(parts: number): Array<{ from?: string; to?: string }> {
  const allowed = [1, 2, 4, 8, 16];
  const n = allowed.reduce((best, p) => (p <= Math.max(1, parts) ? p : best), 1);
  const step = 16 / n;
  const bound = (digit: number) => `${digit.toString(16)}0000000-0000-0000-0000-000000000000`;
  const out: Array<{ from?: string; to?: string }> = [];
  for (let i = 0; i < n; i++) {
    out.push({
      from: i === 0 ? undefined : bound(i * step),
      to: i === n - 1 ? undefined : bound((i + 1) * step),
    });
  }
  return out;
}
