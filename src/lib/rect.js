// ---------------------------------------------------------------------------
// Rounded-rectangle rasterization for the editor's rect tool. Pure integer
// geometry — no DOM, no THREE — so the live drag preview and the commit-to-pixels
// pass share ONE source of truth (and it stays Node-testable).
//
// A rect spanning texel columns x0..x1 and rows y0..y1 with integer corner radius
// r is emitted as ONE horizontal run [xl, xr] per row: a rounded rectangle is
// convex on every row, so a row is always a single contiguous span. The caller
// fills that span (preview: one fillRect; commit: writeTexel across it).
//
// Each corner is a CONVEX quarter-circle: the arc is centered on the point inset
// by `rr` from the outer corner, so the corner bulges OUTWARD toward the corner
// like a normal rounded rectangle (not a concave scoop). Concretely, a corner-block
// texel at offset (i, j) from its outer corner is clipped while it lies OUTSIDE
// that circle — `(rr - i)² + (rr - j)² > rr²` — which rounds off the outer corner
// and leaves the interior. `rr` is clamped to half the shorter side so the four
// arcs never cross. Even `radius: 1` clips the single corner texel.
// ---------------------------------------------------------------------------

/**
 * Largest corner radius a w×h rect can take before the four arcs would overlap.
 * @param {number} w @param {number} h
 * @returns {number} floor(min(w,h)/2), never negative.
 */
export function maxCornerRadius(w, h) {
  return Math.max(0, Math.floor(Math.min(w, h) / 2));
}

/**
 * Constrain a drag's moving corner so the box is a SQUARE anchored at `start`
 * (the Shift-lock): the side is the smaller of the two extents, so the square fits
 * inside the raw drag and grows along each axis in the drag's own direction.
 * @param {{px:number,py:number}} start  the fixed anchor corner
 * @param {{px:number,py:number}} end    the raw moving corner
 * @returns {{px:number,py:number}} the constrained moving corner
 */
export function squareEnd(start, end) {
  const dx = end.px - start.px;
  const dy = end.py - start.py;
  const side = Math.min(Math.abs(dx), Math.abs(dy));
  return {
    px: start.px + (dx < 0 ? -side : side),
    py: start.py + (dy < 0 ? -side : side),
  };
}

/**
 * Walk a rounded rectangle row by row, invoking `cb(y, xl, xr)` once per row with
 * the inclusive horizontal run for that row. A run can be empty (xr < xl) only for
 * a near-circular corner at the extreme radius; callers skip those.
 *
 * @param {number} x0 @param {number} y0  top-left texel (inclusive)
 * @param {number} x1 @param {number} y1  bottom-right texel (inclusive)
 * @param {number} r   requested corner radius (clamped internally, floored)
 * @param {(y:number, xl:number, xr:number)=>void} cb
 */
export function roundedRectRows(x0, y0, x1, y1, r, cb) {
  if (x1 < x0 || y1 < y0) return; // degenerate / inverted → nothing
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const rr = Math.min(Math.max(0, Math.floor(r) || 0), maxCornerRadius(w, h));
  const r2 = rr * rr;
  for (let y = y0; y <= y1; y++) {
    let clip = 0; // columns removed from EACH end of this row by the corner arcs
    if (rr > 0) {
      const j = Math.min(y - y0, y1 - y); // rows in from the nearer horizontal edge
      if (j < rr) {
        // Clip the leading columns whose cell falls outside the corner circle
        // centered at the inset point. The outside region is a prefix of the row
        // (the arc is monotonic), so count it: column `clip` is out while
        // `(rr - clip)² + (rr - j)² > rr²`.
        const dj = rr - j;
        const dj2 = dj * dj;
        while (clip < rr && (rr - clip) * (rr - clip) + dj2 > r2) clip++;
      }
    }
    cb(y, x0 + clip, x1 - clip);
  }
}
