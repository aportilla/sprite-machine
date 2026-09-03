// ---------------------------------------------------------------------------
// Window plumbing for the desktop shell — two kinds of window, two regimes:
//
//   UTILITY WINDOIDS (Tools palette, Full Sprite View, 3D View, 3D Sprite
//   Atlas): static markup in index.html. The first three are permanent
//   chrome — no close box (closable is set false here) and no menu toggle;
//   visibility = appActive alone (a desktop click hides the palettes,
//   clicking back into a document returns them). The 3D Sprite Atlas is the
//   one TOGGLEABLE windoid: it keeps the kit's close box, and its visibility
//   is appActive AND prefs.showRing — View → 3D Sprite Atlas flips the
//   flag, the close box (routed below) clears it, and a show brings it to
//   the front of the windoid band (a palette you asked for comes up on
//   top). Its HEIGHT is a derivation like the Sprite View's size (fitRing:
//   ringHeightFor(size), re-fit as the tile size changes and DECLARED to
//   the grow box as the kit's size rect, min-height = max-height — so it
//   resizes on the horizontal axis alone); its WIDTH is the user's, seeded
//   by the placement, moved by the grow box, floored at the strip (the
//   rect's min-width; the cell row scrolls under the kit's rail past it —
//   docs/ring-size-plan.md). They hide, never unmount — canvas identity
//   survives.
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
//   PANEL WINDOWS: document-tier windows that are NOT documents — the
//   Desktop Patterns control panel (shell/patterns.js owns its lifecycle
//   and its body). Adopted here (addPanel / removePanel) with the pure
//   placement that puts them on a raster, so arrange() re-places them and
//   the resize re-pin moves them like every window; the owner appends and
//   removes the node. A panel holding the desktop's active state is the
//   Finder's turn (see APP ACTIVATION below).
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
// appActive is "a DOCUMENT window is the desktop's active window", not
// "any window is": a panel window holding active (the Desktop Patterns
// control panel — a System 7 control panel opened in the FINDER's layer)
// mirrors as the desktop-focused state exactly like none, so opening it
// deactivates the application and closing it (the kit promotes the topmost
// document window) brings the application back.
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
// Close boxes never hide windows directly: the permanent windoids have no
// close box at all, the 3D Sprite Atlas's is its toggle's uncheck (onClose
// below), and a document window's close routes through the injected
// dirty-checking flow (menus.js) — the workspace does the removing.
//
// The ZOOM BOX (document windows only — the template declares `zoomable`)
// toggles a window between the placement's zoomed state and the size it
// had before the zoom (a session truth, never persisted), top-left held
// both ways: see onZoom below.
// ---------------------------------------------------------------------------

import { snapSys, systemPxQuantum, VfWindow } from 'vintage-frames';
import { shell, WINDOW_IDS } from '../state/shell.js';
import { prefs } from '../state/prefs.js';
import { ring } from '../state/ring.js';
import { workspace, followActive } from '../state/workspace.js';
import {
  cascadeFrom,
  cascadeSlot,
  initialPlacement,
  pinOf,
  pinTo,
  spriteHeightFor,
  ringHeightFor,
  RING_MIN_WIDTH,
  SPRITE_WIDTH,
  TOP_RESERVE,
  WINDOW_FRAME,
  zoomedBox,
} from './layout.js';

