// Special → Back Up All Files… and Restore from Backup…, and a backup dropped
// on the page: the IO and the questions around state/backup.js, which owns the
// format. A restore asks whether to Add the backup's files beside the
// desktop's or Replace the desktop with them. A document's bytes go to the
// sheet store under its item's id; Replace keeps the backup's ids, so a backup
// restored over the profile that made it puts every icon back in its place.

import { TRASH, isVolume, itemCount } from 'vintage-frames/shell';
import {
  MANIFEST_NAME,
  addPlan,
  backupFilename,
  itemsOf,
  planBackup,
  readManifest,
} from '../../state/backup.js';
import { SPRITE } from '../../state/kinds.js';
import { sheets } from '../../state/sheets.js';
import { builtinText, textOf } from '../../texts/index.js';
import { zipStore, unzip } from '../../lib/zip.js';
import { downloadBlob } from '../../image-io.js';
import { alert } from '../windows.js';

const encode = (/** @type {string} */ s) => new TextEncoder().encode(s);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Write the catalog as a zip and download it, each document with its Title
 * set to its name. An item whose bytes or text are gone is left out of the
 * zip and of the manifest.
 * @param {import('vintage-frames/shell').CatalogState} state
 * @param {{app?: string, date?: Date}} [opts]  app: the version that wrote it.
 */
