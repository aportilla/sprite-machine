// Sprite Editor window geometry (pure). All values are whole system px.
//
// - initialPlacement(): the Tools palette top-left over the Color Palette, the
//   Full Sprite View over a square 3D View as a right-hand rail, the 3D Sprite
//   Atlas strip docked at the bottom, and the document box in the vacant middle,
//   leaving room for the cascade.
// - zoomedBox(): a document window's zoomed box from its top-left.
// - spriteHeightFor(), ringHeightFor(), ringWidthFor(): derived windoid sizes.
// - paletteGrid(): the Color Palette's columns, rows and scrolled height.
// - paletteFit(): the Color Palette's size snapped back to its whole cells.
// - paletteStatus(): the Color Palette's status text.
// - RING_FIELDS: the 3D Sprite Atlas controls layout. RING_STRIP and
//   RING_MIN_WIDTH derive from it.
// - FRAME_BANDS: the widened left, top and right bands of the resize frame, which
//   make every placed windoid all struts.

import {
  CASCADE_SLOTS,
  CASCADE_STEP,
  TOP_RESERVE,
  WINDOW_ORIGIN,
} from '../../shell/layout.js';

const EDGE = 14; // side inset of the left column and the rail
const GAP = 8; // vertical gap between and below the rail windows

// The doc box leaves room for the whole cascade at the right and bottom, so every
// slot fits in the vacancy before the cascade wraps.
const CASCADE_ROOM = (CASCADE_SLOTS - 1) * CASCADE_STEP;
const DOC_MIN = 220; // minimum doc box side

// Tools palette: a frameless grid of six 22×19 icon cells, three across and two
// down, with 1px rules between (68×39), plus 1px side borders and a 12px bar with
// top and bottom borders. windows.html authors the same 70×53 as width and height.
export const TOOL_CELL = { width: 22, height: 19 };
export const TOOL_GRID = { cols: 3, rows: 2 };
const TOOLS_CHROME = { w: 2, h: 12 + 2 };
export const TOOLS_BOX = {
  width: TOOL_GRID.cols * (TOOL_CELL.width + 1) - 1 + TOOLS_CHROME.w,
  height: TOOL_GRID.rows * (TOOL_CELL.height + 1) - 1 + TOOLS_CHROME.h,
};

// Color Palette: square swatch cells, as many columns as the body is wide, over
// the kit's 15px vertical rail and 15px status strip. The chrome is 2 borders
// and the rail across, and 12 bar + 2 borders + 15 status down. The floor is one
// column by two rows. The placement is two columns by the rows the colors need,
// at least five, cut at the bottom margin.
export const PALETTE_CELL = 19;
const PALETTE_CHROME = { w: 2 + 15, h: 12 + 2 + 15 };
const PALETTE_PITCH = PALETTE_CELL + 1;
/** A window showing exactly `columns` × `rows` cells. */
const paletteBox = (columns, rows) => ({
  width: columns * PALETTE_PITCH - 1 + PALETTE_CHROME.w,
  height: rows * PALETTE_PITCH - 1 + PALETTE_CHROME.h,
});
const PALETTE_MIN_COLUMNS = 1;
const PALETTE_MIN_ROWS = 2;
const PALETTE_MIN = paletteBox(PALETTE_MIN_COLUMNS, PALETTE_MIN_ROWS);
export const PALETTE_MIN_WIDTH = PALETTE_MIN.width;
export const PALETTE_MIN_HEIGHT = PALETTE_MIN.height;
const PALETTE_PLACED = { columns: 2, rows: 5 };
const PALETTE_BOX = paletteBox(PALETTE_PLACED.columns, PALETTE_PLACED.rows);
/** The placed Color Palette's rows for `count` colors in a column `room` px
 *  tall. */
const paletteRows = (count, room) => {
  const fits = Math.floor((room - PALETTE_CHROME.h + 1) / PALETTE_PITCH);
  const needed = Math.ceil(count / PALETTE_PLACED.columns);
  return Math.max(PALETTE_PLACED.rows, Math.min(needed, fits));
};

// The left column holds the Tools palette over the Color Palette, each centered
// in it. The doc box's left edge is EDGE right of it.
const COLUMN_WIDTH = Math.max(TOOLS_BOX.width, PALETTE_BOX.width);
/** The left edge that centers a `width` wide windoid in the left column. */
const columnLeft = (width) => EDGE + Math.floor((COLUMN_WIDTH - width) / 2);
const DOC_LEFT = EDGE + COLUMN_WIDTH + EDGE;

/**
 * The Color Palette's status text for a window `width` wide listing `count`
 * colors: the count with its noun when the strip shows that whole, else the
 * bare count, else ''. The strip is 2 borders, a 6px inset and 21px of grow box
 * clearance around the text. In the body face a digit is 6 wide, a space 3,
 * "color" 23 and "colors" 28.
 *
 * @param {number} width
 * @param {number} count
 * @returns {string}
 */
