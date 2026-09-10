// ---------------------------------------------------------------------------
// Menu + dialog wiring for the desktop shell: vf-menu-select → store/file
// actions, checkmark + enabled sync, the View menu's open-windows section
// (one item per open document window, reconciled off the workspace — the
// active one checked, a pick bringing its window forward), and every dialog
// flow (About, New, the shared name prompt, Tile Size, the
// unsaved-changes alert, the
// storage-unavailable notice, the Export 3D Model… dialog — a scale in
// voxels per meter, a lit / unlit popup and two readouts over an Export
// that writes the model as one glb, «slug».glb, its skin embedded from
// bytes (the engine's modelToGlb through scene/model-export.js) — and the Export Sprite
// Atlas… dialog: the 3D Sprite Atlas windoid's settings as a form, bound
// two-way to the ring slice (a change moves the strip behind the modal at
// once; Cancel doesn't revert — the strip IS the preview), whose Export
// saves the strip's exact sheet as «slug»-atlas.zip: the sheet PNG (with
// the ring's metadata chunk) and its TexturePacker JSON, siblings by name
// in one stored zip — a browser gives one download per gesture. File →
// Download is the source path.
// Behavior only — the markup lives in
// index.html, the aesthetics in the kit.
//
// MULTI-DOCUMENT GRAMMAR: File actions target the ACTIVE workspace context;
// New… / an icon's open / a drop always open a NEW window (opening never
// discards anything — the dirty check moved entirely to the close paths);
// opening an already-open stored doc activates its existing window. Quit
// walks every open document, one unsaved-changes alert per dirty one.
// File → New… ⌃N raises the New dialog (a name, and an empty atlas at a
// chosen tile size or a built-in template as a fresh copy) and is the ONE
// New — the document's, in either role. A STORED document opens from its
// icon alone (a double-click; there is no Open item and no listing dialog —
// retired Sep 9 2026, the desktop being the file browser): openDoc below is
// that path, handed to the icon layer through the returned `actions`. The
// built-ins are otherwise ordinary stored documents (seeded at the
// first-ever boot — loaders.js), so the desktop icons know nothing special
// about them.
//
// The DIRTY CHECK has one funnel: `confirmDiscard(ctx, next)` — run `next`
// now if that document is clean, else raise the "Save changes before
// closing?" Yes / No / Cancel box (activating its window first, so the question points at what the
// user sees) and run it (after a save, or without one) only when the user
// chooses.
//
// Menu key equivalents are the KIT's (`shortcut` on vf-menu-item + the bar's
// `shortcuts` grant); a shortcut lands here as an ordinary vf-menu-select.
// Because those fire app-wide, every action guards on "no modal open" — a
// pointer can't reach a menu under a modal, so the guard only ever blocks
// re-entrant shortcuts (⌘S inside the save prompt).
//
// COPY / PASTE / SELECT ALL (Sep 10 2026, docs/clipboard-plan.md) are the
// Edit menu's FINDER-ROLE commands, over the icons: Copy takes the selected
// icons (the icon layer's selection()) into the clipboard slice as catalog
// references and hands the SYSTEM clipboard what it can carry — the names
// as text, and for exactly one document its stored PNG; Paste reads the
// system clipboard at the pick and lets state/clipboard.js's pasteSource
// decide: the slice's items (copied here — files.copyDoc / copyFolder into
// the Finder's front container, the pasted icons selected), or a picture
// copied elsewhere — validated against the document format's shape
// (lib/sheet-shape.js) and stored as a new document (its rename box open,
// New Folder's idiom), or refused with the paste alert. A second route,
// the document's `paste` event, carries the browser's own Edit → Paste (no
// keydown — the claimed ⌘V never fires it) and is the ONLY route a copied
// FILE takes (clipboardData.files). The gate is syncGate's: the Finder
// role, the selection / the front container, and NO TEXT CONTROL FOCUSED —
// read off focusin / focusout's composed path, since the kit's key
// equivalents check disabled and the match but never where the stroke
// landed, and an enabled Copy would claim ⌘C typed into an icon's rename
// box. Every system clipboard failure is silent (the in-app copy stands;
// an unreadable paste falls back to the slice).
// ---------------------------------------------------------------------------

