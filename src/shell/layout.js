// ---------------------------------------------------------------------------
// The desktop's window + icon arithmetic — PURE (no DOM, Node-tested), the
// numbers shell/windows.js and shell/icons.js apply:
//
//   initialPlacement() is the authored arrangement computed from the live
//   raster instead of hard-coded markup: the Tools palette top-left, the
//   Full Sprite View over the 3D View as a right-hand RAIL below the
//   options strip, both right-flush at ONE width — the Sprite View at its
//   FIXED size (SPRITE_WIDTH wide, height via spriteHeightFor) and the 3D
//   View under it, as wide, taking what's left of the height — and the
//   document window TOP-LEFT ALIGNED beside the Tools palette (same top, a
//   side inset right of it), filling the vacant middle but for the CASCADE
//   ROOM it leaves at the right and bottom, so every further window opens
//   at the same size, stepped down-right, without running into the rail
//   or off the bottom. This is the ONLY
//   source of window geometry: nothing is restored from a prior session — a
//   browser is resized and reopened on another monitor all the time, so a
//   remembered top/left is no truth worth re-asserting over a raster that
//   may be nothing like the one it was dragged on. windows.js applies the
//   placement at every boot (the windoids) and every document open (the
//   doc box), then the clamp.
//
//   cascadeFrom() is the document windows' half of that rule: each open
//   takes the doc box cascaded down-right by CASCADE_STEP into the first
//   slot no open document window holds — a closed or dragged-away window
//   gives its slot back, and a full cascade wraps instead of walking off
//   the raster.
//
//   zoomedBox() is the document windows' zoom-box arithmetic: the expanded
//   state for a window's HELD top-left — right and down to the vacant
//   middle's own edges (the rail's inset gutter, the bottom margin), the
//   same boundaries the doc box leaves its cascade room against — so a
//   zoomed window fills the open area without running under the rail.
//
//   centeredBox() is the PANEL windows' placement — the Desktop Patterns
//   control panel: a fixed-size window centered in the open area below the
//   options strip's band, the way the Finder placed a window it had no
//   stored position for (nothing about it persists either).
//
//   spriteHeightFor() is the Sprite View windoid's sizing rule: the windoid
//   is a fixed-size picture frame — no grow box — its width the atlas
//   grid's (ATLAS_GRID: the 3×2 lattice of face tiles) and its height
//   derived through the tile's own ratio plus the fixed chrome, so the
//   grid exactly fills the body below the picker strip (windows.js
//   re-derives the height on document switches and structural changes).
//
//   iconDefault() is the icons' half of the same idea: the classic
//   left-edge column below the Tools band, derived from the raster instead
//   of a fixed stack — it folds into further columns when the next cell
//   would run off a short raster's bottom.
//
//   pinOf() / pinTo() are the browser-resize rule — ONE rule for every
//   window and icon, placed or dragged alike (the springs-and-struts model,
//   the strut/spring choice made by position): the open area is
//   NINE-SLICED, and each box keeps its
//   corners at the same relative position inside whichever slice they sit
//   in. A FRAME names the open area — the raster below a fixed-height
//   reserve band of chrome (TOP_RESERVE for windows: the menu bar plus the
//   options strip; MENU_BAR for icons, the FINDER's furniture — the strip
//   belongs to the application and reserves nothing above an icon) — and
//   four BANDS cut it into the nine slices. An edge in an outer band is a
//   STRUT (it keeps its offset from that raster edge); an edge in the
//   middle is a SPRING (it keeps its fraction of the middle's extent). So a
//   window tucked against the right edge stays tucked, a widget inside a
//   corner never moves, a window spanning the middle breathes with it, and
//   a box left hanging off an edge keeps hanging by the same amount. The
//   window frame's top and right bands are sized to the placement's
//   furniture — the rail head and the rail column — so every placed windoid
//   is ALL STRUTS and the placement is a fixed point of the rule: a resize
//   lands the rail exactly where initialPlacement would, with nothing
//   remembering whether a window was "touched" (the document window is
//   content, not furniture: its right and bottom edges spring with the
//   vacancy). A fixed-size box (a windoid without a grow box, every icon)
//   resolves its two edges through an ANCHOR rule — a lone strut holds,
//   opposite struts keep the near edge (the title bar is the handle), two
//   springs keep the center — and a resizable one floors its size the same
//   way. The pin is read once (pinOf) and re-expressed on any later raster
//   (pinTo). No clamping, no visibility guarantee — a window near an edge
//   may hang partly off a shrunk raster, and that is fine: the same pin
//   always maps back exactly, so growing back returns it whole (a clamp
//   would rewrite the pin at the small size and turn the round trip into a
//   drift — tried, rejected). The split into two functions matters: the
//   callers keep the UNROUNDED pin as the per-box truth between resize
//   events, because re-deriving it each event from the just-rounded,
//   just-snapped geometry ratchets: the placement lattice's quantum is 2 or
//   4 system px at fractional display scales, and rounding onto it breaks
//   ties toward +∞ — a long resize drag walked every window down the
//   screen, one notch per odd landing, never back up.
// ---------------------------------------------------------------------------

