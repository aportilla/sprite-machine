// ---------------------------------------------------------------------------
// `files` slice — the document LIBRARY: the listing of every stored doc, the
// FOLDERS they sit in, storage reachability, and the per-document storage
// operations (save / load / rename / remove / export bytes). Pure actions
// over `createStore`, Node-tested with injected dependencies — the browser
// bits (IndexedDB via storage/db.js, PNG encode/decode via image-io.js, icon
// rendering) arrive through `init()` at boot, so this module imports nothing
// it can't run under Node.
//
// THE DOCUMENT IS THE PNG (the engine's png-chunks.js): a save encodes the drained
// atlas, splices the metadata text chunks (Title / Creation Time / Software /
// sprite-machine:transforms — only when non-identity — / sprite-machine:ring
// — the 3D Sprite Atlas's four settings, whenever the caller passes them),
// and stores those bytes; a load reads the chunks back and hands pixels +
// transforms + ring settings + name to the caller. The record's
// name/icon/dims fields are declared CACHE, never truth — the chunk wins on
// any disagreement.
//
// FOLDERS ARE CATALOG STRUCTURE, NOT DOCUMENT CONTENT (Sep 7 2026): where a
// file SITS is the HFS catalog's business, and a downloaded PNG carries none
// of it (a dropped one lands on the desktop). So a folder is a record of its
// own in storage's second store — `{id, name, parent, createdAt,
// modifiedAt}`, `parent` a folder id or null, the desktop being the root
// with no record — and a document's membership is ONE field on its record,
// `folder` (a folder id, or null/absent = the desktop): neither chunk nor
// cache, never in a chunk and never in localStorage. Folders nest freely;
// the one rule is that a folder cannot be moved into itself or a descendant
// (moveFolder refuses). The selectors below (childrenOf / isInside /
// folderPath / nextFolderName) are pure over the store's snapshot, for the
// shell and the tests alike; a document whose folder record is gone reads
// as the desktop's, so nothing can vanish into an orphaned id.
//
// THE TRASH IS A FOLDER WITH NO RECORD (Sep 9 2026): the root's one fixed
// child, `TRASH` — a synthetic row the store's initial state holds and every
// refresh() outcome keeps first in `folders` (with a listing, without one,
// under ?fresh), never written to storage, so every consumer sees a folder:
// a document whose `folder` is TRASH sits in it (containerOf resolves it),
// the icon layer renders it among the desktop's folders, its window is a
// folder window, and the desktop-state keys are the folder keys. It refuses
// four things — a rename, a move, a removal, and a folder made inside it
// (System 7 greyed New Folder with the Trash front) — each a silent no-op.
// Deleting IS filing into it (moveDoc / moveFolder, nothing new), and
// nothing is destroyed until emptyTrash(): the whole subtree removed —
// descendantsOf, documents and folders — the one destructive operation
// here. isTrashed tells the library's listing (the Open dialog, ?file) to
// look past it: the Finder's Trash folder was invisible to Standard File.
//
// A COPY IS A NEW FILE (Sep 10 2026, docs/clipboard-plan.md): copyDoc
// clones a stored document's bytes under a new id with fresh times and a
// fresh Title / Creation Time spliced in — the chunk wins over the record on
// any disagreement, so the chunk must say so — with no decode and no
// re-encode, the bytes being the document; copyFolder clones a folder with
// its whole subtree, the ids remapped and the nesting kept, from a snapshot
// taken before anything is written (so a folder pasted into itself is
// well-defined: a copy of it lands inside it, the Mac's own). Only the
// top-level pasted item is ever renamed, by copyName — the name as is where
// nothing in the container holds it, «name» copy beside the original, «name»
// copy 2, 3, … while those are taken (the Mac's counting; Duplicate ⌘D
// counts the same way). Both refuse a trashed target (a paste into the Trash
// is a delete by copy), and the Trash itself is never copied.
//
// WHAT THIS SLICE DOES NOT KNOW (the multi-document split): which documents
// are open, which is active, their dirty state, or their identity — that is
// the workspace's (state/workspace.js). Every per-document operation here
// takes an explicit doc instance and identity fields; nothing reads or
// writes "the current document", because there is no such thing at this
// layer anymore. Nor does it know an icon's POSITION: that is the desktop
// state's (shell/desktop-state.js), keyed by the item.
// ---------------------------------------------------------------------------

