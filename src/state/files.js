// The document library: stored documents, folders and text files, storage
// availability, and the storage operations on them. Browser dependencies
// (storage, PNG codec, icon rendering) arrive through init(), so the module
// runs under Node.
//
// - A document is stored as PNG bytes. A save writes the Title, Creation Time,
//   Software, sprite-machine:transforms (non-identity only) and
//   sprite-machine:ring chunks. The record's name, icon and dims are a cache.
//   The chunks take precedence, so a rename or copy rewrites Title.
// - A folder is a storage record {id, name, parent, createdAt, modifiedAt}.
//   An item's `folder` is a folder id, or null for the desktop. An id with no
//   folder record resolves to the desktop. A folder cannot move into itself or
//   a descendant.
// - TRASH is a folder with no record. Its row is always first in `folders`. It
//   cannot be renamed, moved, removed or copied. Folders, text files and copies
//   cannot be made in it. Deleting is a move into it. emptyTrash() removes its
//   subtree.
// - A text file is a record {id, name, text, createdAt, modifiedAt, folder}.
//   The listing omits the text; textOf reads it.

import { createStore } from './store.js';
import { readTextChunks, setTextChunks } from 'sprite-machine';
import { RING_CHUNK_KEY, ringChunk, parseRingChunk } from './ring-settings.js';

export const UNTITLED = 'untitled';
/** A new folder's default name. */
export const UNTITLED_FOLDER = 'untitled folder';
/** The Trash's folder id. It has no storage record. */
export const TRASH = 'trash';
/** The Trash's listing row. createdAt 0 sorts it first. @type {FolderRow} */
const TRASH_ROW = Object.freeze({
  id: TRASH,
  name: 'Trash',
  parent: null,
  createdAt: 0,
  modifiedAt: 0,
});
// The Software chunk value, also the document schema marker.
export const SOFTWARE = 'sprite-machine 1';

// Chunk keyword for per-view rotation and flip on imported sheets.
const TRANSFORMS_KEY = 'sprite-machine:transforms';

/** "Cargo Ship" -> "cargo-ship". Also the atlas JSON's frame key prefix. */
export const slugOf = (name) => {
  const slug = (name || UNTITLED)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || UNTITLED;
};

/** "Cargo Ship" -> "cargo-ship.png" (File → Download). */
export const docFilename = (name) => `${slugOf(name)}.png`;

/** "Cargo Ship" -> "cargo-ship-atlas": the base name of the atlas zip and the
 *  files in it. */
export const ringBasename = (name) => `${slugOf(name)}-atlas`;
/** "Cargo Ship" -> "cargo-ship-atlas.zip". */
export const ringFilename = (name) => `${ringBasename(name)}.zip`;
/** "Cargo Ship" -> "cargo-ship.glb" (File → Export 3D Model…). */
export const modelFilename = (name) => `${slugOf(name)}.glb`;

/**
 * @typedef {{id: string, name: string, createdAt: number, modifiedAt: number,
 *   icon: string|null, w: number, h: number, folder: string|null,
 *   size: number}} DocRow
 *   size: the stored PNG's byte length.
 * @typedef {{id: string, name: string, parent: string|null,
 *   createdAt: number, modifiedAt: number}} FolderRow
 * @typedef {{id: string, name: string, createdAt: number, modifiedAt: number,
 *   folder: string|null, size: number}} TextRow
 *   size: the text's UTF-8 byte length.
 * @typedef {{available: boolean, list: DocRow[], folders: FolderRow[],
 *   texts: TextRow[]}} FilesState
 */

// Pure selectors

/** @param {FilesState} state @param {string|null} id */
const folderExists = (state, id) => id != null && state.folders.some((f) => f.id === id);

/** The container an item's folder resolves to: the folder while its record
 *  exists, else the desktop (null).
 *  @param {FilesState} state @param {string|null|undefined} folder */
export function containerOf(state, folder) {
  return folderExists(state, folder ?? null) ? /** @type {string} */ (folder) : null;
}

/**
 * The documents, folders and text files directly in a container (null: the
 * desktop), each in listing order.
 * @param {FilesState} state
 * @param {string|null} folder
 * @returns {{docs: DocRow[], folders: FolderRow[], texts: TextRow[]}}
 */
