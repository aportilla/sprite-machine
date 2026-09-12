// ---------------------------------------------------------------------------
// The FINDER's geometry — PURE (no DOM, Node-tested): the numbers its icon
// layer (icons.js) and its folder windows (windows.js) apply. Where a folder
// window opens is the desktop's (the shell's cascadedBox from WINDOW_ORIGIN,
// shell/layout.js), and so is the resize rule (pinOf / pinTo); what is the
// Finder's here is its furniture:
//
//   THE LATTICE is every container's invisible grid — cell (0,0), the step
//   per column and per row, how many of each the container holds, and which
//   way the cells FILL — and it has two readers: latticeSlot() takes the
//   cell an arriving item goes in (the icon layer walks slots for the first
//   FREE one), and cleanUp() takes a whole container onto it, each icon to
//   the nearest free cell (the Finder's Clean Up — an alignment, never a
//   re-flow), walked in fillOrder(). desktopLattice() is the DESKTOP's, derived from the live
//   raster: a column down the RIGHT edge from just below the menu bar,
//   folding into further columns to the LEFT — where a Mac put a mounted
//   volume, and the direction the whole desktop is laid out from (Sep 12
//   2026; it was the left edge below the Tools band until then).
//   folderLattice() is a window's (the section below): a row from the
//   top-left corner, wrapping at the plane's width.
//
//   trashDefault() is the one icon whose default is not the lattice's next
//   free cell: the raster's bottom-right corner — the bottom of the same
//   column the desktop's lattice fills from the top, which is where System
//   7 kept it. Clean Up treats it as it treats any icon.
//
//   ICON_FRAME is the icons' frame for the resize rule: the whole desktop
//   below the MENU BAR (the options strip is the Sprite Editor's chrome,
//   hidden whenever the desktop takes focus, so it reserves nothing above
//   an icon), in uniform bands — no application's furniture lives in the
//   Finder's frame.
//
//   The FOLDER WINDOW's numbers (the section below): its header's anatomy,
//   its own lattice (folderLattice), its body's viewport (folderViewport)
//   and its field's extent (fieldExtent).
// ---------------------------------------------------------------------------

import { BAND, MENU_BAR } from '../../shell/layout.js';

// The lattice's pitches, shared by every container: the 64px icon plate
// plus a 16px gutter across, and the row pitch under it.
const ICON_ROW_PITCH = 72;
const ICON_COL_PITCH = 80; // the 64px icon plate + a 16px gutter
// The desktop lattice's inset from the raster's RIGHT and BOTTOM edges —
// the Trash's corner inset too.
const ICON_EDGE = 16;
// Its first row: the menu bar's band plus that same inset, where a Mac's
// disk icon sat. The band is the MENU BAR's, not TOP_RESERVE's: the options
// strip is the Sprite Editor's chrome and reserves nothing above an icon
// (see the header), so the column starts as high as the Finder's frame.
const ICON_TOP = MENU_BAR + ICON_EDGE;
// The cell an icon must fit inside the raster: its 64px plate (the label
// hugs under the art well inside it) — also the margin icons.js clamps by.
export const ICON_CELL = 64;

/**
 * @typedef {{left: number, top: number, dx: number, dy: number,
 *            cols: number, rows: number, down: boolean}} Lattice
 *   A container's invisible grid: cell (0,0)'s top-left, the step per
 *   column (NEGATIVE where the columns run leftward) and per row, how many
 *   of each the container holds (Infinity where they run as far as the
 *   icons do), and which way the cells FILL — `down` a column at a time
 *   (the desktop), else a row at a time (a folder window).
 */

/**
 * The DESKTOP's lattice on a raster `desktopW` × `desktopH` system px (see
 * the header): cell (0,0) at the top right, columns marching left, rows
 * down to the bottom edge's own inset. A squat raster folds the column
 * instead of marching a stack off the bottom; one too short for even a
 * single cell degrades to one row (icons.js's boot clamp pulls it into
 * frame), and one too narrow for a cell to its columns' first.
 *
 * @param {number} desktopW
 * @param {number} desktopH
 * @returns {Lattice}
 */
export function desktopLattice(desktopW, desktopH) {
  const left = Math.max(0, desktopW - ICON_EDGE - ICON_CELL);
  return {
    left,
    top: ICON_TOP,
    dx: -ICON_COL_PITCH,
    dy: ICON_ROW_PITCH,
    cols: Math.floor(left / ICON_COL_PITCH) + 1,
    rows: Math.max(
      1,
      Math.floor((desktopH - ICON_TOP - ICON_CELL - ICON_EDGE) / ICON_ROW_PITCH) + 1
    ),
    down: true,
  };
}

