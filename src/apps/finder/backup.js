// Special → Back Up All Files, and reading a dropped backup: the IO around
// state/backup.js, which owns the format. The Finder holds both ends, as it
// holds the files and folders.

import { files } from '../../state/files.js';
import {
  MANIFEST_NAME,
  backupFilename,
  planBackup,
  readManifest,
} from '../../state/backup.js';
import { zipStore, unzip } from '../../lib/zip.js';
import { downloadBlob } from '../../image-io.js';

const encode = (/** @type {string} */ s) => new TextEncoder().encode(s);

/**
 * Write the library as a zip and download it. A record that has gone between
 * the listing and the read is left out of the zip and of the manifest.
 * @param {{app?: string, date?: Date}} [opts]  app: the version that wrote it.
 */
export async function downloadBackup({ app = '', date = new Date() } = {}) {
  const { manifest, entries } = planBackup(files.get(), { app, date });
  /** @type {import('../../lib/zip.js').ZipEntry[]} */
  const zipped = [];
  /** @type {Set<string>} */
  const gone = new Set();
  for (const e of entries) {
    if (e.kind === 'dir') {
      zipped.push({ name: e.path, bytes: new Uint8Array(0) });
    } else if (e.kind === 'doc') {
      const bytes = await files.bytesOf(e.id);
      if (bytes) zipped.push({ name: e.path, bytes });
      else gone.add(e.id);
    } else {
      const text = await files.textOf(e.id);
      if (text != null) zipped.push({ name: e.path, bytes: encode(text) });
      else gone.add(e.id);
    }
  }
  if (gone.size) {
    manifest.docs = manifest.docs.filter((r) => !gone.has(r.id));
    manifest.texts = manifest.texts.filter((t) => !gone.has(t.id));
  }
  const zip = zipStore(
    [
      { name: MANIFEST_NAME, bytes: encode(JSON.stringify(manifest, null, 2)) },
      ...zipped,
    ],
    { date }
  );
  downloadBlob(new Blob([zip], { type: 'application/zip' }), backupFilename(date));
}

/**
 * Read a file as a backup: the manifest's rows, each paired with its entry.
 * One wrapping folder is allowed, so a backup unzipped and zipped again still
 * reads. Throws an Error whose message says what is wrong with the file.
 * @param {File} file
 * @returns {Promise<import('../../state/backup.js').BackupArchive
 *   & {exportedAt: string|null, missing: number}>}
 *   missing: rows whose entry is not in the zip.
 */
export async function readBackup(file) {
  let entries;
  try {
    entries = await unzip(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error('it is not a zip archive');
  }
  // __MACOSX holds the resource forks the Finder's own compress adds.
  const usable = entries.filter((e) => !e.dir && !e.name.startsWith('__MACOSX/'));
  const found = usable.find(
    (e) => e.name === MANIFEST_NAME || e.name.endsWith(`/${MANIFEST_NAME}`)
  );
  if (!found) throw new Error(`there is no ${MANIFEST_NAME} in it`);
  const prefix = found.name.slice(0, -MANIFEST_NAME.length);
  const text = new TextDecoder();
  const manifest = readManifest(text.decode(found.bytes));
  const at = new Map(usable.map((e) => [e.name, e.bytes]));
  let missing = 0;

  /** @type {(import('../../state/backup.js').BackupDoc & {bytes: Uint8Array})[]} */
  const docs = [];
  for (const r of manifest.docs) {
    const bytes = at.get(prefix + r.path);
    if (bytes) docs.push({ ...r, bytes });
    else missing++;
  }
  /** @type {(import('../../state/backup.js').BackupText & {text: string})[]} */
  const texts = [];
  for (const t of manifest.texts) {
    const bytes = at.get(prefix + t.path);
    // A built-in's text is the app's, so its entry may be absent.
    if (!bytes && t.builtin == null) {
      missing++;
      continue;
    }
    texts.push({ ...t, text: bytes ? text.decode(bytes) : '' });
  }
  return {
    folders: manifest.folders,
    docs,
    texts,
    exportedAt: manifest.exportedAt,
    missing,
  };
}
