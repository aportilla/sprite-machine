// Three adapter (sprite-machine/three): the mesher's record as three objects.
// The only entry that imports three, an optional peer.

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
 * The geometry as an indexed BufferGeometry with its bounds computed. The
 * arrays are copied.
 * @param {import('./wedge-mesh.js').Geometry} geometry
 * @returns {THREE.BufferGeometry}
 */
export function toGeometry(geometry) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(geometry.position, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(geometry.normal, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(geometry.uv, 2));
  geo.setIndex(new THREE.Uint32BufferAttribute(geometry.index, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * The model as a flat-shaded Mesh with shadows on. The material takes the
 * skin as `map`, or with no skin the packed sRGB `color`.
 * @param {import('./wedge-mesh.js').Built} model
 * @returns {THREE.Mesh}
 */
export function toMesh(model) {
  const map = model.skin ? skinTexture(model.skin) : null;
  const mat = new THREE.MeshStandardMaterial({
    flatShading: true,
    metalness: 0,
    roughness: 1,
    ...(map ? { map } : {}),
  });
  if (!map && model.color != null) {
    const { r, g, b } = unpackRGBA(model.color);
    mat.color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  }
  const mesh = new THREE.Mesh(toGeometry(model.geometry), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