// The raster band reserved above windows: the 20px menu bar plus the options
// strip's kit container band (36px, `rule="bottom"` — 35 rows of paper over
// its own bottom rule, so its box bottoms out at 20 + 36 = 56) — a window
// clamped below it always keeps its title bar grabbable.
export const TOP_RESERVE = 56;

// The raster band reserved above ICONS: the menu bar alone — the icons' pin
// and clamp frame is the whole desktop below it (see the header).
export const MENU_BAR = 20;

const EDGE = 14; // side inset — the Tools palette's classic left, the doc's gap from it
const GAP = 8; // vertical breathing room: below the strip, between / below the rail

// The document-window cascade: each further open steps down-right from the
// doc box, System 7 style — into the first free slot (cascadeFrom), wrapping
// after CASCADE_SLOTS. The doc box leaves exactly the cascade's room at the
// vacant middle's right and bottom (CASCADE_ROOM), so every slot lands
// inside the vacancy — the last one flush with its edges — before the
// cascade wraps onto the first.
export const CASCADE_STEP = 24;
export const CASCADE_SLOTS = 5;
const CASCADE_ROOM = (CASCADE_SLOTS - 1) * CASCADE_STEP;
const DOC_MIN = 220; // the doc box's floor on a raster too small for the room

// --- the Full Sprite View windoid's fixed size --------------------------------
// The windoid is a fixed-size picture frame — no grow box: the ATLAS GRID
// block sets its width, and its height is DERIVED so the grid exactly fills
// the body below the picker strip. All system px, measured at scale 1 — if
// the atlas grid, the picker strip or the window chrome changes, re-measure:
//   width chrome: the frame's two 1px side borders;
//   height chrome: 12 dot bar + 2 borders + 62 picker strip (26 icon + ~19
//   radio + 2×8 pad + 1 rule) = 76 — no status strip (the slot is empty,
//   so the kit draws no bottom bar).
export const SPRITE_CHROME = { w: 2, h: 76 };
// The atlas grid — sm-atlas-view's frameless 3×2 vf-grid of face tiles
// (the sheet's own arrangement), `cell` system px wide per cell with 1px
// rules between and the windoid frame as its perimeter. The cell WIDTH is
// the fixed constant (the view imports it); the cell height rides the
// active tile's own ratio — square cells for the square-tile default.
export const ATLAS_GRID = { cols: 3, rows: 2, cell: 70 };
// The windoid's width — the grid block (three 70px cells + two 1px interior
// rules = 212) + the 2 side borders, so the grid fills the body edge to
// edge (the 210px face-picker block centers in the strip above with a
// pixel of slack each side).
export const SPRITE_WIDTH = 214;
// A square tile's height : width — the ratio the sizing rule defaults to
// before a document is open (a live document's real tile wins; only the
// ?tile=WxH shear hook produces a non-square one).
export const TILE_RATIO = 1;

/** The Sprite View windoid's derived height for a window width and a tile
 *  height:width ratio. At SPRITE_WIDTH the per-column split is exactly
 *  ATLAS_GRID.cell — whole system px, the vf-grid's contract. */
export function spriteHeightFor(width, ratio = TILE_RATIO) {
  const { cols, rows } = ATLAS_GRID;
  const cellW = Math.max(0, width - SPRITE_CHROME.w - (cols - 1)) / cols;
  return rows * Math.round(cellW * ratio) + (rows - 1) + SPRITE_CHROME.h;
}

