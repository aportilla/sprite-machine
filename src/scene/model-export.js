// 3D model export. Holds the rebuilder's current model (set through onMesh) and
// encodes it as glb with the engine's modelToGlb for File → Export 3D Model….
//
// World units are DEFAULT_WORLD_SIZE over the lattice's longest side, so a
// position divided by unitsPerVoxel is in voxels. The model is centered on X
// and Z with Y as authored, so its origin is the lattice floor's center, the
// same anchor as the sprite atlas export.

import { DEFAULT_WORLD_SIZE, modelToGlb } from 'sprite-machine';

/**
 * @typedef {{model: ReturnType<typeof import('sprite-machine').wedgeMesh>,
 *            dims: {nx:number, ny:number, nz:number}}} Subject
 */

export function initModelExport() {
  /** @type {Subject|null} */
  let subject = null;
  const unitsPerVoxel = (dims) =>
    DEFAULT_WORLD_SIZE / Math.max(dims.nx, dims.ny, dims.nz);

  return {
    /** onMesh target: the new model, or null before the old mesh is disposed. */
    setSubject(sub) {
      subject = /** @type {Subject|null} */ (sub);
    },
    /**
     * The export dialog's readout: triangle count, skin size and bounding-box
     * extent in voxels. Null with no model.
     * @returns {{triangles:number, skin:{width:number,height:number}|null, extent:number[]}|null}
     */
    stats() {
      if (!subject) return null;
      const { model, dims } = subject;
      const s = unitsPerVoxel(dims);
      const { min, max } = model.geometry.bounds;
      return {
        triangles: model.triangles,
        skin: model.skin ? { width: model.skin.width, height: model.skin.height } : null,
        extent: [0, 1, 2].map((k) => (max[k] - min[k]) / s),
      };
    },
    /**
     * The model as glb bytes. Embeds the skin texture, or the flat color in
     * flat mode.
     * @param {{name:string, voxelsPerMeter:number, unlit:boolean, generator:string}} opts
     * @returns {Uint8Array|null}  null with no model
     */
    exportGlb({ name, voxelsPerMeter, unlit, generator }) {
      if (!subject) return null;
      const { model, dims } = subject;
      return modelToGlb(
        { ...model, dims, unitsPerVoxel: unitsPerVoxel(dims) },
        { name, voxelsPerMeter, unlit, generator }
      );
    },
    /** HMR teardown. */
    dispose() {
      subject = null;
    },
  };
}