export function childrenOf(state, folder) {
  const target = containerOf(state, folder);
  return {
    docs: state.list.filter((r) => containerOf(state, r.folder) === target),
    folders: state.folders.filter((f) => containerOf(state, f.parent) === target),
    texts: state.texts.filter((t) => containerOf(state, t.folder) === target),
  };
}

/** The number of items directly in a container.
 *  @param {FilesState} state @param {string|null} folder */
export function itemCount(state, folder) {
  const c = childrenOf(state, folder);
  return c.docs.length + c.folders.length + c.texts.length;
}

/**
 * Whether `ancestor` is on folder `id`'s parent chain. A folder is not inside
 * itself. A looping chain stops at its first repeat.
 * @param {FilesState} state @param {string} id @param {string} ancestor
 */
export function isInside(state, id, ancestor) {
  const seen = new Set();
  let cur = state.folders.find((f) => f.id === id)?.parent ?? null;
  while (cur != null && !seen.has(cur)) {
    if (cur === ancestor) return true;
    seen.add(cur);
    cur = state.folders.find((f) => f.id === cur)?.parent ?? null;
  }
  return false;
}

/**
 * Folder names from the root down to `id`, inclusive. The desktop is the
 * empty path.
 * @param {FilesState} state @param {string|null|undefined} id
 * @returns {string[]}
 */
export function folderPath(state, id) {
  const names = [];
  const seen = new Set();
  let cur = containerOf(state, id ?? null);
  while (cur != null && !seen.has(cur)) {
    const f = state.folders.find((x) => x.id === cur);
    if (!f) break;
    names.unshift(f.name);
    seen.add(cur);
    cur = containerOf(state, f.parent);
  }
  return names;
}

/**
 * Whether a container is the Trash or inside it.
 * @param {FilesState} state @param {string|null|undefined} folder
 */
export function isTrashed(state, folder) {
  const c = containerOf(state, folder ?? null);
  return c === TRASH || (c != null && isInside(state, c, TRASH));
}

/**
 * Every document, folder and text file under a container, parents before
 * their children. A looping chain is walked once.
 * @param {FilesState} state
 * @param {string|null} folder
 * @returns {{docs: DocRow[], folders: FolderRow[], texts: TextRow[]}}
 */
export function descendantsOf(state, folder) {
  /** @type {DocRow[]} */
  const docs = [];
  /** @type {FolderRow[]} */
  const folders = [];
  /** @type {TextRow[]} */
  const texts = [];
  const seen = new Set();
  const walk = (id) => {
    const kids = childrenOf(state, id);
    docs.push(...kids.docs);
    texts.push(...kids.texts);
    for (const f of kids.folders) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      folders.push(f);
      walk(f.id);
    }
  };
  walk(containerOf(state, folder));
  return { docs, folders, texts };
}

/**
 * The first free folder name in a container: "untitled folder",
 * "untitled folder 2", …
 * @param {FilesState} state @param {string|null} parent
 */
export function nextFolderName(state, parent) {
  const used = new Set(childrenOf(state, parent).folders.map((f) => f.name));
  if (!used.has(UNTITLED_FOLDER)) return UNTITLED_FOLDER;
  for (let n = 2; ; n++) {
    const name = `${UNTITLED_FOLDER} ${n}`;
    if (!used.has(name)) return name;
  }
}

/**
 * The first free document name in a container: "untitled", "untitled 2", …
 * @param {FilesState} state @param {string|null} folder
 */
export function nextDocName(state, folder) {
  const used = new Set(childrenOf(state, folder).docs.map((r) => r.name));
  if (!used.has(UNTITLED)) return UNTITLED;
  for (let n = 2; ; n++) {
    const name = `${UNTITLED} ${n}`;
    if (!used.has(name)) return name;
  }
}

/**
 * The name for a copy in `folder`. `name` itself if no item of `kind` there
 * has it. Otherwise the base name (without a trailing " copy" or " copy N")
 * plus " copy", then " copy 2", " copy 3", … until one is free.
 * @param {FilesState} state @param {string|null} folder @param {string} name
 * @param {'doc'|'folder'|'text'} [kind]
 */
export function copyName(state, folder, name, kind = 'doc') {
  const kids = childrenOf(state, folder);
  const rows =
    kind === 'folder' ? kids.folders : kind === 'text' ? kids.texts : kids.docs;
  const used = new Set(rows.map((x) => x.name));
  if (!used.has(name)) return name;
  const base = name.replace(/ copy( \d+)?$/, '');
  const first = `${base} copy`;
  if (!used.has(first)) return first;
  for (let n = 2; ; n++) {
    const next = `${base} copy ${n}`;
    if (!used.has(next)) return next;
  }
}

