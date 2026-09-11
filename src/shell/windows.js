// ---------------------------------------------------------------------------
// The WINDOW MANAGER — the page's share of System 7's Window Manager
// (docs/app-windows-plan.md). It runs every window on the desktop and knows
// nothing about any of them but what their owners declare. The kit
// (vf-desktop, vf-window) is the mechanics: stacking, activation, the drag,
// the grow box within a size rect, the close and zoom boxes' clicks
// reported on the window (vf-close, vf-zoom — the OWNER listens on its own
// windows and decides what they mean). Each application (src/apps/<id>/)
// owns its windows: their markup, lifecycle, content, placement and sizes,
// what their close and zoom boxes mean, when its palettes show, and how
// they arrange as a group. What lives here is what every window obeys,
// whoever owns it — and the primitives an owner builds its own gestures
// from:
//
//   ADOPTION. Every window enters through ONE call, adopt(), with its
//   owner's declarations — the page-side half of a WIND resource: the
//   APPLICATION it belongs to (`app`); its pure placement on a raster
//   (`place`), which arrange() re-applies and arranged() reads; a
//   remembered pin to open at instead (`pin` — re-expressed on the raster
//   of the moment by the resize rule's own policy, then clamped on, so a
//   reopened window lands where a browser resize would have carried it had
//   it stayed open); its resize policy (`policy`); a box it keeps across a
//   browser resize (`keep`); and the catalog item it shows (`item` —
//   isOpen and onWindows, an icon's open ghost). The owner appends and
//   removes the node, releasing it here first. A window's geometry is never
//   persisted here: an owner that remembers a box remembers its pin (pinOf)
//   and hands it back at adoption.
//
//   THE FRONT APPLICATION has one writer: the desktop's vf-activate event
//   (the kit fires it on every change of active document-tier window, null
//   included) lands here and is read into shell.frontApp — with its boolean
//   shadow appActive, in the same patch: the active window's declared
//   application, or the FINDER — the desktop's application and the default
//   — for no active window or one that declares nothing. Every beforeFront
//   listener hears the newly active window first, so an owner's own mirror
//   of which of its windows is active lands before the front application
//   does — while that owner's palettes are still hidden. The reading
//   initializes by READING the kit's truth (desktop.activeWindow — null on
//   a fresh boot), never from a constant. Deactivation is interaction-only,
//   and the PAGE owns the press test (the kit's 0.4.0 position: only the
//   page knows which presses mean "the Finder"): a press on the desktop's
//   bezel — wired here — or in the Finder's icon field (its own wire)
//   routes through desktop.clearActive(); the kit adds its own null when
//   the last document-tier window leaves.
//
//   THE RESIZE RULE. When the raster RESIZES (main.js re-fits it per
//   browser-resize event and calls onDesktopResized) ONE rule moves every
//   adopted window, placed or dragged alike: the NINE-SLICE pin
//   (shell/layout.js pinOf / pinTo — the open area below the options strip
//   cut into a ring of outer bands around a middle that grows and shrinks;
//   an edge in a band is a strut, an edge in the middle a spring), in ONE
//   frame for every window, whose top and right bands an application may
//   widen to hold its furniture (setFrameBands). Live and un-debounced,
//   deliberately WITHOUT the boot clamp: reversibility over visibility (see
//   onDesktopResized). The raster's signal (onRaster) carries the change on
//   to what else re-pins with the windows — the desktop's icons.
//
//   ARRANGE WINDOWS is a composition: arrange() runs every application's
//   ARRANGEMENT GROUP (arrangeWith — windows that arrange together by rules
//   of their owner's) and writes every window adopted with a `place`;
//   arranged() asks every group and checks every visible `place`-adopted
//   window against the box its placement would write. Every placement is a
//   computed TARGET box (clampedBox, the boot clamp's arithmetic) before it
//   is a write, so the test and the writes share one arithmetic. Each
//   application's View menu greys its ⌘J item while arranged() reads true,
//   re-deriving on the LAYOUT SIGNAL (onLayout): told after every geometry
//   write this module makes, every gesture it hears (a drag's release, a
//   grow's commit), and every change an owner reports of its own
//   (layoutChanged).
// ---------------------------------------------------------------------------

