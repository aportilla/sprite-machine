// ---------------------------------------------------------------------------
// 45°-only diagonalizer. Per color region, trace the boundary and replace 1:1
// STAIRCASE runs with exact 45° edges, while leaving structural corners and
// solid blocks (wheels, mirrors) sharp. Everything stays on the half-integer
// lattice, so nothing is ever an arbitrary/shallow plane.
//
// Rule: split the boundary into unit steps; a corner is BEVELLED (its vertex
// replaced by the two adjacent segment midpoints -> a 45° cut) iff it is part
// of a zigzag — its turn is opposite an immediately-adjacent corner's turn.
//   - staircase (alternating turns, unit steps) -> every corner bevelled -> a
//     continuous 45° edge.
//   - a 2x2 block / convex corner (same-direction turns, or long edges) -> no
//     opposite neighbour -> stays a sharp 90°.
// Pure: no THREE / no DOM.
// ---------------------------------------------------------------------------

import { marchingSquares } from './vectorize.js';

/** Group opaque pixels of `img` into per-color binary masks. */
export function colorRegions(img, alphaThreshold = 128) {
  const { width: w, height: h, data } = img;
  const masks = new Map(); // packed rgb (0xRRGGBB) -> Uint8Array(w*h)
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] < alphaThreshold) continue;
    const key = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
    let m = masks.get(key);
    if (!m) masks.set(key, (m = new Uint8Array(w * h)));
    m[i] = 1;
  }
  return masks;
}

// Expand a corner-lattice loop so every consecutive pair is a unit step.
function splitUnitSteps(loop) {
  const out = [];
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) || 1;
    const ux = (b[0] - a[0]) / steps, uy = (b[1] - a[1]) / steps;
    for (let s = 0; s < steps; s++) out.push([a[0] + ux * s, a[1] + uy * s]);
  }
  return out;
}

const cross = (ax, ay, bx, by) => Math.sign(ax * by - ay * bx);

// Drop vertices collinear with their neighbours (keeps corners + bevel ends).
function mergeCollinear(poly) {
  const n = poly.length;
  if (n < 3) return poly;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n], b = poly[i], c = poly[(i + 1) % n];
    if (cross(b[0] - a[0], b[1] - a[1], c[0] - b[0], c[1] - b[1]) !== 0) out.push(b);
  }
  return out.length >= 3 ? out : poly;
}

/**
 * Diagonalize one boundary loop into a 0/45/90-only polygon.
 * @param {Array<[number,number]>} loop  corner-lattice vertices (closed, no dup)
 * @returns {Array<[number,number]>}
 */
export function diagonalizeLoop(loop) {
  const V = splitUnitSteps(loop);
  const m = V.length;
  if (m < 4) return loop.slice();
  const dir = (i) => [V[(i + 1) % m][0] - V[i][0], V[(i + 1) % m][1] - V[i][1]];
  const turn = new Array(m);
  for (let i = 0; i < m; i++) {
    const din = dir((i - 1 + m) % m), dout = dir(i);
    turn[i] = cross(din[0], din[1], dout[0], dout[1]);
  }
  const cham = new Array(m);
  for (let i = 0; i < m; i++)
    cham[i] =
      turn[i] !== 0 &&
      (turn[(i - 1 + m) % m] === -turn[i] || turn[(i + 1) % m] === -turn[i]);

  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const out = [];
  for (let i = 0; i < m; i++) {
    if (!cham[i]) out.push(V[i]);
    else {
      out.push(mid(V[(i - 1 + m) % m], V[i]));
      out.push(mid(V[i], V[(i + 1) % m]));
    }
  }
  // dedupe consecutive duplicates (shared bevel midpoints), then merge collinear.
  const dd = [];
  for (let i = 0; i < out.length; i++) {
    const p = out[i], q = out[(i + 1) % out.length];
    if (Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9) continue;
    dd.push(p);
  }
  return mergeCollinear(dd);
}

/**
 * Diagonalize a whole view: one entry per color, each with its cleaned polygons
 * (outer + hole loops).
 * @returns {Array<{color:number, polys:Array<Array<[number,number]>>}>}
 */
export function diagonalizeView(img, opts = {}) {
  const out = [];
  for (const [color, mask] of colorRegions(img, opts.alphaThreshold)) {
    const loops = marchingSquares(mask, img.width, img.height);
    out.push({ color, polys: loops.map(diagonalizeLoop) });
  }
  return out;
}
