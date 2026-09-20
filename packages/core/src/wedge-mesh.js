// Low-poly wedge mesher over the voxel model (solid, surfaceMask, faceColor).
//
// Wedges: an empty cell with solid neighbors on two adjacent in-plane sides,
// and empty cells on the other two, is the inner corner of a staircase. It is
// filled with a triangular prism along the ridge axis. A 1:1 wedge fills the
// cell under a 45° slope. A 1:2 wedge also fills the cell beside it along one
// leg, so a staircase of two-cell steps is one slope. The faces a wedge covers
// are culled and its open ends get triangular gable caps. A wedge fires only
// when the faces it covers are the same material, so a color boundary stays a
// step. Wedges only fill notches, so convex corners stay sharp. One wedge per
// cell. The first ridge in RIDGES wins, and within a ridge a 1:2 wins over a
// 1:1.
//
// Corners: where arms cap into one cell their caps leave a gap whose rim is on
// the lattice. A rim of three points takes one triangle, one of four takes two
// split on the diagonal raised across the gap, and a triangle needs two rim
// edges of one color and takes it, so a two-color corner is a sharp color edge.
// The kinds are hips (two arms over a shared solid), corner tetrahedra (three),
// cut cubes and valleys (an inside corner, which only a layer union makes) and
// the facet where a 1:2 arm and a 1:1 meet along one ridge. What they leave
// goes to a last pass that takes the rim from the gap itself: the caps facing
// one group of empty cells and those cells' exposed solid faces. A gap no pass
// matches keeps today's gable.
//
// Geometry is emitted per plane:
// - Slopes: the wedges and folds of one slope plane form a grid, traced per
//   color (regions.js) into one polygon per region.
// - Base faces: coplanar regions of exposed faces and cap halves, triangulated
//   with earcut.
// Color comes from the skin (skin.js), so regions merge on occupancy alone.
// UVs are read from lattice positions after the T-junction repair.
//
// Not handled: convex staircases still step, and a corner whose rim does not
// come out at three or four points keeps its gable.

import earcut from 'earcut';
import { voxIndex } from './carve.js';
import { FACE_GEO, pointOf } from './faces.js';
import { faceRegions, planeKey, traceRegions } from './regions.js';
import { unpackRGBA } from './ingest.js';
import { bakeSkin, uvOfLattice, swatchUV } from './skin.js';
import { eliminateTJunctions } from './t-junction.js';
import { weldVertices } from './weld.js';
import { AXIS_INDEX, FACE_INDEX, FACE_NORMAL, faceKeyOf } from './views.js';
import { DEFAULT_WORLD_SIZE } from './constants.js';

const AXI = AXIS_INDEX;
const FLAT_COLOR = 0xffcfcfd6;

// Ridge axes (R, the axis a prism extends along) with their in-plane axes A and
// B. Order matters: z comes first, so z-ridges win the one-wedge-per-cell tie.
const RIDGES = [
  { R: 'z', A: 'x', B: 'y' },
  { R: 'x', A: 'z', B: 'y' },
  { R: 'y', A: 'x', B: 'z' },
];

/**
 * A lattice triangle and its paint: its chart and region when the region is
 * charted, otherwise the packed color of the swatch it samples.
 * @typedef {{a:number[], b:number[], c:number[], normal:number[],
 *            chart:import('./skin.js').Chart|null,
 *            region:import('./regions.js').Region|null,
 *            swatch:number|null}} Tri
 */

/**
 * A wedge cell: its notch's ridge and in-plane axes, the sides its solids are
 * on, and the slope's color. A 1:2 has its long axis in `run` and a record for
 * each cell: the notch q and the cell p beside it. A 1:1 has `run` null.
 * @typedef {{x:number, y:number, z:number, R:string, A:string, B:string,
 *            sA:number, sB:number, color:number, run:string|null,
 *            role:'q'|'p'}} Wedge
 */

/**
 * One slope plane's trace grid: the orientation its wedges share, the lattice
 * point P₀ of its grid vertex (0, t₀), and its pieces by packed color.
 * @typedef {{R:string, L:string, S:string, sL:number, sS:number, n:number,
 *            P0:number[], t0:number,
 *            cells:Map<number, import('./regions.js').Cell[]>,
 *            halves:Map<number, import('./regions.js').Half[]>}} Plane
 */

/**
 * Indexed triangle buffers: xyz positions centered on X and Z with Y as
 * authored (see carve.js), unit normals, uv pairs in [0, 1] (zero in flat
 * mode), CCW index triples and the positions' bounds.
 * @typedef {{position:Float32Array, normal:Float32Array, uv:Float32Array,
 *            index:Uint32Array, bounds:{min:number[], max:number[]}}} Geometry
 */

/**
 * The mesher's output: the geometry, the skin or, in flat mode, a packed flat
 * color, and the counts. sprite-machine/three turns it into a THREE.Mesh.
 * @typedef {{geometry:Geometry, skin:import('./skin.js').Skin|null,
 *            color:number|null, triangles:number, wedges:number,
 *            slopes:number, corners:number, gaps:number, charts:number}} Built
 *   `corners` counts the corner fills and `gaps` the ends still capping into a
 *   corner the pass did not match.
 */

/**
 * @param {object} result  a buildVoxels result
 * @param {{flat?:boolean, worldSize?:number}} [opts]  `flat` skips the skin
 *   and the wedge gate; `worldSize` is the longest side's length
 * @returns {Built}
 */