import { createStore } from './store.js';
import { readTextChunks, setTextChunks } from 'sprite-machine';
import { RING_CHUNK_KEY, ringChunk, parseRingChunk } from './ring-settings.js';

export const UNTITLED = 'untitled';
/** A new folder's name — the Finder's, counted up like the workspace's
 *  untitled documents (nextFolderName). */
export const UNTITLED_FOLDER = 'untitled folder';
/** The Trash's folder id — the one folder with no record (header). */
export const TRASH = 'trash';
/** The Trash's row, as every listing carries it: the root's fixed child,
 *  older than anything stored so it sorts first. @type {FolderRow} */
const TRASH_ROW = Object.freeze({
  id: TRASH,
  name: 'Trash',
  parent: null,
  createdAt: 0,
  modifiedAt: 0,
});
// The Software chunk value — doubles as the document-schema marker.
export const SOFTWARE = 'sprite-machine 1';

// Keyword of the one custom chunk (per-view rot/flip for imported
// unconventional sheets; editor-authored docs never need it).
const TRANSFORMS_KEY = 'sprite-machine:transforms';

/** "Cargo Ship" -> "cargo-ship" (the filename slug both downloads share —
 *  and the frame keys' prefix in the export's TexturePacker JSON). */
export const slugOf = (name) => {
  const slug = (name || UNTITLED)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || UNTITLED;
};

/** "Cargo Ship" -> "cargo-ship.png" (File → Download's filename). */
export const docFilename = (name) => `${slugOf(name)}.png`;

/** "Cargo Ship" -> "cargo-ship-atlas" (File → Export Sprite Atlas…'s
 *  basename: the same slug, `-atlas` after it — the zip's name and, inside
 *  it, the sheet PNG's and the TexturePacker JSON's, siblings by name). */
export const ringBasename = (name) => `${slugOf(name)}-atlas`;
/** "Cargo Ship" -> "cargo-ship-atlas.zip" (the download itself). */
export const ringFilename = (name) => `${ringBasename(name)}.zip`;
/** "Cargo Ship" -> "cargo-ship.glb" (File → Export 3D Model…'s download:
 *  the model and its skin, one file). */
export const modelFilename = (name) => `${slugOf(name)}.glb`;

/**
 * @typedef {{id: string, name: string, createdAt: number, modifiedAt: number,
 *   icon: string|null, w: number, h: number, folder: string|null,
 *   size: number}} DocRow
 *   size: the stored PNG's byte length — a listing cache like w / h, read
 *   off the record's bytes (the Empty Trash alert's "which use 12K").
 * @typedef {{id: string, name: string, parent: string|null,
 *   createdAt: number, modifiedAt: number}} FolderRow
 * @typedef {{available: boolean, list: DocRow[], folders: FolderRow[]}} FilesState
 */

// --- the pure selectors ----------------------------------------------------------

/** Does a folder record with this id exist? (A folder id names a container
 *  only while its record does.) @param {FilesState} state @param {string|null} id */
const folderExists = (state, id) => id != null && state.folders.some((f) => f.id === id);

/** The container an item's stated folder resolves to: the folder itself
 *  while its record exists, else the desktop (null) — an orphaned id can
 *  hide nothing. @param {FilesState} state @param {string|null|undefined} folder */
export function containerOf(state, folder) {
  return folderExists(state, folder ?? null) ? /** @type {string} */ (folder) : null;
}

/**
 * A container's children — the documents and the folders whose container
 * is `folder` (null: the desktop's), each in listing order.
 * @param {FilesState} state
 * @param {string|null} folder
 * @returns {{docs: DocRow[], folders: FolderRow[]}}
 */
