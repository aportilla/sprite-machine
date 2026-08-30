// ---------------------------------------------------------------------------
// Menu + dialog wiring for the desktop shell: vf-menu-select → store/file
// actions, checkmark + enabled sync, and every dialog flow (About, Open, the
// shared name prompt, Properties, the unsaved-changes alert, the
// storage-unavailable notice, the parked Export 3D Model… configurator — a
// dummy form whose only live control is Cancel — and the LIVE Export Sprite
// Atlas… dialog: the 3D Sprite Atlas windoid's settings as a form, bound
// two-way to the ring slice (a change moves the strip behind the modal at
// once; Cancel doesn't revert — the strip IS the preview), whose Export
// saves the strip's exact sheet as «slug»-atlas.png with the ring's
// metadata chunk. File → Download is the source path.
// Behavior only — the markup lives in
// index.html, the aesthetics in the kit. (Settings… is parked: the render
// toggles moved to the 3D View's controls strip, and the emptied item sits
// disabled in the markup until it has contents again.)
//
// MULTI-DOCUMENT GRAMMAR: File actions target the ACTIVE workspace context;
// New… / Open / a drop always open a NEW window (opening never discards
// anything — the dirty check moved entirely to the close paths); opening an
// already-open stored doc activates its existing window. Quit walks every
// open document, one unsaved-changes alert per dirty one. File → New… raises
// the New Document dialog (an empty atlas at a chosen tile size, or a
// built-in template as a fresh untitled copy); the built-ins are otherwise
// ordinary stored documents (seeded at the first-ever boot — loaders.js),
// so the Open listing and the desktop icons know nothing special about them.
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
// ---------------------------------------------------------------------------

import { session } from '../state/session.js';
import { prefs } from '../state/prefs.js';
import { build } from '../state/build.js';
import { shell } from '../state/shell.js';
import { ring, ringMetaChunks, RING_MAX_VIEWS, RING_MAX_SCALE } from '../state/ring.js';
import { files, UNTITLED, docFilename, ringFilename } from '../state/files.js';
import { workspace, followActive } from '../state/workspace.js';
import { TILE_MIN, TILE_MAX, clampTile } from '../lib/atlas.js';
import { SAMPLES } from '../lib/sprite-data.js';
import { ringFrame, ringSheet, ringAnchor, ringYaws } from '../lib/ring.js';
import { setTextChunks } from '../lib/png-chunks.js';
import { loadSample, loadBlank } from '../loaders.js';
import { downloadPngBytes, canvasToPngBytes } from '../image-io.js';

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {ReturnType<typeof import('./windows.js').initWindows>} windows
 * @param {{
 *   patterns: ReturnType<typeof import('./patterns.js').initPatterns>,
 *   ring: ReturnType<typeof import('../scene/ring.js').initRing>,
 * }} panels
 *   The panel windows a menu item opens (the Desktop Patterns control panel)
 *   and the 3D Sprite Atlas's renderer follower (Export renders through it).
 */