/** Cell (`col`, `row`) of a lattice — its top-left, whichever way the
 *  columns run. Never bounded here: the extent is the callers' (a slot past
 *  the last cell walks off the lattice, and icons.js's placement clamps it
 *  back on-raster).
 *  @param {Lattice} grid
 *  @param {number} col
 *  @param {number} row
 *  @returns {{left: number, top: number}} */
export function latticeCell(grid, col, row) {
  return { left: grid.left + col * grid.dx, top: grid.top + row * grid.dy };
}

/**
 * The default position for icon `slot` of a lattice: the cells taken in the
 * container's own fill order — down the column and on to the next one (the
 * desktop), or across the row and on to the next (a folder window). The
 * icon layer walks slots through this for the first cell no icon holds.
 *
 * @param {Lattice} grid
 * @param {number} slot
 * @returns {{left: number, top: number}}
 */
export function latticeSlot(grid, slot) {
  const major = grid.down ? grid.rows : grid.cols;
  const a = Math.floor(slot / major);
  const b = slot % major;
  return grid.down ? latticeCell(grid, a, b) : latticeCell(grid, b, a);
}

/**
 * Two positions in the lattice's own FILL order — down the column and on to
 * the next (the desktop), or across the row and on to the next (a folder
 * window) — negative when `a` comes first. The order Clean Up walks a
 * container in: the kit's walk (vf-icon-field.dragIcons) takes the page's
 * order as given, since which icon goes first is a statement about the
 * lattice, and the kit ships none. Each position is read at its nearest
 * cell, so a landing a snap or a clamp moved by a pixel still sorts true.
 *
 * @param {Lattice} grid
 * @param {{left: number, top: number}} a
 * @param {{left: number, top: number}} b
 * @returns {number}
 */
export function fillOrder(grid, a, b) {
  const col = (p) => Math.round((p.left - grid.left) / grid.dx);
  const row = (p) => Math.round((p.top - grid.top) / grid.dy);
  return grid.down
    ? col(a) - col(b) || row(a) - row(b)
    : row(a) - row(b) || col(a) - col(b);
}

/** A cell's index pair, clamped into the lattice's extent (an unbounded
 *  axis clamps at 0 alone). */
const cellIndex = (v, n) => Math.min(Math.max(Math.round(v), 0), n - 1);

/**
 * CLEAN UP (Sep 12 2026): a container's icons snapped onto its lattice —
 * each to the NEAREST FREE cell to where it already sits, so the
 * arrangement the user made survives and only its slop goes. The Finder's
 * Special → Clean Up Window / Clean Up Desktop.
 *
 * Each icon's ideal cell is its position rounded onto the lattice and
 * clamped into the extent, so an icon parked past the last column or row is
 * gathered back in. They are then served in the lattice's own reading order
 * (row, then column, then input order), each taking the nearest cell no
 * earlier one has claimed — searched outward from its ideal cell, nearest
 * by true pixel distance among the cells at the same remove — so two icons
 * that round onto one cell part instead of stacking, and the one that was
 * closest to it keeps it. A container with more icons than cells stacks the
 * overflow on its ideal cell; nothing else can be done with it.
 *
 * @param {Lattice} grid
 * @param {{left: number, top: number}[]} positions
 * @returns {{left: number, top: number}[]} one per input, in input order
 */
