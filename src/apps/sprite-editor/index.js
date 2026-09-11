// ---------------------------------------------------------------------------
// The SPRITE EDITOR — the document application (docs/apps-plan.md): front
// while a document window holds the desktop's active state, its menus File /
// Edit / Tools / View (menus.html beside this file) on the bar then and off
// it otherwise (shell/menu-bar.js). This module wires those menus and owns
// every dialog flow of the document's: the New box, the shared name prompt
// (first save / rename), Tile Size, the unsaved-changes alert, the Export 3D
// Model… dialog — a scale in voxels per meter, a lit / unlit popup and two
// readouts over an Export that writes the model as one glb, «slug».glb, its
// skin embedded from bytes (the engine's modelToGlb through
// scene/model-export.js) — and the Export Sprite Atlas… dialog: the 3D
// Sprite Atlas windoid's settings as a form, bound two-way to the ring slice
// (a change moves the strip behind the modal at once; Cancel doesn't revert
// — the strip IS the preview), whose Export saves the strip's exact sheet as
// «slug»-atlas.zip: the sheet PNG (with the ring's metadata chunk) and its
// TexturePacker JSON, siblings by name in one stored zip — a browser gives
// one download per gesture. File → Download is the source path. Its windows
// are its own (docs/app-windows-plan.md): windows.js beside this file makes
// them — the four windoids, the document windows, their zoom box and their
// arrangement — from windows.html, on layout.js's arithmetic. The dialog
// markup lives in index.html, the aesthetics in the kit.
//
// MULTI-DOCUMENT GRAMMAR: File actions target the ACTIVE workspace context;
// New… / an icon's open / a drop always open a NEW window (opening never
// discards anything — the dirty check moved entirely to the close paths);
// opening an already-open stored doc activates its existing window. Quit
// walks every open document, one unsaved-changes alert per dirty one.
// File → New… ⌃N raises the New dialog (a name, and an empty atlas at a
// chosen tile size or a built-in template as a fresh copy) and is the ONE
// New — the document's: the Finder's File menu holds the same item and
// calls through to `newDocument` here. A STORED document opens from its
// icon alone (a double-click; there is no Open item and no listing dialog —
// retired Sep 9 2026, the desktop being the file browser): openDoc below is
// that path, handed to the icon layer through the returned `actions`. The
// built-ins are otherwise ordinary stored documents (seeded at the
// first-ever boot — loaders.js), so the desktop icons know nothing special
// about them.
//
// THE DIRTY CHECK has one funnel: `confirmDiscard(ctx, next)` — run `next`
// now if that document is clean, else raise the "Save changes before
// closing?" Yes / No / Cancel box (activating its window first, so the
// question points at what the user sees) and run it (after a save, or
// without one) only when the user chooses.
//
// THE GATES: every item here is document-scoped BY CONSTRUCTION — the
// application is front only with a document window active, and off the
// bar its items claim no key (a detached menu's ear is gone: the kit's
// contract, shell/menu-bar.js) — so no role clause remains. What is left
// is each item's own reading: Undo / Redo follow the active history; the
// ⌘J item's value turns between arrange and zoom on the windows' state;
// the exports keep their dialog-side model gate; the tail follows the
// workspace. Close and Quit are always live (there is always a document to
// close and something to quit). Menu key equivalents are the KIT's
// (`shortcut` on vf-menu-item + the bar's `shortcuts` grant); a shortcut
// lands here as an ordinary vf-menu-select. Because those fire app-wide,
// every action guards on "no modal open" (deps.modalOpen) — a pointer
// can't reach a menu under a modal, so the guard only ever blocks
// re-entrant shortcuts (⌘S inside the save prompt).
// ---------------------------------------------------------------------------