/**
 * @param {{
 *   storage: {list(): Promise<any[]>, get(id: string): Promise<any>,
 *             put(r: any): Promise<any>, remove(id: string): Promise<any>,
 *             listFolders?(): Promise<any[]>, putFolder?(r: any): Promise<any>,
 *             removeFolder?(id: string): Promise<any>,
 *             listTexts?(): Promise<any[]>, getText?(id: string): Promise<any>,
 *             putText?(r: any): Promise<any>, removeText?(id: string): Promise<any>}|null,
 *   encodeAtlas: (img: object) => Promise<Uint8Array>,
 *   decodeAtlas: (bytes: Uint8Array) => Promise<object>,
 *   makeIcon?: (docState: object) => Promise<string|null>,
 *   now?: () => number,
 *   newId?: () => string,
 * }|null} [deps]  Passed here or later through init().
 */
export function createFiles(deps = null) {
  const store = createStore(
    /** @type {FilesState} */ ({
      // False until a refresh() succeeds.
      available: false,
      list: [],
      folders: [TRASH_ROW],
      texts: [],
    })
  );

  let d = deps;

  const now = () => (d?.now ?? Date.now)();
  const newId = () => (d?.newId ? d.newId() : crypto.randomUUID());
  const byCreation = (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);
  const textSize = (text) => new TextEncoder().encode(String(text ?? '')).byteLength;
  /** The state when storage is missing or unreadable. */
  const NOTHING = () => ({ available: false, list: [], folders: [TRASH_ROW], texts: [] });

  // The metadata chunks a save writes. A null value removes the chunk.
  function metaChunks(name, createdAt, transforms, ring) {
    return {
      Title: name,
      'Creation Time': new Date(createdAt).toISOString(),
      Software: SOFTWARE,
      [TRANSFORMS_KEY]:
        transforms && Object.keys(transforms).length ? JSON.stringify(transforms) : null,
      [RING_CHUNK_KEY]: ring ? ringChunk(ring) : null,
    };
  }

  async function encodeDoc(doc, name, createdAt, ring) {
    doc.drain();
    const state = doc.get();
    const bytes = await d.encodeAtlas(state.atlasImage);
    return setTextChunks(bytes, metaChunks(name, createdAt, state.transforms, ring));
  }

  /** A folder record by id. Folder listing rows are whole records, so they can be
   *  written back. */
  const folderRec = (id) => store.get().folders.find((f) => f.id === id) ?? null;

  const api = {
    store,
    get: store.get,
    subscribe: store.subscribe,

    /** Sets the dependencies after construction. */
    init(realDeps) {
      d = realDeps;
    },

    /** Re-read documents, folders and text files from storage and set
     *  `available`. The Trash row always leads `folders`. */
    async refresh() {
      if (!d?.storage) {
        store.patch(NOTHING());
        return;
      }
      try {
        const records = await d.storage.list();
        const folderRecords = d.storage.listFolders ? await d.storage.listFolders() : [];
        const textRecords = d.storage.listTexts ? await d.storage.listTexts() : [];
        const list = records
          .map(({ id, name, createdAt, modifiedAt, icon, w, h, folder, png }) => ({
            id,
            name,
            createdAt,
            modifiedAt,
            icon: icon ?? null,
            w,
            h,
            folder: folder ?? null,
            size: png?.byteLength ?? 0,
          }))
          .sort(byCreation);
        const folders = folderRecords
          .map(({ id, name, parent, createdAt, modifiedAt }) => ({
            id,
            name,
            parent: parent ?? null,
            createdAt,
            modifiedAt,
          }))
          .sort(byCreation);
        const texts = textRecords
          .map(({ id, name, createdAt, modifiedAt, folder, text }) => ({
            id,
            name,
            createdAt,
            modifiedAt,
            folder: folder ?? null,
            size: textSize(text),
          }))
          .sort(byCreation);
        store.patch({ available: true, list, folders: [TRASH_ROW, ...folders], texts });
      } catch (err) {
        // Log the cause. Otherwise a failed listing shows only as an empty desktop.
        console.warn('sprite-machine: the library could not be read —', err);
        store.patch(NOTHING());
      }
    },

    /**
     * Store a document's pixels. `fileId: null` creates a new record. An
     * existing id saves in place and keeps its `createdAt` and `folder`.
     * Resolves the stored `{id, name}`.
     * @param {ReturnType<typeof import('./doc.js').createDoc>} doc
     * @param {{fileId?: string|null, name?: string,
     *          ring?: import('./ring-settings.js').RingChunkSettings|null,
     *          folder?: string|null}} identity
     *   ring: the 3D Sprite Atlas settings for the ring chunk. Null: no chunk.
     *   folder: where a new record goes (null: the desktop).
     */
    async save(doc, { fileId = null, name, ring = null, folder = null } = {}) {
      if (!doc.get().atlasImage) return null;
      const id = fileId ?? newId();
      const finalName = name ?? UNTITLED;
      const prev = fileId ? await d.storage.get(id) : null;
      const createdAt = prev?.createdAt ?? now();
      const png = await encodeDoc(doc, finalName, createdAt, ring);
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
        folder: prev ? (prev.folder ?? null) : folder,
      });
      await this.refresh();
      return { id, name: finalName };
    },

    /**
     * Load a stored document: pixels, transforms, ring settings (null when
     * the PNG has none) and name (the Title chunk, else the record's).
     * Resolves null when the id is gone. Throws when decoding fails.
     * @param {string} id
     * @returns {Promise<{image: object, transforms: object,
     *   ring: Partial<import('./ring-settings.js').RingChunkSettings>|null, name: string}|null>}
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
        // Unreadable chunks. The pixels may still decode, and the name falls
        // back to the record.
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
      return {
        image,
        transforms,
        ring: parseRingChunk(meta[RING_CHUNK_KEY]),
        name: meta.Title ?? rec.name ?? UNTITLED,
      };
    },

    /** A stored document's PNG bytes, chunks included. Null when the id is
     *  gone or storage is unavailable. @param {string} id
     *  @returns {Promise<Uint8Array|null>} */
    async bytesOf(id) {
      if (!d?.storage) return null;
      const rec = await d.storage.get(id).catch(() => null);
      return rec?.png ?? null;
    },

    /**
     * Copy a stored document into a container (`folder` null: the desktop)
     * as a new record with fresh times. The bytes are copied without
     * re-encoding, with a new Title and Creation Time. Named `name`, else by
     * copyName. Resolves `{id, name}`, or null when the source is gone or
     * the target is trashed.
     * @param {string} id @param {{folder?: string|null, name?: string}} [into]
     */
    async copyDoc(id, { folder = null, name } = {}) {
      const state = store.get();
      const target = containerOf(state, folder);
      if (isTrashed(state, target)) return null;
      const rec = await d.storage.get(id);
      if (!rec) return null;
      const finalName = name ?? copyName(state, target, rec.name, 'doc');
      const nid = newId();
      const t = now();
      const png = setTextChunks(rec.png, {
        Title: finalName,
        'Creation Time': new Date(t).toISOString(),
      });
      await d.storage.put({
        ...rec,
        id: nid,
        png,
        name: finalName,
        createdAt: t,
        modifiedAt: t,
        folder: target,
      });
      await this.refresh();
      return { id: nid, name: finalName };
    },

    /**
     * Copy a folder and its subtree into a container (`parent` null: the
     * desktop). Every copy gets a fresh id and times. Only the top folder is
     * renamed (`name`, else copyName). The subtree is read before any write,
     * so a folder copied into itself is copied once. Resolves `{id, name}`,
     * or null for the Trash, a missing source or a trashed target.
     * @param {string} id @param {{parent?: string|null, name?: string}} [into]
     */
    async copyFolder(id, { parent = null, name } = {}) {
      const state = store.get();
      const rec = folderRec(id);
      if (!rec || id === TRASH) return null;
      const target = containerOf(state, parent);
      if (isTrashed(state, target)) return null;
      const { docs, folders: dirs, texts } = descendantsOf(state, id);
      const finalName = name ?? copyName(state, target, rec.name, 'folder');
      /** @type {Map<string, string>} old folder id -> its copy's id */
      const map = new Map();
      const putFolder = async (old, folderName, into) => {
        const nid = newId();
        const t = now();
        map.set(old, nid);
        await d.storage.putFolder({
          id: nid,
          name: folderName,
          parent: into,
          createdAt: t,
          modifiedAt: t,
        });
        return nid;
      };
      const rootId = await putFolder(id, finalName, target);
      // descendantsOf lists parents first, so each parent is mapped before
      // its children.
      for (const f of dirs) {
        await putFolder(f.id, f.name, map.get(containerOf(state, f.parent)) ?? rootId);
      }
      for (const r of docs) {
        const full = await d.storage.get(r.id);
        if (!full) continue;
        const t = now();
        await d.storage.put({
          ...full,
          id: newId(),
          png: setTextChunks(full.png, {
            Title: full.name,
            'Creation Time': new Date(t).toISOString(),
          }),
          createdAt: t,
          modifiedAt: t,
          folder: map.get(containerOf(state, r.folder)) ?? rootId,
        });
      }
      for (const r of texts) {
        const full = await d.storage.getText(r.id);
        if (!full) continue;
        const t = now();
        await d.storage.putText({
          ...full,
          id: newId(),
          createdAt: t,
          modifiedAt: t,
          folder: map.get(containerOf(state, r.folder)) ?? rootId,
        });
      }
      await this.refresh();
      return { id: rootId, name: finalName };
    },

    /** Rename a stored doc and rewrite its Title chunk. `modifiedAt` is
     *  unchanged. */
    async renameById(id, name) {
      const rec = await d.storage.get(id);
      if (!rec) return;
      const png = setTextChunks(rec.png, { Title: name });
      await d.storage.put({ ...rec, png, name });
      await this.refresh();
    },

    async remove(id) {
      await d.storage.remove(id);
      await this.refresh();
    },

    /**
     * Move a stored doc into a folder (`null`: the desktop). The bytes, name
     * and `modifiedAt` are unchanged. Resolves false when the doc is gone or
     * already there.
     * @param {string} id @param {string|null} folder
     */
    async moveDoc(id, folder) {
      const rec = await d.storage.get(id);
      if (!rec) return false;
      const target = containerOf(store.get(), folder);
      if ((rec.folder ?? null) === target) return false;
      await d.storage.put({ ...rec, folder: target });
      await this.refresh();
      return true;
    },

    /**
     * Make a folder in a container (`parent` null: the desktop), named `name`
     * or the next free "untitled folder". Resolves `{id, name}`, or null when
     * the container is trashed.
     * @param {{name?: string, parent?: string|null}} [init]
     */
    async createFolder({ name, parent = null } = {}) {
      const state = store.get();
      const target = containerOf(state, parent);
      if (isTrashed(state, target)) return null;
      const finalName = name ?? nextFolderName(state, target);
      const id = newId();
      const t = now();
      await d.storage.putFolder({
        id,
        name: finalName,
        parent: target,
        createdAt: t,
        modifiedAt: t,
      });
      await this.refresh();
      return { id, name: finalName };
    },

    /** Rename a folder. The Trash cannot be renamed. */
    async renameFolder(id, name) {
      const rec = folderRec(id);
      if (!rec || id === TRASH) return;
      await d.storage.putFolder({ ...rec, name, modifiedAt: now() });
      await this.refresh();
    },

    /**
     * Move a folder into another (`null`: the desktop). Resolves false
     * without moving when the target is the folder or inside it, when the
     * folder is gone or already there, or for the Trash.
     * @param {string} id @param {string|null} parent
     */
    async moveFolder(id, parent) {
      const state = store.get();
      const rec = folderRec(id);
      if (!rec || id === TRASH) return false;
      const target = containerOf(state, parent);
      if (target === id || (target != null && isInside(state, target, id))) return false;
      if ((rec.parent ?? null) === target) return false;
      await d.storage.putFolder({ ...rec, parent: target });
      await this.refresh();
      return true;
    },

    /**
     * Delete a folder record. Its children move to its parent container
     * first. The Trash cannot be removed.
     * @param {string} id
     */
    async removeFolder(id) {
      const state = store.get();
      const rec = folderRec(id);
      if (!rec || id === TRASH) return;
      const into = containerOf(state, rec.parent);
      for (const f of state.folders) {
        if ((f.parent ?? null) === id) await d.storage.putFolder({ ...f, parent: into });
      }
      for (const r of state.list) {
        if ((r.folder ?? null) === id) {
          const full = await d.storage.get(r.id);
          if (full) await d.storage.put({ ...full, folder: into });
        }
      }
      for (const r of state.texts) {
        if ((r.folder ?? null) === id) {
          const full = await d.storage.getText(r.id);
          if (full) await d.storage.putText({ ...full, folder: into });
        }
      }
      await d.storage.removeFolder(id);
      await this.refresh();
    },

    /**
     * Remove every document, folder and text file under the Trash from
     * storage. Resolves the removed ids.
     * @returns {Promise<{docs: string[], folders: string[], texts: string[]}>}
     */
    async emptyTrash() {
      const { docs, folders, texts } = descendantsOf(store.get(), TRASH);
      for (const r of docs) await d.storage.remove(r.id);
      for (const t of texts) await d.storage.removeText(t.id);
      for (const f of folders) await d.storage.removeFolder(f.id);
      await this.refresh();
      return {
        docs: docs.map((r) => r.id),
        folders: folders.map((f) => f.id),
        texts: texts.map((t) => t.id),
      };
    },

    // Text files

    /**
     * Store a new text file in a container (`folder` null: the desktop).
     * Resolves `{id, name}`, or null for a trashed target.
     * @param {{name: string, text: string, folder?: string|null}} init
     */
    async createText({ name, text, folder = null }) {
      const state = store.get();
      const target = containerOf(state, folder);
      if (isTrashed(state, target)) return null;
      const id = newId();
      const t = now();
      await d.storage.putText({
        id,
        name,
        text: String(text ?? ''),
        createdAt: t,
        modifiedAt: t,
        folder: target,
      });
      await this.refresh();
      return { id, name };
    },

    /** A stored text file's text. Null when the id is gone or storage is
     *  unavailable. @param {string} id
     *  @returns {Promise<string|null>} */
    async textOf(id) {
      if (!d?.storage?.getText) return null;
      const rec = await d.storage.getText(id).catch(() => null);
      return rec ? String(rec.text ?? '') : null;
    },

    /** A text file's listing row by id (the record without its text). */
    textRec(id) {
      return store.get().texts.find((t) => t.id === id) ?? null;
    },

    /** Rename a text file. `modifiedAt` is unchanged. */
    async renameText(id, name) {
      const rec = await d.storage.getText(id);
      if (!rec) return;
      await d.storage.putText({ ...rec, name });
      await this.refresh();
    },

    /**
     * Move a text file into a folder (`null`: the desktop). Resolves true
     * when the record moved.
     * @param {string} id @param {string|null} folder
     */
    async moveText(id, folder) {
      const rec = await d.storage.getText(id);
      if (!rec) return false;
      const target = containerOf(store.get(), folder);
      if ((rec.folder ?? null) === target) return false;
      await d.storage.putText({ ...rec, folder: target });
      await this.refresh();
      return true;
    },

    /**
     * Copy a text file into a container as a new record with fresh times,
     * named `name`, else by copyName. Resolves `{id, name}`, or null when the
     * source is gone or the target is trashed.
     * @param {string} id @param {{folder?: string|null, name?: string}} [into]
     */
    async copyText(id, { folder = null, name } = {}) {
      const state = store.get();
      const target = containerOf(state, folder);
      if (isTrashed(state, target)) return null;
      const rec = await d.storage.getText(id);
      if (!rec) return null;
      const finalName = name ?? copyName(state, target, rec.name, 'text');
      const nid = newId();
      const t = now();
      await d.storage.putText({
        ...rec,
        id: nid,
        name: finalName,
        createdAt: t,
        modifiedAt: t,
        folder: target,
      });
      await this.refresh();
      return { id: nid, name: finalName };
    },

    async removeText(id) {
      await d.storage.removeText(id);
      await this.refresh();
    },

    /**
     * The bytes File → Download saves: the stored bytes for a clean saved
     * doc, a fresh encode for an untitled or dirty one.
     * @param {ReturnType<typeof import('./doc.js').createDoc>} doc
     * @param {{fileId?: string|null, name?: string, dirty?: boolean,
     *          ring?: import('./ring-settings.js').RingChunkSettings|null}} identity
     * @returns {Promise<{bytes: Uint8Array, name: string}>}
     */
    async exportBytes(
      doc,
      { fileId = null, name = UNTITLED, dirty = false, ring = null } = {}
    ) {
      if (fileId && !dirty && d.storage) {
        const rec = await d.storage.get(fileId).catch(() => null);
        if (rec) return { bytes: rec.png, name: rec.name };
      }
      const bytes = await encodeDoc(doc, name, now(), ring);
      return { bytes, name };
    },
  };
  return api;
}

// The app's instance. main.js injects its dependencies through init().
export const files = createFiles();
