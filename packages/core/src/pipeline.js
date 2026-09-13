// The sprite-to-voxel pipeline. No THREE or DOM.
// Input: view name -> ImageData-like { width, height, data (RGBA) }.
// Output: the voxel grid, surface and per-face colors for meshing. A layered
// sheet builds each layer on its own, and unionVoxels merges the results.

import { ingestSprite, applyTransform } from './ingest.js';
import {
  reconcileDims,
  gridViews,
  carve,
  extractSurface,
  voxIndex,
  unvoxIndex,
} from './carve.js';
import { colorize } from './colorize.js';
import { VIEW_NAMES, VIEW_AXES, FACE_TO_VIEW, faceKeyOf } from './views.js';

/**
 * @param {Record<string, {width:number,height:number,data:ArrayLike<number>}|null>} rawViews
 * @param {{transforms?:Record<string,{rot?:number,flipX?:boolean,flipY?:boolean}>,
 *          mirror?:{x?:boolean,y?:boolean,z?:boolean}}} [opts]
 */
export function buildVoxels(rawViews, opts = {}) {
  const transforms = opts.transforms || {};
  /** @type {Record<string, any>} */
  const ingested = {};
  for (const name of VIEW_NAMES) {
    let img = rawViews[name];
    if (!img) continue;
    if (transforms[name]) img = applyTransform(img, transforms[name]);
    const v = ingestSprite(img);
    if (v) ingested[name] = v;
  }

  const { dims, warnings } = reconcileDims(ingested);
  if (Object.keys(ingested).length === 0) {
    warnings.unshift('No usable views: every provided sprite was empty or missing.');
  }
  const gviews = gridViews(ingested, dims);
  const solid = carve(gviews, dims);
  const { surfaceMask, count, solidCount } = extractSurface(solid, dims);
  const { faceColor, palette } = colorize(solid, surfaceMask, gviews, dims, opts);
  if (palette.length === 0 && Object.keys(ingested).length > 0) {
    warnings.push('No opaque pixels found — every provided sprite is fully transparent.');
  }

  return {
    dims,
    solid,
    surfaceMask,
    surfaceCount: count,
    solidCount,
    faceColor,
    palette,
    warnings,
    gviews,
    ingested,
    providedViews: Object.keys(ingested),
  };
}

/** @typedef {ReturnType<typeof buildVoxels>} VoxelResult */

// Each lattice axis: its dims key and its world axis.
const AXES = /** @type {const} */ ([
  ['nx', 'x'],
  ['ny', 'y'],
  ['nz', 'z'],
]);

// Where a layer's lattice starts in the union's. An axis none of the layer's
// views observes is one voxel deep, and sits at the far end when the layer
// has the view of that axis's positive face (left, top or front), else at 0.
// Every other axis starts at 0.
function layerOffset(r, dims) {
  const off = { x: 0, y: 0, z: 0 };
  for (const [dim, axis] of AXES) {
    const observed = r.providedViews.some((v) => VIEW_AXES[v].includes(dim));
    const positive = FACE_TO_VIEW[faceKeyOf(axis, 1)];
    if (!observed && r.providedViews.includes(positive)) {
      off[axis] = dims[dim] - r.dims[dim];
    }
  }
  return off;
}

/**
 * Merge per-layer buildVoxels results into one model.
 *   - A layer with no provided view is dropped, warnings included.
 *   - The lattice is the per-axis max of the kept layers' dims, each layer placed
 *     by layerOffset. A voxel is solid when any layer holds it, and the surface
 *     is extracted from that solid.
 *   - An exposed face takes its color from the last layer in block order that
 *     holds its voxel. The face is exposed in that layer too, so it has one.
 *   - The palette is the union of the layers'. Warnings are prefixed "Layer k:".
 *     `layers` holds the results, null where dropped.
 * One result, or none with a provided view, returns the first result untouched.
 * No results is one empty layer.
 * @param {VoxelResult[]} results  one per layer, in block order
 */
export function unionVoxels(results) {
  if (results.length === 0) return buildVoxels({});
  const kept = results.map((r) => (r.providedViews.length > 0 ? r : null));
  const live = kept.filter((r) => r != null);
  if (results.length === 1 || live.length === 0) return results[0];

  const dims = { nx: 1, ny: 1, nz: 1 };
  for (const r of live) {
    for (const [dim] of AXES) dims[dim] = Math.max(dims[dim], r.dims[dim]);
  }
  const placed = live.map((r) => ({ r, off: layerOffset(r, dims) }));

  const n = dims.nx * dims.ny * dims.nz;
  const solid = new Uint8Array(n);
  // 1 + the index in `placed` of the last layer holding each voxel, 0 for none.
  const owner = new Uint16Array(n);
  placed.forEach(({ r, off }, i) => {
    const d = r.dims;
    for (let z = 0; z < d.nz; z++) {
      for (let y = 0; y < d.ny; y++) {
        for (let x = 0; x < d.nx; x++) {
          if (!r.solid[voxIndex(x, y, z, d)]) continue;
          const u = voxIndex(x + off.x, y + off.y, z + off.z, dims);
          solid[u] = 1;
          owner[u] = i + 1;
        }
      }
    }
  });

  const { surfaceMask, count, solidCount } = extractSurface(solid, dims);
  /** @type {Map<number, number>} */
  const faceColor = new Map();
  for (let idx = 0; idx < n; idx++) {
    const mask = surfaceMask[idx];
    if (!mask) continue;
    const { r, off } = placed[owner[idx] - 1];
    const p = unvoxIndex(idx, dims);
    const local = voxIndex(p.x - off.x, p.y - off.y, p.z - off.z, r.dims) * 6;
    for (let f = 0; f < 6; f++) {
      if (mask & (1 << f)) faceColor.set(idx * 6 + f, r.faceColor.get(local + f));
    }
  }

  return {
    dims,
    solid,
    surfaceMask,
    surfaceCount: count,
    solidCount,
    faceColor,
    palette: [...new Set(live.flatMap((r) => r.palette))],
    warnings: kept.flatMap((r, k) =>
      r ? r.warnings.map((w) => `Layer ${k + 1}: ${w}`) : []
    ),
    providedViews: VIEW_NAMES.filter((v) =>
      live.some((r) => r.providedViews.includes(v))
    ),
    layers: kept,
  };
}

/**
 * buildVoxels for each layer's views, then unionVoxels.
 * @param {Record<string, {width:number,height:number,data:ArrayLike<number>}|null>[]} rawViewsByLayer
 *   one views record per layer, in block order
 * @param {Parameters<typeof buildVoxels>[1]} [opts]  applied to every layer
 */
export function buildLayeredVoxels(rawViewsByLayer, opts = {}) {
  return unionVoxels(rawViewsByLayer.map((raw) => buildVoxels(raw, opts)));
}