export function childrenOf(state, folder) {
  const target = containerOf(state, folder);
  return {
    docs: state.list.filter((r) => containerOf(state, r.folder) === target),
    folders: state.folders.filter((f) => containerOf(state, f.parent) === target),
  };
}

/**
 * Is folder `id` inside `ancestor` — is `ancestor` on its parent chain?
 * (`id` is not inside itself; the caller tests identity beside this.) A
 * chain that loops — a corrupt catalog — ends at its first repeat.
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
 * The names from the root down to folder `id`, inclusive — the Open
 * dialog's path prefix. The desktop (null, or an orphaned id) is the empty
 * path.
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
 * Is a container the Trash, or inside it? (`folder` as a record states it:
 * an id, null for the desktop.) What the library's listing looks past.
 * @param {FilesState} state @param {string|null|undefined} folder
 */
export function isTrashed(state, folder) {
  const c = containerOf(state, folder ?? null);
  return c === TRASH || (c != null && isInside(state, c, TRASH));
}

/**
 * A container's whole subtree — every document and every folder under it,
 * however deep, each in listing order, parents before their children (an
 * emptying removes them all; the alert counts them). A chain that loops
 * — a corrupt catalog — is walked once.
 * @param {FilesState} state
 * @param {string|null} folder
 * @returns {{docs: DocRow[], folders: FolderRow[]}}
 */
export function descendantsOf(state, folder) {
  /** @type {DocRow[]} */
  const docs = [];
  /** @type {FolderRow[]} */
  const folders = [];
  const seen = new Set();
  const walk = (id) => {
    const kids = childrenOf(state, id);
    docs.push(...kids.docs);
    for (const f of kids.folders) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      folders.push(f);
      walk(f.id);
    }
  };
  walk(containerOf(state, folder));
  return { docs, folders };
}

/**
 * The next free folder name in a container: "untitled folder", "untitled
 * folder 2", … over the folder names already there (the workspace's
 * untitled rule).
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
 * The next free document name in a container: "untitled", "untitled 2", …
 * over the document names already there — nextFolderName's twin, for a
 * pasted picture that arrives with no name of its own (the workspace's
 * nextUntitledName counts over the OPEN windows instead).
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
 * The name a copy takes landing in `folder`: `name` AS IS when nothing there
 * holds it; else the Mac's counting from the name's base (a trailing
 * " copy" or " copy N" stripped) — «base» copy, then «base» copy 2, 3, …
 * while those are taken too. Over the container's documents (`kind`
 * 'doc') or its folders ('folder'). Duplicate passes "«name» copy" and
 * lands "«name» copy" the first time, "«name» copy 2" the next.
 * @param {FilesState} state @param {string|null} folder @param {string} name
 * @param {'doc'|'folder'} [kind]
 */
export function copyName(state, folder, name, kind = 'doc') {
  const kids = childrenOf(state, folder);
  const used = new Set((kind === 'folder' ? kids.folders : kids.docs).map((x) => x.name));
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
 *             removeFolder?(id: string): Promise<any>}|null,
 *   encodeAtlas: (img: object) => Promise<Uint8Array>,
 *   decodeAtlas: (bytes: Uint8Array) => Promise<object>,
 *   makeIcon?: (docState: object) => Promise<string|null>,
 *   now?: () => number,
 *   newId?: () => string,
 * }|null} [deps]  Injected at construction (tests) or via init() (the app).
 */
