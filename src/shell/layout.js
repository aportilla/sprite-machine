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
//   derived through the tile's own ratio plus the fixed chrome — the
//   picker's header (SPRITE_STRIP) included — so the grid exactly fills the
//   body below the header (windows.js re-derives the height on document
//   switches and structural changes).
//
//   RING_FIELDS is the 3D Sprite Atlas controls strip's DITL — the
//   controls' extent and every caption's and field's rectangle in whole
//   system px, from which the strip's height (RING_STRIP — the window's
//   header, vintage-frames 0.6.1) and the windoid's width floor
//   (RING_MIN_WIDTH) derive; sm-ring-controls.js places the items from it
//   against the header's corner, so nothing about the strip is measured.
//
//   ringHeightFor() / ringWidthFor() are the 3D Sprite Atlas windoid's — the
//   Sprite View's picture-frame idea turned sideways and half let go: its
//   HEIGHT is a derivation (RING_CHROME.h — the dot bar, the borders, the
//   two-row controls strip and the kit's horizontal scroll rail — over one
//   row of cells at the ring's TILE SIZE, the setting whose value is the
//   tile's edge in px; windows.js re-fits it as the size changes and
//   declares it to the grow box as the kit's size rect, min-height =
//   max-height, so the window resizes on the horizontal axis alone), while
//   its WIDTH is the user's: the placement seeds it with the natural row
//   (one cell per view — ringWidthFor — floored at the strip's content
//   width and capped at the vacant middle) and the grow box takes it from
//   there within the rect's min-width, the cell row scrolling under the
//   rail when it outgrows the window. The windoid is toggleable (View → 3D
//   Sprite Atlas, its close box) and boots hidden; initialPlacement DOCKS it
//   at the bottom margin, left-aligned with the doc box, and — only while
//   it is shown — takes its band out of the vacancy so a fresh open or
//   Arrange Windows lands the document clear of it (zoomedBox stops above
//   it the same way). In the resize rule it is a MIXED box: its y axis a
//   fixed size (the bottom edge in the bottom band, a far strut; the top
//   following through the anchor rule) and its x axis a resizable one
//   floored at the strip (the left edge in the left band, a near strut; the
//   right edge springing with the middle, like the document window's above
//   it) — so a resize keeps it docked at the document's left at its derived
//   height, at any size, WITHOUT touching WINDOW_FRAME; its width is
//   content, not a fixed point (see docs/ring-size-plan.md). The one
//   caveat: on a raster shorter than the top band + the strip (~460 px at
//   the default 64 tile, ~650 at a 255 one) its top edge reads as a top
//   strut too and the near edge wins — accepted, the placement itself
//   floors there.
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

// --- the windoids' HEADERS -----------------------------------------------------
// Every windoid's controls strip is the window's HEADER (vintage-frames
// 0.6.1's `slot="header"`: a white band over a 1px rule between the title
// bar and the body, across the whole window, a positioning anchor for what
// is placed in it; `header-height` counts its rule, as every kit bar does).
// index.html AUTHORS each height as `header-height` — the kit's grammar,
// the way it authors the Tools palette's box — and these are the same
// numbers as the arithmetic they enter; tools/drive.mjs pins the markup
// against them so the two can't drift.
//
// The 3D View's: the kit's 20px checkbox row (rotate / smooth, a row stack
// in sm-stage-controls) centered in the 23 over the rule — 24.
export const STAGE_STRIP = 24;
// The Full Sprite View's: the FACE PICKER block — six 21px cube icons with
// 12px gaps (186) over the kit's 19px radio row under the 26px icons (45),
// sm-face-picker's own art — placed SPRITE_PICKER_PAD in from the header's
// top and as far above its rule: 8 + 45 + 8 over the rule = 62.
export const SPRITE_PICKER = { width: 186, height: 45 };
const SPRITE_PICKER_PAD = 8;
export const SPRITE_STRIP =
  SPRITE_PICKER_PAD + SPRITE_PICKER.height + SPRITE_PICKER_PAD + 1;

