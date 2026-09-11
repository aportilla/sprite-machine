// ---------------------------------------------------------------------------
// The composition root — the only file that assembles the app, with no logic
// of its own: parse the boot params, seed the stores, fit the desktop raster
// and take over the cursor, wire the shell (windows / the menu bar and its
// three applications / icons / persistence), create the THREE stage + mesh
// rebuilder, and open the boot document(s). Everything else coordinates
// through the state slices (state/) — see README's Architecture section.
// ---------------------------------------------------------------------------

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
  tileToIconDataUri,
  genericDocIconDataUri,
} from './image-io.js';
import { initWindows } from './shell/windows.js';
import { initMenuBar } from './shell/menu-bar.js';
import { APPS, DEFAULT_APP } from './apps/index.js';
import { FINDER, SPRITE_EDITOR } from './state/shell.js';
import { initClock } from './shell/clock.js';
import { initDesktopPattern } from './shell/desktop-pattern.js';
import { createDesktopState } from './shell/desktop-state.js';
import { initUrlState } from './shell/url-state.js';
import './components/sm-editor.js'; // registers <sm-editor>
import './components/sm-color-picker.js'; // registers <sm-color-picker>
import './components/sm-desktop-patterns.js'; // registers <sm-desktop-patterns>
import './components/sm-options-bar.js'; // registers <sm-options-bar>
import './components/sm-tools-panel.js'; // registers <sm-tools-panel>
import './components/sm-atlas-view.js'; // registers <sm-atlas-view>
import './components/sm-atlas-controls.js'; // registers <sm-atlas-controls>
import './components/sm-ring-controls.js'; // registers <sm-ring-controls>
import './components/sm-ring-view.js'; // registers <sm-ring-view>
import './components/sm-status-line.js'; // registers <sm-status-line>
import './components/sm-stage-controls.js'; // registers <sm-stage-controls>

// --- boot params ------------------------------------------------------------
// The URL's boot request (?file / #fragment) and the dev hooks: ?sample,
// ?edit and ?fresh put a known document on screen from a clean profile, and
// ?flat / ?diag / ?cam are the mesh and camera debug flags. See
// boot/params.js.
const boot = parseBootParams(location.search, {
  sampleNames: SAMPLES.map((s) => s.name),
  hash: location.hash,
});

// --- the desktop raster + cursor -------------------------------------------
// The page owns the viewport: measure it, let fitWithin() derive the largest
// whole raster that fits, re-derive on resize and scale change (zoom, a
// monitor swap). Every re-fit re-pins the windows AND the desktop icons
// (the window manager's re-pin, the Finder's icon layer riding its raster
// signal — each keeping its nine-slice pin across the size change, in its
// own frame) — live in the same handler, un-debounced:
// the raster itself re-fits per resize event, so a debounce would leave the
// windows hanging off a shrunk raster mid-drag and then jump. The kit's
// System 7 pointer set takes over the cursor.
const desktop = /** @type {import('vintage-frames').VfDesktop} */ (
  document.getElementById('desktop')
);
/** Bound to the window manager's re-pin once the shell is wired (the boot
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
// with stubs); desktop state (icons, the folder windows' pins, edited faces
// — never an application window's geometry) rides localStorage, both
// disabled by ?fresh=1.
files.init({
  storage: createStorageIfAvailable(),
  encodeAtlas: imageDataToPngBytes,
  decodeAtlas: bytesToImageData,
  makeIcon: async (state) =>
    tileToIconDataUri(state.views.front) ?? genericDocIconDataUri(),
});
const dstate = createDesktopState(boot.fresh);

// --- shell ------------------------------------------------------------------
// The window manager (shell/windows.js). The applications' windows take no
// saved state — their geometry is placed fresh from the live raster at
// every boot and every open — but for the Finder's furniture: a folder
// window's remembered pin reaches the Finder through the menu bar's deps
// below (the desktop state's windowPin), as do the icons' positions.
const windows = initWindows(desktop);
// The desktop pattern: the last session's choice restored onto the desktop
// (nothing under ?fresh — the dither), written before the desktop's first
// render (shell/desktop-pattern.js — the desktop's wire; the control panel
// that sets it is Desktop Patterns', an application of its own).
const desktopPattern = initDesktopPattern(desktop, { saved: dstate.desktopPattern() });
// The 3D Sprite Atlas: the follower (scene/ring.js) that makes its offscreen
// renderer on the first render — wired here, ahead of the menus, because
// File → Export Sprite Atlas… renders through it; and the 3D model export's
// subject (scene/model-export.js), which File → Export 3D Model… turns into
// a glb. The rebuilder below hands both every mesh through the onMesh seam.
const ringFollow = initRing(createRingRenderer);
const modelExport = initModelExport();
// The menu bar: the Sprite Machine menu and the four applications
// (src/apps), each wiring its menus and its own windows — the Finder its
// folder windows and the icon layer over the desktop's field (restored
// from the desktop state's two readers), the Text Viewer its read-mes,
// Desktop Patterns its panel — swapped as the front application changes
// (shell/menu-bar.js).
const menuBar = initMenuBar(
  desktop,
  { apps: APPS, defaultApp: DEFAULT_APP },
  {
    windows,
    ring: ringFollow,
    model: modelExport,
    iconPos: dstate.iconPos,
    windowPin: dstate.windowPin,
  }
);
// The menu bar clock (shell/clock.js).
const clock = initClock(/** @type {HTMLElement} */ (document.getElementById('clock')));
// Wired only now — nothing between the boot fit and here can fire a resize
// (this top level runs synchronously to completion before any event task).
repinDesktop = (before) => windows.onDesktopResized(before);
// The Finder's furniture, read at every snapshot through its actions.
const finder = menuBar.apps[FINDER];
const stopPersist = dstate.start({
  readIcons: () => finder.positions(),
  readWindows: () => finder.pins(),
});
// The address bar mirrors the active SAVED document (#<name>, replaceState),
// so a plain reload restores what's on screen; ?fresh leaves even the URL
// untouched (a clean-slate boot writes nothing anywhere).
const stopUrlState = boot.fresh ? () => {} : initUrlState();

