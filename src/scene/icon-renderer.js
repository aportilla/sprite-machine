// ---------------------------------------------------------------------------
// The desktop icon's renderer: a document's 32×32 art, made from the DOCUMENT
// ITSELF — the engine's headless entry (buildModel: slice the 3×2 atlas,
// ingest, carve, colorize, the low-poly wedge mesh with its skin) rendered
// orthographically from one pose on a small offscreen canvas, filtered down
// and inked, to a PNG data URI. The files slice asks for one per SAVE (its `makeIcon`
// dependency, wired in main.js) and caches what it gets on the document's
// record, so this runs when a document is written and never when one is
// listed or opened.
//
// THE POSE AND THE FIT are lib/icon.js's: 35° round from the front and 45°
// up, with the frame the MODEL's own projected bounding box, not the
// lattice's — a small object painted in the middle of a big tile fills its
// icon exactly as a big one does. The icon is the object, not the sheet.
//
// SMOOTH INSIDE, INKED OUTSIDE (the user's call, Sep 11 2026, over the same
// day's hard point-sampled buffer). The GL buffer is the icon SUPERSAMPLED —
// ICON_SUPERSAMPLE px per icon px, still no GL antialiasing, every sample a
// point sample of the mesh — and lib/icon.js's two pure passes make the icon
// of it: `downsample` box-filters the block into each pixel (premultiplied,
// so an edge takes its color from the model and not from the clear), then
// `inkOutline` hardens the silhouette to opaque and rings it with one black
// pixel, so the art reads as an object on any desktop pattern. The clear is
// transparent, so what the ring surrounds composites on whatever pattern is
// set, and outputColorSpace is the stage's SRGB so an icon's colors agree
// with the 3D View's.
//
// The copy out of the GL canvas is a 2D canvas's drawImage + getImageData in
// the same task as the render, and the context keeps its drawing buffer
// besides (preserveDrawingBuffer) — the atlas renderer's discipline; the
// buffer is small. The icon's own 32×32 canvas takes the finished raster and
// yields the PNG.
//
// ITS OWN SHORT-LIVED MODEL: this never touches the rebuilder's mesh. A save
// may be of a document that is not the active one — the first-ever boot seeds
// two — so the model is built here, rendered, and disposed inside the one
// call: the geometry, the material and the skin texture, since a leaked
// texture per save would climb. The GL context is made on the FIRST icon and
// kept for the session (a third one on the page, after the stage's and the
// atlas's): nothing to pay for on a boot that saves nothing. Where WebGL is
// out of reach, or the document has no painted view for a model to be built
// from, the answer is null and the Finder draws its generic document glyph.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { buildModel } from 'sprite-machine';
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

/** The one pose, resolved once (lib/icon.js). */
const DIR = ringCameraDir(ICON_YAW, ICON_ELEV);
const UP = ringCameraUp(ICON_YAW, ICON_ELEV);
const dirV = new THREE.Vector3(...DIR);
const center = new THREE.Vector3();

/** The GL buffer's edge: the icon, supersampled. */
const SAMPLED = ICON_SIZE * ICON_SUPERSAMPLE;

export function createIconRenderer() {
  /** @type {{canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer,
   *   scene: THREE.Scene, camera: THREE.OrthographicCamera,
   *   rig: ReturnType<typeof createRig>,
   *   samples: CanvasRenderingContext2D, icon: HTMLCanvasElement,
   *   art: CanvasRenderingContext2D}|null} */
  let world = null;
  let broken = false; // WebGL out of reach — don't retry on every save

  function worldNow() {
    if (world || broken) return world;
    try {
      const canvas = document.createElement('canvas');
      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: true,
        preserveDrawingBuffer: true, // the copy out reads it below
      });
      renderer.setPixelRatio(1);
      renderer.setClearColor(0x000000, 0);
      renderer.shadowMap.enabled = false;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setSize(SAMPLED, SAMPLED, false);
      const scene = new THREE.Scene();
      scene.background = null;
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
      // The two 2D canvases: the samples read out of the GL buffer, and the
      // icon the finished raster is written to.
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
      // Named on the console: a desktop of generic glyphs is otherwise a
      // silent mystery.
      console.warn('sprite-machine: no WebGL for the document icons —', err);
      broken = true;
    }
    return world;
  }

  /** Build, pose, render, dispose — the whole of an icon. */
  function draw(sheet, transforms) {
    if (!sheet) return null;
    let model;
    try {
      model = buildModel(sheet, { transforms });
    } catch {
      return null; // nothing painted: the generic glyph
    }
    const mesh = model.mesh;
    const w = worldNow();
    try {
      if (!w) return null;
      // The mesh is at ONE UNIT PER VOXEL and carries its own centering,
      // so its positions are already the world's.
      const fit = orthoFit(mesh.geometry.attributes.position.array, DIR, UP);
      if (!fit) return null;
      const { camera, renderer, scene, rig, canvas, samples, icon, art } = w;
      center.set(...fit.center);
      // Clear of the box along the view axis; the planes bracket its depth.
      const dist = fit.depth + 2 * fit.half + 1;
      // The frustum is the fit plus the outline's margin: the model spans
      // the icon less one pixel a side, and the ring is inked into that.
      const half = framedHalf(fit.half);
      camera.left = -half;
      camera.right = half;
      camera.top = half;
      camera.bottom = -half;
      camera.near = Math.max(0.01, dist - fit.depth);
      camera.far = dist + fit.depth;
      camera.updateProjectionMatrix();
      camera.up.set(...UP); // the TRUE up of the pose, as the ring's is
      camera.position.copy(center).addScaledVector(dirV, dist);
      camera.lookAt(center);
      camera.updateMatrixWorld();
      rig.pose(camera, center, dist);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      scene.add(mesh);
      renderer.render(scene, camera);
      // The copy out, in the same task as the render — cleared first, since
      // drawImage composites and the last icon's pixels would show through
      // this one's clear.
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
     * A document's icon art: its model at the icon pose, its visible extent
     * fitted to the icon's bounds less the outline, smoothed by the
     * supersample and ringed in black, as a 32×32 PNG data URI. Null where there
     * is no model to draw — a sheet with no painted view, or one that is not
     * a sheet — and null with no WebGL; the caller falls back to the generic
     * document glyph.
     * @param {{width: number, height: number, data: ArrayLike<number>}|null} sheet
     *   the document's atlas pixels
     * @param {Record<string, object>} [transforms]  the document's per-view
     *   reorientation (its `sprite-machine:transforms` chunk)
     * @returns {string|null}
     */
    render(sheet, transforms = {}) {
      try {
        return draw(sheet, transforms);
      } catch (err) {
        // AN ICON IS NEVER WORTH A FAILED SAVE: this runs inside files.save,
        // so anything thrown here would take the document's write down with
        // it. Named on the console, and the Finder draws its generic glyph.
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
