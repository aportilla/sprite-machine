// ---------------------------------------------------------------------------
// Pure canvas painters for <sm-draw-canvas>'s system-res layers: the
// alignment-guide hairlines, the pencil's filled hover-footprint preview, the
// eyedropper's sample-target outline, the rect tool's live drag preview, and
// the selection tool's marching ants. Stateless — everything arrives as
// arguments — so the component keeps only gesture state and these stay
// trivially readable.
// All draw in SYSTEM-px space — the kit's virtual pixel grid: the backings are
// tileW·k × tileH·k for a k-system-px texel, CSS-magnified nearest-neighbor in
// lockstep with the art, so their 1px hairlines are exactly one system px (the
// kit's own hairline unit), crisp at any display density or browser zoom. The
// canvas is 1-BIT BUT FOR THE ART: the paper under it is the kit's 50% dither
// (the transparency indicator — the stack container's own pattern, not a
// painter here) and everything here is black or white (the hover previews'
// ink tint and erase red are the exceptions — they preview the art itself),
// so the sprite is the only color on the page.
// ---------------------------------------------------------------------------

import { brushBounds } from '../lib/brush.js';
import { roundedRectRows } from '../lib/rect.js';

/** `scale` is whole system px per texel; `sysW`/`sysH` the layer in system px.
 *  @typedef {{tileW:number, tileH:number, scale:number, sysW:number, sysH:number}} OverlayView */

// Draw the four "furthest extent" hairlines — the guide layer's only painter
// (there are no lines over the art: the texel grid is the dithered paper's
// own lattice). SOLID BLACK, one system px: 1-bit like everything else on
// the canvas, opaque so a rule reads as one line on any art color, and a
// continuous run the eye picks out of the dithered paper (half its px
// coincide with the dither's black and the rest turn its white px black — a
// solid line through gray, the way MacPaint ruled over a fill). The lines
// box the region where a painted pixel can survive the carve: verticals at
// the outer edges of the supported columns — the left rule ON the first
// supported column's near edge (uMin·scale), the right rule one px INSIDE
// the last one's far edge ((uMax+1)·scale − T, so a far-edge extent still
// has a column to land on) — horizontals likewise. The caller clears the
// layer first.
export function drawGuides(g, guides, scale, sysW, sysH) {
  if (!guides) return;
  const { uMin, uMax, vMin, vMax } = guides.extent;
  const T = 1; // hairline thickness (1 system px — the kit's hairline unit)
  g.fillStyle = '#000';
  if (uMin != null) g.fillRect(uMin * scale, 0, T, sysH); // left extent
  if (uMax != null) g.fillRect((uMax + 1) * scale - T, 0, T, sysH); // right extent
  if (vMin != null) g.fillRect(0, vMin * scale, sysW, T); // top extent
  if (vMax != null) g.fillRect(0, (vMax + 1) * scale - T, sysW, T); // bottom extent
}

// The haloed hairline box both cursor overlays share: a dark halo so the
// outline reads on any art color, then the 1px line (red while erasing).
function haloBox(g, rx, ry, rw, rh, erasing) {
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  g.strokeRect(rx, ry, rw, rh);
  g.lineWidth = 1;
  g.strokeStyle = erasing ? 'rgba(255, 120, 120, 0.95)' : 'rgba(255, 255, 255, 0.95)';
  g.strokeRect(rx, ry, rw, rh);
}

// The clamped system-px rect of the brush footprint at `t`, or null when the
// whole footprint is off-tile. Both hover painters below share it.
function footprintRect(v, t, size) {
  const b = brushBounds(t.px, t.py, size);
  const x0 = Math.max(0, b.x0);
  const y0 = Math.max(0, b.y0);
  const x1 = Math.min(v.tileW - 1, b.x1);
  const y1 = Math.min(v.tileH - 1, b.y1);
  if (x1 < x0 || y1 < y0) return null;
  const s = v.scale;
  return { x: x0 * s, y: y0 * s, w: (x1 - x0 + 1) * s, h: (y1 - y0 + 1) * s };
}

// Hairline outline of the footprint a click would touch — the eyedropper's
// 1-cell sample target. `t` null clears the layer (pointer left, or a tool
// with no hover footprint).
/** @param {CanvasRenderingContext2D} g @param {OverlayView} v
 *  @param {{px:number,py:number}|null} t @param {number} size @param {boolean} erasing */
export function drawCursorOutline(g, v, t, size, erasing) {
  g.clearRect(0, 0, v.sysW, v.sysH);
  if (!t) return;
  const r = footprintRect(v, t, size);
  if (!r) return;
  haloBox(g, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, erasing);
}

