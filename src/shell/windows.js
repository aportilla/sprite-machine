// ---------------------------------------------------------------------------
// Window plumbing for the desktop shell — two kinds of window, two regimes:
//
//   UTILITY WINDOIDS (Tools palette, Full Sprite View, 3D View): static
//   markup in index.html, visibility = shell-slice wanted flag && appActive
//   (a desktop click hides the palettes without forgetting which were up).
//   They hide, never unmount — canvas identity survives.
//
//   DOCUMENT WINDOWS: one per open document, reconciled from the workspace
//   slice (the syncDocIcons pattern lifted to windows): a context appearing
//   clones the #tpl-document-window template — its <sm-editor> and tile
//   status line take the context BEFORE the append — staggers/restores its
//   position, and appends it as a DIRECT CHILD of the desktop (the stacking
//   manager only sees direct vf-window children; appending is also what
//   makes the kit activate it — opening a window brings the application
//   forward). A context closing removes its window outright: a document
//   window's visibility IS its existence.
//
// APP ACTIVATION has one writer: the desktop's vf-activate event (the kit
// fires it on every change of active document-tier window, null included)
// lands here and is mirrored into BOTH truths — shell.appActive (the
// boolean the chrome gates on) and workspace.activeKey (which document).
// Deactivation is interaction-only, and the PAGE owns the press test (the
// kit's 0.4.0 position: only the page knows which presses mean "the
// Finder"): a press on the desktop's bare dither — wired here — or in the
// icon layer (shell/icons.js) routes through desktop.clearActive(); the
// kit adds its own null when the last document window leaves. Boot always
// comes up active and ?hide=document captures keep their utility windows.
//
// Close boxes never hide windows directly: a windoid close routes through
// the shell slice, a document close through the injected dirty-checking
// flow (menus.js), and the store subscriptions do the writing.
// ---------------------------------------------------------------------------

import { snapSys, systemPxQuantum, VfWindow } from 'vintage-frames';
import { shell, WINDOW_IDS } from '../state/shell.js';
import { workspace } from '../state/workspace.js';

// The raster band reserved above windows: the 20px menu bar plus the 28px
// options strip — a window clamped below it always keeps its title bar
// grabbable.
const TOP_RESERVE = 48;

// A new document window's authored default box, staggered System 7 style:
// each additional open document offsets down-right by one step.
const DOC_DEFAULT = { left: 110, top: 64, width: 430, height: 560 };
const STAGGER = 24;

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
 *   saved: the restored desktop state (utility geometry applied before the
 *   clamp; per-fileId document geometry applied as those docs open); hide:
 *   window ids to hide at boot (?hide= dev hook — 'document' hides the
 *   document windows, which stay ACTIVE, so the utility windows survive for
 *   captures that need them alone).
 */
