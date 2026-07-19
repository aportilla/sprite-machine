// ---------------------------------------------------------------------------
// Fill-tool primitives for the editor's paint-bucket. Pure typed-array geometry —
// no DOM, no THREE — so the live editor and the atlas-wide "all tiles" path share
// ONE source of truth (and it stays Node-testable), exactly like rect.js does for
// the rect tool.
//
// A "color key" identifies a texel for matching:
//   { transparent: true }  — any alpha-0 texel (stray RGB under alpha 0 ignored,
//                            matching the editor's hard-pixel writeTexel rule and
//                            atlas.isBlank, so two cleared texels always compare equal)
//   { r, g, b }            — an opaque color (any non-zero alpha is treated as solid;
//                            strokes are hard-pixel so alpha is only ever 0 or 255)
// keyAt() reads one from a buffer; sameKey() compares two; writeKey() stamps one.
// Both fills leave every texel hard-pixel (alpha 0 or 255), so downstream ingest
// (alpha>=128) and atlas.isBlank (alpha!==0) can never diverge.
// ---------------------------------------------------------------------------

/**
 * The color key at byte offset `i` in an RGBA buffer: transparent (alpha 0) or an
 * opaque {r,g,b}. RGB under a transparent texel is ignored, so two cleared texels
 * always compare equal.
 * @param {ArrayLike<number>} data @param {number} i
 * @returns {{transparent:true}|{r:number,g:number,b:number}}
 */
export function keyAt(data, i) {
  if (data[i + 3] === 0) return { transparent: true };
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

/**
 * Whether two color keys denote the same fill color (two transparents are equal;
 * an opaque and a transparent never are).
 * @param {{transparent?:boolean,r?:number,g?:number,b?:number}} a
 * @param {{transparent?:boolean,r?:number,g?:number,b?:number}} b
 */
export function sameKey(a, b) {
  if (a.transparent || b.transparent) return !!a.transparent && !!b.transparent;
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

/**
 * Stamp a color key into the RGBA buffer at offset `i` (hard pixel: alpha 0 or 255).
 * @param {{[i:number]:number}} data @param {number} i
 * @param {{transparent?:boolean,r?:number,g?:number,b?:number}} key
 */
export function writeKey(data, i, key) {
  if (key.transparent) {
    data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
  } else {
    data[i] = key.r;
    data[i + 1] = key.g;
    data[i + 2] = key.b;
    data[i + 3] = 255;
  }
}

// Whether the texel at offset `i` matches color key `key`.
function matches(data, i, key) {
  if (key.transparent) return data[i + 3] === 0;
  return (
    data[i + 3] !== 0 &&
    data[i] === key.r &&
    data[i + 1] === key.g &&
    data[i + 2] === key.b
  );
}

/**
 * Contiguous 4-connected flood fill from seed (x,y): recolor the connected region
 * of texels sharing the seed's color to `fill`. Mutates `data` in place; returns
 * the number of texels changed (0 when the seed is out of bounds, or already the
 * fill color — clicking a texel that's already `fill` is a no-op). Iterative (an
 * explicit stack, not recursion) so a full 256×256 tile can't blow the call stack.
 * @param {Uint8ClampedArray} data  RGBA buffer, w*h*4 bytes
 * @param {number} w @param {number} h
 * @param {number} x @param {number} y   seed texel
 * @param {{transparent?:boolean,r?:number,g?:number,b?:number}} fill
 * @returns {number} texels changed
 */
export function floodFill(data, w, h, x, y, fill) {
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  const target = keyAt(data, (y * w + x) * 4);
  if (sameKey(target, fill)) return 0; // clicking the fill color changes nothing
  const seen = new Uint8Array(w * h);
  const stack = [x, y]; // flat (px,py) pairs
  let changed = 0;
  while (stack.length) {
    const py = stack.pop();
    const px = stack.pop();
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    const p = py * w + px;
    if (seen[p]) continue;
    const i = p * 4;
    if (!matches(data, i, target)) continue;
    seen[p] = 1;
    writeKey(data, i, fill);
    changed++;
    stack.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1);
  }
  return changed;
}

/**
 * Global replace: recolor EVERY texel matching color key `target` to `fill`, across
 * the whole buffer (a single tile, or a whole atlas sheet). Mutates `data` in place;
 * returns the count of texels changed. A no-op (returns 0) when target already
 * equals fill.
 * @param {Uint8ClampedArray} data  RGBA buffer
 * @param {{transparent?:boolean,r?:number,g?:number,b?:number}} target
 * @param {{transparent?:boolean,r?:number,g?:number,b?:number}} fill
 * @returns {number} texels changed
 */
export function replaceColor(data, target, fill) {
  if (sameKey(target, fill)) return 0;
  let changed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (matches(data, i, target)) {
      writeKey(data, i, fill);
      changed++;
    }
  }
  return changed;
}

/**
 * Like replaceColor but confined to the rect (x0,y0)-(x0+w, y0+h) of a wider `imgW`×
 * `imgH` sheet — the whole-buffer scan would also hit any remainder pixels a
 * non-divisible atlas leaves OUTSIDE the tile grid (invisible to the carve, but baked
 * into a download). The atlas-wide fill passes the tiled region so it recolors exactly
 * the tiles, never the remainder. The rect is clipped to the buffer, so an oversized
 * (malformed) tile grid can't read past a row. Mutates `data` in place; returns the
 * count of texels changed (0 when target === fill).
 * @param {Uint8ClampedArray} data  RGBA buffer
 * @param {number} imgW @param {number} imgH  buffer dimensions in texels
 * @param {number} x0 @param {number} y0 @param {number} w @param {number} h
 * @param {{transparent?:boolean,r?:number,g?:number,b?:number}} target
 * @param {{transparent?:boolean,r?:number,g?:number,b?:number}} fill
 * @returns {number} texels changed
 */
export function replaceColorInRect(data, imgW, imgH, x0, y0, w, h, target, fill) {
  if (sameKey(target, fill)) return 0;
  const xEnd = Math.min(x0 + w, imgW);
  const yEnd = Math.min(y0 + h, imgH);
  let changed = 0;
  for (let y = Math.max(0, y0); y < yEnd; y++) {
    for (let x = Math.max(0, x0); x < xEnd; x++) {
      const i = (y * imgW + x) * 4;
      if (matches(data, i, target)) {
        writeKey(data, i, fill);
        changed++;
      }
    }
  }
  return changed;
}