export function createFiles(deps = null) {
  const store = createStore(
    /** @type {FilesState} */ ({
      // Storage reachability: false until a refresh() succeeds, so a broken
      // private-mode IndexedDB reads as "Save unavailable", not a crash.
      available: false,
      list: [],
      // The Trash is furniture: on the desktop before any listing, and
      // whether or not there is one (header).
      folders: [TRASH_ROW],
    })
  );

  let d = deps;

  const now = () => (d?.now ?? Date.now)();
  const newId = () => (d?.newId ? d.newId() : crypto.randomUUID());
  const byCreation = (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);

  // The metadata chunks a save writes. `createdAt` persists across saves via
  // the record (first save stamps it); transforms only when non-identity;
  // the ring settings whenever the caller has them (a null removes a stale
  // chunk — replace semantics).
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

  // Encode a doc (drained first) into finished document bytes.
  async function encodeDoc(doc, name, createdAt, ring) {
    doc.drain();
    const state = doc.get();
    const bytes = await d.encodeAtlas(state.atlasImage);
    return setTextChunks(bytes, metaChunks(name, createdAt, state.transforms, ring));
  }

  /** The folder record by id off the listing (a folder record is small and
   *  the listing holds it whole — the listing IS the record). */
  const folderRec = (id) => store.get().folders.find((f) => f.id === id) ?? null;

  const api = {
    store,
    get: store.get,
    subscribe: store.subscribe,

    /** Late dependency injection (the app's boot path; tests construct with
     *  deps instead). */
    init(realDeps) {
      d = realDeps;
    },

    /** Re-read the listing — the documents AND the folders — from storage;
     *  resolves availability as a side effect (success ⇒ true,
     *  failure/absence ⇒ false). The Trash's row leads `folders` in every
     *  outcome. */
    async refresh() {
      if (!d?.storage) {
        store.patch({ available: false, list: [], folders: [TRASH_ROW] });
        return;
      }
      try {
        const records = await d.storage.list();
        const folderRecords = d.storage.listFolders ? await d.storage.listFolders() : [];
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
        store.patch({ available: true, list, folders: [TRASH_ROW, ...folders] });
      } catch {
        store.patch({ available: false, list: [], folders: [TRASH_ROW] });
      }
    },

    /**
     * Persist a document's pixels under an identity. `fileId: null` saves a
     * NEW record (an untitled's first save, a duplicate); an existing id
     * saves silently in place, its `createdAt` — and its `folder` —
     * surviving. Resolves the stored `{id, name}` — the caller (the
     * workspace) applies them to whatever identity it manages.
     * @param {ReturnType<typeof import('./doc.js').createDoc>} doc
     * @param {{fileId?: string|null, name?: string,
     *          ring?: import('./ring-settings.js').RingChunkSettings|null,
     *          folder?: string|null}} identity
     *   ring: the document's 3D Sprite Atlas settings (the workspace passes
     *   its context's) — written as the ring chunk; absent, none is.
     *   folder: where a NEW record lands (null, the default: the desktop; a
     *   Duplicate passes the original's, so the copy lands beside it). An
     *   existing record keeps its own — a save never moves a file; moveDoc
     *   does.
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
     * Load a stored document's content: pixels, transforms, the 3D Sprite
     * Atlas settings its chunk carries (null for none — the context opens
     * at the defaults), and the name the chunk (or the record cache)
     * carries. Resolves null when the id is gone; throws on a decode
     * failure (the caller surfaces it). No doc is mutated here — the
     * workspace loads the result into a context.
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
      return {
        image,
        transforms,
        ring: parseRingChunk(meta[RING_CHUNK_KEY]),
        name: meta.Title ?? rec.name ?? UNTITLED,
      };
    },

    /** A stored document's bytes — the file on disk, chunks and all (what
     *  Copy hands the system clipboard as its PNG). Null when the id is
     *  gone or storage is out of reach. @param {string} id
     *  @returns {Promise<Uint8Array|null>} */
    async bytesOf(id) {
      if (!d?.storage) return null;
      const rec = await d.storage.get(id).catch(() => null);
      return rec?.png ?? null;
    },

    /**
     * Copy a stored document into a container (`folder` null: the desktop)
     * as a NEW file: a new id, fresh times, the icon cache and the dims
     * carried over, the bytes cloned with a fresh Title and Creation Time
     * spliced in — no decode, no re-encode. Named as given, else by
     * copyName over the target's documents. Resolves `{id, name}`, or null:
     * the source is gone, or the target is the Trash or inside it.
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
     * Copy a folder WITH ITS SUBTREE into a container (`parent` null: the
     * desktop): the folder records top-down with old ids mapped to new, then
     * every document under it into its new parent, each with a fresh id and
     * times and its name unchanged — only the top-level copy is named (as
     * given, else by copyName over the target's folders). The subtree is a
     * SNAPSHOT taken before anything is written, so a folder copied into
     * itself lands one copy inside it and stops. Resolves `{id, name}`, or
     * null: the Trash as the source (never copied), a source that is gone,
     * or a trashed target.
     * @param {string} id @param {{parent?: string|null, name?: string}} [into]
     */
    async copyFolder(id, { parent = null, name } = {}) {
      const state = store.get();
      const rec = folderRec(id);
      if (!rec || id === TRASH) return null;
      const target = containerOf(state, parent);
      if (isTrashed(state, target)) return null;
      const { docs, folders: dirs } = descendantsOf(state, id);
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
      // Parents before their children (descendantsOf's order), so every
      // parent is mapped before a child asks for it.
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
      await this.refresh();
      return { id: rootId, name: finalName };
    },

    /** Rename a stored doc BY ID: the Title chunk is rewritten in place (a
     *  rename is metadata, so `modifiedAt` stands — and so does `folder`,
     *  the spread keeping it). Open-context names are the workspace's to
     *  follow. */
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
     * File a stored doc into a folder (`null`: the desktop). A move is
     * catalog, not content: the bytes, the name and `modifiedAt` all stand.
     * Resolves true when the record moved (false: gone, or already there).
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
     * Make a folder in a container (`parent` null: the desktop), named as
     * given or the next free "untitled folder". Resolves `{id, name}` —
     * or null, REFUSED, for a container that is the Trash or inside it (a
     * folder made to be deleted; the Finder greyed New Folder there).
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

    /** Rename a folder in place (the desktop icon's in-place rename lands
     *  here; a folder window's title follows through the listing). The
     *  Trash keeps its name. */
    async renameFolder(id, name) {
      const rec = folderRec(id);
      if (!rec || id === TRASH) return;
      await d.storage.putFolder({ ...rec, name, modifiedAt: now() });
      await this.refresh();
    },

    /**
     * Move a folder into another (`null`: the desktop). REFUSED — a no-op
     * resolving false — when the target is the folder itself or inside it
     * (a folder cannot be put into itself, the Finder's one rule); false
     * too for a folder that is gone or already there — and for the Trash,
     * which is the desktop's and never files anywhere.
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
     * Delete a folder record. Its children — documents and folders — are
     * lifted into ITS container first, so nothing is ever orphaned (the
     * recursive removal is emptyTrash's; nothing in the UI calls this).
     * The Trash itself is never removed.
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
      await d.storage.removeFolder(id);
      await this.refresh();
    },

    /**
     * Empty the Trash: every document and every folder under it, however
     * deep, removed from storage — the one destructive operation here —
     * then one refresh. Resolves the removed ids (the workspace reverts
     * any open context holding one of the documents). The Trash's own
     * row stands.
     * @returns {Promise<{docs: string[], folders: string[]}>}
     */
    async emptyTrash() {
      const { docs, folders } = descendantsOf(store.get(), TRASH);
      for (const r of docs) await d.storage.remove(r.id);
      for (const f of folders) await d.storage.removeFolder(f.id);
      await this.refresh();
      return { docs: docs.map((r) => r.id), folders: folders.map((f) => f.id) };
    },

    /**
     * The bytes File → Download saves: the SAVED bytes verbatim for a
     * clean saved doc (a downloaded file IS the document); a fresh encode
     * for an untitled or dirty one.
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

// The app-wide singleton — constructed dep-less so this module stays
// Node-importable; main.js injects the real storage/codec at boot via init().
export const files = createFiles();
