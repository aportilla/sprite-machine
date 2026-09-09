// ---------------------------------------------------------------------------
// Coplanar REGIONS: the union of one plane's exposed unit faces and the gable
// cap half-faces the wedge blocks end on, traced as boundary loops on the
// lattice with every collinear run merged — so a wall beside a 45° slope has
// ONE straight diagonal edge where a stack of rectangles plus a sawtooth of
// gable triangles had a vertex at every step, each pinning a vertex on the
// slope that the T-junction repair then had to split the slope at. Pure 2D
// lattice work, no THREE, Node-tested; the triangulation of a region (earcut,
// through THREE's ShapeUtils) is the mesher's (wedge-mesh.js).
//
// Pieces on one plane, in the face's tangent coordinates (a along
// FACE_GEO[face].A, b along .B): a CELL is the unit square [a, a+1] × [b, b+1]
// — an exposed voxel face; a HALF is the right triangle in that square whose
// right angle sits at the corner (a + hiA, b + hiB) — a gable cap, the
// prism's cross-section. Every piece carries its packed colour: a face's from
// colorize, a cap's the wedge's. A texel per piece is a texel per unit
// square, the skin's orientation rule (skin.js).
//
// The trace: every piece contributes its directed edges, CCW in (a, b); an
// edge whose reverse another piece contributes is interior and cancels; the
// survivors are chained by the KEEP-LEFT rule — at a vertex with several ways
// on, the sharpest left turn — which pairs each arriving edge with the one
// leaving along its own sector of the region. So two cells that meet only at
// a corner are two loops (two regions, as they should be), while a bay that
// opens onto the outside through a corner rides the outer loop through that
// corner twice, and two holes meeting at a corner ride one hole loop twice:
// a self-touching ring, the very shape earcut builds when it bridges a hole
// into the outer, and one its ear test handles by design (the zero-length
// diagonal case); the mesher asserts every region triangulates to its full
// area. A loop with positive signed area is an OUTER, negative a HOLE. A hole
// and a piece belong to the smallest outer containing a point of theirs (a
// piece's centroid, a point a quarter-cell inside a hole's first edge —
// neither ever on a lattice line or a diagonal a piece can have), so an
// island inside a hole is its own region.
// ---------------------------------------------------------------------------

import { FACE_KEYS, FACE_NORMAL } from './views.js';
import { FACE_GEO, idxFor } from './faces.js';

/**
 * @typedef {{a:number, b:number, color:number}} Cell
 * @typedef {{a:number, b:number, hiA:boolean, hiB:boolean, color:number}} Half
 * @typedef {number[][]} Loop  vertices [a, b] in order, the closing vertex not repeated
 * @typedef {{outer:Loop, holes:Loop[], a:number, b:number, w:number, h:number,
 *            texels:Uint32Array, present:Uint8Array, uniform:number|null, area2:number}} Region2D
 *   a region: its loops, its bounding box (a, b, w, h) in cells, a texel per
 *   box cell (`present` marks the pieces'), its one colour or null, and
 *   twice its area (a cell 2, a half 1).
 * @typedef {Region2D & {face:string, s:number, normal:number[]}} Region
 */

const DIM = (dims, axis) => dims['n' + axis];

/** Twice the signed area of a polygon (shoelace); positive is CCW. @param {number[][]} poly */
function area2(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s;
}

/** Even-odd point-in-polygon; the ray is horizontal, and no test point here has an integer y. */
function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < xi + ((y - yi) * (xj - xi)) / (yj - yi)) c = !c;
  }
  return c;
}

/** Drop the vertices a ring runs straight through. Ring edges are unit steps, so a step's sign is its direction. */
function dropCollinear(ring) {
  const n = ring.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i - 1 + n) % n];
    const c = ring[i];
    const q = ring[(i + 1) % n];
    const straight =
      Math.sign(c[0] - p[0]) === Math.sign(q[0] - c[0]) &&
      Math.sign(c[1] - p[1]) === Math.sign(q[1] - c[1]);
    if (!straight) out.push(c);
  }
  return out;
}

