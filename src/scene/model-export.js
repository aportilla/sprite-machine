// ---------------------------------------------------------------------------
// The 3D model export's SUBJECT: the rebuilder's current mesh, held through
// the onMesh seam (main.js fans the seam out to the 3D Sprite Atlas's
// follower and to this), and the glb made from it on demand (File → Export
// 3D Model…, shell/menus.js). Nothing here runs the pipeline or renders:
// the mesh's own buffers ARE the export — its welded positions, per-face
// normals and UVs, its index, and the skin's bytes off the material's map
// (a DataTexture keeps its array), encoded as a PNG from those bytes and
// never through a canvas (lib/png-encode.js). The writer is lib/gltf.js.
//
// The scale: the stage's world units are DEFAULT_WORLD_SIZE over the
// lattice's longest side (wedge-mesh.js), so a position over that unit is
// voxels, and voxels over the dialog's voxels-per-meter is glTF's meters.
// The origin needs no work — the mesh is centered on X and Z with Y as
// authored, so it sits at the lattice floor's center, the atlas export's
// anchor: a model and its sprite sheet share an origin.
// ---------------------------------------------------------------------------

import { DEFAULT_WORLD_SIZE } from '../lib/constants.js';
import { encodePng } from '../lib/png-encode.js';
import { glbFromModel } from '../lib/gltf.js';

/** @typedef {{mesh: import('three').Mesh, dims: {nx:number, ny:number, nz:number}}} Subject */

export function initModelExport() {
  /** @type {Subject|null} */
  let subject = null;
  const unitsPerVoxel = (dims) =>
    DEFAULT_WORLD_SIZE / Math.max(dims.nx, dims.ny, dims.nz);

  return {
    /** The rebuilder's onMesh: the new mesh, or null before the old one's dispose. */
    setSubject(sub) {
      subject = /** @type {Subject|null} */ (sub);
    },
    /**
     * The dialog's readout: the triangle count, the skin's size, and the
     * model's extent — its bounding box, in voxels — or null with no model.
     * @returns {{triangles:number, skin:{width:number,height:number}|null, extent:number[]|null}|null}
     */
    stats() {
      if (!subject) return null;
      const { mesh, dims } = subject;
      const s = unitsPerVoxel(dims);
      const bb = mesh.geometry.boundingBox;
      return {
        triangles: Number(mesh.userData.triangles) || 0,
        skin: /** @type {any} */ (mesh.userData.skin) ?? null,
        extent: bb
          ? [
              (bb.max.x - bb.min.x) / s,
              (bb.max.y - bb.min.y) / s,
              (bb.max.z - bb.min.z) / s,
            ]
          : null,
      };
    },
    /**
     * The model as a glb: the mesh's buffers at the given scale, its skin
     * embedded (or, with no map — flat mode — the material's color).
     * @param {{name:string, voxelsPerMeter:number, unlit:boolean, generator:string}} opts
     * @returns {Uint8Array|null}  null with no model
     */
    exportGlb({ name, voxelsPerMeter, unlit, generator }) {
      if (!subject) return null;
      const { mesh, dims } = subject;
      const geo = mesh.geometry;
      const material = /** @type {import('three').MeshStandardMaterial} */ (
        mesh.material
      );
      const map = material.map;
      return glbFromModel({
        name,
        position: geo.attributes.position.array,
        normal: geo.attributes.normal.array,
        uv: geo.attributes.uv.array,
        index: geo.index.array,
        scale: 1 / (unitsPerVoxel(dims) * voxelsPerMeter),
        image: map ? { bytes: encodePng(map.image) } : null,
        color: map ? null : material.color.toArray(),
        unlit,
        generator,
        extras: { 'sprite-machine': { voxelsPerMeter, dims: { ...dims } } },
      });
    },
    /** HMR teardown. */
    dispose() {
      subject = null;
    },
  };
}
