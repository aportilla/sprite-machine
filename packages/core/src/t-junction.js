// T-junction elimination for lattice meshes.
//
// Merged faces leave T-junctions: a vertex in the middle of another triangle's
// edge. They make the surface non-manifold, which breaks the watertight weld
// and glTF export. Every vertex is on the integer lattice, so the repair is
// exact: split each triangle edge at every mesh vertex strictly inside it, then
// re-triangulate the convex result with its own vertices.
//
// Only axis-aligned and 45° diagonal edges can carry interior vertices. Any
// other edge is a triangulation chord across a region or slope, where a valid
// surface has no vertex, so it is skipped.
//
// UVs are computed from position after the repair (skin.js uvOfLattice).

const key = (p) => p[0] + ',' + p[1] + ',' + p[2];

// Vertices in `vset` strictly inside segment p->q, ordered p->q. Returns []
// unless p->q is axis-aligned or a 45° diagonal.
function interiorPointsOnEdge(p, q, vset) {
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const axes = [];
  for (let i = 0; i < 3; i++) if (d[i] !== 0) axes.push(i);
  if (axes.length === 0 || axes.length === 3) return []; // degenerate, or a chord
  const n = Math.abs(d[axes[0]]);
  if (axes.length === 2 && Math.abs(d[axes[1]]) !== n) return []; // not 45°
  const out = [];
  for (let t = 1; t < n; t++) {
    const pt = [p[0], p[1], p[2]];
    for (const i of axes) pt[i] += Math.sign(d[i]) * t;
    if (vset.has(key(pt))) out.push(pt);
  }
  return out;
}

// Triangulate a convex polygon, wound CCW about `normal`, using only its own
// vertices. Collinear boundary points are allowed. Only a strictly convex
// corner whose edge prev->next contains no other vertex is clipped. Otherwise
// the ear would span a split edge and reintroduce a T-junction.
function triangulateConvex(ring, normal, emit) {
  const turn = (o, a, b) => {
    const ux = a[0] - o[0],
      uy = a[1] - o[1],
      uz = a[2] - o[2];
    const vx = b[0] - o[0],
      vy = b[1] - o[1],
      vz = b[2] - o[2];
    return (
      (uy * vz - uz * vy) * normal[0] +
      (uz * vx - ux * vz) * normal[1] +
      (ux * vy - uy * vx) * normal[2]
    );
  };
  // v lies strictly inside segment p->q.
  const onSeg = (p, q, v) => {
    const dx = q[0] - p[0],
      dy = q[1] - p[1],
      dz = q[2] - p[2];
    const ex = v[0] - p[0],
      ey = v[1] - p[1],
      ez = v[2] - p[2];
    if (dy * ez - dz * ey || dz * ex - dx * ez || dx * ey - dy * ex) return false;
    const dot = dx * ex + dy * ey + dz * ez;
    return dot > 0 && dot < dx * dx + dy * dy + dz * dz;
  };
  const poly = ring.slice();
  let guard = poly.length * poly.length + 8;
  while (poly.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < poly.length; i++) {
      const prev = poly[(i - 1 + poly.length) % poly.length];
      const cur = poly[i];
      const next = poly[(i + 1) % poly.length];
      if (turn(prev, cur, next) <= 0) continue; // reflex or collinear
      let blocked = false;
      for (let j = 0; j < poly.length && !blocked; j++)
        if (
          poly[j] !== prev &&
          poly[j] !== cur &&
          poly[j] !== next &&
          onSeg(prev, next, poly[j])
        )
          blocked = true;
      if (blocked) continue;
      emit(prev, cur, next);
      poly.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Fallback: fan from a strictly convex vertex. Ear clipping should always
      // progress on a convex polygon.
      let ai = 0;
      for (let i = 0; i < poly.length; i++) {
        const prev = poly[(i - 1 + poly.length) % poly.length];
        const next = poly[(i + 1) % poly.length];
        if (turn(prev, poly[i], next) > 0) {
          ai = i;
          break;
        }
      }
      for (let k = 1; k < poly.length - 1; k++) {
        const w1 = poly[(ai + k) % poly.length];
        const w2 = poly[(ai + k + 1) % poly.length];
        if (turn(poly[ai], w1, w2) !== 0) emit(poly[ai], w1, w2);
      }
      return;
    }
  }
  if (poly.length === 3 && turn(poly[0], poly[1], poly[2]) !== 0)
    emit(poly[0], poly[1], poly[2]);
}

/**
 * @template {{a:number[], b:number[], c:number[], normal:number[]}} T
 * @param {T[]} tris
 *   triangles with integer lattice vertices, wound CCW about `normal`.
 * @returns {T[]}
 *   the same surface with no T-junctions. Pieces of a split triangle keep its
 *   other fields.
 */
export function eliminateTJunctions(tris) {
  const vset = new Set();
  for (const t of tris) {
    vset.add(key(t.a));
    vset.add(key(t.b));
    vset.add(key(t.c));
  }

  const out = [];
  for (const t of tris) {
    const ab = interiorPointsOnEdge(t.a, t.b, vset);
    const bc = interiorPointsOnEdge(t.b, t.c, vset);
    const ca = interiorPointsOnEdge(t.c, t.a, vset);
    if (!ab.length && !bc.length && !ca.length) {
      out.push(t);
      continue;
    }
    const ring = [t.a, ...ab, t.b, ...bc, t.c, ...ca];
    triangulateConvex(ring, t.normal, (a, b, c) => out.push({ ...t, a, b, c }));
  }
  return out;
}
