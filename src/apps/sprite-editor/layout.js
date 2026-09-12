// Sprite Editor window geometry (pure). All values are whole system px.
//
// - initialPlacement(): the Tools palette top-left, the Full Sprite View over the
//   3D View as a right-hand rail, the 3D Sprite Atlas strip docked at the bottom,
//   and the document box in the vacant middle, leaving room for the cascade.
// - zoomedBox(): a document window's zoomed box from its top-left.
// - spriteHeightFor(), ringHeightFor(), ringWidthFor(): derived windoid sizes.
// - RING_FIELDS: the 3D Sprite Atlas controls layout. RING_STRIP and
//   RING_MIN_WIDTH derive from it.
// - FRAME_BANDS: the widened top and right bands of the resize frame, which make
//   every placed windoid all struts.

import {
  CASCADE_SLOTS,
  CASCADE_STEP,
  TOP_RESERVE,
  WINDOW_ORIGIN,
} from '../../shell/layout.js';

const EDGE = 14; // side inset of the Tools palette and the rail
const GAP = 8; // vertical gap between and below the rail windows

// The doc box leaves room for the whole cascade at the right and bottom, so every
// slot fits in the vacancy before the cascade wraps.
const CASCADE_ROOM = (CASCADE_SLOTS - 1) * CASCADE_STEP;
const DOC_MIN = 220; // minimum doc box side

// Tools palette: one frameless column of six 22×19 icon cells with 1px rules
// between (119 tall), plus 1px side borders and a 12px bar with top and bottom
// borders. windows.html authors the same 24×133 as width and height.
export const TOOL_CELL = { width: 22, height: 19 };
const TOOL_COUNT = 6;
const TOOLS_CHROME = { w: 2, h: 12 + 2 };
export const TOOLS_BOX = {
  width: TOOL_CELL.width + TOOLS_CHROME.w,
  height: TOOL_COUNT * TOOL_CELL.height + (TOOL_COUNT - 1) + TOOLS_CHROME.h,
};

// Windoid header heights, including the header's 1px rule. windows.html authors
// the same values as header-height.
//
// 3D View: the kit's 20px checkbox row centered in 23, plus the rule.
export const STAGE_STRIP = 24;
// Full Sprite View: the face picker (six 21×26 cube icons with 12px gaps, 186
// wide, over the kit's 19px radio row, 45 tall), with 8px above and below, plus
// the rule.
export const SPRITE_PICKER = { width: 186, height: 45 };
const SPRITE_PICKER_PAD = 8;
export const SPRITE_STRIP =
  SPRITE_PICKER_PAD + SPRITE_PICKER.height + SPRITE_PICKER_PAD + 1;

// 3D View size floor: its chrome plus a 107px canvas on both axes. The chrome is 2
// across and 12 bar + 2 borders + STAGE_STRIP + 15 status down. The header's
// controls (77 wide) must fit within the width.
const STAGE_CHROME = { w: 2, h: 12 + 2 + STAGE_STRIP + 15 };
const STAGE_CANVAS_MIN = 107;
export const STAGE_MIN_WIDTH = STAGE_CHROME.w + STAGE_CANVAS_MIN; // 109
export const STAGE_MIN_HEIGHT = STAGE_CHROME.h + STAGE_CANVAS_MIN; // 160

// Full Sprite View: fixed size. The atlas grid sets the width, and the height is
// derived so the grid fills the body below the header. The chrome is 2 across and
// 12 bar + 2 borders + SPRITE_STRIP down, with no status bar.
export const SPRITE_CHROME = { w: 2, h: 12 + 2 + SPRITE_STRIP };
// sm-atlas-view's 3×2 grid of face tiles, `cell` px wide with 1px rules between.
// The cell height follows the active tile's ratio.
export const ATLAS_GRID = { cols: 3, rows: 2, cell: 70 };
// Three 70px cells, two 1px rules and two borders.
export const SPRITE_WIDTH = 214;
// The face picker's position in the header, centered across the interior.
export const SPRITE_PICKER_AT = {
  left: (SPRITE_WIDTH - SPRITE_CHROME.w - SPRITE_PICKER.width) / 2,
  top: SPRITE_PICKER_PAD,
};
// Tile height : width when no document is open.
export const TILE_RATIO = 1;

/** The Sprite View windoid's height for a window width and a tile height:width
 *  ratio. At SPRITE_WIDTH each cell is exactly ATLAS_GRID.cell wide. */
export function spriteHeightFor(width, ratio = TILE_RATIO) {
  const { cols, rows } = ATLAS_GRID;
  const cellW = Math.max(0, width - SPRITE_CHROME.w - (cols - 1)) / cols;
  return rows * Math.round(cellW * ratio) + (rows - 1) + SPRITE_CHROME.h;
}

