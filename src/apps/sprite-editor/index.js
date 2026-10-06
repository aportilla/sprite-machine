// Sprite Editor: the document application, on the kit's shell
// (vintage-frames/shell). It registers the `sprite` kind, wires menus.html, and
// owns the document dialogs (dialogs.html, asked with ctx.ask): New, the name
// prompt, Tile Size, Save Changes, the two exports, Storage Unavailable and
// its alert. It holds the Colors picker too. windows.js owns its windows.
//
// - A stored document is a catalog item and its bytes in the sheet store
//   (state/sheets.js). The kind's hooks keep the bytes in step with the
//   Finder: Open, Copy, Paste, a dropped file and Empty Trash.
// - File actions target the active workspace context. Opening a document makes
//   a new window, or activates the window it already has.
// - confirmDiscard(ctx, next) is the dirty check: it runs next at once for a
//   clean document, else asks to save first.
// - The app is front only while a document window is active, so items need no
//   document gate.
// - Each saved document's face and layer, and whether the 3D Sprite Atlas
//   shows, are kept with the session (its `docs` and `showRing` extras).

import { childrenOf, defineApp } from 'vintage-frames/shell';
import menus from './menus.html?raw';
import dialogs from './dialogs.html?raw';
import windowMarkup from './windows.html?raw';
import { session } from '../../state/session.js';
import { prefs } from '../../state/prefs.js';
import { build } from '../../state/build.js';
import {
  ring,
  ringMetaChunks,
  texturePackerJson,
  RING_MAX_VIEWS,
  RING_MIN_SIZE,
  RING_MAX_SIZE,
} from '../../state/ring.js';
import {
  UNTITLED,
  docFilename,
  ringFilename,
  ringBasename,
  modelFilename,
  slugOf,
} from '../../state/names.js';
import { SPRITE, spriteData } from '../../state/kinds.js';
import { sheets, readSheetMeta } from '../../state/sheets.js';
import { workspace, followActive } from '../../state/workspace.js';
import { clipboard, pixelPasteSource } from '../../state/clipboard.js';
import { TILE_MIN, TILE_MAX, LAYER_MAX, clampTile, setTextChunks } from 'sprite-machine';
import { sheetLayers } from '../../lib/sheet-shape.js';
import { SAMPLES } from '../../lib/sprite-data.js';
import { nextLayerName } from '../../lib/layers.js';
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
  genericDocIconDataUri,
} from '../../image-io.js';
import { readSystemClipboard, pastedPng } from '../../system-clipboard.js';
import { alert } from '../windows.js';
import { initEditorWindows } from './windows.js';

export const SPRITE_EDITOR = 'sprite-editor';

/**
 * @param {{sheetStore: import('../../state/sheets.js').SheetDeps['store'],
 *          icons: ReturnType<typeof import('../../scene/icon-renderer.js').createIconRenderer>}} io
 *   sheetStore: where the documents' bytes are kept (storage/db.js).
 *   icons: the renderer of each document's icon.
 */
