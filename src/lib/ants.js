// ---------------------------------------------------------------------------
// The marching ants' raster: the selection tool's 1-bit border as whole-pixel
// RUNS. Pure integer geometry — no DOM — so the painter fills exactly what
// this emits and the walk stays Node-testable.
//
// The border is the outermost pixel ring of a w×h system-px frame at (x, y),
// one px thick, walked clockwise from the top-left corner: the top row left
// to right, the right column down, the bottom row right to left, the left
// column back up — 2(w+h) − 4 pixels, each visited exactly once (a 1-px-wide
// or -tall frame degenerates to its one row or column, still visited once).
// Pixel i of the walk is BLACK when ((i − phase) mod ANTS_PERIOD) < ANTS_DASH,
// else WHITE: four on, four off, and each phase step marches the dashes one
// px FORWARD along the walk — clockwise around the ring, the way a growing
// negative lineDashOffset walked them. The walk's start is the classic seam:
// the ring's length is rarely a multiple of the period, so the last dash
// meets the first short or long.
//
// Why runs and not a dashed stroke: a 1px stroke sits on half-pixel centers,
// and a dash pattern is measured along that path from its start, so every
// dash boundary lands mid-pixel and the rasterizer anti-aliases each dash's
// end pixels to 50% gray — a gray pixel on a 1-bit surface. A rectangle on
// whole coordinates cannot be anti-aliased, so filling the ring as integer
// runs is 1-bit by construction, in every browser, at every phase.
//
// THE OUTLINE RING (Sep 5 2026): the erase treatment rings the texels a tip
// would clear, and a CIRCLE tip's are a disc, not a box — so antsOutlineRuns
// walks the same dashes around any row-convex shape given as one span per
// px row: the shape's THIN boundary (every px with a 4-neighbour outside it,
// each once), clockwise from the top row's left end — the top row →, down
// the right flank, the bottom row ←, up the left flank — with the rectangle's
// walk as its exact special case (a box's spans give antsRuns' runs, run for
// run). A staircase step is walked along its tread (the row's px whose
// neighbour above or below is outside) and then diagonally onto the next
// riser, so the ring is 8-connected and one px thin everywhere, the way a
// circle outline is drawn — never a 4-connected elbow that would read as a
// thicker corner. Same cycle, same march, same seam.
// ---------------------------------------------------------------------------

/** System px per dash: the on-run and the off-run alike. */
export const ANTS_DASH = 4;
/** The dash cycle in system px — one on-run plus one off-run. */
export const ANTS_PERIOD = 2 * ANTS_DASH;

/** One maximal same-ink run of the ring, in system px.
 *  @typedef {{x:number, y:number, w:number, h:number, black:boolean}} AntsRun */

/**
 * The ring of a frame as same-ink runs at `phase`, in walk order.
 * @param {{x:number, y:number, w:number, h:number}} frame  the selection's
 *   outline in system px; a frame under 1×1 emits nothing
 * @param {number} phase  any integer — reduced modulo ANTS_PERIOD
 * @returns {AntsRun[]}
 */
export function antsRuns(frame, phase) {
  const { x, y, w, h } = frame;
  /** @type {AntsRun[]} */
  const out = [];
  if (w < 1 || h < 1) return out;
  // The cycle position of walk pixel i is (i − phase) mod PERIOD; carry −phase
  // reduced to 0..PERIOD−1 so the segments add it, and any integer phase works.
  const p = ((-phase % ANTS_PERIOD) + ANTS_PERIOD) % ANTS_PERIOD;
  let i = 0; // the walk index of the next segment's first pixel
  // The top row, left → right.
  i = segment(out, i, p, w, (k, n) => ({ x: x + k, y, w: n, h: 1 }));
  // The right column, down — below the top row's corner.
  i = segment(out, i, p, h - 1, (k, n) => ({ x: x + w - 1, y: y + 1 + k, w: 1, h: n }));
  // The bottom row, right → left — past the corner just walked. A 1-tall
  // frame has no bottom row of its own (its top row IS its bottom row).
  if (h > 1)
    i = segment(out, i, p, w - 1, (k, n) => ({
      x: x + w - 1 - k - n,
      y: y + h - 1,
      w: n,
      h: 1,
    }));
  // The left column, up — between the two corners already walked. A 1-wide
  // frame has no left column of its own.
  if (w > 1)
    segment(out, i, p, h - 2, (k, n) => ({ x, y: y + h - 1 - k - n, w: 1, h: n }));
  return out;
}

