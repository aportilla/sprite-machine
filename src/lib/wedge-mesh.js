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
// COLOR IS THE SKIN, NOT THE GEOMETRY (Sep 7 2026). The base faces are
// greedy-merged on occupancy alone (faces.js) and painted by a texture
// (skin.js): a rectangle that crosses a colour boundary carries a chart — a
// texel per voxel face — and a one-colour rectangle, like every wedge, points
// at its colour's swatch; every triangle's UVs are an affine read of its
// vertices' lattice positions, taken AFTER the T-junction repair, so no UV is
// ever plumbed through a split. Until then every triangle carried a vertex
// colour and the merge could only join faces of one colour — a painted wall
// shattered into a rect per region, each boundary feeding the repair. The
// Car: 1784 → 900 triangles, the same 236 wedges. Opening the wedge gate to
// match was measured and rejected (1092: more wedges are more caps and more
// split faces), so the strict same-material gate stays exactly as it was.
//
// Scope (first cut): additive wedges only. Convex staircases (a hood sloping
// down-and-out) still step, and true 3-D corners where two ridges meet degrade
// to a step rather than a corner tile. One wedge per cell (first ridge wins).
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { voxIndex } from './carve.js';
import { faceQuads, idxFor } from './faces.js';
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
 * A lattice triangle and its paint: a charted base triangle carries its chart
 * and rect (its UVs are read off its vertices); everything else — a uniform
 * base rect, a wedge's slope, a gable cap — carries the packed colour whose
 * swatch it samples. The T-junction repair copies the paint onto every piece.
 * @typedef {{a:number[], b:number[], c:number[], normal:number[],
 *            chart:import('./skin.js').Chart|null, rect:import('./skin.js').Rect|null,
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
  const wedgeCell = new Map(); // cellIdx -> chosen {R,A,B,sA,sB}
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
              wedgeCell.set(cidx, { R, A, B, sA, sB });
              removed.add(aKey);
              removed.add(bKey);
              // The non-flat gate guarantees cA and cB agree, so either is the
              // surface's true colour. (In flat mode the wedge colour is overridden
              // to FLAT_COLOR downstream, so a null here can never render.)
              const color = (cA != null ? cA : cB) >>> 0;
              wedges.push({ x, y, z, R, A, B, sA, sB, color });
              placed = true;
              break;
            }
            if (placed) break;
          }
        }
  }

  // --- geometry emit --------------------------------------------------------
  // Collect INTEGER-lattice triangles first (base faces + wedges), eliminate the
  // T-junctions greedy merging introduces, THEN build the scaled buffers.
  /** @type {Tri[]} */
  const tris = []; // CCW wrt normal
  // paint: { chart, rect } for a charted base rect, { swatch } for a
  // one-material primitive (a uniform rect, a wedge's slope, a cap)
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
      rect: paint.rect ?? null,
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

  // 1. base voxel faces, GREEDY-merged on occupancy, minus the ones wedges
  // cover; the skin baked over the rects once — a chart where a rect crosses
  // a colour, a swatch where it does not — then each rect emitted with its
  // paint. Merging creates T-junctions against the unit-scale wedge edges;
  // the repair pass below stitches those back into a watertight manifold.
  // Flat mode has no skin: every primitive is the flat grey, the UVs zero.
  const baseMask = surfaceMask.slice();
  for (const rk of removed) baseMask[(rk / 6) | 0] &= ~(1 << rk % 6);
  const rects = faceQuads(dims, baseMask, true);
  const skin = flat ? null : bakeSkin(rects, result.palette ?? [], faceColor, dims);
  // a uniform rect's one colour is its first face's (every face agrees)
  const rectColor = (r) =>
    faceColor.get(idxFor(r.face, r.a, r.b, r.s, dims) * 6 + FACE_INDEX[r.face]) >>> 0;
  rects.forEach((rect, i) => {
    const cr = rect.corners;
    const chart = skin ? skin.charts[i] : null;
    const paint = chart
      ? { chart, rect }
      : { swatch: flat ? FLAT_COLOR : rectColor(rect) };
    pushQuad(cr[0], cr[1], cr[2], cr[3], rect.normal, paint);
  });

  // 2. wedge prisms: hypotenuse slope + gable caps at open ends — one material
  // each by the gate, so every triangle samples the wedge colour's swatch.
  for (const w of wedges) {
    const { x, y, z, R, A, B, sA, sB } = w;
    const p = { x, y, z };
    const aC = p[A],
      bC = p[B],
      rC = p[R];
    const Ac = sA < 0 ? aC : aC + 1,
      Ao = sA < 0 ? aC + 1 : aC; // filled / opposite A corner
    const Bc = sB < 0 ? bC : bC + 1,
      Bo = sB < 0 ? bC + 1 : bC;
    const rLo = rC,
      rHi = rC + 1;
    const pt = (av, bv, rv) => mk(A, av, B, bv, R, rv);
    const paint = { swatch: flat ? FLAT_COLOR : w.color >>> 0 };

    // sloped face: connects the opposite-A and opposite-B corners, swept along R
    const HN = axisVec(A, -sA, B, -sB);
    pushQuad(
      pt(Ao, Bc, rLo),
      pt(Ao, Bc, rHi),
      pt(Ac, Bo, rHi),
      pt(Ac, Bo, rLo),
      HN,
      paint
    );

    // cap an end iff the run doesn't continue there and isn't buried in solid
    const capNeeded = (sg) => {
      const [ax, ay, az] = step(x, y, z, R, sg);
      if (solidAt(ax, ay, az)) return false; // internal against solid
      if (!inBounds(ax, ay, az)) return true; // grid edge -> exposed
      const wn = wedgeCell.get(voxIndex(ax, ay, az, dims));
      return !(wn && wn.R === R && wn.sA === sA && wn.sB === sB);
    };
    if (capNeeded(-1))
      pushTri(pt(Ac, Bc, rLo), pt(Ao, Bc, rLo), pt(Ac, Bo, rLo), axisVec(R, -1), paint);
    if (capNeeded(1))
      pushTri(pt(Ac, Bc, rHi), pt(Ao, Bc, rHi), pt(Ac, Bo, rHi), axisVec(R, 1), paint);
  }

  // 3. stitch out T-junctions, then flatten to scaled vertex buffers. The UVs
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
    const sw = skin && !t.rect ? swatchUV(skin, t.swatch) : null;
    for (const v of [t.a, t.b, t.c]) {
      pos[o] = v[0] * s;
      pos[o + 1] = v[1] * s;
      pos[o + 2] = v[2] * s;
      nrm[o] = t.normal[0];
      nrm[o + 1] = t.normal[1];
      nrm[o + 2] = t.normal[2];
      if (skin) {
        const [tu, tv] = sw || uvOfLattice(t.chart, t.rect, v);
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
  // wedge/base vertices stay split — and so do two charts' vertices at one
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
      wedges: wedges.length,
      skin: skin ? { width: skin.width, height: skin.height, charts: charted } : null,
    },
  });
}
