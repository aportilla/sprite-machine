// Composition root: parses the boot params, seeds the stores, fits the desktop
// raster, wires the shell and the applications, builds the 3D stage and mesh
// rebuilder, lifts the startup curtain and opens the boot documents.

// Imported first: boot/curtain.js lifts the curtain on window load even if this
// module throws.
import { liftCurtain } from './boot/curtain.js';
import './style.css';
import 'vintage-frames';
import { applyCursor, onScaleChange } from 'vintage-frames';
import { SAMPLES } from './lib/sprite-data.js';
import { TEXTS } from './texts/index.js';
import { files, isTrashed } from './state/files.js';
import { workspace } from './state/workspace.js';
import { parseBootParams } from './boot/params.js';
import { createStage } from './scene/stage.js';
import { initRebuilder } from './scene/rebuilder.js';
import { createRingRenderer } from './scene/ring-renderer.js';
import { initRing } from './scene/ring.js';
import { initModelExport } from './scene/model-export.js';
import { loadSample, seedDefaultDocs, seedDefaultTexts } from './loaders.js';
import { initDropTarget } from './drop-target.js';
import { initShortcuts } from './shortcuts.js';
import { createStorageIfAvailable } from './storage/db.js';
import {
  imageDataToPngBytes,
  bytesToImageData,
  genericDocIconDataUri,
} from './image-io.js';
import { createIconRenderer } from './scene/icon-renderer.js';
import { initWindows } from './shell/windows.js';
import { initMenuBar } from './shell/menu-bar.js';
import { APPS, DEFAULT_APP } from './apps/index.js';
import { FINDER, SPRITE_EDITOR } from './state/shell.js';
import { initClock } from './shell/clock.js';
import { initDesktopPattern } from './shell/desktop-pattern.js';
import { createDesktopState } from './shell/desktop-state.js';
import { initUrlState } from './shell/url-state.js';
import './components/sm-editor.js';
import './components/sm-color-picker.js';
import './components/sm-desktop-patterns.js';
import './components/sm-options-bar.js';
import './components/sm-tools-panel.js';
import './components/sm-palette-view.js';
import './components/sm-atlas-view.js';
import './components/sm-atlas-controls.js';
import './components/sm-ring-controls.js';
import './components/sm-ring-view.js';
import './components/sm-status-line.js';
import './components/sm-stage-controls.js';

// Boot params. ?file or #name names the boot document. ?sample, ?edit and
// ?fresh are dev hooks. ?flat, ?diag and ?cam are debug flags. See
// boot/params.js.
const boot = parseBootParams(location.search, {
  sampleNames: SAMPLES.map((s) => s.name),
  hash: location.hash,
});

// Desktop raster and cursor. fitWithin() fits the largest whole raster to the
// viewport on resize and scale change, and each fit re-pins windows and icons.
// Not debounced, so windows track the raster during a resize.
const desktop = /** @type {import('vintage-frames').VfDesktop} */ (
  document.getElementById('desktop')
);
/** Set to the window manager's re-pin once the shell is wired. */
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

// Persistence. The files slice takes its browser dependencies here so it stays
// Node-testable. Desktop state (icon positions, folder window pins, edited
// faces and layers) lives in localStorage. ?fresh disables both. makeIcon runs
// at save and its result is cached on the record.
const docIcons = createIconRenderer();
files.init({
  storage: createStorageIfAvailable(),
  encodeAtlas: imageDataToPngBytes,
  decodeAtlas: bytesToImageData,
  makeIcon: async (state) =>
    docIcons.render(state.atlasImage, state.transforms, state.layers.length) ??
    genericDocIconDataUri(),
});
const dstate = createDesktopState(boot.fresh);

// Shell.
const windows = initWindows(desktop);
// Restores the saved pattern before the desktop's first render.
const desktopPattern = initDesktopPattern(desktop, { saved: dstate.desktopPattern() });
// Created before the menu bar, whose export commands use them.
const ringFollow = initRing(createRingRenderer);
const modelExport = initModelExport();
// The menu bar and the applications (src/apps).
const menuBar = initMenuBar(
  desktop,
  { apps: APPS, defaultApp: DEFAULT_APP },
  {
    windows,
    ring: ringFollow,
    model: modelExport,
    iconPos: dstate.iconPos,
    windowPin: dstate.windowPin,
    greet: dstate.greet,
    setGreet: dstate.setGreet,
  }
);
const clock = initClock(/** @type {HTMLElement} */ (document.getElementById('clock')));
// Safe to bind here: no resize event can fire before this synchronous top level
// finishes.
repinDesktop = (before) => windows.onDesktopResized(before);
const finder = menuBar.apps[FINDER];
const stopPersist = dstate.start({
  readIcons: () => finder.positions(),
  readWindows: () => finder.pins(),
  onMoved: (fn) => finder.onMoved(fn),
});
// The address bar mirrors the active saved document (#<name>), so a reload
// restores it. ?fresh leaves the URL untouched.
const stopUrlState = boot.fresh ? () => {} : initUrlState();