/**
 * Trace the regions of one plane from its pieces.
 * @param {Cell[]} cells
 * @param {Half[]} halves
 * @returns {Region2D[]}
 */
export function traceRegions(cells, halves) {
  /** @type {{poly:number[][], at:number[], color:number, a:number, b:number, half:boolean}[]} */
  const pieces = [];
  for (const c of cells) {
    pieces.push({
      poly: [
        [c.a, c.b],
        [c.a + 1, c.b],
        [c.a + 1, c.b + 1],
        [c.a, c.b + 1],
      ],
      at: [c.a + 0.5, c.b + 0.5],
      color: c.color >>> 0,
      a: c.a,
      b: c.b,
      half: false,
    });
  }
  for (const h of halves) {
    const ca = h.a + (h.hiA ? 1 : 0); // the right angle's corner
    const cb = h.b + (h.hiB ? 1 : 0);
    const qa = h.a + (h.hiA ? 0 : 1); // the legs' far ends
    const sb = h.b + (h.hiB ? 0 : 1);
    let poly = [
      [ca, cb],
      [qa, cb],
      [ca, sb],
    ];
    if (area2(poly) < 0) poly = [poly[0], poly[2], poly[1]];
    pieces.push({
      poly,
      at: [(2 * ca + qa) / 3, (2 * cb + sb) / 3],
      color: h.color >>> 0,
      a: h.a,
      b: h.b,
      half: true,
    });
  }

  // 1. directed edges; one whose reverse is present is interior and cancels
  const ekey = (p, q) => p[0] + ',' + p[1] + '>' + q[0] + ',' + q[1];
  /** @type {Map<string, {p:number[], q:number[]}>} */
  const edges = new Map();
  for (const pc of pieces)
    for (let i = 0; i < pc.poly.length; i++) {
      const p = pc.poly[i];
      const q = pc.poly[(i + 1) % pc.poly.length];
      if (edges.has(ekey(p, q)))
        throw new Error(`regions: two pieces share the edge ${ekey(p, q)}`);
      edges.set(ekey(p, q), { p, q });
    }
  const boundary = [];
  for (const e of edges.values()) if (!edges.has(ekey(e.q, e.p))) boundary.push(e);

  // 2. the keep-left successor of every boundary edge
  const vkey = (p) => p[0] + ',' + p[1];
  /** @type {Map<string, {p:number[], q:number[]}[]>} */
  const outAt = new Map();
  for (const e of boundary) {
    const k = vkey(e.p);
    if (!outAt.has(k)) outAt.set(k, []);
    outAt.get(k).push(e);
  }
  const next = new Map();
  for (const e of boundary) {
    const dx = e.q[0] - e.p[0];
    const dy = e.q[1] - e.p[1];
    let best = null;
    let bestTurn = -Infinity;
    for (const f of outAt.get(vkey(e.q)) || []) {
      const fx = f.q[0] - f.p[0];
      const fy = f.q[1] - f.p[1];
      const turn = Math.atan2(dx * fy - dy * fx, dx * fx + dy * fy);
      if (turn > bestTurn) {
        bestTurn = turn;
        best = f;
      }
    }
    if (!best) throw new Error('regions: the boundary is open at ' + vkey(e.q));
    next.set(e, best);
  }

  // 3. the loops: the cycles of the successor map
  const seen = new Set();
  /** @type {Loop[]} */
  const loops = [];
  for (const e0 of boundary) {
    if (seen.has(e0)) continue;
    const ring = [];
    let e = e0;
    do {
      seen.add(e);
      ring.push(e.p);
      e = next.get(e);
    } while (e !== e0 && !seen.has(e));
    if (e !== e0) throw new Error('regions: the boundary walk did not close');
    loops.push(dropCollinear(ring));
  }

  // 4. outers and holes; each hole and each piece to the innermost outer around it
  /** @type {Loop[]} */
  const outers = [];
  /** @type {Loop[]} */
  const holes = [];
  for (const loop of loops) (area2(loop) > 0 ? outers : holes).push(loop);
  outers.sort((p, q) => area2(p) - area2(q));
  const owner = (x, y) => {
    for (let i = 0; i < outers.length; i++) if (inside(outers[i], x, y)) return i;
    throw new Error(`regions: (${x}, ${y}) lies in no outer loop`);
  };
  const groups = outers.map((outer) => ({ outer, holes: [], pieces: [] }));
  for (const h of holes) {
    const [p, q] = h;
    const dx = Math.sign(q[0] - p[0]);
    const dy = Math.sign(q[1] - p[1]);
    // a quarter-cell to the RIGHT of the hole's first edge: the region is on
    // the left of every loop, so the right is the hole's own emptiness
    groups[
      owner((p[0] + q[0]) / 2 + 0.25 * dy, (p[1] + q[1]) / 2 - 0.25 * dx)
    ].holes.push(h);
  }
  for (const pc of pieces) groups[owner(pc.at[0], pc.at[1])].pieces.push(pc);

  return groups.map(({ outer, holes, pieces }) => {
    let a0 = Infinity,
      b0 = Infinity,
      a1 = -Infinity,
      b1 = -Infinity;
    for (const [a, b] of outer) {
      if (a < a0) a0 = a;
      if (b < b0) b0 = b;
      if (a > a1) a1 = a;
      if (b > b1) b1 = b;
    }
    const w = a1 - a0;
    const h = b1 - b0;
    const texels = new Uint32Array(w * h);
    const present = new Uint8Array(w * h);
    let uniform = null;
    let mixed = false;
    let area = 0;
    for (const pc of pieces) {
      const i = pc.a - a0 + (pc.b - b0) * w;
      texels[i] = pc.color;
      present[i] = 1;
      area += pc.half ? 1 : 2;
      if (uniform === null) uniform = pc.color;
      else if (uniform !== pc.color) mixed = true;
    }
    return {
      outer,
      holes,
      a: a0,
      b: b0,
      w,
      h,
      texels,
      present,
      uniform: mixed ? null : uniform,
      area2: area,
    };
  });
}

