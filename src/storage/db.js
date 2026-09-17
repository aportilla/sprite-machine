// Document storage: a promise wrapper over IndexedDB. Database `sprite-machine`,
// object stores keyed by `id`:
//
// - `docs`: `{id, png}`, where the PNG bytes are the document (png-chunks.js),
//   plus listing caches (name, timestamps, icon, atlas dims). The PNG chunks win
//   on disagreement. `folder` is the containing folder's id, or null or absent
//   for the desktop.
// - `folders`: `{id, name, parent, createdAt, modifiedAt}`. `parent` is a folder
//   id, or null for the desktop.
// - `texts`: `{id, name, createdAt, modifiedAt, folder}` with either `text` or
//   `builtin`, the key of a text the app ships.
//
// The schema is STORES, with no fixed version number. The database opens at the
// profile's current version. If a store is missing, it reopens one version up and
// the upgrade handler creates it. Opening at a fixed version throws VersionError
// on a profile that is already higher.
//
// Every method rejects on IndexedDB failure, and the files slice then reports
// available: false. A blocked open waits for the other tab to close its
// connection. Each connection closes itself on versionchange, and the next call
// reopens.

const DB_NAME = 'sprite-machine';
const DOCS = 'docs';
const FOLDERS = 'folders';
const TEXTS = 'texts';
/** Every store the app needs. */
const STORES = [DOCS, FOLDERS, TEXTS];

/** @typedef {{id: string, png: Uint8Array, name: string, createdAt: number,
 *             modifiedAt: number, icon: string|null, w: number, h: number,
 *             folder?: string|null}} DocRecord */
/** @typedef {{id: string, name: string, parent: string|null,
 *             createdAt: number, modifiedAt: number}} FolderRecord */
/** @typedef {{id: string, name: string, text?: string, builtin?: string,
 *             createdAt: number, modifiedAt: number,
 *             folder?: string|null}} TextRecord */

const reqToPromise = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });

/** The stores a connection lacks. @param {IDBDatabase} db */
const missingStores = (db) => STORES.filter((s) => !db.objectStoreNames.contains(s));

/** Opens the database at `version`, or at the profile's own version when
 *  undefined. The upgrade handler creates any missing store.
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
    // Another connection holds the old version. The request completes once it
    // closes.
    req.onblocked = () => {
      console.warn(
        'sprite-machine: waiting for another tab of the app to let go of the old database schema — close or reload it'
      );
    };
  });
}

/** Opens the database, reopening one version up if a store is missing.
 *  @param {() => void} onVersionChange  called before this connection closes
 *  for another connection's upgrade */
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
 * The storage surface the files slice consumes (test/helpers.mjs memStorage
 * mirrors it). The database opens on first use. A failed open is retried on the
 * next call.
 */
export function createDocStorage() {
  /** @type {Promise<IDBDatabase>|null} */
  let dbPromise = null;
  const db = () => {
    dbPromise ??= openDb(() => {
      dbPromise = null; // reopen on the next call
    }).catch((err) => {
      dbPromise = null; // retry on the next call
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

/** The IndexedDB storage, or null where IndexedDB is undefined. A broken
 *  IndexedDB (private modes) rejects per call instead. */
export function createStorageIfAvailable() {
  try {
    return typeof indexedDB === 'undefined' ? null : createDocStorage();
  } catch {
    return null;
  }
}
