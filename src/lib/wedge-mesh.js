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
//  - It's PER-COLOR for free: a wedge fires only where the two covered faces
//    already agree on colour, so a window/body seam stays a sharp 45° edge with
//    no depth guessing (the whole point of the reverted per-color-parts task).
//  - A lone cube has no concave notch, so it gets NO wedges and stays sharp —
//    the additive rule self-guards convex structural corners.
//
// Scope (first cut): additive wedges only. Convex staircases (a hood sloping
// down-and-out) still step, and true 3-D corners where two ridges meet degrade
// to a step rather than a corner tile. One wedge per cell (first ridge wins).
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { voxIndex, FACE_KEYS } from './carve.js';
import { FACE_GEO } from './faces.js';
import { unpackRGBA } from './ingest.js';
import { VIEWS } from './views.js';
import { buildPalette, makeSnapper } from './colorize.js';

const AXI = { x: 0, y: 1, z: 2 };
// face key from axis name + sign (+1/-1)
const FKEY = {
  'x1': 'px', 'x-1': 'nx', 'y1': 'py', 'y-1': 'ny', 'z1': 'pz', 'z-1': 'nz',
};
const FIDX = {};
FACE_KEYS.forEach((k, i) => (FIDX[k] = i));
const FLAT_COLOR = 0xffcfcfd6;

// The view that looks ALONG a ridge axis, so it sees the slope's cross-section
// (profile) — where a 45° slope reads as its true surface with nothing in front
// to occlude it. Mirror-fallback to the opposite side when a view isn't given.
const PROFILE = { x: 'right', y: 'top', z: 'front' };
// The view that sees a riser (faceA, outward normal -sA on axis A) head-on.
const FACING = { z1: 'front', 'z-1': 'back', x1: 'right', 'x-1': 'left', y1: 'top', 'y-1': 'bottom' };
const OPP_VIEW = { front: 'back', back: 'front', right: 'left', left: 'right', top: 'bottom', bottom: 'top' };

// The three ridge axes (the axis a wedge prism extends along) and their two
// in-plane tangent axes (A, B). Order matters: z first so long z-ridges (the
// common extruded roof/windshield) win the one-wedge-per-cell tie.
const RIDGES = [
  { R: 'z', A: 'x', B: 'y' },
  { R: 'x', A: 'z', B: 'y' },
  { R: 'y', A: 'x', B: 'z' },
];

