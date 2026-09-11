// ---------------------------------------------------------------------------
// The DESKTOP's geometry — PURE (no DOM, Node-tested): the landmarks every
// window keeps to and the primitives the window manager (shell/windows.js)
// and the applications build their placements from — no one application's
// numbers. Which box, which size and what "zoomed" means are each
// application's own (src/apps/<id>/layout.js: the Sprite Editor's placement
// and windoid arithmetic, the Finder's icon lattice and folder window, the
// Text Viewer's reading column — docs/app-windows-plan.md §3.6):
//
//   THE LANDMARKS. MENU_BAR, the band the menu bar reserves; TOP_RESERVE,
//   the menu bar plus the options strip's band, below which every window's
//   title bar stays whoever is front; WINDOW_ORIGIN, where an
//   application's first window opens — the corner a document window, a
//   folder window and a read-me each cascade from.
//
//   THE CASCADE. cascadeSlot() is slot `i` of a base corner, stepped
//   down-right by CASCADE_STEP and wrapping after CASCADE_SLOTS;
//   cascadeFrom() is the first slot no open window of a kind holds — a
//   closed or dragged-away window gives its slot back, and a full cascade
//   wraps instead of walking off the raster. cascadedBox() places a window
//   with nowhere better to be (a folder window, a read-me): its authored
//   size on a slot from WINDOW_ORIGIN. centeredBox() is the other
//   placement — the Desktop Patterns control panel's: a fixed-size window
//   centered in the open area below the options strip's band, the way the
//   Finder placed a window it had no stored position for.
//
//   NEARNESS. nearBox() is the desktop's nearness test: a box whose every
//   edge sits within NEAR of a target is AT it — how the Text Viewer's zoom
//   box reads its state at the click, and how the window manager's `keep`
//   holds a box across a resize, so nothing has to remember that a window
//   is there.
//
//   THE RESIZE RULE. pinOf() / pinTo() are the browser-resize rule — ONE
//   rule for every window and icon, placed or dragged alike (the
//   springs-and-struts model, the strut/spring choice made by position):
//   the open area is NINE-SLICED, and each box keeps its corners at the
//   same relative position inside whichever slice they sit in. A FRAME
//   names the open area — the raster below a fixed-height reserve band of
//   chrome (TOP_RESERVE for windows: the menu bar plus the options strip;
//   MENU_BAR for icons — the Finder's ICON_FRAME, apps/finder/layout.js:
//   the strip belongs to the Sprite Editor and reserves nothing above an
//   icon) — and four BANDS cut it into the nine slices. An edge in an outer
//   band is a STRUT (it keeps its offset from that raster edge); an edge in
//   the middle is a SPRING (it keeps its fraction of the middle's extent).
//   So a window tucked against the right edge stays tucked, a widget inside
//   a corner never moves, a window spanning the middle breathes with it,
//   and a box left hanging off an edge keeps hanging by the same amount.
//   The windows' frame (windowFrame) is ONE for every window, BAND thick
//   but for its top and right bands, which an application may widen to
//   hold its furniture — the Sprite Editor's, through the rail head and
//   the rail column (apps/sprite-editor/layout.js FRAME_BANDS, declared to
//   the window manager at its init), so every placed windoid is ALL STRUTS
//   and its placement a fixed point of the rule. A fixed-size box (a
//   windoid without a grow box, every icon) resolves its two edges through
//   an ANCHOR rule — a lone strut holds, opposite struts keep the near edge
//   (the title bar is the handle), two springs keep the center — and a
//   resizable one floors its size the same way. The pin is read once
//   (pinOf) and re-expressed on any later raster (pinTo). No clamping, no
//   visibility guarantee — a window near an edge may hang partly off a
//   shrunk raster, and that is fine: the same pin always maps back exactly,
//   so growing back returns it whole (a clamp would rewrite the pin at the
//   small size and turn the round trip into a drift — tried, rejected). The
//   split into two functions matters: the callers keep the UNROUNDED pin as
//   the per-box truth between resize events, because re-deriving it each
//   event from the just-rounded, just-snapped geometry ratchets: the
//   placement lattice's quantum is 2 or 4 system px at fractional display
//   scales, and rounding onto it breaks ties toward +∞ — a long resize drag
//   walked every window down the screen, one notch per odd landing, never
//   back up.
// ---------------------------------------------------------------------------

