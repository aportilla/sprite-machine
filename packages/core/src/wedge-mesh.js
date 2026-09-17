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
// Geometry is emitted per plane:
// - Slopes: the wedges of one slope plane form a grid, greedy-merged by color
//   into one quad per block.
// - Base faces: coplanar regions (regions.js) of exposed faces and cap halves,
//   triangulated with earcut.
// Color comes from the skin (skin.js), so regions merge on occupancy alone.
// UVs are read from lattice positions after the T-junction repair.
//
// Not handled: convex staircases still step, and 3D corners where two ridges
// meet become a step.

import earcut from 'earcut';
import { voxIndex } from './carve.js';
import { FACE_GEO, pointOf } from './faces.js';
import { faceRegions, planeKey } from './regions.js';
import { unpackRGBA } from './ingest.js';
import { bakeSkin, uvOfLattice, swatchUV } from './skin.js';
import { eliminateTJunctions } from './t-junction.js';
import { weldVertices } from './weld.js';
import { AXIS_INDEX, FACE_INDEX, faceKeyOf } from './views.js';
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
 *            slopes:number, charts:number}} Built
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
  const pushQuad = (a, b, c, d, N, paint) => {
    pushTri(a, b, c, N, paint);
    pushTri(a, c, d, N, paint);
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

  // 1. Slopes, one quad per block. A slope plane holds the points where
  // sL·l + n·sS·s is constant. Its wedges share an orientation (R, L, sL, sS,
  // n) and that intercept, and form a grid with t = −sS·s, which counts the
  // steps, and r along the ridge, greedy-merged by color along r first. A
  // block's quad runs from its first wedge's P to its last wedge's Q, across
  // its r range, and samples its color's swatch.
  const planes = new Map(); // plane key -> Map<'t,r', {t, r, w}>
  for (const w of wedges) {
    if (w.role === 'p') continue;
    const { L, S, sL, sS, n } = legs(w);
    const q = [w.x, w.y, w.z];
    const key = [w.R, L, sL, sS, n, sL * q[AXI[L]] + n * sS * q[AXI[S]]].join('|');
    let grid = planes.get(key);
    if (!grid) planes.set(key, (grid = new Map()));
    const t = -sS * q[AXI[S]];
    const r = q[AXI[w.R]];
    grid.set(t + ',' + r, { t, r, w });
  }
  let slopes = 0;
  for (const grid of planes.values()) {
    const used = new Set();
    const cells = [...grid.values()].sort((p, q) => p.t - q.t || p.r - q.r);
    for (const c0 of cells) {
      const k0 = c0.t + ',' + c0.r;
      if (used.has(k0)) continue;
      const w0 = c0.w;
      const free = (t, r) => {
        const k = t + ',' + r;
        const c = grid.get(k);
        return !!c && !used.has(k) && c.w.color === w0.color;
      };
      let rl = 1;
      while (free(c0.t, c0.r + rl)) rl++;
      let tl = 1;
      grow: for (; ; tl++) {
        for (let j = 0; j < rl; j++) if (!free(c0.t + tl, c0.r + j)) break grow;
      }
      for (let i = 0; i < tl; i++)
        for (let j = 0; j < rl; j++) used.add(c0.t + i + ',' + (c0.r + j));
      const { L, S, sL, sS, n } = legs(w0);
      const { P } = endsOf(w0);
      const { Q } = endsOf(grid.get(c0.t + tl - 1 + ',' + c0.r).w);
      const rLo = c0.r;
      const rHi = c0.r + rl;
      const pt = (ls, rv) => mk(L, ls[0], S, ls[1], w0.R, rv);
      pushQuad(
        pt(P, rLo),
        pt(P, rHi),
        pt(Q, rHi),
        pt(Q, rLo),
        axisVec(L, -sL, S, -n * sS),
        { swatch: flat ? FLAT_COLOR : w0.color >>> 0 }
      );
      slopes++;
    }
  }

  // 2. Gable caps, as half pieces of the planes they lie on. A wedge's end gets
  // a cap unless it meets a wedge of the same kind and orientation. The cap is
  // the right triangle in the wedge's ±R face with its right angle at q's
  // filled corner and a 1:2's long leg over p, in that face's tangent frame.
  // An end against solid (a 1:2's two cells agree) gets the cap's complement
  // on the solid's faces instead, which leave the base faces.
  /** @type {Map<string, import('./regions.js').Half[]>} */
  const halves = new Map();
  const addHalf = (face, s, half) => {
    const key = planeKey(face, s);
    if (!halves.has(key)) halves.set(key, []);
    halves.get(key).push(half);
  };
  for (const w of wedges) {
    if (w.role === 'p') continue;
    const { L, sL, sS, n } = legs(w);
    const q = [w.x, w.y, w.z];
    const far = step(q, L, (1 - n) * sL); // p, or q for a 1:1
    for (const sg of [-1, 1]) {
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
      const wn = inBounds(e) ? wedgeCell.get(cellIdx(e)) : null;
      if (
        wn &&
        wn.role === 'q' &&
        wn.run === w.run &&
        wn.R === w.R &&
        wn.sA === w.sA &&
        wn.sB === w.sB
      )
        continue;
      const color = flat ? FLAT_COLOR : w.color >>> 0;
      addHalf(faceKeyOf(w.R, sg), q[AXI[w.R]], half(q, sL > 0, sS > 0, color, color));
    }
  }

  // 3. Regions: each plane's uncovered exposed faces plus its caps. Bake the
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
    // earcut takes the loops flat, the holes by their first vertex's index.
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
      const [p, q, r] = [verts[faces[k]], verts[faces[k + 1]], verts[faces[k + 2]]];
      area += Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]));
      pushTri(
        pointOf(region.face, p[0], p[1], region.s),
        pointOf(region.face, q[0], q[1], region.s),
        pointOf(region.face, r[0], r[1], region.s),
        region.normal,
        paint
      );
    }
    if (area !== region.area2)
      throw new Error(
        `wedge-mesh: the ${region.face} region at slice ${region.s} triangulated to ${area / 2} of its ${region.area2 / 2} cells`
      );
  });

  // 4. Repair T-junctions, then flatten to scaled buffers. UVs are read after
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

  // 5. Weld by position, normal and uv, so vertices of differently facing
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
    charts: skin ? skin.charts.reduce((n, c) => n + (c ? 1 : 0), 0) : 0,
  };
}