// The default icon lattice: columns from the left edge, below the Tools
// palette's classic band.
const ICON_COL_X = 16;
const ICON_ROW_Y0 = 340;
const ICON_ROW_PITCH = 72;
const ICON_COL_PITCH = 80; // the 64px icon plate + a 16px gutter
// The cell an icon must fit inside the raster: its 64px plate (the label
// hugs under the art well inside it) — also the margin icons.js clamps by.
export const ICON_CELL = 64;

/**
 * The smart boot arrangement for a `desktopW`×`desktopH` system-px raster.
 * `tools` is the Tools palette's content-hugging authored size (the one box
 * this module doesn't compute — index.html owns it).
 *
 * @param {number} desktopW
 * @param {number} desktopH
 * @param {{width: number, height: number}} tools
 * @returns {{
 *   tools: {left: number, top: number},
 *   sprite: {left: number, top: number, width: number, height: number},
 *   stage: {left: number, top: number, width: number, height: number},
 *   doc: {left: number, top: number, width: number, height: number},
 * }}
 */
export function initialPlacement(desktopW, desktopH, tools) {
  const top = TOP_RESERVE + GAP;

  // The right-hand rail: Full Sprite View over 3D View, one column — both
  // right-flush behind a side inset at the SAME width, splitting the height
  // below the strip. The sprite windoid is FIXED-size (SPRITE_WIDTH wide,
  // height derived — spriteHeightFor); the stage, as wide, takes the rest
  // of the height.
  const span = desktopH - top - GAP; // the rail's vertical run
  const spriteH = spriteHeightFor(SPRITE_WIDTH);
  const railLeft = Math.max(0, desktopW - EDGE - SPRITE_WIDTH);
  const sprite = { left: railLeft, top, width: SPRITE_WIDTH, height: spriteH };
  const stage = {
    left: railLeft,
    top: top + spriteH + GAP,
    width: SPRITE_WIDTH,
    height: Math.max(100, span - spriteH - GAP), // a squat raster still gets a view
  };

  // The vacant middle: between the Tools palette and the rail, below the
  // strip. The document window sits top-left aligned beside the palette —
  // its top, a side inset to its right — and fills the vacancy but for the
  // cascade room at the right and bottom, so each further window opens at
  // this same size, stepped down-right, inside the vacancy.
  const x0 = EDGE + tools.width + EDGE;
  const vacantW = Math.max(0, railLeft - EDGE - x0);
  const vacantH = Math.max(0, desktopH - GAP - top);
  const doc = {
    left: x0,
    top,
    width: Math.max(DOC_MIN, vacantW - CASCADE_ROOM),
    height: Math.max(DOC_MIN, vacantH - CASCADE_ROOM),
  };

  return { tools: { left: EDGE, top }, sprite, stage, doc };
}

/**
 * Where the next document window opens: the doc box `base` (its top-left;
 * the size rides along unchanged), cascaded down-right by CASCADE_STEP into
 * the first slot no open document window holds — `occupied` is the open
 * windows' top-lefts. A slot counts as held when a window's top-left sits
 * within half a step of it (a lattice snap or an edge clamp can shift a
 * landing by a pixel or two), so a window dragged clear of its slot frees
 * it, as does closing one. With every slot held the cascade wraps to slot
 * `occupied.length % CASCADE_SLOTS` rather than walking off the raster.
 * The slot index rides along so the window can be re-placed onto the same
 * step of a later raster's doc box (cascadeSlot).
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
 * Cascade slot `i` of the doc box `base` (wrapping past CASCADE_SLOTS).
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
 * The zoom box's expanded state for a document window at `pos` (its
 * top-left, in system px) on a `desktopW`×`desktopH` raster: the top-left
 * HOLDS — a zoom grows the window right and down only — and the far edges
 * land on the vacant middle's own boundaries, the rail's inset gutter at
 * the right (railLeft − EDGE) and the bottom margin (desktopH − GAP): the
 * exact edges the doc box leaves its cascade room against, so a zoomed
 * window fills the open area WITHOUT running under the windoid rail (the
 * windoids float above the document tier regardless; the limit keeps the
 * artwork out from under them). Floored at DOC_MIN so a window dragged
 * past the vacancy's edges still zooms to a workable box — which may hang
 * off the raster, the resize rule's own recoverable-by-a-drag posture.
 *
 * @param {number} desktopW
 * @param {number} desktopH
 * @param {{left: number, top: number}} pos
 * @returns {{left: number, top: number, width: number, height: number}}
 */
