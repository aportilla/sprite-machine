// ---------------------------------------------------------------------------
// The document store: a small promise wrapper over IndexedDB, in the project's
// zero-dependency spirit. One database (`sprite-machine`), three object
// stores:
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
//   `texts` (keyPath `id`, Sep 10 2026): the TEXT FILES — the read-me
//   documents on the desktop — a record `{id, name, text, createdAt,
//   modifiedAt, folder}`: the text IS the file, the way a document's PNG is,
//   and `folder` files it exactly as a document's does.
//
// THE SCHEMA IS THE LIST OF STORES, NOT A VERSION NUMBER (Sep 10 2026). The
// open asks for no version — a profile opens at whatever it holds (a fresh
// one is created at 1, the upgrade creating every store) — and then checks
// that every store exists; a missing one (a profile from before that store,
// or a PARTIAL upgrade) is added by reopening ONE VERSION UP, where the same
// upgrade handler creates whatever is missing. So the number only ever
// climbs by what a profile needs, no code ever asks a profile for a version
// lower than it holds (VersionError — what a tab running older code did to a
// freshly bumped profile), and a store missing for any reason is repaired at
// the next open rather than failing every listing. The case that taught it:
// the texts store's edit landed in two saves a moment apart while the user's
// tab was hot-reloading, and the tab upgraded to "version 3" with a handler
// that did not yet create the store — every open then succeeded and every
// listing failed on `transaction('texts')`, silently, as "Save unavailable"
// with no files.
//
// This module is a LEAF the `files` slice takes by injection, so the slice
// stays Node-testable against an in-memory stub. Every method returns a
// promise and rejects on IndexedDB failure (Safari private mode included) —
// the slice degrades to `available: false` and the app runs on without Save.
// An upgrade with another tab still open on the old schema raises `blocked`
// on this one — a NOTICE, not a failure (the spec's reading): the other
// tab's connection closes itself on `versionchange` (below), the upgrade
// then proceeds and this same request succeeds, so the open WAITS through
// it (rejecting there latched the session on "Save unavailable" over a block
// that had cleared a moment later). A tab that never answers (frozen) keeps
// the open pending until it is closed or reloaded; the console names the
// wait. And THIS connection closes itself on `versionchange`, so a tab on a
// newer schema is never blocked by this one — the next call reopens. A
// failed open and a repair both name themselves on the console (the slice
// swallows a rejection into `available: false`).
// ---------------------------------------------------------------------------

const DB_NAME = 'sprite-machine';
const DOCS = 'docs';
const FOLDERS = 'folders';
const TEXTS = 'texts';
/** Every store the app needs — the schema (header). */
const STORES = [DOCS, FOLDERS, TEXTS];

/** @typedef {{id: string, png: Uint8Array, name: string, createdAt: number,
 *             modifiedAt: number, icon: string|null, w: number, h: number,
 *             folder?: string|null}} DocRecord */
/** @typedef {{id: string, name: string, parent: string|null,
 *             createdAt: number, modifiedAt: number}} FolderRecord */
/** @typedef {{id: string, name: string, text: string, createdAt: number,
 *             modifiedAt: number, folder?: string|null}} TextRecord */

const reqToPromise = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });

/** The stores a connection lacks. @param {IDBDatabase} db */
const missingStores = (db) => STORES.filter((s) => !db.objectStoreNames.contains(s));

/** One open request as a promise — at the profile's own version when
 *  `version` is undefined, else at that version (an upgrade); the upgrade
 *  handler creates every store that is missing. The connection closes
 *  itself when another wants a newer schema (`onVersionChange`).
 *  @param {number|undefined} version @param {() => void} onVersionChange
 *  @returns {Promise<IDBDatabase>} */
function openAt(version, onVersionChange) {
  return new Promise((resolve, reject) => {
    const req =
      version == null ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of missingStores(db)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        onVersionChange();
        db.close();
      };
      resolve(db);
    };
    req.onerror = () => {
      const err = req.error || new Error('IndexedDB open failed');
      console.warn('sprite-machine: IndexedDB open failed —', err);
      reject(err);
    };
    // Another connection holds the old schema (header): wait for it to
    // close on its versionchange; this request completes after it.
    req.onblocked = () => {
      console.warn(
        'sprite-machine: waiting for another tab of the app to let go of the old database schema — close or reload it'
      );
    };
  });
}

/** Open the database at whatever version the profile holds, then REPAIR
 *  it if a store is missing — reopened one version up, where the upgrade
 *  creates what is missing (header: the schema is the list of stores).
 *  @param {() => void} onVersionChange  Called when another connection
 *  wants a newer schema: the caller drops its handle, this one closes. */
async function openDb(onVersionChange) {
  let db = await openAt(undefined, onVersionChange);
  const missing = missingStores(db);
  if (missing.length) {
    const next = db.version + 1;
    console.info(
      `sprite-machine: the database (version ${db.version}) lacks the ${missing.join(', ')} store — adding it as version ${next}`
    );
    db.close();
    db = await openAt(next, onVersionChange);
  }
  return db;
}

/**
 * The storage surface the `files` slice consumes (its Node tests stub this
 * exact shape with three Maps — test/helpers.mjs memStorage). Lazy: the DB
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
    /** Every text file record. @returns {Promise<TextRecord[]>} */
    listTexts: () => run(TEXTS, 'readonly', (s) => s.getAll()),
    /** @param {string} id @returns {Promise<TextRecord|undefined>} */
    getText: (id) => run(TEXTS, 'readonly', (s) => s.get(id)),
    /** @param {TextRecord} record */
    putText: (record) => run(TEXTS, 'readwrite', (s) => s.put(record)),
    /** @param {string} id */
    removeText: (id) => run(TEXTS, 'readwrite', (s) => s.delete(id)),
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
