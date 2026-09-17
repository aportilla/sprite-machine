// Sprite Editor: the document application. It wires menus.html and owns the
// document dialogs: New, the name prompt, Tile Size, the unsaved-changes alert
// and the two exports. windows.js owns its windows. The dialog markup is in
// index.html.
//
// - File actions target the active workspace context. Opening a document makes
//   a new window, or activates the window it already has.
// - confirmDiscard(ctx, next) is the dirty check: it runs next at once for a
//   clean document, else asks to save first.
// - The app is front only while a document window is active, so items need no
//   document gate.
// - Shortcuts fire app-wide, so every action returns while a modal is open
//   (deps.modalOpen). This blocks re-entry such as ⌘S inside the save prompt.

import menus from './menus.html?raw';
import { session } from '../../state/session.js';
import { prefs } from '../../state/prefs.js';
import { build } from '../../state/build.js';
import { shell, SPRITE_EDITOR } from '../../state/shell.js';
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
import { clipboard, pixelPasteSource } from '../../state/clipboard.js';
import { TILE_MIN, TILE_MAX, LAYER_MAX, clampTile, setTextChunks } from 'sprite-machine';
import { SAMPLES } from '../../lib/sprite-data.js';
import { pasteOrigin, floatFromImage } from '../../lib/select.js';
import { ringFrame, ringSheet, ringAnchor, ringYaws } from '../../lib/ring.js';
import { zipStore } from '../../lib/zip.js';
import { loadSample, loadBlank } from '../../loaders.js';
import {
  downloadPngBytes,
  downloadBlob,
  canvasToPngBytes,
  bytesToImageData,
  imageDataToPngBytes,
} from '../../image-io.js';
import { readSystemClipboard, pastedPng } from '../../system-clipboard.js';
import { initEditorWindows } from './windows.js';

