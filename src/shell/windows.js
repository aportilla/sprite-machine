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
//   and its body), the folder windows (shell/folders.js) and the text
//   windows (shell/texts.js). Adopted here (addPanel / removePanel) with
//   the pure placement that puts them on a raster, so arrange() re-places
//   them and the resize re-pin moves them like every window, and with the
//   APPLICATION the panel belongs to (`app` — the Finder for a folder
//   window, the Text Viewer for a read-me, Desktop Patterns for the control
//   panel), which is what the bar shows while the panel holds active (see
//   APP ACTIVATION below); the owner appends and removes the node. A folder
//   window is the
//   one window that REOPENS WHERE IT WAS: addPanel takes its remembered
//   nine-slice pin (read by windowPin at its last close or snapshot) and
//   re-expresses it on the current raster by the resize rule's own policy,
//   clamped on-raster — the same arithmetic as a browser resize with the
//   window open, then the boot clamp.
//
// PLACEMENT comes from shell/layout.js (pure), and ONLY from there: the
// smart arrangement is computed from the live raster at boot (windoids) and
// per document open (the doc box, cascaded into the first free slot), then
// clamped onto the raster's lattice. Nothing about an APPLICATION window is
// restored from a prior session — a windoid's or a document window's
// geometry is never persisted: a browser is resized and reopened on another
// monitor all the time, so a remembered top/left is no truth worth
// re-asserting over a raster that may be nothing like the one it was
// dragged on. (A folder window is the Finder's furniture, and what it
// remembers is a PIN, not a top/left — relative terms any raster can
// re-express; see PANEL WINDOWS above and shell/folders.js.) Within a
// session, what you drag is yours: the windoids keep
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
// lands here and is mirrored into BOTH truths — shell.frontApp (WHICH
// APPLICATION is front, with its boolean shadow appActive — the Sprite
// Editor front — in the same patch) and workspace.activeKey (which
// document). The front application is a READING of the active window
// (docs/apps-plan.md §3.1): a document window → the Sprite Editor; a panel
// → the application its owner declared at adoption (addPanel's `app`); no
// active window, or a panel that declares nothing → the Finder, the
// desktop's application. So a panel window holding active (a folder
// window, the FINDER's; a read-me's, the Text Viewer's; the Desktop
// Patterns control panel, an application of its own) reads as another
// application's turn: opening it deactivates the Sprite Editor (the
// windoids hide, the bar swaps) and closing it (the kit promotes the
// topmost document window) brings the Sprite Editor back.
// Deactivation is interaction-only, and the PAGE owns the press test (the
// kit's 0.4.0 position: only the page knows which presses mean "the
// Finder"): a press on the desktop's bare dither — wired here — or in the
// icon layer (shell/icons.js) routes through desktop.clearActive(); the
// kit adds its own null when the last document window leaves. The mirrors
// initialize by READING the kit's truth (desktop.activeWindow — null on a
// fresh boot, so a dialog-greeted boot is the Finder's), never from a
// constant; opening any document window activates through the kit.
//
// Close boxes never hide windows directly: the permanent windoids have no
// close box at all, the 3D Sprite Atlas's is its toggle's uncheck (onClose
// below), and a document window's close routes through the injected
// dirty-checking flow (the Sprite Editor's, apps/sprite-editor) — the
// workspace does the removing.
//
// The ZOOM BOX toggles a window between an expanded state and what it had
// before (a session truth, never persisted): a DOCUMENT window's (the
// template declares `zoomable`) grows right and down to the vacancy with
// its top-left held both ways; a PANEL that declares an `expanded` box at
// adoption (the text windows — a reading column) goes to that box and
// back, its state read at the click by nearness. See onZoom below.
//
// ⌘J — View → Arrange Windows — is ONE item under a STATE rule (the Sprite
// Editor owns the item, apps/sprite-editor; arranged() and zoomActive()
// here are its two halves; the label is "Arrange Windows" in both states,
// only the item's VALUE turns — the Finder's and the Text Viewer's ⌘J items
// carry the arrange alone, greyed while arranged() reads true):
// arranged() asks whether the screen IS the arrangement — every visible
// window's live box against the box its placement would write on the
// current raster — and the item's value is `arrange` while something is
// off (a drag, a grow, the strip shown into the doc box's band, a browser
// resize the document window sprung with) and `zoom` (the zoom box's own
// toggle on the active document window) once everything is where the
// placement puts it. Two readings are
// deliberately loose: which document sits on which cascade slot is
// stacking bookkeeping (a raise alone must not turn the value to `arrange`
// — the chord would swap two windows plainly on the cascade), and the
// active window may sit zoomed from its slot (so repeats of ⌘J toggle
// that one window while nothing else moves). So that the test and the
// writes share one arithmetic, every placement below is a computed TARGET
// box (clampedBox) before it is a write (writeBox); onLayout is the
// signal the item re-derives on.
// ---------------------------------------------------------------------------

