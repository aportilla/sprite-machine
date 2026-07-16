// ---------------------------------------------------------------------------
// Diagonalized prism intersection (the "extrude-intersect" / slice-sweep-clip
// tile engine). The 45°-only 3D solid = intersection of the three extruded
// DIAGONALIZED silhouettes, which factorizes (proven: sweep === carve) into a
// per-z clip of the front polygon by the top/side intervals.
//
// Fixes the three MT failures by construction:
//  - front polygon is DIAGONALIZED -> its 45° edges extrude to vertical 45°
//    planes; structural 90° corners stay sharp (the diagonalizer left them).
//  - RAW integer bounds (NOT RDP-smoothed) step by exactly ±1, so lofting
//    consecutive slabs yields exact 45° roof/windshield planes, symmetric (no
//    tet diagonal bias).
//  - every vertex is a half-integer -> welds watertight with no float seams.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { marchingSquares, clipLoopBox, signedArea } from './vectorize.js';
import { diagonalizeLoop } from './diagonalize.js';
import { reconstructPlanes } from './lowpoly.js';
import { VIEWS, FACE_NORMAL, FACE_TO_VIEW, FACE_OPPOSITE } from './views.js';
import { FACE_KEYS } from './carve.js';
import { unpackRGBA } from './ingest.js';

// Raw integer interval bounds per z (corner coords): [xlo,xhi]x[ylo,yhi] or null.
function rawBounds(xz, zy, dims) {
  const { nx, ny, nz } = dims;
  const b = [];
  for (let z = 0; z < nz; z++) {
    let xl = 1e9, xh = -1, yl = 1e9, yh = -1;
    for (let x = 0; x < nx; x++) if (xz[x + nx * z]) { if (x < xl) xl = x; xh = x; }
    for (let y = 0; y < ny; y++) if (zy[z + nz * y]) { if (y < yl) yl = y; yh = y; }
    b.push(xh < 0 || yh < 0 ? null : { xlo: xl, xhi: xh + 1, ylo: yl, yhi: yh + 1 });
  }
  return b;
}

// classify a vertex by which box sides it lies on (for loft correspondence).
const classify = (p, b, e = 1e-6) =>
  (Math.abs(p[0] - b.xlo) < e ? 1 : 0) | (Math.abs(p[0] - b.xhi) < e ? 2 : 0) |
  (Math.abs(p[1] - b.ylo) < e ? 4 : 0) | (Math.abs(p[1] - b.yhi) < e ? 8 : 0);

const sameSig = (c0, b0, c1, b1) => {
  if (!c0 || !c1 || c0.length !== c1.length || c0.length < 3) return false;
  for (let i = 0; i < c0.length; i++) if (classify(c0[i], b0) !== classify(c1[i], b1)) return false;
  return true;
};

// rotate a loop to a canonical start (min y then x) so slabs correspond.
function canonical(poly) {
  let mi = 0;
  for (let i = 1; i < poly.length; i++)
    if (poly[i][1] < poly[mi][1] || (poly[i][1] === poly[mi][1] && poly[i][0] < poly[mi][0])) mi = i;
  return mi === 0 ? poly : poly.slice(mi).concat(poly.slice(0, mi));
}

