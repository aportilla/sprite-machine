// ---------------------------------------------------------------------------
// `files` slice — the saved-document layer: the listing of every stored doc,
// which one is open (`currentId`; null = untitled), its display name, and the
// dirty flag. Pure actions over `createStore`, Node-tested with injected
// dependencies — the browser bits (IndexedDB via storage/db.js, PNG
// encode/decode via image-io.js, icon rendering) arrive through `init()` at
// boot, so this module imports nothing it can't run under Node.
//
// THE DOCUMENT IS THE PNG (lib/png-chunks.js): a save encodes the drained
// atlas, splices the metadata text chunks (Title / Creation Time / Software /
// sprite-machine:transforms — the last only when non-identity), and stores
// those bytes; an open reads the chunks back and hands the pixels to
// doc.loadAtlas. The record's name/icon/dims fields are declared CACHE, never
// truth — the chunk wins on any disagreement.
//
// DIRTY TRACKING rides the doc's own channels: any live stroke or structural
// change marks dirty; a wholesale load (the sheet generation moved) marks
// clean — and, unless this slice itself is doing the loading (an `open()`),
// resets the identity to untitled, which is exactly what a sample pick or a
// dropped file should do. Loaders then call `adoptUntitled(name)` to give the
// fresh untitled doc its display name.
// ---------------------------------------------------------------------------

import { createStore } from './store.js';
import { readTextChunks, setTextChunks } from '../lib/png-chunks.js';

export const UNTITLED = 'untitled';
// The Software chunk value — doubles as the document-schema marker.
export const SOFTWARE = 'sprite-machine 1';

// Keyword of the one custom chunk (per-view rot/flip for imported
// unconventional sheets; editor-authored docs never need it).
const TRANSFORMS_KEY = 'sprite-machine:transforms';