import { session } from '../state/session.js';
import { prefs } from '../state/prefs.js';
import { build } from '../state/build.js';
import { shell } from '../state/shell.js';
import {
  ring,
  ringMetaChunks,
  texturePackerJson,
  RING_MAX_VIEWS,
  RING_MIN_SIZE,
  RING_MAX_SIZE,
} from '../state/ring.js';
import {
  files,
  childrenOf,
  descendantsOf,
  isTrashed,
  nextDocName,
  TRASH,
  UNTITLED,
  docFilename,
  ringFilename,
  ringBasename,
  modelFilename,
  slugOf,
} from '../state/files.js';
import { workspace, followActive } from '../state/workspace.js';
import { clipboard, pasteSource } from '../state/clipboard.js';
import { createDoc } from '../state/doc.js';
import { createRingSettings } from '../state/ring-settings.js';
import { TILE_MIN, TILE_MAX, clampTile, setTextChunks } from 'sprite-machine';
import { SAMPLES } from '../lib/sprite-data.js';
import { ringFrame, ringSheet, ringAnchor, ringYaws } from '../lib/ring.js';
import { sheetShape } from '../lib/sheet-shape.js';
import { zipStore } from '../lib/zip.js';
import { loadSample, loadBlank, readSheetMeta } from '../loaders.js';
import {
  downloadPngBytes,
  downloadBlob,
  canvasToPngBytes,
  bytesToImageData,
} from '../image-io.js';

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {ReturnType<typeof import('./windows.js').initWindows>} windows
 * @param {{
 *   patterns: ReturnType<typeof import('./patterns.js').initPatterns>,
 *   ring: ReturnType<typeof import('../scene/ring.js').initRing>,
 *   model: ReturnType<typeof import('../scene/model-export.js').initModelExport>,
 *   folders: ReturnType<typeof import('./folders.js').initFolders>,
 *   icons: ReturnType<typeof import('./icons.js').initIcons>,
 * }} panels
 *   The panel windows a menu item opens (the Desktop Patterns control panel,
 *   the folder windows — the Finder's), the 3D Sprite Atlas's renderer
 *   follower (Export Sprite Atlas… renders through it), the 3D model
 *   export's subject (Export 3D Model… writes its glb through it), and the
 *   icon layer (New Folder's rename box).
 */
export function initMenus(desktop, windows, panels) {
  const { folders, icons } = panels;
  const $ = (sel) => {
    const el = desktop.querySelector(sel);
    if (!el) throw new Error(`shell/menus: missing element ${sel}`);
    return /** @type {any} */ (el);
  };

  /** @type {(() => void)[]} */
  const teardown = [];
  const on = (el, type, fn) => {
    el.addEventListener(type, fn);
    teardown.push(() => el.removeEventListener(type, fn));
  };
  const menuDetail = (e) => /** @type {CustomEvent} */ (e).detail;

  // A shortcut-triggered action must not fire under an open modal (the
  // Colors picker lives in shadow DOM, so it's checked via its session flag).
  const modalOpen = () =>
    session.get().pickerOpen || !!desktop.querySelector('vf-dialog[open]');

  // --- dialogs ----------------------------------------------------------------
  const dlgAbout = $('#dlg-about');
  const dlgNew = $('#dlg-new');
  const dlgName = $('#dlg-name');
  const dlgTile = $('#dlg-tile');
  const dlgUnsaved = $('#dlg-unsaved');
  const dlgEmptyTrash = $('#dlg-empty-trash');
  const dlgPaste = $('#dlg-paste');
  const dlgStorage = $('#dlg-storage');
  const dlgExportModel = $('#dlg-export-model');
  const dlgExportAtlas = $('#dlg-export-atlas');

  // The About box — Sprite Machine → About…, and the BOOT GREETING (main.js
  // parks a load with no document to open on it: the classic launch splash;
  // OK, Escape, or a click anywhere outside the box leaves the bare desktop,
  // nothing activates). The click-away is the kit's own `light-dismiss` —
  // the markup's attribute on this one dialog, so nothing here listens for
  // it (its vf-close arrives with reason 'outside', should a click-away ever
  // need telling from OK; the box holds no pending state). The copy is
  // the markup's; the version and date lines are BUILD facts (vite.config.js
  // `define`: package.json's version, HEAD's commit date), written once here
  // so the markup never carries a stale number.
  $('#about-version').textContent = `version ${__APP_VERSION__}`;
  $('#about-date').textContent = __APP_DATE__;
  const showAbout = () => dlgAbout.show();
  on($('#btn-about-ok'), 'click', () => dlgAbout.close());
  on($('#btn-storage-ok'), 'click', () => dlgStorage.close());

  // --- Export 3D Model… -------------------------------------------------------
  // The model as ONE glb (the engine's gltf.js, through the export subject in
  // scene/model-export.js — the rebuilder's current mesh, its skin embedded
  // from bytes): a scale field, voxels per meter (glTF is in meters, and ten
  // a meter makes the forty-voxel Car four meters long — the parked form's
  // "units per voxel" turned over, Sep 7 2026), a lighting popup (lit, the
  // 3D View's flat-shaded metallic-roughness; unlit, the KHR_materials_unlit
  // extension — the paint exact under no light), and two readouts: the model
  // (its triangles and skin) and its extent in meters at the scale typed,
  // live with the field and with every rebuild. The fields are the dialog's
  // own for the session (the markup's ten and lit every load; nothing
  // persists — the export is a derivation, the scale a reader's choice).
  // Export is enabled whenever a model exists, like the atlas's; a failure
  // lands on the build slice like Download's.
  const modelScale = $('#model-scale');
  const modelLighting = $('#model-lighting');
  const modelStats = $('#model-stats');
  const modelSize = $('#model-size');
  const btnExportModelOk = $('#btn-export-model-ok');
  // A NaN (the field mid-edit) keeps the last committed scale.
  let lastScale = Number(modelScale.value) || 1;
  const voxelsPerMeter = () => {
    const n = Math.round(Number(modelScale.value));
    if (Number.isFinite(n) && n >= 1) lastScale = n;
    return lastScale;
  };
  const metres = (v) => String(Math.round(v * 100) / 100);
  const seedModelDialog = () => {
    const st = panels.model.stats();
    if (st) {
      const vpm = voxelsPerMeter();
      const skin = st.skin ? `, ${st.skin.width} × ${st.skin.height} skin` : '';
      modelStats.textContent = `${st.triangles.toLocaleString('en-US')} triangles${skin}`;
      modelSize.textContent = st.extent
        ? `${st.extent.map((v) => metres(v / vpm)).join(' × ')} m`
        : '—';
    } else {
      modelStats.textContent = '—';
      modelSize.textContent = '—';
    }
    btnExportModelOk.disabled = !st;
  };
  const syncModelDialog = () => {
    if (dlgExportModel.open) seedModelDialog();
  };
  function showModelDialog() {
    seedModelDialog();
    dlgExportModel.show();
  }
  teardown.push(build.subscribe(syncModelDialog));
  on(modelScale, 'vf-change', syncModelDialog);
  on($('#btn-export-model-cancel'), 'click', () => dlgExportModel.close());
  on(btnExportModelOk, 'click', () => {
    const ctx = workspace.active();
    if (!ctx) return;
    try {
      const glb = panels.model.exportGlb({
        name: ctx.name,
        voxelsPerMeter: voxelsPerMeter(),
        unlit: modelLighting.value === 'unlit',
        generator: `sprite-machine ${__APP_VERSION__}`,
      });
      if (!glb) return;
      downloadBlob(
        new Blob([glb], { type: 'model/gltf-binary' }),
        modelFilename(ctx.name)
      );
      dlgExportModel.close();
    } catch (err) {
      build.setError(`Export failed: ${err.message}`);
    }
  });

  // The one name-prompt dialog, two uses (first save / rename): resolves the
  // committed name, or null on Cancel/Escape — the vf-close event is the
  // single resolution point, so no path can resolve twice. The default
  // button is DISABLED while the field holds no name (an empty name is
  // refused, like the icon rename — the classic Save As greyed its Save the
  // same way): re-read on every keystroke and on open, so a first save
  // opens with Save grey over an empty field and a rename opens live over
  // the current name. The dialog is a plain-frame box (no bar), so the
  // per-use text is the caption over the field plus the accessible label —
  // never `heading`, which a plain frame would draw as a body-top title.
  const nameField = $('#name-field');
  const nameCaption = $('#name-caption');
  const btnNameOk = $('#btn-name-ok');
  const NAME_PROMPTS = {
    save: { label: 'Save', caption: 'Save document as:', ok: 'Save' },
    rename: { label: 'Rename', caption: 'Rename document to:', ok: 'Rename' },
  };
  const nameValid = () => String(nameField.value ?? '').trim() !== '';
  const syncNameOk = () => {
    btnNameOk.disabled = !nameValid();
  };
  let namePending = null; // { resolve, value } while the dialog is up
  /** @param {'save'|'rename'} use  @param {string} initial */
  function promptName(use, initial) {
    const p = NAME_PROMPTS[use];
    dlgName.label = p.label;
    nameCaption.textContent = p.caption;
    btnNameOk.textContent = p.ok;
    nameField.value = initial;
    syncNameOk();
    dlgName.show();
    nameField.focus();
    return new Promise((resolve) => {
      namePending = { resolve, value: null };
    });
  }
  on(nameField, 'vf-input', syncNameOk);
  on(btnNameOk, 'click', () => {
    if (!nameValid()) return;
    if (namePending) namePending.value = String(nameField.value).trim();
    dlgName.close();
  });
  on($('#btn-name-cancel'), 'click', () => dlgName.close());
  on(nameField, 'keydown', (e) => {
    // Enter commits only what Save would accept — the button's own gate.
    if (e.key !== 'Enter' || !nameValid()) return;
    // Cancel the key: the click closes the prompt DURING this keydown, and
    // the native <dialog> then hands focus back to whatever opened it —
    // after a close-box → Save changes? → Yes chain that is the window's
    // close-box BUTTON — and the same key's keypress would activate it:
    // a second Close on a document whose save is still in flight (hence
    // still dirty), which re-raised the Save-changes box over the save
    // (Aug 2026). A cancelled keydown has no keypress.
    e.preventDefault();
    btnNameOk.click();
  });
  on(dlgName, 'vf-close', () => {
    const p = namePending;
    namePending = null;
    p?.resolve(p.value);
  });

  // The unsaved-changes alert. `discardPending` holds the context asked
  // about and the action the user was attempting; each button takes it
  // before closing (vf-close only clears a leftover — the Escape path).
  const unsavedMsg = $('#unsaved-msg');
  let discardPending = null; // { ctx, next }
  // Contexts whose save-then-continue is in flight (saveThen): a document
  // asked about and answered Yes stays dirty until its async save lands, and
  // a second close request in that window (a stray key activation, a double
  // click on the close box) must not ask again — the first chain is already
  // doing what the second would.
  const saving = new Set();
  function confirmDiscard(ctx, next) {
    if (!ctx || !ctx.dirty) {
      next();
      return;
    }
    if (saving.has(ctx.key) || dlgUnsaved.open) return;
    // Point the question at what the user sees: the asked-about document's
    // window comes forward first (the System 7 quit cascade's behavior).
    windows.activateContext(ctx.key);
    discardPending = { ctx, next };
    unsavedMsg.textContent = `Save changes to “${ctx.name}” before closing?`;
    dlgUnsaved.show();
  }
  on($('#btn-unsaved-dont'), 'click', () => {
    const p = discardPending;
    discardPending = null;
    dlgUnsaved.close();
    p?.next();
  });
  on($('#btn-unsaved-cancel'), 'click', () => {
    discardPending = null;
    dlgUnsaved.close();
  });
  on($('#btn-unsaved-save'), 'click', () => {
    const p = discardPending;
    discardPending = null;
    dlgUnsaved.close();
    if (p) saveThen(p.ctx, p.next);
  });
  on(dlgUnsaved, 'vf-close', () => {
    discardPending = null;
  });

  // The Empty Trash alert (Sprite Machine → Empty Trash…): the Finder's
  // question, written at show — N is everything the emptying removes (the
  // Trash's whole subtree, documents and folders), the K the trashed
  // documents' stored bytes summed and rounded up to whole K, the listing
  // row's `size` — over Cancel and a default OK. OK empties through the
  // workspace (files.emptyTrash, then every open context holding a removed
  // document reverts, dirty); the listing's refresh does the rest — the
  // icons in the Trash's window go, its count reads 0 items, the can
  // flattens, a trashed folder's open window closes, the item greys. A
  // failure lands on the build slice like every file op's.
  const emptyTrashMsg = $('#empty-trash-msg');
  function showEmptyTrash() {
    const st = files.get();
    const { docs, folders: dirs } = descendantsOf(st, TRASH);
    const n = docs.length + dirs.length;
    if (!n) return;
    const k = Math.ceil(docs.reduce((sum, r) => sum + (r.size ?? 0), 0) / 1024);
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

  /** The item keys' two prefixes are the icon layer's (shell/icons.js). */
  const refOf = (key) =>
    key.startsWith('folder:')
      ? { kind: /** @type {const} */ ('folder'), id: key.slice('folder:'.length) }
      : { kind: /** @type {const} */ ('doc'), id: key.slice('doc:'.length) };

  // Copy: the selected icons — the Trash never among them (selection()
  // leaves it out) — into the slice as references, and the system
  // clipboard handed one item with two representations: the names, one per
  // line (what the Mac's Finder gives a text editor; the token pasteSource
  // matches), and, for exactly one document, its STORED bytes as image/png
  // (the file on disk — an open window's unsaved strokes do not travel;
  // Duplicate is the window's copy). The selection stays lit. The system
  // write is silent on failure (no secure context, an old browser, Safari
  // past the gesture): the in-app copy has already happened.
  function copySelection() {
    const keys = icons.selection();
    if (!keys.length) return;
    const st = files.get();
    const items = keys.map(refOf);
    const text = items
      .map((it) =>
        it.kind === 'folder'
          ? st.folders.find((f) => f.id === it.id)?.name
          : st.list.find((r) => r.id === it.id)?.name
      )
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
      for (const item of items) {
        if (text == null && item.types.includes('text/plain')) {
          text = await (await item.getType('text/plain')).text();
        }
        if (image == null && item.types.includes('image/png')) {
          image = await item.getType('image/png');
        }
      }
      return { text, image };
    } catch {
      return null;
    }
  }
  async function paste() {
    if (!files.get().available) {
      dlgStorage.show();
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
    const { title, transforms, ring } = readSheetMeta(bytes);
    const doc = createDoc();
    doc.loadAtlas(image, transforms);
    const res = await files.save(doc, {
      fileId: null,
      name: title ?? nextDocName(files.get(), target),
      folder: target,
      ring: createRingSettings(ring).get(),
    });
    if (!res) return;
    const key = `doc:${res.id}`;
    icons.select([key]);
    if (title == null) icons.startRename(key);
  }

  // --- save / open flows ------------------------------------------------------
  // Save a context, then run `next`. An untitled doc prompts for its name
  // first; a Cancel there cancels the whole chain (System 7 semantics).
  async function saveThen(ctx, next) {
    if (!files.get().available) {
      dlgStorage.show();
      return;
    }
    saving.add(ctx.key);
    try {
      if (ctx.fileId) {
        await workspace.save(ctx.key);
      } else {
        const initial = ctx.name;
        const name = await promptName(
          'save',
          initial === UNTITLED || /^untitled \d+$/.test(initial) ? '' : initial
        );
        if (name == null) return;
        await workspace.save(ctx.key, name);
      }
      next?.();
    } catch (err) {
      build.setError(`Save failed: ${err.message}`);
    } finally {
      saving.delete(ctx.key);
    }
  }

  // Opening NEVER discards: a stored doc opens once and re-activates
  // thereafter (one window per document).
  const openDoc = async (id) => {
    try {
      const res = await workspace.openStored(id);
      if (res) windows.activateContext(res.ctx.key);
    } catch (err) {
      build.setError(`Couldn't open the document: ${err.message}`);
    }
  };

  // Close one document (dirty-checked). The window goes with the context;
  // closing the last one deactivates the application via the kit (no
  // document window left to hold active).
  const closeContext = (ctx) =>
    confirmDiscard(ctx, () => {
      workspace.close(ctx.key);
    });

  // Quit: the System 7 cascade — every open document in turn, one
  // unsaved-changes alert per dirty one (its window brought forward as it's
  // asked about); Cancel anywhere aborts the rest. A completed quit leaves
  // the bare desktop, the windoid arrangement intact.
  const quit = () => {
    const ctxs = workspace.get().contexts;
    if (!ctxs.length) return;
    const ctx = workspace.active() ?? ctxs[ctxs.length - 1];
    confirmDiscard(ctx, () => {
      workspace.close(ctx.key);
      quit();
    });
  };

  // --- the New dialog ---------------------------------------------------------
  // Classic Photoshop's New box (Sep 9 2026): a Name over the Settings group —
  // the template popup and the tile size — with OK over Cancel at the
  // right. The NAME seeds with the next untitled name and FOLLOWS the
  // template while untouched (Cube → "Cube", back to Empty → "untitled"),
  // so a template copy still opens wearing its name; once typed in it is
  // the user's and a template pick leaves it alone. The document opens
  // UNSAVED under it — a first Save prompts with the name (saveThen), and
  // explicit Save is still what puts it in the library. The TEMPLATES:
  // Empty Document (an all-transparent atlas at the chosen tile size) or a
  // built-in sample as a fresh copy. The tile field is live for Empty only —
  // a template's art has a NATIVE tile size, and a retile crops/pads rather
  // than scales, so a template shows its own size disabled. OK is greyed
  // while the name is blank (the Save As prompt's rule); Return anywhere
  // is OK by the dialog grammar. The retired list-box version (a template
  // list over a tile field and an atlas-size readout, Create / Cancel in
  // the footer) captured no name.
  const newName = $('#new-name');
  const newTemplate = $('#new-template');
  const newTile = $('#new-tile');
  const btnNewOk = $('#btn-new-ok');
  newTile.min = TILE_MIN;
  newTile.max = TILE_MAX;
  const BLANK_TILE = 40; // the classic default (a 120×80 atlas)
  const BLANK = 'blank';
  // The popup's options, built once: the samples are static. `value` goes
  // on as an attribute so the option is addressable by it.
  const option = (value, text) => {
    const o = document.createElement('vf-option');
    o.setAttribute('value', value);
    o.textContent = text;
    return o;
  };
  newTemplate.replaceChildren(
    option(BLANK, 'Empty Document'),
    ...SAMPLES.map((s, i) => option(`sample:${i}`, s.name))
  );
  /** The picked template's sample, or null for Empty Document. */
  const pickedSample = () => {
    const v = String(newTemplate.value);
    return v === BLANK ? null : SAMPLES[+v.slice('sample:'.length)];
  };
  const typedName = () => String(newName.value ?? '').trim();
  // Per visit: the Empty Document size, remembered across template flips
  // (a template shows its own size in the shared field), and whether the
  // name is still the dialog's own — following the template — or typed.
  let blankTile = BLANK_TILE;
  let nameAuto = true;

  const syncNewForm = () => {
    const sample = pickedSample();
    if (sample) {
      newTile.disabled = true;
      newTile.value = String(sample.tile);
    } else {
      if (newTile.disabled) newTile.value = String(blankTile); // back from a template
      newTile.disabled = false;
      blankTile = clampTile(+newTile.value || BLANK_TILE);
    }
    btnNewOk.disabled = typedName() === '';
  };
  function showNewDialog() {
    // Reset per open (predictable over remembered): Empty at the default,
    // the next untitled name, the name following the template.
    newTemplate.value = BLANK;
    newTile.disabled = false;
    newTile.value = String(BLANK_TILE);
    blankTile = BLANK_TILE;
    nameAuto = true;
    newName.value = workspace.nextUntitledName();
    syncNewForm();
    dlgNew.show();
  }
  async function createFromNewDialog() {
    const name = typedName();
    if (!name) return;
    const sample = pickedSample();
    dlgNew.close();
    const ctx = sample
      ? await loadSample(sample, { name })
      : loadBlank(clampTile(+newTile.value || BLANK_TILE), name);
    if (ctx) windows.activateContext(ctx.key);
  }
  on(newTemplate, 'vf-change', () => {
    if (nameAuto) newName.value = pickedSample()?.name ?? workspace.nextUntitledName();
    syncNewForm();
  });
  on(newName, 'vf-input', () => {
    nameAuto = false;
    syncNewForm();
  });
  on(newTile, 'vf-change', syncNewForm);
  on(btnNewOk, 'click', createFromNewDialog);
  on($('#btn-new-cancel'), 'click', () => dlgNew.close());

  // --- the Tile Size dialog ---------------------------------------------------
  // Edit → Tile Size…: the ACTIVE document's square tile size behind the
  // Colors dialog's pending model — the field is seeded from the document
  // at show and read back at OK, so a step or a typed value moves nothing
  // while the box is up; Cancel (Escape) leaves the document as it was. The
  // kit's number field mirrors the typed text into `value` on every
  // keystroke and clamps only on its own commit, so OK reads the raw text
  // and clamps it here — the same whether Return fired the default button
  // (the dialog grammar) or the mouse did. An empty or unparsable field OKs
  // to nothing. The retired File → Properties… (Sep 9 2026) retiled on
  // every vf-change of its stepper, the canvas moving behind the modal.
  const tileField = $('#tile-size');
  tileField.min = TILE_MIN;
  tileField.max = TILE_MAX;
  function showTileDialog() {
    const d = workspace.active()?.doc.get();
    if (!d) return;
    tileField.value = String(d.tileW);
    dlgTile.show();
  }
  const commitTileDialog = () => {
    dlgTile.close();
    const ctx = workspace.active();
    if (!ctx) return;
    const typed = Math.round(Number(tileField.value));
    if (!(typed >= 1)) return;
    const n = clampTile(typed);
    if (n !== ctx.doc.get().tileW) {
      // A square, centered, undoable resize — on the active document, in
      // its own history, one whole-sheet step.
      ctx.history.withAtlasSnapshot(() => ctx.doc.resizeTiles(n, n));
    }
  };
  on($('#btn-tile-cancel'), 'click', () => dlgTile.close());
  on($('#btn-tile-ok'), 'click', commitTileDialog);

  // --- the Export Sprite Atlas dialog ----------------------------------------
  // The 3D Sprite Atlas windoid's settings as a form, bound LIVE to the ring
  // slice: each field's vf-change is the matching setter (a change moves the
  // strip behind the modal at once), and while the dialog is open the slice
  // re-seeds the fields (a strip edit behind the modal shows up here) and
  // the readout re-derives from the build's dims. Cancel and the close box
  // just close — nothing to revert, the settings are non-destructive and the
  // strip IS the preview. Export is enabled whenever a model exists (the
  // build slice has dims), shown or not: the follower renders on demand.
  const atlasViews = $('#atlas-views');
  const atlasStep = $('#atlas-step');
  const atlasElevation = $('#atlas-elevation');
  const atlasOffset = $('#atlas-offset');
  const atlasSize = $('#atlas-size');
  const atlasDims = $('#atlas-dims');
  const btnExportAtlasOk = $('#btn-export-atlas-ok');
  atlasViews.min = 1;
  atlasViews.max = RING_MAX_VIEWS;
  atlasSize.min = RING_MIN_SIZE;
  atlasSize.max = RING_MAX_SIZE;
  const seedRingDialog = () => {
    const st = ring.get();
    atlasViews.value = String(st.views);
    atlasElevation.value = String(st.elevation);
    atlasOffset.value = String(st.offset);
    atlasSize.value = String(st.size);
    const step = 360 / st.views;
    atlasStep.textContent = `${Number.isInteger(step) ? step : step.toFixed(1)}° step`;
    // The sheet: views tiles of `size` side by side (the frame IS the size
    // — the field above says it — so the readout is the sheet alone).
    const dims = build.get().dims;
    if (dims) {
      const { px } = ringFrame(dims, st.elevation, st.size);
      const sheet = ringSheet(st.views, px);
      atlasDims.textContent = `${sheet.width} × ${sheet.height} px`;
    } else {
      atlasDims.textContent = '—';
    }
    btnExportAtlasOk.disabled = !dims;
  };
  const syncRingDialog = () => {
    if (dlgExportAtlas.open) seedRingDialog();
  };
  function showRingDialog() {
    seedRingDialog();
    dlgExportAtlas.show();
  }
  teardown.push(ring.subscribe(syncRingDialog), build.subscribe(syncRingDialog));
  // A NaN (the field mid-edit) is each setter's own no-op; live() bindings
  // aren't in play here (plain markup), so the slice re-seeds the field on
  // its next change — a clamped entry reads back clamped.
  on(atlasViews, 'vf-change', (e) => {
    ring.setViews(e.detail.valueAsNumber);
    syncRingDialog();
  });
  on(atlasElevation, 'vf-change', (e) => {
    ring.setElevation(e.detail.valueAsNumber);
    syncRingDialog();
  });
  on(atlasOffset, 'vf-change', (e) => {
    ring.setOffset(e.detail.valueAsNumber);
    syncRingDialog();
  });
  on(atlasSize, 'vf-change', (e) => {
    ring.setSize(e.detail.valueAsNumber);
    syncRingDialog();
  });
  on($('#btn-export-atlas-cancel'), 'click', () => dlgExportAtlas.close());
  // Export = the strip's sheet: the follower renders the whole strip now
  // (whether or not the windoid is shown), the canvas becomes PNG bytes with
  // the ring's metadata chunk — the settings, the frame, the anchor, the yaw
  // list — beside the Title and Software chunks, and the same record shapes
  // the TexturePacker JSON beside it; the pair goes out as one stored zip
  // (one download per gesture is all a browser gives). Failures land on the
  // build slice like Download's.
  on(btnExportAtlasOk, 'click', async () => {
    const ctx = workspace.active();
    const dims = build.get().dims;
    if (!ctx || !dims) return;
    try {
      const canvas = panels.ring.renderSheet();
      const st = ring.get();
      const { px, scale } = ringFrame(dims, st.elevation, st.size);
      const geometry = {
        frame: px,
        scale,
        anchor: ringAnchor(dims, st.elevation, st.size),
        yaws: ringYaws(st.views, st.offset),
      };
      const base = ringBasename(ctx.name);
      const png = setTextChunks(
        await canvasToPngBytes(canvas),
        ringMetaChunks(ctx.name, st, geometry)
      );
      const json = texturePackerJson(slugOf(ctx.name), st, geometry, {
        image: `${base}.png`,
        version: __APP_VERSION__,
      });
      const zip = zipStore([
        { name: `${base}.png`, bytes: png },
        {
          name: `${base}.json`,
          bytes: new TextEncoder().encode(JSON.stringify(json, null, 2)),
        },
      ]);
      downloadBlob(new Blob([zip], { type: 'application/zip' }), ringFilename(ctx.name));
      dlgExportAtlas.close();
    } catch (err) {
      build.setError(`Export failed: ${err.message}`);
    }
  });

  // --- menus ------------------------------------------------------------------
  on($('#menu-app'), 'vf-menu-select', (e) => {
    if (modalOpen()) return;
    switch (menuDetail(e).value) {
      case 'about':
        showAbout();
        break;
      case 'desktop-patterns':
        // The Desktop Patterns control panel (shell/patterns.js): a window,
        // app-level like About — live in both roles. Opening it deactivates
        // the application: it's the Finder's window.
        panels.patterns.open();
        break;
      case 'empty-trash':
        // The Finder's command over the catalog (the alert above): live in
        // both roles, and it changes neither — nothing on screen but icons
        // moves. Greyed while the Trash is empty (syncTrash below).
        showEmptyTrash();
        break;
    }
  });

  on($('#menu-file'), 'vf-menu-select', (e) => {
    if (modalOpen()) return;
    const active = () => workspace.active();
    switch (menuDetail(e).value) {
      case 'new':
        // App-level, like About: the dialog works from the Finder role too —
        // creating from it opens a window, which reactivates the application.
        showNewDialog();
        break;
      case 'new-folder': {
        // A FINDER command (the files slice's createFolder): "untitled
        // folder" — counted up per container — in the active folder window,
        // else on the desktop, its name selected for typing (the icon's
        // rename box, through the icon layer). Finder role only: the item
        // is greyed while a document window is active (syncGate below), so
        // the Finder is already forward here. Storage unavailable raises
        // the notice, like Save. With the Trash's window front the item is
        // greyed too and the slice refuses regardless — a folder is not
        // made in the Trash.
        if (!files.get().available) {
          dlgStorage.show();
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
        // The active document (dirty-checked), or — the Finder's Close —
        // the front folder window.
        const ctx = active();
        if (ctx) closeContext(ctx);
        else {
          const f = folders.activeFolder();
          if (f != null) folders.close(f);
        }
        break;
      }
      case 'save': {
        const ctx = active();
        if (ctx) saveThen(ctx, null);
        break;
      }
      case 'duplicate': {
        const ctx = active();
        if (!ctx) break;
        if (!files.get().available) dlgStorage.show();
        else
          workspace
            .duplicate(ctx.key)
            // The copy opens in its own window, System 7's Finder-Duplicate
            // reading — the original window stays put.
            .then((id) => (id ? openDoc(id) : null))
            .catch((err) => build.setError(`Duplicate failed: ${err.message}`));
        break;
      }
      case 'rename': {
        const ctx = active();
        if (!ctx) break;
        promptName('rename', ctx.name).then((name) => {
          if (name != null) {
            workspace
              .rename(ctx.key, name)
              .catch((err) => build.setError(`Rename failed: ${err.message}`));
          }
        });
        break;
      }
      case 'download': {
        // The SOURCE path: the document .png verbatim — the downloaded atlas
        // IS the document format, so this is Download, not an export.
        const ctx = active();
        if (!ctx) break;
        workspace
          .exportOf(ctx.key)
          .then(({ bytes, name }) => downloadPngBytes(bytes, docFilename(name)))
          .catch((err) => build.setError(`Download failed: ${err.message}`));
        break;
      }
      case 'export-model':
        showModelDialog();
        break;
      case 'export-atlas':
        showRingDialog();
        break;
      case 'quit':
        quit();
        break;
    }
  });

  on($('#menu-edit'), 'vf-menu-select', (e) => {
    if (modalOpen()) return;
    switch (menuDetail(e).value) {
      case 'undo':
        workspace.active()?.history.undo();
        break;
      case 'redo':
        workspace.active()?.history.redo();
        break;
      case 'copy':
        // The Finder's Copy (header; the gate below says when): the
        // selected icons to the clipboard.
        copySelection();
        break;
      case 'paste':
        // The Finder's Paste: whatever the clipboard holds, into the front
        // container — decided at the pick.
        paste();
        break;
      case 'select-all':
        // The Finder's Select All: every icon in the front window's field,
        // else the desktop's.
        icons.selectAll(folders.activeFolder());
        break;
      case 'pick-color':
        session.openPicker();
        break;
      case 'tile-size':
        showTileDialog();
        break;
    }
  });

  // The browser's own Edit → Paste (its menu bar; no keydown, so the kit's
  // claim never sees it) lands as a `paste` event — and it is the ONE route
  // that carries a copied FILE (a .png copied in the Mac's Finder arrives as
  // clipboardData.files, which clipboard.read() never exposes). The same
  // gate as the item (disabled: the application role, a focused field —
  // whose own paste this must not eat — or the Trash front), the same
  // dispatch. clipboardData is readable only during the event, so the read
  // is synchronous and the work follows.
  on(document, 'paste', (e) => {
    if (itemPaste.disabled || modalOpen()) return;
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
      dlgStorage.show();
      return;
    }
    const target = folders.activeFolder();
    if (isTrashed(files.get(), target)) return;
    dispatchPaste({ text, image }, target);
  });

  on($('#menu-tools'), 'vf-menu-select', (e) => {
    if (modalOpen()) return;
    const v = menuDetail(e).value;
    if (v.startsWith('tool-'))
      session.setTool(/** @type {any} */ (v.slice('tool-'.length)));
  });

  on($('#menu-view'), 'vf-menu-select', (e) => {
    if (modalOpen()) return;
    const v = String(menuDetail(e).value ?? '');
    switch (v) {
      case 'ring':
        // The 3D Sprite Atlas windoid: a toggle on the prefs slice (off
        // every load); shell/windows.js shows and hides the windoid off the
        // flag, and its close box clears it — one truth, mirrored back as
        // the checkmark by syncView below.
        prefs.setShowRing(!prefs.get().showRing);
        break;
      case 'arrange':
        // The boot placement re-run on the current raster — windoids and
        // every open document window (windows.js). The item wears this
        // value only while something on screen is off its placement
        // (syncArrange below), so a pick always has something to arrange.
        windows.arrange();
        break;
      case 'zoom':
        // The same item's other command (syncArrange below): everything
        // already arranged, ⌘J zooms the active document window — the
        // zoom box's own toggle — under the same "Arrange Windows" label.
        windows.zoomActive();
        break;
      default:
        // The open-windows section (syncWindows below): `window:<key>`
        // brings that document window forward through the window layer's
        // one activation funnel — from the Finder role too, where the
        // application returns with it.
        if (v.startsWith('window:')) windows.activateContext(v.slice('window:'.length));
        break;
    }
  });

  // --- checkmark + enabled sync ----------------------------------------------
  // Undo/Redo render disabled until the ACTIVE document's history has
  // something — which also hands their key strokes back to the browser (a
  // disabled item's shortcut deliberately never fires, so ⌘Z in a text field
  // stays native undo) — and, like every document-scoped item, while the
  // desktop is focused. followActive re-wires the history subscription as
  // activation moves between windows.
  const itemUndo = $('vf-menu-item[value="undo"]');
  const itemRedo = $('vf-menu-item[value="redo"]');
  const syncEdit = () => {
    const appActive = shell.get().appActive;
    const h = workspace.active()?.history.get();
    itemUndo.disabled = !appActive || !h?.canUndo;
    itemRedo.disabled = !appActive || !h?.canRedo;
  };
  teardown.push(
    shell.subscribe(syncEdit),
    followActive(workspace, (ctx) => (ctx ? ctx.history.subscribe(syncEdit) : undefined)),
    workspace.subscribe(syncEdit)
  );
  syncEdit();

  // --- focus gating ------------------------------------------------------------
  // Two roles share one menu bar (the single-application affordance): with
  // the desktop focused, every document-scoped item greys out. About /
  // Desktop Patterns / New stay — they're app-level (New… ⌃N opens a
  // document from either role); Quit keeps its own gate
  // below (an open document window, whichever role); the ⌘J item (Arrange
  // Windows — its value the arrange / zoom) keeps its own gate below (an
  // open document window, and the windows' state); the View menu's
  // open-windows items (syncWindows below) are live in both roles — a pick
  // there is what brings the application back. One item reads the FINDER'S
  // front window beside the role: Close is live with a document window OR a
  // folder window active (the Finder's Close closed its front window),
  // re-read on every change of the desktop's active window (vf-activate: a
  // folder window taking or losing active moves neither role flag).
  // Disabling an item also parks its key equivalent (the kit never fires a
  // disabled item's shortcut), so ⌘S/⌘K gate with their menus; the
  // bare-letter tool keys get the same guard in src/shortcuts.js.
  //
  // The FINDER-ROLE items read the other way — live while a document
  // window is NOT active. New Folder greys with a document active, and
  // also while the Finder's front window is the Trash's, or a trashed
  // folder's (System 7's own — a folder is not made in the Trash; the
  // slice refuses regardless); it has no key equivalent, so a text
  // control's focus leaves it alone. The three in the Edit menu (header)
  // read two more things: Copy needs a
  // selected icon that is not the Trash (the icon layer's selection(),
  // re-read on its onSelectionChange: the kit's vf-select, the activation's
  // clear, the chrome bridge's re-select); Paste needs a front container
  // that accepts one (not the Trash, not inside it — New Folder's reading),
  // and NOT "and the clipboard holds something": the system clipboard
  // cannot be read without a pick, so Paste is live whenever the Finder can
  // take one and a ⌘V with nothing to paste does nothing. All three grey
  // while a TEXT CONTROL has focus — an icon's rename box, the New box's
  // Name, a stepper — read off focusin / focusout's COMPOSED path (the
  // kit's fields host their <input> in shadow DOM, so the innermost target
  // is what says it: src/shortcuts.js's idiom for the tool keys), since the
  // kit's key equivalents never look at where the stroke landed and an
  // enabled Copy would claim the field's ⌘C. Greyed, the items claim
  // nothing and the field keeps its keys — the same mechanism that hands
  // ⌘Z to a field when Undo is grey.
  const DOC_SCOPED = [
    'save',
    'duplicate',
    'rename',
    'download',
    'export-model',
    'export-atlas',
    'pick-color',
    'tile-size',
    'ring',
    'tool-select',
    'tool-pencil',
    'tool-rect',
    'tool-fill',
    'tool-eraser',
    'tool-eyedropper',
  ];
  const docItems = DOC_SCOPED.map((v) => $(`vf-menu-item[value="${v}"]`));
  const itemClose = $('vf-menu-item[value="close"]');
  const itemNewFolder = $('vf-menu-item[value="new-folder"]');
  const itemCopy = $('vf-menu-item[value="copy"]');
  const itemPaste = $('vf-menu-item[value="paste"]');
  const itemSelectAll = $('vf-menu-item[value="select-all"]');
  /** Whether the innermost focused element is a text control. */
  let textFocused = false;
  const syncGate = () => {
    const s = shell.get();
    const st = files.get();
    const front = folders.activeFolder();
    for (const item of docItems) item.disabled = !s.appActive;
    itemClose.disabled = !(s.appActive || front != null);
    itemNewFolder.disabled = s.appActive || isTrashed(st, front);
    const finder = !s.appActive && !textFocused;
    itemCopy.disabled = !finder || icons.selection().length === 0;
    itemPaste.disabled = !finder || isTrashed(st, front);
    itemSelectAll.disabled = !finder;
  };
  teardown.push(
    shell.subscribe(syncGate),
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
  const itemEmptyTrash = $('vf-menu-item[value="empty-trash"]');
  const syncTrash = () => {
    const c = childrenOf(files.get(), TRASH);
    itemEmptyTrash.disabled = !c.docs.length && !c.folders.length;
  };
  teardown.push(files.subscribe(syncTrash));
  syncTrash();

  // Quit is live exactly while a document window is open — the cascade
  // walks the open documents, so with none there is nothing to quit — in
  // both roles alike: a document window behind the Finder still counts.
  const itemQuit = $('vf-menu-item[value="quit"]');
  const syncQuit = () => {
    itemQuit.disabled = workspace.get().contexts.length === 0;
  };
  teardown.push(workspace.subscribe(syncQuit));
  syncQuit();

  // --- Arrange Windows: one item, ⌘J, a STATE rule -------------------------------
  // The View menu's ⌘J item carries two commands, and which one is a
  // reading of the windows, never of what was pressed last: with anything
  // on screen off its placement — a drag, a grow, a zoom, the 3D Sprite
  // Atlas shown into the doc box's band, a browser resize the document
  // window sprung with — it is the ARRANGE, the placement re-run
  // (windows.arrange); with everything already where the placement puts it
  // — arrange would change nothing (windows.arranged) — it is the ZOOM,
  // the active document window through the zoom box's own toggle
  // (windows.zoomActive). A window zoomed from its slot still reads
  // arranged — and so does any permutation of the documents across the
  // cascade's slots (a raise is bookkeeping, not layout) — so repeats of
  // ⌘J toggle the focused document between its slot and the vacancy while
  // nothing else moves, and from any other state the first ⌘J lands the
  // arrangement. The LABEL is fixed — "Arrange Windows" in both states,
  // the markup's own text, never rewritten here: the zoom is Arrange's
  // variant for a screen already arranged, not a second command to
  // announce (a label that turned with the state — "Zoom Window" once
  // arranged — was retired Sep 7 2026). Only the VALUE turns, so the select handler
  // above dispatches on it alone and a pick can never mean the other
  // thing. Greyed with no
  // document window open (nothing on screen to arrange), and, arranged, in
  // the Finder role (nothing to arrange — the hidden windoids don't count,
  // the test being what's on screen — and no active window to zoom); off
  // its placement it stays live in both roles, and from the Finder role
  // re-rails the hidden windoids too (positions only, nothing activates).
  // windows.onLayout is the geometry signal (every write that module makes,
  // every gesture it hears); the stores cover the window set, the role and
  // the placement's inputs.
  const itemArrange = $('#item-arrange');
  const syncArrange = () => {
    const open = workspace.get().contexts.length > 0;
    const arranged = open && windows.arranged();
    const value = arranged ? 'zoom' : 'arrange';
    if (itemArrange.getAttribute('value') !== value)
      itemArrange.setAttribute('value', value);
    itemArrange.disabled = !open || (arranged && !shell.get().appActive);
  };
  teardown.push(
    workspace.subscribe(syncArrange),
    shell.subscribe(syncArrange),
    prefs.subscribe(syncArrange),
    ring.subscribe(syncArrange),
    windows.onLayout(syncArrange)
  );
  syncArrange();

  // --- the open document windows: the View menu's dynamic section ------------
  // System 7's Window-menu idiom — the application's open documents listed
  // by name, the front one checked — as the View menu's tail: after the
  // markup's last item, a separator and then ONE item per open document
  // window. The label is the document's name (its window's title, so a
  // rename or a first save relabels it); the checkmark is the ACTIVE
  // window's, a reading of workspace.activeKey (none in the Finder role,
  // where no document window is active); the order is the workspace's
  // creation order — the cascade's own — never the stacking order, which a
  // raise changes: a menu that shuffles under the pointer is hostile. The
  // value is `window:<key>` (the context key, never the name — two saved
  // documents can share one), and a pick brings that window forward
  // through the window layer's one activation funnel (bringToFront →
  // vf-activate), from the Finder role too, where the application returns
  // with it — an icon's double-click on an already-open document, the
  // menu's way; live in both roles for that reason (not DOC_SCOPED). With
  // no document window open the section is absent, separator included:
  // the menu ends at the markup's last item, and no dangling rule.
  // RECONCILED, not rebuilt: an item lives as long as its window — the
  // kit re-queries its slotted items on every access, so a runtime item is
  // as live as an authored one — and moves only when the light DOM
  // disagrees with the order. `checkable` up front: every item in the
  // section is a check slot (the kit's own advice for a toggle that starts
  // off), so the unchecked ones announce as such rather than as commands.
  const menuView = $('#menu-view');
  const sectionAnchor = /** @type {Element} */ (menuView.lastElementChild);
  const windowSep = document.createElement('vf-separator');
  /** @type {Map<string, HTMLElementTagNameMap['vf-menu-item']>} ctx key -> its item */
  const windowItems = new Map();
  const syncWindows = () => {
    const { contexts, activeKey } = workspace.get();
    const live = new Set(contexts.map((c) => c.key));
    for (const [key, item] of windowItems) {
      if (!live.has(key)) {
        item.remove();
        windowItems.delete(key);
      }
    }
    const items = contexts.map((ctx) => {
      let item = windowItems.get(ctx.key);
      if (!item) {
        item = document.createElement('vf-menu-item');
        item.setAttribute('value', `window:${ctx.key}`);
        item.checkable = true;
        windowItems.set(ctx.key, item);
      }
      if (item.textContent !== ctx.name) item.textContent = ctx.name;
      item.checked = ctx.key === activeKey;
      return item;
    });
    if (items.length === 0) {
      windowSep.remove();
      return;
    }
    let after = sectionAnchor;
    for (const el of [windowSep, ...items]) {
      if (el.previousElementSibling !== after) after.after(el);
      after = el;
    }
  };
  teardown.push(workspace.subscribe(syncWindows), () => {
    windowSep.remove();
    for (const item of windowItems.values()) item.remove();
    windowItems.clear();
  });
  syncWindows();

  // The Tools menu mirrors the sticky tool modes — exactly one item checked,
  // off the same session truth the tool strip and the S/B/R/G/E/I keys write.
  const toolItems = ['select', 'pencil', 'rect', 'fill', 'eraser', 'eyedropper'].map(
    (t) => [t, $(`vf-menu-item[value="tool-${t}"]`)]
  );
  const syncTools = () => {
    for (const [t, item] of toolItems) item.checked = session.get().tool === t;
  };
  teardown.push(session.subscribe(syncTools));
  syncTools();

  // The View menu's 3D Sprite Atlas checkmark mirrors the prefs slice
  // (showRing): a pick toggles the slice, the check follows it (boots
  // unchecked, the slice's default; the windoid's close box lands here
  // through the same flag).
  const itemRing = $('vf-menu-item[value="ring"]');
  const syncView = () => {
    itemRing.checked = prefs.get().showRing;
  };
  teardown.push(prefs.subscribe(syncView));
  syncView();

  // A document window's close box routes through the same dirty check.
  windows.onDocumentClose = (key) => {
    const ctx = workspace.byKey(key);
    if (ctx) closeContext(ctx);
  };

  return {
    // showAbout doubles as the boot greeting: a load with no ?file=<name>
    // to open parks at the About box (main.js).
    actions: {
      confirmDiscard,
      openDoc,
      closeContext,
      saveThen,
      showAbout,
    },
    dispose() {
      for (const fn of teardown) fn();
    },
  };
}
