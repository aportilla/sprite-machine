// ---------------------------------------------------------------------------
// Low-poly builder (z-sweep slab loft on the true visual-hull cross-section).
//
// The 3D visual hull factorizes: a voxel is solid iff FRONT(x,y) AND the top
// view puts x in its column-interval at z AND the side view puts y in its
// row-interval at z. So at each depth z the cross-section is the traced FRONT
// polygon CLIPPED to the axis-aligned box [Xint(z)] x [Yint(z)] — a 2D box clip
// (Sutherland-Hodgman), never a 3D CSG kernel. Sweeping/lofting those cross-
// sections along z yields flat facets by construction (no melt, no chamfer).
//
// This file starts with the pure, Node-testable core: `sweepSolidGrid` must
// equal carve() bit-for-bit (the make-or-break correctness proof). Geometry
// emission is layered on once that holds.
// ---------------------------------------------------------------------------

import { marchingSquares, clipLoopBox, rasterizeLoops } from './vectorize.js';
import { VIEWS } from './views.js';

// Reconstruct the three plane masks in the GRID frame from the co-registered
// gviews (inverting VIEWS.project), ANDing the two views that share a plane so
// the result matches carve() exactly.
export function reconstructPlanes(result) {
  const { dims, gviews } = result;
  const { nx, ny, nz } = dims;
  const at = (name, u, v) => {
    const gv = gviews[name];
    return gv ? gv.occ[v * gv.imgW + u] : 1; // missing view = no constraint
  };
  const has = (name) => !!gviews[name];

  const xy = new Uint8Array(nx * ny); // front plane (x,y)
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      let on = 1;
      if (has('front')) on &= at('front', x, ny - 1 - y);
      if (has('back')) on &= at('back', nx - 1 - x, ny - 1 - y);
      xy[x + nx * y] = on;
    }
  const xz = new Uint8Array(nx * nz); // top plane (x,z)
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++) {
      let on = 1;
      if (has('top')) on &= at('top', x, nz - 1 - z);
      if (has('bottom')) on &= at('bottom', x, z);
      xz[x + nx * z] = on;
    }
  const zy = new Uint8Array(nz * ny); // side plane (z,y)
  for (let y = 0; y < ny; y++)
    for (let z = 0; z < nz; z++) {
      let on = 1;
      if (has('right')) on &= at('right', nz - 1 - z, ny - 1 - y);
      if (has('left')) on &= at('left', z, ny - 1 - y);
      zy[z + nz * y] = on;
    }
  return { xy, xz, zy };
}

// Ramer-Douglas-Peucker on a polyline of [t, v] points (keeps sharp corners).
export function rdp(points, eps) {
  if (points.length < 3) return points.slice();
  let maxD = 0, idx = 0;
  const a = points[0], b = points[points.length - 1];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const d = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [a, b];
  const left = rdp(points.slice(0, idx + 1), eps);
  const right = rdp(points.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

// Per-corner-plane smoothed bound evaluators from the top/side masks. Each bound
// (xlo,xhi,ylo,yhi) is the interval endpoint per z; we RDP-simplify it over z so
// a diagonal windshield becomes ONE linear ramp instead of a staircase.
export function smoothedBounds(xz, zy, dims, eps = 0.8) {
  const { nx, ny, nz } = dims;
  const raw = { xlo: [], xhi: [], ylo: [], yhi: [], z: [] };
  let zmin = -1, zmax = -1;
  for (let z = 0; z < nz; z++) {
    let xl = -1, xh = -1, yl = -1, yh = -1;
    for (let x = 0; x < nx; x++) if (xz[x + nx * z]) { if (xl < 0) xl = x; xh = x; }
    for (let y = 0; y < ny; y++) if (zy[z + nz * y]) { if (yl < 0) yl = y; yh = y; }
    if (xl < 0 || yl < 0) { raw.z.push(null); continue; }
    if (zmin < 0) zmin = z;
    zmax = z;
    raw.z.push({ xlo: xl, xhi: xh + 1, ylo: yl, yhi: yh + 1 });
  }
  // Build polylines over z (cell centers) for each bound, RDP, evaluator.
  const build = (key) => {
    const pts = [];
    for (let z = zmin; z <= zmax; z++) if (raw.z[z]) pts.push([z + 0.5, raw.z[z][key]]);
    const simp = rdp(pts, eps);
    return (k) => {
      if (k <= simp[0][0]) return simp[0][1];
      if (k >= simp[simp.length - 1][0]) return simp[simp.length - 1][1];
      for (let i = 0; i < simp.length - 1; i++) {
        const [t0, v0] = simp[i], [t1, v1] = simp[i + 1];
        if (k >= t0 && k <= t1) return v0 + ((v1 - v0) * (k - t0)) / (t1 - t0);
      }
      return simp[simp.length - 1][1];
    };
  };
  return { xlo: build('xlo'), xhi: build('xhi'), ylo: build('ylo'), yhi: build('yhi'), zmin, zmax };
}

// Contiguous [lo,hi] cell interval where `has(i)` is true, else null.
function span(has, n) {
  let lo = -1, hi = -1;
  for (let i = 0; i < n; i++) if (has(i)) { if (lo < 0) lo = i; hi = i; }
  return lo < 0 ? null : [lo, hi];
}

/**
 * Cross-section polygon loops at depth z: the traced FRONT contour clipped to
 * the top/side intervals. Loops fully outside the box vanish (a wheel post
 * beyond its z-extent disappears) — exactly the hull.
 * @returns {Array<Array<[number,number]>>} clipped loops (may be empty)
 */
export function crossSectionAt(frontLoops, xInt, yInt) {
  if (!xInt || !yInt) return [];
  const [xlo, xhi] = xInt;
  const [ylo, yhi] = yInt;
  const out = [];
  for (const loop of frontLoops) {
    const c = clipLoopBox(loop, xlo, xhi + 1, ylo, yhi + 1); // cells -> corner box
    if (c.length >= 3) out.push(c);
  }
  return out;
}

/**
 * Rasterize the swept cross-sections back to an occupancy grid. Used to PROVE
 * the construction equals carve() before any geometry is built.
 * @param {Uint8Array} front nx*ny  @param {Uint8Array} top nx*nz  @param {Uint8Array} side nz*ny
 */
export function sweepSolidGrid(front, top, side, dims) {
  const { nx, ny, nz } = dims;
  const frontLoops = marchingSquares(front, nx, ny);
  const solid = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) {
    const xInt = span((x) => top[x + nx * z], nx);
    const yInt = span((y) => side[z + nz * y], ny);
    const loops = crossSectionAt(frontLoops, xInt, yInt);
    if (loops.length === 0) continue;
    const slice = rasterizeLoops(loops, nx, ny);
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++)
        if (slice[y * nx + x]) solid[x + nx * (y + ny * z)] = 1;
  }
  return solid;
}

// Reference carve for the grid-frame masks (mirrors carve.js's AND, used by the
// equality test): solid iff front(x,y) AND top(x,z) AND side(z,y).
export function carveGrid(front, top, side, dims) {
  const { nx, ny, nz } = dims;
  const solid = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++)
        if (front[x + nx * y] && top[x + nx * z] && side[z + nz * y])
          solid[x + nx * (y + ny * z)] = 1;
  return solid;
}
