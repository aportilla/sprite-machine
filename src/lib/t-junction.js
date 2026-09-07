// ---------------------------------------------------------------------------
// T-junction elimination for lattice meshes.
//
// Greedy-merging faces into large rectangles introduces T-junctions: a vertex
// that lands in the MIDDLE of a longer triangle's edge — e.g. where a merged
// base rectangle meets a unit-scale wedge edge, or two faces merged to different
// extents meet at an object corner. It's invisible for opaque flat-shaded
// geometry, but it makes the surface NON-manifold (edges no longer paired),
// which breaks the watertight weld and clean glTF export.
//
// Every vertex here sits on the integer lattice, so repair is exact — no
// floating-point tolerance. Collect all vertex positions, then split each
// triangle edge at any vertex lying strictly on its interior, re-triangulating
// the (convex) result with lattice-only vertices. Pure integer geometry: no
// THREE, Node-testable.
//
// Only AXIS-ALIGNED edges can carry interior lattice points here (base-rect
// edges); wedge edges are unit-length or unit-diagonal and a valid surface
// never has a vertex in a face interior, so a rect's own diagonal is safe.
//
// A triangle is an opaque record beyond its three vertices: every other field
// (the normal, and the mesher's paint — a chart and its rect, or a swatch
// color) is copied onto each piece a split produces, so the repair never has
// to know what rides on a triangle. UVs are NOT carried through here: they
// are a function of position (skin.js uvOfLattice), read after the repair.
// ---------------------------------------------------------------------------

const key = (p) => p[0] + ',' + p[1] + ',' + p[2];

// Integer lattice points strictly interior to segment p->q that are in `vset`,
// ordered p->q. Returns [] unless p->q is axis-aligned.
function interiorPointsOnEdge(p, q, vset) {
  let ax = -1;
  for (let i = 0; i < 3; i++) {
    if (p[i] !== q[i]) {
      if (ax >= 0) return []; // differs on >1 axis -> not axis-aligned
      ax = i;
    }
  }
  if (ax < 0) return []; // degenerate (p === q)
  const step = q[ax] > p[ax] ? 1 : -1;
  const out = [];
  for (let t = p[ax] + step; t !== q[ax]; t += step) {
    const pt = [p[0], p[1], p[2]];
    pt[ax] = t;
    if (vset.has(key(pt))) out.push(pt);
  }
  return out;
}

// Triangulate a convex polygon (wound CCW wrt `normal`) using only its own
// vertices, tolerating collinear boundary points. Clip only a strictly-convex
// corner whose EAR EDGE (prev->next) carries no other vertex — otherwise the ear
// would span a subdivided edge and re-introduce the T-junction we're removing.
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
  // v strictly interior to segment p->q (collinear + between the endpoints).
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
      // Defensive: fan from a strictly-convex vertex (clean-ear clipping should
      // always progress for a convex polygon, so this is a safety net only).
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
 *   triangles with INTEGER-lattice vertex coords, wound CCW wrt `normal`.
 * @returns {T[]}
 *   an equivalent surface with no T-junctions (every edge split at interior
 *   verts); a split triangle's pieces carry every field of their source but
 *   the three vertices.
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
