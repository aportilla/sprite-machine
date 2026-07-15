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
import { unpackRGBA } from './ingest.js';
import { faceQuads } from './faces.js';

/**
 * @param {ReturnType<import('./pipeline.js').buildVoxels>} result
 * @param {{ worldSize?: number, greedy?: boolean }} [opts]
 * @returns {THREE.Mesh}
 */
export function voxelMesh(result, opts = {}) {
  const { dims, surfaceMask, faceColor } = result;
  const worldSize = opts.worldSize ?? 2.5;
  const greedy = opts.greedy ?? true;
  const s = worldSize / Math.max(dims.nx, dims.ny, dims.nz);

  const quads = faceQuads(dims, surfaceMask, faceColor, greedy);

  const positions = new Float32Array(quads.length * 12);
  const normals = new Float32Array(quads.length * 12);
  const colors = new Float32Array(quads.length * 12);
  const indices = new Uint32Array(quads.length * 6);

  // Cache sRGB byte-triple -> linear THREE.Color components for vertex colors.
  const colorCache = new Map();
  const tmp = new THREE.Color();
  const toLinear = (packed) => {
    let c = colorCache.get(packed);
    if (!c) {
      const { r, g, b } = unpackRGBA(packed);
      tmp.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
      c = [tmp.r, tmp.g, tmp.b];
      colorCache.set(packed, c);
    }
    return c;
  };

  for (let q = 0; q < quads.length; q++) {
    const { normal, color, corners } = quads[q];
    const [lr, lg, lb] = toLinear(color >>> 0);
    const vBase = q * 4;
    for (let k = 0; k < 4; k++) {
      const o = (vBase + k) * 3;
      positions[o] = corners[k][0] * s;
      positions[o + 1] = corners[k][1] * s;
      positions[o + 2] = corners[k][2] * s;
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

  // Center on X/Z, rest the bottom on the ground plane (y = 0).
  geo.translate((-dims.nx * s) / 2, 0, (-dims.nz * s) / 2);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    metalness: 0,
    roughness: 1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.triangles = quads.length * 2;
  mesh.userData.quads = quads.length;
  mesh.userData.worldHeight = dims.ny * s;
  return mesh;
}
