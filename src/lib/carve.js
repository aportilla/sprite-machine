// ---------------------------------------------------------------------------
// Carve: reconcile grid dimensions from the ingested views, then compute the
// visual hull = intersection of every provided view's extruded silhouette.
//
// Insight that keeps this simple: each view projects onto ONE of three planes
//   FRONT/BACK -> X-Y,  LEFT/RIGHT -> Z-Y,  TOP/BOTTOM -> X-Z.
// The two views of a pair produce the same silhouette (mirror images), so for
// CARVING a single view per plane fully constrains that axis. Mirroring is only
// needed for COLOR (see colorize.js). So carving is just: AND every provided
// view's occupancy, sampled through its projection. No camera math, no CSG.
// ---------------------------------------------------------------------------

import { resampleView } from './ingest.js';
import { VIEWS, VIEW_AXES } from './views.js';

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
 * Reconcile one integer resolution per axis from the cropped view sizes.
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
        `Views disagree on ${label} (${c.join(', ')}); resampling to ${mx}.`
      );
    }
    return mx;
  };
  const dims = { nx: pick('nx', 'X'), ny: pick('ny', 'Y'), nz: pick('nz', 'Z') };
  return { dims, warnings };
}

/**
 * Resample each provided view to exactly (imgW,imgH) for the reconciled grid so
 * projection indexes 1:1.
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
    const { occ, rgb } = resampleView(v, imgW, imgH);
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

  for (const [name, gv] of active) {
    const spec = VIEWS[name];
    const { occ, imgW } = gv;
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = voxIndex(x, y, z, dims);
          if (!solid[idx]) continue;
          const p = spec.project(x, y, z, dims);
          if (!occ[p.v * imgW + p.u]) solid[idx] = 0;
        }
      }
    }
  }
  return solid;
}

// 6 axis-neighbor offsets matching FACE order px,nx,py,ny,pz,nz.
const NEIGHBORS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
export const FACE_KEYS = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

/**
 * Extract surface voxels: a solid voxel with >=1 empty/out-of-bounds neighbor.
 * @returns {{surfaceMask:Uint8Array, count:number}}
 *   surfaceMask[idx] holds a 6-bit exposure mask (bit i => FACE_KEYS[i] exposed).
 */
export function extractSurface(solid, dims) {
  const { nx, ny, nz } = dims;
  const surfaceMask = new Uint8Array(nx * ny * nz);
  let count = 0;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const idx = voxIndex(x, y, z, dims);
        if (!solid[idx]) continue;
        let mask = 0;
        for (let f = 0; f < 6; f++) {
          const [dx, dy, dz] = NEIGHBORS[f];
          const ax = x + dx,
            ay = y + dy,
            az = z + dz;
          const outside =
            ax < 0 || ay < 0 || az < 0 || ax >= nx || ay >= ny || az >= nz;
          if (outside || !solid[voxIndex(ax, ay, az, dims)]) mask |= 1 << f;
        }
        if (mask) {
          surfaceMask[idx] = mask;
          count++;
        }
      }
    }
  }
  return { surfaceMask, count };
}
