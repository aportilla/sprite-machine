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
import { PALETTE_168 } from './lib/constants.js';
import { session } from './state/session.js';
import { prefs } from './state/prefs.js';
import { shell } from './state/shell.js';
import { files } from './state/files.js';
import { workspace } from './state/workspace.js';
import { parseBootParams } from './boot/params.js';
import { createStage } from './scene/stage.js';
import { initRebuilder } from './scene/rebuilder.js';
import { loadSample, seedDefaultDocs } from './loaders.js';
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
import { initUrlState } from './shell/url-state.js';
import './components/sm-editor.js'; // registers <sm-editor>
import './components/sm-color-picker.js'; // registers <sm-color-picker>
import './components/sm-options-bar.js'; // registers <sm-options-bar>
import './components/sm-tools-panel.js'; // registers <sm-tools-panel>
import './components/sm-atlas-view.js'; // registers <sm-atlas-view>
import './components/sm-status-line.js'; // registers <sm-status-line>
import './components/sm-stage-controls.js'; // registers <sm-stage-controls>

// --- boot params → store seeds ---------------------------------------------
// Applied BEFORE any subscriber exists, so seeding can't fire phantom
// rebuilds — and the components mount with the seeded state already in place.
// The dev hooks' state halves are ordinary store actions; the canvas-paint
// halves ride into the BOOT context as `hooks` (consumed by the boot
// document's <sm-draw-canvas> on its first update). See boot/params.js.
const boot = parseBootParams(location.search, {
  sampleNames: SAMPLES.map((s) => s.name),
  hash: location.hash,
});
if (boot.lowpoly != null) prefs.setLowpoly(boot.lowpoly);
if (boot.rotate === false) prefs.setAutoRotate(false);
// The on-mount hook order, preserved: pencil size, then pick (so ?palette
// reflects it and ?fill fills with it), then the dialog, then rect, then fill.
// The size/radius seeds are clamped for real against the tile geometry when
// the editor first mounts (it re-clamps on any tile-geometry change).
if (boot.cursor != null) session.setPencilSize(boot.cursor, Number.MAX_SAFE_INTEGER);
if (boot.pick != null) session.pickColor(PALETTE_168[boot.pick].rgb);
if (boot.palette) session.openPicker();
if (boot.rect) {
  session.setTool('rect');
  if (boot.rect.r) session.setCornerRadius(boot.rect.r, Number.MAX_SAFE_INTEGER);
}
if (boot.fill) {
  session.setTool('fill');
  session.setFillContiguous(boot.fill.contiguous);
  session.setFillAllFaces(boot.fill.allFaces);
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
// monitor swap). Every re-fit re-pins the windows AND the desktop icons
// (windows.js / icons.js each keep their relative top/left across the size
// change, in their own frames) — live in the same handler, un-debounced:
// the raster itself re-fits per resize event, so a debounce would leave the
// windows hanging off a shrunk raster mid-drag and then jump. The kit's
// System 7 pointer set takes over the cursor.
const desktop = /** @type {import('vintage-frames').VfDesktop} */ (
  document.getElementById('desktop')
);
/** Bound to the windows' + icons' re-pins once the shell is wired (the boot
 *  fit below runs before any window or icon exists). */
let repinDesktop = (/** @type {{width: number, height: number}} */ _before) => {};
const fitDesktop = () => {
  const before = { width: desktop.width, height: desktop.height };
  desktop.fitWithin(
    document.documentElement.clientWidth,
    document.documentElement.clientHeight
  );
  repinDesktop(before);
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
// Wired only now — nothing between the boot fit and here can fire a resize
// (this top level runs synchronously to completion before any event task).
repinDesktop = (before) => {
  windows.onDesktopResized(before);
  icons.onDesktopResized(before);
};
const stopPersist = dstate.start({
  windows,
  iconsRoot: desktop.querySelector('#desktop-icons'),
});
// The address bar mirrors the active SAVED document (#<name>, replaceState),
// so a plain reload restores what's on screen; ?fresh leaves even the URL
// untouched (a capture boot writes nothing anywhere).
const stopUrlState = boot.fresh ? () => {} : initUrlState();

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
    stopUrlState();
    window.removeEventListener('resize', fitDesktop);
    window.removeEventListener('beforeunload', onBeforeUnload);
    offScale();
    removeCursor();
  });
}

// --- boot documents ----------------------------------------------------------
// The boot is URL-DRIVEN: ?file=<name> (or a bare #<name> fragment) opens
// that SAVED document; any other load greets with the New Document dialog.
// Three boots, in precedence order:
//   1. TEST (?fresh or an explicit ?sample): the named sample opens as an
//      untitled from in-memory data, storage untouched beyond a background
//      listing refresh — these paths must not wait on an IndexedDB
//      round-trip (which can stall the whole boot under the capture tool's
//      virtual-time budget), and must never seed. No dialog.
//   2. TRULY VIRGIN (storage works, no persisted desktop state AND an empty
//      library): seed the built-in defaults as ordinary stored documents
//      (loaders.js seedDefaultDocs — a one-shot; from then on they're normal
//      files the user may edit, rename or delete), then resolve like any
//      other boot — ?file can name a just-seeded default.
//   3. RESOLVE THE URL: a ?file naming a stored doc (case-insensitive; the
//      most recently modified wins a name collision) opens it — its window
//      landing on any remembered geometry + edited face. No param, an
//      unknown name, a failed load, or broken storage (a private window —
//      there's no library to name into, and everything the dialog creates
//      is an untitled window needing none) all fall back to the New
//      Document dialog. A prior session's open windows are deliberately NOT
//      reopened — the URL, not localStorage, says what a load shows (the
//      desktop layout itself still restores).
(async () => {
  // ?edit seeds the sample path's context face AT open — a post-open setFace
  // would race the one-shot mount hooks (the mount fill commits against
  // ctx.face, so a late switch files the old face's buffer under the new
  // face). The stored path carries no mount hooks, so setFace after is safe.
  const openBootSample = async () => {
    const ctx = await loadSample(SAMPLES[boot.sampleIndex], {
      face: boot.edit ?? undefined,
      hooks: bootHooks,
    });
    // Dev hooks that need the loaded sheet: ?tile / ?tile=WxH resizes the
    // fresh sheet once (the capture tool can't click the stepper); the
    // editor re-derives at the new size.
    if (ctx && boot.tile) ctx.doc.resizeTiles(boot.tile.w, boot.tile.h);
  };

  if (boot.fresh || boot.sampleExplicit) {
    if (!boot.fresh) files.refresh();
    await openBootSample();
    return;
  }

  await files.refresh();
  if (files.get().available && !dstate.saved && files.get().list.length === 0) {
    await seedDefaultDocs(SAMPLES);
  }

  if (boot.file && files.get().available) {
    const q = boot.file.toLowerCase();
    let match = null;
    for (const r of files.get().list) {
      if (r.name.toLowerCase() === q && (!match || r.modifiedAt > match.modifiedAt)) {
        match = r;
      }
    }
    if (match) {
      const res = await workspace.openStored(match.id).catch(() => null);
      if (res) {
        // ?edit beats the remembered face; either way the pick lands after
        // the open (the stored path has no mount hooks to race).
        const face =
          boot.edit ??
          dstate.saved?.docs?.find((d) => d.fileId === match.id)?.face ??
          null;
        if (face) workspace.setFace(res.ctx.key, face);
        return;
      }
    }
  }

  menus.actions.showNewDialog();
})();
