// THREE stage for the 3D View: renderer, scene, orbit camera, lights, ground,
// framing, resize handling and the on-demand render loop. The rebuilder adds and
// removes meshes.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { prefs } from '../state/prefs.js';

const RENDER_SCALE = 0.5; // half-resolution render, upscaled by CSS

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

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  camera.position.set(5, 4.2, 5);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.target.set(0, 0.9, 0);

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
  function frameObject(obj) {
    const box = new THREE.Box3().setFromObject(obj);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const center = sphere.center;
    const r = Math.max(sphere.radius, 0.5);
    const dist = (r / Math.sin((camera.fov * Math.PI) / 180 / 2)) * 1.25;
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(ISO_DIR, dist);
    controls.update();
  }

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
    frameObject,
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