export function wedgeMesh(result, opts = {}) {
  const { dims, solid, surfaceMask, faceColor, palette, gviews } = result;
  const { nx, ny, nz } = dims;
  const flat = !!opts.flat;
  const worldSize = opts.worldSize ?? 2.5;
  const s = worldSize / Math.max(nx, ny, nz);
  const dominant = (palette && palette.length ? palette[0] : FLAT_COLOR) >>> 0;

  // Gate samples are snapped to the canonical sprite palette so same-material
  // pixels compare equal despite farble noise (privacy browsers like Helium
  // perturb getImageData by ~±1/channel) or ordinary AA fringe. Snapping alone
  // isn't enough: farble also splits the palette into near-duplicate entries, so
  // two noisy pixels can snap to *adjacent* entries — hence sameMat also allows
  // a small colour tolerance. Distinct materials sit far above TOL2 (~180 apart
  // here vs a 12 slack), so real seams still gate.
  const snapPalette = palette && palette.length ? palette : buildPalette(gviews);
  const snap = snapPalette.length ? makeSnapper(snapPalette) : (c) => c;
  const TOL2 = 12 * 12; // ~12 per-channel slack (squared L2): covers farble + AA
  const sameMat = (a, b) => {
    if (a == null || b == null) return false;
    if ((a >>> 0) === (b >>> 0)) return true;
    const ar = a & 255, ag = (a >>> 8) & 255, ab = (a >>> 16) & 255;
    const br = b & 255, bg = (b >>> 8) & 255, bb = (b >>> 16) & 255;
    return (ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2 <= TOL2;
  };

  const inBounds = (x, y, z) =>
    x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz;
  const solidAt = (x, y, z) =>
    inBounds(x, y, z) && solid[voxIndex(x, y, z, dims)];
  const step = (x, y, z, ax, sg) => [
    x + sg * (ax === 'x'),
    y + sg * (ax === 'y'),
    z + sg * (ax === 'z'),
  ];
  // Sample the SOURCE sprite at a voxel via a given view (mirror-fallback for an
  // un-provided side). Returns the raw packed colour, or null if that pixel is
  // outside the silhouette.
  const viewSample = (view, x, y, z) => {
    let gv = gviews[view];
    if (!gv) { view = OPP_VIEW[view]; gv = gviews[view]; if (!gv) return null; }
    const p = VIEWS[view].project(x, y, z, dims);
    const i = p.v * gv.imgW + p.u;
    return gv.occ[i] ? snap(gv.rgb[i] >>> 0) >>> 0 : null;
  };

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
              const faceA = FKEY[A + -sA];
              const faceB = FKEY[B + -sB];
              const aKey = voxIndex(...aN, dims) * 6 + FIDX[faceA];
              const bKey = voxIndex(...bN, dims) * 6 + FIDX[faceB];
              const cA = faceColor.get(aKey);
              const cB = faceColor.get(bKey);

              // Gate + colour by sampling the SOURCE sprite directly (the wedge IS
              // the real surface): read each step's material through the PROFILE
              // view — the one looking along the ridge, which sees the slope's
              // cross-section with nothing in front to occlude it (so a windshield
              // reads teal all the way down, where the facing view saw hood). Same
              // source colour on both steps -> coherent surface -> wedge; differ ->
              // material boundary (tyre/body, roof/window) -> skip. Colour from the
              // notch centre (mid-slope).
              // Profile view (along the ridge) fills coherent slopes even where
              // the hood occludes them — but it's blind to a material boundary
              // that runs along the ridge (a hard roof/window edge), reading both
              // sides as the white pillar. So also consult the FACING view, which
              // sees each riser's true colour: if the two steps differ there AND
              // the lower step isn't occluded, it's a real boundary -> skip.
              const profileView = PROFILE[R];
              const sUp = viewSample(profileView, ...aN);
              const sLo = viewSample(profileView, ...bN);
              const profileOk = sameMat(sUp, sLo);

              const fUp = viewSample(FACING[A + -sA], ...aN);
              const fLo = viewSample(FACING[A + -sA], ...bN);
              let ox = bN[0], oy = bN[1], oz = bN[2], occ = false;
              for (let k = 0; k < 16 && !occ; k++) {
                if (A === 'x') ox += -sA; else if (A === 'y') oy += -sA; else oz += -sA;
                if (!inBounds(ox, oy, oz)) break;
                if (solidAt(ox, oy, oz)) occ = true;
              }
              // The facing veto samples each step's facing-view PIXEL, but the
              // lower step's pixel is the front elevation at that height — which
              // can belong to a *different* lower step (a pink riser under a white
              // cap), not the face this wedge covers. So a facing mismatch is only
              // a real boundary when the two faces the wedge actually TOUCHES
              // (cA, cB) also disagree; otherwise it's one coherent surface
              // crossing a colour band in the elevation and must still wedge (a
              // monochrome staircase would else drop the step at every band edge).
              const boundary =
                fUp != null && fLo != null && !sameMat(fUp, fLo) && !occ &&
                !sameMat(cA, cB);
              if (!flat && !(profileOk && !boundary)) continue;
              wedgeCell.set(cidx, { R, A, B, sA, sB });
              removed.add(aKey);
              removed.add(bKey);
              // colour from the riser's own face (the surface's true colour, e.g.
              // teal glass), NOT the profile view (which sees the pillar edge).
              const color = (cA != null ? cA : cB != null ? cB : dominant) >>> 0;
              wedges.push({ x, y, z, R, A, B, sA, sB, color });
              placed = true;
              break;
            }
            if (placed) break;
          }
        }
  }

  // --- geometry emit --------------------------------------------------------
  const pos = [], nrm = [], col = [];
  const cache = new Map();
  const tmpC = new THREE.Color();
  const toLin = (packed) => {
    let c = cache.get(packed);
    if (!c) {
      const { r, g, b } = unpackRGBA(packed);
      tmpC.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
      c = [tmpC.r, tmpC.g, tmpC.b];
      cache.set(packed, c);
    }
    return c;
  };
  const pushTri = (a, b, c, N, lin) => {
    // wind to match the explicit outward normal N (backface culling is on)
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    if (gx * N[0] + gy * N[1] + gz * N[2] < 0) { const t = b; b = c; c = t; }
    for (const v of [a, b, c]) {
      pos.push(v[0] * s, v[1] * s, v[2] * s);
      nrm.push(N[0], N[1], N[2]);
      col.push(lin[0], lin[1], lin[2]);
    }
  };
  const pushQuad = (a, b, c, d, N, lin) => {
    pushTri(a, b, c, N, lin);
    pushTri(a, c, d, N, lin);
  };
  // build a point [x,y,z] from three axis/value pairs
  const mk = (a1, v1, a2, v2, a3, v3) => {
    const p = [0, 0, 0];
    p[AXI[a1]] = v1; p[AXI[a2]] = v2; p[AXI[a3]] = v3;
    return p;
  };
  const axisVec = (a1, s1, a2, s2) => {
    const p = [0, 0, 0];
    p[AXI[a1]] = s1; if (a2) p[AXI[a2]] = s2;
    const L = Math.hypot(p[0], p[1], p[2]) || 1;
    return [p[0] / L, p[1] / L, p[2] / L];
  };

  // 1. base voxel faces (culled) minus the ones wedges cover
  for (let idx = 0; idx < surfaceMask.length; idx++) {
    const mask = surfaceMask[idx];
    if (!mask) continue;
    const z = (idx / (nx * ny)) | 0;
    const rem = idx - z * nx * ny;
    const y = (rem / nx) | 0;
    const x = rem - y * nx;
    const c = { x, y, z };
    for (let f = 0; f < 6; f++) {
      if (!(mask & (1 << f)) || removed.has(idx * 6 + f)) continue;
      const g = FACE_GEO[FACE_KEYS[f]];
      const corners = g.quad(c[g.A], c[g.A], c[g.B], c[g.B], c[g.N]);
      const packed = flat ? FLAT_COLOR : (faceColor.get(idx * 6 + f) ?? dominant) >>> 0;
      pushQuad(corners[0], corners[1], corners[2], corners[3], g.normal, toLin(packed));
    }
  }

  // 2. wedge prisms: hypotenuse slope + gable caps at open ends
  for (const w of wedges) {
    const { x, y, z, R, A, B, sA, sB } = w;
    const p = { x, y, z };
    const aC = p[A], bC = p[B], rC = p[R];
    const Ac = sA < 0 ? aC : aC + 1, Ao = sA < 0 ? aC + 1 : aC; // filled / opposite A corner
    const Bc = sB < 0 ? bC : bC + 1, Bo = sB < 0 ? bC + 1 : bC;
    const rLo = rC, rHi = rC + 1;
    const pt = (av, bv, rv) => mk(A, av, B, bv, R, rv);
    const lin = toLin(flat ? FLAT_COLOR : w.color);

    // sloped face: connects the opposite-A and opposite-B corners, swept along R
    const HN = axisVec(A, -sA, B, -sB);
    pushQuad(pt(Ao, Bc, rLo), pt(Ao, Bc, rHi), pt(Ac, Bo, rHi), pt(Ac, Bo, rLo), HN, lin);

    // cap an end iff the run doesn't continue there and isn't buried in solid
    const capNeeded = (sg) => {
      const [ax, ay, az] = step(x, y, z, R, sg);
      if (solidAt(ax, ay, az)) return false; // internal against solid
      if (!inBounds(ax, ay, az)) return true; // grid edge -> exposed
      const wn = wedgeCell.get(voxIndex(ax, ay, az, dims));
      return !(wn && wn.R === R && wn.sA === sA && wn.sB === sB);
    };
    if (capNeeded(-1))
      pushTri(pt(Ac, Bc, rLo), pt(Ao, Bc, rLo), pt(Ac, Bo, rLo), axisVec(R, -1), lin);
    if (capNeeded(1))
      pushTri(pt(Ac, Bc, rHi), pt(Ao, Bc, rHi), pt(Ac, Bo, rHi), axisVec(R, 1), lin);
  }

  // --- assemble -------------------------------------------------------------
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo = mergeVertices(geo, 1e-4); // weld on the integer lattice (position+normal+color)
  // match voxelMesh framing exactly: centre X/Z, rest the base on y=0
  geo.translate((-nx * s) / 2, 0, (-nz * s) / 2);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, metalness: 0, roughness: 1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.triangles = geo.index ? geo.index.count / 3 : pos.length / 9;
  mesh.userData.wedges = wedges.length;
  return mesh;
}
