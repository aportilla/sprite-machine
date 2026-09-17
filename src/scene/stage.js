// THREE stage for the 3D View: renderer, scene, orbit camera, lights, ground,
// framing, resize handling and the on-demand render loop. The rebuilder adds and
// removes meshes. The camera frames the model's bounds, or the lattice box, the
// full tile volume, when it is given none. A frame asked for while the canvas
// has no size waits until it has one.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEFAULT_WORLD_SIZE } from 'sprite-machine';
import { prefs } from '../state/prefs.js';

const RENDER_SCALE = 0.5; // half-resolution render, upscaled by CSS
const FAR = 100; // the camera's far plane, unless a fit needs it farther
const FRAME_INSET = 0.05; // the framed box's least gap to an edge, over the frame's size

/** @typedef {{min: number[], max: number[]}} Box  [x, y, z] in world units */

// A box's corners, as 0 for its min and 1 for its max on each axis.
const BOX_CORNERS = [0, 1].flatMap((x) =>
  [0, 1].flatMap((y) => [0, 1].map((z) => [x, y, z]))
);

// Camera direction presets for the ?cam= dev flag (default: three-quarter iso).
const CAM_DIRS = {
  top: [0.001, 1, 0.001],
  front: [0, 0.2, 1],
  fq: [0.7, 0.35, 1],
  bq: [0.7, 0.35, -1],
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{cam?: string|null}} [opts]  camera preset name (?cam= dev flag)
 */
