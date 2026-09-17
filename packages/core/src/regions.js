// Coplanar regions: one plane's exposed unit faces plus the gable-cap half
// faces of the wedge blocks, traced as boundary loops with collinear runs
// merged. A wall beside a slope gets one straight diagonal edge, so no
// vertices land on the slope. wedge-mesh.js triangulates the regions.
//
// Pieces use the face's tangent coordinates: a along FACE_GEO[face].A, b along
// .B. A cell is the unit square [a, a+1] × [b, b+1]. A half is the right
// triangle in that square with its right angle at (a + hiA, b + hiB). A long
// half (`run` 'a' or 'b') has a leg two cells long on that axis, over its cell
// and the next one away from the right angle, which takes `color2`. Each piece
// carries a packed color.
//
// Trace: each piece adds its directed edges, CCW in (a, b), with a long leg
// split at its midpoint. An edge whose reverse is also present is interior and
// cancels. The remaining edges chain by the keep-left rule, taking the
// sharpest left turn at each vertex. Two cells that touch only at a corner
// form two loops. A loop can pass through a corner twice, which earcut
// handles. A loop with positive signed area is an outer, negative a hole.
// Holes and pieces belong to the smallest outer that contains a test point: a
// piece's centroid, or a point just inside the midpoint of a hole's first
// lattice step. Neither can lie on a lattice line or on a boundary edge.

import { FACE_KEYS, FACE_NORMAL } from './views.js';
import { FACE_GEO, idxFor } from './faces.js';

/**
 * @typedef {{a:number, b:number, color:number}} Cell
 * @typedef {{a:number, b:number, hiA:boolean, hiB:boolean, run?:'a'|'b',
 *            color:number, color2?:number}} Half
 * @typedef {number[][]} Loop  vertices [a, b] in order, the closing vertex not repeated
 * @typedef {{outer:Loop, holes:Loop[], a:number, b:number, w:number, h:number,
 *            texels:Uint32Array, present:Uint8Array, uniform:number|null, area2:number}} Region2D
 *   loops, bounding box (a, b, w, h) in cells, a texel per box cell (`present`
 *   marks the pieces), the single color or null, and twice the area (a cell 2,
 *   a half 1, a long half 2).
 * @typedef {Region2D & {face:string, s:number, normal:number[]}} Region
 */

const DIM = (dims, axis) => dims['n' + axis];

/** Twice the signed area (shoelace). Positive is CCW. @param {number[][]} poly */
function area2(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s;
}

/** Even-odd point-in-polygon, horizontal ray. Test points never have an integer y. */
function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < xi + ((y - yi) * (xj - xi)) / (yj - yi)) c = !c;
  }
  return c;
}

/** Drop the vertices where a loop runs straight on. */
function dropCollinear(ring) {
  const n = ring.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i - 1 + n) % n];
    const c = ring[i];
    const q = ring[(i + 1) % n];
    const ux = c[0] - p[0];
    const uy = c[1] - p[1];
    const vx = q[0] - c[0];
    const vy = q[1] - c[1];
    const straight = ux * vy - uy * vx === 0 && ux * vx + uy * vy > 0;
    if (!straight) out.push(c);
  }
  return out;
}

const gcd = (x, y) => (y ? gcd(y, x % y) : Math.abs(x));

/**
 * Trace the regions of one plane from its pieces.
 * @param {Cell[]} cells
 * @param {Half[]} halves
 * @returns {Region2D[]}
 */
export function traceRegions(cells, halves) {
  /** @type {{poly:number[][], at:number[], cells:Cell[], area2:number}[]} */
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
      cells: [{ a: c.a, b: c.b, color: c.color >>> 0 }],
      area2: 2,
    });
  }
  for (const h of halves) {
    const ca = h.a + (h.hiA ? 1 : 0); // the right angle's corner
    const cb = h.b + (h.hiB ? 1 : 0);
    const da = h.hiA ? -1 : 1; // away from the right angle
    const db = h.hiB ? -1 : 1;
    const la = h.run === 'a' ? 2 : 1; // leg lengths
    const lb = h.run === 'b' ? 2 : 1;
    let poly = [
      [ca, cb],
      [ca + da, cb],
      ...(la === 2 ? [[ca + 2 * da, cb]] : []),
      ...(lb === 2 ? [[ca, cb + 2 * db]] : []),
      [ca, cb + db],
    ];
    if (area2(poly) < 0) poly = [poly[0], ...poly.slice(1).reverse()];
    const color = h.color >>> 0;
    const color2 = (h.color2 ?? h.color) >>> 0;
    pieces.push({
      poly,
      at: [ca + (la * da) / 3, cb + (lb * db) / 3],
      cells: [
        { a: h.a, b: h.b, color },
        ...(la === 2 ? [{ a: h.a + da, b: h.b, color: color2 }] : []),
        ...(lb === 2 ? [{ a: h.a, b: h.b + db, color: color2 }] : []),
      ],
      area2: la * lb,
    });
  }

  // 1. Directed edges. An edge whose reverse is present is interior.
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

  // 2. The keep-left successor of each boundary edge.
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

  // 3. Loops: the cycles of the successor map.
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

  // 4. Outers and holes. Each hole and piece goes to the innermost outer around it.
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
    const g = gcd(q[0] - p[0], q[1] - p[1]);
    const dx = (q[0] - p[0]) / g; // the edge's lattice step
    const dy = (q[1] - p[1]) / g;
    // The hole lies to the right of every edge of its loop. A sixteenth of the
    // step, turned right from the step's midpoint, is inside it: no other
    // lattice line of an axis, 1:1 or 1:2 direction comes that close to the
    // midpoint.
    groups[owner(p[0] + dx / 2 + dy / 16, p[1] + dy / 2 - dx / 16)].holes.push(h);
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
      area += pc.area2;
      for (const c of pc.cells) {
        const i = c.a - a0 + (c.b - b0) * w;
        texels[i] = c.color;
        present[i] = 1;
        if (uniform === null) uniform = c.color;
        else if (uniform !== c.color) mixed = true;
      }
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

/** The map key for a plane: a face key and a slice. */
export const planeKey = (face, s) => face + '|' + s;

/**
 * The regions of every surface plane: the exposed faces in `surfaceMask`,
 * colored by `faceColor` (keyed idx*6 + f), plus each plane's halves.
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
