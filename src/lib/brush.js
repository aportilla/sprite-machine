// ---------------------------------------------------------------------------
// Pencil primitives over a bare RGBA Uint8ClampedArray — the write path of the
// drawing editor, pure and Node-testable. Every write is HARD-pixel: fully
// opaque paint or a fully transparent erase, never anti-aliased, so downstream
// ingest (alpha>=128) and atlas.isBlank (alpha!==0) can never diverge.
//
// A color is `{r,g,b,a}` with `a` 0 (erase) or 255 (paint). Every function
// returns whether any byte actually changed, so callers repaint/notify only on
// real edits.
// ---------------------------------------------------------------------------

/**
 * Brush footprint: an N×N square anchored so the center texel stays inside and
 * odd sizes center exactly (even sizes bias up-left). Shared by the stamp and
 * the editor's hover preview so what you see is what you paint. Returned
 * bounds are UNCLAMPED.
 * @param {number} cx @param {number} cy @param {number} size
 */
export function brushBounds(cx, cy, size) {
  const o = Math.floor((size - 1) / 2);
  return { x0: cx - o, y0: cy - o, x1: cx - o + size - 1, y1: cy - o + size - 1 };
}

/**
 * Write one texel; returns true only if the bytes actually changed. Any two
 * fully-transparent texels are treated as equal regardless of stray RGB left
 * under alpha 0, so erasing an already-invisible texel is a true no-op (and
 * never dirties a mirror-derived face into real art).
 * @param {Uint8ClampedArray} data @param {number} w
 * @param {number} x @param {number} y
 * @param {{r:number,g:number,b:number,a:number}} color
 */
export function writeTexel(data, w, x, y, { r, g, b, a }) {
  const i = (y * w + x) * 4;
  if (a === 0 && data[i + 3] === 0) return false;
  if (data[i] === r && data[i + 1] === g && data[i + 2] === b && data[i + 3] === a) {
    return false;
  }
  data[i] = r;
  data[i + 1] = g;
  data[i + 2] = b;
  data[i + 3] = a;
  return true;
}

/**
 * Stamp the whole size×size footprint centered on (cx,cy), clipped to the
 * w×h tile; returns true if any texel changed.
 * @param {Uint8ClampedArray} data @param {number} w @param {number} h
 * @param {number} cx @param {number} cy @param {number} size
 * @param {{r:number,g:number,b:number,a:number}} color
 */
export function stampBrush(data, w, h, cx, cy, size, color) {
  const b = brushBounds(cx, cy, size);
  const x1 = Math.min(w - 1, b.x1);
  const y1 = Math.min(h - 1, b.y1);
  let changed = false;
  for (let y = Math.max(0, b.y0); y <= y1; y++) {
    for (let x = Math.max(0, b.x0); x <= x1; x++) {
      if (writeTexel(data, w, x, y, color)) changed = true;
    }
  }
  return changed;
}

/**
 * Stamp the footprint along the Bresenham line from (x0,y0) to (x1,y1)
 * inclusive, so a fast drag lays down a continuous stroke, not dotted samples.
 * Returns true if any texel changed.
 * @param {Uint8ClampedArray} data @param {number} w @param {number} h
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
 * @param {number} size @param {{r:number,g:number,b:number,a:number}} color
 */
export function strokeLine(data, w, h, x0, y0, x1, y1, size, color) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let changed = false;
  for (;;) {
    if (stampBrush(data, w, h, x0, y0, size, color)) changed = true;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return changed;
}
