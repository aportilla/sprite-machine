// The Sprite Editor's stored documents. A document is a catalog item of kind
// `sprite` (its name, its folder, its icon) and its PNG bytes, kept under the
// item's id in a store of `{id, png}` records. Browser dependencies (that
// store, the catalog, the PNG codec, the icon renderer) arrive through
// init(), so the module runs under Node.
//
// - A save writes the Title, Creation Time, Software,
//   sprite-machine:transforms (non-identity only), sprite-machine:ring and
//   sprite-machine:layers chunks, then the item: created at a first save,
//   its icon and size updated after.
// - The item's name is the document's. A rename in the Finder leaves the
//   bytes' Title behind until they leave: bytesOf writes it.
// - A pasted, dropped or restored PNG is stored as it came, once it decodes
//   to a sheet.

import {
  isPng,
  readTextChunks,
  setTextChunks,
  LAYERS_CHUNK,
  layersChunk,
  parseLayersChunk,
} from 'sprite-machine';
import { RING_CHUNK_KEY, ringChunk, parseRingChunk } from './ring-settings.js';
import { sheetShape } from '../lib/sheet-shape.js';
import { SPRITE } from './kinds.js';
import { UNTITLED } from './names.js';

// The Software chunk value, also the document schema marker.
export const SOFTWARE = 'sprite-machine 1';

// Chunk keyword for per-view rotation and flip on imported sheets.
const TRANSFORMS_KEY = 'sprite-machine:transforms';

/**
 * Read the document chunks from PNG bytes: Title, sprite-machine:transforms,
 * sprite-machine:ring and sprite-machine:layers. Best-effort: a non-PNG or a
 * bad chunk loses only that metadata, never the pixels.
 * @param {Uint8Array} bytes
 * @returns {{title: string|null, transforms: Record<string, object>,
 *   ring: Partial<import('./ring-settings.js').RingSettings>|null,
 *   names: string[]|null}}
 */
export function readSheetMeta(bytes) {
  /** @type {Record<string, string>} */
  let meta = {};
  if (isPng(bytes)) {
    try {
      meta = readTextChunks(bytes);
    } catch {
      meta = {};
    }
  }
  let transforms = {};
  try {
    if (meta[TRANSFORMS_KEY]) transforms = JSON.parse(meta[TRANSFORMS_KEY]);
  } catch {
    transforms = {};
  }
  return {
    title: meta.Title ?? null,
    transforms,
    ring: parseRingChunk(meta[RING_CHUNK_KEY]),
    names: parseLayersChunk(meta[LAYERS_CHUNK]),
  };
}

/**
 * @typedef {{id: string, name: string, kind: string, parent: string|null,
 *   createdAt: number, modifiedAt: number, data?: unknown}} Item
 * @typedef {{
 *   item(id: string|null|undefined): Item|null,
 *   create(input: object): Promise<Item|null>,
 *   update(id: string, data: unknown): Promise<boolean>,
 *   rename(id: string, name: string): Promise<boolean>,
 * }} SheetCatalog  What this module asks of the shell's catalog.
 * @typedef {{
 *   store: {get(id: string): Promise<{id: string, png: Uint8Array}|undefined>,
 *           put(r: {id: string, png: Uint8Array}): Promise<unknown>,
 *           remove(id: string): Promise<unknown>},
 *   catalog: SheetCatalog,
 *   encodeAtlas: (img: object) => Promise<Uint8Array>,
 *   decodeAtlas: (bytes: Uint8Array) => Promise<{width: number, height: number, data: Uint8ClampedArray}>,
 *   makeIcon?: (docState: object) => Promise<string|null>,
 *   iconFromBytes?: (bytes: Uint8Array, image: {width: number, height: number, data: Uint8ClampedArray}) => Promise<string|null>,
 *   now?: () => number,
 * }} SheetDeps
 */

