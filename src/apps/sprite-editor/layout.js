// ---------------------------------------------------------------------------
// The SPRITE EDITOR's window arithmetic — PURE (no DOM, Node-tested): the
// numbers its windows (windows.js beside this file) and its windoids'
// components apply (sm-tool-strip, sm-atlas-view, sm-atlas-controls,
// sm-ring-controls). The desktop's landmarks, the cascade, the resize rule
// and its frame are the shell's (shell/layout.js); what is the Sprite
// Editor's here is its furniture and its choices — which box, which size,
// and what "zoomed" means for a document window:
//
//   initialPlacement() is the authored arrangement computed from the live
//   raster instead of hard-coded markup: the Tools palette top-left, in the
//   band left of the desktop's WINDOW_ORIGIN; the Full Sprite View over the
//   3D View as a right-hand RAIL below the options strip, both right-flush
//   at ONE width — the Sprite View at its FIXED size (SPRITE_WIDTH wide,
//   height via spriteHeightFor) and the 3D View under it, as wide, taking
//   what's left of the height — and the document window's box on the
//   desktop's WINDOW_ORIGIN, TOP-LEFT ALIGNED beside the Tools palette (same
//   top), filling the vacant middle but for the CASCADE ROOM it leaves at
//   the right and bottom, so every further window opens at the same size,
//   stepped down-right (the shell's cascadeFrom: the first slot no open
//   document window holds), without running into the rail or off the
//   bottom. This is the ONLY source of the application's window geometry:
//   nothing is restored from a prior session — a browser is resized and
//   reopened on another monitor all the time, so a remembered top/left is
//   no truth worth re-asserting over a raster that may be nothing like the
//   one it was dragged on. windows.js applies the placement at every boot
//   (the windoids) and every document open (the doc box), then the
//   manager's clamp.
//
//   zoomedBox() is the document windows' zoom-box arithmetic: the expanded
//   state for a window's HELD top-left — right and down to the vacant
//   middle's own edges (the rail's inset gutter, the bottom margin), the
//   same boundaries the doc box leaves its cascade room against — so a
//   zoomed window fills the open area without running under the rail.
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
//   height, at any size, WITHOUT widening the frame; its width is content,
//   not a fixed point (see docs/ring-size-plan.md). The one caveat: on a
//   raster shorter than the top band + the strip (~460 px at the default 64
//   tile, ~650 at a 255 one) its top edge reads as a top strut too and the
//   near edge wins — accepted, the placement itself floors there.
//
//   FRAME_BANDS are the furniture's hold on the resize rule: the windows'
//   frame (the shell's windowFrame — ONE frame for every window) cut in
//   BAND-thick outer slices but for its top and right bands, which this
//   application widens to hold the rail — the TOP band through the rail
//   head, the RIGHT band the rail column — and declares to the window
//   manager at its init. So every placed windoid is ALL STRUTS and the
//   placement is a fixed point of the rule: a resize lands the rail exactly
//   where initialPlacement would, with nothing remembering whether a window
//   was "touched" (the document window is content, not furniture: its
//   right and bottom edges spring with the vacancy).
// ---------------------------------------------------------------------------

import {
  CASCADE_SLOTS,
  CASCADE_STEP,
  TOP_RESERVE,
  WINDOW_ORIGIN,
} from '../../shell/layout.js';

const EDGE = 14; // side inset — the Tools palette's classic left, the rail's gutter
const GAP = 8; // vertical breathing room: between / below the rail

// The document-window cascade's ROOM: the doc box leaves exactly the
// shell's cascade (CASCADE_SLOTS of CASCADE_STEP) at the vacant middle's
// right and bottom, so every slot lands inside the vacancy — the last one
// flush with its edges — before the cascade wraps onto the first.
const CASCADE_ROOM = (CASCADE_SLOTS - 1) * CASCADE_STEP;
const DOC_MIN = 220; // the doc box's floor on a raster too small for the room

// --- the Tools palette's box ---------------------------------------------------
// The tool strip's cell is the tool ICON's own size — six 22×19 1-bit glyphs
// in src/assets/tools/, each filling its cell edge to edge (no margin: the
// icon IS the cell). sm-tool-strip states the vf-grid's cell and each
// vf-img at these numbers, and the windoid's box is the strip's arithmetic:
// one frameless column of six cells with 1px rules between (6 × 19 + 5 =
// 119) inside the chrome — the two 1px side borders (22 + 2 = 24 wide),
// the 12px dot bar + the top and bottom borders (119 + 14 = 133 tall).
// The windoid's markup AUTHORS the box as its width / height (the kit's
// grammar) at the same numbers as TOOLS_BOX, as it authors every header's
// height: change one, change the other. The palette floats in the band
// left of the desktop's WINDOW_ORIGIN (a 14 inset, its 24, 14), so the
// placement writes its position alone.
export const TOOL_CELL = { width: 22, height: 19 };
const TOOL_COUNT = 6;
const TOOLS_CHROME = { w: 2, h: 12 + 2 };
export const TOOLS_BOX = {
  width: TOOL_CELL.width + TOOLS_CHROME.w,
  height: TOOL_COUNT * TOOL_CELL.height + (TOOL_COUNT - 1) + TOOLS_CHROME.h,
};

