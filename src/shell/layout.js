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
//   pinOf() / pinTo() are the resize rule for a window the user has MOVED
//   or resized (an untouched one simply follows the placement above onto
//   the new raster — windows.js), and it is DELIBERATELY dumb:
//   left as a plain fraction of the raster width, top as a plain fraction
//   of the open space below a fixed-height RESERVE band of chrome — so a
//   box riding the band's bottom edge stays riding it instead of sliding
//   up beneath the chrome on a shrink. The reserve names the frame:
//   TOP_RESERVE (the default) for windows — the menu bar plus the options
//   strip — and MENU_BAR for icons, which are the FINDER's furniture: the
//   options strip belongs to the application (it hides whenever the desktop
//   takes focus), so it reserves nothing above an icon. The pin is read
//   once (pinOf) and re-expressed on any later raster (pinTo). No
//   travel-range cleverness, no clamping, no visibility guarantee — a
//   window near an edge may hang partly off a shrunk raster, and that is
//   fine: the same fraction always maps back exactly, so growing back
//   returns it whole (a clamp would rewrite the fraction at the small size
//   and turn the round trip into a drift — tried, rejected). The split into
//   two functions matters: the callers keep the UNROUNDED fraction as the
//   per-box truth between resize events, because re-deriving it each event
//   from the just-rounded, just-snapped position ratchets: the placement
//   lattice's quantum is 2 or 4 system px at fractional display scales, and
//   rounding onto it breaks ties toward +∞ — a long resize drag walked
//   every window down the screen, one notch per odd landing, never back up.
// ---------------------------------------------------------------------------

// The raster band reserved above windows: the 20px menu bar plus the options
// strip's kit panel (a 37px band whose top border rides the bar's bottom
// rule, so its box bottoms out at 20 − 1 + 37 = 56) — a window clamped below
// it always keeps its title bar grabbable.
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

/**
 * A box's relative pin: left as a plain (unrounded) fraction of the raster
 * width, top of the open space below `reserve` — the fixed chrome band of
 * the caller's frame (TOP_RESERVE for windows, MENU_BAR for icons; see the
 * header). The caller keeps this as the truth between resize events.
 *
 * @param {{left: number, top: number}} box
 * @param {{width: number, height: number}} raster
 * @param {number} [reserve]
 * @returns {{fx: number, fy: number}}
 */
export function pinOf(box, raster, reserve = TOP_RESERVE) {
  return {
    fx: box.left / Math.max(1, raster.width),
    fy: (box.top - reserve) / Math.max(1, raster.height - reserve),
  };
}

/**
 * The pin re-expressed on a raster as a concrete top/left, in the same
 * `reserve` frame it was read in. Nothing clamps — see the header.
 *
 * @param {{fx: number, fy: number}} pin
 * @param {{width: number, height: number}} raster
 * @param {number} [reserve]
 * @returns {{left: number, top: number}}
 */
export function pinTo(pin, raster, reserve = TOP_RESERVE) {
  return {
    left: Math.round(pin.fx * raster.width),
    top: Math.round(reserve + pin.fy * Math.max(1, raster.height - reserve)),
  };
}
