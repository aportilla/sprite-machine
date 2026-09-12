// Paint-bucket primitives over RGBA buffers, shared by the editor and the
// "on all faces" fill.
//
// A color key identifies a texel for matching: { transparent: true } for any
// alpha-0 texel (RGB ignored), or { r, g, b } for an opaque one. Fills write
// hard pixels (alpha 0 or 255), so ingest (alpha >= 128) and atlas.isBlank
// (alpha !== 0) agree.

/**
 * The color key at byte offset `i`. RGB under alpha 0 is ignored.
 * @param {ArrayLike<number>} data @param {number} i
 * @returns {{transparent:true}|{r:number,g:number,b:number}}
 */
export function keyAt(data, i) {
  if (data[i + 3] === 0) return { transparent: true };
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

/**
 * Whether two color keys are the same color.
 * @param {{transparent?:boolean,r?:number,g?:number,b?:number}} a
 * @param {{transparent?:boolean,r?:number,g?:number,b?:number}} b
 */
export function sameKey(a, b) {
  if (a.transparent || b.transparent) return !!a.transparent && !!b.transparent;
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

/**
 * Write a color key at offset `i` as a hard pixel (alpha 0 or 255).
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
 * 4-connected flood fill from (x,y) to `fill`, in place. Returns the texels
 * changed: 0 when the seed is off the tile or already `fill`. Uses an explicit
 * stack so a large tile can't overflow the call stack.
 * @param {Uint8ClampedArray} data  RGBA buffer, w*h*4 bytes
 * @param {number} w @param {number} h
 * @param {number} x @param {number} y   seed texel
 * @param {{transparent?:boolean,r?:number,g?:number,b?:number}} fill
 * @returns {number} texels changed
 */
export function floodFill(data, w, h, x, y, fill) {
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  const target = keyAt(data, (y * w + x) * 4);
  if (sameKey(target, fill)) return 0;
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
 * Recolor every texel matching `target` to `fill` across the whole buffer, in
 * place. Returns the texels changed.
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
 * replaceColor within the rect (x0,y0)-(x0+w, y0+h) of an imgW × imgH buffer,
 * clipped to the buffer. The atlas-wide fill passes the tile grid, so remainder
 * pixels outside it are left alone. Returns the texels changed.
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
