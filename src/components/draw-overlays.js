// Stateless canvas painters for <sm-draw-canvas>'s overlay layers: the pencil
// preview, the rect drag preview and the marching ants. They draw in system px,
// so a 1px mark is one system px. Every mark is opaque black or white except the
// ink previews.

import { brushRows, brushSpans } from '../lib/brush.js';
import { roundedRectRows } from '../lib/rect.js';
import { antsRuns, antsOutlineRuns } from '../lib/ants.js';

/** `scale` is whole system px per texel. `sysW`/`sysH` are the layer size in system px.
 *  @typedef {{tileW:number, tileH:number, scale:number, sysW:number, sysH:number}} OverlayView */

// The pencil's hover preview: the texels a stamp would paint, in the ink, clipped
// to the tile. It uses brushRows, as the stamp does. `t` null clears.
/** @param {CanvasRenderingContext2D} g @param {OverlayView} v
 *  @param {{px:number,py:number}|null} t @param {number} size
 *  @param {{r:number,g:number,b:number}} ink
 *  @param {string} [shape]  one of PENCIL_SHAPES */
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

// Marching ants around the texels a tip covers, following the tip's outline, so
// a circle tip is ringed as a disc. Used for the erase preview and the
// eyedropper's target. `t` null clears.
/** @param {CanvasRenderingContext2D} g @param {OverlayView} v
 *  @param {{px:number,py:number}|null} t @param {number} size
 *  @param {number} phase  the ants' phase
 *  @param {string} [shape]  one of PENCIL_SHAPES */
export function drawFootprintAnts(g, v, t, size, phase, shape = 'square') {
  g.clearRect(0, 0, v.sysW, v.sysH);
  if (!t) return;
  fillRuns(
    g,
    antsOutlineRuns(brushSpans(t.px, t.py, size, shape, v.tileW, v.tileH, v.scale), phase)
  );
}

// The rect drag preview: the texels the release will fill, in the ink. An erasing
// drag shows marching ants around the bounding box instead. `bounds` null clears.
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

// Marching ants: black and white dashes on a 1 system px ring along the bounds'
// outermost texels, advancing with `phase`. The ring is filled as whole-px rects
// from antsRuns, not stroked, so dash ends never anti-alias. Bounds off the tile
// clip at the canvas edge.
/** @param {CanvasRenderingContext2D} g @param {OverlayView} v
 *  @param {{x0:number,y0:number,x1:number,y1:number}|null} bounds  null clears
 *  @param {number} phase  0..ANTS_PERIOD−1 */
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