import { snapSys, systemPxQuantum, VfWindow } from 'vintage-frames';
import { shell, FINDER } from '../state/shell.js';
import { nearBox, pinOf, pinTo, TOP_RESERVE, windowFrame } from './layout.js';

// The kit's own grow floor (vf-window's MIN_WIDTH × MIN_HEIGHT — not
// exported, restated): the floor a resizable window re-pins against unless
// its owner declares a policy of its own, so a resize can never leave one
// smaller than its grow box could.
const KIT_MIN_WIDTH = 80;
const KIT_MIN_HEIGHT = 54;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** A window's live box, an undeclared edge read as 0.
 *  @param {VfWindow} win */
const boxOf = (win) => ({
  left: win.left ?? 0,
  top: win.top ?? 0,
  width: win.width ?? 0,
  height: win.height ?? 0,
});

/**
 * The box a placement writes for `g` on `win`: its position pulled onto the
 * live raster, on the same k-system-px lattice a drag lands on
 * (system7web's centerWindow rule, minus the centering — placed positions
 * are kept, just pulled on-canvas: a cascaded window near the raster's
 * edge, a placement's size floors on a tiny raster). A RESIZABLE window's
 * size clamps to the open area first: bigger than it, the grow-box corner
 * is unreachable at ANY position (the title bar can't leave the raster
 * upward), so an oversize box shrinks to a workable one. A non-resizable
 * window's size passes through as given. Computed, not written — so a
 * placement's target can be compared with where a window sits (arranged())
 * without touching it.
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
 * An application's window markup — its windows.html, imported whole (?raw)
 * — parsed into nodes of THIS document: a detached element's innerHTML (the
 * menus' parse, shell/menu-bar.js), every custom element upgraded, so a
 * window authored bare takes its properties before it is appended, while a
 * <template>'s content stays inert until cloneWindow takes it. Returns the
 * host to query.
 * @param {string} html
 * @returns {HTMLElement}
 */
export function parseWindows(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  customElements.upgrade(host);
  return host;
}

/**
 * A window cloned from its template, ready for its owner's properties.
 * importNode, NOT cloneNode: template content lives in an inert
 * ownerDocument, and a bare clone stays there — where
 * customElements.upgrade() silently no-ops (wrong document), leaving the
 * window's components un-upgraded until the append. A property set on an
 * un-upgraded element is captured by Lit and restored only at its FIRST
 * UPDATE — after connectedCallback, where a component wires what the
 * property feeds (a document window's editor, its context) — so the clone
 * is imported into THIS document and upgraded NOW: a property set is an
 * ordinary one, and the window's declared width/height are readable before
 * the append.
 * @param {HTMLTemplateElement} tpl
 * @returns {VfWindow}
 */