export function tileMesh(result, opts = {}) {
  const { dims, gviews, palette } = result;
  const { nx, ny, nz } = dims;
  const worldSize = opts.worldSize ?? 2.5;
  const s = worldSize / Math.max(nx, ny, nz);

  const { xy, xz, zy } = reconstructPlanes(result);
  let loops = marchingSquares(xy, nx, ny);
  if (loops.length === 0) return new THREE.Group();
  loops.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  let front = diagonalizeLoop(loops[0]); // DIAGONALIZED front outline (45°/90°)
  if (signedArea(front) < 0) front.reverse();
  const bounds = rawBounds(xz, zy, dims);

  const sectionAt = (z) => {
    const b = bounds[z];
    if (!b) return null;
    const c = clipLoopBox(front, b.xlo, b.xhi, b.ylo, b.yhi);
    return c.length >= 3 ? { poly: canonical(c), box: b } : null;
  };

  // --- color helper ----------------------------------------------------------
  const dominant = palette && palette.length ? palette[0] : 0xffbbbbbb;
  const facetColor = (cx, cy, cz, n) => {
    let bestF = 0, bestD = -Infinity;
    for (let f = 0; f < 6; f++) {
      const fn = FACE_NORMAL[FACE_KEYS[f]];
      const d = n[0] * fn[0] + n[1] * fn[1] + n[2] * fn[2];
      if (d > bestD) { bestD = d; bestF = f; }
    }
    const x = Math.max(0, Math.min(nx - 1, Math.floor(cx)));
    const y = Math.max(0, Math.min(ny - 1, Math.floor(cy)));
    const z = Math.max(0, Math.min(nz - 1, Math.floor(cz)));
    for (const face of [FACE_KEYS[bestF], FACE_OPPOSITE[FACE_KEYS[bestF]]]) {
      const gv = gviews[FACE_TO_VIEW[face]];
      if (!gv) continue;
      const p = VIEWS[FACE_TO_VIEW[face]].project(x, y, z, dims);
      const i = p.v * gv.imgW + p.u;
      if (gv.occ[i]) return gv.rgb[i] >>> 0;
    }
    return dominant >>> 0;
  };

  const pos = [], nrm = [], col = [];
  const cache = new Map();
  const tmpC = new THREE.Color();
  const toLin = (packed) => {
    let c = cache.get(packed);
    if (!c) { const { r, g, b } = unpackRGBA(packed); tmpC.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace); c = [tmpC.r, tmpC.g, tmpC.b]; cache.set(packed, c); }
    return c;
  };
  const V = (p, z) => [p[0], p[1], z];
  const pushTri = (a, b, c) => {
    let ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    let vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const L = Math.hypot(n[0], n[1], n[2]);
    if (L < 1e-9) return;
    n = [n[0] / L, n[1] / L, n[2] / L];
    const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
    const [lr, lg, lb] = toLin(opts.flat ? 0xffcfcfd6 : facetColor(cx, cy, cz, n));
    for (const v of [a, b, c]) { pos.push(v[0] * s, v[1] * s, v[2] * s); nrm.push(n[0], n[1], n[2]); col.push(lr, lg, lb); }
  };
  const cap = (poly, z, up) => {
    if (!poly || poly.length < 3) return;
    let ring = poly;
    if ((signedArea(ring) > 0) !== up) ring = [...ring].reverse();
    const c2 = ring.map((p) => new THREE.Vector2(p[0], p[1]));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(c2, [])) {
      const A = V(ring[i], z), B = V(ring[j], z), C = V(ring[k], z);
      up ? pushTri(A, B, C) : pushTri(A, C, B);
    }
  };

  // sweep along z: cross-sections at cell centers, loft consecutive slabs.
  let loftCount = 0, capCount = 0, nullCount = 0;
  let zmin = 0; while (zmin < nz && !bounds[zmin]) zmin++;
  let zmax = nz - 1; while (zmax >= 0 && !bounds[zmax]) zmax--;
  let prev = sectionAt(zmin);
  cap(prev && prev.poly, zmin + 0.5, false);
  for (let z = zmin + 1; z <= zmax; z++) {
    const cur = sectionAt(z);
    if (!prev || !cur) nullCount++;
    if (prev && cur && sameSig(prev.poly, prev.box, cur.poly, cur.box)) {
      loftCount++;
      const p0 = prev.poly, p1 = cur.poly, m = p0.length;
      for (let i = 0; i < m; i++) {
        const a = V(p0[i], z - 0.5), b = V(p0[(i + 1) % m], z - 0.5);
        const c = V(p1[(i + 1) % m], z + 0.5), d = V(p1[i], z + 0.5);
        pushTri(a, b, c); pushTri(a, c, d);
      }
    } else {
      capCount++;
      cap(prev && prev.poly, (z - 1) + 0.5, true); // close previous slab
      cap(cur && cur.poly, z + 0.5, false);        // open next
    }
    prev = cur;
  }
  cap(prev && prev.poly, zmax + 0.5, true);

  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo = mergeVertices(geo, 1e-4); // exact weld on the (scaled) half-integer lattice
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, metalness: 0, roughness: 1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.triangles = geo.index ? geo.index.count / 3 : pos.length / 9;
  mesh.userData.sweep = { lofts: loftCount, caps: capCount, nulls: nullCount, zmin, zmax, span: zmax - zmin };
  return mesh;
}