export function initMenus(desktop, windows, panels) {
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
  const dlgOpen = $('#dlg-open');
  const dlgName = $('#dlg-name');
  const dlgProps = $('#dlg-props');
  const dlgUnsaved = $('#dlg-unsaved');
  const dlgStorage = $('#dlg-storage');
  const dlgExportModel = $('#dlg-export-model');
  const dlgExportAtlas = $('#dlg-export-atlas');

  // The About box — Sprite Machine → About…, and the BOOT GREETING (main.js
  // parks a load with no document to open on it: the classic launch splash;
  // OK or Escape leaves the bare desktop, nothing activates). The copy is
  // the markup's; the version and date lines are BUILD facts (vite.config.js
  // `define`: package.json's version, HEAD's commit date), written once here
  // so the markup never carries a stale number.
  $('#about-version').textContent = `version ${__APP_VERSION__}`;
  $('#about-date').textContent = __APP_DATE__;
  const showAbout = () => dlgAbout.show();
  on($('#btn-about-ok'), 'click', () => dlgAbout.close());
  on($('#btn-storage-ok'), 'click', () => dlgStorage.close());
  on($('#btn-props-ok'), 'click', () => dlgProps.close());
  // The Export 3D Model… configurator is PARKED (a dummy form, Export
  // disabled in the markup) — Cancel is its only live control.
  on($('#btn-export-model-cancel'), 'click', () => dlgExportModel.close());

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

  // Finder grammar for Open: with the desktop focused and an icon selected,
  // the item reads "Open" and acts on the selection (the sync below relabels
  // it; with nothing selected it stays "Open…", the listing dialog). Every
  // icon is a saved-doc icon now — no other key shape exists.
  const finderSelection = () => {
    const s = shell.get();
    return !s.appActive && s.iconSelection.length > 0;
  };
  const openSelection = () => {
    for (const key of shell.get().iconSelection) {
      if (key.startsWith('doc:')) openDoc(key.slice('doc:'.length));
    }
  };

  const listItem = (value, text) => {
    const item = document.createElement('vf-list-item');
    item.value = value;
    item.textContent = text;
    return item;
  };

  // --- the New Document dialog -------------------------------------------------
  // Templates: Empty Document (an all-transparent atlas at a chosen tile
  // size) or a built-in sample as a fresh untitled copy. The tile-size field
  // is live for Empty Document only — a template's art has a NATIVE tile
  // size, and a retile crops/pads rather than scales, so a template shows
  // its own size disabled. Everything created here is an untitled window;
  // explicit Save is what puts it in the library.
  const newList = $('#new-list');
  const newTile = $('#new-tile');
  const newDims = $('#new-dims');
  newTile.min = TILE_MIN;
  newTile.max = TILE_MAX;
  const BLANK_TILE = 40; // the classic default (a 120×80 atlas)
  // The Empty Document size, remembered across template flips WITHIN one
  // dialog visit (a template shows its own size in the shared field), reset
  // per open.
  let blankTile = BLANK_TILE;

  const syncNewForm = () => {
    const v = newList.value;
    if (v !== 'blank') {
      newTile.disabled = true;
      newTile.value = String(SAMPLES[+v.slice('sample:'.length)].tile);
    } else {
      if (newTile.disabled) newTile.value = String(blankTile); // back from a template
      newTile.disabled = false;
      blankTile = clampTile(+newTile.value || BLANK_TILE);
    }
    const t = clampTile(+newTile.value || BLANK_TILE);
    newDims.textContent = `atlas ${t * 3} × ${t * 2} px`;
  };
  function showNewDialog() {
    const rows = [listItem('blank', 'Empty Document')];
    SAMPLES.forEach((s, i) => rows.push(listItem(`sample:${i}`, s.name)));
    newList.replaceChildren(...rows);
    // Reset per open (predictable over remembered): Empty at the default.
    newList.value = 'blank';
    newTile.disabled = false;
    newTile.value = String(BLANK_TILE);
    blankTile = BLANK_TILE;
    syncNewForm();
    dlgNew.show();
  }
  async function createFromNewDialog() {
    const v = newList.value;
    if (!v) return;
    dlgNew.close();
    const ctx =
      v === 'blank'
        ? loadBlank(clampTile(+newTile.value || BLANK_TILE))
        : await loadSample(SAMPLES[+v.slice('sample:'.length)]);
    if (ctx) windows.activateContext(ctx.key);
  }
  on(newList, 'vf-change', syncNewForm);
  on(newList, 'dblclick', createFromNewDialog);
  on(newTile, 'vf-change', syncNewForm);
  on($('#btn-new-ok'), 'click', createFromNewDialog);
  on($('#btn-new-cancel'), 'click', () => dlgNew.close());

  // --- the Open dialog --------------------------------------------------------
  // Stored documents only — the built-ins are ordinary rows here once seeded,
  // and a template belongs to File → New…, not Open.
  const openList = $('#open-list');
  function showOpenDialog() {
    const rows = [];
    for (const r of files.get().list) {
      const when = new Date(r.modifiedAt).toLocaleDateString();
      rows.push(listItem(`doc:${r.id}`, `${r.name} — ${r.w}×${r.h}px, ${when}`));
    }
    openList.replaceChildren(...rows);
    dlgOpen.show();
  }
  function actOnOpenPick() {
    const v = openList.value;
    if (!v) return;
    dlgOpen.close();
    openDoc(v.slice('doc:'.length));
  }
  on($('#btn-open-ok'), 'click', actOnOpenPick);
  on($('#btn-open-cancel'), 'click', () => dlgOpen.close());
  on(openList, 'dblclick', actOnOpenPick);

  // --- the Properties dialog --------------------------------------------------
  // Reads the ACTIVE document; re-syncs while open on any workspace change or
  // structural change of the active doc (followActive re-wires the latter).
  const propsName = $('#props-name');
  const propsDims = $('#props-dims');
  const propsTile = $('#props-tile');
  propsTile.min = TILE_MIN;
  propsTile.max = TILE_MAX;
  const syncProps = () => {
    if (!dlgProps.open) return;
    const ctx = workspace.active();
    const d = ctx?.doc.get();
    propsName.textContent = ctx?.name ?? '';
    propsDims.textContent = d?.atlasImage
      ? `${d.atlasImage.width}px × ${d.atlasImage.height}px`
      : '—';
    propsTile.value = String(d?.tileW || 0);
  };
  teardown.push(
    workspace.subscribe(syncProps),
    followActive(workspace, (ctx) => (ctx ? ctx.doc.subscribe(syncProps) : undefined))
  );
  on(propsTile, 'vf-change', (e) => {
    const ctx = workspace.active();
    if (!ctx) return;
    const n = e.detail.valueAsNumber;
    if (Number.isFinite(n) && n !== ctx.doc.get().tileW) {
      // The relocated tile stepper: a square, centered, undoable resize —
      // on the active document, in its own history.
      ctx.history.withAtlasSnapshot(() => ctx.doc.resizeTiles(n, n));
    }
  });

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
  const atlasScale = $('#atlas-scale');
  const atlasDims = $('#atlas-dims');
  const btnExportAtlasOk = $('#btn-export-atlas-ok');
  atlasViews.min = 1;
  atlasViews.max = RING_MAX_VIEWS;
  atlasScale.min = 1;
  atlasScale.max = RING_MAX_SCALE;
  const seedRingDialog = () => {
    const st = ring.get();
    atlasViews.value = String(st.views);
    atlasElevation.value = String(st.elevation);
    atlasOffset.value = String(st.offset);
    atlasScale.value = String(st.scale);
    const step = 360 / st.views;
    atlasStep.textContent = `${Number.isInteger(step) ? step : step.toFixed(1)}° step`;
    const dims = build.get().dims;
    if (dims) {
      const { px } = ringFrame(dims, st.elevation, st.scale);
      const sheet = ringSheet(st.views, px);
      atlasDims.textContent = `frame ${px} × ${px} px · sheet ${sheet.width} × ${sheet.height} px`;
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
  on(atlasScale, 'vf-change', (e) => {
    ring.setScale(e.detail.valueAsNumber);
    syncRingDialog();
  });
  on($('#btn-export-atlas-cancel'), 'click', () => dlgExportAtlas.close());
  // Export = the strip's sheet: the follower renders the whole strip now
  // (whether or not the windoid is shown), the canvas becomes PNG bytes, and
  // the ring's metadata chunk — the settings, the frame, the anchor, the yaw
  // list — rides beside the Title and Software chunks. Failures land on the
  // build slice like Download's.
  on(btnExportAtlasOk, 'click', async () => {
    const ctx = workspace.active();
    const dims = build.get().dims;
    if (!ctx || !dims) return;
    try {
      const canvas = panels.ring.renderSheet();
      const st = ring.get();
      const { px } = ringFrame(dims, st.elevation, st.scale);
      const bytes = setTextChunks(
        await canvasToPngBytes(canvas),
        ringMetaChunks(ctx.name, st, {
          frame: px,
          anchor: ringAnchor(dims, st.elevation, st.scale, px),
          yaws: ringYaws(st.views, st.offset),
        })
      );
      downloadPngBytes(bytes, ringFilename(ctx.name));
      dlgExportAtlas.close();
    } catch (err) {
      build.setError(`Export failed: ${err.message}`);
    }
  });

  // --- menus ------------------------------------------------------------------
  on($('#menu-app'), 'vf-menu-select', (e) => {
    if (modalOpen()) return;
    // No 'settings' case: the item sits disabled in the markup (parked — see
    // the file header), and a disabled item never fires by kit contract.
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
      case 'quit':
        quit();
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
      case 'open':
        // Two grammars, one item: the Finder's "Open" (act on the selected
        // icons) with the desktop focused and a selection; otherwise "Open…",
        // the listing dialog — the application's, or the Finder's browse
        // when nothing on the desktop is selected.
        if (finderSelection()) openSelection();
        else showOpenDialog();
        break;
      case 'close': {
        const ctx = active();
        if (ctx) closeContext(ctx);
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
        dlgExportModel.show();
        break;
      case 'export-atlas':
        showRingDialog();
        break;
      case 'properties':
        dlgProps.show();
        syncProps();
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
      case 'pick-color':
        session.openPicker();
        break;
    }
  });

  on($('#menu-tools'), 'vf-menu-select', (e) => {
    if (modalOpen()) return;
    const v = menuDetail(e).value;
    if (v.startsWith('tool-'))
      session.setTool(/** @type {any} */ (v.slice('tool-'.length)));
  });

  on($('#menu-view'), 'vf-menu-select', (e) => {
    if (modalOpen()) return;
    switch (menuDetail(e).value) {
      case 'guides':
        // The extent rules over every document canvas: a toggle on the
        // prefs slice (off by default); syncView below mirrors it back
        // as the item's checkmark.
        prefs.setShowGuides(!prefs.get().showGuides);
        break;
      case 'ring':
        // The 3D Sprite Atlas windoid: the same toggle shape (off every
        // load); shell/windows.js shows and hides the windoid off the
        // flag, and its close box clears it — one truth, mirrored back as
        // the checkmark.
        prefs.setShowRing(!prefs.get().showRing);
        break;
      case 'arrange':
        // The boot placement re-run on the current raster — windoids and
        // every open document window (windows.js). The item greys with no
        // document window open (syncArrange below), so a pick always has
        // something to arrange.
        windows.arrange();
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
  // Desktop Patterns / Quit / New / Open stay — they're app-level (the
  // parked Settings… is disabled in the markup in both roles); Arrange
  // Windows keeps its own gate below
  // (an open document window, in either role) — and Open wears the
  // Finder grammar above: its label follows the selection ("Open" on a
  // selected icon, "Open…" for the listing dialog otherwise), never greyed.
  // Disabling an item also parks its key equivalent (the kit never fires a
  // disabled item's shortcut), so ⌘S/⌘K gate with their menus; the
  // bare-letter tool keys get the same guard in src/shortcuts.js.
  const DOC_SCOPED = [
    'close',
    'save',
    'duplicate',
    'rename',
    'download',
    'export-model',
    'export-atlas',
    'properties',
    'pick-color',
    'guides',
    'ring',
    'tool-select',
    'tool-pencil',
    'tool-rect',
    'tool-fill',
    'tool-eraser',
    'tool-eyedropper',
  ];
  const docItems = DOC_SCOPED.map((v) => $(`vf-menu-item[value="${v}"]`));
  const itemOpen = $('vf-menu-item[value="open"]');
  const syncGate = () => {
    const s = shell.get();
    for (const item of docItems) item.disabled = !s.appActive;
    // The ellipsis is the System 7 promise of a dialog: "Open" acts at once
    // on the selection, "Open…" asks (the listing) — so the label is the
    // grammar's own readout. The item is the markup's default-slot text.
    const label = finderSelection() ? 'Open' : 'Open…';
    if (itemOpen.textContent !== label) itemOpen.textContent = label;
  };
  teardown.push(shell.subscribe(syncGate));
  syncGate();

  // Arrange Windows wants something to arrange: at least one document
  // window (the windoids hide with the desktop focused and re-place at
  // open). Gated on the workspace's open set, NOT appActive — from the
  // Finder role with a document open the item stays live and re-rails the
  // hidden windoids too (positions only, nothing activates).
  const itemArrange = $('vf-menu-item[value="arrange"]');
  const syncArrange = () => {
    itemArrange.disabled = workspace.get().contexts.length === 0;
  };
  teardown.push(workspace.subscribe(syncArrange));
  syncArrange();

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

  // The View menu's checkmarks mirror the prefs slice — Guides ↔
  // showGuides, 3D Sprite Atlas ↔ showRing: a pick toggles the slice, the
  // check follows it (both boot unchecked, the slice's defaults; the
  // windoid's close box lands here through the same flag).
  const itemGuides = $('vf-menu-item[value="guides"]');
  const itemRing = $('vf-menu-item[value="ring"]');
  const syncView = () => {
    itemGuides.checked = prefs.get().showGuides;
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
    actions: { confirmDiscard, openDoc, closeContext, saveThen, showAbout },
    dispose() {
      for (const fn of teardown) fn();
    },
  };
}
