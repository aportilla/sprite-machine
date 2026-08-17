// ---------------------------------------------------------------------------
// `files` slice — the document LIBRARY: the listing of every stored doc,
// storage reachability, and the per-document storage operations (save / load
// / rename / remove / export bytes). Pure actions over `createStore`,
// Node-tested with injected dependencies — the browser bits (IndexedDB via
// storage/db.js, PNG encode/decode via image-io.js, icon rendering) arrive
// through `init()` at boot, so this module imports nothing it can't run
// under Node.
//
// THE DOCUMENT IS THE PNG (lib/png-chunks.js): a save encodes the drained
// atlas, splices the metadata text chunks (Title / Creation Time / Software /
// sprite-machine:transforms — the last only when non-identity), and stores
// those bytes; a load reads the chunks back and hands pixels + transforms +
// name to the caller. The record's name/icon/dims fields are declared CACHE,
// never truth — the chunk wins on any disagreement.
//
// WHAT THIS SLICE DOES NOT KNOW (the multi-document split): which documents
// are open, which is active, their dirty state, or their identity — that is
// the workspace's (state/workspace.js). Every per-document operation here
// takes an explicit doc instance and identity fields; nothing reads or
// writes "the current document", because there is no such thing at this
// layer anymore.
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
  });

  let d = deps;

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

  // Encode a doc (drained first) into finished document bytes.
  async function encodeDoc(doc, name, createdAt) {
    doc.drain();
    const state = doc.get();
    const bytes = await d.encodeAtlas(state.atlasImage);
    return setTextChunks(bytes, metaChunks(name, createdAt, state.transforms));
  }

  const api = {
    store,
    get: store.get,
    subscribe: store.subscribe,

    /** Late dependency injection (the app's boot path; tests construct with
     *  deps instead). */
    init(realDeps) {
      d = realDeps;
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

    /**
     * Persist a document's pixels under an identity. `fileId: null` saves a
     * NEW record (an untitled's first save, a duplicate); an existing id
     * saves silently in place, its `createdAt` surviving. Resolves the
     * stored `{id, name}` — the caller (the workspace) applies them to
     * whatever identity it manages.
     * @param {ReturnType<typeof import('./doc.js').createDoc>} doc
     * @param {{fileId?: string|null, name?: string}} identity
     */
    async save(doc, { fileId = null, name } = {}) {
      if (!doc.get().atlasImage) return null;
      const id = fileId ?? newId();
      const finalName = name ?? UNTITLED;
      const prev = fileId ? await d.storage.get(id) : null;
      const createdAt = prev?.createdAt ?? now();
      const png = await encodeDoc(doc, finalName, createdAt);
      const state = doc.get();
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
      await this.refresh();
      return { id, name: finalName };
    },

    /**
     * Load a stored document's content: pixels, transforms, and the name the
     * chunk (or the record cache) carries. Resolves null when the id is
     * gone; throws on a decode failure (the caller surfaces it). No doc is
     * mutated here — the workspace loads the result into a context.
     * @param {string} id
     * @returns {Promise<{image: object, transforms: object, name: string}|null>}
     */
    async load(id) {
      const rec = await d.storage.get(id);
      if (!rec) return null;
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
      return { image, transforms, name: meta.Title ?? rec.name ?? UNTITLED };
    },

    /** Rename a stored doc BY ID: the Title chunk is rewritten in place (a
     *  rename is metadata, so `modifiedAt` stands). Open-context names are
     *  the workspace's to follow. */
    async renameById(id, name) {
      const rec = await d.storage.get(id);
      if (!rec) return;
      const png = setTextChunks(rec.png, { Title: name });
      await d.storage.put({ ...rec, png, name });
      await this.refresh();
    },

    /** Delete a stored doc. Open contexts that pointed at it are the
     *  workspace's to revert. */
    async remove(id) {
      await d.storage.remove(id);
      await this.refresh();
    },

    /**
     * The bytes File → Export downloads: the SAVED bytes verbatim for a
     * clean saved doc (an exported file IS the document); a fresh encode for
     * an untitled or dirty one.
     * @param {ReturnType<typeof import('./doc.js').createDoc>} doc
     * @param {{fileId?: string|null, name?: string, dirty?: boolean}} identity
     * @returns {Promise<{bytes: Uint8Array, name: string}>}
     */
    async exportBytes(doc, { fileId = null, name = UNTITLED, dirty = false } = {}) {
      if (fileId && !dirty && d.storage) {
        const rec = await d.storage.get(fileId).catch(() => null);
        if (rec) return { bytes: rec.png, name: rec.name };
      }
      const bytes = await encodeDoc(doc, name, now());
      return { bytes, name };
    },
  };
  return api;
}

// The app-wide singleton — constructed dep-less so this module stays
// Node-importable; main.js injects the real storage/codec at boot via init().
export const files = createFiles();
