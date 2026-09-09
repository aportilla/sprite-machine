// ---------------------------------------------------------------------------
// The headless entry: a sheet's pixels → the model → a glb. What File →
// Export 3D Model… does in the app, with no app around it — a Node script at
// a project's startup, a build step, or a three.js page that wants the mesh
// itself and no file at all.
//
// `buildModel` runs the whole chain — slice the 3×2 atlas, ingest, carve,
// colorize, the low-poly wedge mesh with its skin — and hands back the
// THREE.Mesh at ONE UNIT PER VOXEL: a position is a lattice coordinate, the
// natural unit for a model whose author painted it texel by texel (the app's
// stage scales the same mesh to its own world size; DEFAULT_WORLD_SIZE is
// that stage's business). `modelToGlb` writes it as the glb the app exports,
// so the export dialog and this path are one function: the mesh's buffers,
// the skin encoded from bytes (never a canvas), the scale from the model's
// units to glTF's meters, and the `sprite-machine` extras. Both are
// synchronous and pure; a consumer that wants them off a main thread wraps
// them in a worker or a child process.
// ---------------------------------------------------------------------------

import { sliceAtlas, validateSheet } from './atlas.js';
import { buildVoxels } from './pipeline.js';
import { wedgeMesh } from './wedge-mesh.js';
import { encodePng } from './png-encode.js';
import { glbFromModel } from './gltf.js';
import { VIEW_NAMES } from './views.js';

/**
 * A built model: the mesh, the lattice it was carved on, and the mesh's
 * units per voxel (1 from `buildModel`; the app's stage passes its own).
 * @typedef {{
 *   mesh: import('three').Mesh,
 *   dims: {nx:number, ny:number, nz:number},
 *   unitsPerVoxel: number,
 *   triangles: number,
 *   warnings: string[],
 * }} Model
 */

/**
 * Build the model of a 3×2 sprite sheet.
 * @param {{width:number, height:number, data:ArrayLike<number>}} sheet
 *   the atlas's RGBA pixels (an ImageData, or the same shape)
 * @param {{transforms?: Record<string, {rot?:number, flipX?:boolean, flipY?:boolean}>}} [opts]
 *   per-view reorientation, the document's `sprite-machine:transforms` chunk
 * @returns {Model}  the mesh at one unit per voxel
 * @throws on a sheet that is not a sheet, or one with no painted view
 */
export function buildModel(sheet, { transforms = {} } = {}) {
  const bad = validateSheet(sheet);
  if (bad) throw new Error(`buildModel: ${bad}`);
  const sliced = sliceAtlas(sheet);
  /** @type {Record<string, {width:number, height:number, data:ArrayLike<number>}|null>} */
  const rawViews = {};
  let provided = 0;
  for (const n of VIEW_NAMES) {
    rawViews[n] = sliced.views[n] || null;
    if (rawViews[n]) provided++;
  }
  if (provided === 0) throw new Error('buildModel: the sheet has no painted view.');
  const result = buildVoxels(rawViews, { transforms });
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
 * The model as a glb: its buffers at the given scale, its skin embedded (or,
 * with no map, the material's flat color) behind a NEAREST sampler.
 * @param {{mesh: import('three').Mesh, dims: {nx:number, ny:number, nz:number}, unitsPerVoxel?: number}} model
 * @param {{name: string, voxelsPerMeter?: number, unlit?: boolean, generator?: string}} opts
 *   `voxelsPerMeter` is the reader's scale (10: a 40-voxel car is 4 m long);
 *   `unlit` puts KHR_materials_unlit on the material; `generator` names the
 *   writer in the asset
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
