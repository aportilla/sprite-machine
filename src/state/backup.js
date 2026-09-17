// The backup archive's format: the paths in it and its desktop.json manifest.
// Pure. Special → Back Up All Files plans an archive here and
// apps/finder/backup.js does the IO.
//
// Paths mirror the folder tree, so an unzipped backup reads as the desktop: a
// document is the PNG File → Download writes, a text file is its text, a folder
// is a directory entry, and the Trash is trash/. A segment is the item's slug
// plus its extension, suffixed -2, -3 … inside one container, so the exact name
// lives in the manifest alone.

import { childrenOf, containerOf, slugOf, TRASH } from './files.js';

export const MANIFEST_NAME = 'desktop.json';
export const BACKUP_FORMAT = 'sprite-machine-desktop';
export const BACKUP_VERSION = 1;

/** @typedef {{id: string, name: string, parent: string|null, createdAt: number,
 *   modifiedAt: number, path: string}} BackupFolder
 * @typedef {{id: string, name: string, folder: string|null, createdAt: number,
 *   modifiedAt: number, path: string}} BackupDoc
 * @typedef {BackupDoc & {builtin: string|null}} BackupText
 * @typedef {{format: string, v: number, app: string, exportedAt: string|null,
 *   folders: BackupFolder[], docs: BackupDoc[], texts: BackupText[]}} BackupManifest
 * @typedef {{kind: 'dir'|'doc'|'text', path: string, id: string}} PlanEntry
 *   The archive's entries in write order, the manifest aside.
 * @typedef {{folders: BackupFolder[], docs: (BackupDoc & {bytes: Uint8Array})[],
 *   texts: (BackupText & {text: string})[]}} BackupArchive
 *   A read archive: the manifest's rows, each paired with its entry.
 */

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
 * The archive for a library: its manifest and its entries, parents before
 * their children. The Trash is walked like any folder but has no manifest row,
 * so its items carry the folder id `"trash"` and come back to the Trash.
 * @param {import('./files.js').FilesState} state
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
    const kids = childrenOf(state, container);
    const used = new Set();
    for (const f of kids.folders) {
      if (seen.has(f.id)) continue; // a looping chain is walked once
      seen.add(f.id);
      const path = prefix + segment(used, f.name, '/');
      entries.push({ kind: 'dir', path, id: f.id });
      if (f.id !== TRASH) {
        manifest.folders.push({
          id: f.id,
          name: f.name,
          parent: containerOf(state, f.parent),
          createdAt: f.createdAt,
          modifiedAt: f.modifiedAt,
          path,
        });
      }
      walk(f.id, path);
    }
    for (const r of kids.docs) {
      const path = prefix + segment(used, r.name, '.png');
      entries.push({ kind: 'doc', path, id: r.id });
      manifest.docs.push({
        id: r.id,
        name: r.name,
        folder: containerOf(state, r.folder),
        createdAt: r.createdAt,
        modifiedAt: r.modifiedAt,
        path,
      });
    }
    for (const t of kids.texts) {
      const path = prefix + segment(used, t.name, '.txt');
      entries.push({ kind: 'text', path, id: t.id });
      manifest.texts.push({
        id: t.id,
        name: t.name,
        folder: containerOf(state, t.folder),
        createdAt: t.createdAt,
        modifiedAt: t.modifiedAt,
        builtin: t.builtin,
        path,
      });
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

/** A container reference: a folder id, "trash", or null for the desktop.
 *  @param {any} v */
const container = (v) => (typeof v === 'string' && v ? v : null);

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
  return {
    format: BACKUP_FORMAT,
    v: parsed.v,
    app: typeof parsed.app === 'string' ? parsed.app : '',
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null,
    folders: parsed.folders.map((f) => ({
      id: str(f?.id, 'id'),
      name: str(f?.name, 'name'),
      parent: container(f?.parent),
      createdAt: time(f?.createdAt),
      modifiedAt: time(f?.modifiedAt),
      path: str(f?.path, 'path'),
    })),
    docs: parsed.docs.map((r) => ({
      id: str(r?.id, 'id'),
      name: str(r?.name, 'name'),
      folder: container(r?.folder),
      createdAt: time(r?.createdAt),
      modifiedAt: time(r?.modifiedAt),
      path: str(r?.path, 'path'),
    })),
    texts: parsed.texts.map((t) => ({
      id: str(t?.id, 'id'),
      name: str(t?.name, 'name'),
      folder: container(t?.folder),
      createdAt: time(t?.createdAt),
      modifiedAt: time(t?.modifiedAt),
      builtin: container(t?.builtin),
      path: str(t?.path, 'path'),
    })),
  };
}
