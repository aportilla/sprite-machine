// ---------------------------------------------------------------------------
// Mesh: turn a buildVoxels() result into a single THREE.Mesh.
//
// Faces come from faces.js (pure): greedy-merged coplanar same-color quads by
// default, so a flat wall is one rectangle instead of one quad per texel. We
// build ONE BufferGeometry (position/normal/color + index) with per-face vertex
// colors and MeshStandardMaterial({ vertexColors, flatShading }). Per-face color
// is why we merge geometry rather than InstancedMesh cubes (which allow only one
// color per voxel). One mesh = one draw call, real blocky shadows, exportable.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { faceQuads } from './faces.js';
import { makeVertexColorLinearizer, finishVoxelMesh } from './mesh-util.js';
import { DEFAULT_WORLD_SIZE } from './constants.js';

/**
 * @param {ReturnType<import('./pipeline.js').buildVoxels>} result
 * @param {{ worldSize?: number, greedy?: boolean }} [opts]
 * @returns {THREE.Mesh}
 */
export function voxelMesh(result, opts = {}) {
  const { dims, surfaceMask, faceColor } = result;
  const worldSize = opts.worldSize ?? DEFAULT_WORLD_SIZE;
  const greedy = opts.greedy ?? true;
  const s = worldSize / Math.max(dims.nx, dims.ny, dims.nz);

  const quads = faceQuads(dims, surfaceMask, faceColor, greedy);

  const positions = new Float32Array(quads.length * 12);
  const normals = new Float32Array(quads.length * 12);
  const colors = new Float32Array(quads.length * 12);
  const indices = new Uint32Array(quads.length * 6);

  const toLinear = makeVertexColorLinearizer();

  for (let q = 0; q < quads.length; q++) {
    const { normal, color, corners } = quads[q];
    const [lr, lg, lb] = toLinear(color >>> 0);
    const vBase = q * 4;
    for (let k = 0; k < 4; k++) {
      const o = (vBase + k) * 3;
      positions[o] = corners[k][0] * s;
      positions[o + 1] = corners[k][1] * s;
      positions[o + 2] = corners[k][2] * s;
      // Normals feed computeDiag + glTF export; flatShading recomputes per-face
      // normals in the shader, so this attribute doesn't drive lighting.
      normals[o] = normal[0];
      normals[o + 1] = normal[1];
      normals[o + 2] = normal[2];
      colors[o] = lr;
      colors[o + 1] = lg;
      colors[o + 2] = lb;
    }
    const iBase = q * 6;
    indices[iBase] = vBase;
    indices[iBase + 1] = vBase + 1;
    indices[iBase + 2] = vBase + 2;
    indices[iBase + 3] = vBase;
    indices[iBase + 4] = vBase + 2;
    indices[iBase + 5] = vBase + 3;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));

  return finishVoxelMesh(geo, {
    nx: dims.nx,
    nz: dims.nz,
    s,
    userData: { triangles: quads.length * 2, quads: quads.length },
  });
}
