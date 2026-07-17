import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildVoxels } from './lib/pipeline.js';
import { voxelMesh } from './lib/mesh.js';
import { wedgeMesh } from './lib/wedge-mesh.js';
import { SAMPLES } from './lib/sprite-data.js';
import { sliceAtlas, blitTile, cellOf } from './lib/atlas.js';
import {
  VIEW_NAMES,
  VIEW_OPPOSITE,
  VIEW_MIRROR_AXIS,
  VIEW_FRONT_EDGE,
} from './lib/views.js';
import { PENCIL_PALETTE } from './lib/constants.js';
import { faceGuides } from './lib/guides.js';
import { urlToImageData, imageDataToBlob, downloadBlob } from './image-io.js';
import { createUI, mirrorImage } from './ui.js';
import { createTileEditor } from './editor.js';

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
  views: {}, // name -> {width,height,data} | null
  lowpoly: true, // additive 45° wedges over same-color staircases (default on)
  transforms: {}, // per-view reorientation (rot/flip)
  autoRotate: true,
  atlasImage: null, // the current sprite sheet (ImageData) — canonical source
  atlasWarnings: [],
  // Rounded tile geometry from the last sliceAtlas — the editor writes tiles back
  // into atlasImage using these, so it must never re-derive them from dimensions.
  tileW: 0,
  tileH: 0,
  cols: 0,
  rows: 0,
};

let current = null; // THREE.Object3D in the scene
let frameNext = true; // reframe camera on next build (sample/mode change)

// Parse the query string once — these flags never change at runtime.
const params = new URLSearchParams(location.search);
const FLAT = params.get('flat') === '1';
const DIAG = params.get('diag') === '1';
const RENDER_SCALE = 0.5; // low-res render, crisply upscaled by CSS
// Dev hook: ?edit=<view> auto-opens the tile editor on that face after the first
// build (handy for screenshots / the manual test checklist).
let pendingEditFace = null;

