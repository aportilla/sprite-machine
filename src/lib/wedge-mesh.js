// ---------------------------------------------------------------------------
// Additive-wedge low-poly engine.
//
// Builds directly on the working voxel model (result.solid / surfaceMask /
// faceColor) instead of remeshing a silhouette. The ONLY new geometry is a 45°
// WEDGE that fills a concave unit-step notch:
//
//   An EMPTY cell whose two solid orthogonal neighbours sit on ADJACENT sides
//   (and whose other two in-plane sides are empty) is the inner corner of a
//   staircase. We fill that corner with a triangular prism; its hypotenuse is
//   the 45° slope, the two faces it covers become internal (culled), and the
//   run is closed at its ends with triangular caps (the "gable" triangles).
//
// Why this is correct-by-construction where the earlier attempts failed:
//  - It's ADDITIVE: wedges only fill notches, so it can never punch a hole or
//    eat the object (unlike the melted planar-remesh / slab-loft dead ends).
//  - A wedge is ONE MATERIAL by its gate: it fires only where the two covered
//    faces already agree on colour, so a window/body seam stays a sharp 45°
//    edge with no depth guessing (the whole point of the reverted per-color-
//    parts task), and its whole surface points at that colour's swatch.
//  - A lone cube has no concave notch, so it gets NO wedges and stays sharp —
//    the additive rule self-guards convex structural corners.
//
// COLOR IS THE SKIN, NOT THE GEOMETRY (Sep 7 2026). The base faces merge on
// occupancy alone and are painted by a texture (skin.js): a region that
// crosses a colour boundary carries a chart — a texel per cell — and a
// one-colour region, like every wedge, points at its colour's swatch; every
// triangle's UVs are an affine read of its vertices' lattice positions, taken
// AFTER the T-junction repair, so no UV is ever plumbed through a split.
// Until then every triangle carried a vertex colour and the merge could only
// join faces of one colour — a painted wall shattered into a rect per
// region, each boundary feeding the repair. The Car: 1784 → 900 triangles,
// the same 236 wedges. Opening the wedge gate to match was measured and
// rejected (1092: more wedges are more caps and more split faces), so the
// strict same-material gate stays exactly as it was.
//
// THE PLANAR MERGE (Sep 7 2026, the same day, in two steps). The scan fires
// per notch cell, but the geometry is emitted per PLANE:
//  - A SLOPE is one quad per BLOCK: the wedge cells of one 45° plane (one
//    orientation, one intercept) form a grid — t along the staircase, r along
//    the ridge — that is greedy-merged on one colour. Emitted per cell, a
//    windshield was a grid of unit quads, and every unit edge along a roof's
//    rim pinned a vertex on it that the repair then had to fan the roof
//    around (the Car's 17×10 roof: 20 triangles). Merging the runs along the
//    ridge alone took the Car 900 → 408; across the staircase too it would
//    have gained nothing (392) as long as the gable caps stayed a sawtooth
//    of triangles whose corners split the slope's long diagonal edge back.
//  - So the base faces are coplanar REGIONS (regions.js), not greedy rects:
//    a plane's exposed faces AND the cap half-faces the blocks end on, traced
//    as one polygon with every collinear run merged — the wall beside a
//    windshield has one straight diagonal edge, and the slope beside it is
//    two triangles. Each region is triangulated by earcut (THREE's
//    ShapeUtils, holes included) and painted as one: a chart over its box
//    where it crosses a colour, a swatch where it does not.
//  The T-junction repair stays, now reading 45° edges too: a region's edge
//  and a slope's ridge still meet to different extents where a corner of
//  another plane lands on them, and every vertex is on the lattice.
//
// Scope: additive wedges only. Convex staircases (a hood sloping
// down-and-out) still step, and true 3-D corners where two ridges meet degrade
// to a step rather than a corner tile. One wedge per cell (first ridge wins).
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { voxIndex } from './carve.js';
import { FACE_GEO, pointOf } from './faces.js';
import { faceRegions, planeKey } from './regions.js';
import { unpackRGBA } from './ingest.js';
import { bakeSkin, uvOfLattice, swatchUV } from './skin.js';
import { eliminateTJunctions } from './t-junction.js';
import { finishVoxelMesh, skinTexture } from './mesh-util.js';
import { AXIS_INDEX, FACE_INDEX, faceKeyOf } from './views.js';
import { DEFAULT_WORLD_SIZE } from './constants.js';

