// Pencil and eraser primitives over a bare RGBA Uint8ClampedArray. A color is
// {r,g,b,a} with a of 0 (erase) or 255 (paint). Writes are hard pixels, so
// ingest (alpha >= 128) and atlas.isBlank (alpha !== 0) agree.
//
// brushRows defines which texels a tip covers. The stamp, the stroke and the
// hover preview all use it.

/** Tip shapes in menu order. The circle is the default.
 *  @type {readonly ['circle', 'square']} */
export const PENCIL_SHAPES = Object.freeze(['circle', 'square']);

/**
 * The tip's N×N box, unclamped, for either shape. Odd sizes center exactly.
 * Even sizes bias up-left.
 * @param {number} cx @param {number} cy @param {number} size
 */
export function brushBounds(cx, cy, size) {
  const o = Math.floor((size - 1) / 2);
  return { x0: cx - o, y0: cy - o, x1: cx - o + size - 1, y1: cy - o + size - 1 };
}

/**
 * The texels a tip covers: `emit(y, xl, xr)` for each row of its box, top to
 * bottom, unclamped. A square covers the whole box. A circle covers each texel
 * whose center lies strictly inside the circle of diameter N. In doubled
 * offsets u = 2dx − (N−1), v = 2dy − (N−1) the test is u² + v² < N² − 1, which
 * gives the midpoint-circle rows (size 3 is a plus). Every row is non-empty and
 * centered. Any other shape name is treated as the square.
 * @param {number} cx @param {number} cy @param {number} size
 * @param {string} shape  one of PENCIL_SHAPES
 * @param {(y: number, xl: number, xr: number) => void} emit
 */
export function brushRows(cx, cy, size, shape, emit) {
  const b = brushBounds(cx, cy, size);
  if (shape !== 'circle') {
    for (let y = b.y0; y <= b.y1; y++) emit(y, b.x0, b.x1);
    return;
  }
  const n1 = size - 1;
  const lim = Math.max(1, size * size - 1); // size 1: 0 < 1 keeps its one texel
  for (let dy = 0; dy < size; dy++) {
    const v = 2 * dy - n1;
    // Find the left end and mirror it. The center texels are always inside, so
    // the loop ends.
    let dx = 0;
    while ((2 * dx - n1) * (2 * dx - n1) + v * v >= lim) dx++;
    emit(b.y0 + dy, b.x0 + dx, b.x1 - dx);
  }
}

/**
 * The tip's texels as system-px spans, one per px row, top to bottom. Rows are
 * clipped to the w×h tile, then scaled by `scale` px per texel. Empty for a tip
 * wholly off the tile. lib/ants.js antsOutlineRuns walks these.
 * @param {number} cx @param {number} cy @param {number} size
 * @param {string} shape  one of PENCIL_SHAPES
 * @param {number} w @param {number} h  the tile, in texels
 * @param {number} [scale]  system px per texel (1 when omitted)
 * @returns {{y:number, x0:number, x1:number}[]}
 */
export function brushSpans(cx, cy, size, shape, w, h, scale = 1) {
  /** @type {{y:number, x0:number, x1:number}[]} */
  const spans = [];
  brushRows(cx, cy, size, shape, (y, xl, xr) => {
    if (y < 0 || y >= h) return;
    const x0 = Math.max(0, xl);
    const x1 = Math.min(w - 1, xr);
    if (x1 < x0) return;
    for (let j = 0; j < scale; j++) {
      spans.push({ y: y * scale + j, x0: x0 * scale, x1: (x1 + 1) * scale - 1 });
    }
  });
  return spans;
}

/**
 * Write one texel. Returns whether the bytes changed. Erasing a texel that is
 * already alpha 0 is a no-op whatever its RGB, so it never turns a
 * mirror-derived face into real art.
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
 * Stamp the tip centered on (cx,cy), clipped to the w×h tile. Returns whether
 * any texel changed.
 * @param {Uint8ClampedArray} data @param {number} w @param {number} h
 * @param {number} cx @param {number} cy @param {number} size
 * @param {{r:number,g:number,b:number,a:number}} color
 * @param {string} [shape]  one of PENCIL_SHAPES; the square when omitted
 */
export function stampBrush(data, w, h, cx, cy, size, color, shape = 'square') {
  let changed = false;
  brushRows(cx, cy, size, shape, (y, xl, xr) => {
    if (y < 0 || y >= h) return;
    const x1 = Math.min(w - 1, xr);
    for (let x = Math.max(0, xl); x <= x1; x++) {
      if (writeTexel(data, w, x, y, color)) changed = true;
    }
  });
  return changed;
}

/**
 * Stamp the tip along the Bresenham line from (x0,y0) to (x1,y1), inclusive.
 * Returns whether any texel changed.
 * @param {Uint8ClampedArray} data @param {number} w @param {number} h
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
 * @param {number} size @param {{r:number,g:number,b:number,a:number}} color
 * @param {string} [shape]  one of PENCIL_SHAPES; the square when omitted
 */
export function strokeLine(data, w, h, x0, y0, x1, y1, size, color, shape = 'square') {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let changed = false;
  for (;;) {
    if (stampBrush(data, w, h, x0, y0, size, color, shape)) changed = true;
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
