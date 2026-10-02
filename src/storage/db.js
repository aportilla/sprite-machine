// The IndexedDB database `sprite-machine`, as a promise wrapper. Its `docs`
// store is the Sprite Editor's sheet store: `{id, png}` records keyed by the
// catalog item's id (state/sheets.js). The catalog itself is the kit's, in a
// database of its own.
//
// Records from before the catalog carry the listing the library kept (name,
// times, icon, dims, folder) beside their bytes, and the `folders` and `texts`
// stores hold the rest of that library. The conversion reads all three once
// (state/legacy.js); nothing writes to them.
//
// The database opens at the profile's own version. Without a `docs` store it
// reopens one version up and the upgrade handler creates it. Opening at a
// fixed version throws VersionError on a profile that is already higher.
//
// Every method rejects on IndexedDB failure. A blocked open waits for the
// other tab to close its connection. Each connection closes itself on
// versionchange, and the next call reopens.

const DB_NAME = 'sprite-machine';
const DOCS = 'docs';
const FOLDERS = 'folders';
const TEXTS = 'texts';

/** @typedef {{id: string, png: Uint8Array}} SheetRecord */

const reqToPromise = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });

/** Opens the database at `version`, or at the profile's own version when
 *  undefined. The upgrade handler creates the `docs` store.
 *  @param {number|undefined} version @param {() => void} onVersionChange
 *  @returns {Promise<IDBDatabase>} */
function openAt(version, onVersionChange) {
  return new Promise((resolve, reject) => {
    const req =
      version == null ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DOCS))
        db.createObjectStore(DOCS, { keyPath: 'id' });
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

/** Opens the database, reopening one version up if `docs` is missing.
 *  @param {() => void} onVersionChange  called before this connection closes
 *  for another connection's upgrade */
async function openDb(onVersionChange) {
  let db = await openAt(undefined, onVersionChange);
  if (!db.objectStoreNames.contains(DOCS)) {
    const next = db.version + 1;
    db.close();
    db = await openAt(next, onVersionChange);
  }
  return db;
}

/**
 * The sheet store, with the conversion's read of the old library. The
 * database opens on first use. A failed open is retried on the next call.
 */
export function createSheetStore() {
  /** @type {Promise<IDBDatabase>|null} */
  let dbPromise = null;
  const db = () => {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB is unavailable'));
    }
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
  /** Every record of a store, or none where the profile never had it. */
  const all = async (storeName) => {
    const conn = await db();
    if (!conn.objectStoreNames.contains(storeName)) return [];
    return reqToPromise(
      conn.transaction(storeName, 'readonly').objectStore(storeName).getAll()
    );
  };

  return {
    /** @param {string} id @returns {Promise<SheetRecord|undefined>} */
    get: (id) => run(DOCS, 'readonly', (s) => s.get(id)),
    /** @param {SheetRecord} record */
    put: (record) => run(DOCS, 'readwrite', (s) => s.put(record)),
    /** @param {string} id */
    remove: (id) => run(DOCS, 'readwrite', (s) => s.delete(id)),
    /** The library as it stood before the catalog: every record of `docs`,
     *  `folders` and `texts`. */
    async readLibrary() {
      return {
        docs: await all(DOCS),
        folders: await all(FOLDERS),
        texts: await all(TEXTS),
      };
    },
  };
}