export function cleanUp(grid, positions) {
  const ideal = positions.map((p) => ({
    col: cellIndex((p.left - grid.left) / grid.dx, grid.cols),
    row: cellIndex((p.top - grid.top) / grid.dy, grid.rows),
  }));
  const order = positions
    .map((_, i) => i)
    .sort((a, b) => ideal[a].row - ideal[b].row || ideal[a].col - ideal[b].col || a - b);
  /** @type {Set<string>} the cells claimed so far */
  const taken = new Set();
  // How far the search may reach: past the lattice, or past a crowd of
  // icons all rounding onto one cell, whichever is further.
  const reach =
    Math.min(grid.cols, positions.length + 1) + Math.min(grid.rows, positions.length + 1);
  /** @type {{left: number, top: number}[]} */
  const out = [];
  for (const i of order) {
    const want = ideal[i];
    let best = want;
    for (let r = 0; r <= reach; r++) {
      let found = null;
      let nearest = Infinity;
      for (let col = want.col - r; col <= want.col + r; col++) {
        for (let row = want.row - r; row <= want.row + r; row++) {
          const ring = Math.max(Math.abs(col - want.col), Math.abs(row - want.row));
          if (ring !== r) continue; // the cells at this remove, no nearer ones
          if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) continue;
          if (taken.has(`${col},${row}`)) continue;
          const cell = latticeCell(grid, col, row);
          const d =
            (cell.left - positions[i].left) ** 2 + (cell.top - positions[i].top) ** 2;
          if (d < nearest) {
            nearest = d;
            found = { col, row };
          }
        }
      }
      if (found) {
        best = found;
        break;
      }
    }
    taken.add(`${best.col},${best.row}`);
    out[i] = latticeCell(grid, best.col, best.row);
  }
  return out;
}

/**
 * The Trash's default place (Sep 9 2026): the raster's bottom-right corner,
 * the lattice's own inset (ICON_EDGE) in from the right and bottom edges
 * with the cell inside — where System 7's Trash sat, at the bottom of the
 * same column the desktop's lattice fills from the top; the one icon whose
 * default is not the lattice's next free cell. A saved position wins, the
 * boot clamp pulls it on-raster, and the icon pin treats it like any icon
 * (a corner icon is two struts, so it stays in the corner). Floored at the
 * menu bar on a raster too short to hold it.
 *
 * @param {number} desktopW
 * @param {number} desktopH
 * @returns {{left: number, top: number}}
 */
export function trashDefault(desktopW, desktopH) {
  return {
    left: Math.max(0, desktopW - ICON_EDGE - ICON_CELL),
    top: Math.max(MENU_BAR, desktopH - ICON_EDGE - ICON_CELL),
  };
}

/** The icons' frame (see the header): the whole desktop below the menu
 *  bar, uniform bands.
 *  @type {import('../../shell/layout.js').Frame} */
export const ICON_FRAME = {
  reserve: MENU_BAR,
  bands: { left: BAND, top: BAND, right: BAND, bottom: BAND },
};

// --- folder windows (Sep 7 2026) ---------------------------------------------
// The Finder's window: a document-tier window, movable, resizable,
// scrollbars="both", its header line the item count and its body a placed
// vf-icon-field at the plane's origin. Its placement is the shell's
// cascadedBox: the desktop's WINDOW_ORIGIN, stepped down-right by the
// cascade per folder window already open when this one opened, at the
// window's authored size (windows.html states it, the placement takes it as
// input) — the FRESH placement: where a window with no record lands, and
// where Arrange Windows sends every one. A folder window's box PERSISTS
// (Sep 8 2026 — the Finder remembered every folder window's rect), as its
// nine-slice PIN (the shell's pinOf — relative terms, never the box), which
// the next open re-expresses on the raster it has then (windows.js,
// shell/desktop-state.js, the window manager's adopt). The other
// applications' windows still place fresh every session.
//
// The HEADER is the Finder's item-count line over the Finder's DOUBLE RULE
// — black, white, black — measured off System 7's own Finder window (a 2×
// Infinite Mac shot, Sep 8 2026): 17 rows of white paper, then the three
// rows, 20 in all. Two kit rules make it, no stylesheet: the count line is
// a `vf-container fill-width height=FOLDER_COUNT_LINE pattern="white"
// rule="bottom"` (the options strip's anatomy — 17 rows of paper over its
// own bottom rule, the divider's first line), the header's white shows for
// one row under it, and the header's own 1px rule closes it (header-height
// counts its rule, as every kit bar does): FOLDER_STRIP = 18 + 1 + 1. The
// count is one body-face label placed FOLDER_COUNT_AT in from the line's
// corner (the header's own — the container sits at the header's origin in
// flow; a caption's box stated here, sm-ring-controls' idiom): 8 in, and 2
// down so the body face's 12px line — Geneva 9's, its baseline 10 in —
// inks the Finder's rows 5–11 (a digit 7 tall, the x-height on 7–11),
// where the screenshot's digits sit. windows.html AUTHORS the three numbers
// (header-height, the container's height, the label's top); how it looks
// is for the eye (docs/TESTING.md), not a test.
//
// The ICON LATTICE inside a window (folderLattice) runs from the plane's
// origin: an inset, then the desktop's own pitch across and down (80 × 72:
// the 64px plate plus a 16px gutter across; the row pitch the desktop's own
// column uses), wrapping at the body's inner width as it stands when the
// icon first renders — a saved position wins from then on, and Clean Up
// Window takes every icon back onto it.
//
// The FIELD'S EXTENT (fieldExtent) is the body's viewport at least — so the
// rubber band reaches every visible px — grown to hold every icon plus the
// inset, so an icon placed past the viewport IS the scroll range (the kit
// sizes its plane to placed content). folderViewport is the body's inner
// box for a window size: the frame's 1px borders, the 18px title bar, the
// header, and the kit's 15px rails on the right and bottom edges
// (scrollbars="both"; the corner cell holds the grow box). All system px —
// if the kit's chrome changes, re-derive.
const FOLDER_COUNT_PAPER = 17; // the Finder's rows of paper over the divider
export const FOLDER_COUNT_AT = { left: 8, top: 2 };
/** The count line's box: its paper over its own rule, the divider's first line. */
export const FOLDER_COUNT_LINE = FOLDER_COUNT_PAPER + 1;
/** The header: the count line, the white row, the header's own rule. */
export const FOLDER_STRIP = FOLDER_COUNT_LINE + 1 + 1;
/** The Finder's "in the Trash" mark (Sep 9 2026): the user's 12×12 1-bit
 *  trash glyph (src/assets/trash-indicator.png, its ink in columns 1–10)
 *  at the head of the count line of the Trash's own window and every
 *  trashed folder's — System 7's header for a folder in the Trash. Its
 *  box; its place — the ink starting at the count's own inset, level with
 *  the label's top, so the glyph's twelve rows sit on 2–13 around the
 *  digits' 5–11 (first placed a row higher; the user's eye moved it down
 *  one, Sep 9 2026); and where the count moves to make room: the mark,
 *  then a gap of three. Numbers for the eye (windows.js places both). */
