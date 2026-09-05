// ---------------------------------------------------------------------------
// Pure canvas painters for <sm-draw-canvas>'s system-res layers: the pencil's
// filled hover-footprint preview, the rect tool's live drag preview, and the
// marching ants — the selection's ring, and the same ring around a footprint
// (the erase treatment's, the eyedropper's sample target). Stateless — everything arrives as
// arguments — so the component keeps only gesture state and these stay
// trivially readable.
// All draw in SYSTEM-px space — the kit's virtual pixel grid: the backings are
// tileW·k × tileH·k for a k-system-px texel, CSS-magnified nearest-neighbor in
// lockstep with the art, so their 1px hairlines are exactly one system px (the
// kit's own hairline unit), crisp at any display density or browser zoom. The
// canvas is 1-BIT BUT FOR THE ART: the paper under it is the kit's 12% dither
// (`gray-12`, a sparse dot field — the transparency indicator; the stack
// container's own pattern, not a painter here) and everything here is black
// or white (the ink previews are the one exception — they preview the art
// itself; every other mark is the ants ring, nothing translucent), so the
// sprite is the only color on the page.
// ---------------------------------------------------------------------------

import { brushRows, brushSpans } from '../lib/brush.js';
import { roundedRectRows } from '../lib/rect.js';
import { antsRuns, antsOutlineRuns } from '../lib/ants.js';

/** `scale` is whole system px per texel; `sysW`/`sysH` the layer in system px.
 *  @typedef {{tileW:number, tileH:number, scale:number, sysW:number, sysH:number}} OverlayView */

// There are no lines over the art — no texel lattice: the dotted paper alone
// shows through unpainted texels.

// Filled preview of the footprint the pencil would stamp: the exact texels in
// the active ink at full opacity, so the hover shows precisely what a click
// would leave behind (the OS crosshair marks the position — no outline) —
// the N×N box, or with a `'circle'` tip the disc inscribed in it, row by row
// through the same brushRows the stamp reads (lib/brush.js), clipped to the
// tile. An erasing footprint is drawFootprintAnts's. `t` null clears.
/** @param {CanvasRenderingContext2D} g @param {OverlayView} v
 *  @param {{px:number,py:number}|null} t @param {number} size
 *  @param {{r:number,g:number,b:number}} ink
 *  @param {string} [shape]  one of PENCIL_SHAPES; the square when omitted */
export function drawPencilPreview(g, v, t, size, ink, shape = 'square') {
  g.clearRect(0, 0, v.sysW, v.sysH);
  if (!t) return;
  const s = v.scale;
  g.fillStyle = `rgb(${ink.r}, ${ink.g}, ${ink.b})`;
  brushRows(t.px, t.py, size, shape, (y, xl, xr) => {
    if (y < 0 || y >= v.tileH) return;
    const x0 = Math.max(0, xl);
    const x1 = Math.min(v.tileW - 1, xr);
    if (x1 < x0) return;
    g.fillRect(x0 * s, y * s, (x1 - x0 + 1) * s, s);
  });
}

// The ants around a FOOTPRINT: the selection's own 1-bit ring (whole-px black
// and white runs, marching as `phase` grows) around the texels a tip covers
// — the tip's OWN outline: a circle tip's disc is ringed as a disc
// (lib/ants.js antsOutlineRuns walks the thin boundary of the clipped px
// spans lib/brush.js brushSpans states, the square's spans giving the
// selection's rectangle walk exactly) — no fill inside it, no halo around
// it, nothing translucent. Two wearers:
//   - THE ERASE TREATMENT: transparency can't be previewed on an overlay, so
//     an erase shows the ring around the texels it would clear (a translucent
//     red block under a red-lined haloed hairline said "something happens
//     here" where the ring says "this goes"; it went Sep 5 2026) — the
//     eraser's footprint under the pointer (hover and stroke), a right-button
//     pencil stroke's, and, through drawRectPreview, a rect drag erasing (a
//     box — drawMarchingAnts);
//   - the EYEDROPPER's sample target: the one texel a click would read (a
//     haloed hairline — a 45% black halo under a 95% white line, the last
//     translucent mark on the canvas — went the same day).
// `t` null clears; a footprint wholly off the tile draws nothing.
/** @param {CanvasRenderingContext2D} g @param {OverlayView} v
 *  @param {{px:number,py:number}|null} t @param {number} size
 *  @param {number} phase  the ants' phase — the canvas's one ticker's
 *  @param {string} [shape]  one of PENCIL_SHAPES; the square when omitted */