// --- the windoids' HEADERS -----------------------------------------------------
// Every windoid's controls strip is the window's HEADER (vintage-frames
// 0.6.1's `slot="header"`: a white band over a 1px rule between the title
// bar and the body, across the whole window, a positioning anchor for what
// is placed in it; `header-height` counts its rule, as every kit bar does).
// The windoids' markup AUTHORS each height as `header-height` — the kit's
// grammar, the way it authors the Tools palette's box — and these are the
// same numbers as the arithmetic they enter: change one, change the other.
//
// The 3D View's: the kit's 20px checkbox row (rotate — the one toggle, a
// row stack in sm-stage-controls) centered in the 23 over the rule — 24.
export const STAGE_STRIP = 24;
// The Full Sprite View's: the FACE PICKER block — six 21px cube icons with
// 12px gaps (186) over the kit's 19px radio row under the 26px icons (45),
// sm-face-picker's own art — placed SPRITE_PICKER_PAD in from the header's
// top and as far above its rule: 8 + 45 + 8 over the rule = 62.
export const SPRITE_PICKER = { width: 186, height: 45 };
const SPRITE_PICKER_PAD = 8;
export const SPRITE_STRIP =
  SPRITE_PICKER_PAD + SPRITE_PICKER.height + SPRITE_PICKER_PAD + 1;

// --- the 3D View windoid's size floor --------------------------------------------
// In system px — the kit's own grow floor is a general 80×54, under which
// this windoid degenerates. Applied to every geometry that lands on it:
// boot (the smart placement on a tiny raster), the raster re-pin (the
// policy windows.js declares at adoption), and the grow box — DECLARED to
// it as the kit's size rect (vintage-frames 0.5.6: `min-width` /
// `min-height` bound the drag per axis, the way GrowWindow took the app's
// rectangle), so no correction ever runs after a vf-resize.
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
export const STAGE_MIN_WIDTH = STAGE_CHROME.w + STAGE_CANVAS_MIN; // 109
export const STAGE_MIN_HEIGHT = STAGE_CHROME.h + STAGE_CANVAS_MIN; // 160

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
// before a document is open (a live document's real tile wins — a dropped
// sheet can bring a non-square one).
export const TILE_RATIO = 1;

/** The Sprite View windoid's derived height for a window width and a tile
 *  height:width ratio. At SPRITE_WIDTH the per-column split is exactly
 *  ATLAS_GRID.cell — whole system px, the vf-grid's contract. */
export function spriteHeightFor(width, ratio = TILE_RATIO) {
  const { cols, rows } = ATLAS_GRID;
  const cellW = Math.max(0, width - SPRITE_CHROME.w - (cols - 1)) / cols;
  return rows * Math.round(cellW * ratio) + (rows - 1) + SPRITE_CHROME.h;
}

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
// kit's rule: the number is the column), so a renamed caption or a new
// display font means re-measuring the columns above.
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
// `header-height`, authored in its markup at this same number.
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
 * `ringViews` and `ringSize` seed the 3D Sprite Atlas windoid's box (the
 * natural row's width, the tile's height — the defaults mirror the ring
 * slice's); `ringShown` says whether that box is on screen — only then does
 * the doc box give up the strip's band (a hidden strip reserves nothing).
 * The Tools palette's size is its markup's (TOOLS_BOX): the placement
 * states its position alone.
 *
 * @param {number} desktopW
 * @param {number} desktopH
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
  { ringViews = 4, ringSize = 64, ringShown = false } = {}
) {
  const top = WINDOW_ORIGIN.top;

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
  // strip. The document window sits on the desktop's WINDOW_ORIGIN, beside
  // the palette's band, and fills the vacancy but for the cascade room at
  // the right and bottom, so each further window opens at this same size,
  // stepped down-right, inside the vacancy.
  const x0 = WINDOW_ORIGIN.left;
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

/** The windows' frame's two widened bands (see the header), declared to the
 *  window manager at this application's init: the TOP band runs through the
 *  rail head (the Sprite View's fixed height plus the gaps around it, so
 *  the 3D View's TOP edge is a strut — with a GAP of slack, since a lattice
 *  snap can move a placed edge a pixel or two and a band boundary is no
 *  place to park one), the RIGHT band is the rail column plus its inset
 *  gutter (so the rail's LEFT edges are struts, with the inset as slack).
 *  The square-tile sprite height is the constant here — a dropped
 *  non-square sheet can push the stage's top past the band, where it
 *  springs (rare, accepted). */
export const FRAME_BANDS = {
  top: WINDOW_ORIGIN.top - TOP_RESERVE + spriteHeightFor(SPRITE_WIDTH) + GAP + GAP,
  right: EDGE + SPRITE_WIDTH + EDGE,
};
