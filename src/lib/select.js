// ---------------------------------------------------------------------------
// Selection-tool primitives for the editor's marquee (MacPaint's selection
// rectangle). Pure integer geometry over bare RGBA buffers — no DOM, no
// THREE — so the canvas's live move and the Node suite share ONE source of
// truth, exactly like rect.js does for the rect tool and fill.js for the
// paint bucket.
//
// A BOUNDS is an inclusive texel rectangle {x0,y0,x1,y1}, top-left to
// bottom-right (normalizeBounds orders any corner pair). The selection model
// the canvas builds on these is base + float: the marquee's texels are
// LIFTED out once as their own tile (liftRect), the hole they leave is
// cleared to transparency (clearRect), and every offset of the float is a
// pure composite over that pristine base (compositeFloat) — so dragging a
// selection across the sprite and back never smears what it crossed.
//
// THE TRANSPARENCY RULE: a transparent texel of the float is not a "pixel"
// and never lands — the base shows through it — while an opaque texel
// overwrites. Alpha ≠ 0 is opaque (strokes are hard-pixel, alpha 0 or 255);
// stray RGB under alpha 0 is ignored, matching fill.js's keyAt / atlas.isBlank.
//
// THE NO-WRAP CLIP: a float pushed past the tile's edge clips PER TEXEL on x
// AND y before any linear index is computed — an x past the right edge is
// dropped, never wrapped onto the next row's start. The float buffer itself
// is never clipped, only the composite, so dragging back on-tile restores it.
//
// FUTURE — THE REGISTERED MOVE (planned; see sm-draw-canvas.js #applyMove):
// a move "on all faces" that keeps the atlas in registration. These
// primitives are already face-agnostic (a bounds + a buffer + a width), so
// that feature is a matter of deriving each other face's bounds and delta
// from this face's (a FRONT marquee is a slab of voxels — its columns on
// TOP, its rows on the sides) and running the same lift / clear / composite
// per face, not of new primitives here.
// ---------------------------------------------------------------------------

import { writeKey } from './fill.js';

/** @typedef {{x0:number,y0:number,x1:number,y1:number}} Bounds */
/** @typedef {{width:number,height:number,data:Uint8ClampedArray,opaque:number}} Float */

const TRANSPARENT = { transparent: true };

/**
 * Two texel corners → inclusive bounds, top-left → bottom-right.
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
 * Bounds shifted by (dx,dy) — may leave the tile; nobody clamps this (the
 * overlay clips at the canvas edge, the composite clips per texel).
 * @param {Bounds} b @param {number} dx @param {number} dy
 * @returns {Bounds}
 */
export function translateBounds(b, dx, dy) {
  return { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy };
}

/**
 * Shift's axis lock for a move delta (MacPaint's rule): the dominant axis
 * keeps its value, the other zeroes. A tie (|dx| === |dy|) keeps dx —
 * horizontal wins.
 * @param {number} dx @param {number} dy
 * @returns {{dx:number,dy:number}}
 */
export function constrainAxis(dx, dy) {
  return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy };
}

/**
 * Copy the rect out of a w-wide RGBA buffer as its own tile, counting its
 * OPAQUE texels (alpha ≠ 0): `opaque` 0 means the float is nothing but
 * transparency and no move can ever change a byte — the canvas's
 * short-circuit. Bounds MUST lie inside the tile (the marquee is clamped at
 * drag time); `data` is untouched.
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
 * Write transparency over the rect, in place (hard pixel: all four bytes 0,
 * through fill.js's writeKey). Returns whether any byte changed — an
 * already-transparent rect reports false. Bounds must lie inside the tile.
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
 * Composite: `out` ← `base`, then every OPAQUE (alpha ≠ 0) texel of `float`
 * lands at (ox + x, oy + y) when that lies inside the w×h tile. Transparent
 * float texels are SKIPPED (the rule — the base shows through); off-tile
 * texels are dropped, clipped per texel on both axes, never wrapped to the
 * next row. `out` and `base` may be the same buffer only if you don't need
 * base afterward — the canvas always passes its working buffer and the
 * pristine base, distinct.
 * @param {Uint8ClampedArray} out @param {Uint8ClampedArray} base
 * @param {number} w @param {number} h @param {Float} float
 * @param {number} ox @param {number} oy
 */
export function compositeFloat(out, base, w, h, float, ox, oy) {
  if (out !== base) out.set(base);
  const f = float.data;
  const fw = float.width;
  // Clip the float's rect to the tile once, so the inner loops touch only
  // texels that land — the per-texel clip made explicit as loop bounds.
  const x0 = Math.max(0, -ox);
  const y0 = Math.max(0, -oy);
  const x1 = Math.min(fw, w - ox);
  const y1 = Math.min(float.height, h - oy);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const s = (y * fw + x) * 4;
      if (f[s + 3] === 0) continue; // transparency never travels
      const d = ((oy + y) * w + (ox + x)) * 4;
      out[d] = f[s];
      out[d + 1] = f[s + 1];
      out[d + 2] = f[s + 2];
      out[d + 3] = f[s + 3];
    }
  }
}