export function drawFootprintAnts(g, v, t, size, phase, shape = 'square') {
  g.clearRect(0, 0, v.sysW, v.sysH);
  if (!t) return;
  fillRuns(
    g,
    antsOutlineRuns(brushSpans(t.px, t.py, size, shape, v.tileW, v.tileH, v.scale), phase)
  );
}

// Live preview of a rect drag: the exact texels a commit will fill (via the
// shared roundedRectRows — so rounded corners show precisely) in the active
// ink at FULL opacity — the box exactly as the release will paint it and
// nothing else: no tint, no outline (a 50% ink tint under a haloed hairline of
// the drag bounding box went Sep 5 2026 — the paint itself reads the extent,
// the pencil's hover idiom). Erasing (a right-drag) wears the erase treatment
// (drawFootprintAnts above): the ants around the drag's bounding box — the
// rectangle walk the selection's ring is, so the corner texels a radius
// spares sit inside the ring rather than traced. `bounds` null clears the
// layer.
/** @param {CanvasRenderingContext2D} g @param {OverlayView} v
 *  @param {{x0:number,y0:number,x1:number,y1:number}|null} bounds
 *  @param {number} radius @param {{r:number,g:number,b:number}} ink
 *  @param {boolean} erasing @param {number} phase  the ants' phase while erasing */
export function drawRectPreview(g, v, bounds, radius, ink, erasing, phase) {
  if (erasing) {
    drawMarchingAnts(g, v, bounds, phase);
    return;
  }
  g.clearRect(0, 0, v.sysW, v.sysH);
  if (!bounds) return;
  const s = v.scale;
  const b = bounds;
  g.fillStyle = `rgb(${ink.r}, ${ink.g}, ${ink.b})`;
  roundedRectRows(b.x0, b.y0, b.x1, b.y1, radius, (y, xl, xr) => {
    if (xr < xl) return; // empty row at an extreme radius
    g.fillRect(xl * s, y * s, (xr - xl + 1) * s, s);
  });
}

// The marching ants — the selection's ring, and the footprint ring's wearers
// (drawFootprintAnts above) — MacPaint's 1-bit border: black and
// white dashes alternating along a 1-system-px ring on the bounds'
// outermost texel rows/columns, readable on any art, walking the perimeter
// continuously as `phase` grows (the classic seam at the start corner). The
// ring is FILLED, never stroked: `antsRuns` (src/lib/ants.js, pure) emits the
// clockwise walk as same-ink runs on whole system px, and a rect on whole
// coordinates cannot be anti-aliased — a dashed stroke sits its dash
// boundaries on half pixels and grays every dash's end px. A bounds hanging
// off the tile clips at the canvas edge.

/** @param {CanvasRenderingContext2D} g @param {OverlayView} v
 *  @param {{x0:number,y0:number,x1:number,y1:number}|null} bounds  the CURRENT
 *    (translated) selection, or the texels an erase would clear; null clears
 *    the layer
 *  @param {number} phase  0..ANTS_PERIOD−1, advanced by the canvas's ticker */
export function drawMarchingAnts(g, v, bounds, phase) {
  g.clearRect(0, 0, v.sysW, v.sysH);
  if (!bounds) return;
  const s = v.scale;
  fillRuns(
    g,
    antsRuns(
      {
        x: bounds.x0 * s,
        y: bounds.y0 * s,
        w: (bounds.x1 - bounds.x0 + 1) * s,
        h: (bounds.y1 - bounds.y0 + 1) * s,
      },
      phase
    )
  );
}

// The ring's runs onto the layer: every white run in one fill, every black
// run in another — whole-px rects, so nothing can anti-alias.
/** @param {CanvasRenderingContext2D} g
 *  @param {import('../lib/ants.js').AntsRun[]} runs */
function fillRuns(g, runs) {
  for (const black of [false, true]) {
    g.fillStyle = black ? '#000' : '#fff';
    g.beginPath();
    for (const r of runs) if (r.black === black) g.rect(r.x, r.y, r.w, r.h);
    g.fill();
  }
}