// 3D Sprite Atlas: one row of cells, each the ring's tile size square, under the
// controls header and over the kit's 15px horizontal scroll rail. The chrome is 2
// across and 12 bar + 2 borders + RING_STRIP + 15 rail down.
//
// sm-ring-controls.js places the controls at these fixed rectangles. Two rows of
// caption and field pairs: views / elev, from / size.
// - The kit's number field is 74×25. A caption line is 16 tall.
// - Down: 4px above, between and below the rows (62), plus the 1px rule. A
//   caption sits (25 − 16) / 2 = 4 below its row's top, which aligns baselines.
// - Across: 8 inset, 40 caption, 6 gap, 74 field, 6 gap, 36 caption, 6 gap, 74
//   field, 8 inset = 258. In Chicago 12, "views" is 40 wide and "elev" and "size"
//   are 28. Captions are right-aligned and overflow when wider than their column,
//   so a renamed caption or a new font needs these widths re-measured.
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
/** The controls layout: the header interior's box, each row's field top, the
 *  caption offset below a row, and per column the caption's left and width and
 *  the field's left. */
export const RING_FIELDS = {
  box: { width: ringField1 + RING_FIELD.width + RING_INSET, height: ringRowTop(2) },
  rows: [ringRowTop(0), ringRowTop(1)],
  captionDy: Math.floor((RING_FIELD.height - RING_CAPTION_HEIGHT) / 2),
  cols: [
    { caption: ringCaption0, width: RING_CAPTION_WIDTHS[0], field: ringField0 },
    { caption: ringCaption1, width: RING_CAPTION_WIDTHS[1], field: ringField1 },
  ],
};
// Header height: the controls plus the 1px rule. windows.html authors the same
// value as header-height.
export const RING_STRIP = RING_FIELDS.box.height + 1;
export const RING_CHROME = { w: 2, h: 12 + 2 + RING_STRIP + 15 };
// Minimum windoid width: the controls box plus the borders. Four 64px cells plus
// the borders fall 2px short, so the default row seeds at this floor.
export const RING_MIN_WIDTH = RING_FIELDS.box.width + RING_CHROME.w;

/** The 3D Sprite Atlas windoid's height for a tile size: the chrome over one
 *  row of cells. */
export function ringHeightFor(size) {
  return RING_CHROME.h + Math.max(1, Math.floor(size));
}

/** The ring row's width: n cells of `size` with no rules between. */
export function ringRowWidth(views, size) {
  const n = Math.max(1, Math.floor(views));
  const s = Math.max(1, Math.floor(size));
  return n * s;
}

/** The ring windoid's natural width: the row plus the borders, floored at
 *  RING_MIN_WIDTH. The placement seeds the width with it. */
export function ringWidthFor(views, size) {
  return Math.max(RING_MIN_WIDTH, ringRowWidth(views, size) + RING_CHROME.w);
}

/**
 * The boot arrangement for a desktopW × desktopH raster. ringViews and ringSize
 * size the 3D Sprite Atlas strip, and the doc box leaves room for it only when
 * ringShown. The Tools palette gets a position only. Its size is TOOLS_BOX.
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

  // Right rail: the Full Sprite View at its fixed size over the 3D View, which
  // takes the remaining height.
  const span = desktopH - top - GAP; // rail height
  const spriteH = spriteHeightFor(SPRITE_WIDTH);
  const railLeft = Math.max(0, desktopW - EDGE - SPRITE_WIDTH);
  const sprite = { left: railLeft, top, width: SPRITE_WIDTH, height: spriteH };
  const stage = {
    left: railLeft,
    top: top + spriteH + GAP,
    width: SPRITE_WIDTH,
    height: Math.max(100, span - spriteH - GAP), // floor on a short raster
  };

  // The vacant middle, between the Tools palette and the rail.
  const x0 = WINDOW_ORIGIN.left;
  const vacantW = Math.max(0, railLeft - EDGE - x0);
  // The 3D Sprite Atlas strip, docked at the bottom and left-aligned with the doc
  // box. Its width is the natural row, capped at the vacancy and floored at
  // RING_MIN_WIDTH. It is placed even when hidden.
  const ringH = ringHeightFor(ringSize);
  const ring = {
    left: x0,
    top: Math.max(top, desktopH - GAP - ringH),
    width: Math.max(RING_MIN_WIDTH, Math.min(ringWidthFor(ringViews, ringSize), vacantW)),
    height: ringH,
  };
  // A shown strip takes its height plus GAP off the vacancy before the cascade
  // room, so every cascade slot stays above it.
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
 * A document window's zoomed box at `pos` on a desktopW × desktopH raster. The
 * top-left stays. The right edge stops at the rail's gutter, and the bottom at
 * the bottom margin or GAP above a shown 3D Sprite Atlas strip. Both sides are
 * floored at DOC_MIN.
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

/** The resize frame's widened bands, declared at init, so the rail windoids'
 *  edges are struts. The top band covers the rail head: the Sprite View's
 *  square-tile height, the GAP below it, and one GAP of slack for lattice
 *  snapping. The right band covers the rail column and its gutters. */
export const FRAME_BANDS = {
  top: WINDOW_ORIGIN.top - TOP_RESERVE + spriteHeightFor(SPRITE_WIDTH) + GAP + GAP,
  right: EDGE + SPRITE_WIDTH + EDGE,
};
