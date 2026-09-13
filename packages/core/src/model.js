// Headless entry: a sheet's pixels to a model, and a model to a glb.
//
// buildModel runs slice, ingest, carve, colorize, the layer union and the
// wedge mesher, and returns the mesh at one unit per voxel, so a position is a
// lattice coordinate. modelToGlb writes the same glb as the app's export, with
// the skin encoded from bytes. Both are synchronous.

import { sliceLayers, validateSheet } from './atlas.js';
import { buildLayeredVoxels } from './pipeline.js';
import { wedgeMesh } from './wedge-mesh.js';
import { encodePng } from './png-encode.js';
import { glbFromModel } from './gltf.js';
import { VIEW_NAMES } from './views.js';

/**
 * A built model: the mesh, the lattice dims and the mesh's units per voxel
 * (1 from buildModel).
 * @typedef {{
 *   mesh: import('three').Mesh,
 *   dims: {nx:number, ny:number, nz:number},
 *   unitsPerVoxel: number,
 *   triangles: number,
 *   warnings: string[],
 * }} Model
 */

/**
 * Build the model of a sprite sheet: one 3×2 block of tiles, or `layers` blocks
 * stacked top to bottom, whose hulls are unioned (unionVoxels).
 * @param {{width:number, height:number, data:ArrayLike<number>}} sheet
 *   the atlas's RGBA pixels, ImageData-shaped
 * @param {{transforms?: Record<string, {rot?:number, flipX?:boolean, flipY?:boolean}>,
 *          layers?: number}} [opts]
 *   `transforms`: per-view reorientation, as stored in the
 *   `sprite-machine:transforms` chunk, applied in every layer; `layers`: the
 *   sheet's block count
 * @returns {Model}  the mesh at one unit per voxel
 * @throws on an invalid sheet, or one with no painted view in any layer
 */
export function buildModel(sheet, { transforms = {}, layers = 1 } = {}) {
  const bad = validateSheet(sheet);
  if (bad) throw new Error(`buildModel: ${bad}`);
  const sliced = sliceLayers(sheet, { layers });
  const result = buildLayeredVoxels(
    sliced.layers.map((views) =>
      Object.fromEntries(VIEW_NAMES.map((n) => [n, views[n] || null]))
    ),
    { transforms }
  );
  if (result.providedViews.length === 0) {
    throw new Error('buildModel: the sheet has no painted view.');
  }
  const { nx, ny, nz } = result.dims;
  const mesh = wedgeMesh(result, { worldSize: Math.max(nx, ny, nz) });
  return {
    mesh,
    dims: result.dims,
    unitsPerVoxel: 1,
    triangles: Number(mesh.userData.triangles) || 0,
    warnings: [...sliced.warnings, ...(result.warnings || [])],
  };
}

/**
 * The model as a glb, with its skin embedded behind a nearest sampler, or its
 * flat color when the material has no map.
 * @param {{mesh: import('three').Mesh, dims: {nx:number, ny:number, nz:number}, unitsPerVoxel?: number}} model
 * @param {{name: string, voxelsPerMeter?: number, unlit?: boolean, generator?: string}} opts
 *   `voxelsPerMeter` sets the scale (at 10, a 40-voxel car is 4 m long);
 *   `unlit` adds KHR_materials_unlit; `generator` is written to the asset
 * @returns {Uint8Array}  the .glb file
 */
export function modelToGlb(
  model,
  { name, voxelsPerMeter = 10, unlit = false, generator }
) {
  const { mesh, dims } = model;
  const unitsPerVoxel = model.unitsPerVoxel ?? 1;
  const geo = mesh.geometry;
  const material = /** @type {import('three').MeshStandardMaterial} */ (mesh.material);
  const map = material.map;
  return glbFromModel({
    name,
    position: geo.attributes.position.array,
    normal: geo.attributes.normal.array,
    uv: geo.attributes.uv.array,
    index: geo.index.array,
    scale: 1 / (unitsPerVoxel * voxelsPerMeter),
    image: map ? { bytes: encodePng(map.image) } : null,
    color: map ? null : material.color.toArray(),
    unlit,
    generator,
    extras: { 'sprite-machine': { voxelsPerMeter, dims: { ...dims } } },
  });
}
