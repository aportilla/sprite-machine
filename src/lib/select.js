// Selection-tool primitives over RGBA buffers.
//
// Bounds are an inclusive texel rectangle {x0,y0,x1,y1}. A move lifts the
// marquee's texels into a float (liftRect), clears the hole (clearRect) and
// composites the float over that base at each offset (compositeFloat), so a
// drag never smears what it crosses.
//
// Transparent float texels (alpha 0) never overwrite the base. Only the composite
// clips, per texel on both axes. The float keeps its off-tile texels, and a texel
// past the right edge never wraps onto the next row.

import { writeKey } from './fill.js';

/** @typedef {{x0:number,y0:number,x1:number,y1:number}} Bounds */
/** @typedef {{width:number,height:number,data:Uint8ClampedArray,opaque:number}} Float */

const TRANSPARENT = { transparent: true };

/**
 * Two texel corners as inclusive bounds, top-left to bottom-right.
 * @param {{px:number,py:number}} a @param {{px:number,py:number}} b
 * @returns {Bounds}
 */
export function normalizeBounds(a, b) {
  return {
    x0: Math.min(a.px, b.px),
    y0: Math.min(a.py, b.py),
    x1: Math.max(a.px, b.px),
    y1: Math.max(a.py, b.py),
  };
}

/**
 * Whether texel (px,py) lies inside inclusive bounds.
 * @param {Bounds} b @param {number} px @param {number} py
 */
export function boundsContain(b, px, py) {
  return px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1;
}

/**
 * Bounds shifted by (dx,dy), unclamped.
 * @param {Bounds} b @param {number} dx @param {number} dy
 * @returns {Bounds}
 */
export function translateBounds(b, dx, dy) {
  return { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy };
}

/**
 * Shift axis lock for a move delta: keep the larger axis and zero the other. A
 * tie keeps dx.
 * @param {number} dx @param {number} dy
 * @returns {{dx:number,dy:number}}
 */
export function constrainAxis(dx, dy) {
  return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy };
}

/**
 * Copy the rect out of a w-wide RGBA buffer, counting its opaque (alpha ≠ 0)
 * texels. Bounds must lie inside the tile. `data` is not modified.
 * @param {Uint8ClampedArray} data @param {number} w @param {Bounds} b
 * @returns {Float}
 */
export function liftRect(data, w, b) {
  const width = b.x1 - b.x0 + 1;
  const height = b.y1 - b.y0 + 1;
  const out = new Uint8ClampedArray(width * height * 4);
  let opaque = 0;
  for (let y = 0; y < height; y++) {
    const src = ((b.y0 + y) * w + b.x0) * 4;
    out.set(data.subarray(src, src + width * 4), y * width * 4);
  }
  for (let i = 3; i < out.length; i += 4) if (out[i] !== 0) opaque++;
  return { width, height, data: out, opaque };
}

/**
 * Clear the rect to all-zero bytes, in place. Returns whether any byte changed.
 * Bounds must lie inside the tile.
 * @param {Uint8ClampedArray} data @param {number} w @param {Bounds} b
 * @returns {boolean}
 */
export function clearRect(data, w, b) {
  let changed = false;
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const i = (y * w + x) * 4;
      if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0 || data[i + 3] !== 0) {
        writeKey(data, i, TRANSPARENT);
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * Copy `base` into `out`, then write each opaque texel of `float` at
 * (ox + x, oy + y) where that lies inside the w×h tile.
 * @param {Uint8ClampedArray} out @param {Uint8ClampedArray} base
 * @param {number} w @param {number} h @param {Float} float
 * @param {number} ox @param {number} oy
 */
export function compositeFloat(out, base, w, h, float, ox, oy) {
  if (out !== base) out.set(base);
  const f = float.data;
  const fw = float.width;
  // Clip the float's rect to the tile.
  const x0 = Math.max(0, -ox);
  const y0 = Math.max(0, -oy);
  const x1 = Math.min(fw, w - ox);
  const y1 = Math.min(float.height, h - oy);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const s = (y * fw + x) * 4;
      if (f[s + 3] === 0) continue; // transparent
      const d = ((oy + y) * w + (ox + x)) * 4;
      out[d] = f[s];
      out[d + 1] = f[s + 1];
      out[d + 2] = f[s + 2];
      out[d + 3] = f[s + 3];
    }
  }
}
