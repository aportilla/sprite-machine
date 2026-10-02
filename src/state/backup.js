// The backup archive's format: the paths in it and its desktop.json manifest.
// Pure. Special → Back Up All Files plans an archive here from the catalog,
// and apps/finder/backup.js does the IO.
//
// Paths mirror the folder tree, so an unzipped backup reads as the desktop: a
// document is the PNG File → Download writes, a text file is its text, a folder
// is a directory entry, and the Trash is trash/. A segment is the item's slug
// plus its extension, suffixed -2, -3 … inside one container, so the exact name
// lives in the manifest alone. A row carries its item's place in its
// container, when it has one, so Replace puts the icons back where they were.
// Backups from before the catalog have no places and still read.

import { FOLDER, SPRITE, TEXT, TRASH, textData } from './kinds.js';
import { slugOf } from './names.js';

export const MANIFEST_NAME = 'desktop.json';
export const BACKUP_FORMAT = 'sprite-machine-desktop';
export const BACKUP_VERSION = 1;

/** @typedef {{id: string, name: string, createdAt: number, modifiedAt: number,
 *   left?: number, top?: number}} Row
 * @typedef {Row & {parent: string|null, path: string}} BackupFolder
 * @typedef {Row & {folder: string|null, path: string}} BackupDoc
 * @typedef {BackupDoc & {builtin: string|null}} BackupText
 * @typedef {{format: string, v: number, app: string, exportedAt: string|null,
 *   folders: BackupFolder[], docs: BackupDoc[], texts: BackupText[]}} BackupManifest
 * @typedef {{kind: 'dir'|'doc'|'text', path: string, id: string}} PlanEntry
 *   The archive's entries in write order, the manifest aside.
 * @typedef {{folders: BackupFolder[], docs: (BackupDoc & {bytes: Uint8Array})[],
 *   texts: (BackupText & {text: string})[]}} BackupArchive
 *   A read archive: the manifest's rows, each paired with its entry.
 * @typedef {{id: string, name: string, kind: string, parent: string|null,
 *   createdAt: number, modifiedAt: number, left?: number, top?: number,
 *   data?: unknown}} Item  A catalog item (vintage-frames/shell).
 * @typedef {{items: readonly Item[]}} CatalogState
 */

const isContainer = (kind) => kind === FOLDER || kind === TRASH;

/** The container `parent` resolves to while it is listed, else the desktop
 *  (null), as the catalog resolves it.
 *  @param {CatalogState} state @param {string|null|undefined} parent */
function containerOf(state, parent) {
  const item = parent == null ? undefined : state.items.find((i) => i.id === parent);
  return item && isContainer(item.kind) ? item.id : null;
}

/** An item's place, when it has one. */
const placeOf = (r) =>
  Number.isFinite(r?.left) && Number.isFinite(r?.top) ? { left: r.left, top: r.top } : {};

const pad = (n) => String(n).padStart(2, '0');

/** "sprite-machine-backup-2026-09-17.zip", the day in local time.
 *  @param {Date} [date] */
export const backupFilename = (date = new Date()) =>
  `sprite-machine-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.zip`;

/** The first free path segment for a name in a container: its slug plus `ext`,
 *  then -2, -3 … @param {Set<string>} used @param {string} name
 *  @param {string} ext */
function segment(used, name, ext) {
  const slug = slugOf(name);
  let seg = `${slug}${ext}`;
  for (let n = 2; used.has(seg); n++) seg = `${slug}-${n}${ext}`;
  used.add(seg);
  return seg;
}

/**
 * The archive for a catalog: its manifest and its entries, parents before
 * their children, and in each container its folders, then its documents,
 * then its text files. The Trash is walked like any folder but has no
 * manifest row, so its items carry the folder id `"trash"` and come back to
 * the Trash.
 * @param {CatalogState} state
 * @param {{app?: string, date?: Date}} [opts]  app: the version that wrote it.
 * @returns {{manifest: BackupManifest, entries: PlanEntry[]}}
 */
export function planBackup(state, { app = '', date = new Date() } = {}) {
  /** @type {PlanEntry[]} */
  const entries = [];
  /** @type {BackupManifest} */
  const manifest = {
    format: BACKUP_FORMAT,
    v: BACKUP_VERSION,
    app,
    exportedAt: date.toISOString(),
    folders: [],
    docs: [],
    texts: [],
  };
  const seen = new Set();
  /** @param {string|null} container @param {string} prefix */
  const walk = (container, prefix) => {
    const kids = state.items.filter(
      (i) => i.id !== container && containerOf(state, i.parent) === container
    );
    const used = new Set();
    const row = (i, path) => ({
      id: i.id,
      name: i.name,
      folder: container,
      createdAt: i.createdAt,
      modifiedAt: i.modifiedAt,
      ...placeOf(i),
      path,
    });
    for (const f of kids.filter((i) => isContainer(i.kind))) {
      if (seen.has(f.id)) continue; // a looping chain is walked once
      seen.add(f.id);
      const path = prefix + segment(used, f.name, '/');
      entries.push({ kind: 'dir', path, id: f.id });
      if (f.kind === FOLDER) {
        const { folder: _, ...rest } = row(f, path);
        manifest.folders.push({ ...rest, parent: container });
      }
      walk(f.id, path);
    }
    for (const d of kids.filter((i) => i.kind === SPRITE)) {
      const path = prefix + segment(used, d.name, '.png');
      entries.push({ kind: 'doc', path, id: d.id });
      manifest.docs.push(row(d, path));
    }
    for (const t of kids.filter((i) => i.kind === TEXT)) {
      const path = prefix + segment(used, t.name, '.txt');
      entries.push({ kind: 'text', path, id: t.id });
      manifest.texts.push({ ...row(t, path), builtin: textData(t).builtin });
    }
  };
  walk(null, '');
  return { manifest, entries };
}

