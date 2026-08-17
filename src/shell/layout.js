// ---------------------------------------------------------------------------
// The desktop's window arithmetic — PURE (no DOM, Node-tested), the numbers
// shell/windows.js applies:
//
//   initialPlacement() is the authored arrangement computed from the live
//   raster instead of hard-coded markup: the Tools palette top-left, the
//   Full Sprite View over the 3D View as a right-hand RAIL of 3:4 (w:h)
//   windoids splitting the height below the options strip, and a new
//   document window filling about two thirds of the vacant middle between
//   them, centered. windows.js applies these first, then any saved
//   geometry, then the clamp — a restored layout always wins.
//
//   pinOf() / pinTo() are the resize rule, and it is DELIBERATELY dumb:
//   left as a plain fraction of the raster width, top as a plain fraction
//   of the OPEN SPACE BELOW the options strip (the menu-bar + strip band is
//   fixed-height chrome, so the pin's y = 0 line is the strip's bottom edge
//   — a window tucked under the strip stays tucked under it instead of
//   sliding up beneath the menu bar on a shrink), read once (pinOf) and
//   re-expressed on any later raster (pinTo). No travel-range cleverness,
//   no clamping, no visibility guarantee — a window near an edge may hang
//   partly off a shrunk raster, and that is fine: the same fraction always
//   maps back exactly, so growing back returns it whole (a clamp would
//   rewrite the fraction at the small size and turn the round trip into a
//   drift — tried, rejected). The split into two functions matters:
//   windows.js keeps the UNROUNDED fraction as the per-window truth between
//   resize events, because re-deriving it each event from the just-rounded,
//   just-snapped position ratchets: the placement lattice's quantum is 2 or
//   4 system px at fractional display scales, and rounding onto it breaks
//   ties toward +∞ — a long resize drag walked every window down the
//   screen, one notch per odd landing, never back up.
// ---------------------------------------------------------------------------

// The raster band reserved above windows: the 20px menu bar plus the options
// strip's kit panel (a 37px band whose top border rides the bar's bottom
// rule, so its box bottoms out at 20 − 1 + 37 = 56) — a window clamped below
// it always keeps its title bar grabbable.
export const TOP_RESERVE = 56;

const EDGE = 14; // side inset — the Tools palette's classic left
const GAP = 8; // vertical breathing room: below the strip, between / below the rail

const RAIL_ASPECT = 3 / 4; // the rail windoids' width : height
const RAIL_MAX_W = 0.3; // …capped so a squat raster can't grow them past 30% wide
const DOC_FILL = 2 / 3; // the document window's share of the vacant middle

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

  // The right-hand rail: Full Sprite View over 3D View, each 3:4 (w:h),
  // splitting the height below the strip, right-flush behind a side inset.
  let railH = Math.floor((desktopH - TOP_RESERVE - 3 * GAP) / 2);
  let railW = Math.round(railH * RAIL_ASPECT);
  const maxW = Math.floor(desktopW * RAIL_MAX_W);
  if (railW > maxW) {
    railW = maxW;
    railH = Math.round(railW / RAIL_ASPECT);
  }
  railH = Math.max(100, railH); // an unusable raster still gets usable windows
  railW = Math.max(75, railW);
  const railLeft = Math.max(0, desktopW - EDGE - railW);
  const sprite = { left: railLeft, top, width: railW, height: railH };
  const stage = { left: railLeft, top: top + railH + GAP, width: railW, height: railH };

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
 * A window's relative pin: left as a plain (unrounded) fraction of the
 * raster width, top of the open space below the options strip. The caller
 * keeps this as the truth between resize events — see the header.
 *
 * @param {{left: number, top: number}} box
 * @param {{width: number, height: number}} raster
 * @returns {{fx: number, fy: number}}
 */
export function pinOf(box, raster) {
  return {
    fx: box.left / Math.max(1, raster.width),
    fy: (box.top - TOP_RESERVE) / Math.max(1, raster.height - TOP_RESERVE),
  };
}

/**
 * The pin re-expressed on a raster as a concrete top/left. Nothing clamps —
 * see the header.
 *
 * @param {{fx: number, fy: number}} pin
 * @param {{width: number, height: number}} raster
 * @returns {{left: number, top: number}}
 */
export function pinTo(pin, raster) {
  return {
    left: Math.round(pin.fx * raster.width),
    top: Math.round(TOP_RESERVE + pin.fy * Math.max(1, raster.height - TOP_RESERVE)),
  };
}