export function wedgeMesh(result, opts = {}) {
  const { dims, solid, surfaceMask, faceColor } = result;
  const { nx, ny, nz } = dims;
  const flat = !!opts.flat;
  const worldSize = opts.worldSize ?? DEFAULT_WORLD_SIZE;
  const s = worldSize / Math.max(nx, ny, nz);

  // Art from other tools can split one material into near-duplicate colors, by
  // antialiasing or a noised canvas read. sameMat allows a squared RGB distance
  // up to TOL2.
  const TOL2 = 12 * 12;
  const sameMat = (a, b) => {
    if (a == null || b == null) return false;
    // Compare RGB only. Alpha is always 255 here.
    if (((a >>> 0) & 0xffffff) === ((b >>> 0) & 0xffffff)) return true;
    const A = unpackRGBA(a);
    const B = unpackRGBA(b);
    return (A.r - B.r) ** 2 + (A.g - B.g) ** 2 + (A.b - B.b) ** 2 <= TOL2;
  };

  const inLattice = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz;
  /** @param {number[]} c  a cell [x, y, z] */
  const inBounds = (c) => inLattice(c[0], c[1], c[2]);
  /** @param {number[]} c */
  const cellIdx = (c) => voxIndex(c[0], c[1], c[2], dims);
  /** @param {number[]} c */
  const solidAt = (c) => inBounds(c) && !!solid[cellIdx(c)];
  /** @param {number[]} c @param {string} ax @param {number} d */
  const step = (c, ax, d) => {
    const n = c.slice();
    n[AXI[ax]] += d;
    return n;
  };
  // the key of cell c's face that points d along ax
  const faceKey = (c, ax, d) => cellIdx(c) * 6 + FACE_INDEX[faceKeyOf(ax, d)];
  // whether the cell d from c along axis index i is solid, with no allocation
  const solidBeside = (c, i, d) => {
    const x = i === 0 ? c[0] + d : c[0];
    const y = i === 1 ? c[1] + d : c[1];
    const z = i === 2 ? c[2] + d : c[2];
    return inLattice(x, y, z) && !!solid[voxIndex(x, y, z, dims)];
  };
  // the side along ax of c's one solid neighbor on that axis, else 0
  const side = (c, ax) => {
    const hi = solidBeside(c, AXI[ax], 1);
    return hi === solidBeside(c, AXI[ax], -1) ? 0 : hi ? 1 : -1;
  };

  // A 1:2 at notch q with its long leg along L (its solid on side sL) and its
  // short leg along S (sS) also fills p = q − sL·L. It covers the short-leg
  // face on q+sL·L and the long-leg faces on q+sS·S and p+sS·S. It needs p
  // empty in the lattice with a solid at p+sS·S and empty cells at p−sL·L and
  // p−sS·S, q and p alike at each ridge end, and, unless flat, the long-leg
  // faces the short-leg face's material. It returns p, the covered face keys
  // (short leg first) and whether each leg's faces run on past the step.
  const fit12 = (q, R, L, S, sL, sS) => {
    const p = step(q, L, -sL);
    if (!inBounds(p) || solidAt(p) || !solidAt(step(p, S, sS))) return null;
    if (solidAt(step(p, L, -sL)) || solidAt(step(p, S, -sS))) return null;
    for (const d of [-1, 1])
      if (solidAt(step(q, R, d)) !== solidAt(step(p, R, d))) return null;
    const keys = [
      faceKey(step(q, L, sL), L, -sL),
      faceKey(step(q, S, sS), S, -sS),
      faceKey(step(p, S, sS), S, -sS),
    ];
    const [c0, c1, c2] = keys.map((k) => faceColor.get(k));
    if (!flat && !(sameMat(c0, c1) && sameMat(c0, c2))) return null;
    return {
      p,
      keys,
      shortOn: solidAt(step(step(q, L, sL), S, -sS)),
      longOn: solidAt(step(step(p, L, -sL), S, sS)),
    };
  };
  // Whether q is a notch of that orientation holding a 1:2 whose leg faces
  // both stop at the step.
  const strict12 = (q, R, L, S, sL, sS) => {
    if (!inBounds(q) || solidAt(q) || side(q, L) !== sL || side(q, S) !== sS)
      return false;
    const f = fit12(q, R, L, S, sL, sS);
    return !!f && !f.shortOn && !f.longOn;
  };

  // Scan for wedges. A notch is an empty, unclaimed cell with one solid
  // neighbor along A and one along B, and empty cells opposite them. It takes
  // a 1:2 with its long leg along A, else along B, else a 1:1. A 1:2 fires on a
  // strict step, or when one leg's faces run on and the next step inward on
  // its plane is strict.
  /** @type {Map<number, Wedge>} */
  const wedgeCell = new Map();
  const removed = new Set(); // base faces (idx*6+f) covered by a wedge
  /** @type {Wedge[]} */
  const wedges = [];
  const claim = (c, w, keys) => {
    const cell = { x: c[0], y: c[1], z: c[2], ...w };
    wedgeCell.set(cellIdx(c), cell);
    wedges.push(cell);
    for (const k of keys) removed.add(k);
  };

  const at = [0, 0, 0]; // the scanned cell, reused
  for (const { R, A, B } of RIDGES) {
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const cidx = voxIndex(x, y, z, dims);
          if (solid[cidx] || wedgeCell.has(cidx)) continue;
          at[0] = x;
          at[1] = y;
          at[2] = z;
          const sA = side(at, A);
          if (!sA) continue;
          const sB = side(at, B);
          if (!sB) continue;
          const q = [x, y, z];
          const notch = { R, A, B, sA, sB };

          let placed = false;
          for (const { L, S, sL, sS } of [
            { L: A, S: B, sL: sA, sS: sB },
            { L: B, S: A, sL: sB, sS: sA },
          ]) {
            const f = fit12(q, R, L, S, sL, sS);
            if (!f || wedgeCell.has(cellIdx(f.p)) || (f.shortOn && f.longOn)) continue;
            if (f.shortOn && !strict12(step(step(q, L, -2 * sL), S, sS), R, L, S, sL, sS))
              continue;
            if (f.longOn && !strict12(step(step(q, L, 2 * sL), S, -sS), R, L, S, sL, sS))
              continue;
            // The slope takes the short-leg face's color.
            const cs = f.keys.map((k) => faceColor.get(k));
            const color = (cs[0] ?? cs[1] ?? cs[2]) >>> 0;
            claim(q, { ...notch, color, run: L, role: 'q' }, f.keys);
            claim(f.p, { ...notch, color, run: L, role: 'p' }, []);
            placed = true;
            break;
          }
          if (placed) continue;

          // A 1:1 covers the riser on q+sA·A and the tread on q+sB·B.
          const aKey = faceKey(step(q, A, sA), A, -sA);
          const bKey = faceKey(step(q, B, sB), B, -sB);
          const cA = faceColor.get(aKey);
          const cB = faceColor.get(bKey);
          if (!flat && !sameMat(cA, cB)) continue;
          // cA and cB agree unless flat, where FLAT_COLOR replaces the color.
          const color = (cA ?? cB) >>> 0;
          claim(q, { ...notch, color, run: null, role: 'q' }, [aKey, bKey]);
        }
  }

  // Emit integer lattice triangles, repair T-junctions, then build the scaled
  // buffers.
  /** @type {Tri[]} */
  const tris = []; // CCW about normal
  // paint: { chart, region } for a charted region, otherwise { swatch }
  const pushTri = (a, b, c, N, paint) => {
    // wind CCW about the outward normal N (backface culling is on)
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2];
    const vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    const gx = uy * vz - uz * vy,
      gy = uz * vx - ux * vz,
      gz = ux * vy - uy * vx;
    if (gx * N[0] + gy * N[1] + gz * N[2] < 0) {
      const t = b;
      b = c;
      c = t;
    }
    tris.push({
      a,
      b,
      c,
      normal: N,
      chart: paint.chart ?? null,
      region: paint.region ?? null,
      swatch: paint.swatch ?? null,
    });
  };
  // A traced region's triangles. `pt` maps the trace's (a, b) to a lattice
  // point; earcut takes the loops flat, the holes by their first vertex's index.
  const emitRegion = (region, pt, N, paint, where) => {
    const coords = [];
    const holeStarts = [];
    for (const hole of [region.outer, ...region.holes]) {
      if (hole !== region.outer) holeStarts.push(coords.length / 2);
      for (const [a, b] of hole) coords.push(a, b);
    }
    const faces = earcut(coords, holeStarts);
    const verts = [region.outer, ...region.holes].flat();
    let area = 0;
    for (let k = 0; k < faces.length; k += 3) {
      const [p, u, v] = [verts[faces[k]], verts[faces[k + 1]], verts[faces[k + 2]]];
      area += Math.abs((u[0] - p[0]) * (v[1] - p[1]) - (v[0] - p[0]) * (u[1] - p[1]));
      pushTri(pt(p[0], p[1]), pt(u[0], u[1]), pt(v[0], v[1]), N, paint);
    }
    if (area !== region.area2)
      throw new Error(
        `wedge-mesh: ${where} triangulated to ${area / 2} of its ${region.area2 / 2} cells`
      );
  };
  // build a point [x,y,z] from three axis/value pairs
  const mk = (a1, v1, a2, v2, a3, v3) => {
    const p = [0, 0, 0];
    p[AXI[a1]] = v1;
    p[AXI[a2]] = v2;
    p[AXI[a3]] = v3;
    return p;
  };
  const axisVec = (a1, v1, a2, v2) => {
    const p = [0, 0, 0];
    p[AXI[a1]] = v1;
    p[AXI[a2]] = v2;
    const L = Math.hypot(p[0], p[1], p[2]) || 1;
    return [p[0] / L, p[1] / L, p[2] / L];
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const unit = (v) => {
    const L = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / L, v[1] / L, v[2] / L];
  };
  const gcd3 = (a, b) => (b ? gcd3(b, a % b) : Math.abs(a));
  // The (unnormalized) normal of the triangle p0, p1, p2.
  const cross = (p0, p1, p2) => {
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    return [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
  };
  // A half-space { n, c }, inside where dot(n, v) <= c, through `on`.
  const halfSpace = (n, on) => ({ n, c: dot(n, on) });
  // A triangle's unit normal, turned away from `from`.
  const faceNormal = (p0, p1, p2, from) => {
    const n = cross(p0, p1, p2);
    const L =
      (Math.hypot(n[0], n[1], n[2]) || 1) *
      (dot(n, [p0[0] - from[0], p0[1] - from[1], p0[2] - from[2]]) < 0 ? -1 : 1);
    return [n[0] / L, n[1] / L, n[2] / L];
  };
  // A wedge's legs: the long axis L (A for a 1:1) with its solid on side sL,
  // the short axis S with sS, and the long leg's length n.
  /** @param {Wedge} w */
  const legs = (w) =>
    w.run === w.B
      ? { L: w.B, S: w.A, sL: w.sB, sS: w.sA, n: 2 }
      : { L: w.A, S: w.B, sL: w.sA, sS: w.sB, n: w.run ? 2 : 1 };
  // A wedge's slope ends, as (L, S) values: P, the far end of the long leg, and
  // Q, the far end of the short leg. The right angle is at the filled corner
  // (Lc, Sc) of q.
  /** @param {Wedge} w */
  const endsOf = (w) => {
    const { L, S, sL, sS, n } = legs(w);
    const q = [w.x, w.y, w.z];
    const Lc = q[AXI[L]] + (sL > 0 ? 1 : 0);
    const Sc = q[AXI[S]] + (sS > 0 ? 1 : 0);
    return { P: [Lc - n * sL, Sc], Q: [Lc, Sc - sS] };
  };

  // 1. Slopes, traced per plane and color. A slope plane holds the points where
  // sL·l + n·sS·s is constant. Its wedges share an orientation (R, L, sL, sS, n)
  // and that intercept, and form a grid: a along the ridge, b the step index.
  // Grid line b is step b's P line and b+1 its Q line, since a step adds
  // (n·sL, −sS) to (L, S), so vertex (a, b) is the lattice point P₀ + (b − t₀)
  // steps at a along R. A wedge is the unit cell (r, t), and a fold's triangle a
  // half.
  /** @type {Map<string, Plane>} */
  const planes = new Map();
  /** @param {Wedge} w */
  const slopePlane = (w) => {
    const { L, S, sL, sS, n } = legs(w);
    const q = [w.x, w.y, w.z];
    const key = [w.R, L, sL, sS, n, sL * q[AXI[L]] + n * sS * q[AXI[S]]].join('|');
    let plane = planes.get(key);
    if (!plane)
      planes.set(
        key,
        (plane = {
          R: w.R,
          L,
          S,
          sL,
          sS,
          n,
          P0: endsOf(w).P,
          t0: -sS * q[AXI[S]],
          cells: new Map(),
          halves: new Map(),
        })
      );
    return plane;
  };
  const byColor = (map, color) => {
    let list = map.get(color);
    if (!list) map.set(color, (list = []));
    return list;
  };
  /** @param {Wedge} w  the wedge's step index on its plane */
  const stepOf = (w) => -legs(w).sS * [w.x, w.y, w.z][AXI[legs(w).S]];

  // 2. Ends. A wedge's end along its ridge continues into a wedge of the same
  // kind and orientation, meets solid, or caps. The caps are indexed by the
  // cell they face, which is where the corner pass looks for them.
  /** @typedef {{w:Wedge, g:number, e0:number[]}} End */
  /** @type {Map<number, End[]>} */
  const capsAt = new Map();
  const endKey = (w, g) =>
    (cellIdx([w.x, w.y, w.z]) * 3 + AXI[w.R]) * 2 + (g > 0 ? 1 : 0);
  const filledEnds = new Set(); // ends a corner fill consumed
  const sameArm = (wn, w) =>
    wn &&
    wn.role === 'q' &&
    wn.run === w.run &&
    wn.R === w.R &&
    wn.sA === w.sA &&
    wn.sB === w.sB;
  for (const w of wedges) {
    if (w.role === 'p') continue;
    for (const g of [-1, 1]) {
      const e0 = step([w.x, w.y, w.z], w.R, g);
      if (solidAt(e0) || !inBounds(e0)) continue;
      if (sameArm(wedgeCell.get(cellIdx(e0)), w)) continue;
      const k = cellIdx(e0);
      if (!capsAt.has(k)) capsAt.set(k, []);
      capsAt.get(k).push({ w, g, e0 });
    }
  }

  // 3. Corners. Where arms cap into one cell their caps leave a gap whose rim
  // is on the lattice. Three rim points take one triangle, four take two split
  // on the diagonal raised across the gap. A triangle needs two rim edges of
  // one color and takes it, and a gap fills whole or not at all. Flat mode
  // skips the color test.
  let corners = 0;
  const AXES = ['x', 'y', 'z'];
  /** @type {Map<string, import('./regions.js').Half[]>} */
  const halves = new Map(); // base-plane pieces: caps, complements and cut cubes
  const addHalf = (face, s, half) => {
    const key = planeKey(face, s);
    if (!halves.has(key)) halves.set(key, []);
    halves.get(key).push(half);
  };
  // the side of w's solid along ax, 0 when ax is its ridge
  const sideOn = (w, ax) => (w.A === ax ? w.sA : w.B === ax ? w.sB : 0);
  // the length of w's leg along one of its in-plane axes
  const legOn = (w, ax) => (legs(w).L === ax ? legs(w).n : 1);
  // A lone end is a flush gable when none of its wedge's solids runs on past
  // the end: its cap lies in the wall the solid stops at and closes nothing.
  const flushGable = (w, g) => {
    const { L, S, sL, sS, n } = legs(w);
    const q = [w.x, w.y, w.z];
    const p = step(q, L, (1 - n) * sL);
    return ![step(q, L, sL), step(q, S, sS), step(p, S, sS)].some((c) =>
      solidAt(step(c, w.R, g))
    );
  };
  // An arm's slope: its outward unit normal, and the half-space of its
  // material, inside where dot(n, v) <= c.
  /** @param {Wedge} w */
  const slopeNormal = (w) => {
    const { L, S, sL, sS, n } = legs(w);
    return axisVec(L, -sL, S, -n * sS);
  };
  /** @param {Wedge} w */
  const slopeCut = (w) => {
    const { L, S, sL, sS, n } = legs(w);
    const q = [w.x, w.y, w.z];
    const P = mk(
      L,
      q[AXI[L]] + (sL > 0 ? 1 : 0) - n * sL,
      S,
      q[AXI[S]] + (sS > 0 ? 1 : 0),
      w.R,
      0
    );
    return halfSpace(mk(L, -sL, S, -n * sS, w.R, 0), P);
  };
  // The three lattice points of an end's cap: its profile at the end plane.
  /** @param {End} e */
  const capPoints = (e) => {
    const { L, S, sL, sS, n } = legs(e.w);
    const q = [e.w.x, e.w.y, e.w.z];
    const r = q[AXI[e.w.R]] + (e.g > 0 ? 1 : 0);
    const Lc = q[AXI[L]] + (sL > 0 ? 1 : 0);
    const Sc = q[AXI[S]] + (sS > 0 ? 1 : 0);
    const at = (l, s) => mk(L, l, S, s, e.w.R, r);
    return [at(Lc, Sc), at(Lc - n * sL, Sc), at(Lc, Sc - sS)];
  };
  // An arm's half of a fold, in its slope's grid: the right angle at F, one
  // step along b to W and `span` cells along the ridge.
  /** @param {End} end */
  const foldHalf = (end, C, span) => {
    const w = end.w;
    const color = w.color >>> 0;
    byColor(slopePlane(w).halves, color).push({
      a: end.e0[AXI[w.R]],
      b: stepOf(w),
      hiA: end.g < 0,
      hiB: legs(w).L === C,
      ...(span === 2 ? { run: 'a', color2: color } : {}),
      color,
    });
  };

  // Inside corners first: a filled one settles ends a hip would otherwise take.
  // An empty cell with one solid neighbor on each axis is a notch of all three
  // ridges, so when its three covered faces are one material all three prisms
  // are valid there. Their union has a vertex at the cell's center, off the
  // lattice; the cut cube contains it and stays on the lattice, the cell less
  // the tetrahedron at its open corner.
  /** @type {Map<number, number[]>} a cut cube's cell index to its three sides */
  const cutCubes = new Map();
  /** @type {End[]} a cut cube's open faces, as ends of a 1:1 of that ridge */
  const guestEnds = [];
  /** @type {{w:Wedge, c:number[], sides:number[], keys:number[]}[]} */
  const cuts = [];
  for (const w of wedges) {
    if (w.role === 'p' || w.run) continue;
    const c = [w.x, w.y, w.z];
    const sides = AXES.map((ax) => side(c, ax));
    if (sides.some((d) => !d)) continue;
    const keys = AXES.map((ax, i) => faceKey(step(c, ax, sides[i]), ax, -sides[i]));
    const [c0, c1, c2] = keys.map((k) => faceColor.get(k));
    if (!flat && !(sameMat(c0, c1) && sameMat(c0, c2) && sameMat(c1, c2))) continue;
    cutCubes.set(cellIdx(c), sides);
    cuts.push({ w, c, sides, keys });
  }
  for (const { w, c, sides, keys } of cuts) {
    for (const k of keys) removed.add(k);
    // K is the corner where the three solids meet; the fill joins the three
    // cell corners two unit steps from it.
    const K = c.map((v, i) => v + (sides[i] > 0 ? 1 : 0));
    const pts = AXES.map((_, i) => K.map((v, j) => (j === i ? v : v - sides[j])));
    const len = Math.sqrt(3);
    pushTri(
      pts[0],
      pts[1],
      pts[2],
      sides.map((d) => -d / len),
      {
        swatch: flat ? FLAT_COLOR : w.color >>> 0,
      }
    );
    corners++;
    filledEnds.add(endKey(w, sides[AXI[w.R]])); // the solid end takes no complement
    // Each open face is the end of a 1:1 of that axis's ridge with the other
    // two sides. It continues into a matching arm or another cut cube, else it
    // is an end like any other: a hip or a tetrahedron may take it, and what is
    // left caps. The face along the cell's own ridge is the wedge's own end.
    AXES.forEach((ax, i) => {
      const n = step(c, ax, -sides[i]);
      const ns = inBounds(n) ? cutCubes.get(cellIdx(n)) : null;
      const wn = inBounds(n) ? wedgeCell.get(cellIdx(n)) : null;
      const alike = (v) => AXES.every((a, j) => j === i || sideOn(v, a) === sides[j]);
      const arm = wn && wn.role === 'q' && !wn.run && wn.R === ax && alike(wn);
      const runsOn = (ns && AXES.every((_a, j) => j === i || ns[j] === sides[j])) || arm;
      if (ax === w.R) {
        if (runsOn) filledEnds.add(endKey(w, -sides[i]));
        return;
      }
      if (runsOn) {
        if (arm) filledEnds.add(endKey(wn, sides[i]));
        return;
      }
      const ridge = RIDGES.find((r) => r.R === ax);
      /** @type {End} */
      const end = {
        w: {
          ...ridge,
          x: c[0],
          y: c[1],
          z: c[2],
          sA: sides[AXI[ridge.A]],
          sB: sides[AXI[ridge.B]],
          color: w.color,
          run: null,
          role: 'q',
        },
        g: -sides[i],
        e0: n,
      };
      guestEnds.push(end);
      if (!inBounds(n)) return;
      const k = cellIdx(n);
      if (!capsAt.has(k)) capsAt.set(k, []);
      capsAt.get(k).push(end);
    });
  }

  // An end heading into the wall of an arm of another ridge: a valley. B's
  // prism runs on as a guest over A's cells, and the two slopes fold on the
  // diagonal from the wall tops to the far floor point. Today's mesh splits the
  // same rim the other way, into B's cap and A's complement.
  const dropped = new Set(); // A cells a valley replaced with one half
  /** @param {End} eB */
  const tryValley = (eB) => {
    const B = eB.w;
    const at = eB.e0;
    const A = wedgeCell.get(cellIdx(at));
    if (!A || A.role !== 'q' || A.R === B.R || cutCubes.has(cellIdx(at))) return false;
    const C = AXES.find((ax) => ax !== A.R && ax !== B.R);
    const sC = sideOn(A, C);
    if (!sC || sideOn(B, C) !== sC || legOn(A, C) !== legOn(B, C)) return false;
    if (sideOn(A, B.R) !== eB.g) return false; // B heads into A's wall
    const na = legOn(A, B.R);
    const nb = legOn(B, A.R);
    const dA = -sideOn(B, A.R); // along A's ridge, away from B's wall
    if (!dA) return false;
    // B's prism fits at each of the next a cells toward the wall, claims
    // ignored, with its wall faces B's color. The floor faces are A's.
    const { L, S, sL, sS, n } = legs(B);
    /** @type {number[]} */
    const keys = [];
    for (let i = 0; i < na; i++) {
      const q = step(at, B.R, i * eB.g);
      const p = step(q, L, (1 - n) * sL);
      const cells = n === 2 ? [q, p] : [q];
      if (cells.some((c) => !inBounds(c) || solidAt(c))) return false;
      if (!solidAt(step(q, L, sL))) return false;
      if (cells.some((c) => !solidAt(step(c, S, sS)))) return false;
      if (n === 2 && (solidAt(step(p, L, -sL)) || solidAt(step(p, S, -sS)))) return false;
      const mine = [
        faceKey(step(q, L, sL), L, -sL),
        ...cells.map((c) => faceKey(step(c, S, sS), S, -sS)),
      ];
      const wall = L === A.R ? mine.slice(0, 1) : mine.slice(1);
      if (!flat && !wall.every((k) => sameMat(faceColor.get(k), B.color))) return false;
      keys.push(...mine);
    }
    if (!solidAt(step(at, B.R, na * eB.g))) return false;
    // A is regular over the box: each of the b rows is one plane and one color.
    const rows = [];
    for (let j = 0; j < nb; j++) {
      const c = step(at, A.R, j * dA);
      const w = inBounds(c) ? wedgeCell.get(cellIdx(c)) : null;
      if (!w || w.role !== 'q' || w.R !== A.R || w.run !== A.run) return false;
      if (w.sA !== A.sA || w.sB !== A.sB || w.color !== A.color) return false;
      if (stepOf(w) !== stepOf(A) || dropped.has(cellIdx(c))) return false;
      rows.push(cellIdx(c));
    }

    for (const c of rows) dropped.add(c);
    for (const k of keys) removed.add(k);
    // Each arm's cells at that step become one half: its right angle at W on
    // the far side of the box, one step along b to F.
    const dB = -eB.g;
    const wallA = at[AXI[A.R]] + (dA > 0 ? 0 : 1);
    const wallB = at[AXI[B.R]] + (na - 1) * eB.g + (dB > 0 ? 0 : 1);
    /** @param {Wedge} w */
    const valleyHalf = (w, wall, d, span) => {
      const color = w.color >>> 0;
      byColor(slopePlane(w).halves, color).push({
        a: d > 0 ? wall + span - 1 : wall - span,
        b: stepOf(w),
        hiA: d > 0,
        hiB: legs(w).L !== C,
        ...(span === 2 ? { run: 'a', color2: color } : {}),
        color,
      });
    };
    valleyHalf(A, wallA, dA, nb);
    valleyHalf(B, wallB, dB, na);
    filledEnds.add(endKey(B, eB.g));
    corners++;
    return true;
  };

  for (const at of capsAt.values())
    for (const e of at) if (!filledEnds.has(endKey(e.w, e.g))) tryValley(e);

  // Two ends into one cell: a hip. Each arm's triangle lies in its slope's
  // plane, and the two fold on the diagonal from the wall's top to the box's
  // far floor corner.
  /** @param {End} eA @param {End} eB */
  const tryHip = (eA, eB) => {
    const A = eA.w;
    const B = eB.w;
    if (A.R === B.R) return false;
    const C = AXES.find((ax) => ax !== A.R && ax !== B.R);
    const sC = sideOn(A, C);
    if (!sC || sideOn(B, C) !== sC) return false;
    // Each arm's wall is behind the other's end.
    if (sideOn(A, B.R) !== -eB.g || sideOn(B, A.R) !== -eA.g) return false;
    const h = legOn(A, C);
    if (legOn(B, C) !== h) return false;
    const na = legOn(A, B.R); // A's run, along B's ridge
    const nb = legOn(B, A.R); // B's run, along A's ridge
    // the box cell i out along B's ridge, j along A's, k up from the shared solid
    const boxAt = (i, j, k) => {
      const c = eA.e0.slice();
      c[AXI[B.R]] += i * eB.g;
      c[AXI[A.R]] += j * eA.g;
      c[AXI[C]] -= k * sC;
      return c;
    };
    const under = (i, j) => step(boxAt(i, j, 0), C, sC);
    for (let i = 0; i < na; i++)
      for (let j = 0; j < nb; j++) {
        for (let k = 0; k < h; k++) {
          const c = boxAt(i, j, k);
          if (!inBounds(c) || solidAt(c) || wedgeCell.has(cellIdx(c))) return false;
        }
        if (!solidAt(under(i, j))) return false;
      }
    // A triangle holds its arm's end edge, which is that arm's color on both
    // sides, and the box's outer floor edge beside it. That edge carries the
    // color when every face past it does, or every floor face it hides does.
    const carries = (color, d, span, at, ax, gOut) => {
      if (flat) return true;
      const near = [];
      const far = [];
      for (let k = 0; k < span; k++) {
        const foot = step(at(d - 1, k), C, sC);
        near.push(faceColor.get(faceKey(foot, C, -sC)));
        const out = at(d, k);
        const below = step(out, C, sC);
        far.push(
          faceColor.get(
            solidAt(out)
              ? faceKey(out, ax, -gOut)
              : solidAt(below)
                ? faceKey(below, C, -sC)
                : faceKey(foot, ax, gOut)
          )
        );
      }
      return far.every((c) => sameMat(c, color)) || near.every((c) => sameMat(c, color));
    };
    if (!carries(A.color >>> 0, na, nb, (i, k) => boxAt(i, k, 0), B.R, eB.g))
      return false;
    if (!carries(B.color >>> 0, nb, na, (j, k) => boxAt(k, j, 0), A.R, eA.g))
      return false;

    for (let i = 0; i < na; i++)
      for (let j = 0; j < nb; j++) removed.add(faceKey(under(i, j), C, -sC));
    foldHalf(eA, C, nb);
    foldHalf(eB, C, na);
    filledEnds.add(endKey(A, eA.g));
    filledEnds.add(endKey(B, eB.g));
    corners++;
    return true;
  };

  // Three ends into one cell whose profiles share a vertex V: a corner
  // tetrahedron, V and one lattice point out along each axis. Its three faces
  // are the caps and it touches solids only along edges, so the fill is the one
  // triangle on the far leg ends.
  /** @param {End[]} ends */
  const tryTetra = (ends) => {
    if (new Set(ends.map((e) => e.w.R)).size !== 3) return false;
    /** @param {End} e  the arm's filled corner on the face of e0 it caps */
    const corner = (e) => {
      const { L, S, sL, sS } = legs(e.w);
      const q = [e.w.x, e.w.y, e.w.z];
      const r = q[AXI[e.w.R]] + (e.g > 0 ? 1 : 0);
      return mk(
        L,
        q[AXI[L]] + (sL > 0 ? 1 : 0),
        S,
        q[AXI[S]] + (sS > 0 ? 1 : 0),
        e.w.R,
        r
      );
    };
    const V = corner(ends[0]);
    for (const e of ends) if (corner(e).some((v, i) => v !== V[i])) return false;
    // The two arms with a leg along an axis must agree on its length.
    const leg = AXES.map((ax) => {
      const arms = ends.filter((e) => e.w.R !== ax);
      const n = legOn(arms[0].w, ax);
      return n === legOn(arms[1].w, ax) ? { n, d: -sideOn(arms[0].w, ax) } : null;
    });
    if (leg.some((l) => !l) || leg.filter((l) => l.n === 2).length > 1) return false;
    const lo = leg.map((l, i) => (l.d > 0 ? V[i] : V[i] - l.n));
    for (let i = 0; i < leg[0].n; i++)
      for (let j = 0; j < leg[1].n; j++)
        for (let k = 0; k < leg[2].n; k++) {
          const c = [lo[0] + i, lo[1] + j, lo[2] + k];
          if (!inBounds(c) || solidAt(c) || wedgeCell.has(cellIdx(c))) return false;
        }
    // Two of the three arms share a color, and the fill takes it.
    const cs = ends.map((e) => e.w.color >>> 0);
    const pair = [
      [0, 1],
      [0, 2],
      [1, 2],
    ].find(([i, j]) => sameMat(cs[i], cs[j]));
    if (!flat && !pair) return false;
    const far = leg.map((l, i) => {
      const p = V.slice();
      p[i] += l.d * l.n;
      return p;
    });
    pushTri(far[0], far[1], far[2], faceNormal(far[0], far[1], far[2], V), {
      swatch: flat ? FLAT_COLOR : cs[pair[0]],
    });
    for (const e of ends) filledEnds.add(endKey(e.w, e.g));
    corners++;
    return true;
  };

  // A pitch change along one ridge: a 1:2 arm and the 1:1 at the next cell cap
  // into each other. The two profiles share their corner and their short leg's
  // end and differ at the long one, so the rim is a quad of the 1:2's end edge
  // and the 1:1's far end edge. Its raised diagonal carries the 1:2's slope to
  // the far plane, and the other triangle is a facet on a plane of its own. The
  // fill absorbs the 1:1 and any cap its cells hold.
  /** @param {End} e1  the 1:2's end */
  const tryPitch = (e1) => {
    const W1 = e1.w;
    if (!W1.run) return false;
    const c3 = e1.e0;
    const W3 = wedgeCell.get(cellIdx(c3));
    if (!W3 || W3.role !== 'q' || W3.run || W3.R !== W1.R) return false;
    if (W3.sA !== W1.sA || W3.sB !== W1.sB || cutCubes.has(cellIdx(c3))) return false;
    if (!flat && !sameMat(W1.color, W3.color)) return false;
    const { L, S, sL, sS } = legs(W1);
    const p3 = step(c3, L, -sL);
    if (!inBounds(p3) || solidAt(p3) || wedgeCell.has(cellIdx(p3))) return false;
    if (dropped.has(cellIdx(c3)) || dropped.has(cellIdx(p3))) return false;
    if (filledEnds.has(endKey(W3, -e1.g))) return false;

    const Lc = c3[AXI[L]] + (sL > 0 ? 1 : 0);
    const Sc = c3[AXI[S]] + (sS > 0 ? 1 : 0);
    const rs = c3[AXI[W1.R]] + (e1.g > 0 ? 0 : 1); // the plane the two caps share
    const rf = c3[AXI[W1.R]] + (e1.g > 0 ? 1 : 0); // the 1:1's far plane
    const at = (l, s, r) => mk(L, l, S, s, W1.R, r);
    const p = [
      at(Lc - 2 * sL, Sc, rs), // the 1:2's long leg end
      at(Lc, Sc - sS, rs), // the shared short leg end
      at(Lc, Sc - sS, rf),
      at(Lc - sL, Sc, rf), // the 1:1's long leg end
    ];
    // The fill is those two cells under the 1:2's plane and the facet's. A cap
    // on one of their faces is absorbed when it lies wholly inside both, and
    // the fill stands down when one straddles them.
    const cuts = [halfSpace(mk(L, -sL, S, -2 * sS, W1.R, 0), p[0])];
    const fn = cross(p[0], p[2], p[3]);
    cuts.push(halfSpace(dot(fn, p[1]) <= dot(fn, p[0]) ? fn : fn.map((v) => -v), p[0]));
    const within = (v) => cuts.every((k) => dot(k.n, v) <= k.c);
    // Wholly in, wholly out, or straddling: the last stands the fill down.
    const reach = (verts) =>
      verts.every(within)
        ? 'in'
        : cuts.some((k) => verts.every((v) => dot(k.n, v) > k.c))
          ? 'out'
          : 'cut';
    const inside = [];
    for (const c of [c3, p3])
      for (const e of capsAt.get(cellIdx(c)) || []) {
        if (e === e1) continue;
        if (filledEnds.has(endKey(e.w, e.g))) return false;
        const got = reach(capPoints(e));
        if (got === 'cut') return false;
        if (got === 'in') inside.push(e);
      }
    // A solid face the fill touches must go whole.
    const covered = [];
    for (const c of [c3, p3])
      for (const ax of AXES)
        for (const d of [-1, 1]) {
          if (!solidAt(step(c, ax, d))) continue;
          const [u, v] = AXES.filter((a) => a !== ax);
          const corner = (i, j) =>
            mk(ax, c[AXI[ax]] + (d > 0 ? 1 : 0), u, c[AXI[u]] + i, v, c[AXI[v]] + j);
          const got = reach([corner(0, 0), corner(1, 0), corner(0, 1), corner(1, 1)]);
          if (got === 'cut') return false;
          if (got === 'in') covered.push(faceKey(step(c, ax, d), ax, -d));
        }
    const color = W1.color >>> 0;
    byColor(slopePlane(W1).halves, color).push({
      a: c3[AXI[W1.R]],
      b: stepOf(W1),
      hiA: e1.g < 0,
      hiB: true,
      color,
    });
    // The shared short leg end lies inside the fill, so it turns the facet out.
    pushTri(p[0], p[2], p[3], faceNormal(p[0], p[2], p[3], p[1]), {
      swatch: flat ? FLAT_COLOR : color,
    });
    dropped.add(cellIdx(c3));
    for (const k of covered) removed.add(k);
    for (const e of [e1, ...inside]) filledEnds.add(endKey(e.w, e.g));
    filledEnds.add(endKey(W3, -e1.g));
    corners++;
    return true;
  };

  for (const at of capsAt.values()) {
    const ends = at.filter((e) => !filledEnds.has(endKey(e.w, e.g)));
    if (ends.length === 2) tryHip(ends[0], ends[1]);
    else if (ends.length === 3) tryTetra(ends);
  }
  for (const at of capsAt.values())
    for (const e of at) if (!filledEnds.has(endKey(e.w, e.g))) tryPitch(e);

  // What the kinds above left, from the gap itself. The gap is the caps facing
  // one group of empty cells and those cells' exposed solid faces; its rim is
  // that set's boundary, chained with collinear runs merged. Three rim points
  // take one triangle, four take two split on the raised diagonal. Each rim
  // edge carries the color of the gap face it bounds, and a triangle needs two
  // of one color.
  /** @param {End} e  the cells that end's cap faces */
  const capCells = (e) => {
    const { L, sL, n } = legs(e.w);
    const q = [e.w.x, e.w.y, e.w.z];
    return [q, ...(n === 2 ? [step(q, L, -sL)] : [])].map((c) => step(c, e.w.R, e.g));
  };
  /** @type {Map<number, End[]>} every end whose cap faces a cell */
  const facing = new Map();
  for (const at of capsAt.values())
    for (const e of at)
      for (const c of capCells(e)) {
        if (!inBounds(c)) continue;
        if (!facing.has(cellIdx(c))) facing.set(cellIdx(c), []);
        facing.get(cellIdx(c)).push(e);
      }

  /** @param {End} seed */
  const tryRim = (seed) => {
    /** @type {End[]} */
    const caps = [];
    /** @type {Map<number, number[]>} */
    const cells = new Map();
    const queue = [seed];
    while (queue.length) {
      const e = queue.pop();
      if (caps.includes(e)) continue;
      if (filledEnds.has(endKey(e.w, e.g)) || caps.length === 4) return false;
      caps.push(e);
      for (const c of capCells(e)) {
        if (!inBounds(c) || solidAt(c) || wedgeCell.has(cellIdx(c))) return false;
        if (cells.has(cellIdx(c))) continue;
        if (cells.size === 4) return false;
        cells.set(cellIdx(c), c);
        queue.push(...(facing.get(cellIdx(c)) || []));
      }
    }
    if (caps.length < 2) return false;

    /** @type {{pts:number[][], normal:number[], color:number, key:number}[]} */
    const faces = caps.map((e) => ({
      pts: capPoints(e),
      normal: FACE_NORMAL[faceKeyOf(e.w.R, e.g)],
      color: e.w.color >>> 0,
      key: -1,
    }));
    for (const c of cells.values())
      for (const ax of AXES)
        for (const d of [-1, 1]) {
          const n = step(c, ax, d);
          if (!solidAt(n)) continue;
          const face = faceKeyOf(ax, -d);
          const key = cellIdx(n) * 6 + FACE_INDEX[face];
          if (removed.has(key)) return false;
          const [u, v] = AXES.filter((a) => a !== ax);
          const s = c[AXI[ax]] + (d > 0 ? 1 : 0);
          const at = (i, j) => mk(ax, s, u, c[AXI[u]] + i, v, c[AXI[v]] + j);
          faces.push({
            pts: [at(0, 0), at(1, 0), at(1, 1), at(0, 1)],
            normal: FACE_NORMAL[face],
            color: faceColor.get(key) >>> 0,
            key,
          });
        }

    // Directed unit edges, each face wound CCW about its normal. An edge whose
    // reverse is present is interior; the rest chain into the rim, which then
    // runs counterclockwise seen from outside.
    const vkey = (p) => p.join(',');
    /** @type {Map<string, {p:number[], q:number[], color:number}>} */
    const edges = new Map();
    for (const f of faces) {
      const ring = f.pts.slice();
      if (dot(cross(ring[0], ring[1], ring[2]), f.normal) < 0) ring.reverse();
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const d = sub(ring[(i + 1) % ring.length], a);
        const g = gcd3(gcd3(d[0], d[1]), d[2]);
        for (let t = 0; t < g; t++) {
          const p = a.map((val, k) => val + (d[k] / g) * t);
          const q = a.map((val, k) => val + (d[k] / g) * (t + 1));
          if (edges.has(vkey(p) + '>' + vkey(q))) return false;
          edges.set(vkey(p) + '>' + vkey(q), { p, q, color: f.color });
        }
      }
    }
    const boundary = [...edges.values()].filter(
      (e) => !edges.has(vkey(e.q) + '>' + vkey(e.p))
    );
    if (boundary.length < 3) return false;
    const from = new Map();
    for (const e of boundary) {
      if (from.has(vkey(e.p))) return false; // the boundary branches
      from.set(vkey(e.p), e);
    }
    /** @type {number[][]} */
    const ring = [];
    const stepColor = [];
    let cur = boundary[0];
    for (let i = 0; i < boundary.length; i++) {
      ring.push(cur.p);
      stepColor.push(cur.color);
      cur = from.get(vkey(cur.q));
      if (!cur) return false;
    }
    if (cur !== boundary[0]) return false; // more than one loop

    // Merge the collinear runs. A run two cells long has one color only when
    // every face it bounds matches.
    const dirAt = (i) => sub(ring[(i + 1) % ring.length], ring[i]).join(',');
    let start = 0;
    while (start < ring.length && dirAt(start) === dirAt((start || ring.length) - 1))
      start++;
    if (start === ring.length) return false;
    const rim = [];
    const rimColor = [];
    for (let k = 0; k < ring.length; ) {
      const i = (start + k) % ring.length;
      let color = stepColor[i];
      let len = 0;
      while (len < ring.length && dirAt((start + k + len) % ring.length) === dirAt(i)) {
        if (!sameMat(stepColor[(start + k + len) % ring.length], color)) color = null;
        len++;
      }
      rim.push(ring[i]);
      rimColor.push(color);
      k += len;
    }
    if (rim.length !== 3 && rim.length !== 4) return false;
    // The fill must stay inside every arm's slope, the shape the art means.
    for (const e of caps) {
      const cut = slopeCut(e.w);
      if (rim.some((v) => dot(cut.n, v) > cut.c)) return false;
    }

    // A four-point rim splits on the diagonal raised across the gap: p0–p2
    // when p3 lies behind the plane of (p0, p1, p2), else p1–p3.
    const k =
      rim.length === 3
        ? 0
        : dot(cross(rim[0], rim[1], rim[2]), sub(rim[3], rim[0])) < 0
          ? 0
          : 1;
    const wrap = (i) => rim[(k + i) % rim.length];
    const tris =
      rim.length === 3
        ? [[rim[0], rim[1], rim[2]]]
        : [
            [wrap(0), wrap(1), wrap(2)],
            [wrap(0), wrap(2), wrap(3)],
          ];
    const edgeSets =
      rim.length === 3
        ? [[0, 1, 2].map((i) => rimColor[i])]
        : [
            [rimColor[k], rimColor[(k + 1) % 4]],
            [rimColor[(k + 2) % 4], rimColor[(k + 3) % 4]],
          ];
    const paint = edgeSets.map((cs) => {
      if (flat) return FLAT_COLOR;
      const pair = [
        [0, 1],
        [0, 2],
        [1, 2],
      ].find(([i, j]) => j < cs.length && sameMat(cs[i], cs[j]));
      return pair ? cs[pair[0]] : null;
    });
    if (paint.some((c) => c == null)) return false;

    tris.forEach((t, i) => {
      // A fill on an arm's slope takes that plane's normal exactly, so it welds
      // into the slope instead of seaming against it.
      const arm = caps.find((e) => {
        const cut = slopeCut(e.w);
        return t.every((v) => dot(cut.n, v) === cut.c);
      });
      pushTri(
        t[0],
        t[1],
        t[2],
        arm ? slopeNormal(arm.w) : unit(cross(t[0], t[1], t[2])),
        {
          swatch: paint[i],
        }
      );
    });
    for (const e of caps) filledEnds.add(endKey(e.w, e.g));
    for (const f of faces) if (f.key >= 0) removed.add(f.key);
    corners++;
    return true;
  };

  for (const at of capsAt.values())
    for (const e of at)
      if (!filledEnds.has(endKey(e.w, e.g)) && !flushGable(e.w, e.g)) tryRim(e);

  let gaps = 0; // ends still capping into a corner gap

  // A guest end no fill took caps like a wedge's, with its cut cube's color.
  for (const e of guestEnds) {
    if (filledEnds.has(endKey(e.w, e.g))) continue;
    if (!flushGable(e.w, e.g)) gaps++;
    const g = FACE_GEO[faceKeyOf(e.w.R, e.g)];
    addHalf(faceKeyOf(e.w.R, e.g), [e.w.x, e.w.y, e.w.z][AXI[e.w.R]], {
      a: [e.w.x, e.w.y, e.w.z][AXI[g.A]],
      b: [e.w.x, e.w.y, e.w.z][AXI[g.B]],
      hiA: sideOn(e.w, g.A) > 0,
      hiB: sideOn(e.w, g.B) > 0,
      color: flat ? FLAT_COLOR : e.w.color >>> 0,
    });
  }

  // 4. Gable caps, as half pieces of the planes they lie on. A wedge's end gets
  // a cap unless it meets a wedge of the same kind and orientation. The cap is
  // the right triangle in the wedge's ±R face with its right angle at q's
  // filled corner and a 1:2's long leg over p, in that face's tangent frame.
  // An end against solid (a 1:2's two cells agree) gets the cap's complement
  // on the solid's faces instead, which leave the base faces.
  for (const w of wedges) {
    if (w.role === 'p') continue;
    const { L, sL, sS, n } = legs(w);
    const q = [w.x, w.y, w.z];
    const far = step(q, L, (1 - n) * sL); // p, or q for a 1:1
    for (const sg of [-1, 1]) {
      if (filledEnds.has(endKey(w, sg))) continue;
      const g = FACE_GEO[faceKeyOf(w.R, sg)];
      // a half on the cell at c, its right angle high on L and S as given
      const half = (c, hiL, hiS, color, color2) => ({
        a: c[AXI[g.A]],
        b: c[AXI[g.B]],
        hiA: g.A === L ? hiL : hiS,
        hiB: g.B === L ? hiL : hiS,
        ...(n === 2 ? { run: g.A === L ? 'a' : 'b', color2 } : {}),
        color,
      });
      const e = step(q, w.R, sg);
      if (solidAt(e)) {
        const kq = faceKey(e, w.R, -sg);
        const kf = faceKey(step(far, w.R, sg), w.R, -sg);
        // In a valley each arm's near end lies on faces the other arm covers.
        if (removed.has(kq) && removed.has(kf)) continue;
        removed.add(kq);
        removed.add(kf);
        const paint = (k) => (flat ? FLAT_COLOR : faceColor.get(k) >>> 0);
        addHalf(
          faceKeyOf(w.R, -sg),
          e[AXI[w.R]],
          half(far, sL < 0, sS < 0, paint(kf), paint(kq))
        );
        continue;
      }
      if (inBounds(e) && sameArm(wedgeCell.get(cellIdx(e)), w)) continue;
      if (!flushGable(w, sg)) gaps++;
      const color = flat ? FLAT_COLOR : w.color >>> 0;
      addHalf(faceKeyOf(w.R, sg), q[AXI[w.R]], half(q, sL > 0, sS > 0, color, color));
    }
  }

  // 5. Trace each slope plane, one region set per color, and emit it. A tapered
  // slope is one polygon, so a pyramid's side costs a triangle or a trapezoid.
  for (const w of wedges) {
    const idx = cellIdx([w.x, w.y, w.z]);
    if (w.role === 'p' || cutCubes.has(idx) || dropped.has(idx)) continue;
    const color = w.color >>> 0;
    byColor(slopePlane(w).cells, color).push({
      a: [w.x, w.y, w.z][AXI[w.R]],
      b: stepOf(w),
      color,
    });
  }
  let slopes = 0;
  for (const plane of planes.values()) {
    const { R, L, S, sL, sS, n, P0, t0 } = plane;
    const N = axisVec(L, -sL, S, -n * sS);
    const pt = (a, b) => mk(L, P0[0] + (b - t0) * n * sL, S, P0[1] - (b - t0) * sS, R, a);
    for (const color of new Set([...plane.cells.keys(), ...plane.halves.keys()])) {
      const traced = traceRegions(
        plane.cells.get(color) || [],
        plane.halves.get(color) || []
      );
      for (const region of traced) {
        emitRegion(
          region,
          pt,
          N,
          { swatch: flat ? FLAT_COLOR : color },
          `a ${R}-ridge slope`
        );
        slopes++;
      }
    }
  }

  // 6. Regions: each plane's uncovered exposed faces plus its caps. Bake the
  // skin once, then triangulate each region with earcut. Flat mode has no
  // skin: every triangle is FLAT_COLOR and the UVs are zero.
  const baseMask = surfaceMask.slice();
  for (const rk of removed) baseMask[(rk / 6) | 0] &= ~(1 << rk % 6);
  const regions = faceRegions(dims, baseMask, faceColor, halves);
  const skin = flat ? null : bakeSkin(regions, result.palette ?? [], faceColor);
  regions.forEach((region, i) => {
    const chart = skin ? skin.charts[i] : null;
    const paint = chart
      ? { chart, region }
      : { swatch: flat ? FLAT_COLOR : /** @type {number} */ (region.uniform) >>> 0 };
    emitRegion(
      region,
      (a, b) => pointOf(region.face, a, b, region.s),
      region.normal,
      paint,
      `the ${region.face} region at slice ${region.s}`
    );
  });

  // 7. Repair T-junctions, then flatten to scaled buffers. UVs are read after
  // the repair: a charted vertex maps into its chart by lattice position, and
  // a swatch triangle's vertices sit at the swatch texel's center.
  const repaired = eliminateTJunctions(tris);
  const pos = new Float32Array(repaired.length * 9);
  const nrm = new Float32Array(repaired.length * 9);
  const uv = new Float32Array(repaired.length * 6); // zero in flat mode
  let o = 0;
  let q = 0;
  for (const t of repaired) {
    const sw = skin && !t.region ? swatchUV(skin, t.swatch) : null;
    for (const v of [t.a, t.b, t.c]) {
      pos[o] = v[0] * s;
      pos[o + 1] = v[1] * s;
      pos[o + 2] = v[2] * s;
      nrm[o] = t.normal[0];
      nrm[o + 1] = t.normal[1];
      nrm[o + 2] = t.normal[2];
      if (skin) {
        const [tu, tv] = sw || uvOfLattice(t.chart, t.region, v);
        uv[q] = tu / skin.width;
        uv[q + 1] = tv / skin.height;
      }
      o += 3;
      q += 2;
    }
  }

  // 8. Weld by position, normal and uv, so vertices of differently facing
  // triangles or of different charts stay split. Flat shading ignores the
  // normals, but this weld and diag.js depend on them. Then center X and Z and
  // take the bounds.
  const welded = weldVertices(pos, nrm, uv);
  const { position } = welded;
  const dx = (-nx * s) / 2;
  const dz = (-nz * s) / 2;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.length; i += 3) {
    position[i] += dx;
    position[i + 2] += dz;
    for (let k = 0; k < 3; k++) {
      const v = position[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }

  return {
    geometry: { ...welded, bounds: { min, max } },
    skin,
    color: skin ? null : FLAT_COLOR,
    triangles: welded.index.length / 3,
    wedges: wedges.length, // cells
    slopes,
    corners,
    gaps,
    charts: skin ? skin.charts.reduce((n, c) => n + (c ? 1 : 0), 0) : 0,
  };
}
