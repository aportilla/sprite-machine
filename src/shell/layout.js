// Desktop geometry (pure, no DOM): the landmarks, the window cascade, the
// nearness test and the nine-slice resize pin shared by windows and icons.
// Application-specific boxes and sizes live in src/apps/<id>/layout.js.
//
// Nine-slice resize rule (pinOf / pinTo): a frame is the raster below a
// reserve band, cut by four outer bands into nine slices. An edge in an outer
// band is a strut and keeps its offset from that raster edge. An edge in the
// middle is a spring and keeps its fraction of the middle. Nothing clamps, so
// the same pin always maps back exactly. Callers keep the unrounded pin between
// resize events. Re-reading it from snapped geometry on every event ratchets
// boxes across the screen.

// The band reserved above windows: the 20px menu bar plus the 36px options strip.
export const TOP_RESERVE = 56;

// The band the menu bar reserves. Desktop icons keep clear of it.
export const MENU_BAR = 20;

// Where an application's first window opens, and the base of every window
// cascade.
export const WINDOW_ORIGIN = { left: 52, top: TOP_RESERVE + 8 };

export const CASCADE_STEP = 24;
export const CASCADE_SLOTS = 5;

/**
 * The first cascade slot from `base` not held by a window in `occupied`
 * (top-lefts). A window within half a step of a slot holds it, which absorbs
 * snapping and clamping. `slot` is the index for cascadeSlot.
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
 * A box of `size` centered in the open area below TOP_RESERVE. The top-left
 * floors at TOP_RESERVE and 0. Whole system px.
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
 * A box of `size` on cascade slot `n` from WINDOW_ORIGIN. The top-left is
 * pulled in to fit the raster, but not above TOP_RESERVE or left of 0. Whole
 * system px.
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

/** nearBox's edge tolerance in system px. Larger than a lattice snap (2 or 4),
 *  smaller than a real move. */
export const NEAR = 10;

/**
 * Whether each of the four edges of `box` is within `tol` of `target`'s.
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

// Nine-slice resize rule.
// The minimum outer slice thickness in system px. The middle is the remainder.
export const BAND = 100;

/**
 * @typedef {{reserve: number, bands: {left: number, top: number, right: number, bottom: number}}} Frame
 *   `reserve` is the chrome band above the open area (the pin's y = 0 line).
 *   `bands` is each outer slice's thickness in system px.
 */

/**
 * The frame shared by every window: below TOP_RESERVE, with outer slices at
 * least BAND thick. An application may widen `left`, `top` and `right`
 * (setFrameBands in shell/windows.js).
 *
 * @param {{left?: number, top?: number, right?: number}} [bands]
 * @returns {Frame}
 */
export function windowFrame({ left = BAND, top = BAND, right = BAND } = {}) {
  return {
    reserve: TOP_RESERVE,
    bands: {
      left: Math.max(BAND, left),
      top: Math.max(BAND, top),
      right: Math.max(BAND, right),
      bottom: BAND,
    },
  };
}

/**
 * @typedef {{size?: {width?: number, height?: number}, min?: {width?: number, height?: number}}} Policy
 *   A resize policy per axis (pinTo). `size` fixes an axis at its live size.
 *   `min` floors a resizable axis.
 * @typedef {{kind: 'near'|'far'|'spring', v: number}} EdgePin
 *   near: v is the offset from the span's start. far: the offset from its end.
 *   spring: the unrounded fraction of the middle.
 * @typedef {{x: [EdgePin, EdgePin], y: [EdgePin, EdgePin]}} Pin
 *   Per axis, the near edge (left or top) then the far edge (right or bottom).
 */

/** Whether `p` has a pin's shape. Pins are stored in desktop state. A stale or
 *  garbled record must read as none, so pinTo never throws.
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

/** Classifies edge `v` on a span `s` with near band `n` and far band `f`.
 *  Near is tested first, so where the bands overlap an edge reads near. An
 *  edge outside the span is a strut with a negative offset. A spring's
 *  fraction is always in [0, 1).
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

/** An edge pin re-expressed on a span `s`. It is continuous at both slice
 *  boundaries. Where the bands overlap, every spring maps to `n`. */
function edgeTo(pin, s, n, f) {
  if (pin.kind === 'near') return pin.v;
  if (pin.kind === 'far') return s - pin.v;
  return n + pin.v * Math.max(0, s - n - f);
}

/**
 * Resolves one axis. For a fixed `size`, or a mapped size below `min`, the
 * anchor rule places it. A near strut holds, else a far strut, else the center.
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
 * A box's nine-slice pin on `raster` in `frame`: each edge classified as a
 * strut or a spring, with its offset or fraction.
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
 * `pin` re-expressed on `raster` as a box, in the frame it was read in. The
 * policy applies per axis. An axis with `size` resolves as fixed through the
 * anchor rule. An axis with `min`, or neither, resolves as resizable. Rounded
 * to whole system px. Callers snap to their lattice and cap oversize boxes.
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
