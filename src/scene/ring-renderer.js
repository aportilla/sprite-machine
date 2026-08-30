// ---------------------------------------------------------------------------
// The 3D Sprite Atlas's renderer: its own THREE world on an OFFSCREEN canvas
// that never enters the DOM, rendering the rebuilder's mesh orthographically
// from a ring of yaws into one SHEET canvas — `views` square frames side by
// side — that is both the windoid's picture and the export's file (the
// strip's cells are drawImage slices of it; Export encodes it). Knows
// nothing about stores or documents: scene/ring.js (the follower) feeds it
// the subject and asks for renders; lib/ring.js is the geometry.
//
// THE SUBJECT is a clone of the mesh the rebuilder put on the stage —
// mesh.clone() shares geometry + material (the rebuilder's dispose() on a
// rebuild releases THIS renderer's GPU copy too, through THREE's dispose
// event; the follower drops the clone before the dispose) — with its
// rotation reset (the stage's auto-rotate never leaks in) and shadows off
// (no ground plane, no shadow in a sprite: the ground is the 3D View's
// furniture). Two GL contexts on the page, the stage's and this one — fine.
//
// THE FRAME is lib/ring.js's: a square of F px holding the whole lattice's
// envelope at every yaw, `scale` px per voxel exactly (the orthographic
// half-extent is F / (2·scale) voxel units), the camera looking at the
// lattice center from `dist` out along the pose's direction with the pose's
// TRUE up vector (e = 90, straight down, is well defined). No antialiasing
// and no smoothing in the copy chain: a 1-px-per-voxel sprite is pixel art
// at the source's own resolution. The clear is transparent (alpha: true) —
// the frame's margin is paper in the windoid and transparency in the file —
// and outputColorSpace is the stage's SRGB, so the sprites' colors agree
// with the 3D View's.
//
// THE LIGHTS RIDE WITH THE CAMERA: in an engine the camera and the sun are
// fixed and the OBJECT turns, so the light's direction relative to the
// camera is constant across the ring. Rendering that with a camera that
// orbits means the rig orbits with it — the stage's ambient + key + fill,
// each directional light re-posed per yaw at a FIXED offset in the camera's
// own frame (right / up / back), expressed from the stage's world rig as
// seen from its default three-quarter framing and tuned by eye so the
// front view at 45° reads like the 3D View. World-fixed lights would shade
// each facing differently.
//
// The copy out of the GL canvas (sheet.drawImage) runs in the same task as
// the renders, and the context keeps its drawing buffer besides
// (preserveDrawingBuffer) — an offscreen canvas is never composited, so
// nothing is left to the browser's clear timing. The buffer is small.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { DEFAULT_WORLD_SIZE } from '../lib/constants.js';
import {
  ringYaws,
  ringFrame,
  ringSheet,
  ringCameraDir,
  ringCameraUp,
  ringCenter,
} from '../lib/ring.js';

// The rig, in the CAMERA's frame (x right, y up, z back toward the camera),
// as unit directions from the subject: the key above and a little to the
// right, mostly from the camera's side (the stage's key at (4, 8, 3) seen
// from its default framing — the top faces brightest, the front lit, the
// far flank in the ambient); the fill from above-behind the subject, a rim
// off the top edges (the stage's (−5, 3, −4) in the same frame).
const KEY_DIR = new THREE.Vector3(0.22, 0.52, 0.83).normalize();
const FILL_DIR = new THREE.Vector3(-0.1, 0.81, -0.57).normalize();

/**
 * @typedef {{views: number, elevation: number, offset: number, scale: number}} RingSettings
 * @typedef {{canvas: HTMLCanvasElement, frame: number, views: number}} RingSheet
 */

