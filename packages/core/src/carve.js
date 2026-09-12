// Carve: reconcile the grid dimensions from the views, then compute the visual
// hull, the intersection of every view's extruded silhouette. Each view projects
// onto one plane: front/back X-Y, left/right Z-Y, top/bottom X-Z.

import { placeView } from './ingest.js';
import { VIEWS, VIEW_AXES, FACE_KEYS, FACE_NORMAL } from './views.js';

export const voxIndex = (x, y, z, d) => x + d.nx * (y + d.ny * z);

/** Inverse of voxIndex: a linear grid index to {x, y, z}. */
export const unvoxIndex = (idx, d) => {
  const z = (idx / (d.nx * d.ny)) | 0;
  const rem = idx - z * d.nx * d.ny;
  const y = (rem / d.nx) | 0;
  return { x: rem - y * d.nx, y, z };
};

/**
 * One integer resolution per axis from the view sizes. When views disagree on an
 * axis, the largest wins and a warning is added.
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
 * Place each view into its imgW × imgH grid at native scale and offset 0. A texel
 * is a fixed lattice line, so views are not re-centered or ground-rested.
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
  // No views: nothing carves and the grid stays full.
  if (active.length === 0) return solid;

  // Views are unioned within a plane, then intersected across planes. The union
  // keeps a 1-texel slip between opposite hand-drawn sprites from eroding thin
  // parts.
  const planes = new Map(); // planeKey -> [{spec, occ, imgW}, ...]
  for (const [name, gv] of active) {
    const key = VIEW_AXES[name].join(); // e.g. 'nx,ny'
    const group = planes.get(key) || planes.set(key, []).get(key);
    group.push({ spec: VIEWS[name], occ: gv.occ, imgW: gv.imgW });
  }
  const planeList = [...planes.values()];

  // Reused scratch for projectInto, so the hot loop allocates nothing.
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

// Axis-neighbor offsets in FACE_KEYS order (the outward normals).
const NEIGHBORS = FACE_KEYS.map((k) => FACE_NORMAL[k]);

/**
 * Surface voxels: solid voxels with at least one empty or out-of-bounds neighbor.
 * Also counts all solid voxels in the same pass.
 * @returns {{surfaceMask:Uint8Array, count:number, solidCount:number}}
 *   surfaceMask[idx] holds a 6-bit exposure mask (bit i => FACE_KEYS[i] exposed);
 *   count = surface voxels; solidCount = all solid voxels.
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