// The raster band reserved above windows: the 20px menu bar plus the options
// strip's kit container band (36px, `rule="bottom"` — 35 rows of paper over
// its own bottom rule, so its box bottoms out at 20 + 36 = 56) — a window
// clamped below it always keeps its title bar grabbable.
export const TOP_RESERVE = 56;

// The raster band the menu bar reserves — all a desktop icon keeps clear of
// (the Finder's icon frame is the whole desktop below it; see the header).
export const MENU_BAR = 20;

// WHERE AN APPLICATION'S FIRST WINDOW OPENS (docs/app-windows-plan.md §3.6):
// the desktop's own landmark, 52 across and 8 under the options strip's
// band — the corner a document window, a folder window and a read-me each
// cascade from, so the three open on one corner without any application
// reading another's furniture. The band left of it is where the Sprite
// Editor floats its Tools palette (a 14 inset, the 24-wide palette, 14).
export const WINDOW_ORIGIN = { left: 52, top: TOP_RESERVE + 8 };

// The cascade: each further window of a kind steps down-right from its
// base, System 7 style — into the first free slot (cascadeFrom), wrapping
// after CASCADE_SLOTS.
export const CASCADE_STEP = 24;
export const CASCADE_SLOTS = 5;

/**
 * Where the next window of a kind opens: the base `base` (its top-left; the
 * size rides along unchanged — a document window's doc box), cascaded
 * down-right by CASCADE_STEP into the first slot no open window of the kind
 * holds — `occupied` is their top-lefts. A slot counts as held when a
 * window's top-left sits within half a step of it (a lattice snap or an
 * edge clamp can shift a landing by a pixel or two), so a window dragged
 * clear of its slot frees it, as does closing one. With every slot held the
 * cascade wraps to slot `occupied.length % CASCADE_SLOTS` rather than
 * walking off the raster. The slot index rides along so the window can be
 * re-placed onto the same step of a later raster's base (cascadeSlot).
 *
 * @param {{left: number, top: number}} base
 * @param {{left: number, top: number}[]} occupied
 * @returns {{left: number, top: number, slot: number}}
 */
export function cascadeFrom(base, occupied) {
  const near = CASCADE_STEP / 2;
  for (let i = 0; i < CASCADE_SLOTS; i++) {
    const s = cascadeSlot(base, i);
    const held = occupied.some(
      (o) => Math.abs(o.left - s.left) < near && Math.abs(o.top - s.top) < near
    );
    if (!held) return s;
  }
  return cascadeSlot(base, occupied.length % CASCADE_SLOTS);
}

/**
 * Cascade slot `i` of the base `base` (wrapping past CASCADE_SLOTS).
 *
 * @param {{left: number, top: number}} base
 * @param {number} i
 * @returns {{left: number, top: number, slot: number}}
 */
export function cascadeSlot(base, i) {
  const slot = i % CASCADE_SLOTS;
  return {
    left: base.left + CASCADE_STEP * slot,
    top: base.top + CASCADE_STEP * slot,
    slot,
  };
}

/**
 * A fixed-size window centered in the open area below the options strip's
 * band (TOP_RESERVE — whether or not the strip is showing): the Desktop
 * Patterns control panel's placement, `size` its own box. The top-left
 * floors at the reserve and the raster's left edge, so a raster smaller
 * than the window still keeps its title bar grabbable (the manager's clamp
 * does the rest). Whole system px, floored — the same lattice discipline as
 * every placement.
 *
 * @param {number} desktopW
 * @param {number} desktopH
 * @param {{width: number, height: number}} size
 * @returns {{left: number, top: number, width: number, height: number}}
 */
export function centeredBox(desktopW, desktopH, size) {
  return {
    left: Math.max(0, Math.floor((desktopW - size.width) / 2)),
    top: Math.max(
      TOP_RESERVE,
      TOP_RESERVE + Math.floor((desktopH - TOP_RESERVE - size.height) / 2)
    ),
    width: size.width,
    height: size.height,
  };
}

/**
 * A window's box on cascade slot `n` from the desktop's WINDOW_ORIGIN — the
 * placement of a window with nowhere better to be (a folder window, a
 * read-me): `size` (its authored box) at the slot, stepped down-right by
 * CASCADE_STEP per window of its kind already open (the caller's count, a
 * session truth captured at the open), its top-left floored at the
 * raster's corner and the reserve so a raster smaller than the window keeps
 * its title bar grabbable (the manager's clamp does the rest). Whole system
 * px.
 *
 * @param {number} desktopW
 * @param {number} desktopH
 * @param {{width: number, height: number}} size
 * @param {number} [n]  windows of its kind open before this one
 * @returns {{left: number, top: number, width: number, height: number}}
 */
