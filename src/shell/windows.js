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
//   status line take the context BEFORE the append — places it (the doc
//   box, cascaded), and appends it as a DIRECT CHILD of the desktop (the
//   stacking manager only sees direct vf-window children; appending is also
//   what makes the kit activate it — opening a window brings the application
//   forward). A context closing removes its window outright: a document
//   window's visibility IS its existence.
//
// PLACEMENT comes from shell/layout.js (pure), and ONLY from there: the
// smart arrangement is computed from the live raster at boot (windoids) and
// per document open (the doc box, cascaded into the first free slot), then
// clamped onto the raster's lattice. Nothing is restored from a prior
// session — window geometry is never persisted (desktop-state.js doesn't
// even see the windows): a browser is resized and reopened on another
// monitor all the time, so a remembered top/left is no truth worth
// re-asserting over a raster that may be nothing like the one it was
// dragged on. Within a session, what you drag is yours: the windoids keep
// their arrangement across deactivation and across close-to-zero — and
// View → Arrange Windows (arrange(), below) re-runs the whole placement on
// the current raster whenever you want it back. When the
// raster RESIZES (main.js re-fits it per browser-resize event and calls
// onDesktopResized) ONE rule moves every window, placed or dragged alike:
// the NINE-SLICE pin (shell/layout.js pinOf/pinTo — the open area below the
// options strip cut into a fixed-thickness ring of outer bands around a
// middle that grows and shrinks; an edge in a band is a strut, an edge in
// the middle a spring). The window frame's top and right bands are sized
// to the rail, so the placed windoids are all struts and a resize lands
// them exactly where Arrange would — the rail stays flush and full-height,
// and the hidden windoids behind a boot dialog come up right when the first
// document opens — with nothing remembering whether a window was touched.
// Live and un-debounced, deliberately WITHOUT the boot clamp:
// reversibility over visibility (see onDesktopResized).
//
// APP ACTIVATION has one writer: the desktop's vf-activate event (the kit
// fires it on every change of active document-tier window, null included)
// lands here and is mirrored into BOTH truths — shell.appActive (the
// boolean the chrome gates on) and workspace.activeKey (which document).
// Deactivation is interaction-only, and the PAGE owns the press test (the
// kit's 0.4.0 position: only the page knows which presses mean "the
// Finder"): a press on the desktop's bare dither — wired here — or in the
// icon layer (shell/icons.js) routes through desktop.clearActive(); the
// kit adds its own null when the last document window leaves. The mirrors
// initialize by READING the kit's truth (desktop.activeWindow — null on a
// fresh boot, so a dialog-greeted boot is desktop-focused), never from a
// constant; opening any document window activates through the kit (hidden
// windows included — ?hide=document captures keep their windoids that way).
//
// Close boxes never hide windows directly: the windoids have no close box
// at all, and a document window's close routes through the injected
// dirty-checking flow (menus.js) — the workspace does the removing.
// ---------------------------------------------------------------------------

import { snapSys, systemPxQuantum, VfWindow } from 'vintage-frames';
import { shell, WINDOW_IDS } from '../state/shell.js';
import { workspace, followActive } from '../state/workspace.js';
import {
  cascadeFrom,
  cascadeSlot,
  initialPlacement,
  pinOf,
  pinTo,
  spriteHeightFor,
  SPRITE_WIDTH,
  TOP_RESERVE,
  WINDOW_FRAME,
} from './layout.js';