export function initWindows(desktop, { saved = null, hide = [] } = {}) {
  /** @type {(() => void)[]} */
  const unsubs = [];

  // --- utility windoids: boot restore + clamp ---------------------------------
  /** @type {Record<string, VfWindow>} shell id -> element */
  const byId = {};
  for (const id of WINDOW_IDS) {
    byId[id] = /** @type {VfWindow} */ (desktop.querySelector(`#win-${id}`));
    const s = saved?.utility?.[id];
    if (s) {
      if (Number.isFinite(s.left)) byId[id].left = s.left;
      if (Number.isFinite(s.top)) byId[id].top = s.top;
      if (Number.isFinite(s.width) && byId[id].resizable) byId[id].width = s.width;
      if (Number.isFinite(s.height) && byId[id].resizable) byId[id].height = s.height;
      shell.setWindowVisible(id, !s.hidden);
    }
    clampWindow(desktop, byId[id]);
  }
  for (const id of hide) if (id !== 'document') shell.setWindowVisible(id, false);
  const hideDocs = hide.includes('document');

  // --- utility visibility: store -> hidden -------------------------------------
  // A windoid belongs to the application, so it is on screen only while the
  // app is active — the wanted flag survives a deactivation untouched.
  const syncUtility = () => {
    const { windows: wanted, appActive } = shell.get();
    for (const id of WINDOW_IDS) byId[id].hidden = !(wanted[id] && appActive);
  };
  unsubs.push(shell.subscribe(syncUtility));
  syncUtility();

  // --- document windows: the reconciler ----------------------------------------
  const tpl = /** @type {HTMLTemplateElement} */ (
    document.getElementById('tpl-document-window')
  );
  /** @type {Map<string, {win: VfWindow, editor: HTMLElement}>} ctx key -> parts */
  const byKey = new Map();
  /** Saved per-document geometry from a previous session, by fileId. */
  const savedDocGeom = new Map(
    (saved?.docs ?? []).filter((d) => d && d.fileId).map((d) => [d.fileId, d])
  );
  let staggerSlot = 0; // counts creations, so reopening cascades on

  function createDocWindow(ctx) {
    // importNode, NOT cloneNode: template content lives in an inert
    // ownerDocument, and a bare clone stays there — where
    // customElements.upgrade() silently no-ops (wrong document), leaving the
    // editor un-upgraded until append and the ctx assignment a dead own
    // property at connectedCallback time.
    const win = /** @type {VfWindow} */ (
      document.importNode(
        /** @type {HTMLTemplateElement} */ (tpl).content.firstElementChild,
        true
      )
    );
    win.id = `win-doc-${ctx.key}`;
    win.setAttribute('heading', ctx.name);
    const g = savedDocGeom.get(ctx.fileId ?? '') ?? {
      left: DOC_DEFAULT.left + STAGGER * staggerSlot,
      top: DOC_DEFAULT.top + STAGGER * staggerSlot,
      width: DOC_DEFAULT.width,
      height: DOC_DEFAULT.height,
    };
    staggerSlot = (staggerSlot + 1) % 8; // wrap before a cascade walks off-raster
    for (const k of ['left', 'top', 'width', 'height']) {
      if (Number.isFinite(g[k])) win.setAttribute(k, String(g[k]));
    }
    // Upgrade the clone NOW: a template clone's custom elements are inert
    // until they hit the document, and a property set on an un-upgraded
    // element is captured by Lit and restored only at the FIRST UPDATE —
    // after connectedCallback, where the editor wires its per-context doc
    // subscription. Upgrading first makes `.ctx` an ordinary property set,
    // so the connectedCallback contract ("ctx before the append") holds.
    customElements.upgrade(win);
    // The context lands on the editor and the tile readout BEFORE the append
    // — their doc wiring runs at connectedCallback.
    const editor = /** @type {HTMLElement} */ (win.querySelector('sm-editor'));
    /** @type {any} */ (editor).ctx = ctx;
    const status = win.querySelector('sm-status-line');
    /** @type {any} */ (status).ctx = ctx;
    if (hideDocs) win.hidden = true;
    desktop.append(win); // upgrades + slots in; the kit activates the newcomer
    clampWindow(desktop, win);
    byKey.set(ctx.key, { win, editor });
    // Settle the light-DOM order NOW (no pointer gesture is in flight at a
    // programmatic open): a document window appended after the static
    // windoids leaves DOM order ≠ z-order, and the kit's deferred sync would
    // otherwise run at the END of the user's next press — re-inserting the
    // windoid nodes mid-gesture, which cancels the click being made (a
    // palette press would swallow). bringToFront also makes the newcomer the
    // active window through the kit's one funnel.
    desktop.bringToFront(win);
  }

  const syncDocs = () => {
    const contexts = workspace.get().contexts;
    const live = new Set(contexts.map((c) => c.key));
    for (const [key, rec] of byKey) {
      if (!live.has(key)) {
        rec.win.remove(); // existence IS visibility; the kit re-asserts active
        byKey.delete(key);
      }
    }
    for (const ctx of contexts) {
      if (!byKey.has(ctx.key)) createDocWindow(ctx);
      const rec = byKey.get(ctx.key);
      if (rec.win.heading !== ctx.name) rec.win.heading = ctx.name;
    }
  };
  unsubs.push(workspace.subscribe(syncDocs));
  syncDocs(); // HMR: rebuild windows for contexts that survived the reload

  // --- app activation: desktop -> the two mirrors -------------------------------
  // The kit's vf-activate is the single writer of both appActive (the
  // boolean) and workspace.activeKey (which document). detail.window is a
  // document-tier window or null.
  const keyOf = (win) => {
    for (const [key, rec] of byKey) if (rec.win === win) return key;
    return null;
  };
  const onActivate = (e) => {
    const win = /** @type {CustomEvent} */ (e).detail.window;
    workspace.setActive(win ? keyOf(win) : null);
    shell.setAppActive(!!win);
  };
  desktop.addEventListener('vf-activate', onActivate);
  unsubs.push(() => desktop.removeEventListener('vf-activate', onActivate));

  // --- deactivation: the page's press test --------------------------------------
  // The kit deliberately never decides which presses mean "the Finder" (its
  // furniture is slotted light DOM — only the page knows); the page owns the
  // test and routes the hits through clearActive(). A press on the desktop's
  // own surface (the dither, the bezel) is exactly `target === desktop`:
  // this listener sits on the host, so a press inside its shadow tree
  // retargets to the host itself, while a press in any slotted child — a
  // window, the menu bar, the options strip, a dialog, the icon layer —
  // arrives as that child and misses the test. The icon layer's own "this
  // press is the Finder" case lives in shell/icons.js, calling the same
  // clearActive().
  const onDesktopPress = (e) => {
    if (e.target === desktop) desktop.clearActive();
  };
  desktop.addEventListener('pointerdown', onDesktopPress);
  unsubs.push(() => desktop.removeEventListener('pointerdown', onDesktopPress));

  // --- close boxes ------------------------------------------------------------
  // A window's close box fires vf-close on the window itself (dialog closes
  // have a non-window target and pass through). A document window routes
  // through the dirty-checking flow menus.js injects; a windoid is a plain
  // wanted-flag toggle.
  const api = {
    byId,
    /** Injected by menus.js: the dirty-checking close flow, per context key. */
    onDocumentClose: null,
    /** Un-hide a document window and make it the active one (which also
     *  reactivates the application — bringToFront fires vf-activate). */
    activateContext(key) {
      const rec = byKey.get(key);
      if (!rec) return;
      rec.win.hidden = false;
      desktop.bringToFront(rec.win);
    },
    /** The window element a context lives in (persistence reads geometry off
     *  it), or null. */
    winFor(key) {
      return byKey.get(key)?.win ?? null;
    },
    /** The editor element a context lives in (the boot dev hooks land on the
     *  boot document's), or null. */
    editorFor(key) {
      return byKey.get(key)?.editor ?? null;
    },
    /** Deactivate the application programmatically (nothing calls this on
     *  the happy paths — closing the last window deactivates via the kit —
     *  but the hook stays for symmetry with clearActive()). */
    deactivate() {
      desktop.clearActive();
    },
    dispose() {
      for (const u of unsubs) u();
      desktop.removeEventListener('vf-close', onClose);
      // HMR: leave the windows standing — the re-init's syncDocs adopts…
      // it cannot: the fresh Map starts empty and would double them. Remove
      // and let the next init rebuild from the surviving workspace state.
      for (const [, rec] of byKey) rec.win.remove();
      byKey.clear();
    },
  };

  const onClose = (e) => {
    const t = e.target;
    if (!(t instanceof VfWindow)) return;
    const id = WINDOW_IDS.find((k) => byId[k] === t);
    if (id) {
      shell.setWindowVisible(id, false);
      return;
    }
    const key = keyOf(t);
    if (key != null) api.onDocumentClose?.(key);
  };
  desktop.addEventListener('vf-close', onClose);

  return api;
}
