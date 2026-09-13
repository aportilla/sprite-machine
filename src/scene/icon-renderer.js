// Desktop icon renderer. Builds a document's model with buildModel, renders it
// orthographically at the icon pose into a supersampled offscreen buffer, and
// turns the samples into a 32×32 PNG data URI with lib/icon.js downsample and
// inkOutline. The files slice calls render() on each save.
//
// Each call builds and disposes its own model, including the skin texture,
// because the saved document may not be the active one. The GL context is
// created on the first icon and kept. render() returns null without WebGL or
// without a painted view.

import * as THREE from 'three';
import { buildModel } from 'sprite-machine';
import { toMesh } from 'sprite-machine/three';
import { ringCameraDir, ringCameraUp } from '../lib/ring.js';
import {
  ICON_SIZE,
  ICON_SUPERSAMPLE,
  ICON_YAW,
  ICON_ELEV,
  orthoFit,
  framedHalf,
  downsample,
  inkOutline,
} from '../lib/icon.js';
import { createRig } from './rig.js';

const DIR = ringCameraDir(ICON_YAW, ICON_ELEV);
const UP = ringCameraUp(ICON_YAW, ICON_ELEV);
const dirV = new THREE.Vector3(...DIR);
const center = new THREE.Vector3();

/** Edge of the supersampled GL buffer, in px. */
const SAMPLED = ICON_SIZE * ICON_SUPERSAMPLE;

export function createIconRenderer() {
  /** @type {{canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer,
   *   scene: THREE.Scene, camera: THREE.OrthographicCamera,
   *   rig: ReturnType<typeof createRig>,
   *   samples: CanvasRenderingContext2D, icon: HTMLCanvasElement,
   *   art: CanvasRenderingContext2D}|null} */
  let world = null;
  let broken = false; // no WebGL. Not retried.

  function worldNow() {
    if (world || broken) return world;
    try {
      const canvas = document.createElement('canvas');
      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: true,
        preserveDrawingBuffer: true, // read back below
      });
      renderer.setPixelRatio(1);
      renderer.setClearColor(0x000000, 0);
      renderer.shadowMap.enabled = false;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setSize(SAMPLED, SAMPLED, false);
      const scene = new THREE.Scene();
      scene.background = null;
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
      // 2D canvases: the samples read from the GL buffer, and the finished icon.
      const sampled = document.createElement('canvas');
      sampled.width = SAMPLED;
      sampled.height = SAMPLED;
      const samples = sampled.getContext('2d', { willReadFrequently: true });
      const icon = document.createElement('canvas');
      icon.width = ICON_SIZE;
      icon.height = ICON_SIZE;
      const art = icon.getContext('2d');
      if (!samples || !art) throw new Error('no 2D canvas');
      world = {
        canvas,
        renderer,
        scene,
        camera,
        rig: createRig(scene),
        samples,
        icon,
        art,
      };
    } catch (err) {
      console.warn('sprite-machine: no WebGL for the document icons —', err);
      broken = true;
    }
    return world;
  }

  function draw(sheet, transforms, layers) {
    if (!sheet) return null;
    let model;
    try {
      model = buildModel(sheet, { transforms, layers });
    } catch {
      return null; // no painted view
    }
    const mesh = toMesh(model);
    const w = worldNow();
    try {
      if (!w) return null;
      // The model is one unit per voxel and already centered, so its positions
      // are world coordinates.
      const fit = orthoFit(model.geometry.position, DIR, UP);
      if (!fit) return null;
      const { camera, renderer, scene, rig, canvas, samples, icon, art } = w;
      center.set(...fit.center);
      // Camera distance clear of the box. near and far bracket its depth.
      const dist = fit.depth + 2 * fit.half + 1;
      // framedHalf leaves one pixel a side for the outline.
      const half = framedHalf(fit.half);
      camera.left = -half;
      camera.right = half;
      camera.top = half;
      camera.bottom = -half;
      camera.near = Math.max(0.01, dist - fit.depth);
      camera.far = dist + fit.depth;
      camera.updateProjectionMatrix();
      camera.up.set(...UP);
      camera.position.copy(center).addScaledVector(dirV, dist);
      camera.lookAt(center);
      camera.updateMatrixWorld();
      rig.pose(camera, center, dist);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      scene.add(mesh);
      renderer.render(scene, camera);
      // Copy out in the same task as the render. Clear first: drawImage
      // composites over the previous icon's pixels.
      samples.clearRect(0, 0, SAMPLED, SAMPLED);
      samples.drawImage(canvas, 0, 0);
      const px = samples.getImageData(0, 0, SAMPLED, SAMPLED).data;
      const raster = inkOutline(
        downsample(px, SAMPLED, SAMPLED, ICON_SUPERSAMPLE),
        ICON_SIZE,
        ICON_SIZE
      );
      art.putImageData(new ImageData(raster, ICON_SIZE, ICON_SIZE), 0, 0);
      return icon.toDataURL('image/png');
    } finally {
      w?.scene.remove(mesh);
      mesh.geometry?.dispose();
      const material = /** @type {THREE.MeshStandardMaterial} */ (mesh.material);
      material?.map?.dispose();
      material?.dispose();
    }
  }

  return {
    /**
     * A document's icon as a 32×32 PNG data URI, the model of every layer.
     * Null when the sheet has no painted view or there is no WebGL.
     * @param {{width: number, height: number, data: ArrayLike<number>}|null} sheet
     *   the document's atlas pixels
     * @param {Record<string, object>} [transforms]  per-view reorientation
     *   (the sprite-machine:transforms chunk)
     * @param {number} [layers]  the sheet's layer count
     * @returns {string|null}
     */
    render(sheet, transforms = {}, layers = 1) {
      try {
        return draw(sheet, transforms, layers);
      } catch (err) {
        // Runs inside files.save. A throw here would fail the save.
        console.warn('sprite-machine: the document icon could not be drawn —', err);
        return null;
      }
    },

    /** HMR teardown: release the GL context. */
    dispose() {
      world?.renderer.dispose();
      world?.renderer.forceContextLoss();
      world = null;
    },
  };
}
