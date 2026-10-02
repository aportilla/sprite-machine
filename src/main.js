// Composition root: the shell (vintage-frames/shell) over the page's desktop,
// with Sprite Machine's four applications, the 3D stage and mesh rebuilder,
// the About box, the startup curtain, and the boot documents.
//
// The shell fits the desktop to the viewport, keeps the catalog in IndexedDB
// and the session in localStorage, and reopens the last session's windows.
// ?fresh=1 and ?sample boot a known desktop that reads and writes no session;
// ?fresh=1 also keeps no files. See boot/params.js.

// Imported first: boot/curtain.js lifts the curtain on window load even if this
// module throws.
import { liftCurtain } from './boot/curtain.js';
import './style.css';
import 'vintage-frames';
import { applyCursor, VfWindow } from 'vintage-frames';
import {
  createShell,
  indexedDbStorage,
  isTrashed,
  localStorageState,
} from 'vintage-frames/shell';
import { SAMPLES } from './lib/sprite-data.js';
import { SPRITE } from './state/kinds.js';
import { convertSession } from './state/legacy.js';
import { workspace } from './state/workspace.js';
import { parseBootParams } from './boot/params.js';
import { createStage } from './scene/stage.js';
import { initRebuilder } from './scene/rebuilder.js';
import { createRingRenderer } from './scene/ring-renderer.js';
import { initRing } from './scene/ring.js';
import { initModelExport } from './scene/model-export.js';
import { createIconRenderer } from './scene/icon-renderer.js';
import { createSheetStore } from './storage/db.js';
import { loadSample } from './loaders.js';
import { initDropOverlay } from './drop-target.js';
import { initShortcuts } from './shortcuts.js';
import { GREET, initAbout } from './about.js';
import { finder } from './apps/finder/index.js';
import { spriteEditor, SPRITE_EDITOR } from './apps/sprite-editor/index.js';
import { textViewer } from './apps/text-viewer/index.js';
import { desktopPatterns } from './apps/desktop-patterns/index.js';
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

const boot = parseBootParams(location.search, {
  sampleNames: SAMPLES.map((s) => s.name),
});
const devBoot = boot.fresh || boot.sampleExplicit;
// The session is the saved state, not the address. A #name left by an older
// version would otherwise sit in the bar meaning nothing.
if (location.hash) history.replaceState(null, '', location.pathname + location.search);

const desktop = /** @type {import('vintage-frames').VfDesktop} */ (
  document.getElementById('desktop')
);
const removeCursor = applyCursor();
// index.html turns off zoom with touch-action. As a backup, this cancels
// gesturestart, the pinch event only WebKit sends, in case Safari lets a pinch
// through anyway.
const onGestureStart = (/** @type {Event} */ e) => e.preventDefault();
document.addEventListener('gesturestart', onGestureStart);

// The session: the shell's, converted once from the desktop state this app
// kept before the shell.
const SESSION_KEY = 'sprite-machine:session';
if (!devBoot) convertSession(localStorage, SESSION_KEY);
const state = localStorageState(SESSION_KEY, {
  extra: { [GREET]: true, showRing: false, docs: {} },
  fresh: devBoot,
});

// Made before the shell: the Sprite Editor's exports use the ring renderer and
// the model exporter, and its documents' icons are the icon renderer's.
const ringFollow = initRing(createRingRenderer);
const modelExport = initModelExport();
const docIcons = createIconRenderer();
const sheetStore = createSheetStore();

const shell = createShell(desktop, {
  apps: [
    finder({
      storage: boot.fresh ? null : indexedDbStorage('sprite-machine-catalog'),
      readLibrary: () => sheetStore.readLibrary(),
    }),
    spriteEditor({ sheetStore, icons: docIcons }),
    textViewer(),
    desktopPatterns(),
  ],
  fit: 'viewport',
  state,
  services: { ring: ringFollow, model: modelExport },
});
const about = initAbout(desktop, state);

// Scene. Built after the shell: the Sprite Editor's init appends the windoid
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

const disposeDrop = initDropOverlay();
// Tool keys. Menu key equivalents are declared on the menu items.
const disposeShortcuts = initShortcuts();

// Warn on leaving with any unsaved document.
const onBeforeUnload = (/** @type {BeforeUnloadEvent} */ e) => {
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
    about.dispose();
    shell.dispose();
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('gesturestart', onGestureStart);
    removeCursor();
  });
}

// Boot documents, in order of precedence:
//   1. Dev (?fresh or ?sample): open the sample as an untitled document at
//      once. The dev boot must not wait on IndexedDB, which can stall
//      capture.sh's virtual-time budget.
//   2. Once the shell has reopened the session, ?file names a stored document:
//      open it in front, on ?edit's face or its remembered one. The most
//      recently modified match wins, case-insensitive, and the Trash is
//      skipped.
//   3. With no window open, the About box, unless Show at startup is off.
if (devBoot) {
  loadSample(SAMPLES[boot.sampleIndex], { face: boot.edit ?? undefined }).catch((err) =>
    console.warn('sprite-machine:', err.message)
  );
} else {
  void shell.ready.then(async () => {
    const catalog = shell.catalog;
    if (boot.file && catalog) {
      const q = boot.file.toLowerCase();
      const st = catalog.get();
      const match = st.items
        .filter(
          (i) =>
            i.kind === SPRITE && i.name.toLowerCase() === q && !isTrashed(st, i.parent)
        )
        .sort((a, b) => b.modifiedAt - a.modifiedAt)[0];
      if (match) {
        await shell.apps[SPRITE_EDITOR]?.open({ item: match.id, face: boot.edit });
        return;
      }
    }
    const opened = desktop.stackingOrder.some((w) => w instanceof VfWindow && !w.hidden);
    if (!opened && about.greets()) about.show();
  });
}
