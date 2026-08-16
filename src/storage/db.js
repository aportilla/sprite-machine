// ---------------------------------------------------------------------------
// The document store: a small promise wrapper over IndexedDB, in the project's
// zero-dependency spirit. One database (`sprite-machine`, version 1), one
// object store (`docs`, keyPath `id`). A record is `{id, png}` — the PNG bytes
// ARE the document (lib/png-chunks.js) — plus rebuildable listing caches
// (name, timestamps, icon data-URI, atlas dims) denormalized for a fast boot
// listing; on any disagreement the chunk wins.
//
// This module is a LEAF the `files` slice takes by injection, so the slice
// stays Node-testable against an in-memory stub. Every method returns a
// promise and rejects on IndexedDB failure (Safari private mode included) —
// the slice degrades to `available: false` and the app runs on without Save.
// ---------------------------------------------------------------------------

const DB_NAME = 'sprite-machine';
const DB_VERSION = 1;
const DOCS = 'docs';

/** @typedef {{id: string, png: Uint8Array, name: string, createdAt: number,
 *             modifiedAt: number, icon: string|null, w: number, h: number}} DocRecord */

const reqToPromise = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DOCS)) {
        db.createObjectStore(DOCS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

/**
 * The storage surface the `files` slice consumes (its Node tests stub this
 * exact shape with a Map). Lazy: the DB opens on first use, and a failed open
 * is retried on the next call rather than latched.
 */
export function createDocStorage() {
  /** @type {Promise<IDBDatabase>|null} */
  let dbPromise = null;
  const db = () => {
    dbPromise ??= openDb().catch((err) => {
      dbPromise = null; // don't latch a transient failure
      throw err;
    });
    return dbPromise;
  };

  const run = async (mode, fn) => {
    const store = (await db()).transaction(DOCS, mode).objectStore(DOCS);
    return reqToPromise(fn(store));
  };

  return {
    /** Every record, in insertion-key order. @returns {Promise<DocRecord[]>} */
    list: () => run('readonly', (s) => s.getAll()),
    /** @param {string} id @returns {Promise<DocRecord|undefined>} */
    get: (id) => run('readonly', (s) => s.get(id)),
    /** @param {DocRecord} record */
    put: (record) => run('readwrite', (s) => s.put(record)),
    /** @param {string} id */
    remove: (id) => run('readwrite', (s) => s.delete(id)),
  };
}

/** The real storage, or null where IndexedDB doesn't even exist. (A present
 *  but broken IndexedDB — private modes — surfaces as rejections instead,
 *  which the files slice degrades on.) */
export function createStorageIfAvailable() {
  try {
    return typeof indexedDB === 'undefined' ? null : createDocStorage();
  } catch {
    return null;
  }
}