export function createStage(canvas, { cam = null } = {}) {
  // Transparent clear. The model and the ground's ShadowMaterial composite over
  // the pattern behind the canvas (#stage-well in apps/sprite-editor/windows.html).
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, FAR);
  camera.position.set(5, 4.2, 5);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);

  // Render on demand: the 2048² PCF shadow map is too costly to redraw every
  // frame while idle. OrbitControls emits 'change' through drags and damping.
  let needsRender = true;
  const requestRender = () => {
    needsRender = true;
  };
  controls.addEventListener('change', requestRender);

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(4, 8, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 40;
  const sc = 6;
  Object.assign(key.shadow.camera, { left: -sc, right: sc, top: sc, bottom: -sc });
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xcfd6ff, 0.35);
  fill.position.set(-5, 3, -4);
  scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.ShadowMaterial({ opacity: 0.32 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const ISO_DIR = new THREE.Vector3(...(CAM_DIRS[cam] || [1, 0.8, 1])).normalize();
  /**
   * The box where the mesher puts the lattice of `dims`: DEFAULT_WORLD_SIZE
   * over the longest axis, X and Z centered, Y from 0.
   * @param {{nx: number, ny: number, nz: number}} dims
   * @returns {Box}
   */
  function latticeBox({ nx, ny, nz }) {
    const s = DEFAULT_WORLD_SIZE / Math.max(nx, ny, nz);
    return {
      min: [(-nx * s) / 2, 0, (-nz * s) / 2],
      max: [(nx * s) / 2, ny * s, (nz * s) / 2],
    };
  }

  /** Fit the camera to `box`. Reads the camera's aspect. @param {Box} box */
  function fitBox(box) {
    const lo = new THREE.Vector3(...box.min);
    const size = new THREE.Vector3(...box.max).sub(lo);
    const r = size.length() / 2; // the box's bounding sphere radius
    // The narrower of the vertical and horizontal half-angles, so a tall view
    // keeps the box's sides.
    const halfFov = (camera.fov * Math.PI) / 360;
    const half = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect));
    const dist = (r / Math.sin(half)) * 1.25; // camera to the box's center
    // Orbit around the middle of the box's floor, and hold the camera's depth
    // to the box's center at `dist` so the box keeps its size on screen.
    controls.target.set(lo.x + size.x / 2, lo.y, lo.z + size.z / 2);
    camera.position
      .copy(controls.target)
      .addScaledVector(ISO_DIR, dist + ISO_DIR.y * (size.y / 2));
    // The box's center rides above the view axis now that the axis meets the
    // floor. A lens shift, in fractions of the frame so a resize keeps it, puts
    // the center back in the picture's middle. setViewOffset writes
    // camera.aspect from the full size, so the full size carries the aspect.
    const rise = (size.y / 2) * Math.sqrt(1 - ISO_DIR.y ** 2);
    const shift = -rise / (2 * dist * Math.tan(halfFov));
    camera.setViewOffset(camera.aspect, 1, 0, shift, camera.aspect, 1);
    // Then dolly in as the scroll wheel does, toward the target with the shift
    // held, to the nearest distance that keeps every corner of the box inside
    // the inset frame. A dolly changes a corner's depth alone, and the shift
    // moves its NDC y by 2 * shift.
    camera.lookAt(controls.target);
    camera.updateMatrixWorld();
    const fitDist = camera.position.distanceTo(controls.target);
    const tanY = Math.tan(halfFov);
    const tanX = tanY * camera.aspect;
    const edge = 1 - 2 * FRAME_INSET; // in NDC
    const p = new THREE.Vector3();
    let snug = 0;
    for (const [x, y, z] of BOX_CORNERS) {
      p.set(x, y, z).multiply(size).add(lo).applyMatrix4(camera.matrixWorldInverse);
      const depth = Math.max(
        camera.near,
        Math.abs(p.x) / (edge * tanX),
        p.y / ((edge - 2 * shift) * tanY),
        -p.y / ((edge + 2 * shift) * tanY)
      );
      snug = Math.max(snug, fitDist + p.z + depth); // p.z is minus the depth at fitDist
    }
    camera.position.sub(controls.target).setLength(snug).add(controls.target);
    camera.far = Math.max(FAR, 2 * (snug + r));
    camera.updateProjectionMatrix();
    controls.update();
  }

  /** @type {Box|null} a box waiting for a canvas size */
  let pendingFrame = null;

  // The mesh auto-rotate spins, or null.
  let spinTarget = null;

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const rw = Math.max(1, Math.floor(w * RENDER_SCALE));
    const rh = Math.max(1, Math.floor(h * RENDER_SCALE));
    let changed = false;
    if (canvas.width !== rw || canvas.height !== rh) {
      renderer.setSize(rw, rh, false);
      changed = true;
    }
    // Compare the CSS aspect, not the rounded buffer size, so a one-pixel
    // resize still updates the projection.
    const aspect = w / h;
    if (camera.aspect !== aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      changed = true;
    }
    if (pendingFrame && w > 0 && h > 0) {
      fitBox(pendingFrame);
      pendingFrame = null;
      changed = true;
    }
    if (changed) requestRender();
  }
  window.addEventListener('resize', resize);
  // The canvas can change size without a window resize event.
  const resizeObs =
    typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  resizeObs?.observe(canvas);

  let rafId = 0;
  function tick() {
    if (prefs.get().autoRotate && spinTarget) {
      spinTarget.rotation.y += 0.006;
      needsRender = true;
    }
    controls.update(); // advances damping. Emits 'change' while moving.
    if (needsRender) {
      renderer.render(scene, camera);
      needsRender = false;
    }
    rafId = requestAnimationFrame(tick);
  }
  resize();
  tick();

  return {
    scene,
    /**
     * Frame `bounds`, or the lattice box of `dims` without them, now or once the
     * canvas has a size.
     * @param {{nx: number, ny: number, nz: number}} dims
     * @param {Box|null} [bounds]
     */
    frame(dims, bounds = null) {
      pendingFrame = bounds ?? latticeBox(dims);
      resize();
    },
    requestRender,
    /** @param {THREE.Object3D|null} obj */
    setSpinTarget(obj) {
      spinTarget = obj;
    },
    // HMR teardown.
    dispose() {
      window.removeEventListener('resize', resize);
      resizeObs?.disconnect();
      controls.removeEventListener('change', requestRender);
      cancelAnimationFrame(rafId);
    },
  };
}
