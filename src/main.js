import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildVoxels } from './lib/pipeline.js';
import { voxelMesh } from './lib/mesh.js';
import { tileMesh } from './lib/tile-mesh.js';
import { wedgeMesh } from './lib/wedge-mesh.js';
import { texturedBoxMesh } from './lib/textured-box.js';
import { SAMPLES } from './lib/sprite-data.js';
import { sliceAtlas } from './lib/atlas.js';
import { VIEW_NAMES } from './lib/views.js';
import { urlToImageData } from './image-io.js';
import { createUI } from './ui.js';

// --------------------------------------------------------------------------
// Scene
// --------------------------------------------------------------------------
const canvas = document.getElementById('viewport');
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
  mirror: { x: true, y: false, z: false },
  alphaThreshold: 128,
  anyAlpha: false,
  mode: 'voxel', // 'voxel' | 'box'
  greedy: true, // merge coplanar same-color faces
  lowpoly: false, // planar remesh: staircases -> flat angled facets
  transforms: {}, // per-view reorientation (rot/flip)
  autoRotate: true,
  atlasImage: null, // the current sprite sheet (ImageData)
  tileW: null, // null = auto-derive from image + layout
  tileH: null,
  atlasWarnings: [],
};

let current = null; // THREE.Object3D in the scene
let frameNext = true; // reframe camera on next build (sample/mode change)

const camParam = new URLSearchParams(location.search).get('cam');
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

// Geometry self-check: watertightness (position-based edge parity) + a per-face
// normal histogram. A closed surface uses every undirected edge exactly twice;
// edges used an odd number of times are boundaries = real holes/missing geometry.
function computeDiag(geo) {
  const pos = geo.attributes.position.array;
  const nrm = geo.attributes.normal.array;
  const idx = geo.index ? geo.index.array : null;
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  const key = (i) => {
    const x = Math.round(pos[i * 3] * 1e4);
    const y = Math.round(pos[i * 3 + 1] * 1e4);
    const z = Math.round(pos[i * 3 + 2] * 1e4);
    return x + ',' + y + ',' + z;
  };
  const edges = new Map();
  const axis = (i) => {
    const ax = Math.abs(nrm[i * 3]), ay = Math.abs(nrm[i * 3 + 1]), az = Math.abs(nrm[i * 3 + 2]);
    if (ax >= ay && ax >= az) return nrm[i * 3] > 0 ? 'px' : 'nx';
    if (ay >= az) return nrm[i * 3 + 1] > 0 ? 'py' : 'ny';
    return nrm[i * 3 + 2] > 0 ? 'pz' : 'nz';
  };
  const hist = { px: 0, nx: 0, py: 0, ny: 0, pz: 0, nz: 0 };
  for (let t = 0; t < triCount; t++) {
    const a = idx ? idx[t * 3] : t * 3;
    const b = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const c = idx ? idx[t * 3 + 2] : t * 3 + 2;
    hist[axis(a)]++;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const ka = key(p), kb = key(q);
      const e = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      edges.set(e, (edges.get(e) || 0) + 1);
    }
  }
  let boundary = 0, odd = 0;
  for (const n of edges.values()) { if (n === 1) boundary++; if (n % 2 === 1) odd++; }
  return { triCount, hist, uniqueEdges: edges.size, boundaryEdges: boundary, oddEdges: odd };
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
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
      else o.material?.dispose?.();
    });
    current = null;
  }

  let stats = { provided, dims: null, voxels: 0, triangles: 0, warnings: [] };
  if (provided.length === 0) {
    ui.setStats(stats);
    return;
  }

  const rawViews = {};
  for (const n of VIEW_NAMES) rawViews[n] = state.views[n] || null;

  if (state.mode === 'box') {
    current = texturedBoxMesh(rawViews, opts);
    stats.warnings =
      provided.length < 2 ? ['Box mode: fewer than 2 views — depth is a guess.'] : [];
  } else {
    const result = buildVoxels(rawViews, opts);
    const sp = new URLSearchParams(location.search);
    const lowpolyEngine = sp.get('engine') === 'tile' ? tileMesh : wedgeMesh;
    current = state.lowpoly
      ? lowpolyEngine(result, { flat: sp.get('flat') === '1' })
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
  if (new URLSearchParams(location.search).get('diag') === '1' && current?.geometry) {
    document.title = 'DIAG ' + JSON.stringify({ ...computeDiag(current.geometry), sweep: current.userData.sweep });
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
    state.atlasImage = sample.atlas.image ?? (await urlToImageData(sample.atlas.url));
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
  const scale = 0.5; // low-res render, crisply upscaled by CSS
  const rw = Math.max(1, Math.floor(w * scale));
  const rh = Math.max(1, Math.floor(h * scale));
  if (canvas.width !== rw || canvas.height !== rh) {
    renderer.setSize(rw, rh, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

function tick() {
  resize();
  if (state.autoRotate && current) current.rotation.y += 0.006;
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

// Boot with a sample (?sample=<index|name> overrides, handy for testing).
const params = new URLSearchParams(location.search);
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
tick();
