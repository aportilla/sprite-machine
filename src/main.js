// ---------------------------------------------------------------------------
// The composition root — the only file that assembles the app, with no logic
// of its own: parse the boot params, seed the stores, create the THREE stage +
// mesh rebuilder, mount the (connected) chrome and editor components, wire the
// global shortcuts and drop target, and load the boot sample. Everything else
// coordinates through the state slices (state/) — see COMPONENT-DEVELOPMENT-
// PLAN.md for the architecture.
// ---------------------------------------------------------------------------

import './style.css';
import { SAMPLES } from './lib/sprite-data.js';
import { TILE_MIN, TILE_MAX } from './lib/atlas.js';
import { PENCIL_PALETTE, PALETTE_256 } from './lib/constants.js';
import { doc } from './state/doc.js';
import { session } from './state/session.js';
import { prefs } from './state/prefs.js';
import { parseBootParams } from './boot/params.js';
import { createStage } from './scene/stage.js';
import { initRebuilder } from './scene/rebuilder.js';
import { loadSample } from './loaders.js';
import { initDropTarget } from './drop-target.js';
import { initShortcuts } from './shortcuts.js';
import './components/sm-editor.js'; // registers <sm-editor>
import './components/sm-topbar.js'; // registers <sm-topbar>
import './components/sm-stage-controls.js'; // registers <sm-stage-controls>
import './components/sm-stats-readout.js'; // registers <sm-stats-readout>

// --- boot params → store seeds ---------------------------------------------
// Applied BEFORE any subscriber exists, so seeding can't fire phantom
// rebuilds — and the editor mounts with the seeded state already in place.
// The dev hooks' state halves are ordinary store actions; only the
// canvas-paint halves ride as one-shot props on the editor (consumed by
// <sm-draw-canvas> on its first update). See boot/params.js.
const boot = parseBootParams(location.search, {
  sampleNames: SAMPLES.map((s) => s.name),
});
if (boot.lowpoly != null) prefs.setLowpoly(boot.lowpoly);
if (boot.rotate === false) prefs.setAutoRotate(false);
if (boot.edit) session.selectFace(boot.edit);
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

// --- scene ------------------------------------------------------------------
const stage = createStage(
  /** @type {HTMLCanvasElement} */ (document.getElementById('viewport')),
  { cam: boot.cam }
);
const rebuilder = initRebuilder(stage, { flat: boot.flat, diag: boot.diag });

// --- chrome + editor --------------------------------------------------------
// The components are CONNECTED (each reads its slices itself); this root just
// places them. The editor gets its session constants and the one-shot canvas
// dev hooks; ONE element, docked forever.
document.getElementById('topbar').replaceChildren(document.createElement('sm-topbar'));
document
  .getElementById('stage')
  .append(
    document.createElement('sm-stage-controls'),
    document.createElement('sm-stats-readout')
  );
const editor = /** @type {any} */ (document.createElement('sm-editor'));
Object.assign(editor, {
  palette: PENCIL_PALETTE,
  palette256: PALETTE_256,
  faces: ['left', 'right', 'front', 'back', 'top', 'bottom'], // mirror pairs
  sizeMin: TILE_MIN,
  sizeMax: TILE_MAX,
  previewCursor: boot.cursor != null,
  previewRect: boot.rect,
  fillOnMount: boot.fill,
});
document.getElementById('editor-panel').replaceChildren(editor);

initDropTarget();
// The global tool shortcuts (B/R/G/I/E → session actions); the gesture-scoped
// keys (Esc / Shift on an in-flight rect) live inside <sm-draw-canvas>.
const disposeShortcuts = initShortcuts();

// --- HMR teardown -----------------------------------------------------------
// Vite re-executes this module's top level on edit without unloading the old
// instance; the stage loop/listeners, the rebuilder's subscriptions, and the
// shortcut handler would each accumulate a duplicate without this. (The store
// singletons persist — only this execution's listeners are dropped.)
const hot = /** @type {any} */ (import.meta).hot;
if (hot) {
  hot.dispose(() => {
    stage.dispose();
    rebuilder.dispose();
    disposeShortcuts();
  });
}

// --- boot -------------------------------------------------------------------
// Load the boot sample (?sample=<index|name> overrides, handy for testing).
loadSample(SAMPLES[boot.sampleIndex]).then(() => {
  // Dev hook: ?tile / ?tile=WxH resizes the fresh sheet once (the capture tool
  // can't click the stepper); the editor re-derives at the new size.
  if (boot.tile) doc.resizeTiles(boot.tile.w, boot.tile.h);
});