// --- the Full Sprite View windoid's fixed size --------------------------------
// The windoid is a fixed-size picture frame — no grow box: the ATLAS GRID
// block sets its width, and its height is DERIVED so the grid exactly fills
// the body below the header. All system px — if the atlas grid, the picker
// or the window chrome changes, re-derive:
//   width chrome: the frame's two 1px side borders;
//   height chrome: 12 dot bar + 2 borders + SPRITE_STRIP header = 76 — no
//   status strip (the slot is empty, so the kit draws no bottom bar).
export const SPRITE_CHROME = { w: 2, h: 12 + 2 + SPRITE_STRIP };
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
// The picker block's rectangle in the header (sm-atlas-controls places it):
// centered across the header's interior — (212 − 186) / 2 = 13, whole by
// the fixed width — and the pad down from its top.
export const SPRITE_PICKER_AT = {
  left: (SPRITE_WIDTH - SPRITE_CHROME.w - SPRITE_PICKER.width) / 2,
  top: SPRITE_PICKER_PAD,
};
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

// --- the 3D Sprite Atlas windoid's derived size ---------------------------------
// The Sprite View's picture-frame rule turned sideways: one row of cells,
// each the ring's TILE SIZE square (the tile at 1:1 — one image px per
// system px), under the controls strip — the window's HEADER (vintage-frames
// 0.6.1's `slot="header"`: a white band over a 1px rule between the title
// bar and the body, outside the scroll area) — and over the kit's
// horizontal scroll rail (vf-window scrollbars="horizontal": the rail on
// the frame's bottom edge, 15 px inside the frame, the corner cell holding
// the grow box). All system px — if the rail or the window chrome changes,
// re-measure:
//   width chrome: the frame's two 1px side borders;
//   height chrome: 12 dot bar + 2 borders + RING_STRIP header + 15 rail =
//   92.
//
// The controls strip is a DITL: placed kit items, every rectangle stated
// here in whole system px against the header's corner (its positioning
// anchor), the way a dialog resource stated its items. sm-ring-controls.js
// places the items from these numbers and nothing in it is measured — so
// the controls' extent is arithmetic, and with it the header's height and
// the windoid's width floor. Two rows of caption + field pairs, views /
// elev over from / size (four labeled fields don't fit one row at a
// four-cell width):
//   the kit's number field is 74 × 25 — its input at 3.5em of the display
//   face's 16px em (56), its 3px gap and the 15px little-arrows stepper,
//   whose 25 is the host's height — and a caption's line box is the
//   display face's 16 (the kit's own metrics, stated once here);
//   down: the rows sit RING_ROW_PAD in from the header's top, as far
//   apart, as far above its rule — 4 + 25 + 4 + 25 + 4 = 62 — over the
//   header's 1px rule, 63 (header-height counts its rule, as every kit bar
//   does); a caption's top is its row's + (25 − 16) / 2 floored, 4,
//   which is also where the baselines meet: the caption's 12px ascent lands
//   16 below the row, the field's text (a 16px em on the well's 20px line,
//   the well 1 + 1 inside the host) at 1 + 1 + 2 + 12 = 16;
//   across: an 8px inset, a 40px caption column ("views" measures 40 in
//   Chicago 12, "from" 32), a 6px gap, the field, a 6px gap, a 36px caption
//   column ("elev" and "size" measure 28 — the extra 8, the captions
//   right-aligned in their columns, is the room between a field and the
//   next caption), a 6px gap, the field, an 8px inset — 8 + 40 + 6 + 74 +
//   6 + 36 + 6 + 74 + 8 = 258.
// A caption wider than its column overflows rather than reflowing (the
// kit's rule: the number is the column), so drive.mjs checks every item
// against the live glyphs — inside its column, inside the controls' box at
// the header's corner.
// (A third column once held the body's paper as three radios — white /
// black / gray, the kit's 20px toggle rows in a gap-0 stack, 57 wide, the
// box 321 — built and retired on 2026-09-03 at the user's call: white is
// the one paper for now, and the choice is meant to be made for the user
// one day from the sheet's own content, not asked; the setting itself
// stays in state/ring.js. The numbers are kept here for the day it needs
// a control again.)
export const RING_FIELD = { width: 74, height: 25 };
export const RING_CAPTION_HEIGHT = 16;
const RING_INSET = 8;
const RING_ROW_PAD = 4;
const RING_GAP = 6;
const RING_CAPTION_WIDTHS = [40, 36];
const ringRowTop = (i) => RING_ROW_PAD + i * (RING_FIELD.height + RING_ROW_PAD);
const ringCaption0 = RING_INSET;
const ringField0 = ringCaption0 + RING_CAPTION_WIDTHS[0] + RING_GAP;
const ringCaption1 = ringField0 + RING_FIELD.width + RING_GAP;
const ringField1 = ringCaption1 + RING_CAPTION_WIDTHS[1] + RING_GAP;
/** The strip's DITL: the controls' box (the header's interior); each row's
 *  field top; a caption's top below its row's; and per column the caption's
 *  left and width and the field's left. */