/** A required string field. @param {any} v @param {string} what */
function str(v, what) {
  if (typeof v !== 'string' || !v)
    throw new Error(`its desktop.json has a row with no ${what}`);
  return v;
}

/** A time, or 0. @param {any} v */
const time = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** A container reference or a key: a string, or null. @param {any} v */
const ref = (v) => (typeof v === 'string' && v ? v : null);

/**
 * Validate and normalize a desktop.json. Throws an Error whose message says
 * what is wrong with it, for the alert.
 * @param {string} text
 * @returns {BackupManifest}
 */
export function readManifest(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('its desktop.json is not readable');
  }
  if (!parsed || typeof parsed !== 'object' || parsed.format !== BACKUP_FORMAT) {
    throw new Error('it is not a Sprite Machine backup');
  }
  if (!Number.isInteger(parsed.v) || parsed.v < 1) {
    throw new Error('its desktop.json has no version');
  }
  if (parsed.v > BACKUP_VERSION) {
    throw new Error(
      `it was made by a newer version of Sprite Machine (backup version ${parsed.v})`
    );
  }
  for (const key of ['folders', 'docs', 'texts']) {
    if (!Array.isArray(parsed[key])) throw new Error('its desktop.json is incomplete');
  }
  const row = (r) => ({
    id: str(r?.id, 'id'),
    name: str(r?.name, 'name'),
    createdAt: time(r?.createdAt),
    modifiedAt: time(r?.modifiedAt),
    ...placeOf(r),
  });
  return {
    format: BACKUP_FORMAT,
    v: parsed.v,
    app: typeof parsed.app === 'string' ? parsed.app : '',
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null,
    folders: parsed.folders.map((f) => ({
      ...row(f),
      parent: ref(f?.parent),
      path: str(f?.path, 'path'),
    })),
    docs: parsed.docs.map((r) => ({
      ...row(r),
      folder: ref(r?.folder),
      path: str(r?.path, 'path'),
    })),
    texts: parsed.texts.map((t) => ({
      ...row(t),
      folder: ref(t?.folder),
      builtin: ref(t?.builtin),
      path: str(t?.path, 'path'),
    })),
  };
}

/**
 * A read backup as catalog items: its folders, then its documents, then its
 * text files. A document takes its data (its icon and size) from `docs`, by
 * its row's id, and one with none there is skipped and counted: its bytes
 * didn't read as a sheet. A text keeps its built-in's key while the app still
 * ships that text, else its words are stored, so nothing is lost. `places`
 * keeps each row's place, for Replace; without it the items take their
 * containers' free cells, for Add.
 * @param {BackupArchive} archive
 * @param {{docs: ReadonlyMap<string, {icon: string|null, size: number}>,
 *   shipsText: (key: string) => boolean, places: boolean}} opts
 * @returns {{items: Item[], skipped: number}}
 */
export function itemsOf(archive, { docs, shipsText, places }) {
  /** @param {Row} r @param {string} kind @param {string|null} parent @returns {Item} */
  const item = (r, kind, parent) => ({
    id: r.id,
    name: r.name,
    kind,
    parent,
    createdAt: r.createdAt,
    modifiedAt: r.modifiedAt,
    ...(places ? placeOf(r) : {}),
  });
  /** @type {Item[]} */
  const items = archive.folders.map((f) => item(f, FOLDER, f.parent));
  let skipped = 0;
  for (const r of archive.docs) {
    const data = docs.get(r.id);
    if (data) items.push({ ...item(r, SPRITE, r.folder), data });
    else skipped++;
  }
  for (const t of archive.texts) {
    const data =
      t.builtin != null && shipsText(t.builtin)
        ? { builtin: t.builtin }
        : { text: t.text };
    items.push({ ...item(t, TEXT, t.folder), data });
  }
  return { items, skipped };
}

/**
 * The order an Add makes items in one at a time, each container before what
 * it holds, and the archive id each item's parent maps to. Items bound for the
 * Trash, or for a folder the archive doesn't hold, are made on the desktop;
 * `toTrash` lists the ones that then move into the Trash, since nothing is
 * made there.
 * @param {Item[]} items  as itemsOf gives them
 * @returns {{order: Item[], toTrash: string[]}}
 */
export function addPlan(items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  /** @type {Item[]} */
  const order = [];
  const placed = new Set();
  const visit = (/** @type {Item} */ it, /** @type {Set<string>} */ path) => {
    if (placed.has(it.id) || path.has(it.id)) return;
    const parent = it.parent != null ? byId.get(it.parent) : undefined;
    if (parent) visit(parent, new Set([...path, it.id]));
    placed.add(it.id);
    order.push(it);
  };
  for (const it of items) visit(it, new Set());
  return { order, toTrash: items.filter((i) => i.parent === TRASH).map((i) => i.id) };
}
