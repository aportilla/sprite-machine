import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildVoxels } from './lib/pipeline.js';
import { voxelMesh } from './lib/mesh.js';
import { wedgeMesh } from './lib/wedge-mesh.js';
import { texturedBoxMesh } from './lib/textured-box.js';
import { SAMPLES } from './lib/sprite-data.js';
import { sliceAtlas } from './lib/atlas.js';
import { VIEW_NAMES } from './lib/views.js';
import { urlToImageData } from './image-io.js';
import { createUI } from './ui.js';
import { DEFAULT_MIRROR, DEFAULT_ALPHA_THRESHOLD } from './lib/constants.js';

// --------------------------------------------------------------------------
// Scene
// --------------------------------------------------------------------------
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('viewport'));
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x4a4a52);

const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
camera.position.set(5, 4.2, 5);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0.9, 0);

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

// --------------------------------------------------------------------------
// State + rebuild
// --------------------------------------------------------------------------
const state = {
  views: {}, // name -> ImageData | null
  mirror: { ...DEFAULT_MIRROR },
  alphaThreshold: DEFAULT_ALPHA_THRESHOLD,
  anyAlpha: false,
  mode: 'voxel', // 'voxel' | 'box'
  greedy: true, // merge coplanar same-color faces
  lowpoly: false, // additive 45° wedges over same-color staircases
  transforms: {}, // per-view reorientation (rot/flip)
  autoRotate: true,
  atlasImage: null, // the current sprite sheet (ImageData)
  tileW: null, // null = auto-derive from image + layout
  tileH: null,
  atlasWarnings: [],
};

let current = null; // THREE.Object3D in the scene
let frameNext = true; // reframe camera on next build (sample/mode change)

// Parse the query string once — these flags never change at runtime.
const params = new URLSearchParams(location.search);
const FLAT = params.get('flat') === '1';
const DIAG = params.get('diag') === '1';
const RENDER_SCALE = 0.5; // low-res render, crisply upscaled by CSS

const camParam = params.get('cam');
const ISO_DIR = new THREE.Vector3(
  ...(camParam === 'top' ? [0.001, 1, 0.001] : camParam === 'front' ? [0, 0.2, 1] : camParam === 'fq' ? [0.7, 0.35, 1] : camParam === 'bq' ? [0.7, 0.35, -1] : [1, 0.8, 1])
).normalize();
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

function rebuild() {
  const opts = {
    mirror: state.mirror,
    alphaThreshold: state.alphaThreshold,
    anyAlpha: state.anyAlpha,
    transforms: state.transforms,
  };
  const provided = VIEW_NAMES.filter((n) => state.views[n]);

  if (current) {
    scene.remove(current);
    current.traverse?.((o) => {
      o.geometry?.dispose?.();
      // Dispose materials AND their textures: Material.dispose() does NOT free
      // .map, so box-mode CanvasTextures would leak on every rebuild otherwise.
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        m.map?.dispose?.();
        m.dispose?.();
      }
    });
    current = null;
  }

  let stats = { provided, dims: null, voxels: 0, triangles: 0, warnings: [] };
  if (provided.length === 0) {
    ui.setStats(stats);
    return;
  }

  /** @type {Record<string, ImageData|null>} */
  const rawViews = {};
  for (const n of VIEW_NAMES) rawViews[n] = state.views[n] || null;

  if (state.mode === 'box') {
    current = texturedBoxMesh(rawViews, opts);
    stats.triangles = current.userData.triangles;
    stats.warnings =
      provided.length < 2 ? ['Box mode: fewer than 2 views — depth is a guess.'] : [];
  } else {
    const result = buildVoxels(rawViews, opts);
    current = state.lowpoly
      ? wedgeMesh(result, { flat: FLAT })
      : voxelMesh(result, { greedy: state.greedy });
    stats = {
      provided,
      dims: result.dims,
      voxels: result.solidCount,
      triangles: current.userData.triangles,
      warnings: result.warnings,
    };
  }
  stats.warnings = [...state.atlasWarnings, ...(stats.warnings || [])];
  if (DIAG && current?.geometry) {
    const geo = current.geometry; // captured: current may change before load resolves
    import('./lib/diag.js').then(({ computeDiag }) => {
      document.title = 'DIAG ' + JSON.stringify(computeDiag(geo));
    });
  }
  scene.add(current);
  if (frameNext) {
    frameObject(current);
    frameNext = false;
  }
  ui.setStats(stats);
}

// Slice the current atlas into face views (with the current tile size) and build.
function sliceAndBuild(reframe) {
  if (!state.atlasImage) return;
  const sliced = sliceAtlas(state.atlasImage, {
    tileW: state.tileW,
    tileH: state.tileH,
  });
  state.views = sliced.views;
  state.atlasWarnings = sliced.warnings;
  if (reframe) frameNext = true;
  ui.setAtlasPreview(state.atlasImage);
  ui.setAtlasInfo(sliced);
  ui.setThumbnails(sliced.views);
  rebuild();
}

// --------------------------------------------------------------------------
// UI wiring
// --------------------------------------------------------------------------
const ui = createUI({
  samples: SAMPLES,
  state,
  onSample: async (sample) => {
    try {
      state.atlasImage = sample.atlas.image ?? (await urlToImageData(sample.atlas.url));
    } catch (err) {
      ui.setError(`Couldn't load sample "${sample.name}": ${err.message}`);
      return;
    }
    state.tileW = null;
    state.tileH = null;
    state.transforms = { ...(sample.transforms || {}) };
    if (sample.mirror) state.mirror = { ...state.mirror, ...sample.mirror };
    ui.syncControls();
    sliceAndBuild(true);
  },
  onAtlas: (imageData) => {
    state.atlasImage = imageData;
    state.tileW = null;
    state.tileH = null;
    state.transforms = {};
    sliceAndBuild(true);
  },
  onTileSize: (w, h) => {
    state.tileW = w;
    state.tileH = h;
    sliceAndBuild(false);
  },
  onOptionChange: () => rebuild(),
});

// --------------------------------------------------------------------------
// Render loop
// --------------------------------------------------------------------------
function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const rw = Math.max(1, Math.floor(w * RENDER_SCALE));
  const rh = Math.max(1, Math.floor(h * RENDER_SCALE));
  if (canvas.width !== rw || canvas.height !== rh) {
    renderer.setSize(rw, rh, false);
  }
  // Track CSS aspect independently of the (rounded) render-buffer size so an
  // odd one-pixel resize can't leave the projection matrix stale.
  const aspect = w / h;
  if (camera.aspect !== aspect) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
}
window.addEventListener('resize', resize);

function tick() {
  if (state.autoRotate && current) current.rotation.y += 0.006;
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

// Boot with a sample (?sample=<index|name> overrides, handy for testing).
if (params.get('mode') === 'box') state.mode = 'box';
if (params.get('lowpoly') === '1') state.lowpoly = true;
if (params.get('rotate') === '0') state.autoRotate = false;
const q = params.get('sample');
let startIndex = 0;
if (q != null) {
  const byName = SAMPLES.findIndex((s) => s.name.toLowerCase() === q.toLowerCase());
  startIndex = byName >= 0 ? byName : Math.min(SAMPLES.length - 1, Math.max(0, +q || 0));
}
ui.selectSample(startIndex);
resize();
tick();
