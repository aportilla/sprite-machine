// The Finder: the desktop's application. It creates its folder windows
// (windows.js) and icon layer (icons.js), wires its menus (menus.html), and
// gives main.js the icon positions and folder window pins for the desktop state.
//
// The menu bar detaches these menus while another app is front, which disables
// their shortcuts. Handlers return while a modal is open because shortcuts fire
// app-wide.

import menus from './menus.html?raw';
import { build } from '../../state/build.js';
import { prefs } from '../../state/prefs.js';
import { ring } from '../../state/ring.js';
import { shell, FINDER, SPRITE_EDITOR } from '../../state/shell.js';
import {
  files,
  itemCount,
  descendantsOf,
  isTrashed,
  nextDocName,
  TRASH,
} from '../../state/files.js';
import { workspace } from '../../state/workspace.js';
import { clipboard, pasteSource } from '../../state/clipboard.js';
import { createDoc } from '../../state/doc.js';
import { createRingSettings } from '../../state/ring-settings.js';
import { TILE_MIN, TILE_MAX, LAYER_MAX } from 'sprite-machine';
import { sheetShape } from '../../lib/sheet-shape.js';
import { readSheetMeta, missingDefaults, restoreDefaultFiles } from '../../loaders.js';
import { SAMPLES } from '../../lib/sprite-data.js';
import { TEXTS } from '../../texts/index.js';
import { bytesToImageData } from '../../image-io.js';
import { readSystemClipboard, pastedPng } from '../../system-clipboard.js';
import { initFolderWindows } from './windows.js';
import { initIcons } from './icons.js';
import { downloadBackup, readBackup } from './backup.js';

