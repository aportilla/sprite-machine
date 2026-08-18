// ---------------------------------------------------------------------------
// The desktop's window + icon arithmetic — PURE (no DOM, Node-tested), the
// numbers shell/windows.js and shell/icons.js apply:
//
//   initialPlacement() is the authored arrangement computed from the live
//   raster instead of hard-coded markup: the Tools palette top-left, the
//   Full Sprite View over the 3D View as a right-hand RAIL below the
//   options strip, both right-flush — the Sprite View at its FIXED size
//   (SPRITE_WIDTH wide, height via spriteHeightFor) and the 3D View taking
//   what's left of the height — and a new document window filling about two
//   thirds of the vacant middle between them, centered. windows.js applies
//   these first, then any saved geometry, then the clamp — a restored
//   layout always wins (position only, for the fixed-size Sprite View).
//
//   spriteHeightFor() is the Sprite View windoid's sizing rule: the windoid
//   is a fixed-size picture frame — no grow box — its width the face-picker
//   block's and its height derived through the atlas's own ratio plus the
//   fixed chrome, so the atlas exactly fills the body below the picker
//   strip (windows.js re-derives the height on document switches and
//   structural changes).
//
//   iconDefault() is the icons' half of the same idea: the classic
//   left-edge column below the Tools band, derived from the raster instead
//   of a fixed stack — it folds into further columns when the next cell
//   would run off a short raster's bottom.
//
//   pinOf() / pinTo() are the resize rule, and it is DELIBERATELY dumb:
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

const EDGE = 14; // side inset — the Tools palette's classic left
const GAP = 8; // vertical breathing room: below the strip, between / below the rail

const RAIL_ASPECT = 3 / 4; // the 3D View windoid's width : height (uncapped case)
const RAIL_MAX_W = 0.3; // …capped so a squat raster can't grow the rail past 30% wide
const DOC_FILL = 2 / 3; // the document window's share of the vacant middle

// --- the Full Sprite View windoid's fixed size --------------------------------
// The windoid is a fixed-size picture frame — no grow box: the face-picker
// block sets its width, and its height is DERIVED so the atlas image
// exactly fills the body below the picker strip. All system px, measured at
// scale 1 — if the picker strip or the window chrome changes, re-measure:
//   width chrome: the frame's two 1px side borders;
//   height chrome: 12 dot bar + 2 borders + 62 picker strip (26 icon + ~19
//   radio + 2×8 pad + 1 rule) = 76 — no status strip (the slot is empty,
//   so the kit draws no bottom bar).
export const SPRITE_CHROME = { w: 2, h: 76 };
// The windoid's width — the face-picker block (six 21px cells + five 12px
// gaps = 186) + the strip's 2×12 side padding + the 2 side borders, so the
// strip hugs the picker exactly.
export const SPRITE_WIDTH = 212;
// The square-tile 3×2 atlas's height : width — the ratio the sizing rule
// defaults to before a document is open (a live document's real atlas wins).
export const ATLAS_RATIO = 2 / 3;

/** The Sprite View windoid's derived height for a window width. */
export function spriteHeightFor(width, ratio = ATLAS_RATIO) {
  return Math.round(Math.max(0, width - SPRITE_CHROME.w) * ratio) + SPRITE_CHROME.h;
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

  // The right-hand rail: Full Sprite View over 3D View, both right-flush
  // behind a side inset, splitting the height below the strip. The sprite
  // windoid is FIXED-size (SPRITE_WIDTH wide, height derived —
  // spriteHeightFor); the stage takes the rest of the height, its width
  // aiming for 3:4 (w:h) of that, capped and floored.
  const span = desktopH - top - GAP; // the rail's vertical run
  const spriteH = spriteHeightFor(SPRITE_WIDTH);
  const stageH = Math.max(100, span - spriteH - GAP);
  let stageW = Math.round(stageH * RAIL_ASPECT);
  const maxW = Math.floor(desktopW * RAIL_MAX_W);
  if (stageW > maxW) stageW = maxW;
  stageW = Math.max(75, stageW); // an unusable raster still gets usable windows
  const sprite = {
    left: Math.max(0, desktopW - EDGE - SPRITE_WIDTH),
    top,
    width: SPRITE_WIDTH,
    height: spriteH,
  };
  const stage = {
    left: Math.max(0, desktopW - EDGE - stageW),
    top: top + spriteH + GAP,
    width: stageW,
    height: stageH,
  };
  // The vacant middle's right bound: the leftmost rail edge.
  const railLeft = Math.min(sprite.left, stage.left);

  // The vacant middle: between the Tools palette and the rail, below the
  // strip — the document window takes about two thirds of it, centered.
  const x0 = EDGE + tools.width + EDGE;
  const vacantW = Math.max(0, railLeft - EDGE - x0);
  const vacantH = Math.max(0, desktopH - GAP - top);
  const docW = Math.max(220, Math.round(vacantW * DOC_FILL));
  const docH = Math.max(220, Math.round(vacantH * DOC_FILL));
  const doc = {
    left: Math.max(0, x0 + Math.round((vacantW - docW) / 2)),
    top: Math.max(top, top + Math.round((vacantH - docH) / 2)),
    width: docW,
    height: docH,
  };

  return { tools: { left: EDGE, top }, sprite, stage, doc };
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