// The 3D View windoid's size floor, in system px — the kit's own grow floor
// is a general 80×54, under which this windoid degenerates. Applied to every
// geometry that lands on it: boot (the smart placement on a tiny raster)
// and the grow box (via vf-resize below).
// WIDTH: the controls strip across its top (sm-stage-controls — the rotate /
// smooth checkboxes) must never be clipped: its measured content width, 159
// (8 pad + the two checkboxes 61 + 68 + the 14 gap + 8 pad) + the frame's
// 1px borders, rounded up a hair — if the strip's contents change,
// re-measure and re-pin. HEIGHT: the fixed chrome (12 dot bar + 2 borders +
// 24 strip + 15 status = 53) plus enough canvas to still read as a view.
const STAGE_MIN_WIDTH = 164;
const STAGE_MIN_HEIGHT = 160;
// The kit's own grow floor (vf-window's MIN_WIDTH × MIN_HEIGHT — not
// exported, restated): the floor every other resizable window re-pins
// against, so a resize can never leave one smaller than its grow box could.
const KIT_MIN_WIDTH = 80;
const KIT_MIN_HEIGHT = 54;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * Clamp a window's placed position onto the live raster, on the same
 * k-system-px lattice a drag lands on (system7web's centerWindow rule, minus
 * the centering — placed positions are kept, just pulled on-canvas: a
 * cascaded document window near the raster's edge, or the smart placement's
 * size floors on a tiny raster). A RESIZABLE window's size clamps to the
 * open area first: bigger than it, the grow-box corner is unreachable at
 * ANY position (the title bar can't leave the raster upward), so an
 * oversize box shrinks to a workable one.
 */
export function clampWindow(desktop, win) {
  const k = systemPxQuantum(win);
  const down = (v) => Math.floor(v / k) * k;
  const up = (v) => Math.ceil(v / k) * k;
  const minTop = up(TOP_RESERVE);
  if (win.resizable) {
    if (Number.isFinite(win.width)) win.width = Math.min(win.width, down(desktop.width));
    if (Number.isFinite(win.height))
      win.height = Math.min(win.height, down(Math.max(0, desktop.height - minTop)));
  }
  const w = win.width ?? 0;
  const h = win.height ?? 0;
  win.left = clamp(snapSys(win.left ?? 0, win), 0, Math.max(0, down(desktop.width - w)));
  win.top = clamp(
    snapSys(win.top ?? minTop, win),
    minTop,
    Math.max(minTop, down(desktop.height - h))
  );
}

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {{hide?: string[]}} [opts]
 *   hide: window ids to hide at boot (?hide= dev hook — 'document' hides the
 *   document windows, which stay ACTIVE, so the utility windows survive for
 *   captures that need them alone; a windoid id keeps that windoid out of
 *   frame for the whole session — the only way to hide one, there being no
 *   runtime toggle).
 */
export function initWindows(desktop, { hide = [] } = {}) {
  /** @type {(() => void)[]} */
  const unsubs = [];

  // --- utility windoids: smart placement -> floors -> clamp --------------------
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

  // --- the Full Sprite View's fixed size ---------------------------------------
  // The windoid is a fixed-size picture frame — no grow box (not `resizable`
  // in the markup): its width is the atlas grid block's (SPRITE_WIDTH) and
  // its height is DERIVED so the 3×2 face-tile grid exactly fills the body
  // below the picker strip — no margins. The ratio is the ACTIVE document's
  // own TILE (square for every square-tile sheet — it only differs under
  // the ?tile=WxH shear hook), defaulting to square before a document is
  // open.
  const spriteRatio = () => {
    const s = workspace.active()?.doc.get();
    return s && s.tileW > 0 && s.tileH > 0 ? s.tileH / s.tileW : undefined;
  };
  const fitSprite = () => {
    byId.sprite.width = SPRITE_WIDTH;
    byId.sprite.height = spriteHeightFor(SPRITE_WIDTH, spriteRatio());
  };
  /** Per-window nine-slice pin across raster resizes: the unrounded pin
   *  (shell/layout.js) plus the geometry this path last applied — a
   *  mismatch there means someone else moved or resized the window (a
   *  drag, a grow, a placement), so its pin re-derives. See
   *  onDesktopResized. A placement drops the record outright: the next
   *  resize reads the pin from the placed geometry. */
  const pins = new WeakMap();

  // The placement is the geometry — no prior session's is consulted (see
  // the header): a windoid lands where THIS raster puts it. Run for all
  // three at boot and by arrange().
  const placeWindoid = (id, smart) => {
    const sm = smart[id];
    byId[id].left = sm.left;
    byId[id].top = sm.top;
    if ('width' in sm && byId[id].resizable) {
      byId[id].width = sm.width;
      byId[id].height = sm.height;
    }
    if (id === 'stage') {
      byId[id].width = Math.max(byId[id].width ?? 0, STAGE_MIN_WIDTH);
      byId[id].height = Math.max(byId[id].height ?? 0, STAGE_MIN_HEIGHT);
    }
    // The sprite windoid's size is never authored truth — it is always
    // the fixed derivation.
    if (id === 'sprite') fitSprite();
    clampWindow(desktop, byId[id]);
    pins.delete(byId[id]);
  };
  const placeUtility = () => {
    const smart = smartLayout();
    for (const id of WINDOW_IDS) placeWindoid(id, smart);
  };
  // A document window onto cascade slot `slot` of the CURRENT raster's doc
  // box, at the box's size: arrange().
  const placeDoc = (win, slot) => {
    const d = smartLayout().doc;
    const pos = cascadeSlot(d, slot);
    win.left = pos.left;
    win.top = pos.top;
    win.width = d.width;
    win.height = d.height;
    clampWindow(desktop, win);
    pins.delete(win);
  };
  for (const id of WINDOW_IDS) {
    // Non-closeable by design: the windoids are permanent chrome, on screen
    // whenever the application is. `closable` defaults true and markup can't
    // express the off state (a boolean attribute), so it's set here.
    byId[id].closable = false;
  }
  placeUtility();
  // The grow box enforces only the kit's general 80×54 floor, so a drag could
  // shrink the 3D View under its own floor: re-floor on every vf-resize. The
  // kit fires it after the shrunken box has been applied but the correction
  // lands in the same microtask batch — before the next paint — so the drag
  // simply stops at the floor.
  const onStageResize = () => {
    if ((byId.stage.width ?? 0) < STAGE_MIN_WIDTH) byId.stage.width = STAGE_MIN_WIDTH;
    if ((byId.stage.height ?? 0) < STAGE_MIN_HEIGHT) byId.stage.height = STAGE_MIN_HEIGHT;
  };
  byId.stage.addEventListener('vf-resize', onStageResize);
  unsubs.push(() => byId.stage.removeEventListener('vf-resize', onStageResize));

  // A document switch or a structural doc change (a tile resize, a load) can
  // change the atlas ratio: re-derive the sprite windoid's height. Guarded on
  // the computed size so the steady state (every square-tile atlas shares
  // 2:3) writes nothing.
  unsubs.push(
    followActive(workspace, (ctx) => {
      if (!ctx) return;
      const refit = () => {
        if ((byId.sprite.height ?? 0) !== spriteHeightFor(SPRITE_WIDTH, spriteRatio()))
          fitSprite();
      };
      const un = ctx.doc.subscribe(refit);
      refit();
      return un;
    })
  );

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
    // The box is the smart placement's vacant-middle fill, computed against
    // the CURRENT raster (the desktop may have resized since boot), cascaded
    // into the first slot no open document window holds — never a
    // remembered geometry (see the header). Saved and untitled documents
    // place alike.
    const d = smartLayout().doc;
    const occupied = [...byKey.values()].map(({ win }) => ({
      left: win.left ?? 0,
      top: win.top ?? 0,
    }));
    const g = { ...cascadeFrom(d, occupied), width: d.width, height: d.height };
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
  // This wire is the single writer of both appActive (the boolean) and
  // workspace.activeKey (which document): desktop.activeWindow read once at
  // wire-up, then vf-activate (a document-tier window, or null) per change.
  const keyOf = (win) => {
    for (const [key, rec] of byKey) if (rec.win === win) return key;
    return null;
  };
  const applyActive = (win) => {
    workspace.setActive(win ? keyOf(win) : null);
    shell.setAppActive(!!win);
  };
  const onActivate = (e) => applyActive(/** @type {CustomEvent} */ (e).detail.window);
  desktop.addEventListener('vf-activate', onActivate);
  unsubs.push(() => desktop.removeEventListener('vf-activate', onActivate));
  // A mirror initializes by reading its source, never from a constant:
  // whatever the desktop already holds active — null on a fresh boot
  // (desktop-focused until a document window opens), or the window the
  // syncDocs rebuild above activated before this listener attached (an HMR
  // re-init) — lands through the same funnel the events use.
  applyActive(desktop.activeWindow);

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
  /** A resizable window's size floor — the 3D View's own, the kit's for
   *  the rest — applied on the re-pin itself (shell/layout.js pinTo), so
   *  onStageResize never has a correction to make after this path (one
   *  that fired would read as a grow-box "touch" on the next event and
   *  re-derive the pin from the floored geometry — a drift). */
  const floorOf = (win) =>
    win === byId.stage
      ? { width: STAGE_MIN_WIDTH, height: STAGE_MIN_HEIGHT }
      : { width: KIT_MIN_WIDTH, height: KIT_MIN_HEIGHT };
  /** The window's pin re-expressed on the new raster — the whole of
   *  onDesktopResized per window (its doc comment is the contract). */
  const repin = (win, before, after) => {
    const cur = {
      left: win.left ?? 0,
      top: win.top ?? 0,
      width: win.width ?? 0,
      height: win.height ?? 0,
    };
    let rec = pins.get(win);
    // Moved or resized since this path last wrote it (a non-resizable
    // window compares position only: the Sprite View's height is the
    // fixed derivation, re-fit on document switches, never a touch) — or
    // never pinned: read the pin from where it sits, on the raster it sat
    // on.
    const moved =
      !rec ||
      rec.left !== cur.left ||
      rec.top !== cur.top ||
      (win.resizable && (rec.width !== cur.width || rec.height !== cur.height));
    if (moved) rec = { pin: pinOf(cur, before, WINDOW_FRAME) };
    const g = pinTo(
      rec.pin,
      after,
      WINDOW_FRAME,
      win.resizable
        ? { min: floorOf(win) }
        : { size: { width: cur.width, height: cur.height } }
    );
    win.left = snapSys(g.left, win);
    win.top = snapSys(g.top, win);
    if (win.resizable) {
      // The oversize shrink (see the doc comment): the size snapped onto
      // the window's lattice, then capped at the open area, floor-snapped
      // so the clamped edge lands on the device grid.
      const k = systemPxQuantum(win);
      const minTop = Math.ceil(TOP_RESERVE / k) * k;
      const maxW = Math.floor(after.width / k) * k;
      const maxH = Math.floor(Math.max(0, after.height - minTop) / k) * k;
      win.width = Math.min(snapSys(g.width, win), maxW);
      win.height = Math.min(snapSys(g.height, win), maxH);
    }
    pins.set(win, {
      pin: rec.pin,
      left: win.left,
      top: win.top,
      width: win.width,
      height: win.height,
    });
  };

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
    /** The window element a context lives in, or null. */
    winFor(key) {
      return byKey.get(key)?.win ?? null;
    },
    /** The editor element a context lives in (the boot dev hooks land on the
     *  boot document's), or null. */
    editorFor(key) {
      return byKey.get(key)?.editor ?? null;
    },
    /** View → Arrange Windows: the boot placement, re-run on the CURRENT
     *  raster over every window — the windoids back to the rail at their
     *  placed sizes, every open document window onto the doc box at its
     *  size, cascaded in STACKING order (the desktop keeps DOM order in
     *  step with z-order: bottom-most first, so the front window tops the
     *  cascade; a sixth and beyond wrap, as an open would). The one way to
     *  get the arrangement back after moving things around or resizing the
     *  browser — app-level, so it also re-rails the hidden windoids from the
     *  Finder role, ready for the next open. Positions only: nothing
     *  activates or re-stacks. */
    arrange() {
      placeUtility();
      let slot = 0;
      for (const el of desktop.querySelectorAll(':scope > vf-window')) {
        const win = /** @type {VfWindow} */ (el);
        if (keyOf(win) != null) placeDoc(win, slot++);
      }
    },
    /** The raster changed size (a browser resize / zoom re-fit — main.js
     *  calls this right after fitWithin, per event, un-debounced: the raster
     *  re-fits live, so the windows track it in the same stroke). ONE rule,
     *  every window — windoid or document, placed or dragged:
     *
     *  THE NINE-SLICE PIN (shell/layout.js pinOf/pinTo, WINDOW_FRAME — its
     *  header is the design): the open area below the
     *  options strip is cut by a ring of outer bands — the frame's chrome
     *  band is the pin's y = 0 line, so a window tucked under the strip
     *  stays tucked under it — around a middle that grows and shrinks. Each
     *  window edge keeps its place in its slice: an edge in a band is a
     *  STRUT (its offset from that raster edge holds), an edge in the
     *  middle a SPRING (its fraction of the middle holds). So a window
     *  against the right edge stays against it, one wholly inside a corner
     *  never moves, a document window spanning the middle breathes with
     *  it. The frame's top and right bands are sized to the rail, so every
     *  placed windoid is all struts and a resize lands it exactly where
     *  Arrange Windows would — the rail stays flush and full-height, and a
     *  resize behind the boot dialog (windoids hidden, nothing open) comes
     *  up right when the first document opens — without this path knowing
     *  whether the window was ever touched. A fixed-size window (the
     *  Tools palette, the Sprite View) resolves its edges through the
     *  anchor rule (a lone strut holds; two springs keep the center); a
     *  resizable one floors its size the same way (floorOf).
     *
     *  Deliberately NO position clamp and no visibility guarantee: a clamp
     *  at the small size rewrites the pin and turns grow-back into a
     *  drift, so a window near an edge just hangs partly off a shrunk
     *  raster and returns whole; the bare snap keeps the chrome on the
     *  system-px lattice.
     *
     *  SIZES get exactly one intervention past the pin: a resizable window
     *  BIGGER than the open area shrinks to fit it. Hanging off is
     *  recoverable by a drag; bigger-than-the-area is not — the title bar
     *  can't leave the raster upward, so the grow-box corner would be
     *  unreachable at any position. The shrink never touches the pin, so
     *  growing the raster back restores the size exactly.
     *
     *  The UNROUNDED pin is the per-window truth between events (the
     *  `pins` cache), re-derived only when the window has moved or been
     *  resized since this path last wrote it (a drag, a grow, a placement,
     *  a fresh window). Re-deriving it every event from the just-snapped
     *  geometry ratchets — the lattice's round-half-up walked windows down
     *  the screen across a long resize drag, one notch per odd landing,
     *  never back up. */
    onDesktopResized(before) {
      const after = { width: desktop.width, height: desktop.height };
      if (before.width === after.width && before.height === after.height) return;
      for (const id of WINDOW_IDS) repin(byId[id], before, after);
      for (const { win } of byKey.values()) repin(win, before, after);
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
