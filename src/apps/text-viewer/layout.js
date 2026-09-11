// ---------------------------------------------------------------------------
// The TEXT VIEWER's geometry — PURE (no DOM): the read-me window's reading
// column, its zoom box's STANDARD state (Sep 11 2026). The window's
// placement is the desktop's — the shell's cascade from WINDOW_ORIGIN
// (shell/layout.js cascadedBox), called by windows.js at each open — and
// the way its zoom box reads the state at the click is the shell's
// nearness test (nearBox); what is the Text Viewer's here is which box
// "zoomed" is.
//
// A read-me's zoom box (windows.js) toggles between this box, System 7's
// STANDARD state — the size the application thinks best — and the user's
// own, the box it had before. A read-me reads best as a column: the desktop
// below the MENU BAR (the Text Viewer is front whenever its zoom box is
// clicked, so the options strip is hidden and the bar is the desktop's top
// edge), TEXT_EXPAND_PAD in from every edge, but never wider than
// TEXT_EXPAND_MAX_WIDTH — it fills the height of any raster, and on a wide
// one stands centered rather than running the width.
// ---------------------------------------------------------------------------

import { MENU_BAR } from '../../shell/layout.js';

const TEXT_EXPAND_PAD = 20;
const TEXT_EXPAND_MAX_WIDTH = 520;
// The column's floor on both axes: a tiny raster still expands to a
// workable box.
const TEXT_EXPAND_MIN = 220;

/**
 * A text window's expanded box on a `desktopW`×`desktopH` raster: the
 * desktop below the menu bar inset TEXT_EXPAND_PAD on every side, the width
 * capped at TEXT_EXPAND_MAX_WIDTH and the box centered across. Floored at
 * TEXT_EXPAND_MIN, so a tiny raster still expands to a workable box
 * (hanging off it, the resize rule's posture), its left edge never off the
 * raster's. Whole system px.
 *
 * @param {number} desktopW
 * @param {number} desktopH
 * @returns {{left: number, top: number, width: number, height: number}}
 */
export function expandedTextBox(desktopW, desktopH) {
  const top = MENU_BAR + TEXT_EXPAND_PAD;
  const width = Math.max(
    TEXT_EXPAND_MIN,
    Math.min(TEXT_EXPAND_MAX_WIDTH, desktopW - 2 * TEXT_EXPAND_PAD)
  );
  return {
    left: Math.max(0, Math.floor((desktopW - width) / 2)),
    top,
    width,
    height: Math.max(TEXT_EXPAND_MIN, desktopH - TEXT_EXPAND_PAD - top),
  };
}