export function cloneWindow(tpl) {
  const win = /** @type {VfWindow} */ (
    document.importNode(/** @type {Element} */ (tpl.content.firstElementChild), true)
  );
  customElements.upgrade(win);
  return win;
}

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 */
export function initWindows(desktop) {
  /** @type {(() => void)[]} */
  const unsubs = [];
  const raster = () => ({ width: desktop.width, height: desktop.height });

  // --- the adopted windows and the arrangement groups ----------------------------
  // Each adopted window with its owner's declarations (adopt below): the
  // application it belongs to (what the bar shows while it holds active;
  // the Finder when the owner declared none), its pure placement on a
  // raster (`(desktopW, desktopH) → box`, or null — its owner places it),
  // its resize policy (null: the default, policyOf), a box it keeps across
  // a resize (the same pure shape, or null), and the catalog item it shows
  // (an icon's key, or null).
  /** @typedef {{left: number, top: number, width: number, height: number}} Box */
  /** @typedef {{
   *   app: import('../state/shell.js').AppId,
   *   place: ((w: number, h: number) => Box) | null,
   *   policy: ((cur: Box) => import('./layout.js').Policy) | null,
   *   keep: ((w: number, h: number) => Box) | null,
   *   item: string | null,
   * }} Adoption */
  /** @type {Map<VfWindow, Adoption>} */
  const adopted = new Map();
  /** An application's arrangement group (arrangeWith below): its own
   *  arrange, and its own reading of whether its windows sit arranged.
   *  @typedef {{arrange(): void, arranged(): boolean}} Group */
  /** @type {Map<import('../state/shell.js').AppId, Group>} */
  const groups = new Map();
  /** Per-window nine-slice pin across raster resizes: the unrounded pin
   *  (shell/layout.js) plus the geometry this path last applied — a
   *  mismatch there means someone else moved or resized the window (a
   *  drag, a grow, a placement), so its pin re-derives. See
   *  onDesktopResized. A placement drops the record outright: the next
   *  resize reads the pin from the placed geometry. */
  let pins = new WeakMap();
  /** The windows' frame the resize rule reads every pin in (layout.js
   *  windowFrame): ONE frame for every window, BAND thick but for the two
   *  bands an application widens for its furniture (setFrameBands). */
  let frame = windowFrame();

  // --- the signals ----------------------------------------------------------------
  /** The layout signal (onLayout below): told after every geometry write
   *  this module makes — a placement, a re-pin, the window set changing —
   *  after every gesture it hears (a drag's release, a grow's commit), and
   *  on every change an owner reports (layoutChanged). Each application
   *  re-derives its View menu's ⌘J item on it (arranged()). Held while
   *  arrange() writes, which tells it once. */
  const layoutListeners = new Set();
  let holding = false;
  const notifyLayout = () => {
    if (holding) return;
    for (const fn of [...layoutListeners]) fn();
  };
  /** The window set's signal (onWindows below): told when a window showing
   *  a catalog item (adopt's `item`) comes or goes — the icons' open
   *  ghost. */
  const windowListeners = new Set();
  const notifyWindows = () => {
    for (const fn of [...windowListeners]) fn();
  };
  /** The raster's signal (onRaster below): told `(before, after)` once
   *  every window has re-pinned to a new raster size — the desktop icons'
   *  re-pin rides it.
   *  @type {Set<(before: {width: number, height: number}, after: {width: number, height: number}) => void>} */
  const rasterListeners = new Set();
  /** The activation's first ear (beforeFront below): each hears the newly
   *  active window, or null, before the front application is written.
   *  @type {Set<(win: HTMLElement | null) => void>} */
  const frontListeners = new Set();

  // --- placement --------------------------------------------------------------------
  /** A placement's write: the target box onto the window — its top-left
   *  snapped onto the window's lattice (a no-op on a clamped target, which
   *  is already on it) — its pin record dropped (the next raster resize
   *  reads the pin from the placed geometry). A size the target leaves
   *  undefined (a content-hugging window's) stays the window's. */
  const writeBox = (win, g) => {
    win.left = snapSys(g.left, win);
    win.top = snapSys(g.top, win);
    if (Number.isFinite(g.width)) win.width = g.width;
    if (Number.isFinite(g.height)) win.height = g.height;
    pins.delete(win);
  };
  /** An adopted window's placement on the live raster, clamped — the box
   *  arrange() writes and arranged() reads — or null (none declared). */
  const placedBox = (win) => {
    const place = adopted.get(win)?.place;
    return place ? clampedBox(desktop, win, place(desktop.width, desktop.height)) : null;
  };
  const placeAdopted = (win) => {
    const g = placedBox(win);
    if (g) writeBox(win, g);
  };
  /** The resize rule's policy for `win` at its live box `cur`: its owner's
   *  declaration (adopt's `policy`), else the default — a resizable window
   *  floors at the kit's grow floor, a fixed-size one resolves at its live
   *  size. Applied on the re-pin itself (layout.js pinTo): a declared size
   *  rect bounds the grow box alone, so this path floors its own
   *  programmatic writes (a floor applied afterwards would read as a
   *  "touch" on the next event and re-derive the pin from the floored
   *  geometry — a drift). */
  const policyOf = (win, cur) => {
    const declared = adopted.get(win)?.policy;
    if (declared) return declared(cur);
    return win.resizable
      ? { min: { width: KIT_MIN_WIDTH, height: KIT_MIN_HEIGHT } }
      : { size: { width: cur.width, height: cur.height } };
  };
  /** A remembered pin re-expressed on the CURRENT raster by the resize
   *  rule's policy for `win`, then clamped on like every placement — where
   *  a browser resize would have carried the box, on screen (fromPin). */
  const pinnedBox = (win, pin) =>
    clampedBox(desktop, win, pinTo(pin, raster(), frame, policyOf(win, boxOf(win))));
  /** Does `win` sit exactly at `g` — every edge `g` states? */
  const at = (win, g) => {
    const live = boxOf(win);
    return ['left', 'top', 'width', 'height'].every(
      (k) => !Number.isFinite(g[k]) || live[k] === g[k]
    );
  };

  // --- the front application: desktop -> shell.frontApp -------------------------------
  // The one writer (the header): desktop.activeWindow read once at wire-up,
  // then vf-activate (a document-tier window, or null) per change — every
  // beforeFront listener first, the reading after.
  const applyActive = (win) => {
    for (const fn of [...frontListeners]) fn(win);
    shell.setFrontApp((win && adopted.get(win)?.app) || FINDER);
  };
  const onActivate = (e) => applyActive(/** @type {CustomEvent} */ (e).detail.window);
  desktop.addEventListener('vf-activate', onActivate);
  unsubs.push(() => desktop.removeEventListener('vf-activate', onActivate));
  // A reading initializes by reading its source, never from a constant:
  // whatever the desktop already holds active — null on a fresh boot, or
  // what an HMR teardown left — lands through the funnel the events use.
  applyActive(desktop.activeWindow);

  // --- deactivation: the page's press test --------------------------------------
  // The kit deliberately never decides which presses mean "the Finder" (its
  // furniture is slotted light DOM — only the page knows); the page owns the
  // test and routes the hits through clearActive(). A press on the desktop's
  // own surface is exactly `target === desktop`: this listener sits on the
  // host, so a press inside its shadow tree retargets to the host itself,
  // while a press in any slotted child — a window, the menu bar, the options
  // strip, a dialog, the desktop's icon FIELD — arrives as that child and
  // misses the test. Since the field fills the screen (a vf-icon-field — the
  // rubber band needs a surface), the dither's presses land on it, and this
  // test covers the bezel alone; the field's own "this press is the Finder"
  // case is the Finder's (apps/finder/icons.js), calling the same
  // clearActive(). A press in a window needs neither: the window activates
  // itself, and its declared application comes forward (applyActive).
  const onDesktopPress = (e) => {
    if (e.target === desktop) desktop.clearActive();
  };
  desktop.addEventListener('pointerdown', onDesktopPress);
  unsubs.push(() => desktop.removeEventListener('pointerdown', onDesktopPress));

  // --- the resize rule -----------------------------------------------------------------
  /** The window's pin re-expressed on the new raster — the whole of
   *  onDesktopResized per window (its doc comment is the contract). */
  const repin = (win, before, after) => {
    const cur = boxOf(win);
    // A window at its KEPT box (adopt's `keep` — read the owner's way: near
    // the box on the raster it sat on) keeps it: the box re-derives on the
    // new raster instead of pinning, so it keeps its own rules (a reading
    // column its pads and its center) and the owner's next reading still
    // finds the window there. writeBox drops the pin record, so the resize
    // after a move away from the box reads a fresh pin.
    const keep = adopted.get(win)?.keep;
    if (keep && nearBox(cur, keep(before.width, before.height))) {
      writeBox(win, keep(after.width, after.height));
      return;
    }
    let rec = pins.get(win);
    // Moved or resized since this path last wrote it — or never pinned: read
    // the pin from where it sits, on the raster it sat on. A non-resizable
    // window compares position only: its size is its owner's derivation (a
    // picture frame re-fit on a document switch), never a touch — its pin,
    // all struts, still describes it, and the anchor rule holds the near
    // edge. A resizable window whose size moved WAS touched (a grow, or an
    // owner's derived height held from the top-left): a pin read with its
    // far edge at the old offset would re-dock that edge on the next event
    // and jump the window, so the box is re-read where it sits.
    const sized =
      !!rec && win.resizable && (rec.width !== cur.width || rec.height !== cur.height);
    const moved = !rec || rec.left !== cur.left || rec.top !== cur.top || sized;
    if (moved) rec = { pin: pinOf(cur, before, frame) };
    const g = pinTo(rec.pin, after, frame, policyOf(win, cur));
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
  unsubs.push(() => {
    desktop.removeEventListener('vf-resize', onGrow);
    desktop.removeEventListener('pointerup', onRelease);
    desktop.removeEventListener('pointercancel', onRelease);
  });

  return {
    /** ADOPT a window (the header's ADOPTION): the one way a window an
     *  owner makes enters the manager, with the owner's declarations — the
     *  page-side half of a WIND resource:
     *    `app` — the APPLICATION it belongs to, what the bar shows while it
     *      holds active (the header's FRONT APPLICATION); undeclared, the
     *      Finder.
     *    `place` — its pure placement on a raster, `(desktopW, desktopH) →
     *      box`: the open's box (+ the boot clamp) unless `pin` is given,
     *      re-applied by arrange(), read by arranged(). Without one the
     *      owner places the window itself (and arranges it in its group).
     *    `pin` — a remembered nine-slice pin (pinOf below read it where the
     *      window sat, on the raster it sat on), which the open re-expresses
     *      on THIS raster by the resize rule's own policy for the window and
     *      clamps onto it like every placement (fromPin — the boot clamp,
     *      the one path that pulls a window on-raster; the live re-pin
     *      never does), so a reopened window lands exactly where a browser
     *      resize would have carried it had it stayed open, on screen.
     *    `policy` — the resize rule's policy for it, `(cur) → {size, min}`
     *      per axis (layout.js pinTo); undeclared, a resizable window
     *      floors at the kit's grow floor and a fixed-size one resolves at
     *      its live size.
     *    `keep` — a box it KEEPS across a browser resize, `place`'s pure
     *      shape: while the window sits near it on the raster being left
     *      (layout.js nearBox), the resize writes it on the new raster
     *      instead of pinning.
     *    `item` — the catalog item it shows, an icon's key: isOpen reads it,
     *      onWindows tells its coming and going — the icon's open ghost.
     *  The window must already be a slotted child of the desktop (the
     *  clamp reads its live lattice); if the kit has already made it the
     *  active window, the adoption re-reads the activation, so the front
     *  application is right whichever order the owner appends, adopts and
     *  raises in.
     *  @param {VfWindow} win
     *  @param {{
     *    app?: import('../state/shell.js').AppId,
     *    place?: ((w: number, h: number) => Box) | null,
     *    pin?: import('./layout.js').Pin | null,
     *    policy?: ((cur: Box) => import('./layout.js').Policy) | null,
     *    keep?: ((w: number, h: number) => Box) | null,
     *    item?: string | null,
     *  }} [opts] */
    adopt(
      win,
      {
        app = FINDER,
        place = null,
        pin = null,
        policy = null,
        keep = null,
        item = null,
      } = {}
    ) {
      adopted.set(win, { app, place, policy, keep, item });
      if (desktop.activeWindow === win) applyActive(win);
      if (pin) writeBox(win, pinnedBox(win, pin));
      else placeAdopted(win);
      if (item != null) notifyWindows();
      notifyLayout();
    },
    /** Drop a window from the manager — its placement, its re-pin, its
     *  item (the owner removes the node). */
    release(win) {
      const a = adopted.get(win);
      if (!a) return;
      adopted.delete(win);
      pins.delete(win);
      if (a.item != null) notifyWindows();
      notifyLayout();
    },
    /** A placement's write, for a gesture an owner runs itself (a zoom box,
     *  a restore, its group's arrange): the box onto the window, its
     *  top-left snapped onto the window's lattice, its pin record dropped
     *  (the next raster resize reads the pin from the new geometry), the
     *  layout signal told. A size the box leaves undefined stays the
     *  window's.
     *  @param {VfWindow} win
     *  @param {{left: number, top: number, width?: number, height?: number}} box */
    write(win, box) {
      writeBox(win, box);
      notifyLayout();
    },
    /** The boot clamp's arithmetic for `box` on `win` (clampedBox) —
     *  computed, not written: a placement's target.
     *  @param {VfWindow} win
     *  @param {{left?: number, top?: number, width?: number, height?: number}} box */
    clamped(win, box) {
      return clampedBox(desktop, win, box);
    },
    /** A window's nine-slice pin where it sits, on the current raster, in
     *  the frame the resize rule reads it in — what an owner remembers a
     *  box as: a pin, not a box, so the record is relative terms (each edge
     *  a strut's offset from the raster's edge or a spring's fraction of
     *  its middle) that any later raster can re-express (fromPin, adopt's
     *  `pin`). Read fresh from the live box: on the same raster the pin
     *  maps back exactly, and the resize rule's cache is a guard against
     *  ratcheting across a long resize drag, not a different truth.
     *  @param {VfWindow} win */
    pinOf(win) {
      return pinOf(boxOf(win), raster(), frame);
    },
    /** A pin re-expressed on the live raster by the resize rule's policy
     *  for `win`, clamped on — where a browser resize would have carried
     *  the window, on screen.
     *  @param {VfWindow} win
     *  @param {import('./layout.js').Pin} pin */
    fromPin(win, pin) {
      return pinnedBox(win, pin);
    },
    /** An adopted window's `place` on the live raster, clamped — where
     *  Arrange Windows sends it — or null for a window adopted without one.
     *  @param {VfWindow} win */
    placed(win) {
      return placedBox(win);
    },
    /** Is a window showing this catalog item open (adopt's `item`)?
     *  @param {string} item */
    isOpen(item) {
      for (const a of adopted.values()) if (a.item === item) return true;
      return false;
    },
    /** Register an application's ARRANGEMENT GROUP — its windows that
     *  arrange together by rules of its own, adopted without a `place`:
     *  arrange() runs `arrange`, and arranged() asks `arranged`, beside every
     *  window adopted with a placement. Registering tells the layout
     *  signal, so every View menu's ⌘J re-derives. Returns the unregister.
     *  @param {import('../state/shell.js').AppId} app
     *  @param {Group} group */
    arrangeWith(app, group) {
      groups.set(app, group);
      notifyLayout();
      return () => {
        if (groups.get(app) === group) groups.delete(app);
        notifyLayout();
      };
    },
    /** View → Arrange Windows, in every application: every arrangement
     *  group's own arrange, then every window adopted with a `place` back
     *  where it puts it on the CURRENT raster — the one way to get the
     *  arrangement back after moving things around or resizing the browser.
     *  Positions only: nothing activates or re-stacks. The layout signal is
     *  told once, after every write. */
    arrange() {
      holding = true;
      try {
        for (const group of groups.values()) group.arrange();
        for (const win of adopted.keys()) placeAdopted(win);
      } finally {
        holding = false;
      }
      notifyLayout();
    },
    /** Is the screen the arrangement? Every group's own reading, and every
     *  visible window adopted with a `place` at the very box arrange()
     *  would write for it (placedBox, the clamp included), so the test and
     *  the writes can't disagree. HIDDEN windows don't count — the test is
     *  what the user sees. Each application greys its ⌘J item while this
     *  reads true (nothing to arrange). */
    arranged() {
      for (const group of groups.values()) if (!group.arranged()) return false;
      for (const win of adopted.keys()) {
        const g = placedBox(win);
        if (g && !win.hidden && !at(win, g)) return false;
      }
      return true;
    },
    /** Widen the windows' frame's top and right bands to hold an
     *  application's furniture (declared at its init, before any window
     *  can re-pin): ONE frame for every window, so a remembered pin means
     *  what it meant. A pin cached in the old frame re-reads from where its
     *  window sits.
     *  @param {{top?: number, right?: number}} bands */
    setFrameBands(bands) {
      frame = windowFrame(bands);
      pins = new WeakMap();
    },
    /** Tell the layout signal of a change an owner made itself that is no
     *  placement — a derived size re-fit, a palette shown or hidden, its
     *  window set moving, a zoom: every application's ⌘J item re-derives
     *  on it. */
    layoutChanged() {
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
    /** Subscribe to the window set's signal: a window showing a catalog
     *  item came or went. Returns the unsubscribe. */
    onWindows(fn) {
      windowListeners.add(fn);
      return () => {
        windowListeners.delete(fn);
      };
    },
    /** Subscribe to the raster's signal: `fn(before, after)` once every
     *  window has re-pinned to a new raster size. Returns the unsubscribe.
     *  @param {(before: {width: number, height: number}, after: {width: number, height: number}) => void} fn */
    onRaster(fn) {
      rasterListeners.add(fn);
      return () => {
        rasterListeners.delete(fn);
      };
    },
    /** Hear every activation first: `fn(win)` with the newly active window,
     *  or null, BEFORE the front application is written (the header's FRONT
     *  APPLICATION) — where an owner mirrors which of its windows is
     *  active, so a switch arriving from another application lands while
     *  the owner's palettes are still hidden. Returns the unsubscribe.
     *  @param {(win: HTMLElement | null) => void} fn */
    beforeFront(fn) {
      frontListeners.add(fn);
      return () => {
        frontListeners.delete(fn);
      };
    },
    /** The raster changed size (a browser resize / zoom re-fit — main.js
     *  calls this right after fitWithin, per event, un-debounced: the raster
     *  re-fits live, so the windows track it in the same stroke). ONE rule,
     *  every adopted window, placed or dragged:
     *
     *  THE NINE-SLICE PIN (shell/layout.js pinOf/pinTo, in the windows'
     *  frame — its header is the design): the open area below the options
     *  strip is cut by a ring of outer bands — the frame's chrome band is
     *  the pin's y = 0 line, so a window tucked under the strip stays
     *  tucked under it — around a middle that grows and shrinks. Each
     *  window edge keeps its place in its slice: an edge in a band is a
     *  STRUT (its offset from that raster edge holds), an edge in the
     *  middle a SPRING (its fraction of the middle holds). So a window
     *  against the right edge stays against it, one wholly inside a corner
     *  never moves, a window spanning the middle breathes with it. An
     *  application that widens the frame's bands for its furniture makes
     *  its placed windows all struts, so a resize lands them exactly where
     *  Arrange Windows would — without this path knowing whether a window
     *  was ever touched. A fixed-size window resolves its edges through the
     *  anchor rule (a lone strut holds; two springs keep the center); a
     *  resizable one floors its size the same way (policyOf).
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
     *  never back up. The raster's signal follows the windows, then the
     *  layout signal. */
    onDesktopResized(before) {
      const after = raster();
      if (before.width === after.width && before.height === after.height) return;
      for (const win of adopted.keys()) repin(win, before, after);
      for (const fn of [...rasterListeners]) fn(before, after);
      notifyLayout();
    },
    /** Deactivate the front application programmatically (nothing calls
     *  this on the happy paths — closing the last window deactivates via
     *  the kit — but the hook stays for symmetry with clearActive()). */
    deactivate() {
      desktop.clearActive();
    },
    dispose() {
      for (const u of unsubs) u();
      layoutListeners.clear();
      windowListeners.clear();
      rasterListeners.clear();
      frontListeners.clear();
      groups.clear();
      // The applications released and removed their windows first (main.js
      // disposes them before the manager); anything left is theirs to drop.
      adopted.clear();
    },
  };
}