export function paletteStatus(width, count) {
  const room = width - (2 + 6 + 21);
  const digits = 6 * String(count).length;
  const one = count === 1;
  if (digits + 3 + (one ? 23 : 28) <= room) return `${count} ${one ? 'color' : 'colors'}`;
  return digits <= room ? String(count) : '';
}

/**
 * The Color Palette's grid for a window `width` × `height` holding `count`
 * swatches. Cells share their borders, so n cells span n × PALETTE_PITCH − 1,
 * with the closing line one pixel past that.
 * - columns: the whole cells across the body, at least one.
 * - rows: enough for the swatches, and at least the whole rows the body holds,
 *   which show as empty cells.
 * - height: the scrolled plane. It holds the closing line while that fits the
 *   body, and stops short of it otherwise, so the line falls on the status
 *   strip's rule.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} count
 * @returns {{columns: number, rows: number, height: number}}
 */
export function paletteGrid(width, height, count) {
  const body = Math.max(0, height - PALETTE_CHROME.h);
  const columns = Math.max(1, Math.floor((width - PALETTE_CHROME.w + 1) / PALETTE_PITCH));
  const rows = Math.max(
    Math.ceil(count / columns),
    Math.floor((body + 1) / PALETTE_PITCH)
  );
  const span = rows * PALETTE_PITCH;
  return { columns, rows, height: span <= body ? span : span - 1 };
}

/**
 * The Color Palette's size snapped back to the whole columns and rows a
 * `width` × `height` window shows, floored at the size floors.
 *
 * @param {number} width
 * @param {number} height
 * @returns {{width: number, height: number}}
 */
export function paletteFit(width, height) {
  const columns = Math.floor((width - PALETTE_CHROME.w + 1) / PALETTE_PITCH);
  const rows = Math.floor((height - PALETTE_CHROME.h + 1) / PALETTE_PITCH);
  return paletteBox(
    Math.max(PALETTE_MIN_COLUMNS, columns),
    Math.max(PALETTE_MIN_ROWS, rows)
  );
}

// The Full Sprite View's face order, in the picker and in the tile row: mirror
// pairs side by side.
export const FACE_ROW = ['left', 'right', 'front', 'back', 'top', 'bottom'];
// sm-atlas-view's row of face tiles, `cell` px wide with 1px rules between. The
// cell height follows the active tile's ratio. `cell` is odd, so each picker icon
// centers on its tile in whole px.
export const ATLAS_GRID = { cols: FACE_ROW.length, rows: 1, cell: 35 };
const ATLAS_PITCH = ATLAS_GRID.cell + 1;

// Windoid header heights, including the header's 1px rule. windows.html authors
// the same values as header-height.
//
// 3D View: the kit's 20px checkbox row centered in 23, plus the rule.
export const STAGE_STRIP = 24;
// Full Sprite View: the face picker (six 21×26 cube icons over the kit's 19px
// radio row, 45 tall), with 8px above and below, plus the rule. The icons step
// at the tile pitch, so each sits over its tile.
const FACE_ICON_WIDTH = 21;
const SPRITE_PICKER_GAP = ATLAS_PITCH - FACE_ICON_WIDTH; // 15
export const SPRITE_PICKER = {
  width: FACE_ROW.length * ATLAS_PITCH - SPRITE_PICKER_GAP, // 201
  height: 45,
  gap: SPRITE_PICKER_GAP,
};
const SPRITE_PICKER_PAD = 8;
export const SPRITE_STRIP =
  SPRITE_PICKER_PAD + SPRITE_PICKER.height + SPRITE_PICKER_PAD + 1;

// 3D View size floor: its chrome around the header's row across and a 107px
// canvas down. The chrome is 2 across and 12 bar + 2 borders + STAGE_STRIP + 15
// status down. The row (sm-stage-controls.js) is two checkboxes 12 apart inside
// 8px insets, each a 13px box and a 6px gap before its label. In the display
// face, "rotate" is 42 wide and "single layer" 77.
const STAGE_CHROME = { w: 2, h: 12 + 2 + STAGE_STRIP + 15 };
const STAGE_CHECKBOX = 13 + 6;
const STAGE_ROW = 8 + STAGE_CHECKBOX + 42 + 12 + STAGE_CHECKBOX + 77 + 8; // 185
const STAGE_CANVAS_MIN = 107;
export const STAGE_MIN_WIDTH = STAGE_CHROME.w + STAGE_ROW; // 187
export const STAGE_MIN_HEIGHT = STAGE_CHROME.h + STAGE_CANVAS_MIN; // 160

// Full Sprite View: fixed size. The tile row sets the width, and the height is
// derived so the row fills the body below the header. The chrome is 2 across and
// 12 bar + 2 borders + SPRITE_STRIP down, with no status bar.
export const SPRITE_CHROME = { w: 2, h: 12 + 2 + SPRITE_STRIP };
// The cells, the rules between them and the borders.
export const SPRITE_WIDTH = ATLAS_GRID.cols * ATLAS_PITCH - 1 + SPRITE_CHROME.w; // 217
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