/** @param {SheetDeps|null} [deps]  Passed here or later through init(). */
export function createSheets(deps = null) {
  let d = /** @type {SheetDeps} */ (deps);
  const now = () => (d?.now ?? Date.now)();
  const iso = (t) => new Date(t).toISOString();

  /** The metadata chunks a save writes. A null value removes the chunk. */
  function metaChunks(name, createdAt, state, ring) {
    const { transforms, names } = state;
    return {
      Title: name,
      'Creation Time': iso(createdAt),
      Software: SOFTWARE,
      [TRANSFORMS_KEY]:
        transforms && Object.keys(transforms).length ? JSON.stringify(transforms) : null,
      [RING_CHUNK_KEY]: ring ? ringChunk(ring) : null,
      [LAYERS_CHUNK]: layersChunk(names),
    };
  }

  async function encodeDoc(doc, name, createdAt, ring) {
    doc.drain();
    const state = doc.get();
    const bytes = await d.encodeAtlas(state.atlasImage);
    return setTextChunks(bytes, metaChunks(name, createdAt, state, ring));
  }

  /** A document's item, or null. */
  const docItem = (id) => {
    const item = d.catalog.item(id);
    return item?.kind === SPRITE ? item : null;
  };

  /** Make a document's item in `parent`, or on the desktop where `parent`
   *  refuses one (the Trash). */
  async function createItem(name, parent, data, at) {
    const input = { kind: SPRITE, name, data, at };
    const made = await d.catalog.create({ ...input, parent });
    return made ?? (parent != null ? d.catalog.create({ ...input, parent: null }) : null);
  }

  return {
    /** Sets the dependencies after construction. */
    init(realDeps) {
      d = realDeps;
    },

    /**
     * Load a stored document: pixels, transforms, ring settings (null when
     * the PNG has none), layer names (null when it has none) and the item's
     * name. Resolves null when the item is gone. Throws when the bytes are
     * missing or don't decode.
     * @param {string} id
     */
    async load(id) {
      const item = docItem(id);
      if (!item) return null;
      const rec = await d.store.get(id);
      if (!rec?.png) throw new Error('its pixels are missing');
      const { transforms, ring, names } = readSheetMeta(rec.png);
      const image = await d.decodeAtlas(rec.png);
      return { image, transforms, ring, names, name: item.name };
    },

    /**
     * Store a document's pixels. `fileId: null` makes a new item in `parent`
     * (the desktop where that refuses one); an existing id saves in place.
     * Resolves the stored `{id, name}`, or null when the doc holds nothing.
     * @param {ReturnType<typeof import('./doc.js').createDoc>} doc
     * @param {{fileId?: string|null, name?: string,
     *          ring?: import('./ring-settings.js').RingChunkSettings|null,
     *          parent?: string|null, at?: number}} identity
     *   ring: the 3D Sprite Atlas settings for the ring chunk. Null: no chunk.
     *   at: a new document's creation time. Default now.
     */
    async save(doc, { fileId = null, name, ring = null, parent = null, at } = {}) {
      if (!doc.get().atlasImage) return null;
      const prev = fileId ? docItem(fileId) : null;
      const finalName = name ?? prev?.name ?? UNTITLED;
      const createdAt = prev?.createdAt ?? at ?? now();
      const png = await encodeDoc(doc, finalName, createdAt, ring);
      const icon = (await d.makeIcon?.(doc.get())) ?? null;
      const data = { icon, size: png.byteLength };
      if (prev) {
        await d.store.put({ id: prev.id, png });
        await d.catalog.update(prev.id, data);
        if (prev.name !== finalName) await d.catalog.rename(prev.id, finalName);
        return { id: prev.id, name: finalName };
      }
      const item = await createItem(finalName, parent, data, createdAt);
      if (!item) return null;
      await d.store.put({ id: item.id, png });
      return { id: item.id, name: finalName };
    },

    /**
     * A PNG's item data as a document, `{data: {icon, size}}`, when it
     * decodes to a sheet. Otherwise `{refused}` with the decoded size when it
     * is an image that isn't a sheet, null when it doesn't decode.
     * @param {Uint8Array} bytes
     * @returns {Promise<{data: {icon: string|null, size: number}}
     *   | {refused: {width: number, height: number}|null}>}
     */
    async describe(bytes) {
      let image;
      try {
        image = await d.decodeAtlas(bytes);
      } catch {
        return { refused: null };
      }
      if (!sheetShape(image.width, image.height).tile) {
        return { refused: { width: image.width, height: image.height } };
      }
      const icon = (await d.iconFromBytes?.(bytes, image).catch(() => null)) ?? null;
      return { data: { icon, size: bytes.byteLength } };
    },

    /**
     * Store PNG bytes as they came, as a new document in `parent`, if they
     * decode to a sheet. Named `name`, else its Title chunk, else
     * `fallback`. Resolves `{item, titled}` (titled: whether the name came
     * from the bytes or the caller), or describe's `{refused}`.
     * @param {Uint8Array} bytes
     * @param {{name?: string, fallback?: string, parent?: string|null, at?: number}} [into]
     * @returns {Promise<{item: Item, titled: boolean}
     *   | {refused: {width: number, height: number}|null}>}
     */
    async storeBytes(bytes, { name, fallback = UNTITLED, parent = null, at } = {}) {
      const described = await this.describe(bytes);
      if ('refused' in described) return described;
      const title = name ?? readSheetMeta(bytes).title;
      const item = await createItem(
        title ?? fallback,
        parent,
        described.data,
        at ?? now()
      );
      if (!item) return { refused: null };
      await d.store.put({ id: item.id, png: bytes });
      return { item, titled: title != null };
    },

    /** Put bytes under an item's id as they are, for a restored document.
     *  @param {string} id  @param {Uint8Array} png */
    async putBytes(id, png) {
      await d.store.put({ id, png });
    },

    /** A stored document's PNG, its Title the item's name. Null when either
     *  is gone. @param {string} id  @returns {Promise<Uint8Array|null>} */
    async bytesOf(id) {
      const item = docItem(id);
      const rec = item ? await d.store.get(id) : null;
      if (!item || !rec?.png) return null;
      return setTextChunks(rec.png, { Title: item.name });
    },

    /** Copy a document's bytes to its copy's item, with the copy's Title and
     *  Creation Time. @param {Item} from  @param {Item} to */
    async copy(from, to) {
      const rec = await d.store.get(from.id);
      if (!rec?.png) return;
      const png = setTextChunks(rec.png, {
        Title: to.name,
        'Creation Time': iso(to.createdAt),
      });
      await d.store.put({ id: to.id, png });
    },

    /** Drop a document's bytes. @param {string} id */
    async remove(id) {
      await d.store.remove(id);
    },

    /**
     * The bytes File → Download saves: the stored bytes for a clean saved
     * document, a fresh encode for an untitled or dirty one.
     * @param {ReturnType<typeof import('./doc.js').createDoc>} doc
     * @param {{fileId?: string|null, name?: string, dirty?: boolean,
     *          ring?: import('./ring-settings.js').RingChunkSettings|null}} identity
     * @returns {Promise<{bytes: Uint8Array, name: string}>}
     */
    async exportBytes(
      doc,
      { fileId = null, name = UNTITLED, dirty = false, ring = null } = {}
    ) {
      if (fileId && !dirty) {
        const bytes = await this.bytesOf(fileId).catch(() => null);
        if (bytes) return { bytes, name: docItem(fileId)?.name ?? name };
      }
      return { bytes: await encodeDoc(doc, name, now(), ring), name };
    },
  };
}

// The app's instance. main.js injects its dependencies through init().
export const sheets = createSheets();