// The 3D View windoid's size floor, in system px — the kit's own grow floor
// is a general 80×54, under which this windoid degenerates. Applied to every
// geometry that lands on it: boot (the smart placement on a tiny raster),
// the raster re-pin (floorOf), and the grow box — DECLARED to it as the
// kit's size rect (vintage-frames 0.5.6: `min-width` / `min-height` bound
// the drag per axis, the way GrowWindow took the app's rectangle), so no
// correction ever runs after a vf-resize.
// WIDTH: the controls strip in its header (sm-stage-controls — the rotate /
// smooth checkboxes) must never be clipped: its measured content width, 159
// (8 pad + the two checkboxes 61 + 68 + the 14 gap + 8 pad) + the frame's
// 1px borders, rounded up a hair — if the strip's contents change,
// re-measure and re-pin. HEIGHT: the fixed chrome (12 dot bar + 2 borders +
// the STAGE_STRIP header + 15 status = 53) plus enough canvas to still
// read as a view.
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
  // Tools top-left, the sprite/stage rail right, the 3D Sprite Atlas strip
  // docked at the bottom — the doc box giving up the strip's band only
  // while the strip is SHOWN. The Tools palette's content-hugging size
  // stays authored in index.html and feeds the math.
  const ringShown = () => prefs.get().showRing;
  const smartLayout = () =>
    initialPlacement(
      desktop.width,
      desktop.height,
      {
        width: byId.tools.width ?? 0,
        height: byId.tools.height ?? 0,
      },
      { ringViews: ring.get().views, ringSize: ring.get().size, ringShown: ringShown() }
    );

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
  // --- the 3D Sprite Atlas's derived height ---------------------------------------
  // The Sprite View's rule on ONE axis: ringHeightFor(size) tall — the
  // chrome over one row of tile-size cells — never authored truth, applied
  // at placement, re-derived as the tile size changes, and DECLARED to the
  // grow box as the kit's size rect (min-height = max-height: the axis is
  // locked, the drag moves the width alone — the kit's own Patterns-strip
  // idiom). The WIDTH is the user's: the placement seeds it (the natural
  // row, capped at the vacancy), the grow box moves it within the rect's
  // min-width — the strip's content width, RING_MIN_WIDTH (the kit's own
  // grow floor is a general 80) — and floorRingWidth guards the
  // programmatic writers the rect doesn't bound (the rect bounds the
  // gesture only). ONE writer, one anchor: fitRing writes the height and
  // nothing else. A size change never moves the top-left — the bar stays
  // where the placement or your drag put it and the BOTTOM edge is what
  // moves, a bigger tile growing the window down from where it sits (the
  // Sprite View's rule: its height moves under a document switch, and that
  // is no move). So a strip docked on the bottom margin grows past the
  // raster's bottom at a big tile — accepted, the user's call: the pin
  // keeps it hanging by the same amount across a resize (reversibility
  // over visibility, the rule's own contract), a drag or Arrange brings it
  // back. (A first cut held the bottom edge instead, growing the window up
  // with the top floored at the reserve — a second writer; retired.)
  const floorRingWidth = () => {
    if ((byId.ring.width ?? 0) < RING_MIN_WIDTH) byId.ring.width = RING_MIN_WIDTH;
  };
  /** The rect, restated whenever the height derivation moves. (The
   *  window's header height — the controls strip, RING_STRIP — is authored
   *  in the markup as `header-height`, the kit's grammar; the chrome
   *  arithmetic ringHeightFor counts the same 63, and the drive pins the
   *  two against each other.) */
  const declareRingRect = (h) => {
    byId.ring.minWidth = RING_MIN_WIDTH;
    byId.ring.minHeight = h;
    byId.ring.maxHeight = h;
  };
  const fitRing = () => {
    const h = ringHeightFor(ring.get().size);
    byId.ring.height = h;
    declareRingRect(h);
    floorRingWidth();
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
    // The sprite windoid's size and the ring's height are never authored
    // truth — always the derivations (the ring's placed width stands,
    // floored).
    if (id === 'sprite') fitSprite();
    if (id === 'ring') fitRing();
    clampWindow(desktop, byId[id]);
    pins.delete(byId[id]);
  };
  const placeUtility = () => {
    const smart = smartLayout();
    for (const id of WINDOW_IDS) placeWindoid(id, smart);
  };
  // Panel windows adopted from outside (see the header), each with the
  // pure placement that puts it on a raster: `(desktopW, desktopH) → box`.
  /** @type {Map<VfWindow, (w: number, h: number) => {left: number, top: number, width: number, height: number}>} */
  const panels = new Map();
  const placePanel = (win) => {
    const boxFor = panels.get(win);
    if (!boxFor) return;
    const g = boxFor(desktop.width, desktop.height);
    win.left = g.left;
    win.top = g.top;
    win.width = g.width;
    win.height = g.height;
    clampWindow(desktop, win);
    pins.delete(win);
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
    // Non-closeable by design: the permanent windoids are on screen
    // whenever the application is. `closable` defaults true and markup can't
    // express the off state (a boolean attribute), so it's set here. The 3D
    // Sprite Atlas is the exception — its close box IS its toggle's uncheck
    // (onClose below), so the kit's default stands.
    if (id !== 'ring') byId[id].closable = false;
  }
  // The 3D View's floor, declared to its grow box as the kit's size rect:
  // the drag stops there on its own (the kit's general 80×54 would let it
  // shrink under the strip). The ring's rect rides fitRing above — its
  // height bound moves with the tile size. (Every windoid's header height
  // — its controls strip's band — is authored in the markup as
  // `header-height`, the kit's grammar; layout.js keeps the same numbers
  // for the chrome arithmetic, and the drive pins the two.)
  byId.stage.minWidth = STAGE_MIN_WIDTH;
  byId.stage.minHeight = STAGE_MIN_HEIGHT;
  placeUtility();

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

  // The tile size changes the ring's height: re-fit — the top-left held,
  // the bottom edge the one that moves (see fitRing) — guarded on the
  // computed height so a settings change that leaves it (views, elevation,
  // offset) writes nothing (the sprite refit's idiom). The view count no
  // longer touches the window — a longer row scrolls under the rail.
  unsubs.push(
    ring.subscribe(() => {
      if ((byId.ring.height ?? 0) !== ringHeightFor(ring.get().size)) fitRing();
    })
  );

  const hiddenAtBoot = new Set(hide.filter((id) => id !== 'document'));
  const hideDocs = hide.includes('document');

  // --- utility visibility: appActive -> hidden ---------------------------------
  // A windoid belongs to the application, so it is on screen exactly while
  // the app is active (?hide= keeps one out of frame for captures); the 3D
  // Sprite Atlas needs its own toggle on as well, and a show (the flag
  // flipping it onto the screen) raises it to the front of the windoid
  // band — see the header.
  let ringWasShown = false;
  const syncUtility = () => {
    const { appActive } = shell.get();
    for (const id of WINDOW_IDS) {
      const shown = appActive && !hiddenAtBoot.has(id) && (id !== 'ring' || ringShown());
      byId[id].hidden = !shown;
    }
    const ringNow = !byId.ring.hidden;
    if (ringNow && !ringWasShown) desktop.bringToFront(byId.ring);
    ringWasShown = ringNow;
  };
  unsubs.push(shell.subscribe(syncUtility), prefs.subscribe(syncUtility));
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
    // Settle the light-DOM order: a document window appended after the
    // static windoids leaves DOM order ≠ z-order, and bringToFront asks the
    // kit to sync it (a task, once no pointer is down) rather than leaving
    // it to the user's next gesture. bringToFront also makes the newcomer
    // the active window through the kit's one funnel.
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
    const key = win ? keyOf(win) : null;
    workspace.setActive(key);
    // A DOCUMENT window active, not any window: a panel (the Desktop
    // Patterns control panel) holding active is the Finder's turn — the
    // desktop-focused state (see the header's APP ACTIVATION).
    shell.setAppActive(key != null);
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
  // have a non-window target and pass through). Document windows carry one
  // — it routes through the dirty-checking flow menus.js injects — and so
  // does the 3D Sprite Atlas windoid alone among the windoids: its close is
  // the View menu's uncheck, one truth (prefs.showRing).
  /** A resizable window's size floor — the 3D View's own, the ring's (the
   *  strip's width over its derived height), the kit's for the rest —
   *  applied on the re-pin itself (shell/layout.js pinTo): the declared
   *  size rects bound the grow box alone, so this path floors its own
   *  programmatic writes (a floor applied afterwards would read as a
   *  "touch" on the next event and re-derive the pin from the floored
   *  geometry — a drift). */
  const floorOf = (win) =>
    win === byId.stage
      ? { width: STAGE_MIN_WIDTH, height: STAGE_MIN_HEIGHT }
      : win === byId.ring
        ? { width: RING_MIN_WIDTH, height: ringHeightFor(ring.get().size) }
        : { width: KIT_MIN_WIDTH, height: KIT_MIN_HEIGHT };
  /** The pin's policy: a fixed-size box passes its live size, a resizable
   *  one its floor — and the 3D Sprite Atlas both, per axis: its height is
   *  a derivation (fixed — resolved through the anchor rule from the pin
   *  read where the window sits: docked by the placement, the bottom strut
   *  holds and the top follows), its width the user's (resizable, floored
   *  at the strip). */
  const policyOf = (win, cur) =>
    win === byId.ring
      ? { size: { height: cur.height }, min: { width: RING_MIN_WIDTH } }
      : win.resizable
        ? { min: floorOf(win) }
        : { size: { width: cur.width, height: cur.height } };
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
    // fixed derivation, re-fit on document switches, never a touch — its
    // pin is all struts and the anchor rule holds the near edge, so the
    // old pin still describes it. The ring's height refit on a tile-size
    // change IS a touch: the top-left held and the bottom edge moved, so a
    // pin read with the bottom a strut at the old offset would re-dock the
    // bottom on the next event and jump the bar — the box is re-read where
    // it sits) — or never pinned: read the pin from where it sits, on the
    // raster it sat on.
    const sized =
      !!rec && win.resizable && (rec.width !== cur.width || rec.height !== cur.height);
    const moved = !rec || rec.left !== cur.left || rec.top !== cur.top || sized;
    if (moved) rec = { pin: pinOf(cur, before, WINDOW_FRAME) };
    const g = pinTo(rec.pin, after, WINDOW_FRAME, policyOf(win, cur));
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
     *  browser. From the Finder role with a document open it also re-rails
     *  the hidden windoids, ready for the next open (menus.js greys the
     *  item with no document windows — nothing to arrange). Positions only:
     *  nothing activates or re-stacks. */
    arrange() {
      placeUtility();
      let slot = 0;
      for (const el of desktop.querySelectorAll(':scope > vf-window')) {
        const win = /** @type {VfWindow} */ (el);
        if (keyOf(win) != null) placeDoc(win, slot++);
      }
      // A panel goes back where its placement puts it on this raster too.
      for (const win of panels.keys()) placePanel(win);
    },
    /** Adopt a PANEL window (see the header): `boxFor` is its pure placement
     *  on a raster, applied now (+ the boot clamp), by arrange(), and —
     *  through the pin — on every raster resize. The window must already be
     *  a slotted child of the desktop (the clamp reads its live lattice). */
    addPanel(win, boxFor) {
      panels.set(win, boxFor);
      placePanel(win);
    },
    /** Drop a panel from the placement + re-pin set (the owner removes the
     *  node). */
    removePanel(win) {
      panels.delete(win);
      pins.delete(win);
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
      for (const win of panels.keys()) repin(win, before, after);
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
      desktop.removeEventListener('vf-zoom', onZoom);
      // HMR: leave the windows standing — the re-init's syncDocs adopts…
      // it cannot: the fresh Map starts empty and would double them. Remove
      // and let the next init rebuild from the surviving workspace state.
      for (const [, rec] of byKey) rec.win.remove();
      byKey.clear();
      panels.clear(); // the owner (shell/patterns.js) removes its node
    },
  };

  const onClose = (e) => {
    const t = e.target;
    if (!(t instanceof VfWindow)) return;
    if (t === byId.ring) {
      prefs.setShowRing(false);
      return;
    }
    const key = keyOf(t);
    if (key != null) api.onDocumentClose?.(key);
  };
  desktop.addEventListener('vf-close', onClose);

  // --- zoom boxes --------------------------------------------------------------
  // The kit's zoom box (`zoomable` on the document-window template — only
  // document windows carry one) fires vf-zoom and leaves what zooming MEANS
  // to the page. Here it is a toggle, the top-left held in both directions
  // — a zoom never moves a window, only its far edges:
  //
  //   EXPAND — the window grows right and down to the vacant middle's own
  //   edges (layout.js zoomedBox: the rail's inset gutter at the right, the
  //   bottom margin below), filling the open area from wherever its
  //   top-left sits without running under the windoid rail.
  //
  //   RESTORE — a window already AT that state (its size IS the box
  //   zoomedBox computes for its top-left on the live raster) returns to
  //   the size the expand RECORDED — what the window measured just before
  //   it grew. The memory is a session truth in a WeakMap on the element,
  //   the windoid-arrangement discipline exactly: within a session what
  //   you had is yours, and nothing about it persists (a reload still
  //   places every window fresh). With nothing recorded — a window grown
  //   BY HAND onto the exact zoomed box, an HMR-adopted window — the doc
  //   box's size (the placement's default for the CURRENT raster) is the
  //   fallback. A zoomed window DRAGGED elsewhere reads unzoomed at its
  //   new top-left (the state test is positional), so a further zoom
  //   re-records the zoomed size as its pre-zoom truth — the drag made
  //   that box the user's.
  //
  // The state test is arithmetic, so it survives a browser resize: a zoomed
  // window's far edges are struts of the nine-slice pin (the rail gutter,
  // the bottom band), so a re-pin holds them where a re-derived zoomedBox
  // puts them and the next click still reads "zoomed". No clamp on either
  // write: the expand fits the raster by construction (but for the DOC_MIN
  // floor on a window dragged past the vacancy — hanging off is recoverable
  // by a drag, the resize rule's own posture), and the restore leaves a
  // far-dragged window hanging rather than moving its handle. A
  // programmatic size write fires no vf-resize (the kit's value-set rule),
  // and the next raster resize re-derives this window's pin (the pins
  // cache reads the new geometry as a touch).
  /** Pre-zoom sizes, per window — recorded by the expand, consumed by the
   *  restore. A WeakMap so a closed window's record dies with its node. */
  const zoomMemory = new WeakMap();
  const onZoom = (e) => {
    const win = e.target;
    if (!(win instanceof VfWindow) || keyOf(win) == null) return;
    // A shown 3D Sprite Atlas strip is a boundary the zoom respects (the
    // doc box leaves it the same room).
    const z = zoomedBox(
      desktop.width,
      desktop.height,
      { left: win.left ?? 0, top: win.top ?? 0 },
      { ringShown: ringShown(), ringSize: ring.get().size }
    );
    if (win.width === z.width && win.height === z.height) {
      const back = zoomMemory.get(win) ?? smartLayout().doc;
      zoomMemory.delete(win);
      win.width = back.width;
      win.height = back.height;
    } else {
      zoomMemory.set(win, { width: win.width, height: win.height });
      win.width = z.width;
      win.height = z.height;
    }
  };
  desktop.addEventListener('vf-zoom', onZoom);

  return api;
}