export const RING_FIELDS = {
  box: { width: ringField1 + RING_FIELD.width + RING_INSET, height: ringRowTop(2) },
  rows: [ringRowTop(0), ringRowTop(1)],
  captionDy: Math.floor((RING_FIELD.height - RING_CAPTION_HEIGHT) / 2),
  cols: [
    { caption: ringCaption0, width: RING_CAPTION_WIDTHS[0], field: ringField0 },
    { caption: ringCaption1, width: RING_CAPTION_WIDTHS[1], field: ringField1 },
  ],
};
// The strip: the controls over the header's 1px rule — the window's
// `header-height`, authored in index.html (the drive pins it to this).
export const RING_STRIP = RING_FIELDS.box.height + 1;
export const RING_CHROME = { w: 2, h: 12 + 2 + RING_STRIP + 15 };
// The windoid's width FLOOR (the grow box's declared min-width, and the
// placement's floor): the controls' box plus the 2 borders, so the header
// never clips a field. Four cells at the default 64 (256 + the borders =
// 258) fall two px short of it, so the default row seeds AT the floor, two
// px of the body's paper right of the last tile — a fifth view or a grow
// covers it. (With the grid's rules, the natural row cleared it by one.)
export const RING_MIN_WIDTH = RING_FIELDS.box.width + RING_CHROME.w;

/** The 3D Sprite Atlas windoid's height for a tile size: the chrome over
 *  one row of size-px cells — a derivation windows.js applies and declares
 *  as the grow box's locked axis (the drag moves the width alone). */
export function ringHeightFor(size) {
  return RING_CHROME.h + Math.max(1, Math.floor(size));
}

/** The ring ROW's own width: n cells of `size`, butted — the grid draws no
 *  rules (`rules="none"`; the windoid frame is its perimeter). The scroll
 *  range: the kit sizes its scrolled plane to the grid inside sm-ring-view's
 *  in-flow paper (the paper itself fills the plane — this width or the
 *  viewport's, whichever is wider). */
export function ringRowWidth(views, size) {
  const n = Math.max(1, Math.floor(views));
  const s = Math.max(1, Math.floor(size));
  return n * s;
}

/** A ring's NATURAL width: the row with the frame's borders, floored at the
 *  strip — the placement's seed for the windoid's width (the user's from
 *  there; a wider row scrolls). */
export function ringWidthFor(views, size) {
  return Math.max(RING_MIN_WIDTH, ringRowWidth(views, size) + RING_CHROME.w);
}

