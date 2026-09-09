// ---------------------------------------------------------------------------
// Carve: reconcile grid dimensions from the ingested views, then compute the
// visual hull = intersection of every provided view's extruded silhouette.
//
// Insight that keeps this simple: each view projects onto ONE of three planes
//   FRONT/BACK -> X-Y,  LEFT/RIGHT -> Z-Y,  TOP/BOTTOM -> X-Z.
// The two views of a pair produce the same silhouette (mirror images), so for
// CARVING a single view per plane fully constrains that axis. Mirroring is only
// needed for COLOR (see colorize.js). So carving is: UNION the views within
// each plane (opposite silhouettes are identical in theory, so this is robust
// to a 1-texel registration slip between hand-drawn opposite sprites — see
// carve()), then AND across the planes. No camera math, no CSG.
// ---------------------------------------------------------------------------

import { placeView } from './ingest.js';
import { VIEWS, VIEW_AXES, FACE_KEYS, FACE_NORMAL } from './views.js';

export const voxIndex = (x, y, z, d) => x + d.nx * (y + d.ny * z);

/** Inverse of voxIndex: linear grid index -> {x,y,z}. Kept next to voxIndex so
 * the forward and inverse packing can't drift. */
export const unvoxIndex = (idx, d) => {
  const z = (idx / (d.nx * d.ny)) | 0;
  const rem = idx - z * d.nx * d.ny;
  const y = (rem / d.nx) | 0;
  return { x: rem - y * d.nx, y, z };
};

/**
 * Reconcile one integer resolution per axis from the (uncropped) tile sizes.
 * For a well-formed sheet every view is the same size, so each axis has a single
 * candidate and the grid is exactly the tile size. Unequal sizes (a malformed
 * sheet, or non-square tiles whose depth differs between side-width and
 * top-height) take the max and warn — the shorter view under-constrains the tail.
 * @param {Record<string, {w:number,h:number}>} views  provided views by name
 * @returns {{dims:{nx:number,ny:number,nz:number}, warnings:string[]}}
 */
export function reconcileDims(views) {
  const cand = { nx: [], ny: [], nz: [] };
  for (const [name, v] of Object.entries(views)) {
    if (!v) continue;
    const [wAxis, hAxis] = VIEW_AXES[name];
    cand[wAxis].push(v.w);
    cand[hAxis].push(v.h);
  }
  const warnings = [];
  const pick = (axis, label) => {
    const c = cand[axis];
    if (c.length === 0) {
      warnings.push(
        `Axis ${label} is unconstrained (no view observes it); defaulting to 1. ` +
          `Provide a view that sees ${label} for real depth.`
      );
      return 1;
    }
    const mn = Math.min(...c);
    const mx = Math.max(...c);
    if (mn !== mx) {
      warnings.push(
        `Views disagree on ${label} (${c.join(', ')}); strict registration ` +
          `expects uniform, square tiles. Using ${mx}; a smaller view is placed ` +
          `from the origin (not re-centered) and leaves the far end of ${label} ` +
          `uncarved — check the atlas tile size.`
      );
    }
    return mx;
  };
  const dims = { nx: pick('nx', 'X'), ny: pick('ny', 'Y'), nz: pick('nz', 'Z') };
  return { dims, warnings };
}

/**
 * Place each provided view into the reconciled (imgW,imgH) grid at NATIVE scale
 * and IDENTITY position (offX=offY=0) — strict registration: a tile's texel
 * (u,v) is a fixed lattice line, so it is NOT re-centered or bottom-anchored.
 * For a well-formed (uniform-tile) sheet each view already equals the grid on
 * the axes it constrains, so this is a 1:1 copy. There is no auto ground-rest:
 * where the object sits in Y is wherever the artist painted it (paint at the
 * tile's bottom rows to rest on y=0). A malformed sheet with unequal-size views
 * lands each at the origin and warns (reconcileDims).
 * @returns {Record<string,{occ:Uint8Array,rgb:Uint32Array,imgW:number,imgH:number}>}
 */
export function gridViews(views, dims) {
  /** @type {Record<string, {occ:Uint8Array,rgb:Uint32Array,imgW:number,imgH:number}>} */
  const out = {};
  for (const [name, v] of Object.entries(views)) {
    if (!v) continue;
    const spec = VIEWS[name];
    const imgW = spec.imgW(dims);
    const imgH = spec.imgH(dims);
    const { occ, rgb } = placeView(v, imgW, imgH, 0, 0);
    out[name] = { occ, rgb, imgW, imgH };
  }
  return out;
}