export function cascadedBox(desktopW, desktopH, size, n = 0) {
  const slot = cascadeSlot(WINDOW_ORIGIN, n);
  return {
    left: Math.max(0, Math.min(slot.left, Math.max(0, desktopW - size.width))),
    top: Math.max(
      TOP_RESERVE,
      Math.min(slot.top, Math.max(TOP_RESERVE, desktopH - size.height))
    ),
    width: size.width,
    height: size.height,
  };
}

/** How close is "at" (nearBox): every edge within NEAR system px — past a
 *  lattice snap (a quantum of 2 or 4) and a nudge, short of a real move or
 *  grow. The desktop's own tolerance. */
export const NEAR = 10;

/**
 * Is `box` close to `target` — each of its four edges within `tol` of the
 * target's? How the Text Viewer's zoom box reads its state at the click
 * (apps/text-viewer), and how the window manager's `keep` reads a window
 * still at its kept box across a browser resize (shell/windows.js).
 *
 * @param {{left: number, top: number, width: number, height: number}} box
 * @param {{left: number, top: number, width: number, height: number}} target
 * @param {number} [tol]
 */
export function nearBox(box, target, tol = NEAR) {
  return (
    Math.abs(box.left - target.left) <= tol &&
    Math.abs(box.top - target.top) <= tol &&
    Math.abs(box.left + box.width - (target.left + target.width)) <= tol &&
    Math.abs(box.top + box.height - (target.top + target.height)) <= tol
  );
}

// --- the nine-slice resize rule (see the header) -------------------------------
// The band every side gets at least: the outer slices are BAND system px
// thick, the middle is the remainder.
export const BAND = 100;

/**
 * @typedef {{reserve: number, bands: {left: number, top: number, right: number, bottom: number}}} Frame
 *   reserve: the fixed chrome band above the frame's open area (the pin's
 *   y = 0 line); bands: the outer slices' thickness per side, in system px.
 */

/**
 * The windows' frame (see the header): the open area below the options
 * strip's band, cut in BAND-thick outer slices but for the two an
 * application may widen to hold its furniture — `top` and `right`, the
 * Sprite Editor's rail head and rail column (apps/sprite-editor/layout.js
 * FRAME_BANDS, declared to the window manager at its init). One frame for
 * every window, a stored folder window's pin read in it too. A band never
 * narrows past BAND.
 *
 * @param {{top?: number, right?: number}} [bands]
 * @returns {Frame}
 */
export function windowFrame({ top = BAND, right = BAND } = {}) {
  return {
    reserve: TOP_RESERVE,
    bands: {
      left: BAND,
      top: Math.max(BAND, top),
      right: Math.max(BAND, right),
      bottom: BAND,
    },
  };
}

/**
 * @typedef {{size?: {width?: number, height?: number}, min?: {width?: number, height?: number}}} Policy
 *   A box's resize policy, per axis (pinTo): `size` a fixed-size axis's live
 *   size, `min` a resizable axis's floor.
 * @typedef {{kind: 'near'|'far'|'spring', v: number}} EdgePin
 *   near: v is the offset from the span's start; far: from its end;
 *   spring: the unrounded fraction of the middle.
 * @typedef {{x: [EdgePin, EdgePin], y: [EdgePin, EdgePin]}} Pin
 *   per axis, the near edge (left / top) then the far edge (right / bottom).
 */

/** Is `p` a pin — the shape pinOf reads, or one stored and parsed back? A
 *  folder window's record in the desktop-state blob is one; a stale or
 *  garbled record reads as none, so the window takes the fresh placement
 *  instead of throwing in pinTo.
 *  @param {any} p
 *  @returns {p is Pin} */
export function isPin(p) {
  const edge = (e) =>
    !!e &&
    (e.kind === 'near' || e.kind === 'far' || e.kind === 'spring') &&
    Number.isFinite(e.v);
  const axis = (a) => Array.isArray(a) && a.length === 2 && edge(a[0]) && edge(a[1]);
  return !!p && typeof p === 'object' && axis(p.x) && axis(p.y);
}