/** The key a plane's halves are filed under: a face key at a slice. */
export const planeKey = (face, s) => face + '|' + s;

/**
 * The regions of every plane of the surface: the exposed faces of `surfaceMask`
 * (coloured by `faceColor`, keyed idx*6 + f) plus the halves filed per plane.
 * @param {{nx:number, ny:number, nz:number}} dims
 * @param {Uint8Array} surfaceMask
 * @param {Map<number, number>} faceColor
 * @param {Map<string, Half[]>} [halves]  by planeKey(face, s)
 * @returns {Region[]}
 */
export function faceRegions(dims, surfaceMask, faceColor, halves = new Map()) {
  /** @type {Region[]} */
  const out = [];
  FACE_KEYS.forEach((face, f) => {
    const g = FACE_GEO[face];
    const normal = FACE_NORMAL[face];
    const dimN = DIM(dims, g.N);
    const dimA = DIM(dims, g.A);
    const dimB = DIM(dims, g.B);
    for (let s = 0; s < dimN; s++) {
      /** @type {Cell[]} */
      const cells = [];
      for (let b = 0; b < dimB; b++)
        for (let a = 0; a < dimA; a++) {
          const idx = idxFor(face, a, b, s, dims);
          if (surfaceMask[idx] & (1 << f))
            cells.push({ a, b, color: faceColor.get(idx * 6 + f) >>> 0 });
        }
      const hs = halves.get(planeKey(face, s)) || [];
      if (!cells.length && !hs.length) continue;
      for (const r of traceRegions(cells, hs)) out.push({ face, s, normal, ...r });
    }
  });
  return out;
}