/** @type {import('../index.js').App} */
export const spriteEditor = {
  id: SPRITE_EDITOR,
  name: 'Sprite Editor',
  menus,
  init({ menus, deps }) {
    const { desktop, windows, modalOpen, showStorage } = deps;
    // A document window's close box runs closeContext, which is dirty-checked.
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
    const menu = (name) => {
      const m = menus.find((el) => el.dataset.menu === name);
      if (!m) throw new Error(`apps/sprite-editor: missing menu ${name}`);
      return m;
    };
    const item = (m, value) => {
      const el = m.querySelector(`vf-menu-item[value="${value}"]`);
      if (!el) throw new Error(`apps/sprite-editor: missing item ${value}`);
      return /** @type {any} */ (el);
    };
    const menuFile = menu('file');
    const menuEdit = menu('edit');
    const menuLayer = menu('layer');
    const menuTools = menu('tools');
    const menuView = menu('view');

    /** @type {(() => void)[]} */
    const teardown = [];
    const on = (el, type, fn, opts) => {
      el.addEventListener(type, fn, opts);
      teardown.push(() => el.removeEventListener(type, fn, opts));
    };
    const menuDetail = (e) => /** @type {CustomEvent} */ (e).detail;

    // Dialogs
    const dlgNew = $('#dlg-new');
    const dlgName = $('#dlg-name');
    const dlgTile = $('#dlg-tile');
    const dlgUnsaved = $('#dlg-unsaved');
    const dlgExportModel = $('#dlg-export-model');
    const dlgExportAtlas = $('#dlg-export-atlas');

    // Export 3D Model…: one glb through deps.model (scene/model-export.js).
    // The scale is voxels per meter, since glTF units are meters. Unlit uses
    // KHR_materials_unlit. The field values are not saved.
    const modelScale = $('#model-scale');
    const modelLighting = $('#model-lighting');
    const modelStats = $('#model-stats');
    const modelSize = $('#model-size');
    const btnExportModelOk = $('#btn-export-model-ok');
    // A non-numeric field (mid-edit) keeps the last valid scale.
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

    // The name prompt for a first save, a rename or a layer rename. It resolves
    // only in vf-close, to the trimmed name or to null on Cancel or Escape. The
    // plain frame draws heading as a title, so the per-use text goes in the
    // caption and the label.
    const nameField = $('#name-field');
    const nameCaption = $('#name-caption');
    const btnNameOk = $('#btn-name-ok');
    const NAME_PROMPTS = {
      save: { label: 'Save', caption: 'Save document as:', ok: 'Save' },
      rename: { label: 'Rename', caption: 'Rename document to:', ok: 'Rename' },
      layer: { label: 'Rename Layer', caption: 'Rename layer to:', ok: 'Rename' },
    };
    const nameValid = () => String(nameField.value ?? '').trim() !== '';
    const syncNameOk = () => {
      btnNameOk.disabled = !nameValid();
    };
    let namePending = null; // { resolve, value } while open
    /** @param {'save'|'rename'|'layer'} use  @param {string} initial */
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
      if (e.key !== 'Enter' || !nameValid()) return;
      // The click closes the dialog during this keydown, and <dialog> returns
      // focus to its opener, which can be a window's close box. preventDefault
      // stops the keypress from clicking that close box while the save runs.
      e.preventDefault();
      btnNameOk.click();
    });
    on(dlgName, 'vf-close', () => {
      const p = namePending;
      namePending = null;
      p?.resolve(p.value);
    });

    // The unsaved-changes alert. Each button takes discardPending before
    // closing. vf-close clears it after Escape.
    const unsavedMsg = $('#unsaved-msg');
    let discardPending = null; // { ctx, next }
    // Keys of contexts with a saveThen in flight. The document stays dirty until
    // the save finishes, so a second close request must not ask again.
    const saving = new Set();
    function confirmDiscard(ctx, next) {
      if (!ctx || !ctx.dirty) {
        next();
        return;
      }
      if (saving.has(ctx.key) || dlgUnsaved.open) return;
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

    // Save and open
    // Save ctx, then run next. An untitled document prompts for a name first.
    // Cancel there stops the chain.
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

    // A stored document has one window. Opening it again activates that window.
    const openDoc = async (id) => {
      try {
        const res = await workspace.openStored(id);
        if (res) editorWindows.showDocument(res.ctx.key);
      } catch (err) {
        build.setError(`Couldn't open the document: ${err.message}`);
      }
    };

    // Close one document, dirty-checked. Its window closes with the context.
    const closeContext = (ctx) =>
      confirmDiscard(ctx, () => {
        workspace.close(ctx.key);
      });

    // Close every open document in turn, asking about each dirty one. Cancel
    // stops the rest.
    const quit = () => {
      const ctxs = workspace.get().contexts;
      if (!ctxs.length) return;
      const ctx = workspace.active() ?? ctxs[ctxs.length - 1];
      confirmDiscard(ctx, () => {
        workspace.close(ctx.key);
        quit();
      });
    };

    // New dialog
    // The name follows the template until the user types in it. The document
    // opens unsaved. A template shows its native tile size, disabled, because
    // a retile crops or pads the art.
    const newName = $('#new-name');
    const newTemplate = $('#new-template');
    const newTile = $('#new-tile');
    const btnNewOk = $('#btn-new-ok');
    newTile.min = TILE_MIN;
    newTile.max = TILE_MAX;
    const BLANK_TILE = 40; // a 120×80 atlas
    const BLANK = 'blank';
    // value is set as an attribute so the option is addressable by it.
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
    // Per open: the Empty Document tile size, kept across template changes, and
    // whether the name still follows the template.
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

    // Tile Size dialog
    // Seeded from the active document on show and applied on OK only. The kit's
    // number field clamps only on its own commit, so OK reads the raw text and
    // clamps it here.
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
        // A square, centered resize as one undo step.
        ctx.history.withAtlasSnapshot(() => ctx.doc.resizeTiles(n, n));
      }
    };
    on($('#btn-tile-cancel'), 'click', () => dlgTile.close());
    on($('#btn-tile-ok'), 'click', commitTileDialog);

    // Export Sprite Atlas dialog
    // The 3D Sprite Atlas settings as a form, bound live to the ring slice. Each
    // field's vf-change calls its setter, and the fields re-seed from the slice
    // while the dialog is open. Cancel does not revert.
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
    // Each setter ignores NaN and clamps. syncRingDialog shows the stored value.
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
    // Renders the whole strip, shown or not, as a PNG with the ring metadata
    // chunks and zips it with the TexturePacker JSON. A browser allows one
    // download per gesture.
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

    // Copy, Paste and Select All
    // They act on the active window's canvas: its edited face of its edited
    // layer. The clipboard slice is app-wide, so a copy pastes onto any face,
    // layer or document. Each paste reads the system clipboard, and the slice
    // keeps the copy's exact bytes and place.
    const activeEditor = () => {
      const ctx = workspace.active();
      return ctx ? editorWindows.editor(ctx.key) : null;
    };
    /** @typedef {import('../../lib/select.js').Float} Float */

    // The newest copy's system clipboard write while it is pending, else null. A
    // paste waits for it, so its read sees that copy.
    /** @type {Promise<void>|null} */
    let writing = null;
    function copyPixels() {
      const copy = activeEditor()?.copySelection();
      if (!copy) return;
      clipboard.setPixels(copy.float, copy.x, copy.y);
      const { pixels } = clipboard.get();
      const write = writePixels(pixels.float).then((ok) => {
        if (ok) clipboard.markWritten(pixels);
        if (writing === write) writing = null;
      });
      writing = write;
    }
    // One image/png part, with no text/plain for a text target to paste instead.
    // The part is the encode's promise, so write() is called in the menu pick's
    // task, as Safari requires. Resolves whether the write succeeded.
    /** @param {Float} float */
    async function writePixels(float) {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined')
        return false;
      const png = imageDataToPngBytes(float).then(
        (bytes) => new Blob([bytes], { type: 'image/png' })
      );
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
        return true;
      } catch {
        return false;
      }
    }

    // With no write pending, the read is called in the menu pick's task.
    async function paste() {
      if (writing) await writing;
      const system = await readSystemClipboard();
      dispatchPaste(system && { image: await decodeFloat(system.image) });
    }
    /** An image/png decoded and hardened, or null when absent or undecodable.
     *  @param {Blob|null} blob */
    async function decodeFloat(blob) {
      if (!blob) return null;
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return floatFromImage(await bytesToImageData(bytes));
      } catch {
        return null;
      }
    }
    /** @param {{image: Float|null}|null} system  null: unreadable */
    function dispatchPaste(system) {
      const slice = clipboard.get();
      switch (pixelPasteSource(slice, system)) {
        case 'pixels': {
          const { float, x, y } = slice.pixels;
          const { width, height, data, opaque } = float;
          placeFloat({ width, height, data: data.slice(), opaque }, { x, y });
          break;
        }
        case 'image':
          placeFloat(system.image, null);
          break;
        // 'none': nothing to paste.
      }
    }
    // Switches to the selection tool and pastes the float at `at` when it fits
    // the tile there, else centered. The canvas keeps the float it is handed. A
    // read resolves later, so the active window, a modal and a drag are checked
    // here.
    /** @param {Float} float  @param {{x: number, y: number}|null} at */
    function placeFloat(float, at) {
      const ctx = workspace.active();
      const editor = ctx ? editorWindows.editor(ctx.key) : null;
      if (!editor || modalOpen() || session.get().gesture) return;
      const { tileW, tileH } = ctx.doc.get();
      const { x, y } = pasteOrigin(float.width, float.height, at, tileW, tileH);
      session.setTool('select');
      editor.pasteFloat(float, x, y);
    }

    // The browser's own Edit → Paste fires a paste event with no key press. It is
    // the only route for a copied file, and clipboardData is readable only during
    // the event. The kit claims ⌘V while Paste is enabled, so a key press never
    // also fires it.
    on(document, 'paste', (e) => {
      if (shell.get().frontApp !== SPRITE_EDITOR || itemPaste.disabled || modalOpen())
        return;
      const dt = /** @type {ClipboardEvent} */ (e).clipboardData;
      if (!dt) return;
      e.preventDefault();
      decodeFloat(pastedPng(dt)).then((image) => dispatchPaste({ image }));
    });

    function selectAll() {
      const editor = activeEditor();
      if (!editor || session.get().gesture) return;
      session.setTool('select');
      editor.selectAll();
    }

    // Flip Horizontal and Flip Vertical, the selection tool's buttons in the
    // options strip. They act on the active window's selection.
    on($('sm-options-bar'), 'sm-flip-selection', (e) => {
      if (modalOpen()) return;
      activeEditor()?.flipSelection(/** @type {CustomEvent} */ (e).detail.axis);
    });

    // Menus
    on(menuFile, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      const active = () => workspace.active();
      switch (menuDetail(e).value) {
        case 'new':
          newDocument();
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
          if (!files.get().available) showStorage();
          else
            workspace
              .duplicate(ctx.key)
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
        case 'copy':
          copyPixels();
          break;
        case 'paste':
          paste();
          break;
        case 'select-all':
          selectAll();
          break;
        case 'tile-size':
          showTileDialog();
          break;
      }
    });

    on(menuLayer, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      const ctx = workspace.active();
      if (!ctx) return;
      const v = String(menuDetail(e).value ?? '');
      switch (v) {
        case 'layer-new':
          // The new layer becomes the edited one.
          if (ctx.history.withAtlasSnapshot(() => ctx.doc.addLayer())) {
            workspace.setLayer(ctx.key, ctx.doc.get().layers.length - 1);
          }
          break;
        case 'layer-delete': {
          // The layer above the deleted one becomes the edited one, or Layer 1.
          const i = ctx.layer;
          if (ctx.history.withAtlasSnapshot(() => ctx.doc.removeLayer(i))) {
            workspace.setLayer(ctx.key, i - 1);
          }
          break;
        }
        case 'layer-up':
        case 'layer-down': {
          // The moved layer stays the edited one.
          const i = ctx.layer;
          const to = v === 'layer-up' ? i - 1 : i + 1;
          if (ctx.history.withAtlasSnapshot(() => ctx.doc.moveLayer(i, to))) {
            workspace.setLayer(ctx.key, to);
          }
          break;
        }
        case 'layer-rename': {
          const i = ctx.layer;
          promptName('layer', ctx.doc.get().names[i] ?? '').then((name) => {
            if (name != null) {
              ctx.history.withNamesSnapshot(() => ctx.doc.renameLayer(i, name));
            }
          });
          break;
        }
        default:
          // An item from the layer list (syncLayers).
          if (v.startsWith('layer:')) {
            workspace.setLayer(ctx.key, Number(v.slice('layer:'.length)));
          }
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
          // windows.js shows the windoid from showRing. Its close box clears it.
          prefs.setShowRing(!prefs.get().showRing);
          break;
        case 'arrange':
          // syncArrange sets this value while a window is off its placement.
          windows.arrange();
          break;
        case 'zoom':
          // syncArrange sets this value once everything is arranged.
          editorWindows.zoomActive();
          break;
        default:
          // An item from the open-windows section (syncWindows).
          if (v.startsWith('window:'))
            editorWindows.showDocument(v.slice('window:'.length));
          break;
      }
    });

    // Checkmarks and enabled state
    // Undo and Redo are disabled until the active history has a step. A disabled
    // item's shortcut does not fire, so ⌘Z in a text field stays native undo.
    // followActive re-subscribes as the active document changes.
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

    // Copy, Paste and Select All are disabled during a canvas drag, and while a
    // text control has focus so the field keeps its native keys. Focus is read
    // from the composed path because kit fields keep their <input> in shadow
    // DOM. Copy also needs a selection in the active window. Paste ignores the
    // clipboard's contents, which cannot be read outside a pick. The selection's
    // bounds change at pointer-move rate, so disabled is written only on change.
    const itemCopy = item(menuEdit, 'copy');
    const itemPaste = item(menuEdit, 'paste');
    const itemSelectAll = item(menuEdit, 'select-all');
    /** Whether the innermost focused element is a text control. */
    let textFocused = false;
    const setDisabled = (it, v) => {
      if (it.disabled !== v) it.disabled = v;
    };
    const syncClipboard = () => {
      const off = textFocused || session.get().gesture;
      setDisabled(itemCopy, off || !workspace.active()?.selection.get().bounds);
      setDisabled(itemPaste, off);
      setDisabled(itemSelectAll, off);
    };
    teardown.push(
      followActive(workspace, (ctx) =>
        ctx ? ctx.selection.subscribe(syncClipboard) : undefined
      ),
      workspace.subscribe(syncClipboard),
      session.subscribe(syncClipboard)
    );
    on(document, 'focusin', (e) => {
      const t = e.composedPath()[0];
      const tag = t instanceof Element ? t.tagName : '';
      textFocused = tag === 'INPUT' || tag === 'TEXTAREA';
      syncClipboard();
    });
    on(document, 'focusout', () => {
      // A following focusin sets it again.
      textFocused = false;
      syncClipboard();
    });
    syncClipboard();

    // Option held: session.option, which the Tools palette and the canvas
    // preview read. It is set only while the Sprite Editor is front, no modal
    // is open and no text field has focus. A press reads its own altKey. Every
    // key and pointer event re-reads the key, since a key-up is lost when
    // Option is released in another program.
    const capture = { capture: true, passive: true };
    const holdOption = (held) =>
      session.setOption(held && shell.get().appActive && !textFocused && !modalOpen());
    const onOptionKey = (e) =>
      holdOption(e.key === 'Alt' ? e.type === 'keydown' : e.altKey);
    const onOptionPointer = (e) => holdOption(e.altKey);
    on(window, 'keydown', onOptionKey, capture);
    on(window, 'keyup', onOptionKey, capture);
    on(window, 'pointermove', onOptionPointer, capture);
    on(window, 'pointerdown', onOptionPointer, capture);
    on(window, 'blur', () => session.setOption(false));
    on(document, 'visibilitychange', () => {
      if (document.hidden) session.setOption(false);
    });
    teardown.push(
      shell.subscribe((s) => {
        if (!s.appActive) session.setOption(false);
      })
    );

    // Arrange Windows (⌘J). The value is "zoom" when windows.arranged() holds, else
    // "arrange". The label does not change. A window zoomed from its slot, or
    // documents reordered across the cascade, still count as arranged, so
    // repeated ⌘J toggles the active window's zoom.
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

    // Open document windows, listed after a separator at the end of the View
    // menu. Items follow workspace creation order, so raising a window does not
    // reorder the menu. The value uses the context key because two documents
    // can share a name. checkable makes unchecked items announce as check items.
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

    // The Layer menu's list: one item per layer of the active document, after
    // the separator, in block order, named for the layer with the edited one
    // checked and its digit key shown. The count and names change on the doc's
    // structural channel, the edited layer on the workspace store.
    const itemLayerNew = item(menuLayer, 'layer-new');
    const itemLayerDelete = item(menuLayer, 'layer-delete');
    const itemLayerUp = item(menuLayer, 'layer-up');
    const itemLayerDown = item(menuLayer, 'layer-down');
    const layerAnchor = /** @type {Element} */ (menuLayer.lastElementChild);
    /** @type {HTMLElementTagNameMap['vf-menu-item'][]} by layer */
    const layerItems = [];
    const syncLayers = () => {
      const ctx = workspace.active();
      const names = ctx ? ctx.doc.get().names : [];
      while (layerItems.length > names.length) layerItems.pop().remove();
      names.forEach((name, i) => {
        let it = layerItems[i];
        if (!it) {
          it = document.createElement('vf-menu-item');
          it.setAttribute('value', `layer:${i}`);
          it.setAttribute('shortcut', String(i + 1));
          it.checkable = true;
          (layerItems[i - 1] ?? layerAnchor).after(it);
          layerItems.push(it);
        }
        if (it.textContent !== name) it.textContent = name;
        it.checked = i === ctx.layer;
      });
      itemLayerNew.disabled = !ctx || names.length >= LAYER_MAX;
      itemLayerDelete.disabled = !ctx || names.length <= 1;
      itemLayerUp.disabled = !ctx || ctx.layer <= 0;
      itemLayerDown.disabled = !ctx || ctx.layer >= names.length - 1;
    };
    teardown.push(
      workspace.subscribe(syncLayers),
      followActive(workspace, (ctx) => (ctx ? ctx.doc.subscribe(syncLayers) : undefined)),
      () => {
        for (const it of layerItems) it.remove();
        layerItems.length = 0;
      }
    );
    syncLayers();

    // The Tools menu checks the session's current tool.
    const toolItems = ['select', 'pencil', 'rect', 'fill', 'eraser', 'eyedropper'].map(
      (t) => [t, item(menuTools, `tool-${t}`)]
    );
    const syncTools = () => {
      for (const [t, it] of toolItems) it.checked = session.get().tool === t;
    };
    teardown.push(session.subscribe(syncTools));
    syncTools();

    // The 3D Sprite Atlas checkmark follows its pref.
    const itemRing = item(menuView, 'ring');
    const syncView = () => {
      itemRing.checked = prefs.get().showRing;
    };
    teardown.push(prefs.subscribe(syncView));
    syncView();

    return {
      actions: {
        /** Opens the New dialog. */
        newDocument,
        /** Opens a stored document, or activates its window. */
        openDoc,
        /** Brings an open document's window forward. */
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
