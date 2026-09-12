// Low-poly wedge mesher over the voxel model (solid, surfaceMask, faceColor).
//
// Wedges: an empty cell with solid neighbors on two adjacent in-plane sides,
// and empty cells on the other two, is the inner corner of a staircase. It is
// filled with a triangular prism whose hypotenuse is a 45° slope. The two faces
// it covers are culled and its open ends get triangular gable caps. A wedge
// fires only when the two covered faces are the same material, so a color
// boundary stays a step. Wedges only fill notches, so convex corners stay
// sharp. One wedge per cell, and the first ridge in RIDGES wins.
//
// Geometry is emitted per plane:
// - Slopes: the wedge cells of one 45° plane form a grid, greedy-merged by
//   color into one quad per block.
// - Base faces: coplanar regions (regions.js) of exposed faces and cap halves,
//   triangulated with earcut (THREE.ShapeUtils).
// Color comes from the skin (skin.js), so regions merge on occupancy alone.
// UVs are read from lattice positions after the T-junction repair.
//
// Not handled: convex staircases still step, and 3D corners where two ridges
// meet become a step.

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

export function wedgeMesh(result, opts = {}) {
  const { dims, solid, surfaceMask, faceColor } = result;
  const { nx, ny, nz } = dims;
  const flat = !!opts.flat;
  const worldSize = opts.worldSize ?? DEFAULT_WORLD_SIZE;
  const s = worldSize / Math.max(nx, ny, nz);

  // Privacy browsers perturb getImageData by about ±1 per channel, which can
  // split one material into near-duplicate palette entries. sameMat allows a
  // squared RGB distance up to TOL2, which also absorbs antialiasing.
  const TOL2 = 12 * 12;
  const sameMat = (a, b) => {
    if (a == null || b == null) return false;
    // Compare RGB only. Alpha is always 255 here.
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

  // Scan for wedges.
  const wedgeCell = new Map(); // cellIdx -> chosen {R,A,B,sA,sB,color}
  const removed = new Set(); // base faces (idx*6+f) covered by a wedge
  const wedges = [];

  for (const ridge of RIDGES) {
    const { R, A, B } = ridge;
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const cidx = voxIndex(x, y, z, dims);
          if (solid[cidx] || wedgeCell.has(cidx)) continue; // empty and unclaimed
          for (const sA of [-1, 1]) {
            let placed = false;
            for (const sB of [-1, 1]) {
              const aN = step(x, y, z, A, sA); // solid neighbor on A side
              const bN = step(x, y, z, B, sB); // solid neighbor on B side
              if (!solidAt(...aN) || !solidAt(...bN)) continue;
              // opposite sides must be empty -> exactly two adjacent solids
              if (solidAt(...step(x, y, z, A, -sA))) continue;
              if (solidAt(...step(x, y, z, B, -sB))) continue;

              // the covered faces: each neighbor's face pointing back at the cell
              const faceA = faceKeyOf(A, -sA);
              const faceB = faceKeyOf(B, -sB);
              const aKey = voxIndex(...aN, dims) * 6 + FACE_INDEX[faceA];
              const bKey = voxIndex(...bN, dims) * 6 + FACE_INDEX[faceB];
              const cA = faceColor.get(aKey);
              const cB = faceColor.get(bKey);

              // Gate: the covered riser (cA) and tread (cB) must be the same material.
              if (!flat && !sameMat(cA, cB)) continue;
              // cA and cB agree unless flat, where FLAT_COLOR replaces the color.
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
  const axisVec = (a1, s1, a2, s2) => {
    const p = [0, 0, 0];
    p[AXI[a1]] = s1;
    if (a2) p[AXI[a2]] = s2;
    const L = Math.hypot(p[0], p[1], p[2]) || 1;
    return [p[0] / L, p[1] / L, p[2] / L];
  };
  // a wedge cell's corners along A and B: c toward the two solids, o opposite
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

  // 1. Slopes, one quad per block. The cells of one 45° plane share an
  // orientation (R, A, B, sA, sB) and an intercept sA·a + sB·b. They form a grid
  // with t = sA·a up the staircase and r along the ridge, greedy-merged by
  // color along r first. A block's quad runs from its first cell's corners to
  // its last cell's, across its r range, and samples its color's swatch.
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

  // 2. Gable caps, as half pieces of the planes they lie on. A cell end gets a
  // cap unless it meets solid or a wedge of the same orientation. The cap is
  // the right triangle in the cell's ±R face with its right angle at the filled
  // corner (Ac, Bc), in that face's tangent frame.
  /** @type {Map<string, import('./regions.js').Half[]>} */
  const halves = new Map();
  for (const w of wedges) {
    const p = { x: w.x, y: w.y, z: w.z };
    for (const sg of [-1, 1]) {
      const [ex, ey, ez] = step(w.x, w.y, w.z, w.R, sg);
      if (solidAt(ex, ey, ez)) continue; // internal against solid
      if (inBounds(ex, ey, ez)) {
        const wn = wedgeCell.get(voxIndex(ex, ey, ez, dims));
        if (wn && wn.R === w.R && wn.sA === w.sA && wn.sB === w.sB) continue;
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

  // Assemble.
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // Weld by position, normal and uv, so vertices of differently facing
  // triangles or of different charts stay split. flatShading ignores the
  // normals, but this weld and diag.js depend on them.
  geo = mergeVertices(geo, 1e-4);

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
