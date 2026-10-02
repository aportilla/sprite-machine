// The conversion from what this app stored before it ran on
// vintage-frames/shell. Pure. Each part runs once and leaves the old records
// where they are:
//
// - The library (IndexedDB `sprite-machine`: stores `folders`, `docs` and
//   `texts`) becomes catalog items with the same ids, as the catalog's seed.
//   A document's bytes stay in `docs` under that id.
// - The desktop state (localStorage `sprite-machine:desktop`, versions 1 to
//   4) becomes the shell's saved session under the session's own key. Its
//   icon positions go onto the items.

import { FOLDER, SPRITE, TEXT, TRASH } from './kinds.js';
import { UNTITLED } from './names.js';

/** The old desktop state's localStorage key. */
export const LEGACY_DESKTOP_KEY = 'sprite-machine:desktop';

/** The application that reopens each kind of old window key. */
const APPS = {
  doc: 'sprite-editor',
  folder: 'finder',
  text: 'text-viewer',
  windoid: 'sprite-editor',
};

/** Whether `p` has a nine-slice pin's shape. */
function isPin(p) {
  const edge = (e) =>
    !!e &&
    (e.kind === 'near' || e.kind === 'far' || e.kind === 'spring') &&
    Number.isFinite(e.v);
  const axis = (a) => Array.isArray(a) && a.length === 2 && edge(a[0]) && edge(a[1]);
  return !!p && typeof p === 'object' && axis(p.x) && axis(p.y);
}

/** An old key ("doc:<id>") as its kind and id, or null. @param {unknown} key */
function parseKey(key) {
  const at = typeof key === 'string' ? key.indexOf(':') : -1;
  if (at <= 0) return null;
  const k = /** @type {string} */ (key);
  return { kind: k.slice(0, at), id: k.slice(at + 1) };
}

/** A position in an old desktop state's `icons`, or null. */
function positionOf(icons, key) {
  const p = icons?.[key];
  return Number.isFinite(p?.left) && Number.isFinite(p?.top)
    ? { left: p.left, top: p.top }
    : null;
}

const time = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const container = (v) => (typeof v === 'string' && v ? v : null);

/**
 * What the conversion reads from an old desktop state blob of any version:
 * icon positions and window entries by key, the active key, each open
 * document's face and layer, whether the 3D Sprite Atlas showed, the pattern
 * and Show at startup. Null for anything that isn't one.
 * @param {any} p  the parsed blob
 */
export function readDesktopState(p) {
  if (!p || typeof p !== 'object' || ![1, 2, 3, 4].includes(p.v)) return null;
  // v1 named its document, v2 and v3 their active document, v4 a window.
  let active = null;
  if (p.v === 4) active = p.active;
  else if (p.v === 1) active = p.lastDocId ? `doc:${p.lastDocId}` : null;
  else active = p.activeFileId ? `doc:${p.activeFileId}` : null;
  const docs =
    p.v === 1 ? (p.lastDocId ? [{ fileId: p.lastDocId }] : []) : (p.docs ?? []);
  // v3 held bare pins and v4 entries with a depth. Older boxes are not pins.
  /** @type {Record<string, {pin: object, z?: number}>} */
  const windows = {};
  if (p.v >= 3) {
    for (const [key, e] of Object.entries(p.windows ?? {})) {
      const pin = isPin(e) ? e : e?.pin;
      if (!isPin(pin)) continue;
      windows[key] = p.v === 4 && Number.isInteger(e?.z) ? { pin, z: e.z } : { pin };
    }
  }
  return {
    icons: p.icons && typeof p.icons === 'object' ? p.icons : {},
    windows,
    active: typeof active === 'string' && active ? active : null,
    docs: Array.isArray(docs) ? docs : [],
    showRing: p.showRing === true,
    pattern: typeof p.pattern === 'string' && p.pattern.trim() ? p.pattern : null,
    greet: p.greet !== false,
  };
}

/**
 * The shell's saved session (its version 1) for an old desktop state blob,
 * or null. Each window is keyed by the item it shows (a windoid keeps its
 * key) with the application that reopens it, its pin and its depth. Show at
 * startup, the 3D Sprite Atlas and each document's face and layer are the
 * site's extras.
 * @param {any} parsed
 */