export function zoomedBox(desktopW, desktopH, pos) {
  const railLeft = Math.max(0, desktopW - EDGE - SPRITE_WIDTH);
  return {
    left: pos.left,
    top: pos.top,
    width: Math.max(DOC_MIN, railLeft - EDGE - pos.left),
    height: Math.max(DOC_MIN, desktopH - GAP - pos.top),
  };
}

/**
 * A PANEL window's placement — the Desktop Patterns control panel: `size`
 * (the panel is fixed-size; its box is the caller's) centered in the open
 * area below the options strip's band (TOP_RESERVE — the windows' frame,
 * whether or not the strip is showing). The top-left floors at the reserve
 * and the raster's left edge, so a raster smaller than the panel still
 * keeps its title bar grabbable (windows.js's clamp does the rest). Whole
 * system px, floored — the same lattice discipline as every placement.
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
 * The default position for icon `slot` on a raster `desktopH` system px
 * tall: the classic left-edge column, folding into further columns when the
 * next cell would run off the bottom — a squat raster keeps every icon on
 * screen instead of marching a stack off it. A raster too short for even
 * one cell degrades to a single row (icons.js's boot clamp pulls it up into
 * frame).
 *
 * @param {number} slot
 * @param {number} desktopH
 * @returns {{left: number, top: number}}
 */
export function iconDefault(slot, desktopH) {
  const rows = Math.max(
    1,
    Math.floor((desktopH - ICON_ROW_Y0 - ICON_CELL) / ICON_ROW_PITCH) + 1
  );
  return {
    left: ICON_COL_X + Math.floor(slot / rows) * ICON_COL_PITCH,
    top: ICON_ROW_Y0 + (slot % rows) * ICON_ROW_PITCH,
  };
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

/** The windows' frame: below the options strip, the top and right bands
 *  widened past BAND to hold the placement's furniture — the TOP band runs
 *  through the rail head (the Sprite View's fixed height plus the gaps
 *  around it, so the 3D View's TOP edge is a strut — with a GAP of slack,
 *  since a lattice snap can move a placed edge a pixel or two and a band
 *  boundary is no place to park one), the RIGHT band is the rail column
 *  plus its inset gutter (so the rail's LEFT edges are struts, with the
 *  inset as slack). The square-tile sprite height is the constant here —
 *  the ?tile=WxH shear hook can push the stage's top past the band, where
 *  it springs (dev-only, accepted). Every placed windoid is then all
 *  struts; see the header.
 *  @type {Frame} */
export const WINDOW_FRAME = {
  reserve: TOP_RESERVE,
  bands: {
    left: BAND,
    top: GAP + spriteHeightFor(SPRITE_WIDTH) + GAP + GAP,
    right: EDGE + SPRITE_WIDTH + EDGE,
    bottom: BAND,
  },
};

/** The icons' frame: the whole desktop below the menu bar, uniform bands —
 *  no application furniture lives in the Finder's frame.
 *  @type {Frame} */
export const ICON_FRAME = {
  reserve: MENU_BAR,
  bands: { left: BAND, top: BAND, right: BAND, bottom: BAND },
};

/**
 * @typedef {{kind: 'near'|'far'|'spring', v: number}} EdgePin
 *   near: v is the offset from the span's start; far: from its end;
 *   spring: the unrounded fraction of the middle.
 * @typedef {{x: [EdgePin, EdgePin], y: [EdgePin, EdgePin]}} Pin
 *   per axis, the near edge (left / top) then the far edge (right / bottom).
 */

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
 * @param {Frame} [frame]
 * @returns {Pin}
 */
export function pinOf(box, raster, frame = WINDOW_FRAME) {
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
 * through the anchor rule — the Sprite View's height changes under it on a
 * document switch, and that is no move); `min` is a resizable box's floor.
 * Whole system px, otherwise raw: the caller snaps onto its element's
 * lattice and applies the oversize intervention. Nothing clamps — see the
 * header.
 *
 * @param {Pin} pin
 * @param {{width: number, height: number}} raster
 * @param {Frame} [frame]
 * @param {{size?: {width: number, height: number}, min?: {width: number, height: number}}} [policy]
 * @returns {{left: number, top: number, width: number, height: number}}
 */
export function pinTo(pin, raster, frame = WINDOW_FRAME, { size, min } = {}) {
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