/** One edge classified on a span `s` with near band `n` and far band `f`.
 *  Near is tested first, so on a degenerate span (s < n + f, the bands
 *  overlapping) an edge in both reads near; an edge OUTSIDE the span is a
 *  strut with a negative offset. A spring never reads on a degenerate span
 *  (no v satisfies n ≤ v < s − f there), so its fraction is always in
 *  [0, 1).
 *  @param {number} v
 *  @param {number} s
 *  @param {number} n
 *  @param {number} f
 *  @returns {EdgePin} */
function edgePin(v, s, n, f) {
  if (v < n) return { kind: 'near', v };
  if (v >= s - f) return { kind: 'far', v: s - v };
  return { kind: 'spring', v: (v - n) / Math.max(1, s - n - f) };
}

/** The edge re-expressed on a span `s`. Continuous across both seams (at
 *  v = n the near strut and the spring agree, at v = s − f the spring and
 *  the far strut); on a degenerate span the middle collapses to the seam
 *  at n and every spring lands there. */
function edgeTo(pin, s, n, f) {
  if (pin.kind === 'near') return pin.v;
  if (pin.kind === 'far') return s - pin.v;
  return n + pin.v * Math.max(0, s - n - f);
}

/**
 * One axis resolved: both edges mapped, then — for a fixed `size`, or a
 * resizable box whose mapped size falls under `min` — the ANCHOR rule: a
 * lone strut holds; two struts of one kind never conflict (the mapped
 * edges are already `size` apart) and two of opposite kinds keep the near
 * edge; two springs keep the mapped center.
 *
 * @param {[EdgePin, EdgePin]} pins
 * @param {number} s
 * @param {number} n
 * @param {number} f
 * @param {{size?: number, min?: number}} policy
 * @returns {{a: number, size: number}}
 */
function resolveAxis(pins, s, n, f, { size, min = 0 }) {
  const a = edgeTo(pins[0], s, n, f);
  const b = edgeTo(pins[1], s, n, f);
  if (size == null) {
    if (b - a >= min) return { a, size: b - a };
    size = min;
  }
  const strutA = pins[0].kind !== 'spring';
  const strutB = pins[1].kind !== 'spring';
  if (strutA) return { a, size };
  if (strutB) return { a: b - size, size };
  return { a: (a + b) / 2 - size / 2, size };
}

/**
 * A box's nine-slice pin on `raster` in `frame` (see the header): each of
 * its four edges classified as a strut or a spring by the slice it sits
 * in, with its offset or fraction. The caller keeps this as the truth
 * between resize events. A fixed-size box passes its live size.
 *
 * @param {{left: number, top: number, width: number, height: number}} box
 * @param {{width: number, height: number}} raster
 * @param {Frame} frame
 * @returns {Pin}
 */
export function pinOf(box, raster, frame) {
  const { reserve, bands } = frame;
  const sw = raster.width;
  const sh = raster.height - reserve;
  const top = box.top - reserve;
  return {
    x: [
      edgePin(box.left, sw, bands.left, bands.right),
      edgePin(box.left + box.width, sw, bands.left, bands.right),
    ],
    y: [
      edgePin(top, sh, bands.top, bands.bottom),
      edgePin(top + box.height, sh, bands.top, bands.bottom),
    ],
  };
}

/**
 * The pin re-expressed on `raster` as a concrete box, in the same frame it
 * was read in. `size` is a fixed-size box's LIVE size (its edges resolve
 * through the anchor rule — a derived height that changes under it, a
 * picture frame re-fit, is no move); `min` is a resizable box's floor.
 * Both are read PER AXIS: an axis given a size resolves as fixed, one given
 * a floor (or nothing) as resizable, so a box fixed on one axis and free on
 * the other — a derived height over a user-sized width — states both.
 * Whole system px, otherwise raw: the caller snaps onto its element's
 * lattice and applies the oversize intervention. Nothing clamps — see the
 * header.
 *
 * @param {Pin} pin
 * @param {{width: number, height: number}} raster
 * @param {Frame} frame
 * @param {Policy} [policy]
 * @returns {{left: number, top: number, width: number, height: number}}
 */
export function pinTo(pin, raster, frame, { size, min } = {}) {
  const { reserve, bands } = frame;
  const x = resolveAxis(pin.x, raster.width, bands.left, bands.right, {
    size: size?.width,
    min: min?.width,
  });
  const y = resolveAxis(pin.y, raster.height - reserve, bands.top, bands.bottom, {
    size: size?.height,
    min: min?.height,
  });
  return {
    left: Math.round(x.a),
    top: Math.round(reserve + y.a),
    width: Math.round(x.size),
    height: Math.round(y.size),
  };
}