// Scene. Built after the menu bar: the Sprite Editor's init appends the windoid
// that holds #viewport.
const stage = createStage(
  /** @type {HTMLCanvasElement} */ (document.getElementById('viewport')),
  { cam: boot.cam }
);
const rebuilder = initRebuilder(stage, {
  flat: boot.flat,
  diag: boot.diag,
  onMesh: (m) => {
    ringFollow.setSubject(m);
    modelExport.setSubject(m);
  },
});

const disposeDrop = initDropTarget({
  onLoaded: (ctx) => menuBar.apps[SPRITE_EDITOR].showDocument(ctx.key),
});
// Tool keys. Menu key equivalents are declared on the menu items.
const disposeShortcuts = initShortcuts();

// Warn on leaving with any unsaved document.
const onBeforeUnload = (e) => {
  if (workspace.anyDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
};
window.addEventListener('beforeunload', onBeforeUnload);

// The desktop is composed, so lift the startup curtain. The boot documents
// below wait on IndexedDB and are not awaited.
liftCurtain();

// HMR teardown. Vite re-runs this module without unloading the old instance, so
// everything wired above is disposed. The store singletons persist.
const hot = /** @type {any} */ (import.meta).hot;
if (hot) {
  hot.dispose(() => {
    stage.dispose();
    rebuilder.dispose();
    ringFollow.dispose();
    docIcons.dispose();
    disposeShortcuts();
    disposeDrop();
    // Applications before the window manager: each removes its own windows.
    menuBar.dispose();
    windows.dispose();
    clock.dispose();
    desktopPattern.dispose();
    stopPersist();
    stopUrlState();
    window.removeEventListener('resize', fitDesktop);
    window.removeEventListener('beforeunload', onBeforeUnload);
    offScale();
    removeCursor();
  });
}

// Boot documents, in order of precedence:
//   1. Dev (?fresh or ?sample): open the sample as an untitled document from
//      memory. No seeding.
//   2. Unseeded profile: store the built-in documents and text files, skipping
//      names already stored, then set the seeded flag. The flag is written
//      after the last save, so an interrupted seeding runs again next boot.
//   3. ?file names a stored document: open it on its remembered face and
//      layer. Otherwise show the About box, unless Show at startup is off.
async function bootDocuments() {
  if (boot.fresh || boot.sampleExplicit) {
    // Not awaited: the dev boot must not wait on IndexedDB, which can stall
    // capture.sh's virtual-time budget.
    if (!boot.fresh) files.refresh().catch(() => {});
    await loadSample(SAMPLES[boot.sampleIndex], { face: boot.edit ?? undefined });
    return;
  }

  await files.refresh();
  if (files.get().available && !dstate.seeded()) {
    await seedDefaultDocs(SAMPLES, new Set(files.get().list.map((r) => r.name)));
    dstate.markSeeded();
  }
  if (files.get().available && !dstate.seededTexts()) {
    await seedDefaultTexts(TEXTS, new Set(files.get().texts.map((t) => t.name)));
    dstate.markSeededTexts();
  }

  if (boot.file && files.get().available) {
    const q = boot.file.toLowerCase();
    const st = files.get();
    let match = null;
    // Case-insensitive; the most recently modified match wins. Trashed
    // documents are skipped.
    for (const r of st.list) {
      if (isTrashed(st, r.folder)) continue;
      if (r.name.toLowerCase() === q && (!match || r.modifiedAt > match.modifiedAt)) {
        match = r;
      }
    }
    if (match) {
      const res = await workspace.openStored(match.id).catch(() => null);
      if (res) {
        const remembered = dstate.saved?.docs?.find((d) => d.fileId === match.id);
        // ?edit overrides the remembered face.
        const face = boot.edit ?? remembered?.face ?? null;
        if (face) workspace.setFace(res.ctx.key, face);
        if (Number.isInteger(remembered?.layer)) {
          workspace.setLayer(res.ctx.key, remembered.layer);
        }
        return;
      }
    }
  }

  if (dstate.greet()) menuBar.showAbout();
}

bootDocuments();
