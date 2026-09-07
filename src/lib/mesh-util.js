// ---------------------------------------------------------------------------
// Shared helpers for the wedge mesh builder (wedge-mesh.js), and the ONE place
// THREE meets the skin: the texture the pure bake (skin.js) becomes, and the
// framing + material the builder finishes with. (The plain voxel builder that
// once shared them, mesh.js, went with the test trim of Sep 5 2026 — dead
// code with no consumer; the vertex-color linearizer went with the skin on
// Sep 7 2026 — the GPU's sampler decodes sRGB now, where the CPU used to.)
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { unpackRGBA } from './ingest.js';

/**
 * The skin as a texture. DataTexture's constructor already states the skin's
 * sampling contract — nearest filtering both ways, no mipmaps, flipY false
 * (texel row 0 is v = 0, the bake's orientation), unpackAlignment 1 — those
 * are the class's own defaults, named here as documentation, never restated
 * as a correction. The bytes are sRGB, so the texture says so and the
 * sampler decodes them on the way to the renderers' sRGB output.
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
 * Shared final assembly: center the geometry on X/Z, leave Y exactly as
 * authored (no ground-rest — the Y translate is a hard 0; where the object
 * sits vertically is wherever the artist painted it, see carve.js), compute
 * bounds, and wrap it in the standard flat-shaded material with shadows on —
 * the skin as its `map`, or, with no map (flat mode), one packed `color`
 * (sRGB bytes) as its albedo.
 * @param {THREE.BufferGeometry} geo
 * @param {{nx:number, nz:number, s:number, map?:THREE.Texture|null, color?:number|null,
 *          userData?:Record<string,unknown>}} opts
 * @returns {THREE.Mesh}
 */
export function finishVoxelMesh(
  geo,
  { nx, nz, s, map = null, color = null, userData = {} }
) {
  geo.translate((-nx * s) / 2, 0, (-nz * s) / 2); // center X/Z; Y left as authored
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
