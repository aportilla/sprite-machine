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