const camParam = params.get('cam');
const ISO_DIR = new THREE.Vector3(
  ...(camParam === 'top'
    ? [0.001, 1, 0.001]
    : camParam === 'front'
      ? [0, 0.2, 1]
      : camParam === 'fq'
        ? [0.7, 0.35, 1]
        : camParam === 'bq'
          ? [0.7, 0.35, -1]
          : [1, 0.8, 1])
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
  const opts = { transforms: state.transforms };
  const provided = VIEW_NAMES.filter((n) => state.views[n]);

  // Carry the spin forward: a live tile edit (or an option toggle) rebuilds the
  // mesh in place, and a fresh mesh starts at rotation 0 — without this the
  // auto-rotate angle would visibly snap to 0 on every stroke. Framed rebuilds
  // (sample/atlas load) skip this and start fresh.
  const prevRotY = current ? current.rotation.y : null;

  if (current) {
    scene.remove(current);
    // Free the GPU resources of the mesh we're replacing. Both builders emit a
    // single vertex-colored MeshStandardMaterial (no textures to dispose).
    current.traverse?.((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    current = null;
  }

  let stats = { dims: null, voxels: 0, triangles: 0, warnings: [] };
  if (provided.length === 0) {
    ui.setStats(stats);
    return;
  }

  /** @type {Record<string, ImageData|null>} */
  const rawViews = {};
  for (const n of VIEW_NAMES) rawViews[n] = state.views[n] || null;

  const result = buildVoxels(rawViews, opts);
  current = state.lowpoly
    ? wedgeMesh(result, { flat: FLAT })
    : voxelMesh(result, { greedy: true }); // greedy meshing is always on
  stats = {
    dims: result.dims,
    voxels: result.solidCount,
    triangles: current.userData.triangles,
    warnings: result.warnings,
  };
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
  } else if (prevRotY != null) {
    current.rotation.y = prevRotY;
  }
  ui.setStats(stats);
}

// Slice the current atlas into face views (with the current tile size) and build.
function sliceAndBuild(reframe) {
  if (!state.atlasImage) return;
  // A new sheet replaces every view wholesale, so any open editor is now stale.
  exitDrawing();
  const sliced = sliceAtlas(state.atlasImage);
  state.views = sliced.views;
  state.atlasWarnings = sliced.warnings;
  state.tileW = sliced.tileW;
  state.tileH = sliced.tileH;
  state.cols = sliced.cols;
  state.rows = sliced.rows;
  if (reframe) frameNext = true;
  ui.setAtlasInfo(sliced);
  ui.setThumbnails(sliced.views);
  rebuild();
  if (pendingEditFace) {
    const f = pendingEditFace;
    pendingEditFace = null;
    enterDrawing(f);
  }
}

// --------------------------------------------------------------------------
// Tile editor wiring (see docs/drawing-editor-plan.md)
// --------------------------------------------------------------------------
const isAllTransparent = (tile) => {
  const d = tile.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
  return true;
};

// Coalesce live edits to at most one voxel rebuild per animation frame. The
// editor's own 2D canvas repaints per pixel; only the (heavier) blit + preview +
// mesh rebuild is throttled here.
let liveRAF = 0;
let livePending = null; // { name, tile } awaiting flush
function flushLive() {
  liveRAF = 0;
  const p = livePending;
  livePending = null;
  if (!p) return;
  const cell = cellOf(p.name);
  if (cell && state.atlasImage) {
    blitTile(state.atlasImage, p.tile, cell.c * state.tileW, cell.r * state.tileH);
  }
  ui.setThumbnails(state.views);
  rebuild();
}

// Apply one live/committed tile edit. `wasDerived` = the face had no independent
// art when the editor opened; if the user drew nothing (`!dirty`) it stays that
// way (mirror-derived or empty). Otherwise the working buffer becomes the face's
// real art — or null again if fully erased, reverting it to mirror-derived.
function applyTileEdit(name, wasDerived, tile, dirty) {
  if (wasDerived && !dirty) return; // untouched derived/empty face: leave as-is
  state.views[name] = isAllTransparent(tile) ? null : tile;
  livePending = { name, tile };
  if (!liveRAF) liveRAF = requestAnimationFrame(flushLive);
}

// --- drawing-mode session -------------------------------------------------
// The editor is docked in the sidebar (not modal); the 3D view stays live. The
// brush selection is shared so it survives a mirror-partner face swap.
const brush = { mode: 'pencil', color: null, swatchIndex: 0 };
let currentEditor = null;
let editingName = null;

// Canonical mirror-pair ordering for the face tabs (primary face first), so the
// pill always reads [front|back] / [left|right] / [top|bottom] whichever is open.
const FACE_PRIMARY = new Set(['front', 'left', 'top']);
const facePair = (n) => {
  const opp = VIEW_OPPOSITE[n];
  return FACE_PRIMARY.has(n) ? [n, opp] : [opp, n];
};

const freshTile = () => ({
  width: state.tileW,
  height: state.tileH,
  data: new Uint8ClampedArray(state.tileW * state.tileH * 4),
});

function mountEditor(name) {
  if (currentEditor) {
    currentEditor.destroy();
    currentEditor = null;
  }
  const existing = state.views[name] || null;
  const wasDerived = existing == null;
  // For a derived face, seed the canvas with the mirrored opposite (exactly what
  // the thumbnail shows) so editing refines from there rather than a blank.
  let seedMirror = null;
  if (wasDerived) {
    const opp = state.views[VIEW_OPPOSITE[name]];
    if (opp) seedMirror = mirrorImage(opp, VIEW_MIRROR_AXIS[name]);
  }
  // Onion-skin: the opposite face's OWN art, mirrored, faded behind the canvas —
  // only when it has independent art (a derived opposite is just this face's own
  // mirror, so it would overlay identically and add nothing).
  const oppArt = state.views[VIEW_OPPOSITE[name]];
  const mirrorBehind = oppArt ? mirrorImage(oppArt, VIEW_MIRROR_AXIS[name]) : null;
  // Hairline extent rules from the orthogonal faces sharing each of this face's
  // axes — where a painted pixel can survive the (now strict) carve.
  const guides = faceGuides(state.views, name, state.tileW, state.tileH);
  editingName = name;
  currentEditor = createTileEditor(ui.editorDock, {
    name,
    tile: existing || freshTile(),
    tileW: state.tileW,
    tileH: state.tileH,
    palette: PENCIL_PALETTE,
    frontEdge: VIEW_FRONT_EDGE[name],
    seedMirror,
    mirrorBehind,
    guides,
    pair: facePair(name),
    brush,
    onLive: (working, dirty) => applyTileEdit(name, wasDerived, working, dirty),
    onSelectFace: (target) => enterDrawing(target),
    onClose: () => exitDrawing(),
  });
  ui.setActiveFace(name);
}

// Clicking a face tile enters (or, if already editing, switches to) drawing mode.
function enterDrawing(name) {
  if (!state.atlasImage || !state.tileW || !state.tileH) return;
  ui.setDrawingMode(true);
  mountEditor(name);
}

function exitDrawing() {
  if (currentEditor) {
    currentEditor.destroy();
    currentEditor = null;
  }
  // Drop any pending live rebuild so a stale tile can't blit into a freshly
  // loaded atlas (which may have a different tile size) on the next frame.
  if (liveRAF) {
    cancelAnimationFrame(liveRAF);
    liveRAF = 0;
  }
  livePending = null;
  editingName = null;
  ui.setDrawingMode(false);
  ui.setActiveFace(null);
}

function onTileEdit(name) {
  enterDrawing(name);
}

function onDownload() {
  if (!state.atlasImage) return;
  imageDataToBlob(state.atlasImage)
    .then((b) => downloadBlob(b, 'atlas.png'))
    .catch((err) => ui.setError(`Download failed: ${err.message}`));
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
    state.transforms = { ...(sample.transforms || {}) };
    ui.syncControls();
    sliceAndBuild(true);
  },
  onAtlas: (imageData) => {
    state.atlasImage = imageData;
    state.transforms = {};
    sliceAndBuild(true);
  },
  onOptionChange: () => rebuild(),
  onTileEdit,
  onDownload,
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
// The viewport is a flex child: entering drawing mode widens the sidebar and
// shrinks it. Observe its box directly so the render buffer + camera aspect stay
// correct without a window resize event.
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => resize()).observe(canvas);
}

function tick() {
  if (state.autoRotate && current) current.rotation.y += 0.006;
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

// Boot with a sample (?sample=<index|name> overrides, handy for testing).
if (params.get('lowpoly') != null) state.lowpoly = params.get('lowpoly') === '1';
if (params.get('rotate') === '0') state.autoRotate = false;
const editParam = params.get('edit');
if (editParam && VIEW_NAMES.includes(editParam)) pendingEditFace = editParam;
const q = params.get('sample');
let startIndex = 0;
if (q != null) {
  const byName = SAMPLES.findIndex((s) => s.name.toLowerCase() === q.toLowerCase());
  startIndex = byName >= 0 ? byName : Math.min(SAMPLES.length - 1, Math.max(0, +q || 0));
}
ui.selectSample(startIndex);
resize();
tick();