import menus from './menus.html?raw';
import { session } from '../../state/session.js';
import { prefs } from '../../state/prefs.js';
import { build } from '../../state/build.js';
import { SPRITE_EDITOR } from '../../state/shell.js';
import {
  ring,
  ringMetaChunks,
  texturePackerJson,
  RING_MAX_VIEWS,
  RING_MIN_SIZE,
  RING_MAX_SIZE,
} from '../../state/ring.js';
import {
  files,
  UNTITLED,
  docFilename,
  ringFilename,
  ringBasename,
  modelFilename,
  slugOf,
} from '../../state/files.js';
import { workspace, followActive } from '../../state/workspace.js';
import { TILE_MIN, TILE_MAX, clampTile, setTextChunks } from 'sprite-machine';
import { SAMPLES } from '../../lib/sprite-data.js';
import { ringFrame, ringSheet, ringAnchor, ringYaws } from '../../lib/ring.js';
import { zipStore } from '../../lib/zip.js';
import { loadSample, loadBlank } from '../../loaders.js';
import { downloadPngBytes, downloadBlob, canvasToPngBytes } from '../../image-io.js';
import { initEditorWindows } from './windows.js';

/** @type {import('../index.js').App} */
export const spriteEditor = {
  id: SPRITE_EDITOR,
  name: 'Sprite Editor',
  menus,
  init({ menus, deps }) {
    const { desktop, windows, modalOpen, showStorage } = deps;
    // The application's windows (windows.js — the windoids, the document
    // windows, their zoom box and their arrangement): a document window's
    // close box is this module's dirty-checking close (closeContext, below).
    const editorWindows = initEditorWindows(desktop, windows, {
      onDocumentClose: (key) => {
        const ctx = workspace.byKey(key);
        if (ctx) closeContext(ctx);
      },
    });
    const $ = (sel) => {
      const el = desktop.querySelector(sel);
      if (!el) throw new Error(`apps/sprite-editor: missing element ${sel}`);
      return /** @type {any} */ (el);
    };
    /** A menu of this application's, by its data-menu. */
    const menu = (name) => {
      const m = menus.find((el) => el.dataset.menu === name);
      if (!m) throw new Error(`apps/sprite-editor: missing menu ${name}`);
      return m;
    };
    /** An item within one of this application's menus, by its value. */
    const item = (m, value) => {
      const el = m.querySelector(`vf-menu-item[value="${value}"]`);
      if (!el) throw new Error(`apps/sprite-editor: missing item ${value}`);
      return /** @type {any} */ (el);
    };
    const menuFile = menu('file');
    const menuEdit = menu('edit');
    const menuTools = menu('tools');
    const menuView = menu('view');

    /** @type {(() => void)[]} */
    const teardown = [];
    const on = (el, type, fn) => {
      el.addEventListener(type, fn);
      teardown.push(() => el.removeEventListener(type, fn));
    };
    const menuDetail = (e) => /** @type {CustomEvent} */ (e).detail;

    // --- dialogs ----------------------------------------------------------------
    const dlgNew = $('#dlg-new');
    const dlgName = $('#dlg-name');
    const dlgTile = $('#dlg-tile');
    const dlgUnsaved = $('#dlg-unsaved');
    const dlgExportModel = $('#dlg-export-model');
    const dlgExportAtlas = $('#dlg-export-atlas');

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
      const st = deps.model.stats();
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
        const glb = deps.model.exportGlb({
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
      editorWindows.showDocument(ctx.key);
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
        showStorage();
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
        if (res) editorWindows.showDocument(res.ctx.key);
      } catch (err) {
        build.setError(`Couldn't open the document: ${err.message}`);
      }
    };

    // Close one document (dirty-checked). The window goes with the context;
    // closing the last one brings the Finder forward via the kit (no
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
    // the footer) captured no name. The Finder's New… lands here too
    // (`newDocument`, through deps.apps).
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
    function newDocument() {
      if (modalOpen()) return;
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
      if (ctx) editorWindows.showDocument(ctx.key);
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
        const canvas = deps.ring.renderSheet();
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
        downloadBlob(
          new Blob([zip], { type: 'application/zip' }),
          ringFilename(ctx.name)
        );
        dlgExportAtlas.close();
      } catch (err) {
        build.setError(`Export failed: ${err.message}`);
      }
    });

    // --- menus ------------------------------------------------------------------
    on(menuFile, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      const active = () => workspace.active();
      switch (menuDetail(e).value) {
        case 'new':
          newDocument();
          break;
        case 'close': {
          // The active document, dirty-checked.
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
          if (!files.get().available) showStorage();
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

    on(menuEdit, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      switch (menuDetail(e).value) {
        case 'undo':
          workspace.active()?.history.undo();
          break;
        case 'redo':
          workspace.active()?.history.redo();
          break;
        // Copy / Paste / Select All: the pixel clipboard's placeholders,
        // greyed in the markup until the selection tool's clipboard lands
        // (docs/selection-tool-plan.md) — nothing arrives here for them.
        case 'pick-color':
          session.openPicker();
          break;
        case 'tile-size':
          showTileDialog();
          break;
      }
    });

    on(menuTools, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      const v = menuDetail(e).value;
      if (v.startsWith('tool-'))
        session.setTool(/** @type {any} */ (v.slice('tool-'.length)));
    });

    on(menuView, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      const v = String(menuDetail(e).value ?? '');
      switch (v) {
        case 'ring':
          // The 3D Sprite Atlas windoid: a toggle on the prefs slice (off
          // every load); windows.js shows and hides the windoid off the
          // flag, and its close box clears it — one truth, mirrored back as
          // the checkmark by syncView below.
          prefs.setShowRing(!prefs.get().showRing);
          break;
        case 'arrange':
          // The boot placement re-run on the current raster — the window
          // manager's arrange, running this application's group (the
          // windoids and every open document window, windows.js) with every
          // other window. The item wears this
          // value only while something on screen is off its placement
          // (syncArrange below), so a pick always has something to arrange.
          windows.arrange();
          break;
        case 'zoom':
          // The same item's other command (syncArrange below): everything
          // already arranged, ⌘J zooms the active document window — the
          // zoom box's own toggle — under the same "Arrange Windows" label.
          editorWindows.zoomActive();
          break;
        default:
          // The open-windows section (syncWindows below): `window:<key>`
          // brings that document window forward through the kit's one
          // activation funnel (showDocument).
          if (v.startsWith('window:'))
            editorWindows.showDocument(v.slice('window:'.length));
          break;
      }
    });

    // --- checkmark + enabled sync ----------------------------------------------
    // Undo/Redo render disabled until the ACTIVE document's history has
    // something — which also hands their key strokes back to the browser (a
    // disabled item's shortcut deliberately never fires, so ⌘Z in a text field
    // stays native undo). followActive re-wires the history subscription as
    // activation moves between windows.
    const itemUndo = item(menuEdit, 'undo');
    const itemRedo = item(menuEdit, 'redo');
    const syncEdit = () => {
      const h = workspace.active()?.history.get();
      itemUndo.disabled = !h?.canUndo;
      itemRedo.disabled = !h?.canRedo;
    };
    teardown.push(
      followActive(workspace, (ctx) =>
        ctx ? ctx.history.subscribe(syncEdit) : undefined
      ),
      workspace.subscribe(syncEdit)
    );
    syncEdit();

    // --- Arrange Windows: one item, ⌘J, a STATE rule -------------------------------
    // The View menu's ⌘J item carries two commands, and which one is a
    // reading of the windows, never of what was pressed last: with anything
    // on screen off its placement — a drag, a grow, a zoom, the 3D Sprite
    // Atlas shown into the doc box's band, a browser resize the document
    // window sprung with — it is the ARRANGE, the placement re-run
    // (windows.arrange); with everything already where the placement puts it
    // — arrange would change nothing (windows.arranged) — it is the ZOOM,
    // the active document window through the zoom box's own toggle
    // (editorWindows.zoomActive). A window zoomed from its slot still reads
    // arranged — and so does any permutation of the documents across the
    // cascade's slots (a raise is bookkeeping, not layout) — so repeats of
    // ⌘J toggle the focused document between its slot and the vacancy while
    // nothing else moves, and from any other state the first ⌘J lands the
    // arrangement. The LABEL is fixed — "Arrange Windows" in both states,
    // the markup's own text, never rewritten here: the zoom is Arrange's
    // variant for a screen already arranged, not a second command to
    // announce (a label that turned with the state — "Zoom Window" once
    // arranged — was retired Sep 7 2026). Only the VALUE turns, so the
    // select handler above dispatches on it alone and a pick can never mean
    // the other thing. Greyed with no document window open (nothing on
    // screen to arrange) — which cannot be while this application is front,
    // and keeps the sync honest off the bar. windows.onLayout is the
    // geometry signal (every write that module makes, every gesture it
    // hears); the stores cover the window set and the placement's inputs.
    const itemArrange = /** @type {any} */ (
      menuView.querySelector('[data-item="arrange"]')
    );
    const syncArrange = () => {
      const open = workspace.get().contexts.length > 0;
      const arranged = open && windows.arranged();
      const value = arranged ? 'zoom' : 'arrange';
      if (itemArrange.getAttribute('value') !== value)
        itemArrange.setAttribute('value', value);
      itemArrange.disabled = !open;
    };
    teardown.push(
      workspace.subscribe(syncArrange),
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
    // window's, a reading of workspace.activeKey; the order is the
    // workspace's creation order — the cascade's own — never the stacking
    // order, which a raise changes: a menu that shuffles under the pointer
    // is hostile. The value is `window:<key>` (the context key, never the
    // name — two saved documents can share one), and a pick brings that
    // window forward through the kit's one activation funnel (showDocument:
    // bringToFront → vf-activate). With no document window open the
    // section is absent, separator included: the menu ends at the markup's
    // last item, and no dangling rule. RECONCILED, not rebuilt: an item
    // lives as long as its window — the kit re-queries its slotted items on
    // every access, so a runtime item is as live as an authored one — and
    // moves only when the light DOM disagrees with the order. `checkable`
    // up front: every item in the section is a check slot (the kit's own
    // advice for a toggle that starts off), so the unchecked ones announce
    // as such rather than as commands.
    const sectionAnchor = /** @type {Element} */ (menuView.lastElementChild);
    const windowSep = document.createElement('vf-separator');
    /** @type {Map<string, HTMLElementTagNameMap['vf-menu-item']>} ctx key -> its item */
    const windowItems = new Map();
    const syncWindows = () => {
      const { contexts, activeKey } = workspace.get();
      const live = new Set(contexts.map((c) => c.key));
      for (const [key, it] of windowItems) {
        if (!live.has(key)) {
          it.remove();
          windowItems.delete(key);
        }
      }
      const items = contexts.map((ctx) => {
        let it = windowItems.get(ctx.key);
        if (!it) {
          it = document.createElement('vf-menu-item');
          it.setAttribute('value', `window:${ctx.key}`);
          it.checkable = true;
          windowItems.set(ctx.key, it);
        }
        if (it.textContent !== ctx.name) it.textContent = ctx.name;
        it.checked = ctx.key === activeKey;
        return it;
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
      for (const it of windowItems.values()) it.remove();
      windowItems.clear();
    });
    syncWindows();

    // The Tools menu mirrors the sticky tool modes — exactly one item checked,
    // off the same session truth the tool strip and the S/B/R/G/E/I keys write.
    const toolItems = ['select', 'pencil', 'rect', 'fill', 'eraser', 'eyedropper'].map(
      (t) => [t, item(menuTools, `tool-${t}`)]
    );
    const syncTools = () => {
      for (const [t, it] of toolItems) it.checked = session.get().tool === t;
    };
    teardown.push(session.subscribe(syncTools));
    syncTools();

    // The View menu's 3D Sprite Atlas checkmark mirrors the prefs slice
    // (showRing): a pick toggles the slice, the check follows it (boots
    // unchecked, the slice's default; the windoid's close box lands here
    // through the same flag).
    const itemRing = item(menuView, 'ring');
    const syncView = () => {
      itemRing.checked = prefs.get().showRing;
    };
    teardown.push(prefs.subscribe(syncView));
    syncView();

    return {
      actions: {
        /** The New box (File → New… here, and the Finder's). */
        newDocument,
        /** A stored document's open — the icon layer's double-click. */
        openDoc,
        /** Bring an open document's window forward — a dropped file's
         *  (main.js). */
        showDocument: (key) => editorWindows.showDocument(key),
        confirmDiscard,
        closeContext,
        saveThen,
      },
      dispose() {
        for (const fn of teardown) fn();
        editorWindows.dispose();
      },
    };
  },
};