export function createRingRenderer() {
  const gl = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({
    canvas: gl,
    antialias: false,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = null;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  scene.add(camera);
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  const fill = new THREE.DirectionalLight(0xcfd6ff, 0.35);
  scene.add(key, fill, key.target, fill.target);

  // The 2D copy — the durable pixels the windoid and the export read.
  const sheet = document.createElement('canvas');

  /** @type {{clone: THREE.Object3D, dims: {nx: number, ny: number, nz: number}}|null} */
  let subject = null;
  const center = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const offset = new THREE.Vector3();

  return {
    /**
     * Adopt the rebuilder's mesh (a shared-geometry clone) or drop the
     * current one (null) — called BEFORE the rebuilder disposes the
     * geometry the clone shares.
     * @param {{mesh: THREE.Object3D, dims: {nx: number, ny: number, nz: number}}|null} sub
     */
    setSubject(sub) {
      if (subject) {
        scene.remove(subject.clone);
        subject = null;
      }
      if (!sub) return;
      const clone = sub.mesh.clone();
      clone.rotation.set(0, 0, 0);
      clone.position.set(0, 0, 0);
      clone.traverse((o) => {
        o.castShadow = false;
        o.receiveShadow = false;
      });
      scene.add(clone);
      subject = { clone, dims: sub.dims };
    },

    /**
     * Render the whole strip now, synchronously: `views` frames of the
     * subject at `ringYaws(views, offset)`, `scale` px per voxel, at
     * `elevation` — returned as the sheet (null with no subject).
     * @param {RingSettings} settings
     * @returns {RingSheet|null}
     */
    render({ views, elevation, offset: first, scale }) {
      if (!subject) return null;
      const { dims } = subject;
      const n = Math.max(1, Math.floor(views));
      // World units per voxel — the exact expression voxelMesh / wedgeMesh
      // scale by (their default worldSize; thread it here if it ever moves).
      const s = DEFAULT_WORLD_SIZE / Math.max(dims.nx, dims.ny, dims.nz);
      const { px: F, half } = ringFrame(dims, elevation, scale);
      const { width, height } = ringSheet(n, F);
      if (gl.width !== width || gl.height !== height)
        renderer.setSize(width, height, false);

      center.set(...ringCenter(dims)).multiplyScalar(s);
      // Anything clear of the box — orthographic, so the distance only has
      // to keep the near plane in front of it.
      const dist = 2 * Math.hypot(dims.nx, dims.ny, dims.nz) * s;
      camera.left = -half * s;
      camera.right = half * s;
      camera.top = half * s;
      camera.bottom = -half * s;
      camera.near = 0.1;
      camera.far = 3 * dist;
      camera.updateProjectionMatrix(); // the same frustum for every yaw
      key.target.position.copy(center);
      fill.target.position.copy(center);

      const yaws = ringYaws(n, first);
      renderer.setScissorTest(true);
      for (let i = 0; i < n; i++) {
        const yaw = yaws[i];
        camera.up.set(...ringCameraUp(yaw, elevation));
        dir.set(...ringCameraDir(yaw, elevation));
        camera.position.copy(center).addScaledVector(dir, dist);
        camera.lookAt(center);
        camera.updateMatrixWorld();
        // The rig re-posed in this pose's camera frame (decision: the
        // lights ride with the camera).
        key.position
          .copy(
            offset.copy(KEY_DIR).multiplyScalar(dist).applyQuaternion(camera.quaternion)
          )
          .add(center);
        fill.position
          .copy(
            offset.copy(FILL_DIR).multiplyScalar(dist).applyQuaternion(camera.quaternion)
          )
          .add(center);
        renderer.setViewport(i * F, 0, F, F);
        renderer.setScissor(i * F, 0, F, F);
        renderer.render(scene, camera);
      }
      renderer.setScissorTest(false);

      // The copy, in the same task as the renders. A size write clears the
      // 2D canvas; at an unchanged size the whole surface is redrawn anyway.
      sheet.width = width;
      sheet.height = height;
      const g = sheet.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(gl, 0, 0);
      return { canvas: sheet, frame: F, views: n };
    },

    /** HMR teardown: release the GL context. */
    dispose() {
      if (subject) scene.remove(subject.clone);
      subject = null;
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