import { snapSys, systemPxQuantum, VfWindow } from 'vintage-frames';
import { shell, WINDOW_IDS, FINDER, SPRITE_EDITOR } from '../state/shell.js';
import { prefs } from '../state/prefs.js';
import { ring } from '../state/ring.js';
import { workspace, followActive } from '../state/workspace.js';
import {
  cascadeFrom,
  cascadeSlot,
  initialPlacement,
  nearBox,
  pinOf,
  pinTo,
  spriteHeightFor,
  ringHeightFor,
  RING_MIN_WIDTH,
  SPRITE_WIDTH,
  STAGE_STRIP,
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
// ONE RULE on both axes: the fixed chrome plus enough canvas to still read
// as a view — the same canvas extent across and down. The chrome: the
// frame's two 1px borders across; 12 dot bar + 2 borders + the STAGE_STRIP
// header + 15 status (53) down. The controls strip in the header
// (sm-stage-controls — the rotate checkbox) must never be clipped, and
// isn't: its content width, 77 (8 pad + the ~61 checkbox + 8 pad), sits
// well inside the canvas floor. Until Sep 4 2026 a second box ('smooth')
// made that row 159 and the ROW floored the width, at 164; if the strip
// ever outgrows the canvas floor again, re-measure and floor at the strip.
const STAGE_CHROME = { w: 2, h: 12 + 2 + STAGE_STRIP + 15 };
const STAGE_CANVAS_MIN = 107;
const STAGE_MIN_WIDTH = STAGE_CHROME.w + STAGE_CANVAS_MIN; // 109
const STAGE_MIN_HEIGHT = STAGE_CHROME.h + STAGE_CANVAS_MIN; // 160
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
  const g = clampedBox(desktop, win, {
    left: win.left,
    top: win.top,
    width: win.width,
    height: win.height,
  });
  if (win.resizable) {
    if (Number.isFinite(g.width)) win.width = g.width;
    if (Number.isFinite(g.height)) win.height = g.height;
  }
  win.left = g.left;
  win.top = g.top;
}

/**
 * The box clampWindow would write for `g` on `win`'s lattice — the same
 * arithmetic without the write, so a placement's target can be COMPUTED and
 * compared with where a window sits (arranged(), below) without touching
 * it. A non-resizable window's size passes through as given.
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {VfWindow} win
 * @param {{left?: number, top?: number, width?: number, height?: number}} g
 */