/** The height the bottom band takes off the vacancy, GAP included: the shown
 *  strip's, or none. */
function bottomBand({ ringSize, ringShown }) {
  return ringShown ? ringHeightFor(ringSize) + GAP : 0;
}

/**
 * The boot arrangement for a desktopW × desktopH raster. ringViews and ringSize
 * size the 3D Sprite Atlas strip, and the doc box leaves room for it only when
 * ringShown. paletteCount sets the Color Palette's rows. The Tools palette gets
 * a position only. Its size is TOOLS_BOX.
 *
 * @param {number} desktopW
 * @param {number} desktopH
 * @param {{ringViews?: number, ringSize?: number, ringShown?: boolean, paletteCount?: number}} [opts]
 * @returns {{
 *   tools: {left: number, top: number},
 *   palette: {left: number, top: number, width: number, height: number},
 *   sprite: {left: number, top: number, width: number, height: number},
 *   stage: {left: number, top: number, width: number, height: number},
 *   ring: {left: number, top: number, width: number, height: number},
 *   doc: {left: number, top: number, width: number, height: number},
 * }}
 */
export function initialPlacement(
  desktopW,
  desktopH,
  { ringViews = 4, ringSize = 64, ringShown = false, paletteCount = 0 } = {}
) {
  const top = WINDOW_ORIGIN.top;

  // Right rail: the Full Sprite View at its fixed size over the 3D View. The 3D
  // View is square, shortened to end above the bottom margin, down to the size
  // floor.
  const span = desktopH - top - GAP; // rail height
  const spriteH = spriteHeightFor(SPRITE_WIDTH);
  const railLeft = Math.max(0, desktopW - EDGE - SPRITE_WIDTH);
  const sprite = { left: railLeft, top, width: SPRITE_WIDTH, height: spriteH };
  const stage = {
    left: railLeft,
    top: top + spriteH + GAP,
    width: SPRITE_WIDTH,
    height: Math.max(STAGE_MIN_HEIGHT, Math.min(SPRITE_WIDTH, span - spriteH - GAP)),
  };

  // The left column: the Color Palette GAP under the Tools palette, down to the
  // bottom margin at most.
  const tools = { left: columnLeft(TOOLS_BOX.width), top };
  const paletteTop = top + TOOLS_BOX.height + GAP;
  const palette = {
    left: columnLeft(PALETTE_BOX.width),
    top: paletteTop,
    ...paletteBox(
      PALETTE_PLACED.columns,
      paletteRows(paletteCount, desktopH - GAP - paletteTop)
    ),
  };

  // The vacant middle, between the left column and the rail.
  const x0 = DOC_LEFT;
  const vacantW = Math.max(0, railLeft - EDGE - x0);
  // The 3D Sprite Atlas strip, on the bottom margin and left-aligned with the doc
  // box, placed even when hidden. Its width is the natural row, capped at the
  // vacancy and floored at RING_MIN_WIDTH.
  const ringH = ringHeightFor(ringSize);
  const ring = {
    left: x0,
    top: Math.max(top, desktopH - GAP - ringH),
    width: Math.max(RING_MIN_WIDTH, Math.min(ringWidthFor(ringViews, ringSize), vacantW)),
    height: ringH,
  };
  // A shown strip comes off the vacancy before the cascade room, so every cascade
  // slot stays above it.
  const vacantH = Math.max(0, desktopH - GAP - top - bottomBand({ ringSize, ringShown }));
  const doc = {
    left: x0,
    top,
    width: Math.max(DOC_MIN, vacantW - CASCADE_ROOM),
    height: Math.max(DOC_MIN, vacantH - CASCADE_ROOM),
  };

  return { tools, palette, sprite, stage, ring, doc };
}

/**
 * A document window's zoomed box at `pos` on a desktopW × desktopH raster. The
 * top-left stays. The right edge stops at the rail's gutter, and the bottom at
 * the bottom margin or GAP above a shown strip. Both sides are floored at
 * DOC_MIN.
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
  const bottom = desktopH - GAP - bottomBand({ ringSize, ringShown });
  return {
    left: pos.left,
    top: pos.top,
    width: Math.max(DOC_MIN, railLeft - EDGE - pos.left),
    height: Math.max(DOC_MIN, bottom - pos.top),
  };
}

/** The resize frame's widened bands, declared at init, so the docked windoids'
 *  edges are struts. The left band covers the left column and the left edge of
 *  the doc box and the strip, with one GAP of slack for lattice snapping. The
 *  top band covers the rail head: the Sprite View's square-tile height, the GAP
 *  below it, and one GAP of slack. It also holds the Color Palette's top edge.
 *  The right band covers the rail column and its gutters. */
export const FRAME_BANDS = {
  left: DOC_LEFT + GAP,
  top: WINDOW_ORIGIN.top - TOP_RESERVE + spriteHeightFor(SPRITE_WIDTH) + GAP + GAP,
  right: EDGE + SPRITE_WIDTH + EDGE,
};