// Filled preview of the footprint the pencil would stamp: the exact texels in
// the active ink at full opacity, so the hover shows precisely what a click
// would leave behind (the OS crosshair marks the position — no outline).
// Erasing can't show transparency on an overlay, so it keeps the rect tool's
// red-tinted treatment (translucent fill + haloed hairline). `t` null clears.
/** @param {CanvasRenderingContext2D} g @param {OverlayView} v
 *  @param {{px:number,py:number}|null} t @param {number} size
 *  @param {{r:number,g:number,b:number}} ink @param {boolean} erasing */
export function drawPencilPreview(g, v, t, size, ink, erasing) {
  g.clearRect(0, 0, v.sysW, v.sysH);
  if (!t) return;
  const r = footprintRect(v, t, size);
  if (!r) return;
  if (erasing) {
    g.fillStyle = 'rgba(255, 120, 120, 0.35)';
    g.fillRect(r.x, r.y, r.w, r.h);
    haloBox(g, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, true);
    return;
  }
  g.fillStyle = `rgb(${ink.r}, ${ink.g}, ${ink.b})`;
  g.fillRect(r.x, r.y, r.w, r.h);
}

// Live preview of a rect drag: the exact texels a commit will fill (via the
// shared roundedRectRows — so rounded corners show precisely), tinted by the
// active ink (red while erasing), under a haloed hairline of the drag bounding
// box. `bounds` null clears the layer.
/** @param {CanvasRenderingContext2D} g @param {OverlayView} v
 *  @param {{x0:number,y0:number,x1:number,y1:number}|null} bounds
 *  @param {number} radius @param {{r:number,g:number,b:number}} ink @param {boolean} erasing */
export function drawRectPreview(g, v, bounds, radius, ink, erasing) {
  g.clearRect(0, 0, v.sysW, v.sysH);
  if (!bounds) return;
  const s = v.scale;
  const b = bounds;
  g.fillStyle = erasing
    ? 'rgba(255, 120, 120, 0.35)'
    : `rgba(${ink.r}, ${ink.g}, ${ink.b}, 0.5)`;
  roundedRectRows(b.x0, b.y0, b.x1, b.y1, radius, (y, xl, xr) => {
    if (xr < xl) return; // empty row at an extreme radius
    g.fillRect(xl * s, y * s, (xr - xl + 1) * s, s);
  });
  haloBox(
    g,
    b.x0 * s + 0.5,
    b.y0 * s + 0.5,
    (b.x1 - b.x0 + 1) * s - 1,
    (b.y1 - b.y0 + 1) * s - 1,
    erasing
  );
}

// The selection tool's marching ants — MacPaint's 1-bit border: black and
// white dashes alternating along a 1-system-px line on the selection's
// outermost texel rows/columns (the haloBox alignment: half a px in, so the
// stroke covers exactly the edge pixels), readable on any art. The dash walks
// the perimeter continuously — strokeRect is one path, with the classic seam
// at the start corner — as `phase` grows; a bounds hanging off the tile clips
// at the canvas edge. ANTS_DASH is the on/off run in system px (an 8px
// period, so a phase of 0..7 covers one cycle).
export const ANTS_DASH = 4;

/** @param {CanvasRenderingContext2D} g @param {OverlayView} v
 *  @param {{x0:number,y0:number,x1:number,y1:number}|null} bounds  the CURRENT
 *    (translated) selection; null clears the layer
 *  @param {number} phase  0..7, advanced by the canvas's ticker */
export function drawMarchingAnts(g, v, bounds, phase) {
  g.clearRect(0, 0, v.sysW, v.sysH);
  if (!bounds) return;
  const s = v.scale;
  const x = bounds.x0 * s + 0.5;
  const y = bounds.y0 * s + 0.5;
  const w = (bounds.x1 - bounds.x0 + 1) * s - 1;
  const h = (bounds.y1 - bounds.y0 + 1) * s - 1;
  g.lineWidth = 1;
  g.setLineDash([]);
  g.strokeStyle = '#fff';
  g.strokeRect(x, y, w, h); // the white half of the 1-bit ants
  g.setLineDash([ANTS_DASH, ANTS_DASH]);
  g.lineDashOffset = -phase; // a growing offset marches the dashes
  g.strokeStyle = '#000';
  g.strokeRect(x, y, w, h); // the black half over it
  g.setLineDash([]);
  g.lineDashOffset = 0;
}
