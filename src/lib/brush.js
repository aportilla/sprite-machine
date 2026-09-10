// ---------------------------------------------------------------------------
// Pencil primitives over a bare RGBA Uint8ClampedArray — the write path of the
// drawing editor, pure and Node-testable. Every write is HARD-pixel: fully
// opaque paint or a fully transparent erase, never anti-aliased, so downstream
// ingest (alpha>=128) and atlas.isBlank (alpha!==0) can never diverge.
//
// A color is `{r,g,b,a}` with `a` 0 (erase) or 255 (paint). Every function
// returns whether any byte actually changed, so callers repaint/notify only on
// real edits.
//
// THE TIP has a SHAPE (Sep 5 2026): the CIRCLE inscribed in the N×N box —
// the classic pixel disc, the midpoint circle's own rows (1 texel, a 2×2,
// the plus at 3, a 4×4 less its corners, 3-5-5-5-3 at 5 …), the boot default
// — or the SQUARE, the whole box (the tip the editor stamped before the
// shapes came). One primitive states which texels of the box a shape covers,
// `brushRows`, and the stamp, the stroke and the editor's hover preview all
// read it — so what you see is what you paint, the rect tool's discipline
// (lib/rect.js roundedRectRows). The erase ring follows the shape too —
// brushSpans states the tip's clipped system-px rows for lib/ants.js
// antsOutlineRuns to walk, so a circle tip's ants ring a disc. The
// footprint's BOUNDS stay the box for either shape (brushBounds: the clamp's
// word).
// ---------------------------------------------------------------------------

/** The tip shapes — the pencil's and the eraser's popups' two options, in
 *  their order; the circle is the boot default of both.
 *  @type {readonly ['circle', 'square']} */
export const PENCIL_SHAPES = Object.freeze(['circle', 'square']);

/**
 * Brush footprint: an N×N square anchored so the center texel stays inside and
 * odd sizes center exactly (even sizes bias up-left). Shared by the stamp and
 * the editor's hover preview so what you see is what you paint. Returned
 * bounds are UNCLAMPED — and the box for EITHER shape (a circle tip's disc
 * lives inside it; brushRows says which texels).
 * @param {number} cx @param {number} cy @param {number} size
 */
export function brushBounds(cx, cy, size) {
  const o = Math.floor((size - 1) / 2);
  return { x0: cx - o, y0: cy - o, x1: cx - o + size - 1, y1: cy - o + size - 1 };
}

/**
 * The texels a tip covers, as one inclusive span per row of its box —
 * `emit(y, xl, xr)` for every row, top to bottom, UNCLAMPED (the callers
 * clip to the tile). A `'square'` tip covers the whole box on every row. A
 * `'circle'` tip is the disc inscribed in the box: the texel at box offsets
 * (dx, dy) is in it iff its center lies strictly inside the circle of
 * diameter N on the box's center — in doubled offsets, so the test stays in
 * integers, u = 2dx − (N−1), v = 2dy − (N−1) and 4·d² = u² + v² < N² − 1
 * (the strict `<` against N² − 1 is what makes 3 a plus rather than a full
 * box, and it reproduces the midpoint circle's rows at every odd size — 3,
 * 5, 7, 7, 7, 5, 3 at 7 — and the natural even ones — 2, 4, 4, 2 at 4). A
 * 1-texel tip is its one texel. Every row has at least its center texel(s),
 * so no row is ever empty, and each span is centered in the box. Any other
 * shape name reads as the square.
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
  const lim = Math.max(1, size * size - 1); // the 1-texel tip: 0 < 1, its one texel
  for (let dy = 0; dy < size; dy++) {
    const v = 2 * dy - n1;
    // The span is symmetric about the box's center: find its left end and
    // mirror it. The center texel(s) are always inside, so this terminates.
    let dx = 0;
    while ((2 * dx - n1) * (2 * dx - n1) + v * v >= lim) dx++;
    emit(b.y0 + dy, b.x0 + dx, b.x1 - dx);
  }
}

/**
 * The tip's texels as clipped SYSTEM-PX spans, one per px row, top to
 * bottom — the shape the erase ring is walked around (lib/ants.js
 * antsOutlineRuns) and the canvas's painter fills: brushRows' rows clipped
 * to the w×h tile (a row off the tile is dropped, a span past its edge cut
 * at it — so a ring at the tile's edge closes along the edge), then scaled by
 * `scale` system px per texel (each texel row becomes `scale` identical px
 * rows). Empty for a tip wholly off the tile. Pure.
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
 * Stamp the size×size tip centered on (cx,cy) — the square, or with
 * `shape` `'circle'` the disc inscribed in it (brushRows) — clipped to the
 * w×h tile; returns true if any texel changed.
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
 * Stamp the tip along the Bresenham line from (x0,y0) to (x1,y1)
 * inclusive, so a fast drag lays down a continuous stroke, not dotted samples.
 * Returns true if any texel changed.
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
