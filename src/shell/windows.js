// ---------------------------------------------------------------------------
// Window plumbing for the desktop shell — two kinds of window, two regimes:
//
//   UTILITY WINDOIDS (Tools palette, Full Sprite View, 3D View): static
//   markup in index.html, permanent chrome — no close box (closable is set
//   false here) and no menu toggle; visibility = appActive alone (a desktop
//   click hides the palettes, clicking back into a document returns them).
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
// PLACEMENT comes from shell/layout.js (pure): the smart arrangement is
// computed from the live raster at boot (windoids) and per document open
// (the default box, staggered) — saved geometry always wins over it, and
// everything clamps onto the raster's lattice. When the raster RESIZES
// (main.js re-fits it per browser-resize event and calls onDesktopResized),
// every window keeps its relative top/left pin — left a plain fraction of
// the raster width, top of the open space below the options strip — live
// and un-debounced, deliberately WITHOUT the boot clamp: reversibility
// over visibility (see onDesktopResized).
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
// Close boxes never hide windows directly: the windoids have no close box
// at all, and a document window's close routes through the injected
// dirty-checking flow (menus.js) — the workspace does the removing.
// ---------------------------------------------------------------------------

import { snapSys, systemPxQuantum, VfWindow } from 'vintage-frames';
import { shell, WINDOW_IDS } from '../state/shell.js';
import { workspace } from '../state/workspace.js';
import { initialPlacement, pinOf, pinTo, TOP_RESERVE } from './layout.js';

// Each additional open document window offsets down-right by one step from
// the smart default box, System 7 style.
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
 *   captures that need them alone; a windoid id keeps that windoid out of
 *   frame for the whole session — the only way to hide one, there being no
 *   runtime toggle).
 */
export function initWindows(desktop, { saved = null, hide = [] } = {}) {
  /** @type {(() => void)[]} */
  const unsubs = [];

  // --- utility windoids: smart placement -> boot restore -> clamp -------------
  /** @type {Record<string, VfWindow>} shell id -> element */
  const byId = {};
  for (const id of WINDOW_IDS) {
    byId[id] = /** @type {VfWindow} */ (desktop.querySelector(`#win-${id}`));
  }
  // The smart arrangement, computed from the live raster (shell/layout.js):
  // Tools top-left, the sprite/stage rail right. The Tools palette's
  // content-hugging size stays authored in index.html and feeds the math.
  const smartLayout = () =>
    initialPlacement(desktop.width, desktop.height, {
      width: byId.tools.width ?? 0,
      height: byId.tools.height ?? 0,
    });
  const smart = smartLayout();
  for (const id of WINDOW_IDS) {
    // Non-closeable by design: the windoids are permanent chrome, on screen
    // whenever the application is. `closable` defaults true and markup can't
    // express the off state (a boolean attribute), so it's set here.
    byId[id].closable = false;
    const sm = smart[id];
    byId[id].left = sm.left;
    byId[id].top = sm.top;
    if ('width' in sm && byId[id].resizable) {
      byId[id].width = sm.width;
      byId[id].height = sm.height;
    }
    const s = saved?.utility?.[id];
    if (s) {
      if (Number.isFinite(s.left)) byId[id].left = s.left;
      if (Number.isFinite(s.top)) byId[id].top = s.top;
      if (Number.isFinite(s.width) && byId[id].resizable) byId[id].width = s.width;
      if (Number.isFinite(s.height) && byId[id].resizable) byId[id].height = s.height;
    }
    clampWindow(desktop, byId[id]);
  }
  const hiddenAtBoot = new Set(hide.filter((id) => id !== 'document'));
  const hideDocs = hide.includes('document');

  // --- utility visibility: appActive -> hidden ---------------------------------
  // A windoid belongs to the application, so it is on screen exactly while
  // the app is active (?hide= keeps one out of frame for captures).
  const syncUtility = () => {
    const { appActive } = shell.get();
    for (const id of WINDOW_IDS) byId[id].hidden = !appActive || hiddenAtBoot.has(id);
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
    // The default box is the smart placement's vacant-middle fill, computed
    // against the CURRENT raster (the desktop may have resized since boot),
    // staggered per creation.
    const d = smartLayout().doc;
    const g = savedDocGeom.get(ctx.fileId ?? '') ?? {
      left: d.left + STAGGER * staggerSlot,
      top: d.top + STAGGER * staggerSlot,
      width: d.width,
      height: d.height,
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
  // have a non-window target and pass through). Only document windows carry
  // one — the windoids are non-closeable — and it routes through the
  // dirty-checking flow menus.js injects.
  /** Per-window relative pin across raster resizes: the unrounded fraction
   *  plus the top/left this path last applied (a mismatch there means
   *  someone moved the window, so its pin re-derives). See onDesktopResized. */
  const pins = new WeakMap();

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
    /** The raster changed size (a browser resize / zoom re-fit — main.js
     *  calls this right after fitWithin, per event, un-debounced: the raster
     *  re-fits live, so the windows track it in the same stroke). Every
     *  window — windoid and document alike — keeps its relative pin
     *  (shell/layout.js: left as a plain fraction of the raster width, top
     *  of the open space below the options strip — the fixed chrome band
     *  is the pin's y = 0 line, so a window tucked under the strip stays
     *  tucked under it). Deliberately NO clamp and no visibility guarantee: a clamp at the
     *  small size rewrites the fraction and turns grow-back into a drift, so
     *  a window near an edge just hangs partly off a shrunk raster and
     *  returns whole. Sizes are left alone; the bare snap keeps the chrome
     *  on the system-px lattice.
     *
     *  The UNROUNDED fraction is the per-window truth between events (the
     *  `pins` cache), re-derived only when the window has moved since this
     *  path last placed it (a drag, a restore, a fresh window). Re-deriving
     *  it every event from the just-snapped position ratchets — the
     *  lattice's round-half-up walked windows down the screen across a long
     *  resize drag, one notch per odd landing, never back up. */
    onDesktopResized(before) {
      const after = { width: desktop.width, height: desktop.height };
      if (before.width === after.width && before.height === after.height) return;
      const wins = [
        ...WINDOW_IDS.map((id) => byId[id]),
        ...[...byKey.values()].map((rec) => rec.win),
      ];
      for (const win of wins) {
        const cur = { left: win.left ?? 0, top: win.top ?? 0 };
        let rec = pins.get(win);
        if (!rec || rec.left !== cur.left || rec.top !== cur.top) {
          rec = { pin: pinOf(cur, before) };
        }
        const pos = pinTo(rec.pin, after);
        win.left = snapSys(pos.left, win);
        win.top = snapSys(pos.top, win);
        pins.set(win, { pin: rec.pin, left: win.left, top: win.top });
      }
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
    const key = keyOf(t);
    if (key != null) api.onDocumentClose?.(key);
  };
  desktop.addEventListener('vf-close', onClose);

  return api;
}
