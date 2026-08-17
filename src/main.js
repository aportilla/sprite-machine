// ---------------------------------------------------------------------------
// The composition root — the only file that assembles the app, with no logic
// of its own: parse the boot params, seed the stores, fit the desktop raster
// and take over the cursor, wire the shell (windows / menus / icons /
// persistence), create the THREE stage + mesh rebuilder, and open the boot
// document(s). Everything else coordinates through the state slices
// (state/) — see README's Architecture section.
// ---------------------------------------------------------------------------

import './style.css';
import 'vintage-frames';
import { applyCursor, onScaleChange } from 'vintage-frames';
import { SAMPLES } from './lib/sprite-data.js';
import { PALETTE_256 } from './lib/constants.js';
import { session } from './state/session.js';
import { prefs } from './state/prefs.js';
import { shell } from './state/shell.js';
import { files } from './state/files.js';
import { workspace } from './state/workspace.js';
import { parseBootParams } from './boot/params.js';
import { createStage } from './scene/stage.js';
import { initRebuilder } from './scene/rebuilder.js';
import { loadSample } from './loaders.js';
import { initDropTarget } from './drop-target.js';
import { initShortcuts } from './shortcuts.js';
import { createStorageIfAvailable } from './storage/db.js';
import {
  imageDataToPngBytes,
  bytesToImageData,
  tileToIconDataUri,
  genericDocIconDataUri,
} from './image-io.js';
import { initWindows } from './shell/windows.js';
import { initMenus } from './shell/menus.js';
import { initIcons } from './shell/icons.js';
import { createDesktopState } from './shell/desktop-state.js';
import './components/sm-editor.js'; // registers <sm-editor>
import './components/sm-color-picker.js'; // registers <sm-color-picker>
import './components/sm-options-bar.js'; // registers <sm-options-bar>
import './components/sm-tools-panel.js'; // registers <sm-tools-panel>
import './components/sm-atlas-view.js'; // registers <sm-atlas-view>
import './components/sm-status-line.js'; // registers <sm-status-line>

// --- boot params → store seeds ---------------------------------------------
// Applied BEFORE any subscriber exists, so seeding can't fire phantom
// rebuilds — and the components mount with the seeded state already in place.
// The dev hooks' state halves are ordinary store actions; the canvas-paint
// halves ride into the BOOT context as `hooks` (consumed by the boot
// document's <sm-draw-canvas> on its first update). See boot/params.js.
const boot = parseBootParams(location.search, {
  sampleNames: SAMPLES.map((s) => s.name),
});
if (boot.lowpoly != null) prefs.setLowpoly(boot.lowpoly);
if (boot.rotate === false) prefs.setAutoRotate(false);
// The on-mount hook order, preserved: pencil size, then pick (so ?palette
// reflects it and ?fill fills with it), then the dialog, then rect, then fill.
// The size/radius seeds are clamped for real against the tile geometry when
// the editor first mounts (it re-clamps on any tile-geometry change).
if (boot.cursor != null) session.setPencilSize(boot.cursor, Number.MAX_SAFE_INTEGER);
if (boot.pick != null) session.pickColor(PALETTE_256[boot.pick].rgb);
if (boot.palette) session.openPicker();
if (boot.rect) {
  session.setTool('rect');
  if (boot.rect.r) session.setCornerRadius(boot.rect.r, Number.MAX_SAFE_INTEGER);
}
if (boot.fill) {
  session.setTool('fill');
  session.setFillReplace(boot.fill.replace);
  session.setFillAllTiles(boot.fill.all);
}
// The boot context's one-shot canvas hooks (?cursor / ?rect / ?fill paint
// halves) — created here, carried on the context so no assignment can race
// the editor's first update.
const bootHooks =
  boot.cursor != null || boot.rect || boot.fill
    ? {
        previewCursor: boot.cursor != null,
        previewRect: boot.rect,
        fillOnMount: boot.fill,
      }
    : null;

// --- the desktop raster + cursor -------------------------------------------
// The page owns the viewport: measure it, let fitWithin() derive the largest
// whole raster that fits, re-derive on resize and scale change (zoom, a
// monitor swap). The kit's System 7 pointer set takes over the cursor.
const desktop = /** @type {import('vintage-frames').VfDesktop} */ (
  document.getElementById('desktop')
);
const fitDesktop = () => {
  desktop.fitWithin(
    document.documentElement.clientWidth,
    document.documentElement.clientHeight
  );
};
fitDesktop();
window.addEventListener('resize', fitDesktop);
const offScale = onScaleChange(fitDesktop);
const removeCursor = applyCursor();