export const FOLDER_TRASH_MARK = { width: 12, height: 12 };
export const FOLDER_TRASH_MARK_AT = {
  left: FOLDER_COUNT_AT.left - 1,
  top: FOLDER_COUNT_AT.top,
};
export const FOLDER_COUNT_AT_TRASHED = {
  left: FOLDER_TRASH_MARK_AT.left + FOLDER_TRASH_MARK.width + 3,
  top: FOLDER_COUNT_AT.top,
};
const FOLDER_CHROME = { w: 2 + 15, h: 1 + 18 + FOLDER_STRIP + 15 + 1 };
const GRID_INSET = 16;

/**
 * A folder window body's inner box — the plane's viewport — for the
 * window's outer size: the chrome (borders, title bar, header, rails) off.
 * @param {{width: number, height: number}} size
 * @returns {{width: number, height: number}}
 */
export function folderViewport(size) {
  return {
    width: Math.max(0, size.width - FOLDER_CHROME.w),
    height: Math.max(0, size.height - FOLDER_CHROME.h),
  };
}

/**
 * A folder window's lattice, its plane `innerWidth` wide: rows from the
 * origin's inset, wrapping at the width, running as far down as the icons
 * do — the plane scrolls, and the field's extent follows them
 * (fieldExtent). The desktop's lattice turned around, and unchanged in
 * every number by the desktop's turn.
 * @param {number} innerWidth
 * @returns {Lattice}
 */
export function folderLattice(innerWidth) {
  return {
    left: GRID_INSET,
    top: GRID_INSET,
    dx: ICON_COL_PITCH,
    dy: ICON_ROW_PITCH,
    cols: Math.max(
      1,
      Math.floor((innerWidth - GRID_INSET - ICON_CELL) / ICON_COL_PITCH) + 1
    ),
    rows: Infinity,
    down: false,
  };
}

/**
 * A folder field's declared box: the viewport at least, grown to hold
 * every icon (`positions`, their top-lefts) plus the inset.
 * @param {{left: number, top: number}[]} positions
 * @param {{width: number, height: number}} viewport
 * @returns {{width: number, height: number}}
 */
export function fieldExtent(positions, viewport) {
  let width = viewport.width;
  let height = viewport.height;
  for (const p of positions) {
    width = Math.max(width, p.left + ICON_CELL + GRID_INSET);
    height = Math.max(height, p.top + ICON_CELL + GRID_INSET);
  }
  return { width, height };
}
