// ---------------------------------------------------------------------------
// Pure canvas painters for <sm-draw-canvas>'s two screen-res overlay layers:
// the alignment-guide hairlines, the pencil's hover-footprint outline, and the
// rect tool's live drag preview. Stateless — everything arrives as arguments —
// so the component keeps only gesture state and these stay trivially readable.
// All three draw in SCREEN space (the integer-scaled on-screen px), which is
// what keeps their 1px hairlines crisp at any texel scale.
// ---------------------------------------------------------------------------

import { brushBounds } from '../lib/brush.js';
import { roundedRectRows } from '../lib/rect.js';

// Hairline extent rules: translucent cyan so they read as guides distinct from
// the sprite art.
const GUIDE_COLOR = 'rgba(120, 200, 255, 0.6)';

/** @typedef {{tileW:number, tileH:number, scale:number, cssW:number, cssH:number}} OverlayView */

// Draw the four "furthest extent" hairlines into an OVERLAY context sized to the
// on-screen canvas. The lines box the region where a painted pixel can survive
// the carve: verticals at the outer edges of the supported columns, horizontals
// at the supported rows.
export function drawGuides(g, guides, scale, cssW, cssH) {
  g.clearRect(0, 0, cssW, cssH);
  if (!guides) return;
  const { uMin, uMax, vMin, vMax } = guides.extent;
  g.fillStyle = GUIDE_COLOR;
  const T = 1; // hairline thickness (screen px)
  if (uMin != null) g.fillRect(uMin * scale, 0, T, cssH); // left extent
  if (uMax != null) g.fillRect((uMax + 1) * scale - T, 0, T, cssH); // right extent
  if (vMin != null) g.fillRect(0, vMin * scale, cssW, T); // top extent
  if (vMax != null) g.fillRect(0, (vMax + 1) * scale - T, cssW, T); // bottom extent
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

// Hairline outline of the footprint the pencil would stamp. `t` null clears
// the layer (pointer left, or a tool with no hover footprint).
/** @param {CanvasRenderingContext2D} g @param {OverlayView} v
 *  @param {{px:number,py:number}|null} t @param {number} size @param {boolean} erasing */
export function drawCursorOutline(g, v, t, size, erasing) {
  g.clearRect(0, 0, v.cssW, v.cssH);
  if (!t) return;
  const b = brushBounds(t.px, t.py, size);
  const x0 = Math.max(0, b.x0);
  const y0 = Math.max(0, b.y0);
  const x1 = Math.min(v.tileW - 1, b.x1);
  const y1 = Math.min(v.tileH - 1, b.y1);
  if (x1 < x0 || y1 < y0) return;
  haloBox(
    g,
    x0 * v.scale + 0.5,
    y0 * v.scale + 0.5,
    (x1 - x0 + 1) * v.scale - 1,
    (y1 - y0 + 1) * v.scale - 1,
    erasing
  );
}

// Live preview of a rect drag: the exact texels a commit will fill (via the
// shared roundedRectRows — so rounded corners show precisely), tinted by the
// active ink (red while erasing), under a haloed hairline of the drag bounding
// box. `bounds` null clears the layer.
/** @param {CanvasRenderingContext2D} g @param {OverlayView} v
 *  @param {{x0:number,y0:number,x1:number,y1:number}|null} bounds
 *  @param {number} radius @param {{r:number,g:number,b:number}} ink @param {boolean} erasing */
export function drawRectPreview(g, v, bounds, radius, ink, erasing) {
  g.clearRect(0, 0, v.cssW, v.cssH);
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
