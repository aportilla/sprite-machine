// ---------------------------------------------------------------------------
// Window plumbing for the desktop shell: shell-slice visibility ↔ the four
// vf-windows' `hidden` attributes, close-box routing, the document window's
// live title, and the boot-time clamp that keeps authored default positions
// on a small raster grabbable. Behavior only — every aesthetic is the kit's.
//
// Visibility has ONE truth: the shell slice. A close box never hides its
// window directly — it routes through a shell action (or, for the document
// window, through the injected dirty-checking close flow) and the store
// subscription writes `hidden`. That's what keeps the View menu's checkmarks,
// the icon ghost, and the windows themselves agreeing forever.
// ---------------------------------------------------------------------------

import { snapSys, systemPxQuantum, VfWindow } from 'vintage-frames';
import { shell, WINDOW_IDS } from '../state/shell.js';
import { files } from '../state/files.js';

// The raster band reserved above windows: the 20px menu bar plus the 28px
// options strip — a window clamped below it always keeps its title bar
// grabbable.
const TOP_RESERVE = 48;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * Clamp a window's authored/restored position onto the live raster, on the
 * same k-system-px lattice a drag lands on (system7web's centerWindow rule,
 * minus the centering — authored positions are kept, just pulled on-canvas).
 */
export function clampWindow(desktop, win) {
  const k = systemPxQuantum(win);
  const down = (v) => Math.floor(v / k) * k;
  const up = (v) => Math.ceil(v / k) * k;
  const w = win.width ?? 0;
  const h = win.height ?? 0;
  const minTop = up(TOP_RESERVE);
  win.left = clamp(snapSys(win.left ?? 0, win), 0, Math.max(0, down(desktop.width - w)));
  win.top = clamp(
    snapSys(win.top ?? minTop, win),
    minTop,
    Math.max(minTop, down(desktop.height - h))
  );
}

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {{saved?: object|null, hide?: string[]}} [opts]
 *   saved: the restored desktop state (window geometry applied before the
 *   clamp); hide: shell window ids to hide at boot (?hide= dev hook).
 */
export function initWindows(desktop, { saved = null, hide = [] } = {}) {
  /** @type {Record<string, VfWindow>} shell id -> element */
  const byId = {};
  for (const id of WINDOW_IDS) {
    byId[id] = /** @type {VfWindow} */ (desktop.querySelector(`#win-${id}`));
  }

  // --- boot restore + clamp --------------------------------------------------
  for (const id of WINDOW_IDS) {
    const win = byId[id];
    const s = saved?.windows?.[id];
    if (s) {
      if (Number.isFinite(s.left)) win.left = s.left;
      if (Number.isFinite(s.top)) win.top = s.top;
      if (Number.isFinite(s.width) && win.resizable) win.width = s.width;
      if (Number.isFinite(s.height) && win.resizable) win.height = s.height;
      shell.setWindowVisible(id, !s.hidden);
    }
    clampWindow(desktop, win);
  }
  for (const id of hide) shell.setWindowVisible(id, false);

  // --- visibility: store -> hidden -------------------------------------------
  const sync = () => {
    const visible = shell.get().windows;
    for (const id of WINDOW_IDS) byId[id].hidden = !visible[id];
  };
  const unsubs = [shell.subscribe(sync)];
  sync();

  // The document window's title is the document's name.
  const syncTitle = () => {
    byId.document.heading = files.get().currentName;
  };
  unsubs.push(files.subscribe(syncTitle));
  syncTitle();

  // --- close boxes ------------------------------------------------------------
  // A window's close box fires vf-close on the window itself (dialog closes
  // have a non-window target and pass through). The document window routes
  // through the dirty-checking flow menus.js injects; the rest are plain
  // visibility toggles.
  const api = {
    byId,
    /** Injected by menus.js: the dirty-checking File → Close flow. */
    onDocumentClose: null,
    /** Un-hide the document window and make it the active one. */
    showDocument() {
      shell.setWindowVisible('document', true);
      desktop.bringToFront(byId.document);
    },
    dispose() {
      for (const u of unsubs) u();
      desktop.removeEventListener('vf-close', onClose);
    },
  };

  const onClose = (e) => {
    const t = e.target;
    if (!(t instanceof VfWindow)) return;
    const id = WINDOW_IDS.find((k) => byId[k] === t);
    if (!id) return;
    if (id === 'document' && api.onDocumentClose) api.onDocumentClose();
    else shell.setWindowVisible(id, false);
  };
  desktop.addEventListener('vf-close', onClose);

  return api;
}
