// ---------------------------------------------------------------------------
// Textured-box FAST mode: one BoxGeometry, six per-face nearest-filtered
// cut-out textures. Instant, captures painted face detail, and casts a correct
// hard silhouette shadow (alphaTest on the depth material). It's a "box wearing
// decals" — no real depth — so it's the preview / degenerate-input fallback.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { ingestSprite } from './ingest.js';
import { reconcileDims } from './carve.js';
import {
  FACE_INDEX,
  FACE_TO_VIEW,
  FACE_OPPOSITE,
  FACE_AXIS,
  VIEW_NAMES,
} from './views.js';
import { DEFAULT_MIRROR, DEFAULT_WORLD_SIZE } from './constants.js';

function imageDataToTexture(img, mirrorX = false) {
  const src = document.createElement('canvas');
  src.width = img.width;
  src.height = img.height;
  // Atlas-sliced tiles are plain {width,height,data}; putImageData needs a real
  // ImageData, so wrap when necessary (mirrors ui.js drawPixels).
  const id =
    img instanceof ImageData
      ? img
      : new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  src.getContext('2d').putImageData(id, 0, 0);

  let canvas = src;
  if (mirrorX) {
    // Flip horizontally for mirrored opposite faces.
    canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const fg = canvas.getContext('2d');
    fg.translate(img.width, 0);
    fg.scale(-1, 1);
    fg.drawImage(src, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function faceMaterial(img, mirrorX) {
  if (!img) return new THREE.MeshStandardMaterial({ color: 0x8a86a8, roughness: 1 });
  return new THREE.MeshStandardMaterial({
    map: imageDataToTexture(img, mirrorX),
    roughness: 1,
    metalness: 0,
    transparent: false,
    alphaTest: 0.5,
  });
}

/**
 * @param {Record<string, ImageData|null>} rawViews
 * @param {{mirror?:{x:boolean,y:boolean,z:boolean}, worldSize?:number, alphaThreshold?:number, anyAlpha?:boolean}} opts
 * @returns {THREE.Mesh}
 */
export function texturedBoxMesh(rawViews, opts = {}) {
  const mirror = { ...DEFAULT_MIRROR, ...(opts.mirror || {}) };
  /** @type {Record<string, any>} */
  const cropped = {};
  for (const name of VIEW_NAMES) {
    if (rawViews[name]) cropped[name] = ingestSprite(rawViews[name], opts);
  }
  const { dims } = reconcileDims(cropped);
  const worldSize = opts.worldSize ?? DEFAULT_WORLD_SIZE;
  const s = worldSize / Math.max(dims.nx, dims.ny, dims.nz);
  const geo = new THREE.BoxGeometry(dims.nx * s, dims.ny * s, dims.nz * s);

  // Material array indexed by BoxGeometry face order: px,nx,py,ny,pz,nz.
  const mats = new Array(6);
  for (const face of Object.keys(FACE_INDEX)) {
    const view = FACE_TO_VIEW[face];
    let img = rawViews[view] || null;
    let mirroredX = false;
    if (!img && mirror[FACE_AXIS[face]]) {
      const oppView = FACE_TO_VIEW[FACE_OPPOSITE[face]];
      img = rawViews[oppView] || null;
      mirroredX = !!img;
    }
    mats[FACE_INDEX[face]] = faceMaterial(img, mirroredX);
  }

  const mesh = new THREE.Mesh(geo, mats);
  mesh.position.y = (dims.ny * s) / 2; // rest on ground
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.triangles = 12;
  return mesh;
}