/**
 * Carve the visual hull.
 * @param {Record<string,{occ:Uint8Array,imgW:number}>} gviews grid-sized views
 * @param {{nx:number,ny:number,nz:number}} dims
 * @returns {Uint8Array} solid occupancy, length nx*ny*nz
 */
export function carve(gviews, dims) {
  const { nx, ny, nz } = dims;
  const solid = new Uint8Array(nx * ny * nz).fill(1);
  const active = Object.entries(gviews);
  // Contract: with no views, nothing carves — the grid stays filled to its
  // bounding box. reconcileDims defaults every unconstrained axis to 1, so a
  // fully empty input yields a single solid voxel (pipeline.js warns about it).
  if (active.length === 0) return solid;

  // Group the provided views by the projection PLANE they constrain
  // (front/back -> X-Y, left/right -> Z-Y, top/bottom -> X-Z). A real solid's
  // two opposite silhouettes are identical, so WITHIN a plane we UNION the
  // views — a voxel is covered if ANY view on that plane sees it. This is what
  // the header means by "a single view per plane fully constrains that axis":
  // the opposite view is redundant for carving, not an extra constraint.
  // ANDing the pair instead lets a 1-texel registration slip between two
  // hand-drawn opposite sprites erode thin protrusions — e.g. a car's side
  // mirror that survives in the top sprite but sits one row over in the bottom
  // sprite has an empty top∧bottom intersection, so its outer column vanishes.
  // We then intersect ACROSS the (up to three) planes to get the visual hull.
  const planes = new Map(); // planeKey -> [{spec, occ, imgW}, ...]
  for (const [name, gv] of active) {
    const key = VIEW_AXES[name].join(); // e.g. 'nx,ny' — one key per plane
    const group = planes.get(key) || planes.set(key, []).get(key);
    group.push({ spec: VIEWS[name], occ: gv.occ, imgW: gv.imgW });
  }
  const planeList = [...planes.values()];

  // One reused scratch for the projection (projectInto mutates it) so the hot
  // triple loop below allocates nothing per voxel × view.
  const p = { u: 0, v: 0 };
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const idx = voxIndex(x, y, z, dims);
        for (const group of planeList) {
          let covered = false;
          for (const { spec, occ, imgW } of group) {
            spec.projectInto(x, y, z, dims, p);
            if (occ[p.v * imgW + p.u]) {
              covered = true;
              break;
            }
          }
          if (!covered) {
            solid[idx] = 0;
            break;
          }
        }
      }
    }
  }
  return solid;
}

// 6 axis-neighbor offsets in FACE_KEYS order — the outward normals themselves.
// Derived from FACE_NORMAL so they can't drift from the face convention.
const NEIGHBORS = FACE_KEYS.map((k) => FACE_NORMAL[k]);

/**
 * Extract surface voxels: a solid voxel with >=1 empty/out-of-bounds neighbor.
 * Also tallies the total solid count in the same pass (every voxel is visited and
 * gated on solid here), so the pipeline needn't re-walk the grid a third time.
 * @returns {{surfaceMask:Uint8Array, count:number, solidCount:number}}
 *   surfaceMask[idx] holds a 6-bit exposure mask (bit i => FACE_KEYS[i] exposed);
 *   count = surface voxels; solidCount = all solid voxels (surface + interior).
 */
export function extractSurface(solid, dims) {
  const { nx, ny, nz } = dims;
  const surfaceMask = new Uint8Array(nx * ny * nz);
  let count = 0;
  let solidCount = 0;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const idx = voxIndex(x, y, z, dims);
        if (!solid[idx]) continue;
        solidCount++;
        let mask = 0;
        for (let f = 0; f < 6; f++) {
          const [dx, dy, dz] = NEIGHBORS[f];
          const ax = x + dx,
            ay = y + dy,
            az = z + dz;
          const outside = ax < 0 || ay < 0 || az < 0 || ax >= nx || ay >= ny || az >= nz;
          if (outside || !solid[voxIndex(ax, ay, az, dims)]) mask |= 1 << f;
        }
        if (mask) {
          surfaceMask[idx] = mask;
          count++;
        }
      }
    }
  }
  return { surfaceMask, count, solidCount };
}