/**
 * The thin outline ring of a row-convex shape as same-ink runs at `phase`,
 * in walk order — the header's OUTLINE RING. `spans` is the shape as one
 * inclusive span per system-px row, rows contiguous top to bottom, each row
 * one span: the disc a circle tip covers, a box, or either clipped at the
 * tile's edge (lib/brush.js brushSpans). The contract the walk relies on:
 * the left ends fall then rise (a valley) and the right ends rise then fall
 * (a peak) — true of a centered disc, a box, and their edge clips — so the
 * top and bottom rows are each no wider than their neighbour and every
 * boundary px is walked exactly once. A box's spans reproduce antsRuns'
 * walk exactly; an empty list emits nothing.
 * @param {{y:number, x0:number, x1:number}[]} spans
 * @param {number} phase  any integer — reduced modulo ANTS_PERIOD
 * @returns {AntsRun[]}
 */
export function antsOutlineRuns(spans, phase) {
  /** @type {AntsRun[]} */
  const out = [];
  const n = spans.length;
  if (!n) return out;
  const L = (r) => spans[r].x0;
  const R = (r) => spans[r].x1;
  const Y = (r) => spans[r].y;
  // The walk as straight segments — a run never crosses one — built first,
  // vertical px merged into columns as they come (a flank between two steps
  // is one segment, as a box's whole column is).
  /** @type {{x:number, y:number, len:number, dx:number, dy:number}[]} */
  const segs = [];
  /** @type {{x:number, y:number, len:number, dx:number, dy:number}|null} */
  let column = null;
  const flush = () => {
    if (column) segs.push(column);
    column = null;
  };
  const row = (x, y, len, dx) => {
    if (len <= 0) return;
    flush();
    segs.push({ x, y, len, dx, dy: 0 });
  };
  const px = (x, y, dy) => {
    if (column && column.x === x && column.dy === dy && column.y + dy * column.len === y)
      column.len++;
    else {
      flush();
      column = { x, y, len: 1, dx: 0, dy };
    }
  };
  // The top row, left → right.
  row(L(0), Y(0), R(0) - L(0) + 1, 1);
  // Down the right flank: a wider row below is entered along its tread (its
  // own px past the row above), a narrower one by walking back along the
  // row above's tread first; a riser px otherwise.
  for (let r = 1; r < n; r++) {
    if (R(r) > R(r - 1)) row(R(r - 1) + 1, Y(r), R(r) - R(r - 1), 1);
    else {
      if (R(r) < R(r - 1)) row(R(r - 1) - 1, Y(r - 1), R(r - 1) - R(r) - 1, -1);
      px(R(r), Y(r), 1);
    }
  }
  if (n > 1) {
    // The bottom row, right → left — past the corner just walked. A 1-tall
    // shape's top row IS its bottom row.
    row(R(n - 1) - 1, Y(n - 1), R(n - 1) - L(n - 1), -1);
    // Up the left flank, the rows strictly between the bottom and the top;
    // a 1-px-wide row's one px was the right flank's already.
    for (let r = n - 2; r >= 1; r--) {
      if (L(r) < L(r + 1)) row(L(r + 1) - 1, Y(r), L(r + 1) - L(r), -1);
      else {
        if (L(r) > L(r + 1)) row(L(r + 1) + 1, Y(r + 1), L(r) - L(r + 1) - 1, 1);
        if (L(r) < R(r)) px(L(r), Y(r), -1);
      }
    }
    // Into the top row, whose px the walk began with: only a tread under a
    // narrower top row is left to walk.
    if (L(0) > L(1)) row(L(1) + 1, Y(1), L(0) - L(1) - 1, 1);
  }
  flush();
  const p = ((-phase % ANTS_PERIOD) + ANTS_PERIOD) % ANTS_PERIOD;
  let i = 0;
  for (const s of segs) {
    const { x, y, dx, dy } = s;
    i = segment(out, i, p, s.len, (k, len) =>
      dx
        ? { x: dx > 0 ? x + k : x - k - len + 1, y, w: len, h: 1 }
        : { x, y: dy > 0 ? y + k : y - k - len + 1, w: 1, h: len }
    );
  }
  return out;
}

/**
 * Emit one segment's `n` pixels (walk indices i0 … i0+n−1) as maximal
 * same-ink runs; `at(k, len)` maps the segment's pixels k … k+len−1 to their
 * rect. Returns the walk index after the segment.
 * @param {AntsRun[]} out @param {number} i0 @param {number} phase @param {number} n
 * @param {(k:number, len:number) => {x:number, y:number, w:number, h:number}} at
 */
function segment(out, i0, phase, n, at) {
  for (let k = 0; k < n; ) {
    const q = (i0 + k + phase) % ANTS_PERIOD; // this pixel's place in the cycle
    const black = q < ANTS_DASH;
    const left = (black ? ANTS_DASH : ANTS_PERIOD) - q; // px left in its dash
    const len = Math.min(left, n - k);
    out.push({ ...at(k, len), black });
    k += len;
  }
  return i0 + n;
}
