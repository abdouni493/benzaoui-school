"use client";

/**
 * Copie locale des données, pour que l'application S'OUVRE sans attendre.
 *
 * Sans elle, chaque ouverture (et chaque F5) retéléchargeait les 38 tables de
 * l'école avant d'afficher quoi que ce soit. Avec elle, l'écran se remplit
 * immédiatement avec la dernière copie connue, puis la synchronisation ne
 * rapatrie que ce qui a changé depuis — quelques lignes.
 *
 * Garde-fous :
 *   · une copie n'appartient qu'au compte qui l'a faite (clé = son id) ;
 *   · elle est effacée à la déconnexion ;
 *   · elle n'est reprise que si son format correspond au code actuel et
 *     qu'elle a moins de quelques jours — sinon, chargement complet ;
 *   · IndexedDB indisponible (navigation privée, quota) : tout continue sans
 *     cache, exactement comme avant.
 */

const DB_NAME = "benzaoui-school-cache";
const STORE = "snapshots";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const tx = db.transaction(STORE, mode);
          const req = op(tx.objectStore(STORE));
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

const keyOf = (userId: string) => `snapshot:${userId}`;

export function readSnapshot<T>(userId: string): Promise<T | null> {
  return run<T>("readonly", (s) => s.get(keyOf(userId)) as IDBRequest<T>);
}

export async function writeSnapshot<T>(userId: string, value: T): Promise<void> {
  await run("readwrite", (s) => s.put(value, keyOf(userId)));
}

/** Efface TOUTES les copies — à la déconnexion, rien ne doit rester. */
export async function clearSnapshots(): Promise<void> {
  await run("readwrite", (s) => s.clear());
}
