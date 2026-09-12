// Rounded-rectangle rasterization for the rect tool, shared by the drag preview
// and the commit.
//
// A rect over columns x0..x1 and rows y0..y1 is emitted as one run [xl, xr] per
// row. Each corner is a convex quarter-circle centered `rr` in from the outer
// corner. A corner texel at offset (i, j) is clipped while
// (rr - i)² + (rr - j)² > rr². `rr` is clamped to half the shorter side. A
// radius of 1 clips the single corner texel.

/**
 * Largest corner radius a w×h rect can take before the four arcs would overlap.
 * @param {number} w @param {number} h
 * @returns {number} floor(min(w,h)/2), never negative.
 */
export function maxCornerRadius(w, h) {
  return Math.max(0, Math.floor(Math.min(w, h) / 2));
}

/**
 * Shift-constrain a drag's moving corner to a square anchored at `start`. The
 * side is the smaller extent, in the drag's direction on each axis.
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
 * Call `cb(y, xl, xr)` with each row's inclusive run. A run can be empty
 * (xr < xl) only at the extreme radius. Callers skip those.
 *
 * @param {number} x0 @param {number} y0  top-left texel (inclusive)
 * @param {number} x1 @param {number} y1  bottom-right texel (inclusive)
 * @param {number} r   requested corner radius (clamped internally, floored)
 * @param {(y:number, xl:number, xr:number)=>void} cb
 */
export function roundedRectRows(x0, y0, x1, y1, r, cb) {
  if (x1 < x0 || y1 < y0) return; // empty or inverted
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const rr = Math.min(Math.max(0, Math.floor(r) || 0), maxCornerRadius(w, h));
  const r2 = rr * rr;
  for (let y = y0; y <= y1; y++) {
    let clip = 0; // columns clipped from each end of this row
    if (rr > 0) {
      const j = Math.min(y - y0, y1 - y); // rows in from the nearer horizontal edge
      if (j < rr) {
        // The clipped columns are a prefix of the row, so count them.
        const dj = rr - j;
        const dj2 = dj * dj;
        while (clip < rr && (rr - clip) * (rr - clip) + dj2 > r2) clip++;
      }
    }
    cb(y, x0 + clip, x1 - clip);
  }
}