async function downloadBackup(state, { app = '', date = new Date() } = {}) {
  const { manifest, entries } = planBackup(state, { app, date });
  /** @type {import('../../lib/zip.js').ZipEntry[]} */
  const zipped = [];
  /** @type {Set<string>} */
  const gone = new Set();
  for (const e of entries) {
    if (e.kind === 'dir') {
      zipped.push({ name: e.path, bytes: new Uint8Array(0) });
    } else if (e.kind === 'doc') {
      const bytes = await sheets.bytesOf(e.id).catch(() => null);
      if (bytes) zipped.push({ name: e.path, bytes });
      else gone.add(e.id);
    } else {
      const item = state.items.find((i) => i.id === e.id);
      const text = item ? textOf(item) : null;
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
async function readBackup(file) {
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
  const docs = [];
  for (const r of manifest.docs) {
    const bytes = at.get(prefix + r.path);
    if (bytes) docs.push({ ...r, bytes });
    else missing++;
  }
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

/** "3 documents, 1 folder and 2 read-me files", leaving out what is not there. */
function archivePhrase(archive) {
  const parts = [];
  if (archive.docs.length)
    parts.push(plural(archive.docs.length, 'document', 'documents'));
  if (archive.folders.length)
    parts.push(plural(archive.folders.length, 'folder', 'folders'));
  if (archive.texts.length) {
    parts.push(plural(archive.texts.length, 'read-me file', 'read-me files'));
  }
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    : parts[0];
}

/**
 * Back Up All Files… and Restore from Backup… in the Finder's Special menu,
 * and the drop.
 * @param {import('vintage-frames/shell').FinderApi} finder
 * @param {import('vintage-frames/shell').AppContext} ctx
 */
export function initBackup(finder, ctx) {
  const { catalog } = finder;
  const question = /** @type {any} */ (ctx.dialog('restore'));
  const replace = question.querySelector('[data-replace]');
  /** @param {string} message */
  const say = (message) => void alert(ctx, ctx.dialog('alert'), message);

  /** Everything stored, the Trash's included: every item but the volumes. */
  const libraryCount = () => catalog.get().items.filter((i) => !isVolume(i.id)).length;
  const storageReady = () => {
    if (catalog.get().available) return true;
    void ctx.ask(ctx.dialog('storage-unavailable'));
    return false;
  };

  function restoreQuestion(name, archive, here) {
    const when = archive.exportedAt ? new Date(archive.exportedAt) : null;
    const saved =
      when && !Number.isNaN(when.getTime())
        ? `, saved ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
        : '';
    const head = `“${name}” holds ${archivePhrase(archive)}${saved}.`;
    if (!here) return `${head} Add them to the desktop?`;
    const trashed = itemCount(catalog.get(), TRASH) > 0;
    return (
      `${head} Add them to the desktop, or replace the ` +
      `${plural(here, 'item', 'items')} on it${trashed ? ', the Trash included' : ''}?`
    );
  }

  /** Replace the catalog with the backup's items, their bytes written first
   *  under their ids. Bytes no item holds after go. */
  async function replaceWith(items, bytesOf) {
    const before = catalog
      .get()
      .items.filter((i) => i.kind === SPRITE)
      .map((i) => i.id);
    for (const it of items) {
      if (it.kind === SPRITE) await sheets.putBytes(it.id, bytesOf.get(it.id));
    }
    const editor = ctx.apps['sprite-editor'];
    const run = () => catalog.import({ items }, { mode: 'replace' });
    await (editor ? editor.whileReplacing(run) : run());
    for (const id of before)
      if (!catalog.item(id)) await sheets.remove(id).catch(() => {});
  }

  /** Add the backup's items beside the desktop's, one at a time, so each
   *  document's bytes go under its new id. */
  async function addAll(items, bytesOf) {
    const { order, toTrash } = addPlan(items);
    /** @type {Map<string, string>} the backup's id -> the item made for it */
    const made = new Map();
    for (const it of order) {
      const parent =
        it.parent == null || it.parent === TRASH ? null : (made.get(it.parent) ?? null);
      const item = await catalog.create({
        kind: it.kind,
        name: it.name,
        parent,
        data: it.data,
        at: it.createdAt,
      });
      if (!item) continue;
      made.set(it.id, item.id);
      if (it.kind === SPRITE) await sheets.putBytes(item.id, bytesOf.get(it.id));
    }
    const trashed = toTrash.map((id) => made.get(id)).filter((id) => id != null);
    if (trashed.length) await catalog.move(/** @type {string[]} */ (trashed), TRASH);
  }

  /** A dropped zip or a picked one. @param {File} file */
  async function restore(file) {
    if (ctx.modalOpen() || !storageReady()) return;
    let archive;
    try {
      archive = await readBackup(file);
    } catch (err) {
      say(`“${file.name}” isn’t a backup this app can read: ${err.message}.`);
      return;
    }
    if (!archive.docs.length && !archive.folders.length && !archive.texts.length) {
      say(`“${file.name}” holds no files.`);
      return;
    }
    const here = libraryCount();
    // Replace is offered only over something to replace.
    replace.disabled = !here;
    const mode = await alert(ctx, question, restoreQuestion(file.name, archive, here));
    if (mode !== 'add' && mode !== 'replace') return;
    // Each document's icon and size, from its bytes; one that isn't a sheet
    // is skipped.
    const docs = new Map();
    for (const r of archive.docs) {
      const described = await sheets.describe(r.bytes);
      if ('data' in described) docs.set(r.id, described.data);
    }
    const { items, skipped } = itemsOf(archive, {
      docs,
      shipsText: (key) => builtinText(key) != null,
      places: mode === 'replace',
    });
    const unread = skipped + archive.missing;
    // Nothing came through: a replace would only empty the desktop, so it
    // stands.
    if (items.length) {
      const bytesOf = new Map(archive.docs.map((r) => [r.id, r.bytes]));
      try {
        if (mode === 'replace') await replaceWith(items, bytesOf);
        else await addAll(items, bytesOf);
      } catch (err) {
        say(`Restore failed: ${err.message}.`);
        return;
      }
    }
    if (unread) {
      say(
        `The backup was restored, but ${plural(unread, 'item', 'items')} in it couldn’t be read.`
      );
    }
  }

  finder.addCommand({
    menu: 'special',
    value: 'back-up',
    label: 'Back Up All Files…',
    separator: true,
    run: () => {
      if (!storageReady()) return;
      downloadBackup(catalog.get(), { app: __APP_VERSION__ }).catch((err) =>
        say(`Back Up All Files failed: ${err.message}.`)
      );
    },
    // Something to write.
    enabled: () => catalog.get().available && libraryCount() > 0,
  });

  // Restore from Backup… opens a file picker. It sits off-screen rather than
  // hidden, so click() opens it in every browser.
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.zip,application/zip';
  picker.style.position = 'fixed';
  picker.style.left = '-9999px';
  document.body.append(picker);
  ctx.onDispose(() => picker.remove());
  ctx.on(picker, 'change', () => {
    const f = picker.files?.[0];
    picker.value = ''; // so picking the same file again still fires change
    if (f) void restore(f);
  });
  finder.addCommand({
    menu: 'special',
    value: 'restore-backup',
    label: 'Restore from Backup…',
    run: () => picker.click(),
    // Somewhere to put it.
    enabled: () => catalog.get().available,
  });

  // A zip dropped anywhere on the page. Any other file the page doesn't take
  // is refused, so the browser does not navigate to it.
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  const isArchive = (f) => /\.zip$/i.test(f.name) || f.type === 'application/zip';
  ctx.on(document.body, 'dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  ctx.on(document.body, 'drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const f = /** @type {DragEvent} */ (e).dataTransfer?.files?.[0];
    if (f && isArchive(f)) void restore(f);
  });
}