export function spriteEditor({ sheetStore, icons }) {
  /** What the kind's hooks call, once init has run. */
  let live = /** @type {null | {
   *   openDoc(id: string, opts?: {from?: import('vintage-frames').VfViewportBox|null}): Promise<void>,
   *   removed(item: import('vintage-frames/shell').Item): Promise<void>,
   *   claim(file: Blob, parent: string|null): Promise<boolean>,
   * }} */ (null);

  return defineApp({
    id: SPRITE_EDITOR,
    name: 'Sprite Editor',
    menus,
    dialogs,
    windows: windowMarkup,
    kinds: {
      [SPRITE]: {
        art: (item) => spriteData(item).icon ?? genericDocIconDataUri(),
        open: (item, from) => void live?.openDoc(item.id, { from }),
        size: (item) => spriteData(item).size,
        copy: (from, to) => sheets.copy(from, to),
        onRemove: (item) => live?.removed(item),
        claim: (file, parent) => live?.claim(file, parent) ?? Promise.resolve(false),
        export: async (item) => {
          const bytes = await sheets.bytesOf(item.id);
          return bytes ? new Blob([bytes], { type: 'image/png' }) : null;
        },
      },
    },
    init(ctx) {
      const { desktop, windows } = ctx;
      const catalog = /** @type {import('vintage-frames/shell').Catalog} */ (ctx.catalog);
      const services = ctx.services;
      sheets.init({
        store: sheetStore,
        catalog,
        encodeAtlas: imageDataToPngBytes,
        decodeAtlas: bytesToImageData,
        makeIcon: async (state) =>
          icons.render(state.atlasImage, state.transforms, state.layers.length),
        // A stored PNG's icon, from its own bytes: the chunks hold the
        // transforms and the shape holds the layer count.
        iconFromBytes: async (bytes, image) =>
          icons.render(
            image,
            readSheetMeta(bytes).transforms,
            sheetLayers(image.width, image.height)
          ),
      });
      workspace.init(catalog);

      // The session's extras: each saved document's face and layer as the last
      // session left them, read once here; and the 3D Sprite Atlas, shown before
      // the windows are made.
      /** @type {Record<string, {face?: string|null, layer?: number|null}>} */
      const savedDocs = { ...(ctx.state?.get('docs') ?? {}) };
      prefs.setShowRing(ctx.state?.get('showRing') === true);

      // The Colors picker, held as one of the Sprite Editor's dialogs: it
      // renders its vf-dialog in its own light DOM, which the shell follows.
      ctx.hold(document.createElement('sm-color-picker'));
      const modalOpen = () => ctx.modalOpen() || session.get().pickerOpen;
      const showStorage = () => void ctx.ask(ctx.dialog('storage-unavailable'));
      const stored = () => catalog.get().available;
      /** A failure, or anything else the Sprite Editor has to say.
       *  @param {string} message */
      const say = (message) => void alert(ctx, ctx.dialog('alert'), message);

      // A document window's close box runs closeContext, which is dirty-checked.
      const editorWindows = initEditorWindows(ctx, SPRITE_EDITOR, {
        onDocumentClose: async (key) => {
          const doc = workspace.byKey(key);
          if (doc) await closeContext(doc);
        },
      });
      /** An element the page or a held dialog holds. */
      const $ = (/** @type {ParentNode} */ root, /** @type {string} */ sel) => {
        const el = root.querySelector(sel);
        if (!el) throw new Error(`apps/sprite-editor: missing element ${sel}`);
        return /** @type {any} */ (el);
      };
      const menuView = ctx.menu('view');
      const menuLayer = ctx.menu('layer');
      const item = (value) => /** @type {any} */ (ctx.item(value));
      const on = ctx.on;

      // Dialogs
      const dialog = (/** @type {string} */ name) =>
        /** @type {any} */ (ctx.dialog(name));
      const dlgNew = dialog('new');
      const dlgName = dialog('name');
      const dlgTile = dialog('tile');
      const dlgUnsaved = dialog('save-changes');
      const dlgExportModel = dialog('export-model');
      const dlgExportAtlas = dialog('export-atlas');

      // Export 3D Model…: one glb through services.model (scene/model-export.js).
      // The scale is voxels per meter, since glTF units are meters. Unlit uses
      // KHR_materials_unlit. The field values are not saved.
      const modelScale = $(dlgExportModel, '#model-scale');
      const modelLighting = $(dlgExportModel, '#model-lighting');
      const modelStats = $(dlgExportModel, '[data-stats]');
      const modelSize = $(dlgExportModel, '[data-size]');
      const btnExportModelOk = $(dlgExportModel, '[data-ok]');
      // A non-numeric field (mid-edit) keeps the last valid scale.
      let lastScale = Number(modelScale.value) || 1;
      const voxelsPerMeter = () => {
        const n = Math.round(Number(modelScale.value));
        if (Number.isFinite(n) && n >= 1) lastScale = n;
        return lastScale;
      };
      const metres = (v) => String(Math.round(v * 100) / 100);
      const seedModelDialog = () => {
        const st = services.model.stats();
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
      async function showModelDialog() {
        seedModelDialog();
        if ((await ctx.ask(dlgExportModel)) !== 'export') return;
        const doc = workspace.active();
        if (!doc) return;
        try {
          const glb = services.model.exportGlb({
            name: doc.name,
            voxelsPerMeter: voxelsPerMeter(),
            unlit: modelLighting.value === 'unlit',
            generator: `sprite-machine ${__APP_VERSION__}`,
          });
          if (!glb) return;
          downloadBlob(
            new Blob([glb], { type: 'model/gltf-binary' }),
            modelFilename(doc.name)
          );
        } catch (err) {
          say(`Export failed: ${err.message}.`);
        }
      }
      ctx.onDispose(build.subscribe(syncModelDialog));
      on(modelScale, 'vf-change', syncModelDialog);

      // The name prompt for a first save, a rename, a new layer or a layer
      // rename. It resolves to the trimmed name, or to null on Cancel or
      // Escape. The name opens selected, so typing replaces it. Return presses
      // OK, which stays disabled while the name is empty. The plain frame
      // draws no heading, so the per-use text goes in the caption and the
      // label.
      const nameField = $(dlgName, '#name-field');
      const nameCaption = $(dlgName, '[data-caption]');
      const btnNameOk = $(dlgName, '[data-ok]');
      const NAME_PROMPTS = {
        save: { label: 'Save', caption: 'Save document as:', ok: 'Save' },
        rename: { label: 'Rename', caption: 'Rename document to:', ok: 'OK' },
        'new-layer': { label: 'New Layer', caption: 'Name the new layer:', ok: 'OK' },
        layer: { label: 'Rename Layer', caption: 'Rename layer to:', ok: 'OK' },
      };
      const nameValid = () => String(nameField.value ?? '').trim() !== '';
      const syncNameOk = () => {
        btnNameOk.disabled = !nameValid();
      };
      /** @param {'save'|'rename'|'new-layer'|'layer'} use  @param {string} initial
       *  @returns {Promise<string|null>} */
      async function promptName(use, initial) {
        const p = NAME_PROMPTS[use];
        dlgName.label = p.label;
        nameCaption.textContent = p.caption;
        btnNameOk.textContent = p.ok;
        nameField.value = initial;
        syncNameOk();
        return (await ctx.ask(dlgName)) === 'ok' && nameValid()
          ? String(nameField.value).trim()
          : null;
      }
      on(nameField, 'vf-input', syncNameOk);

      // Save Changes, asked over its document's window.
      const unsavedMsg = $(dlgUnsaved, '[data-message]');
      // Keys of contexts with a saveThen in flight. The document stays dirty until
      // the save finishes, so a second close request must not ask again.
      const saving = new Set();
      async function confirmDiscard(doc, next) {
        if (!doc || !doc.dirty) {
          next();
          return;
        }
        if (saving.has(doc.key) || dlgUnsaved.open) return;
        editorWindows.showDocument(doc.key);
        unsavedMsg.textContent = `Save changes to “${doc.name}” before closing?`;
        const answer = await ctx.ask(dlgUnsaved);
        if (answer === 'discard') next();
        else if (answer === 'save') await saveThen(doc, next);
      }

      // Save and open
      // Save doc, then run next. An untitled document prompts for a name first.
      // Cancel there stops the chain.
      async function saveThen(doc, next) {
        if (!stored()) {
          showStorage();
          return;
        }
        saving.add(doc.key);
        try {
          if (doc.fileId) {
            await workspace.save(doc.key);
          } else {
            const initial = doc.name;
            const name = await promptName(
              'save',
              initial === UNTITLED || /^untitled \d+$/.test(initial) ? '' : initial
            );
            if (name == null) return;
            await workspace.save(doc.key, name);
          }
          next?.();
        } catch (err) {
          say(`Save failed: ${err.message}.`);
        } finally {
          saving.delete(doc.key);
        }
      }

      // A stored document has one window. Opening it again activates that
      // window. A new one opens on the face and layer it was last left at, or
      // on `face`. `from` is the box a new window grows out of. The reconciler
      // makes the window inside openStored, in this task, so it has not painted
      // when show() runs.
      /** @param {string} id
       *  @param {{from?: import('vintage-frames').VfViewportBox|null, face?: string|null}} [opts] */
      const openDoc = async (id, { from = null, face = null } = {}) => {
        try {
          const res = await workspace.openStored(id);
          if (!res) return;
          if (!res.existed) {
            const was = savedDocs[id];
            const f = face ?? was?.face;
            if (f) workspace.setFace(res.ctx.key, f);
            if (Number.isInteger(was?.layer)) {
              workspace.setLayer(res.ctx.key, /** @type {number} */ (was.layer));
            }
          }
          editorWindows.showDocument(res.ctx.key, { from: res.existed ? null : from });
        } catch (err) {
          const name = catalog.item(id)?.name;
          say(`“${name ?? UNTITLED}” couldn’t be opened: ${err.message}.`);
        }
      };

      // Each saved document's face and layer, for the next load.
      const writeDocs = () => {
        if (!ctx.state) return;
        /** @type {Record<string, {face: string, layer: number}>} */
        const docs = {};
        for (const c of workspace.get().contexts) {
          if (c.fileId) docs[c.fileId] = { face: c.face, layer: c.layer };
        }
        if (JSON.stringify(docs) !== JSON.stringify(ctx.state.get('docs') ?? {})) {
          ctx.state.set('docs', docs);
        }
      };
      ctx.onDispose(workspace.subscribe(writeDocs));
      ctx.onDispose(
        prefs.subscribe(() => {
          const shown = prefs.get().showRing;
          if (ctx.state && ctx.state.get('showRing') !== shown)
            ctx.state.set('showRing', shown);
        })
      );

      // Close one document, dirty-checked. Its window closes with the context,
      // and the promise settles once it has or the user cancelled, so Quit
      // (windows.closeAll) stops at a Cancel.
      const closeContext = (doc) =>
        confirmDiscard(doc, () => {
          workspace.close(doc.key);
        });

      // The kind's hooks.
      /** The first free "untitled", "untitled 2", … among the documents in
       *  `parent`. @param {string|null} parent */
      const nextUntitled = (parent) => {
        const used = new Set(
          childrenOf(catalog.get(), parent)
            .filter((i) => i.kind === SPRITE)
            .map((i) => i.name)
        );
        if (!used.has(UNTITLED)) return UNTITLED;
        for (let n = 2; ; n++)
          if (!used.has(`${UNTITLED} ${n}`)) return `${UNTITLED} ${n}`;
      };
      // The alert for an image that isn't a sprite sheet, with its size, or
      // without one when it did not decode.
      /** @param {{width: number, height: number}|null} image */
      function showNotSheet(image) {
        const rule =
          `The image isn’t a sprite sheet: a sheet stacks 1 to ${LAYER_MAX} ` +
          `layers top to bottom, each a 3 × 2 atlas of square tiles from ` +
          `${3 * TILE_MIN} × ${2 * TILE_MIN} to ${3 * TILE_MAX} × ${2 * TILE_MAX} pixels.`;
        say(image ? `${rule} This image is ${image.width} × ${image.height}.` : rule);
      }
      // Documents whose items are going: each open one keeps its window and
      // pixels as an untitled, unsaved document. Off its item first, so the
      // shell doesn't close the window when the item goes.
      /** @param {string[]} ids */
      const detach = (ids) => {
        for (const id of ids) {
          const doc = workspace.byFileId(id);
          const win = doc ? editorWindows.windowOf(doc.key) : null;
          if (win) windows.setItem(win, null);
        }
        workspace.forget(ids);
      };
      live = {
        openDoc,
        /** Empty Trash removed a document: its bytes go too. */
        async removed(it) {
          detach([it.id]);
          await sheets.remove(it.id).catch(() => {});
        },
        /** A pasted or dropped image, stored where it landed if it is a sheet:
         *  named by its Title, else the dropped file's name, else the next
         *  untitled name with the rename box open. */
        async claim(file, parent) {
          const name = /** @type {any} */ (file).name;
          const isImage =
            file.type.startsWith('image/') ||
            (!file.type && typeof name === 'string' && /\.png$/i.test(name));
          if (!isImage) return false;
          const dropped =
            typeof name === 'string' && name ? name.replace(/\.[^.]+$/, '') : null;
          const res = await sheets.storeBytes(new Uint8Array(await file.arrayBuffer()), {
            parent,
            fallback: dropped ?? nextUntitled(parent),
          });
          if ('refused' in res) {
            showNotSheet(res.refused);
            return true;
          }
          const finder = ctx.apps.finder;
          finder?.select([res.item.id]);
          if (!res.titled && !dropped) void finder?.rename(res.item.id);
          return true;
        },
      };
      ctx.onDispose(() => {
        live = null;
      });

      // New dialog
      // The name opens selected and follows the template until the user types
      // in it. The document opens unsaved. A template shows its native tile
      // size, disabled, because a retile crops or pads the art.
      const newName = $(dlgNew, '#new-name');
      const newTemplate = $(dlgNew, '#new-template');
      const newTile = $(dlgNew, '#new-tile');
      const btnNewOk = $(dlgNew, '[data-ok]');
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
      async function newDocument() {
        if (modalOpen()) return;
        newTemplate.value = BLANK;
        newTile.disabled = false;
        newTile.value = String(BLANK_TILE);
        blankTile = BLANK_TILE;
        nameAuto = true;
        newName.value = workspace.nextUntitledName();
        syncNewForm();
        if ((await ctx.ask(dlgNew)) !== 'ok') return;
        const name = typedName();
        if (!name) return;
        const sample = pickedSample();
        try {
          const doc = sample
            ? await loadSample(sample, { name })
            : loadBlank(clampTile(+newTile.value || BLANK_TILE), name);
          editorWindows.showDocument(doc.key);
        } catch (err) {
          say(`${err.message}.`);
        }
      }
      on(newTemplate, 'vf-change', () => {
        if (nameAuto)
          newName.value = pickedSample()?.name ?? workspace.nextUntitledName();
        syncNewForm();
      });
      on(newName, 'vf-input', () => {
        nameAuto = false;
        syncNewForm();
      });
      on(newTile, 'vf-change', syncNewForm);

      // Tile Size dialog
      // Seeded from the active document on show and applied on OK only. The kit's
      // number field commits before OK submits but keeps text that isn't a
      // number, so OK checks and clamps it here.
      const tileField = $(dlgTile, '#tile-size');
      tileField.min = TILE_MIN;
      tileField.max = TILE_MAX;
      async function showTileDialog() {
        const d = workspace.active()?.doc.get();
        if (!d) return;
        tileField.value = String(d.tileW);
        if ((await ctx.ask(dlgTile)) !== 'ok') return;
        const doc = workspace.active();
        if (!doc) return;
        const typed = Math.round(Number(tileField.value));
        if (!(typed >= 1)) return;
        const n = clampTile(typed);
        if (n !== doc.doc.get().tileW) {
          // A square, centered resize as one undo step.
          doc.history.withAtlasSnapshot(() => doc.doc.resizeTiles(n, n));
        }
      }

      // Export Sprite Atlas dialog
      // The 3D Sprite Atlas settings as a form, bound live to the ring slice. Each
      // field's vf-change calls its setter, and the fields re-seed from the slice
      // while the dialog is open. Cancel does not revert.
      const atlasViews = $(dlgExportAtlas, '#atlas-views');
      const atlasStep = $(dlgExportAtlas, '[data-step]');
      const atlasElevation = $(dlgExportAtlas, '#atlas-elevation');
      const atlasOffset = $(dlgExportAtlas, '#atlas-offset');
      const atlasSize = $(dlgExportAtlas, '#atlas-size');
      const atlasDims = $(dlgExportAtlas, '[data-dims]');
      const btnExportAtlasOk = $(dlgExportAtlas, '[data-ok]');
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
      // Renders the whole strip, shown or not, as a PNG with the ring metadata
      // chunks and zips it with the TexturePacker JSON. A browser allows one
      // download per gesture.
      async function showRingDialog() {
        seedRingDialog();
        if ((await ctx.ask(dlgExportAtlas)) !== 'export') return;
        const doc = workspace.active();
        const dims = build.get().dims;
        if (!doc || !dims) return;
        try {
          const canvas = services.ring.renderSheet();
          const st = ring.get();
          const { px, scale } = ringFrame(dims, st.elevation, st.size);
          const geometry = {
            frame: px,
            scale,
            anchor: ringAnchor(dims, st.elevation, st.size),
            yaws: ringYaws(st.views, st.offset),
          };
          const base = ringBasename(doc.name);
          const png = setTextChunks(
            await canvasToPngBytes(canvas),
            ringMetaChunks(doc.name, st, geometry)
          );
          const json = texturePackerJson(slugOf(doc.name), st, geometry, {
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
            ringFilename(doc.name)
          );
        } catch (err) {
          say(`Export failed: ${err.message}.`);
        }
      }
      // The 3D Sprite Atlas windoid's Export button opens the same dialog.
      on($(desktop, 'sm-ring-controls'), 'sm-export-atlas', () => {
        if (modalOpen()) return;
        showRingDialog();
      });
      ctx.onDispose(ring.subscribe(syncRingDialog));
      ctx.onDispose(build.subscribe(syncRingDialog));
      // Each setter ignores NaN and clamps. syncRingDialog shows the stored value.
      const ringField = (el, set) =>
        on(el, 'vf-change', (e) => {
          set(/** @type {CustomEvent} */ (e).detail.valueAsNumber);
          syncRingDialog();
        });
      ringField(atlasViews, (v) => ring.setViews(v));
      ringField(atlasElevation, (v) => ring.setElevation(v));
      ringField(atlasOffset, (v) => ring.setOffset(v));
      ringField(atlasSize, (v) => ring.setSize(v));

      // Copy, Paste and Select All
      // They act on the active window's canvas: its edited face of its edited
      // layer. The clipboard slice is app-wide, so a copy pastes onto any face,
      // layer or document. Each paste reads the system clipboard, and the slice
      // keeps the copy's exact bytes and place.
      const activeEditor = () => {
        const doc = workspace.active();
        return doc ? editorWindows.editor(doc.key) : null;
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
        const write = writePixels(/** @type {any} */ (pixels).float).then((ok) => {
          if (ok && pixels) clipboard.markWritten(pixels);
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
            const { float, x, y } = /** @type {any} */ (slice.pixels);
            const { width, height, data, opaque } = float;
            placeFloat({ width, height, data: data.slice(), opaque }, { x, y });
            break;
          }
          case 'image':
            placeFloat(/** @type {any} */ (system).image, null);
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
        const doc = workspace.active();
        const editor = doc ? editorWindows.editor(doc.key) : null;
        if (!doc || !editor || modalOpen() || session.get().gesture) return;
        const { tileW, tileH } = doc.doc.get();
        const { x, y } = pasteOrigin(float.width, float.height, at, tileW, tileH);
        session.setTool('select');
        editor.pasteFloat(float, x, y);
      }

      // The browser's own Edit → Paste fires a paste event with no key press. It is
      // the only route for a copied file, and clipboardData is readable only during
      // the event. The kit claims ⌘V while Paste is enabled, so a key press never
      // also fires it.
      on(document, 'paste', (e) => {
        if (windows.front !== SPRITE_EDITOR || itemPaste.disabled || modalOpen()) return;
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

      // Clear, the Delete key's command as a menu item.
      function clearPixels() {
        if (session.get().gesture) return;
        activeEditor()?.clearSelection();
      }

      // Flip Horizontal and Flip Vertical, the selection tool's buttons in the
      // options strip. They act on the active window's selection.
      on($(desktop, 'sm-options-bar'), 'sm-flip-selection', (e) => {
        if (modalOpen()) return;
        activeEditor()?.flipSelection(/** @type {CustomEvent} */ (e).detail.axis);
      });

      // Menus. The shell drops picks while a modal is open.
      ctx.onMenu((value) => {
        if (session.get().pickerOpen) return;
        const doc = workspace.active();
        switch (value) {
          // File
          case 'new':
            newDocument();
            break;
          case 'close':
            if (doc) closeContext(doc);
            break;
          case 'save':
            if (doc) saveThen(doc, null);
            break;
          case 'duplicate':
            if (!doc) break;
            if (!stored()) showStorage();
            else
              workspace
                .duplicate(doc.key)
                .then((id) => (id ? openDoc(id) : null))
                .catch((err) => say(`Duplicate failed: ${err.message}.`));
            break;
          case 'rename':
            if (!doc) break;
            promptName('rename', doc.name).then((name) => {
              if (name != null) {
                workspace
                  .rename(doc.key, name)
                  .catch((err) => say(`Rename failed: ${err.message}.`));
              }
            });
            break;
          case 'download':
            if (!doc) break;
            workspace
              .exportOf(doc.key)
              .then((res) => res && downloadPngBytes(res.bytes, docFilename(res.name)))
              .catch((err) => say(`Download failed: ${err.message}.`));
            break;
          case 'export-model':
            showModelDialog();
            break;
          case 'export-atlas':
            showRingDialog();
            break;
          case 'quit':
            void windows.closeAll(SPRITE_EDITOR);
            break;
          // Edit
          case 'undo':
            doc?.history.undo();
            break;
          case 'redo':
            doc?.history.redo();
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
          case 'clear':
            clearPixels();
            break;
          case 'tile-size':
            showTileDialog();
            break;
          // Layer
          case 'layer-new':
            // Added on OK. The new layer becomes the edited one.
            if (!doc) break;
            promptName('new-layer', nextLayerName(doc.doc.get().names)).then((name) => {
              if (name == null) return;
              if (doc.history.withAtlasSnapshot(() => doc.doc.addLayer(name))) {
                workspace.setLayer(doc.key, doc.doc.get().layers.length - 1);
              }
            });
            break;
          case 'layer-delete': {
            // The layer above the deleted one becomes the edited one, or Layer 1.
            if (!doc) break;
            const i = doc.layer;
            if (doc.history.withAtlasSnapshot(() => doc.doc.removeLayer(i))) {
              workspace.setLayer(doc.key, i - 1);
            }
            break;
          }
          case 'layer-up':
          case 'layer-down': {
            // The moved layer stays the edited one.
            if (!doc) break;
            const i = doc.layer;
            const to = value === 'layer-up' ? i - 1 : i + 1;
            if (doc.history.withAtlasSnapshot(() => doc.doc.moveLayer(i, to))) {
              workspace.setLayer(doc.key, to);
            }
            break;
          }
          case 'layer-rename': {
            if (!doc) break;
            const i = doc.layer;
            promptName('layer', doc.doc.get().names[i] ?? '').then((name) => {
              if (name != null) {
                doc.history.withNamesSnapshot(() => doc.doc.renameLayer(i, name));
              }
            });
            break;
          }
          // View
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
            if (value.startsWith('tool-')) {
              session.setTool(/** @type {any} */ (value.slice('tool-'.length)));
            } else if (value.startsWith('layer:') && doc) {
              // An item from the layer list (syncLayers).
              workspace.setLayer(doc.key, Number(value.slice('layer:'.length)));
            } else if (value.startsWith('window:')) {
              // An item from the open-windows section (syncWindows).
              editorWindows.showDocument(value.slice('window:'.length));
            }
            break;
        }
      });

      // Checkmarks and enabled state
      // Undo and Redo are disabled until the active history has a step. A disabled
      // item's shortcut does not fire, so ⌘Z in a text field stays native undo.
      // followActive re-subscribes as the active document changes.
      const itemUndo = item('undo');
      const itemRedo = item('redo');
      const syncEdit = () => {
        const h = workspace.active()?.history.get();
        itemUndo.disabled = !h?.canUndo;
        itemRedo.disabled = !h?.canRedo;
      };
      ctx.onDispose(
        followActive(workspace, (doc) =>
          doc ? doc.history.subscribe(syncEdit) : undefined
        )
      );
      ctx.onDispose(workspace.subscribe(syncEdit));
      syncEdit();

      // Copy, Paste, Select All and Clear are disabled during a canvas drag, and
      // while a text control has focus so the field keeps its native keys. Focus
      // is read from the composed path because kit fields keep their <input> in
      // shadow DOM. Copy and Clear also need a selection in the active window.
      // Paste ignores the clipboard's contents, which cannot be read outside a
      // pick. The selection's bounds change at pointer-move rate, so disabled is
      // written only on change.
      const itemCopy = item('copy');
      const itemPaste = item('paste');
      const itemSelectAll = item('select-all');
      const itemClear = item('clear');
      /** Whether the innermost focused element is a text control. */
      let textFocused = false;
      const setDisabled = (it, v) => {
        if (it.disabled !== v) it.disabled = v;
      };
      const syncClipboard = () => {
        const off = textFocused || session.get().gesture;
        const noSelection = !workspace.active()?.selection.get().bounds;
        setDisabled(itemCopy, off || noSelection);
        setDisabled(itemPaste, off);
        setDisabled(itemSelectAll, off);
        setDisabled(itemClear, off || noSelection);
      };
      ctx.onDispose(
        followActive(workspace, (doc) =>
          doc ? doc.selection.subscribe(syncClipboard) : undefined
        )
      );
      ctx.onDispose(workspace.subscribe(syncClipboard));
      ctx.onDispose(session.subscribe(syncClipboard));
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

      // The front application: the options strip and the tool keys follow it.
      // Option held: session.option, which the Tools palette and the canvas
      // preview read. It is set only while the Sprite Editor is front, no modal
      // is open and no text field has focus. A press reads its own altKey. Every
      // key and pointer event re-reads the key, since a key-up is lost when
      // Option is released in another program.
      ctx.onFront((front) => {
        session.setFront(front);
        if (!front) session.setOption(false);
      });
      const capture = { capture: true, passive: true };
      const holdOption = (held) =>
        session.setOption(held && session.get().front && !textFocused && !modalOpen());
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
      ctx.onDispose(workspace.subscribe(syncArrange));
      ctx.onDispose(prefs.subscribe(syncArrange));
      ctx.onDispose(ring.subscribe(syncArrange));
      ctx.onDispose(windows.onLayout(syncArrange));
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
        const items = contexts.map((doc) => {
          let it = windowItems.get(doc.key);
          if (!it) {
            it = document.createElement('vf-menu-item');
            it.setAttribute('value', `window:${doc.key}`);
            it.checkable = true;
            windowItems.set(doc.key, it);
          }
          if (it.textContent !== doc.name) it.textContent = doc.name;
          it.checked = doc.key === activeKey;
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
      ctx.onDispose(workspace.subscribe(syncWindows));
      ctx.onDispose(() => {
        windowSep.remove();
        for (const it of windowItems.values()) it.remove();
        windowItems.clear();
      });
      syncWindows();

      // The Layer menu's list: one item per layer of the active document, after
      // the separator, in block order, named for the layer with the edited one
      // checked and its digit key shown. The count and names change on the doc's
      // structural channel, the edited layer on the workspace store.
      const itemLayerNew = item('layer-new');
      const itemLayerDelete = item('layer-delete');
      const itemLayerUp = item('layer-up');
      const itemLayerDown = item('layer-down');
      const layerAnchor = /** @type {Element} */ (menuLayer.lastElementChild);
      /** @type {HTMLElementTagNameMap['vf-menu-item'][]} by layer */
      const layerItems = [];
      const syncLayers = () => {
        const doc = workspace.active();
        const names = doc ? doc.doc.get().names : [];
        while (layerItems.length > names.length) layerItems.pop()?.remove();
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
          it.checked = i === doc?.layer;
        });
        itemLayerNew.disabled = !doc || names.length >= LAYER_MAX;
        itemLayerDelete.disabled = !doc || names.length <= 1;
        itemLayerUp.disabled = !doc || doc.layer <= 0;
        itemLayerDown.disabled = !doc || doc.layer >= names.length - 1;
      };
      ctx.onDispose(workspace.subscribe(syncLayers));
      ctx.onDispose(
        followActive(workspace, (doc) =>
          doc ? doc.doc.subscribe(syncLayers) : undefined
        )
      );
      ctx.onDispose(() => {
        for (const it of layerItems) it.remove();
        layerItems.length = 0;
      });
      syncLayers();

      // The Tools menu checks the session's current tool.
      const toolItems = ['select', 'pencil', 'rect', 'fill', 'eraser', 'eyedropper'].map(
        (t) => [t, item(`tool-${t}`)]
      );
      const syncTools = () => {
        for (const [t, it] of toolItems) it.checked = session.get().tool === t;
      };
      ctx.onDispose(session.subscribe(syncTools));
      syncTools();

      // The 3D Sprite Atlas checkmark follows its pref.
      const itemRing = item('ring');
      const syncView = () => {
        itemRing.checked = prefs.get().showRing;
      };
      ctx.onDispose(prefs.subscribe(syncView));
      syncView();

      return {
        /** Opens a stored document, or activates its window. The shell's boot
         *  and the kind's open come through here.
         *  @param {{item?: string|null, from?: import('vintage-frames').VfViewportBox|null,
         *           face?: string|null}} target */
        open: ({ item: id, from = null, face = null }) =>
          id != null ? openDoc(id, { from, face }) : undefined,
        /** Opens the New dialog. */
        newDocument,
        /** Brings an open document's window forward. @param {string} key */
        showDocument: (key) => editorWindows.showDocument(key),
        /** Before a restore replaces the catalog: the documents it won't bring
         *  back stay open, untitled and unsaved. */
        detach,
      };
    },
  });
}