export function clampedBox(desktop, win, g) {
  const k = systemPxQuantum(win);
  const down = (v) => Math.floor(v / k) * k;
  const up = (v) => Math.ceil(v / k) * k;
  const minTop = up(TOP_RESERVE);
  let { width, height } = g;
  if (win.resizable) {
    if (Number.isFinite(width)) width = Math.min(width, down(desktop.width));
    if (Number.isFinite(height))
      height = Math.min(height, down(Math.max(0, desktop.height - minTop)));
  }
  const w = width ?? 0;
  const h = height ?? 0;
  const left = clamp(snapSys(g.left ?? 0, win), 0, Math.max(0, down(desktop.width - w)));
  const top = clamp(
    snapSys(g.top ?? minTop, win),
    minTop,
    Math.max(minTop, down(desktop.height - h))
  );
  return { left, top, width, height };
}

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 */
export function initWindows(desktop) {
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
  // stays authored in index.html and feeds the math. The strip's inputs
  // (its view count and tile size) are a DOCUMENT's settings: the served
  // document's by default (state/ring.js's façade), or — for the doc box of
  // a window being opened — the settings of the document it is opened for,
  // since the open activates it and the strip follows.
  const ringShown = () => prefs.get().showRing;
  /** @param {{views: number, size: number}} [r]  the strip's settings */
  const smartLayout = (r = ring.get()) =>
    initialPlacement(
      desktop.width,
      desktop.height,
      {
        width: byId.tools.width ?? 0,
        height: byId.tools.height ?? 0,
      },
      { ringViews: r.views, ringSize: r.size, ringShown: ringShown() }
    );

  // --- the Full Sprite View's fixed size ---------------------------------------
  // The windoid is a fixed-size picture frame — no grow box (not `resizable`
  // in the markup): its width is the atlas grid block's (SPRITE_WIDTH) and
  // its height is DERIVED so the 3×2 face-tile grid exactly fills the body
  // below the picker strip — no margins. The ratio is the ACTIVE document's
  // own TILE (square for every square-tile sheet — it differs only for a
  // dropped non-square one), defaulting to square before a document is
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
  // That is the rule for a strip ON SCREEN. The size is a document's
  // setting (state/ring-settings.js), so a change also arrives with a
  // document SWITCH — and, at boot or from the Finder role, behind a strip
  // that is HIDDEN (the activation wire writes the workspace mirror before
  // the app-active one, so the switch lands here while the strip is still
  // off screen — the boot placement having run before any document
  // existed, at the defaults). A hidden strip has nothing on screen to
  // hold, so a height change behind it RE-RUNS ITS PLACEMENT instead: the
  // show — or the boot — finds it docked at the height this document's
  // tile derives, the way a placement always would, rather than hanging
  // off the margin by a size the user never typed. (Hidden by its own
  // toggle and unchanged in size, it comes back exactly where it was.)
  const floorRingWidth = () => {
    if ((byId.ring.width ?? 0) < RING_MIN_WIDTH) byId.ring.width = RING_MIN_WIDTH;
  };
  /** The rect, restated whenever the height derivation moves. (The
   *  window's header height — the controls strip, RING_STRIP — is authored
   *  in the markup as `header-height`, the kit's grammar; the chrome
   *  arithmetic ringHeightFor counts the same 63 — change one, change the
   *  other.) */
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
  /** The layout signal (onLayout below): told after every geometry write
   *  this module makes — a placement, a re-fit, a re-pin, a zoom, the
   *  window set changing — and after every gesture it hears (a drag's
   *  release, a grow's commit). Each application re-derives its View
   *  menu's ⌘J item on it (arranged()). */
  const layoutListeners = new Set();
  const notifyLayout = () => {
    for (const fn of layoutListeners) fn();
  };

  // The placement is the geometry — no prior session's is consulted (see
  // the header): a windoid lands where THIS raster puts it. Run for all
  // four at boot and by arrange(). Every placement is a TARGET BOX first —
  // computed without touching the window (clampedBox: the boot clamp's own
  // arithmetic) — and then written (writeBox): arranged() below asks the
  // same targets whether arrange() would change anything, so the test and
  // the writes can't disagree.
  const windoidBox = (id, smart) => {
    const win = byId[id];
    const sm = smart[id];
    const g = { left: sm.left, top: sm.top, width: win.width, height: win.height };
    if ('width' in sm && win.resizable) {
      g.width = sm.width;
      g.height = sm.height;
    }
    if (id === 'stage') {
      g.width = Math.max(g.width ?? 0, STAGE_MIN_WIDTH);
      g.height = Math.max(g.height ?? 0, STAGE_MIN_HEIGHT);
    }
    // The sprite windoid's size and the ring's height are never authored
    // truth — always the derivations (the ring's placed width stands,
    // floored).
    if (id === 'sprite') {
      g.width = SPRITE_WIDTH;
      g.height = spriteHeightFor(SPRITE_WIDTH, spriteRatio());
    }
    if (id === 'ring') {
      g.height = ringHeightFor(ring.get().size);
      g.width = Math.max(g.width ?? 0, RING_MIN_WIDTH);
    }
    return clampedBox(desktop, win, g);
  };
  /** A placement's write: the target box onto the window, its pin record
   *  dropped (the next raster resize reads the pin from the placed
   *  geometry). A size the target leaves undefined (the Tools palette's
   *  content-hugging one) stays the window's. */
  const writeBox = (win, g) => {
    win.left = g.left;
    win.top = g.top;
    if (Number.isFinite(g.width)) win.width = g.width;
    if (Number.isFinite(g.height)) win.height = g.height;
    pins.delete(win);
  };
  const placeWindoid = (id, smart) => {
    writeBox(byId[id], windoidBox(id, smart));
    if (id === 'ring') declareRingRect(ringHeightFor(ring.get().size));
  };
  const placeUtility = () => {
    const smart = smartLayout();
    for (const id of WINDOW_IDS) placeWindoid(id, smart);
  };
  // Panel windows adopted from outside (see the header), each with the
  // pure placement that puts it on a raster — `(desktopW, desktopH) → box`
  // — the application it belongs to (what the bar shows while it holds
  // active; the Finder when the owner declared none) and, for a panel with
  // a zoom box, its expanded box on a raster, the same pure shape (null
  // for none).
  /** @type {Map<VfWindow, {boxFor: (w: number, h: number) => {left: number, top: number, width: number, height: number}, app: import('../state/shell.js').AppId, expanded: ((w: number, h: number) => {left: number, top: number, width: number, height: number}) | null}>} */
  const panels = new Map();
  const panelBox = (win) => {
    const boxFor = panels.get(win)?.boxFor;
    return boxFor
      ? clampedBox(desktop, win, boxFor(desktop.width, desktop.height))
      : null;
  };
  const placePanel = (win) => {
    const g = panelBox(win);
    if (g) writeBox(win, g);
  };
  // A document window onto cascade slot `slot` of the CURRENT raster's doc
  // box, at the box's size: arrange().
  const docBox = (win, smart, slot) => {
    const d = smart.doc;
    return clampedBox(desktop, win, {
      ...cascadeSlot(d, slot),
      width: d.width,
      height: d.height,
    });
  };
  const placeDoc = (win, slot) => writeBox(win, docBox(win, smartLayout(), slot));
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
  // for the chrome arithmetic.)
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
        if ((byId.sprite.height ?? 0) !== spriteHeightFor(SPRITE_WIDTH, spriteRatio())) {
          fitSprite();
          notifyLayout();
        }
      };
      const un = ctx.doc.subscribe(refit);
      refit();
      return un;
    })
  );

  // The tile size changes the ring's height: shown, re-fit — the top-left
  // held, the bottom edge the one that moves (see fitRing); hidden,
  // re-placed (see the same comment) — guarded on the computed height so a
  // settings change that leaves it (views, elevation, offset) writes
  // nothing (the sprite refit's idiom). The view count no longer touches
  // the window — a longer row scrolls under the rail.
  unsubs.push(
    ring.subscribe(() => {
      if ((byId.ring.height ?? 0) !== ringHeightFor(ring.get().size)) {
        if (byId.ring.hidden) placeWindoid('ring', smartLayout());
        else fitRing();
      }
      // The placement's inputs moved (the strip's box, the doc box behind
      // a shown strip) whether or not the window did.
      notifyLayout();
    })
  );

  // --- utility visibility: appActive -> hidden ---------------------------------
  // A windoid belongs to the application, so it is on screen exactly while
  // the app is active; the 3D Sprite Atlas needs its own toggle on as well,
  // and a show (the flag flipping it onto the screen) raises it to the front
  // of the windoid band — see the header.
  let ringWasShown = false;
  const syncUtility = () => {
    const { appActive } = shell.get();
    for (const id of WINDOW_IDS) {
      const shown = appActive && (id !== 'ring' || ringShown());
      byId[id].hidden = !shown;
    }
    const ringNow = !byId.ring.hidden;
    if (ringNow && !ringWasShown) desktop.bringToFront(byId.ring);
    ringWasShown = ringNow;
    // What is on screen changed (and, with the strip, the doc box the
    // placement would write).
    notifyLayout();
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
    // the CURRENT raster (the desktop may have resized since boot) and THIS
    // document's atlas settings (the strip's band, while shown, is the
    // height its tile derives — the open activates the document and the
    // strip follows it), cascaded into the first slot no open document
    // window holds — never a remembered geometry (see the header). Saved
    // and untitled documents place alike.
    const d = smartLayout(ctx.ring.get()).doc;
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
    notifyLayout(); // the window set (a new window placed, a closed one gone)
  };
  unsubs.push(workspace.subscribe(syncDocs));
  syncDocs(); // HMR: rebuild windows for contexts that survived the reload

  // --- app activation: desktop -> the two mirrors -------------------------------
  // This wire is the single writer of both shell.frontApp (which
  // application, with appActive its shadow) and workspace.activeKey (which
  // document): desktop.activeWindow read once at wire-up, then vf-activate
  // (a document-tier window, or null) per change.
  const keyOf = (win) => {
    for (const [key, rec] of byKey) if (rec.win === win) return key;
    return null;
  };
  const applyActive = (win) => {
    const key = win ? keyOf(win) : null;
    workspace.setActive(key);
    // The front application is a reading of the active window (the
    // header's APP ACTIVATION): a document window is the Sprite Editor's, a
    // panel its declared owner's, nothing — or a panel that declared none —
    // the Finder's.
    shell.setFrontApp(
      key != null ? SPRITE_EDITOR : (win && panels.get(win)?.app) || FINDER
    );
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
  // own surface is exactly `target === desktop`: this listener sits on the
  // host, so a press inside its shadow tree retargets to the host itself,
  // while a press in any slotted child — a window, the menu bar, the options
  // strip, a dialog, the desktop's icon FIELD — arrives as that child and
  // misses the test. Since the field fills the screen (a vf-icon-field,
  // 0.7.0 — the rubber band needs a surface), the dither's presses land on
  // it, and this test covers the bezel alone; the field's own "this press
  // is the Finder" case lives in shell/icons.js, calling the same
  // clearActive(). A press in a folder window needs neither: the window
  // activates itself, and a panel active IS its application's turn
  // (applyActive).
  const onDesktopPress = (e) => {
    if (e.target === desktop) desktop.clearActive();
  };
  desktop.addEventListener('pointerdown', onDesktopPress);
  unsubs.push(() => desktop.removeEventListener('pointerdown', onDesktopPress));

  // --- close boxes ------------------------------------------------------------
  // A window's close box fires vf-close on the window itself (dialog closes
  // have a non-window target and pass through). Document windows carry one
  // — it routes through the dirty-checking flow the Sprite Editor injects —
  // and so does the 3D Sprite Atlas windoid alone among the windoids: its
  // close is the View menu's uncheck, one truth (prefs.showRing).
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
    // An EXPANDED panel (a read-me at its zoom box's column, read the
    // click's way — near the box on the raster it sat on) stays expanded:
    // the box re-derives on the new raster instead of pinning, so the
    // column keeps its pads and its center and the next click still reads
    // it expanded. writeBox drops the pin record, so the resize after a
    // move away from the column reads a fresh pin.
    const expanded = panels.get(win)?.expanded;
    if (expanded && nearBox(cur, expanded(before.width, before.height))) {
      const g = expanded(after.width, after.height);
      writeBox(win, { ...g, left: snapSys(g.left, win), top: snapSys(g.top, win) });
      return;
    }
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
  /** A remembered pin re-expressed on the CURRENT raster by the resize
   *  rule's policy for `win`, then clamped on like every placement — where
   *  a browser resize would have carried the box, on screen. A folder
   *  window's reopen (addPanel) and a panel's restore from its expanded box
   *  (expandToggle) land through it. */
  const pinnedBox = (win, pin) =>
    clampedBox(
      desktop,
      win,
      pinTo(
        pin,
        { width: desktop.width, height: desktop.height },
        WINDOW_FRAME,
        policyOf(win, {
          left: win.left ?? 0,
          top: win.top ?? 0,
          width: win.width ?? 0,
          height: win.height ?? 0,
        })
      )
    );

  const api = {
    byId,
    /** Injected by the Sprite Editor (apps/sprite-editor): the
     *  dirty-checking close flow, per context key. */
    onDocumentClose: null,
    /** Make a document window the active one (which also reactivates the
     *  application — bringToFront fires vf-activate). */
    activateContext(key) {
      const rec = byKey.get(key);
      if (!rec) return;
      desktop.bringToFront(rec.win);
    },
    /** The window element a context lives in, or null. */
    winFor(key) {
      return byKey.get(key)?.win ?? null;
    },
    /** View → Arrange Windows: the boot placement, re-run on the CURRENT
     *  raster over every window — the windoids back to the rail at their
     *  placed sizes, every open document window onto the doc box at its
     *  size, cascaded in STACKING order (the desktop keeps DOM order in
     *  step with z-order: bottom-most first, so the front window tops the
     *  cascade; a sixth and beyond wrap, as an open would). The one way to
     *  get the arrangement back after moving things around or resizing the
     *  browser. From the Finder role with a document open it also re-rails
     *  the hidden windoids, ready for the next open (each application
     *  greys its item while arranged() reads true — nothing to arrange).
     *  Positions only: nothing activates or re-stacks. */
    arrange() {
      placeUtility();
      let slot = 0;
      for (const el of desktop.querySelectorAll(':scope > vf-window')) {
        const win = /** @type {VfWindow} */ (el);
        if (keyOf(win) != null) placeDoc(win, slot++);
      }
      // A panel goes back where its placement puts it on this raster too.
      for (const win of panels.keys()) placePanel(win);
      notifyLayout();
    },
    /** Is the screen the arrangement? Every visible window's live box
     *  against the box its placement would write on the current raster —
     *  the very targets arrange() writes (windoidBox / docBox / panelBox,
     *  the clamp included), so the test and the writes can't disagree.
     *  Deliberately loose in four places. HIDDEN windows don't count (the
     *  Finder role's windoids) — the test is what the
     *  user sees, so a hidden strip re-fit behind the Export dialog never
     *  makes the item "Arrange" over a screen that looks arranged. Nor
     *  does the 3D Sprite Atlas strip's WIDTH: content, the user's (a
     *  grow-box drag, the spring of a browser resize — layout.js's "mixed
     *  box"); arrange() still re-seeds it, but a strip at its dock at its
     *  derived height is an arranged strip whatever its width. Nor WHICH
     *  document sits on WHICH cascade slot: the documents must fill the
     *  cascade's first n slots as a set, one each, but a permutation is
     *  stacking bookkeeping — arrange() cascades in stacking order, so a
     *  raise alone (a click on the upper-left of two) would otherwise turn
     *  the item to Arrange over two windows plainly on the cascade, and
     *  the chord would SWAP them rather than zoom. And the ACTIVE document
     *  window may sit ZOOMED from its slot (the zoom box's own box for that
     *  top-left, zoomBoxFor): its zoom is part of the arranged reading, so
     *  the item's value stays `zoom` and the next ⌘J restores that one
     *  window — an arrange there would re-cascade and swap. The Sprite
     *  Editor's ⌘J item carries the value `arrange` while this reads false
     *  and `zoom` while it reads true (apps/sprite-editor); its label never
     *  turns. */
    arranged() {
      const KEYS = /** @type {const} */ (['left', 'top', 'width', 'height']);
      /** @param {VfWindow} win */
      const liveOf = (win) => ({
        left: win.left,
        top: win.top,
        width: win.width,
        height: win.height,
      });
      /** @param {VfWindow} win @param {ReturnType<typeof clampedBox>} g @param {readonly string[]} [skip] */
      const at = (win, g, skip = []) => {
        const live = liveOf(win);
        return KEYS.every(
          (k) => skip.includes(k) || !Number.isFinite(g[k]) || (live[k] ?? 0) === g[k]
        );
      };
      const smart = smartLayout();
      for (const id of WINDOW_IDS) {
        const win = byId[id];
        if (win.hidden) continue;
        if (!at(win, windoidBox(id, smart), id === 'ring' ? ['width'] : [])) return false;
      }
      // The documents: the cascade's first n slots (n every document
      // window, hidden ones included — each holds a slot in arrange()) as
      // a pool, every visible window claiming a distinct one — at the doc
      // box's size, or, the active window, at its zoom box's.
      const docs = [...desktop.querySelectorAll(':scope > vf-window')]
        .map((el) => /** @type {VfWindow} */ (el))
        .filter((win) => keyOf(win) != null);
      const activeKey = workspace.get().activeKey;
      const activeWin = activeKey != null ? (byKey.get(activeKey)?.win ?? null) : null;
      /** @type {(ReturnType<typeof clampedBox> | null)[]} */
      const pool = docs.map((win, i) => docBox(win, smart, i));
      for (const win of docs) {
        if (win.hidden) continue;
        const live = liveOf(win);
        const z = win === activeWin ? zoomBoxFor(win) : null;
        const i = pool.findIndex(
          (g) =>
            g != null &&
            live.left === g.left &&
            live.top === g.top &&
            ((live.width === g.width && live.height === g.height) ||
              (z != null && live.width === z.width && live.height === z.height))
        );
        if (i < 0) return false;
        pool[i] = null;
      }
      for (const win of panels.keys()) {
        const g = panelBox(win);
        if (g && !win.hidden && !at(win, g)) return false;
      }
      return true;
    },
    /** ⌘J's other half (the Sprite Editor's, once everything is arranged):
     *  the ACTIVE document window through the zoom box's own toggle
     *  (zoomToggle below — from the slot it sits on to the vacancy's edges,
     *  top-left held, and back). A window zoomed from its slot still reads
     *  arranged (above), so the item's value stays `zoom` and repeats
     *  toggle that one window while nothing else moves. Nothing without an
     *  active document window (another application front — its own ⌘J
     *  item is the arrange alone). */
    zoomActive() {
      const key = workspace.get().activeKey;
      const win = key != null ? byKey.get(key)?.win : null;
      if (!win) return;
      zoomToggle(win);
      notifyLayout();
    },
    /** Subscribe to the layout signal (see notifyLayout); returns the
     *  unsubscribe. */
    onLayout(fn) {
      layoutListeners.add(fn);
      return () => {
        layoutListeners.delete(fn);
      };
    },
    /** Adopt a PANEL window (see the header): `boxFor` is its pure placement
     *  on a raster — applied by arrange(), read by arranged(), and the
     *  open's box (+ the boot clamp) unless `pin` is given: a folder
     *  window's remembered nine-slice pin (shell/folders.js — windowPin
     *  below read it where the window sat, on the raster it sat on), which
     *  the open re-expresses on THIS raster by the resize rule's own policy
     *  for the window (pinTo + policyOf: a resizable window's edges
     *  independent, floored at its grow floor) and clamps onto it like
     *  every placement (the boot clamp — the one path that pulls a window
     *  on-raster; the live re-pin never does), so a reopened window lands
     *  exactly where a browser resize would have carried it had it stayed
     *  open, on screen. Either way the re-pin moves it on every raster
     *  resize from there, and arrange() sends it to `boxFor`. `app` names
     *  the APPLICATION the panel belongs to — what the bar shows while the
     *  panel holds active (the header's APP ACTIVATION); undeclared, the
     *  Finder. `expanded` is its ZOOM BOX, when it has one: the expanded
     *  box on a raster, `boxFor`'s pure shape (onZoom below — the owner's
     *  template declares `zoomable`). The window must already be a slotted
     *  child of the desktop
     *  (the clamp reads its live lattice); if the kit has already made it
     *  the active window, the declaration re-reads the mirror, so the
     *  front application is right whichever order the owner appends,
     *  adopts and raises in.
     *  @param {VfWindow} win
     *  @param {(w: number, h: number) => {left: number, top: number, width: number, height: number}} boxFor
     *  @param {import('./layout.js').Pin | null} [pin]
     *  @param {{app?: import('../state/shell.js').AppId, expanded?: (w: number, h: number) => {left: number, top: number, width: number, height: number}}} [opts] */
    addPanel(win, boxFor, pin = null, { app = FINDER, expanded } = {}) {
      panels.set(win, { boxFor, app, expanded: expanded ?? null });
      if (desktop.activeWindow === win) applyActive(win);
      if (pin) {
        writeBox(win, pinnedBox(win, pin));
      } else {
        placePanel(win);
      }
      notifyLayout();
    },
    /** A window's nine-slice pin where it sits, on the current raster, in
     *  the frame the resize rule reads it in — what shell/folders.js
     *  persists for a folder window: a pin, not a box, so the record is
     *  relative terms (each edge a strut's offset from the raster's edge or
     *  a spring's fraction of its middle) that any later raster can
     *  re-express (addPanel). Read fresh from the live box: on the same
     *  raster the pin maps back exactly, and the cache above is a guard
     *  against ratcheting across a long resize drag, not a different
     *  truth. */
    windowPin(win) {
      return pinOf(
        {
          left: win.left ?? 0,
          top: win.top ?? 0,
          width: win.width ?? 0,
          height: win.height ?? 0,
        },
        { width: desktop.width, height: desktop.height },
        WINDOW_FRAME
      );
    },
    /** Drop a panel from the placement + re-pin set (the owner removes the
     *  node). */
    removePanel(win) {
      panels.delete(win);
      pins.delete(win);
      notifyLayout();
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
      notifyLayout();
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
      desktop.removeEventListener('vf-resize', onGrow);
      desktop.removeEventListener('pointerup', onRelease);
      desktop.removeEventListener('pointercancel', onRelease);
      layoutListeners.clear();
      // HMR: leave the windows standing — the re-init's syncDocs adopts…
      // it cannot: the fresh Map starts empty and would double them. Remove
      // and let the next init rebuild from the surviving workspace state.
      for (const [, rec] of byKey) rec.win.remove();
      byKey.clear();
      panels.clear(); // the owners (patterns, folders, texts) remove their nodes
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
  /** The zoom box's target for `win` where it sits: the vacancy's edges
   *  from its top-left (layout.js zoomedBox). A shown 3D Sprite Atlas
   *  strip is a boundary the zoom respects (the doc box leaves it the
   *  same room). Shared by the toggle and arranged()'s reading of a
   *  zoomed active window. */
  const zoomBoxFor = (win) =>
    zoomedBox(
      desktop.width,
      desktop.height,
      { left: win.left ?? 0, top: win.top ?? 0 },
      { ringShown: ringShown(), ringSize: ring.get().size }
    );
  /** The toggle itself — the zoom box's click and ⌘J's zoom half
   *  (zoomActive) share it. */
  const zoomToggle = (win) => {
    const z = zoomBoxFor(win);
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
  // A PANEL's zoom box — the text windows', whose owner declares the
  // expanded box at adoption (layout.js expandedTextBox, a reading
  // column) — is System 7's standard-state / user-state toggle with the
  // state READ at the click, never kept: a window whose every edge sits
  // near the expanded box on the live raster (layout.js nearBox — a
  // lattice snap or a nudge off still counts) goes back to what it had,
  // and any other goes to the expanded box. The expanded box MOVES the
  // window as well as sizing it, so what the expand records is the whole
  // box — as its nine-slice pin on the raster it sat on (a folder window's
  // remembered-box discipline), so the restore lands where a browser
  // resize would have carried the window had it never expanded, on
  // screen (pinnedBox). With nothing recorded — a window grown by hand
  // onto the column, a record already spent — the panel's own placement
  // is the fallback: its authored size at the slot it opened on, where
  // Arrange Windows sends it. The expanded box pads from the menu bar,
  // above the windows' reserve (the options strip is hidden while the
  // panel's application is front), so its write snaps onto the lattice
  // and never clamps; a browser resize keeps it expanded (repin).
  /** Pre-expand pins, per panel — recorded by the expand, spent by the
   *  restore (zoomMemory's discipline). */
  const expandMemory = new WeakMap();
  const expandToggle = (win) => {
    const expanded = panels.get(win)?.expanded;
    if (!expanded) return;
    const raster = { width: desktop.width, height: desktop.height };
    const cur = {
      left: win.left ?? 0,
      top: win.top ?? 0,
      width: win.width ?? 0,
      height: win.height ?? 0,
    };
    const target = expanded(raster.width, raster.height);
    if (nearBox(cur, target)) {
      const pin = expandMemory.get(win);
      expandMemory.delete(win);
      const back = pin ? pinnedBox(win, pin) : panelBox(win);
      if (back) writeBox(win, back);
    } else {
      expandMemory.set(win, pinOf(cur, raster, WINDOW_FRAME));
      writeBox(win, {
        ...target,
        left: snapSys(target.left, win),
        top: snapSys(target.top, win),
      });
    }
  };
  const onZoom = (e) => {
    const win = e.target;
    if (!(win instanceof VfWindow)) return;
    if (keyOf(win) != null) zoomToggle(win);
    else if (panels.get(win)?.expanded) expandToggle(win);
    else return;
    notifyLayout();
  };
  desktop.addEventListener('vf-zoom', onZoom);

  // --- the gestures the layout signal hears ---------------------------------------
  // A title-bar drag fires nothing of its own (the kit's position: a move
  // is the window's own business), so its release — a pointerup anywhere
  // on the desktop, read a task later so the kit's own settle has landed —
  // stands in; a grow box's drag fires vf-resize, and its `commit` is the
  // gesture settling. Either just re-derives the View menus' ⌘J readouts
  // (the applications') — cheap, and a release that moved nothing changes
  // nothing.
  const onRelease = () => {
    setTimeout(notifyLayout, 0);
  };
  const onGrow = (e) => {
    if (/** @type {CustomEvent} */ (e).detail?.commit) notifyLayout();
  };
  desktop.addEventListener('vf-resize', onGrow);
  desktop.addEventListener('pointerup', onRelease);
  desktop.addEventListener('pointercancel', onRelease);

  return api;
}
