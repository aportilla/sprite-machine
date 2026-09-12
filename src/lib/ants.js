// Marching ants: a 1-bit dashed border as whole-pixel runs.
//
// The border is walked clockwise from the top-left pixel. Walk pixel i is black
// when ((i − phase) mod ANTS_PERIOD) < ANTS_DASH, else white. Each phase step
// moves the dashes one pixel forward along the walk.
//
// Fill the runs as whole-pixel rects. A dashed 1px stroke anti-aliases its dash
// ends to gray.

/** Dash length in system px, on and off. */
export const ANTS_DASH = 4;
/** One on-run plus one off-run, in system px. */
export const ANTS_PERIOD = 2 * ANTS_DASH;

/** One run of same-colored border pixels, in system px.
 *  @typedef {{x:number, y:number, w:number, h:number, black:boolean}} AntsRun */

/**
 * The one-pixel border of a frame as runs at `phase`, in walk order.
 * @param {{x:number, y:number, w:number, h:number}} frame  in system px. Empty
 *   below 1×1.
 * @param {number} phase  any integer, reduced modulo ANTS_PERIOD
 * @returns {AntsRun[]}
 */
export function antsRuns(frame, phase) {
  const { x, y, w, h } = frame;
  /** @type {AntsRun[]} */
  const out = [];
  if (w < 1 || h < 1) return out;
  // −phase reduced to 0..ANTS_PERIOD−1, so any integer phase works.
  const p = ((-phase % ANTS_PERIOD) + ANTS_PERIOD) % ANTS_PERIOD;
  let i = 0; // walk index of the next segment's first pixel
  // Top row, left to right.
  i = segment(out, i, p, w, (k, n) => ({ x: x + k, y, w: n, h: 1 }));
  // Right column, down, below the top-right corner.
  i = segment(out, i, p, h - 1, (k, n) => ({ x: x + w - 1, y: y + 1 + k, w: 1, h: n }));
  // Bottom row, right to left. A 1-tall frame has none.
  if (h > 1)
    i = segment(out, i, p, w - 1, (k, n) => ({
      x: x + w - 1 - k - n,
      y: y + h - 1,
      w: n,
      h: 1,
    }));
  // Left column, up, between the corners. A 1-wide frame has none.
  if (w > 1)
    segment(out, i, p, h - 2, (k, n) => ({ x, y: y + h - 1 - k - n, w: 1, h: n }));
  return out;
}

/**
 * The one-pixel outline of a row-convex shape as runs at `phase`, in walk
 * order. `spans` has one inclusive span per system-px row, rows contiguous top
 * to bottom (lib/brush.js brushSpans). Left ends must fall then rise and right
 * ends rise then fall, so each boundary pixel is walked once. A staircase step
 * is walked along its tread, then diagonally onto the next riser, so the ring
 * is 8-connected. A box's spans give the same runs as antsRuns.
 * @param {{y:number, x0:number, x1:number}[]} spans
 * @param {number} phase  any integer, reduced modulo ANTS_PERIOD
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
  // Build the walk as straight segments first. Consecutive vertical pixels
  // merge into one column segment.
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
  // Top row, left to right.
  row(L(0), Y(0), R(0) - L(0) + 1, 1);
  // Down the right flank. A wider row is entered along its tread. A narrower
  // row first walks back along the tread of the row above.
  for (let r = 1; r < n; r++) {
    if (R(r) > R(r - 1)) row(R(r - 1) + 1, Y(r), R(r) - R(r - 1), 1);
    else {
      if (R(r) < R(r - 1)) row(R(r - 1) - 1, Y(r - 1), R(r - 1) - R(r) - 1, -1);
      px(R(r), Y(r), 1);
    }
  }
  if (n > 1) {
    // Bottom row, right to left.
    row(R(n - 1) - 1, Y(n - 1), R(n - 1) - L(n - 1), -1);
    // Up the left flank, rows strictly between bottom and top. A 1-px-wide
    // row was already walked by the right flank.
    for (let r = n - 2; r >= 1; r--) {
      if (L(r) < L(r + 1)) row(L(r + 1) - 1, Y(r), L(r + 1) - L(r), -1);
      else {
        if (L(r) > L(r + 1)) row(L(r + 1) + 1, Y(r + 1), L(r) - L(r + 1) - 1, 1);
        if (L(r) < R(r)) px(L(r), Y(r), -1);
      }
    }
    // Back to the top row. Only a tread under a narrower top row remains.
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
 * Emit a segment's `n` pixels (walk indices i0 to i0+n−1) as runs. `at(k, len)`
 * maps pixels k to k+len−1 to a rect. Returns the walk index after the segment.
 * @param {AntsRun[]} out @param {number} i0 @param {number} phase @param {number} n
 * @param {(k:number, len:number) => {x:number, y:number, w:number, h:number}} at
 */
function segment(out, i0, phase, n, at) {
  for (let k = 0; k < n; ) {
    const q = (i0 + k + phase) % ANTS_PERIOD; // position in the cycle
    const black = q < ANTS_DASH;
    const left = (black ? ANTS_DASH : ANTS_PERIOD) - q; // px left in this dash
    const len = Math.min(left, n - k);
    out.push({ ...at(k, len), black });
    k += len;
  }
  return i0 + n;
}
