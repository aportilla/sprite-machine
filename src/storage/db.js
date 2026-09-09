// ---------------------------------------------------------------------------
// The document store: a small promise wrapper over IndexedDB, in the project's
// zero-dependency spirit. One database (`sprite-machine`, version 2), two
// object stores:
//
//   `docs` (keyPath `id`): a record is `{id, png}` — the PNG bytes ARE the
//   document (the engine's png-chunks.js) — plus rebuildable listing caches (name,
//   timestamps, icon data-URI, atlas dims) denormalized for a fast boot
//   listing; on any disagreement the chunk wins. And ONE field that is
//   neither chunk nor cache: `folder` — the id of the folder the document
//   sits in, or null/absent for the desktop. Where a file SITS is the
//   catalog's business, not the document's (a downloaded PNG carries none
//   of it), which is why it lives here and never in a chunk.
//
//   `folders` (keyPath `id`, version 2 — Sep 7 2026): the catalog's
//   structure, a record `{id, name, parent, createdAt, modifiedAt}`,
//   `parent` a folder id or null — the desktop is the root and has no
//   record. A v1 database upgrades in place: the store is created, the docs
//   store untouched, its records' missing `folder` reading as the desktop.
//
// This module is a LEAF the `files` slice takes by injection, so the slice
// stays Node-testable against an in-memory stub. Every method returns a
// promise and rejects on IndexedDB failure (Safari private mode included) —
// the slice degrades to `available: false` and the app runs on without Save.
// A version bump means another tab still open on the old schema blocks this
// one (`onblocked` — the same rejection path, Save unavailable until that
// tab reloads); and THIS connection closes itself on `versionchange`, so a
// tab on a newer schema is never blocked by this one — the next call
// reopens.
// ---------------------------------------------------------------------------

const DB_NAME = 'sprite-machine';
const DB_VERSION = 2;
const DOCS = 'docs';
const FOLDERS = 'folders';

/** @typedef {{id: string, png: Uint8Array, name: string, createdAt: number,
 *             modifiedAt: number, icon: string|null, w: number, h: number,
 *             folder?: string|null}} DocRecord */
/** @typedef {{id: string, name: string, parent: string|null,
 *             createdAt: number, modifiedAt: number}} FolderRecord */

const reqToPromise = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });

/** @param {() => void} onVersionChange  Called when another connection
 *  wants a newer schema: the caller drops its handle, this one closes. */
function openDb(onVersionChange) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DOCS)) {
        db.createObjectStore(DOCS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(FOLDERS)) {
        db.createObjectStore(FOLDERS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        onVersionChange();
        db.close();
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

/**
 * The storage surface the `files` slice consumes (its Node tests stub this
 * exact shape with two Maps — test/helpers.mjs memStorage). Lazy: the DB
 * opens on first use, and a failed open is retried on the next call rather
 * than latched.
 */
export function createDocStorage() {
  /** @type {Promise<IDBDatabase>|null} */
  let dbPromise = null;
  const db = () => {
    dbPromise ??= openDb(() => {
      dbPromise = null; // a newer schema elsewhere: reopen on the next call
    }).catch((err) => {
      dbPromise = null; // don't latch a transient failure
      throw err;
    });
    return dbPromise;
  };

  const run = async (storeName, mode, fn) => {
    const store = (await db()).transaction(storeName, mode).objectStore(storeName);
    return reqToPromise(fn(store));
  };

  return {
    /** Every document record, in insertion-key order. @returns {Promise<DocRecord[]>} */
    list: () => run(DOCS, 'readonly', (s) => s.getAll()),
    /** @param {string} id @returns {Promise<DocRecord|undefined>} */
    get: (id) => run(DOCS, 'readonly', (s) => s.get(id)),
    /** @param {DocRecord} record */
    put: (record) => run(DOCS, 'readwrite', (s) => s.put(record)),
    /** @param {string} id */
    remove: (id) => run(DOCS, 'readwrite', (s) => s.delete(id)),
    /** Every folder record. @returns {Promise<FolderRecord[]>} */
    listFolders: () => run(FOLDERS, 'readonly', (s) => s.getAll()),
    /** @param {FolderRecord} record */
    putFolder: (record) => run(FOLDERS, 'readwrite', (s) => s.put(record)),
    /** @param {string} id */
    removeFolder: (id) => run(FOLDERS, 'readwrite', (s) => s.delete(id)),
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