// --- scene ------------------------------------------------------------------
// The 3D View's canvas lives in the Sprite Editor's windoid, which its init
// appended above (apps/sprite-editor/windows.js) — so the stage is built
// after the menu bar.
const stage = createStage(
  /** @type {HTMLCanvasElement} */ (document.getElementById('viewport')),
  { cam: boot.cam }
);
const rebuilder = initRebuilder(stage, {
  flat: boot.flat,
  diag: boot.diag,
  // The seam's two consumers: the atlas's renderer and the model export.
  onMesh: (m) => {
    ringFollow.setSubject(m);
    modelExport.setSubject(m);
  },
});

const disposeDrop = initDropTarget({
  // A drop opens a new document window; surface + activate it (the Sprite
  // Editor's showDocument, read at the drop).
  onLoaded: (ctx) => menuBar.apps[SPRITE_EDITOR].showDocument(ctx.key),
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
    ringFollow.dispose();
    disposeShortcuts();
    disposeDrop();
    // The applications first — each releases and removes its own windows —
    // then the manager they were adopted into.
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

// --- boot documents ----------------------------------------------------------
// The boot is URL-DRIVEN: ?file=<name> (or a bare #<name> fragment) opens
// that SAVED document; any other load greets with the About box — the
// classic launch splash (the same dialog as Sprite Machine → About…): OK it
// — or click anywhere outside it — and the bare desktop is yours (File →
// New… ⌃N, or a document's icon).
// Three boots, in precedence order:
//   1. DEV (?fresh or an explicit ?sample): the named sample opens as an
//      untitled from in-memory data, storage untouched beyond a background
//      listing refresh — these paths must not wait on an IndexedDB
//      round-trip (which can stall the whole boot under capture.sh's
//      virtual-time budget), and must never seed. No dialog.
//   2. UNSEEDED (storage works and the desktop state carries no record of
//      the seeding — shell/desktop-state.js's `seeded` flag: a brand-new
//      profile, or one whose first boot was interrupted): seed the built-in
//      defaults as ordinary stored documents (loaders.js seedDefaultDocs,
//      skipping any already stored by name — an interrupted seeding
//      completes, nothing doubles), then RECORD it — written at once, after
//      the last save, never before: the record is the transaction's commit,
//      and a reload at any earlier moment leaves a profile that seeds again
//      next boot rather than one that never seeds (the old gate, "any
//      desktop-state blob exists", was written by the persist layer's own
//      schedule mid-boot and poisoned exactly that way). From then on they're
//      normal files the user may edit, rename or delete; then resolve like
//      any other boot — ?file can name a just-seeded default. The built-in
//      TEXT FILES (src/texts/ — the read-me documents) seed the same way on
//      their own record, `seededTexts`, so a profile from before them gets
//      them on its next boot, once.
//   3. RESOLVE THE URL: a ?file naming a stored doc (case-insensitive; the
//      most recently modified wins a name collision) opens it — on its
//      remembered edited face, its window placed fresh from the live raster
//      (window geometry is never restored). No param, an unknown name, a
//      failed load, or broken storage (a private window — there's no
//      library to name into; File → New… still makes untitled windows
//      needing none) all fall back to the About box. A prior session's
//      open windows are deliberately NOT reopened — the URL, not
//      localStorage, says what a load shows (the icons still restore).
async function bootDocuments() {
  if (boot.fresh || boot.sampleExplicit) {
    // The listing refresh runs in the background — the document must not
    // wait on it. ?edit seeds the sample's face at open.
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
    // The library, the Trash excluded: a trashed document is reached from
    // the Trash's window, never named from the address bar.
    for (const r of st.list) {
      if (isTrashed(st, r.folder)) continue;
      if (r.name.toLowerCase() === q && (!match || r.modifiedAt > match.modifiedAt)) {
        match = r;
      }
    }
    if (match) {
      const res = await workspace.openStored(match.id).catch(() => null);
      if (res) {
        // ?edit beats the remembered face.
        const face =
          boot.edit ??
          dstate.saved?.docs?.find((d) => d.fileId === match.id)?.face ??
          null;
        if (face) workspace.setFace(res.ctx.key, face);
        return;
      }
    }
  }

  menuBar.showAbout();
}

bootDocuments();