/** @type {import('../index.js').App} */
export const finder = {
  id: FINDER,
  name: 'Finder',
  menus,
  init({ menus, deps }) {
    const { desktop, windows, modalOpen, showStorage } = deps;
    const folders = initFolderWindows(desktop, windows, { savedPin: deps.windowPin });
    const icons = initIcons(desktop, {
      windows,
      folders,
      apps: deps.apps,
      savedPos: deps.iconPos,
    });
    const $ = (sel) => {
      const el = desktop.querySelector(sel);
      if (!el) throw new Error(`apps/finder: missing element ${sel}`);
      return /** @type {any} */ (el);
    };
    /** One of this app's menus, by data-menu. */
    const menu = (name) => {
      const m = menus.find((el) => el.dataset.menu === name);
      if (!m) throw new Error(`apps/finder: missing menu ${name}`);
      return m;
    };
    /** An item in one of this app's menus, by value. */
    const item = (m, value) => {
      const el = m.querySelector(`vf-menu-item[value="${value}"]`);
      if (!el) throw new Error(`apps/finder: missing item ${value}`);
      return /** @type {any} */ (el);
    };
    const menuFile = menu('file');
    const menuEdit = menu('edit');
    const menuView = menu('view');
    const menuSpecial = menu('special');

    /** @type {(() => void)[]} */
    const teardown = [];
    const on = (el, type, fn) => {
      el.addEventListener(type, fn);
      teardown.push(() => el.removeEventListener(type, fn));
    };
    const menuDetail = (e) => /** @type {CustomEvent} */ (e).detail;

    // Empty Trash alert.
    const dlgEmptyTrash = $('#dlg-empty-trash');
    const emptyTrashMsg = $('#empty-trash-msg');
    function showEmptyTrash() {
      const st = files.get();
      const { docs, folders: dirs, texts: txts } = descendantsOf(st, TRASH);
      const n = docs.length + dirs.length + txts.length;
      if (!n) return;
      const bytes = [...docs, ...txts].reduce((sum, r) => sum + (r.size ?? 0), 0);
      const k = Math.ceil(bytes / 1024);
      emptyTrashMsg.textContent =
        n === 1
          ? `The Trash contains 1 item, which uses ${k}K of disk space. Are you sure you want to permanently remove it?`
          : `The Trash contains ${n} items, which use ${k}K of disk space. Are you sure you want to permanently remove these items?`;
      dlgEmptyTrash.show();
    }
    on($('#btn-empty-trash-cancel'), 'click', () => dlgEmptyTrash.close());
    on($('#btn-empty-trash-ok'), 'click', () => {
      dlgEmptyTrash.close();
      workspace
        .emptyTrash()
        .catch((err) => build.setError(`Empty Trash failed: ${err.message}`));
    });

    // Back Up All Files, and Restore from Backup… or a dropped zip (main.js).
    // The archive waits in `pending` for the Restore question's answer.
    const dlgRestore = $('#dlg-restore-backup');
    const restoreMsg = $('#restore-backup-msg');
    const btnRestoreReplace = $('#btn-restore-replace');
    const dlgRestoreFailed = $('#dlg-restore-failed');
    const restoreFailedMsg = $('#restore-failed-msg');
    /** @type {Awaited<ReturnType<typeof readBackup>>|null} */
    let pending = null;

    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    /** @param {string} msg */
    const showRestoreFailed = (msg) => {
      restoreFailedMsg.textContent = msg;
      dlgRestoreFailed.show();
    };
    on($('#btn-restore-failed-ok'), 'click', () => dlgRestoreFailed.close());

    /** Everything stored anywhere, the Trash and the folders included. */
    const libraryCount = () => {
      const st = files.get();
      return st.list.length + st.texts.length + st.folders.length - 1; // less the Trash row
    };

    function backUp() {
      if (!files.get().available) {
        showStorage();
        return;
      }
      downloadBackup({ app: __APP_VERSION__ }).catch((err) =>
        build.setError(`Back Up All Files failed: ${err.message}`)
      );
    }

    /** "3 documents, 1 folder and 2 read-me files", leaving out what is not
     *  there. */
    function archivePhrase(archive) {
      const parts = [];
      if (archive.docs.length)
        parts.push(plural(archive.docs.length, 'document', 'documents'));
      if (archive.folders.length)
        parts.push(plural(archive.folders.length, 'folder', 'folders'));
      if (archive.texts.length)
        parts.push(plural(archive.texts.length, 'read-me file', 'read-me files'));
      return parts.length > 1
        ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
        : parts[0];
    }

    function restoreQuestion(name, archive) {
      const when = archive.exportedAt ? new Date(archive.exportedAt) : null;
      const saved =
        when && !Number.isNaN(when.getTime())
          ? `, saved ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
          : '';
      const head = `“${name}” holds ${archivePhrase(archive)}${saved}.`;
      const here = libraryCount();
      if (!here) return `${head} Add them to the desktop?`;
      const t = descendantsOf(files.get(), TRASH);
      const trashed = t.docs.length + t.folders.length + t.texts.length;
      return (
        `${head} Add them to the desktop, or replace the ` +
        `${plural(here, 'item', 'items')} on it${trashed ? ', the Trash included' : ''}?`
      );
    }

    /** A dropped zip or a picked one. @param {File} file */
    async function receiveArchive(file) {
      if (modalOpen()) return;
      if (!files.get().available) {
        showStorage();
        return;
      }
      let archive;
      try {
        archive = await readBackup(file);
      } catch (err) {
        showRestoreFailed(
          `“${file.name}” isn’t a backup this app can read: ${err.message}.`
        );
        return;
      }
      if (!archive.docs.length && !archive.folders.length && !archive.texts.length) {
        showRestoreFailed(`“${file.name}” holds no files.`);
        return;
      }
      pending = archive;
      restoreMsg.textContent = restoreQuestion(file.name, archive);
      btnRestoreReplace.disabled = libraryCount() === 0;
      dlgRestore.show();
    }

    /** @param {'merge'|'replace'} mode */
    function restore(mode) {
      const archive = pending;
      pending = null;
      dlgRestore.close();
      if (!archive) return;
      workspace
        .importArchive(archive, { mode })
        .then((res) => {
          const unread = (res?.skipped ?? 0) + archive.missing;
          if (unread) {
            showRestoreFailed(
              `The backup was restored, but ${plural(unread, 'item', 'items')} in it couldn’t be read.`
            );
          }
        })
        .catch((err) => build.setError(`Restore failed: ${err.message}`));
    }
    on($('#btn-restore-cancel'), 'click', () => {
      pending = null;
      dlgRestore.close();
    });
    on(btnRestoreReplace, 'click', () => restore('replace'));
    on($('#btn-restore-add'), 'click', () => restore('merge'));

    // Restore from Backup… reaches the same handler through a file picker. It
    // sits off-screen rather than hidden, so click() opens it in every browser.
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.zip,application/zip';
    picker.style.position = 'fixed';
    picker.style.left = '-9999px';
    document.body.append(picker);
    teardown.push(() => picker.remove());
    on(picker, 'change', () => {
      const f = picker.files?.[0];
      picker.value = ''; // so picking the same file again still fires change
      if (f) receiveArchive(f);
    });

    // Clipboard.
    // Paste alert for an image that is not a sprite sheet, or null if it did not
    // decode.
    const dlgPaste = $('#dlg-paste');
    const pasteMsg = $('#paste-msg');
    on($('#btn-paste-ok'), 'click', () => dlgPaste.close());
    /** @param {{width: number, height: number}|null} image */
    function showPasteAlert(image) {
      const rule =
        `The clipboard image isn’t a sprite sheet: a sheet stacks 1 to ${LAYER_MAX} ` +
        `layers top to bottom, each a 3 × 2 atlas of square tiles from ` +
        `${3 * TILE_MIN} × ${2 * TILE_MIN} to ${3 * TILE_MAX} × ${2 * TILE_MAX} pixels.`;
      pasteMsg.textContent = image
        ? `${rule} This image is ${image.width} × ${image.height}.`
        : rule;
      dlgPaste.show();
    }

    /** Parses an icon key (kind:id, from icons.js) into a clipboard ref.
     *  @returns {import('../../state/clipboard.js').ClipboardItemRef} */
    const refOf = (key) => {
      const at = key.indexOf(':');
      return {
        kind: /** @type {'doc'|'folder'|'text'} */ (key.slice(0, at)),
        id: key.slice(at + 1),
      };
    };
    /** An item's name from the files listing. */
    const nameOf = (st, it) =>
      it.kind === 'folder'
        ? st.folders.find((f) => f.id === it.id)?.name
        : it.kind === 'text'
          ? st.texts.find((t) => t.id === it.id)?.name
          : st.list.find((r) => r.id === it.id)?.name;

    // The system clipboard gets the names, one per line. pasteSource compares
    // that text with the slice's to tell an in-app copy from a foreign one.
    // A single document also gets its stored PNG, without unsaved changes.
    function copySelection() {
      const keys = icons.selection();
      if (!keys.length) return;
      const st = files.get();
      const items = keys.map(refOf);
      const text = items
        .map((it) => nameOf(st, it))
        .filter((n) => n != null)
        .join('\n');
      clipboard.set(items, text);
      writeSystemClipboard(items, text).catch(() => {});
    }
    async function writeSystemClipboard(items, text) {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return;
      /** @type {Record<string, Blob>} */
      const parts = { 'text/plain': new Blob([text], { type: 'text/plain' }) };
      if (items.length === 1 && items[0].kind === 'doc') {
        const png = await files.bytesOf(items[0].id);
        if (png) parts['image/png'] = new Blob([png], { type: 'image/png' });
      }
      await navigator.clipboard.write([new ClipboardItem(parts)]);
    }

    // An unreadable system clipboard reads as null, and pasteSource then uses
    // the slice.
    async function paste() {
      if (!files.get().available) {
        showStorage();
        return;
      }
      const target = folders.activeFolder();
      if (isTrashed(files.get(), target)) return;
      await dispatchPaste(await readSystemClipboard(), target);
    }
    /** @param {{text: string|null, image: Blob|null}|null} system
     *  @param {string|null} target */
    async function dispatchPaste(system, target) {
      try {
        switch (pasteSource(clipboard.get(), system)) {
          case 'items':
            await pasteItems(target);
            break;
          case 'image':
            await pasteImage(/** @type {Blob} */ (system?.image), target);
            break;
          // 'none': nothing to paste.
        }
      } catch (err) {
        build.setError(`Paste failed: ${err.message}`);
      }
    }
    // The icon layer places the new icons. A copy returns null when its record
    // is gone.
    async function pasteItems(target) {
      /** @type {string[]} */
      const keys = [];
      for (const it of clipboard.get().items) {
        const made =
          it.kind === 'folder'
            ? await files.copyFolder(it.id, { parent: target })
            : it.kind === 'text'
              ? await files.copyText(it.id, { folder: target })
              : await files.copyDoc(it.id, { folder: target });
        if (made) keys.push(`${it.kind}:${made.id}`);
      }
      if (keys.length) icons.select(keys);
    }
    // An image copied outside the app is re-encoded as a new document, with
    // metadata from its chunks. No window opens.
    async function pasteImage(blob, target) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let image;
      try {
        image = await bytesToImageData(bytes);
      } catch {
        showPasteAlert(null);
        return;
      }
      const shape = sheetShape(image.width, image.height);
      if (!shape.tile) {
        showPasteAlert(image);
        return;
      }
      const { title, transforms, ring: ringMeta, names } = readSheetMeta(bytes);
      const doc = createDoc();
      doc.loadAtlas(image, transforms, { layers: shape.layers, names });
      const res = await files.save(doc, {
        fileId: null,
        name: title ?? nextDocName(files.get(), target),
        folder: target,
        ring: createRingSettings(ringMeta).get(),
      });
      if (!res) return;
      const key = `doc:${res.id}`;
      icons.select([key]);
      if (title == null) icons.startRename(key);
    }

    // Menus.
    on(menuFile, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      switch (menuDetail(e).value) {
        case 'open':
          icons.openSelection();
          break;
        case 'new':
          deps.apps[SPRITE_EDITOR]?.newDocument();
          break;
        case 'new-folder': {
          // createFolder also refuses a parent in the Trash.
          if (!files.get().available) {
            showStorage();
            break;
          }
          const parent = folders.activeFolder();
          files
            .createFolder({ parent })
            .then((made) => {
              if (made) icons.startRename(`folder:${made.id}`);
            })
            .catch((err) => build.setError(`New Folder failed: ${err.message}`));
          break;
        }
        case 'close': {
          // Folder windows are the only windows the Finder closes.
          const f = folders.activeFolder();
          if (f != null) folders.close(f);
          break;
        }
      }
    });

    on(menuEdit, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      switch (menuDetail(e).value) {
        case 'copy':
          copySelection();
          break;
        case 'paste':
          paste();
          break;
        case 'select-all':
          icons.selectAll(folders.activeFolder());
          break;
      }
    });

    on(menuView, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      if (menuDetail(e).value === 'arrange') windows.arrange();
    });

    on(menuSpecial, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      switch (menuDetail(e).value) {
        case 'clean-up':
          icons.cleanUp(folders.activeFolder());
          break;
        case 'empty-trash':
          showEmptyTrash();
          break;
        case 'restore-defaults':
          restoreDefaultFiles(SAMPLES, TEXTS).catch((err) =>
            build.setError(`Restore Default Files failed: ${err.message}`)
          );
          break;
        case 'back-up':
          backUp();
          break;
        case 'restore-backup':
          picker.click();
          break;
      }
    });

    // The browser's own Edit → Paste fires a paste event with no keydown. It is
    // the only route for a copied file (clipboardData.files). clipboardData is
    // readable only during the event.
    on(document, 'paste', (e) => {
      if (shell.get().frontApp !== FINDER || itemPaste.disabled || modalOpen()) return;
      const dt = /** @type {ClipboardEvent} */ (e).clipboardData;
      if (!dt) return;
      const text = dt.getData('text/plain') || null;
      const image = pastedPng(dt);
      if (text == null && image == null) return;
      e.preventDefault();
      if (!files.get().available) {
        showStorage();
        return;
      }
      const target = folders.activeFolder();
      if (isTrashed(files.get(), target)) return;
      dispatchPaste({ text, image }, target);
    });

    // Gates.
    // The kit's shortcuts ignore focus, so Copy, Paste and Select All are
    // disabled while a text control has focus. Focus is read from the composed
    // path because kit fields keep their <input> in shadow DOM. Paste ignores
    // the clipboard's contents, which cannot be read outside a pick.
    const itemOpen = item(menuFile, 'open');
    const itemClose = item(menuFile, 'close');
    const itemNewFolder = item(menuFile, 'new-folder');
    const itemCopy = item(menuEdit, 'copy');
    const itemPaste = item(menuEdit, 'paste');
    const itemSelectAll = item(menuEdit, 'select-all');
    const itemCleanUp = item(menuSpecial, 'clean-up');
    /** Whether the innermost focused element is a text control. */
    let textFocused = false;
    const syncGate = () => {
      const st = files.get();
      const front = folders.activeFolder();
      // Clean Up is never disabled.
      const cleanUp = front == null ? 'Clean Up Desktop' : 'Clean Up Window';
      if (itemCleanUp.textContent !== cleanUp) itemCleanUp.textContent = cleanUp;
      itemClose.disabled = front == null;
      itemNewFolder.disabled = isTrashed(st, front);
      // Open takes the same selection Copy does, so the Trash is left out; a
      // double-click or a tap pair opens it.
      const nothingLit = textFocused || icons.selection().length === 0;
      itemOpen.disabled = nothingLit;
      itemCopy.disabled = nothingLit;
      itemPaste.disabled = textFocused || isTrashed(st, front);
      itemSelectAll.disabled = textFocused;
    };
    teardown.push(
      folders.onChange(syncGate),
      files.subscribe(syncGate),
      icons.onSelectionChange(syncGate)
    );
    on(desktop, 'vf-activate', syncGate);
    on(document, 'focusin', (e) => {
      const t = e.composedPath()[0];
      const tag = t instanceof Element ? t.tagName : '';
      textFocused = tag === 'INPUT' || tag === 'TEXTAREA';
      syncGate();
    });
    on(document, 'focusout', () => {
      // A following focusin sets it again.
      textFocused = false;
      syncGate();
    });
    syncGate();

    const itemEmptyTrash = item(menuSpecial, 'empty-trash');
    const syncTrash = () => {
      itemEmptyTrash.disabled = itemCount(files.get(), TRASH) === 0;
    };
    teardown.push(files.subscribe(syncTrash));
    syncTrash();

    // missingDefaults counts a trashed built-in as present.
    const itemRestore = item(menuSpecial, 'restore-defaults');
    const syncRestore = () => {
      const st = files.get();
      const missing = missingDefaults(st, SAMPLES, TEXTS);
      itemRestore.disabled =
        !st.available || !(missing.docs.length + missing.texts.length);
    };
    teardown.push(files.subscribe(syncRestore));
    syncRestore();

    // Back Up needs something to write; Restore needs somewhere to put it.
    const itemBackUp = item(menuSpecial, 'back-up');
    const itemRestoreBackup = item(menuSpecial, 'restore-backup');
    const syncBackup = () => {
      const st = files.get();
      itemBackUp.disabled = !st.available || libraryCount() === 0;
      itemRestoreBackup.disabled = !st.available;
    };
    teardown.push(files.subscribe(syncBackup));
    syncBackup();

    // The stores feed the window placement. windows.onLayout covers geometry.
    const itemArrange = item(menuView, 'arrange');
    const syncArrange = () => {
      itemArrange.disabled = windows.arranged();
    };
    teardown.push(
      workspace.subscribe(syncArrange),
      prefs.subscribe(syncArrange),
      ring.subscribe(syncArrange),
      windows.onLayout(syncArrange)
    );
    syncArrange();

    return {
      actions: {
        /** Icon positions by key, for the desktop state snapshot (main.js). */
        positions: () => icons.positions(),
        /** Folder window pins by key, for the snapshot. */
        pins: () => folders.pins(),
        /** Opens a folder's window, or brings it forward. */
        openFolder: (id) => folders.open(id),
        /** Asks whether to add or replace, for a zip dropped on the page. */
        receiveArchive: (file) => receiveArchive(file),
        /** Subscribes to icon moves that end without a gesture, such as a
         *  Clean Up walk. Returns the unsubscribe. @param {() => void} fn */
        onMoved: (fn) => icons.onMoved(fn),
      },
      dispose() {
        for (const fn of teardown) fn();
        icons.dispose();
        folders.dispose();
      },
    };
  },
};
