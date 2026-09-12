// ---------------------------------------------------------------------------
// The FINDER — the desktop's application (docs/apps-plan.md): front while
// the bare desktop or a folder window holds the desktop's active state
// (nothing active reads as the Finder too — the default), its menus File /
// Edit / View / Special (menus.html beside this file) on the bar then and
// off it otherwise (shell/menu-bar.js). This module wires those menus:
// New… (through the Sprite Editor's box — the one New, always a document),
// New Folder, Close (the front folder window), the clipboard's three,
// Arrange Windows, and the Special menu's three — Clean Up, Empty Trash…
// with its alert, and Restore Default Files. Its windows are its own
// (docs/app-windows-plan.md), made here: the folder windows (windows.js,
// windows.html) and the icon layer over the desktop's field and theirs
// (icons.js — the drag, the rubber band, filing, the selection the Edit
// menu reads). What this module adds is the bar's share, and two readings
// main.js hands the desktop state's snapshot (`positions`, `pins`). The
// Desktop Patterns control panel is NOT the Finder's: it is an application
// of its own (apps/desktop-patterns).
//
// COPY / PASTE / SELECT ALL (Sep 10 2026, docs/clipboard-plan.md) are the
// Edit menu's commands over the icons: Copy takes the selected icons (the
// icon layer's selection()) into the clipboard slice as catalog references
// and hands the SYSTEM clipboard what it can carry — the names as text,
// and for exactly one document its stored PNG; Paste reads the system
// clipboard at the pick and lets state/clipboard.js's pasteSource decide:
// the slice's items (copied here — files.copyDoc / copyFolder / copyText
// into the Finder's front container, the pasted icons selected), or a
// picture copied elsewhere — validated against the document format's
// shape (lib/sheet-shape.js) and stored as a new document (its rename box
// open, New Folder's idiom), or refused with the paste alert. A second
// route, the document's `paste` event, carries the browser's own Edit →
// Paste (no keydown — the claimed ⌘V never fires it) and is the ONLY route
// a copied FILE takes (clipboardData.files); it gates on the Finder being
// front as well as on the item, since the Sprite Editor may take that
// event for the pixel clipboard one day. Every system clipboard failure is
// silent (the in-app copy stands; an unreadable paste falls back to the
// slice).
//
// THE GATES: the role is no gate any more — off the bar, a menu's items
// claim no key (the kit's contract), so the Finder's ⌘C is inert in the
// Sprite Editor with nothing written. What remains is each item's own
// reading: New Folder the front container (not the Trash or inside it);
// Close the front folder window; Copy the selection,
// Paste the front container, and all three NO TEXT CONTROL FOCUSED — read
// off focusin / focusout's composed path, since the kit's key equivalents
// check disabled and the match but never where the stroke landed, and an
// enabled Copy would claim ⌘C typed into an icon's rename box; Arrange
// Windows the windows' state (greyed while the screen IS the arrangement);
// Empty Trash… the Trash's contents; Restore Default Files whether any
// built-in is missing at all. Clean Up is the one item with no gate: what
// it reads off the front window is its NAME (Clean Up Window / Clean Up
// Desktop), never its state — docs/clean-up-plan.md. Every handler guards
// on "no modal open" (deps.modalOpen): key equivalents fire app-wide.
// ---------------------------------------------------------------------------

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
    // The application's windows (the header): the folder windows, each
    // reopening at the pin the desktop state remembers for it, and the icon
    // layer over the desktop's field and theirs — its opens are other
    // applications' verbs, read at the pick through the registry.
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
    /** A menu of this application's, by its data-menu. */
    const menu = (name) => {
      const m = menus.find((el) => el.dataset.menu === name);
      if (!m) throw new Error(`apps/finder: missing menu ${name}`);
      return m;
    };
    /** An item within one of this application's menus, by its value. */
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

    // --- the Empty Trash alert ------------------------------------------------------
    // Special → Empty Trash…: the Finder's question, written at show — N is
    // everything the emptying removes (the Trash's whole subtree: documents,
    // folders and text files), the K the trashed documents' stored bytes and
    // the trashed texts' summed and rounded up to whole K, the listing rows'
    // `size` — over Cancel and a default OK. OK empties through the
    // workspace (files.emptyTrash, then every open context holding a removed
    // document reverts, dirty); the listing's refresh does the rest — the
    // icons in the Trash's window go, its count reads 0 items, the can
    // flattens, a trashed folder's open window closes, a trashed text's too,
    // the item greys. A failure lands on the build slice like every file
    // op's.
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

    // --- Copy / Paste / Select All: the Finder's clipboard ----------------------
    // The paste alert (header): a picture off the system clipboard that is
    // not a sprite sheet — the rule, and the picture's own dimensions; an
    // image that will not decode at all gets the rule alone. Nothing lands.
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

    /** The item keys' three prefixes are the icon layer's (icons.js).
     *  @returns {import('../../state/clipboard.js').ClipboardItemRef} */
    const refOf = (key) => {
      const at = key.indexOf(':');
      return {
        kind: /** @type {'doc'|'folder'|'text'} */ (key.slice(0, at)),
        id: key.slice(at + 1),
      };
    };
    /** An item's name off the listing, by kind. */
    const nameOf = (st, it) =>
      it.kind === 'folder'
        ? st.folders.find((f) => f.id === it.id)?.name
        : it.kind === 'text'
          ? st.texts.find((t) => t.id === it.id)?.name
          : st.list.find((r) => r.id === it.id)?.name;

    // Copy: the selected icons — the Trash never among them (selection()
    // leaves it out) — into the slice as references, and the system
    // clipboard handed one item with two representations: the names, one per
    // line (what the Mac's Finder gives a text editor; the token pasteSource
    // matches), and, for exactly one document, its STORED bytes as image/png
    // (the file on disk — an open window's unsaved strokes do not travel;
    // Duplicate is the window's copy). A text file copies as its name alone
    // (its text rides the in-app slice, never the system clipboard — the
    // name IS the token). The selection stays lit. The system write is
    // silent on failure (no secure context, an old browser, Safari past the
    // gesture): the in-app copy has already happened.
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

    // Paste: ONE read of the system clipboard per pick (its text and its
    // PNG, each null when absent; null altogether when it cannot be read —
    // no secure context, a denied or dismissed permission, Safari outside
    // the gesture — and then the slice's items are trusted as they stand),
    // then pasteSource decides. The target is the Finder's front container
    // at the pick — the front folder window, else the desktop (New Folder's
    // rule) — refused for the Trash or a folder inside it (the item is greyed
    // there too, syncGate below). Storage unavailable raises the Save notice.
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
          // 'none': a ⌘V with nothing to paste does nothing, silently.
        }
      } catch (err) {
        build.setError(`Paste failed: ${err.message}`);
      }
    }
    // The slice's items, in its order, each copied into the target by its
    // kind — a reference whose record is gone (emptied from the Trash since)
    // skips silently. The listing's refresh renders each new icon in the
    // target's root at the container's next free cell (the icon layer's
    // fallback — nothing here places anything), and then the pasted icons
    // are the selection.
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
    // A picture the app did not write: VALIDATED before anything is written
    // — it decodes, and its shape is the document format's (a 3×2 atlas of
    // square tiles within the tile range; lib/sheet-shape.js, stricter than
    // the drop on purpose — a paste is "file this", and the catalog takes
    // documents) — else the alert. Accepted, it is stored through the
    // seeding's own path (a doc, loadAtlas, files.save), so the bytes are
    // normalized to the document format whatever the source PNG was; its
    // chunks are read first exactly as a dropped file's are (a surviving
    // Title names it, the transforms reorient it, the ring settings seed
    // its chunk — else the defaults, written fresh). No Title: "untitled",
    // counted over the container's documents, and the icon lands selected
    // with its rename box open — New Folder's idiom for an arrival that
    // needs a name. No window opens: a paste is "file this", a drop is
    // "open this".
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

    // --- menus ------------------------------------------------------------------
    on(menuFile, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      switch (menuDetail(e).value) {
        case 'new':
          // The one New — a document, through the Sprite Editor's box
          // (deps.apps, read at the pick): creating from it opens a window,
          // which brings the Sprite Editor forward.
          deps.apps[SPRITE_EDITOR]?.newDocument();
          break;
        case 'new-folder': {
          // The files slice's createFolder: "untitled folder" — counted up
          // per container — in the front folder window, else on the
          // desktop, its name selected for typing (the icon's rename box,
          // through the icon layer). Storage unavailable raises the notice,
          // like Save. With the Trash's window front the item is greyed
          // (syncGate below) and the slice refuses regardless — a folder is
          // not made in the Trash.
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
          // The Finder's front window: the front folder window (a text
          // window is the Text Viewer's and the control panel Desktop
          // Patterns', each with its own Close on the bar then).
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
          // The selected icons to the clipboard (header; the gate below says
          // when).
          copySelection();
          break;
        case 'paste':
          // Whatever the clipboard holds, into the front container — decided
          // at the pick.
          paste();
          break;
        case 'select-all':
          // Every icon in the front window's field, else the desktop's.
          icons.selectAll(folders.activeFolder());
          break;
      }
    });

    on(menuView, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      // Arrange Windows — the arrange alone (windows.js): the boot placement
      // re-run on the current raster over every window, the hidden windoids
      // included, ready for the next document open. The item is live only
      // while something is off its placement (syncArrange below).
      if (menuDetail(e).value === 'arrange') windows.arrange();
    });

    on(menuSpecial, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      switch (menuDetail(e).value) {
        // Clean Up Window / Clean Up Desktop (docs/clean-up-plan.md): the
        // Finder's front container — the front folder window, else the
        // desktop, New Folder's own reading — onto its lattice, every icon
        // to the nearest free cell, walked there one at a time by the kit
        // (the icon layer's cleanUp). The label says which (syncGate
        // below); the command is the one verb.
        case 'clean-up':
          icons.cleanUp(folders.activeFolder());
          break;
        // Empty Trash…: the Finder's command over the catalog (the alert
        // above); greyed while the Trash is empty (syncTrash below).
        case 'empty-trash':
          showEmptyTrash();
          break;
        // Restore Default Files: the built-ins the library is missing,
        // stored afresh on the desktop (loaders.js restoreDefaultFiles —
        // additive and by name, so nothing already there is touched). The
        // route by which a profile that has already booted gets a read-me
        // added since, the seeding being a one-shot on its own records.
        // No dialog: the icons appearing IS the feedback, and the item
        // greys itself behind them (syncRestore below). A failure lands on
        // the build slice like every file op's.
        case 'restore-defaults':
          restoreDefaultFiles(SAMPLES, TEXTS).catch((err) =>
            build.setError(`Restore Default Files failed: ${err.message}`)
          );
          break;
      }
    });

    // The browser's own Edit → Paste (its menu bar; no keydown, so the kit's
    // claim never sees it) lands as a `paste` event — and it is the ONE route
    // that carries a copied FILE (a .png copied in the Mac's Finder arrives as
    // clipboardData.files, which clipboard.read() never exposes). The same
    // gate as the item (disabled: a focused field — whose own paste this
    // must not eat — or the Trash front), plus the Finder being FRONT (the
    // item is off the bar otherwise, and another application may take the
    // event one day), the same dispatch. clipboardData is readable only
    // during the event, so the read is synchronous and the work follows.
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

    // --- the gates ----------------------------------------------------------------
    // Each item's own reading (header). New Folder greys while the Finder's
    // front window is the Trash's, or a trashed folder's (System 7's own —
    // a folder is not made in the Trash; the slice refuses regardless); it
    // has no key equivalent, so a text control's focus leaves it alone.
    // Close reads the front folder window, re-read on every change of the
    // desktop's active window (vf-activate). The three
    // in the Edit menu read two more things: Copy needs a selected icon that
    // is not the Trash (the icon layer's selection(), re-read on its
    // onSelectionChange: the kit's vf-select, the activation's clear, the
    // chrome bridge's re-select); Paste needs a front container that accepts
    // one (not the Trash, not inside it — New Folder's reading), and NOT
    // "and the clipboard holds something": the system clipboard cannot be
    // read without a pick, so Paste is live whenever the Finder can take one
    // and a ⌘V with nothing to paste does nothing. All three grey while a
    // TEXT CONTROL has focus — an icon's rename box, the New box's Name, a
    // stepper — read off focusin / focusout's COMPOSED path (the kit's
    // fields host their <input> in shadow DOM, so the innermost target is
    // what says it: src/shortcuts.js's idiom for the tool keys), since the
    // kit's key equivalents never look at where the stroke landed and an
    // enabled Copy would claim the field's ⌘C. Greyed, the items claim
    // nothing and the field keeps its keys — the same mechanism that hands
    // ⌘Z to a field when the Sprite Editor's Undo is grey.
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
      // Clean Up is never greyed; what follows the front window is its
      // NAME, System 7's way of saying which container the command is over
      // (docs/clean-up-plan.md §2.4) — the same reading of the front
      // window as Close's above, on the same signals.
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
      // The next focusin says where focus went; between the two, nowhere.
      textFocused = false;
      syncGate();
    });
    syncGate();

    // Empty Trash… is live exactly while the Trash holds something — the
    // Finder's reading, off the listing (a drop into it, an emptying, a drag
    // out all refresh it).
    const itemEmptyTrash = item(menuSpecial, 'empty-trash');
    const syncTrash = () => {
      itemEmptyTrash.disabled = itemCount(files.get(), TRASH) === 0;
    };
    teardown.push(files.subscribe(syncTrash));
    syncTrash();

    // Restore Default Files is live exactly while some built-in is missing —
    // the same reading the command acts on (loaders.js missingDefaults), off
    // the listing, so a restore greys it again behind the icons it just made
    // and an emptied Trash lights it. A trashed built-in counts as present.
    // Broken storage (a private window) greys it: there is no library to
    // restore into, and Save says so in its own words.
    const itemRestore = item(menuSpecial, 'restore-defaults');
    const syncRestore = () => {
      const st = files.get();
      const missing = missingDefaults(st, SAMPLES, TEXTS);
      itemRestore.disabled =
        !st.available || !(missing.docs.length + missing.texts.length);
    };
    teardown.push(files.subscribe(syncRestore));
    syncRestore();

    // Arrange Windows ⌘J — the arrange alone here (the zoom box is a
    // document window's, the Sprite Editor's item's other half): greyed
    // while the screen IS the arrangement (windows.arranged — every visible
    // window at the box its placement would write; the hidden windoids
    // don't count, so a bare desktop reads arranged), live the moment a
    // folder window or a document window behind the Finder sits off its
    // placement. windows.onLayout is the geometry
    // signal; the stores cover the placement's inputs.
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
        /** Every icon position the layer knows, by key — what the desktop
         *  state's snapshot writes (main.js). */
        positions: () => icons.positions(),
        /** Every folder window's pin the Finder knows, by key — the
         *  snapshot's other reading. */
        pins: () => folders.pins(),
        /** Icons moved with no gesture to end the move (a Clean Up's walk
         *  landing its last icon) — the snapshot's cue. Returns the
         *  unsubscribe. @param {() => void} fn */
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
