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
import { TILE_MIN, TILE_MAX } from 'sprite-machine';
import { sheetShape } from '../../lib/sheet-shape.js';
import { readSheetMeta, missingDefaults, restoreDefaultFiles } from '../../loaders.js';
import { SAMPLES } from '../../lib/sprite-data.js';
import { TEXTS } from '../../texts/index.js';
import { bytesToImageData } from '../../image-io.js';
import { initFolderWindows } from './windows.js';
import { initIcons } from './icons.js';

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

    // Clipboard.
    // Paste alert for an image that is not a sprite sheet, or null if it did not
    // decode.
    const dlgPaste = $('#dlg-paste');
    const pasteMsg = $('#paste-msg');
    on($('#btn-paste-ok'), 'click', () => dlgPaste.close());
    /** @param {{width: number, height: number}|null} image */
    function showPasteAlert(image) {
      const rule =
        `The clipboard image isn’t a sprite sheet: a sheet is a 3 × 2 atlas of ` +
        `square tiles, from ${3 * TILE_MIN} × ${2 * TILE_MIN} to ` +
        `${3 * TILE_MAX} × ${2 * TILE_MAX} pixels.`;
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

    // Returns null when the clipboard cannot be read. pasteSource then uses the
    // slice.
    async function readSystemClipboard() {
      if (!navigator.clipboard?.read) return null;
      try {
        const items = await navigator.clipboard.read();
        let text = null;
        let image = null;
        for (const it of items) {
          if (text == null && it.types.includes('text/plain')) {
            text = await (await it.getType('text/plain')).text();
          }
          if (image == null && it.types.includes('image/png')) {
            image = await it.getType('image/png');
          }
        }
        return { text, image };
      } catch {
        return null;
      }
    }
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
      if (!sheetShape(image.width, image.height).tile) {
        showPasteAlert(image);
        return;
      }
      const { title, transforms, ring: ringMeta } = readSheetMeta(bytes);
      const doc = createDoc();
      doc.loadAtlas(image, transforms);
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
      /** @type {Blob|null} */
      let image = null;
      for (const f of dt.files) {
        if (f.type === 'image/png') {
          image = f;
          break;
        }
      }
      if (!image) {
        for (const it of dt.items) {
          if (it.kind === 'file' && it.type === 'image/png') {
            image = it.getAsFile();
            break;
          }
        }
      }
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
      itemCopy.disabled = textFocused || icons.selection().length === 0;
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