// --- persistence wiring ------------------------------------------------------
// The files slice gets its browser dependencies here (it stays Node-testable
// with stubs); desktop layout rides localStorage, both disabled by ?fresh=1.
files.init({
  storage: createStorageIfAvailable(),
  encodeAtlas: imageDataToPngBytes,
  decodeAtlas: bytesToImageData,
  makeIcon: async (state) =>
    tileToIconDataUri(state.views.front) ?? genericDocIconDataUri(),
});
const dstate = createDesktopState(boot.fresh);
if (dstate.saved?.showGrid) shell.setShowGrid(true);

// --- shell ------------------------------------------------------------------
const windows = initWindows(desktop, { saved: dstate.saved, hide: boot.hide });
const menus = initMenus(desktop, windows);
const icons = initIcons(desktop, {
  actions: menus.actions,
  savedPos: dstate.iconPos,
  fresh: boot.fresh,
});
const stopPersist = dstate.start({
  windows,
  iconsRoot: desktop.querySelector('#desktop-icons'),
});

// --- scene ------------------------------------------------------------------
const stage = createStage(
  /** @type {HTMLCanvasElement} */ (document.getElementById('viewport')),
  { cam: boot.cam }
);
const rebuilder = initRebuilder(stage, { flat: boot.flat, diag: boot.diag });

const disposeDrop = initDropTarget({
  // A drop opens a new document window; surface + activate it.
  onLoaded: (ctx) => windows.activateContext(ctx.key),
});
// The global tool shortcuts (B/R/G/I/E → session actions); the menu key
// equivalents (⌘S, ⌘Z, …) are the kit's own, declared on the menu items.
const disposeShortcuts = initShortcuts();

// The safety net under explicit Save: leaving with ANY unsaved document warns.
const onBeforeUnload = (e) => {
  if (workspace.anyDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
};
window.addEventListener('beforeunload', onBeforeUnload);

// --- HMR teardown -----------------------------------------------------------
// Vite re-executes this module's top level on edit without unloading the old
// instance; everything wired above would accumulate a duplicate without this.
// (The store singletons persist — the workspace's contexts survive and the
// next run's window reconciler rebuilds their windows; only this execution's
// listeners are dropped.)
const hot = /** @type {any} */ (import.meta).hot;
if (hot) {
  hot.dispose(() => {
    stage.dispose();
    rebuilder.dispose();
    disposeShortcuts();
    disposeDrop();
    windows.dispose();
    menus.dispose();
    icons.dispose();
    stopPersist();
    window.removeEventListener('resize', fitDesktop);
    window.removeEventListener('beforeunload', onBeforeUnload);
    offScale();
    removeCursor();
  });
}

// --- boot documents ----------------------------------------------------------
// An explicit ?sample beats everything (the deterministic test path); else
// the previous session's open SAVED documents restore (their windows'
// geometry lands via the reconciler, the active one opened last so the kit
// activates it); else the default sample as an untitled. Only the restore
// path BLOCKS on storage — the sample path must not wait on an IndexedDB
// round-trip (which can stall the whole boot under the capture tool's
// virtual-time budget), so its listing refresh runs in the background.
(async () => {
  const savedDocs = dstate.saved?.docs ?? [];
  const wantRestore = !boot.fresh && !boot.sampleExplicit && savedDocs.length > 0;
  if (wantRestore) {
    await files.refresh();
    if (files.get().available) {
      // The active document opens LAST — the kit activates each newcomer,
      // so the final open ends up holding the active state.
      const ordered = [...savedDocs].sort(
        (a, b) =>
          (a.fileId === dstate.saved.activeFileId ? 1 : 0) -
          (b.fileId === dstate.saved.activeFileId ? 1 : 0)
      );
      let opened = 0;
      for (const entry of ordered) {
        try {
          const res = await workspace.openStored(entry.fileId);
          if (res && entry.face) workspace.setFace(res.ctx.key, entry.face);
          if (res) opened++;
        } catch {
          // A vanished or unreadable doc costs only its window.
        }
      }
      if (opened > 0) return;
    }
  } else {
    files.refresh();
  }
  const ctx = await loadSample(SAMPLES[boot.sampleIndex], { hooks: bootHooks });
  if (ctx) {
    // Dev hooks that need the loaded sheet: ?edit picks the starting face,
    // ?tile / ?tile=WxH resizes the fresh sheet once (the capture tool can't
    // click the stepper); the editor re-derives at the new size.
    if (boot.edit) workspace.setFace(ctx.key, boot.edit);
    if (boot.tile) ctx.doc.resizeTiles(boot.tile.w, boot.tile.h);
  }
})();
