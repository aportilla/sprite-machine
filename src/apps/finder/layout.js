// ---------------------------------------------------------------------------
// The FINDER's geometry — PURE (no DOM, Node-tested): the numbers its icon
// layer (icons.js) and its folder windows (windows.js) apply. Where a folder
// window opens is the desktop's (the shell's cascadedBox from WINDOW_ORIGIN,
// shell/layout.js), and so is the resize rule (pinOf / pinTo); what is the
// Finder's here is its furniture:
//
//   iconDefault() is the desktop's default icon lattice: the classic
//   left-edge column, derived from the raster instead of a fixed stack — it
//   folds into further columns when the next cell would run off a short
//   raster's bottom. trashDefault() is the one icon whose default is not
//   the lattice's: the raster's bottom-right corner.
//
//   ICON_FRAME is the icons' frame for the resize rule: the whole desktop
//   below the MENU BAR (the options strip is the Sprite Editor's chrome,
//   hidden whenever the desktop takes focus, so it reserves nothing above
//   an icon), in uniform bands — no application's furniture lives in the
//   Finder's frame.
//
//   The FOLDER WINDOW's numbers (the section below): its header's anatomy,
//   the icon lattice inside it (iconGridDefault), its body's viewport
//   (folderViewport) and its field's extent (fieldExtent).
// ---------------------------------------------------------------------------

import { BAND, MENU_BAR } from '../../shell/layout.js';

// The default icon lattice: columns from the left edge, below the band the
// Sprite Editor floats its Tools palette in.
const ICON_COL_X = 16;
const ICON_ROW_Y0 = 340;
const ICON_ROW_PITCH = 72;
const ICON_COL_PITCH = 80; // the 64px icon plate + a 16px gutter
// The cell an icon must fit inside the raster: its 64px plate (the label
// hugs under the art well inside it) — also the margin icons.js clamps by.
export const ICON_CELL = 64;

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
 * The Trash's default place (Sep 9 2026): the raster's bottom-right corner,
 * the icon column's own inset (ICON_COL_X) in from the right and bottom
 * edges with the cell inside — where System 7's Trash sat; the one icon
 * whose default is not the lattice's next free cell. A saved position wins,
 * the boot clamp pulls it on-raster, and the icon pin treats it like any
 * icon (a corner icon is two struts, so it stays in the corner). Floored
 * at the menu bar on a raster too short to hold it.
 *
 * @param {number} desktopW
 * @param {number} desktopH
 * @returns {{left: number, top: number}}
 */
export function trashDefault(desktopW, desktopH) {
  return {
    left: Math.max(0, desktopW - ICON_COL_X - ICON_CELL),
    top: Math.max(MENU_BAR, desktopH - ICON_COL_X - ICON_CELL),
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
// The ICON LATTICE inside a window (iconGridDefault) runs from the plane's
// origin: an inset, then the desktop's own pitch across and down (80 × 72:
// the 64px plate plus a 16px gutter across; the row pitch every icon column
// on the desktop uses), wrapping at the body's inner width as it stands when
// the icon first renders — a saved position wins from then on.
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
 * The default position for icon `slot` inside a folder window whose plane
 * is `innerWidth` wide: rows from the origin, wrapping at the width.
 * @param {number} slot
 * @param {number} innerWidth
 * @returns {{left: number, top: number}}
 */
export function iconGridDefault(slot, innerWidth) {
  const cols = Math.max(
    1,
    Math.floor((innerWidth - GRID_INSET - ICON_CELL) / ICON_COL_PITCH) + 1
  );
  return {
    left: GRID_INSET + (slot % cols) * ICON_COL_PITCH,
    top: GRID_INSET + Math.floor(slot / cols) * ICON_ROW_PITCH,
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
