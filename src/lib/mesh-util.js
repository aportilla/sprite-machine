// ---------------------------------------------------------------------------
// Shared helpers for the vertex-colored wedge mesh builder (wedge-mesh.js):
// the color-space contract and the framing + material constants live in
// exactly one place. (The plain voxel builder that once shared them, mesh.js,
// went with the test trim of Sep 5 2026 — dead code with no consumer.)
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { unpackRGBA } from './ingest.js';

/**
 * A memoized packed-RGBA (sRGB bytes) -> linear [r,g,b] converter for vertex
 * colors. One THREE.Color is reused; results are cached by packed key.
 * @returns {(packed:number) => [number,number,number]}
 */
export function makeVertexColorLinearizer() {
  const cache = new Map();
  const tmp = new THREE.Color();
  return (packed) => {
    const key = packed >>> 0;
    let c = cache.get(key);
    if (!c) {
      const { r, g, b } = unpackRGBA(key);
      tmp.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
      c = [tmp.r, tmp.g, tmp.b];
      cache.set(key, c);
    }
    return c;
  };
}

/**
 * Shared final assembly for the vertex-colored builders: center the geometry on
 * X/Z, leave Y exactly as authored (no ground-rest — the Y translate is a hard 0;
 * where the object sits vertically is wherever the artist painted it, see
 * carve.js), compute bounds, and wrap it in the standard flat-shaded vertex-color
 * material with shadows on.
 * @param {THREE.BufferGeometry} geo
 * @param {{nx:number, nz:number, s:number, userData?:Record<string,unknown>}} opts
 * @returns {THREE.Mesh}
 */
export function finishVoxelMesh(geo, { nx, nz, s, userData = {} }) {
  geo.translate((-nx * s) / 2, 0, (-nz * s) / 2); // center X/Z; Y left as authored
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
  Object.assign(mesh.userData, userData);
  return mesh;
}