const AXI = AXIS_INDEX; // world-axis name -> [x,y,z] index
const FLAT_COLOR = 0xffcfcfd6;

// The three ridge axes (the axis a wedge prism extends along) and their two
// in-plane tangent axes (A, B). Order matters: z first so long z-ridges (the
// common extruded roof/windshield) win the one-wedge-per-cell tie.
const RIDGES = [
  { R: 'z', A: 'x', B: 'y' },
  { R: 'x', A: 'z', B: 'y' },
  { R: 'y', A: 'x', B: 'z' },
];

/**
 * A lattice triangle and its paint: a charted region's triangle carries its
 * chart and region (its UVs are read off its vertices); everything else — a
 * one-colour region's, a slope's — carries the packed colour whose swatch it
 * samples. The T-junction repair copies the paint onto every piece.
 * @typedef {{a:number[], b:number[], c:number[], normal:number[],
 *            chart:import('./skin.js').Chart|null,
 *            region:import('./regions.js').Region|null,
 *            swatch:number|null}} Tri
 */

export function wedgeMesh(result, opts = {}) {
  const { dims, solid, surfaceMask, faceColor } = result;
  const { nx, ny, nz } = dims;
  const flat = !!opts.flat;
  const worldSize = opts.worldSize ?? DEFAULT_WORLD_SIZE;
  const s = worldSize / Math.max(nx, ny, nz);

  // The wedge fires only where its two covered faces are the same material.
  // Those faceColor values are already palette-snapped by colorize, but privacy
  // browsers "farble" getImageData (~±1/channel), which splits the palette into
  // near-duplicate entries, so two same-material faces can land on *adjacent*
  // entries. sameMat therefore compares with a small squared-L2 tolerance;
  // distinct authored materials sit ~180 apart, far above the ~12 slack, so a
  // colour boundary the artist drew still gates crisply.
  const TOL2 = 12 * 12; // ~12 per-channel slack (squared L2): covers farble + AA
  const sameMat = (a, b) => {
    if (a == null || b == null) return false;
    // Compare RGB only; the alpha byte is always 255 here, so masking it keeps
    // the exact fast path and the tolerant path judging identity on the same bits.
    if (((a >>> 0) & 0xffffff) === ((b >>> 0) & 0xffffff)) return true;
    const A = unpackRGBA(a);
    const B = unpackRGBA(b);
    return (A.r - B.r) ** 2 + (A.g - B.g) ** 2 + (A.b - B.b) ** 2 <= TOL2;
  };

  const inBounds = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz;
  const solidAt = (x, y, z) => inBounds(x, y, z) && solid[voxIndex(x, y, z, dims)];
  const step = (x, y, z, ax, sg) => [
    x + sg * +(ax === 'x'),
    y + sg * +(ax === 'y'),
    z + sg * +(ax === 'z'),
  ];

  // --- scan for wedges ------------------------------------------------------
  const wedgeCell = new Map(); // cellIdx -> chosen {R,A,B,sA,sB,color}
  const removed = new Set(); // base faces (idx*6+f) culled because a wedge covers them
  const wedges = [];

  for (const ridge of RIDGES) {
    const { R, A, B } = ridge;
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const cidx = voxIndex(x, y, z, dims);
          if (solid[cidx] || wedgeCell.has(cidx)) continue; // C must be empty & unclaimed
          for (const sA of [-1, 1]) {
            let placed = false;
            for (const sB of [-1, 1]) {
              const aN = step(x, y, z, A, sA); // solid neighbour on A side
              const bN = step(x, y, z, B, sB); // solid neighbour on B side
              if (!solidAt(...aN) || !solidAt(...bN)) continue;
              // opposite sides must be empty -> exactly two adjacent solids
              if (solidAt(...step(x, y, z, A, -sA))) continue;
              if (solidAt(...step(x, y, z, B, -sB))) continue;

              // faces the wedge covers = each neighbour's face pointing back at C
              const faceA = faceKeyOf(A, -sA);
              const faceB = faceKeyOf(B, -sB);
              const aKey = voxIndex(...aN, dims) * 6 + FACE_INDEX[faceA];
              const bKey = voxIndex(...bN, dims) * 6 + FACE_INDEX[faceB];
              const cA = faceColor.get(aKey);
              const cB = faceColor.get(bKey);

              // Gate: fire the wedge iff its two COVERED faces — the only two
              // surfaces the prism merges (the riser cA and the tread cB) — are
              // the same material. Nothing else is consulted: no profile/facing
              // view sampling, no occlusion march. This is deliberate and gives
              // the sprite author exact, local control over every wedge: paint the
              // two faces a corner joins the same colour and it ramps; paint them
              // differently and it stays a crisp step. A slope smooths only where
              // its riser and its up-facing tread read the same colour, so the
              // top-view art over a slope must match the face it caps — the author
              // decides which corners round, not a heuristic guess about "slopes".
              // (And, since the skin: a looser gate would COST triangles — more
              // wedges are more caps and more split base faces, measured on the
              // Car — so the strictness is the count's too.)
              if (!flat && !sameMat(cA, cB)) continue;
              // The non-flat gate guarantees cA and cB agree, so either is the
              // surface's true colour. (In flat mode the wedge colour is overridden
              // to FLAT_COLOR downstream, so a null here can never render.)
              const color = (cA != null ? cA : cB) >>> 0;
              wedgeCell.set(cidx, { R, A, B, sA, sB, color });
              removed.add(aKey);
              removed.add(bKey);
              wedges.push({ x, y, z, R, A, B, sA, sB, color });
              placed = true;
              break;
            }
            if (placed) break;
          }
        }
  }

  // --- geometry emit --------------------------------------------------------
  // Collect INTEGER-lattice triangles first (regions + slopes), eliminate the
  // T-junctions the merges leave, THEN build the scaled buffers.
  /** @type {Tri[]} */
  const tris = []; // CCW wrt normal
  // paint: { chart, region } for a charted region, { swatch } for a
  // one-material primitive (a one-colour region, a slope)
  const pushTri = (a, b, c, N, paint) => {
    // wind to match the explicit outward normal N (backface culling is on)
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
  const axisVec = (a1, s1, a2, s2) => {
    const p = [0, 0, 0];
    p[AXI[a1]] = s1;
    if (a2) p[AXI[a2]] = s2;
    const L = Math.hypot(p[0], p[1], p[2]) || 1;
    return [p[0] / L, p[1] / L, p[2] / L];
  };
  // a notch cell's corners along its wedge's A and B: the filled corner (the
  // one toward the two solids) and the opposite one
  const cornersOf = (w) => {
    const p = { x: w.x, y: w.y, z: w.z };
    const aC = p[w.A];
    const bC = p[w.B];
    return {
      Ac: w.sA < 0 ? aC : aC + 1,
      Ao: w.sA < 0 ? aC + 1 : aC,
      Bc: w.sB < 0 ? bC : bC + 1,
      Bo: w.sB < 0 ? bC + 1 : bC,
    };
  };

  // 1. the slopes, one quad per BLOCK. The cells of one 45° plane — one
  // orientation (R, A, B, sA, sB) and one intercept sA·a + sB·b — sit on a
  // grid: t = sA·a runs up the staircase (the cell at (a + sA, b − sB) is
  // t + 1, its hypotenuse the continuation of this one's), r along the ridge.
  // Greedy-merge that grid on one colour, the ridge first (the long runs), and
  // a block's slope is one quad from its first staircase cell's far corners to
  // its last's, swept over its r-range. One material each by the gate, so
  // every slope samples its colour's swatch.
  const planes = new Map(); // plane key -> Map<'t,r', {t, r, w}>
  for (const w of wedges) {
    const p = { x: w.x, y: w.y, z: w.z };
    const aC = p[w.A];
    const bC = p[w.B];
    const key = [w.R, w.A, w.B, w.sA, w.sB, w.sA * aC + w.sB * bC].join('|');
    let grid = planes.get(key);
    if (!grid) planes.set(key, (grid = new Map()));
    const t = w.sA * aC;
    const r = p[w.R];
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
      const first = cornersOf(w0);
      const last = cornersOf(grid.get(c0.t + tl - 1 + ',' + c0.r).w);
      const rLo = c0.r;
      const rHi = c0.r + rl;
      const pt = (av, bv, rv) => mk(w0.A, av, w0.B, bv, w0.R, rv);
      pushQuad(
        pt(first.Ao, first.Bc, rLo),
        pt(first.Ao, first.Bc, rHi),
        pt(last.Ac, last.Bo, rHi),
        pt(last.Ac, last.Bo, rLo),
        axisVec(w0.A, -w0.sA, w0.B, -w0.sB),
        { swatch: flat ? FLAT_COLOR : w0.color >>> 0 }
      );
      slopes++;
    }
  }

  // 2. the gable caps, as HALF pieces of the planes they lie on: a cell's end
  // is capped unless the prism runs on into a wedge of the same orientation
  // there or ends against solid. The cap is the right triangle in the cell's
  // ±R face whose right angle sits at the filled corner (Ac, Bc), filed under
  // that face's plane in the face's own tangent frame.
  /** @type {Map<string, import('./regions.js').Half[]>} */
  const halves = new Map();
  for (const w of wedges) {
    const p = { x: w.x, y: w.y, z: w.z };
    for (const sg of [-1, 1]) {
      const [ex, ey, ez] = step(w.x, w.y, w.z, w.R, sg);
      if (solidAt(ex, ey, ez)) continue; // internal against solid
      if (inBounds(ex, ey, ez)) {
        const wn = wedgeCell.get(voxIndex(ex, ey, ez, dims));
        if (wn && wn.R === w.R && wn.sA === w.sA && wn.sB === w.sB) continue; // the prism runs on
      }
      const face = faceKeyOf(w.R, sg);
      const g = FACE_GEO[face];
      const key = planeKey(face, p[w.R]);
      if (!halves.has(key)) halves.set(key, []);
      halves.get(key).push({
        a: p[g.A],
        b: p[g.B],
        hiA: g.A === w.A ? w.sA > 0 : w.sB > 0,
        hiB: g.B === w.A ? w.sA > 0 : w.sB > 0,
        color: flat ? FLAT_COLOR : w.color >>> 0,
      });
    }
  }

  // 3. the regions: every plane's exposed faces (minus the ones the wedges
  // cover) with its caps, traced (regions.js), the skin baked over them once,
  // then each triangulated by earcut and emitted with its paint. Flat mode
  // has no skin: every primitive is the flat grey, the UVs zero.
  const baseMask = surfaceMask.slice();
  for (const rk of removed) baseMask[(rk / 6) | 0] &= ~(1 << rk % 6);
  const regions = faceRegions(dims, baseMask, faceColor, halves);
  const skin = flat ? null : bakeSkin(regions, result.palette ?? [], faceColor);
  regions.forEach((region, i) => {
    const chart = skin ? skin.charts[i] : null;
    const paint = chart
      ? { chart, region }
      : { swatch: flat ? FLAT_COLOR : /** @type {number} */ (region.uniform) >>> 0 };
    const toV2 = (loop) => loop.map(([a, b]) => new THREE.Vector2(a, b));
    const faces = THREE.ShapeUtils.triangulateShape(
      toV2(region.outer),
      region.holes.map(toV2)
    );
    const verts = [region.outer, ...region.holes].flat();
    let area = 0;
    for (const [i0, i1, i2] of faces) {
      const [p, q, r] = [verts[i0], verts[i1], verts[i2]];
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

  // 4. stitch out T-junctions, then flatten to scaled vertex buffers. The UVs
  // are read HERE, after the repair, from each vertex's lattice position: a
  // charted triangle's vertex is an affine read into its chart (a vertex the
  // repair inserted along an edge included), a swatch triangle's three sit at
  // its texel's centre. Texel coords over the skin's size make the [0,1] UV.
  const repaired = eliminateTJunctions(tris);
  const pos = new Float32Array(repaired.length * 9);
  const nrm = new Float32Array(repaired.length * 9);
  const uv = new Float32Array(repaired.length * 6); // present, and zero, in flat mode
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

  // --- assemble -------------------------------------------------------------
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // Weld coincident lattice vertices by position+normal+uv so distinct-facing
  // slope/region vertices stay split — and so do two charts' vertices at one
  // lattice point (they sample different texels; watertightness is judged on
  // positions, so the split costs it nothing). Normals are load-bearing HERE
  // and in diag.js — not for lighting (flatShading recomputes them per-face
  // in the shader).
  geo = mergeVertices(geo, 1e-4);

  // finishVoxelMesh centres X/Z and leaves Y as authored (wedge-mesh.test pins it).
  const charted = skin ? skin.charts.reduce((n, c) => n + (c ? 1 : 0), 0) : 0;
  const paint = skin ? { map: skinTexture(skin) } : { color: FLAT_COLOR };
  return finishVoxelMesh(geo, {
    nx,
    nz,
    s,
    ...paint,
    userData: {
      triangles: geo.index ? geo.index.count / 3 : repaired.length,
      wedges: wedges.length, // cells
      slopes,
      skin: skin ? { width: skin.width, height: skin.height, charts: charted } : null,
    },
  });
}
