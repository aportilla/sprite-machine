// Mesh helpers for wedge-mesh.js: the skin as a THREE texture, and the final
// framing and material.

import * as THREE from 'three';
import { unpackRGBA } from './ingest.js';

/**
 * The skin as a DataTexture. The class defaults match the bake: nearest
 * filtering, no mipmaps, and flipY false so texel row 0 is v = 0. The bytes
 * are sRGB.
 * @param {import('./skin.js').Skin} skin
 * @returns {THREE.DataTexture}
 */
export function skinTexture(skin) {
  const tex = new THREE.DataTexture(skin.data, skin.width, skin.height, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Final assembly: center the geometry on X and Z, leave Y as authored (see
 * carve.js), compute bounds, and wrap it in a flat-shaded material with
 * shadows on. The material takes the skin as `map`, or with no map a packed
 * sRGB `color`.
 * @param {THREE.BufferGeometry} geo
 * @param {{nx:number, nz:number, s:number, map?:THREE.Texture|null, color?:number|null,
 *          userData?:Record<string,unknown>}} opts
 * @returns {THREE.Mesh}
 */
export function finishVoxelMesh(
  geo,
  { nx, nz, s, map = null, color = null, userData = {} }
) {
  geo.translate((-nx * s) / 2, 0, (-nz * s) / 2);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    flatShading: true,
    metalness: 0,
    roughness: 1,
    ...(map ? { map } : {}),
  });
  if (!map && color != null) {
    const { r, g, b } = unpackRGBA(color);
    mat.color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  Object.assign(mesh.userData, userData);
  return mesh;
}