/**
 * The smart boot arrangement for a `desktopW`×`desktopH` system-px raster.
 * `tools` is the Tools palette's content-hugging authored size (the one box
 * this module doesn't compute — index.html owns it). `ringViews` and
 * `ringSize` seed the 3D Sprite Atlas windoid's box (the natural row's
 * width, the tile's height — the defaults mirror the ring slice's);
 * `ringShown` says whether that box is on screen — only then does the doc
 * box give up the strip's band (a hidden strip reserves nothing).
 *
 * @param {number} desktopW
 * @param {number} desktopH
 * @param {{width: number, height: number}} tools
 * @param {{ringViews?: number, ringSize?: number, ringShown?: boolean}} [opts]
 * @returns {{
 *   tools: {left: number, top: number},
 *   sprite: {left: number, top: number, width: number, height: number},
 *   stage: {left: number, top: number, width: number, height: number},
 *   ring: {left: number, top: number, width: number, height: number},
 *   doc: {left: number, top: number, width: number, height: number},
 * }}
 */
export function initialPlacement(
  desktopW,
  desktopH,
  tools,
  { ringViews = 4, ringSize = 64, ringShown = false } = {}
) {
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
  // The 3D Sprite Atlas strip: docked on the bottom margin, left-aligned
  // with the doc box (the document's footer), at the height its tile size
  // derives and the width its view count SEEDS — the natural row, capped at
  // the vacancy so a fresh strip never runs under the rail (the rail goes
  // live instead), floored at the strip; the user's from there. Placed
  // whether or not it is shown (a hidden windoid still has a place for when
  // it comes back).
  const ringH = ringHeightFor(ringSize);
  const ring = {
    left: x0,
    top: Math.max(top, desktopH - GAP - ringH),
    width: Math.max(RING_MIN_WIDTH, Math.min(ringWidthFor(ringViews, ringSize), vacantW)),
    height: ringH,
  };
  // While the strip is shown it takes its band + a GAP out of the vacancy's
  // height BEFORE the cascade room comes off, so every cascade slot still
  // lands above it (a sixth window that wraps is the existing rule).
  const vacantH = Math.max(0, desktopH - GAP - top - (ringShown ? ringH + GAP : 0));
  const doc = {
    left: x0,
    top,
    width: Math.max(DOC_MIN, vacantW - CASCADE_ROOM),
    height: Math.max(DOC_MIN, vacantH - CASCADE_ROOM),
  };

  return { tools: { left: EDGE, top }, sprite, stage, ring, doc };
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
 * off the raster, the resize rule's own recoverable-by-a-drag posture. With
 * the 3D Sprite Atlas strip shown (`ringShown`) the bottom edge stops a GAP
 * above the strip's band instead — a zoom never runs under it, the same
 * boundary the doc box leaves it.
 *
 * @param {number} desktopW
 * @param {number} desktopH
 * @param {{left: number, top: number}} pos
 * @param {{ringShown?: boolean, ringSize?: number}} [opts]
 * @returns {{left: number, top: number, width: number, height: number}}
 */
export function zoomedBox(
  desktopW,
  desktopH,
  pos,
  { ringShown = false, ringSize = 64 } = {}
) {
  const railLeft = Math.max(0, desktopW - EDGE - SPRITE_WIDTH);
  const bottom = desktopH - GAP - (ringShown ? ringHeightFor(ringSize) + GAP : 0);
  return {
    left: pos.left,
    top: pos.top,
    width: Math.max(DOC_MIN, railLeft - EDGE - pos.left),
    height: Math.max(DOC_MIN, bottom - pos.top),
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
 * Both are read PER AXIS: an axis given a size resolves as fixed, one given
 * a floor (or nothing) as resizable, so a box fixed on one axis and free on
 * the other — the 3D Sprite Atlas, a derived height over a user-sized width
 * — states both. Whole system px, otherwise raw: the caller snaps onto its
 * element's lattice and applies the oversize intervention. Nothing clamps —
 * see the header.
 *
 * @param {Pin} pin
 * @param {{width: number, height: number}} raster
 * @param {Frame} [frame]
 * @param {{size?: {width?: number, height?: number}, min?: {width?: number, height?: number}}} [policy]
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