/** "Cargo Ship" -> "cargo-ship.png" (the export filename). */
export const docFilename = (name) => {
  const slug = (name || UNTITLED)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || UNTITLED}.png`;
};

/**
 * @param {{
 *   storage: {list(): Promise<any[]>, get(id: string): Promise<any>,
 *             put(r: any): Promise<any>, remove(id: string): Promise<any>}|null,
 *   doc: ReturnType<typeof import('./doc.js').createDoc>,
 *   encodeAtlas: (img: object) => Promise<Uint8Array>,
 *   decodeAtlas: (bytes: Uint8Array) => Promise<object>,
 *   makeIcon?: (docState: object) => Promise<string|null>,
 *   now?: () => number,
 *   newId?: () => string,
 * }|null} [deps]  Injected at construction (tests) or via init() (the app).
 */
export function createFiles(deps = null) {
  const store = createStore({
    // Storage reachability: false until a refresh() succeeds, so a broken
    // private-mode IndexedDB reads as "Save unavailable", not a crash.
    available: false,
    /** @type {{id:string,name:string,createdAt:number,modifiedAt:number,icon:string|null,w:number,h:number}[]} */
    list: [],
    /** @type {string|null} null = untitled (exists only in memory) */
    currentId: null,
    currentName: UNTITLED,
    dirty: false,
  });

  let d = deps;
  let adopting = false; // an open() drives the current loadAtlas — keep identity
  let lastSheet = 0;
  /** @type {(() => void)[]} */
  let unsubs = [];

  function wire() {
    for (const u of unsubs) u();
    unsubs = [];
    if (!d?.doc) return;
    lastSheet = d.doc.get().sheet;
    unsubs.push(
      d.doc.subscribe((s) => {
        if (s.sheet !== lastSheet) {
          lastSheet = s.sheet;
          // A wholesale load: clean, and — unless we are the loader — a fresh
          // untitled identity (sample pick, dropped file, File → New).
          store.patch(
            adopting
              ? { dirty: false }
              : { currentId: null, currentName: UNTITLED, dirty: false }
          );
        } else {
          // A structural change to the SAME sheet (resize, replace-all).
          store.patch({ dirty: true });
        }
      }),
      d.doc.onLive(() => store.patch({ dirty: true }))
    );
  }
  if (d) wire();

  const now = () => (d?.now ?? Date.now)();
  const newId = () => (d?.newId ? d.newId() : crypto.randomUUID());

  // The metadata chunks a save writes. `createdAt` persists across saves via
  // the record (first save stamps it); transforms only when non-identity.
  function metaChunks(name, createdAt, transforms) {
    return {
      Title: name,
      'Creation Time': new Date(createdAt).toISOString(),
      Software: SOFTWARE,
      [TRANSFORMS_KEY]:
        transforms && Object.keys(transforms).length ? JSON.stringify(transforms) : null,
    };
  }

  // Encode the CURRENT doc (drained first) into finished document bytes.
  async function encodeCurrent(name, createdAt) {
    d.doc.drain();
    const state = d.doc.get();
    const bytes = await d.encodeAtlas(state.atlasImage);
    return setTextChunks(bytes, metaChunks(name, createdAt, state.transforms));
  }

  const api = {
    store,
    get: store.get,
    subscribe: store.subscribe,

    /** Late dependency injection (the app's boot path; tests construct with
     *  deps instead). Re-wires cleanly, so an HMR re-init can't double up. */
    init(realDeps) {
      d = realDeps;
      wire();
    },

    /** HMR teardown: drop this instance's doc subscriptions. */
    dispose() {
      for (const u of unsubs) u();
      unsubs = [];
    },

    /** Re-read the listing from storage; resolves availability as a side
     *  effect (success ⇒ true, failure/absence ⇒ false). */
    async refresh() {
      if (!d?.storage) {
        store.patch({ available: false, list: [] });
        return;
      }
      try {
        const records = await d.storage.list();
        const list = records
          .map(({ id, name, createdAt, modifiedAt, icon, w, h }) => ({
            id,
            name,
            createdAt,
            modifiedAt,
            icon: icon ?? null,
            w,
            h,
          }))
          .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
        store.patch({ available: true, list });
      } catch {
        store.patch({ available: false, list: [] });
      }
    },

    /** Name the fresh untitled doc a loader just brought in (sample name,
     *  dropped file's Title chunk or filename). Identity stays untitled. */
    adoptUntitled(name) {
      store.patch({ currentName: name || UNTITLED });
    },

    /**
     * Open a stored document: decode its pixels into the doc slice and take
     * its identity. Resolves false when the id is gone; throws on a decode
     * failure (the caller surfaces it).
     * @param {string} id
     */
    async open(id) {
      const rec = await d.storage.get(id);
      if (!rec) return false;
      const bytes = rec.png;
      /** @type {Record<string, string>} */
      let meta = {};
      try {
        meta = readTextChunks(bytes);
      } catch {
        // Not a chunk-readable PNG (shouldn't happen for our own writes) —
        // the pixels may still decode; metadata just falls back to the cache.
      }
      let transforms = {};
      if (meta[TRANSFORMS_KEY]) {
        try {
          transforms = JSON.parse(meta[TRANSFORMS_KEY]);
        } catch {
          transforms = {};
        }
      }
      const image = await d.decodeAtlas(bytes);
      adopting = true;
      try {
        d.doc.loadAtlas(image, transforms);
      } finally {
        adopting = false;
      }
      store.patch({
        currentId: id,
        currentName: meta.Title ?? rec.name ?? UNTITLED,
        dirty: false,
      });
      return true;
    },

    /**
     * Persist the current doc. An untitled doc takes `name` (the UI prompts
     * for it first) and becomes saved; a saved doc saves silently in place.
     * Resolves the record id.
     * @param {string} [name]
     */
    async saveCurrent(name) {
      const s = store.get();
      if (!d.doc.get().atlasImage) return null;
      const isNew = !s.currentId;
      const id = s.currentId ?? newId();
      const finalName = name ?? s.currentName ?? UNTITLED;
      const prev = isNew ? null : await d.storage.get(id);
      const createdAt = prev?.createdAt ?? now();
      const png = await encodeCurrent(finalName, createdAt);
      const state = d.doc.get();
      const icon = (await d.makeIcon?.(state)) ?? null;
      await d.storage.put({
        id,
        png,
        name: finalName,
        createdAt,
        modifiedAt: now(),
        icon,
        w: state.atlasImage.width,
        h: state.atlasImage.height,
      });
      store.patch({ currentId: id, currentName: finalName, dirty: false });
      await this.refresh();
      return id;
    },

    /** Save a copy as "«name» copy"; the copy becomes the open doc. */
    async duplicate() {
      const name = `${store.get().currentName} copy`;
      store.patch({ currentId: null });
      return this.saveCurrent(name);
    },

    /** Rename a stored doc BY ID (the desktop-icon path — the doc need not be
     *  open): the Title chunk is rewritten in place (a rename is metadata, so
     *  `modifiedAt` stands), and an open identity follows along. */
    async renameById(id, name) {
      const rec = await d.storage.get(id);
      if (!rec) return;
      const png = setTextChunks(rec.png, { Title: name });
      await d.storage.put({ ...rec, png, name });
      if (store.get().currentId === id) store.patch({ currentName: name });
      await this.refresh();
    },

    /** Rename the OPEN doc (the File-menu path). An untitled doc just takes
     *  the new display name. */
    async rename(name) {
      const id = store.get().currentId;
      if (!id) {
        store.patch({ currentName: name });
        return;
      }
      await this.renameById(id, name);
    },

    /** Delete a stored doc. The open doc reverts to untitled if it was the
     *  one removed (its pixels stay open — only the stored copy is gone). */
    async remove(id) {
      await d.storage.remove(id);
      if (store.get().currentId === id) {
        store.patch({ currentId: null, dirty: false });
      }
      await this.refresh();
    },

    /** Close the document: back to an untitled, clean identity. (The shell
     *  owns the window and the dirty-check dialog; this is just the state.) */
    close() {
      store.patch({ currentId: null, currentName: UNTITLED, dirty: false });
    },

    /**
     * The bytes File → Export downloads: the SAVED bytes verbatim for a
     * clean saved doc (an exported file IS the document); a fresh encode for
     * an untitled or dirty one.
     * @returns {Promise<{bytes: Uint8Array, name: string}>}
     */
    async exportCurrent() {
      const s = store.get();
      if (s.currentId && !s.dirty && d.storage) {
        const rec = await d.storage.get(s.currentId).catch(() => null);
        if (rec) return { bytes: rec.png, name: rec.name };
      }
      const bytes = await encodeCurrent(s.currentName, now());
      return { bytes, name: s.currentName };
    },

    markDirty() {
      store.patch({ dirty: true });
    },

    markClean() {
      store.patch({ dirty: false });
    },
  };
  return api;
}

// The app-wide singleton — constructed dep-less so this module stays
// Node-importable; main.js injects the real storage/codec at boot via init().
export const files = createFiles();