export function sessionFromDesktopState(parsed) {
  const s = readDesktopState(parsed);
  if (!s) return null;
  /** @type {Record<string, {app: string, pin: object, z?: number}>} */
  const windows = {};
  for (const [key, e] of Object.entries(s.windows)) {
    const it = parseKey(key);
    const app = it ? APPS[it.kind] : null;
    if (!it || !app) continue;
    const item = it.kind === 'windoid' ? key : it.id;
    windows[item] = e.z != null ? { app, pin: e.pin, z: e.z } : { app, pin: e.pin };
  }
  /** @type {Record<string, {face: string|null, layer: number|null}>} */
  const docs = {};
  for (const d of s.docs) {
    if (typeof d?.fileId !== 'string' || !d.fileId) continue;
    docs[d.fileId] = {
      face: typeof d.face === 'string' ? d.face : null,
      layer: Number.isInteger(d.layer) ? d.layer : null,
    };
  }
  const active = parseKey(s.active);
  return {
    v: 1,
    windows,
    active: active && active.kind !== 'windoid' && APPS[active.kind] ? active.id : null,
    pattern: s.pattern,
    extra: { greet: s.greet, showRing: s.showRing, docs },
  };
}

/**
 * The catalog items for an old library: each record with its id, name, times
 * and container (a folder's id, the Trash's, or null for the desktop), at its
 * position in `icons` (an old desktop state's, keyed "doc:<id>") where it has
 * one. A document's data is its record's icon and its bytes' length; a text
 * file's is its built-in key or its text.
 * @param {{folders?: any[], docs?: any[], texts?: any[]}} library
 * @param {Record<string, unknown>} [icons]
 */
export function itemsFromLibrary({ folders = [], docs = [], texts = [] }, icons = {}) {
  /** @type {any[]} */
  const items = [];
  const add = (r, kind, key, parent, data) => {
    if (typeof r?.id !== 'string' || !r.id) return;
    const item = {
      id: r.id,
      name: typeof r.name === 'string' && r.name ? r.name : UNTITLED,
      kind,
      parent: container(parent),
      createdAt: time(r.createdAt),
      modifiedAt: time(r.modifiedAt),
    };
    if (data) item.data = data;
    const at = positionOf(icons, `${key}:${r.id}`);
    items.push(at ? { ...item, ...at } : item);
  };
  for (const f of folders) add(f, FOLDER, 'folder', f?.parent);
  for (const r of docs) {
    // A record the sheet store wrote since has its bytes alone.
    if (typeof r?.name !== 'string') continue;
    add(r, SPRITE, 'doc', r.folder, {
      icon: typeof r?.icon === 'string' ? r.icon : null,
      size: r?.png?.byteLength ?? 0,
    });
  }
  for (const t of texts) {
    const builtin = typeof t?.builtin === 'string' && t.builtin ? t.builtin : null;
    add(
      t,
      TEXT,
      'text',
      t?.folder,
      builtin ? { builtin } : { text: String(t?.text ?? '') }
    );
  }
  return items;
}

/** The Trash icon's position in an old desktop state's `icons`, or null. */
export const trashPosition = (icons = {}) => positionOf(icons, `folder:${TRASH}`);

/**
 * @typedef {{getItem(key: string): string|null, setItem(key: string, value: string): void}} KeyValueStorage
 */

/** The old desktop state's icon positions by key, or {}.
 *  @param {KeyValueStorage} storage */
export function legacyIcons(storage) {
  try {
    return (
      readDesktopState(JSON.parse(storage.getItem(LEGACY_DESKTOP_KEY) ?? 'null'))
        ?.icons ?? {}
    );
  } catch {
    return {};
  }
}

/**
 * Write the shell's session at `key` from the old desktop state, while `key`
 * holds nothing. Returns whether it wrote.
 * @param {KeyValueStorage} storage
 * @param {string} key
 */
export function convertSession(storage, key) {
  try {
    if (storage.getItem(key) != null) return false;
    const session = sessionFromDesktopState(
      JSON.parse(storage.getItem(LEGACY_DESKTOP_KEY) ?? 'null')
    );
    if (!session) return false;
    storage.setItem(key, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}
