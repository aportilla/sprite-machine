import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildVoxels } from './lib/pipeline.js';
import { voxelMesh } from './lib/mesh.js';
import { wedgeMesh } from './lib/wedge-mesh.js';
import { SAMPLES } from './lib/sprite-data.js';
import { clampTile, validateSheet, TILE_MIN, TILE_MAX } from './lib/atlas.js';
import { VIEW_NAMES } from './lib/views.js';
import { PENCIL_PALETTE, PALETTE_256 } from './lib/constants.js';
import { urlToImageData, imageDataToBlob, downloadBlob } from './image-io.js';
import { doc } from './state/doc.js';
import { session } from './state/session.js';
import { prefs } from './state/prefs.js';
import { build } from './state/build.js';
import { editorViewModel } from './state/derive.js';
import { createUI } from './ui.js';
import './components/sm-editor.js'; // registers <sm-editor>

// --------------------------------------------------------------------------
// Scene
// --------------------------------------------------------------------------
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('viewport'));
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// Stage backdrop: the System 7 mid gray, matching the vintage-frames UI chrome
// around it.
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x808080);

const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
camera.position.set(5, 4.2, 5);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0.9, 0);

// Render on demand: redraw only when something actually changed (a control move,
// a rebuild, a resize, or an autoRotate tick) instead of re-rendering the full
// scene — 2048² shadow maps + PCF — at 60fps forever while idle. OrbitControls
// emits 'change' throughout a drag AND the damping tail, so motion stays smooth.
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

// --------------------------------------------------------------------------
// Boot params + prefs seeding
// --------------------------------------------------------------------------
// Parse the query string once — these flags never change at runtime. The prefs
// params are applied HERE, before any store subscription exists, so seeding
// them can't fire a phantom rebuild.
const params = new URLSearchParams(location.search);
const FLAT = params.get('flat') === '1';
const DIAG = params.get('diag') === '1';
const RENDER_SCALE = 0.5; // low-res render, crisply upscaled by CSS
if (params.get('lowpoly') != null) prefs.setLowpoly(params.get('lowpoly') === '1');
if (params.get('rotate') === '0') prefs.setAutoRotate(false);

// Dev hook: ?edit=<view> auto-opens the tile editor on that face after the first
// build (handy for screenshots / the manual test checklist).
let pendingEditFace = null;
// Dev hook: ?tile=N (square) or ?tile=WxH applies one resize after the first build
// (the capture tool can't click the stepper).
let pendingTileResize = null;
// Dev hook: ?palette=1 opens the "+" palette modal on the first editor mount
// (the capture tool can't click "+"). Consumed once.
let pendingOpenPalette = false;
// Dev hook: ?cursor=N sets the pencil size to N and draws its footprint outline at
// the tile center on the first editor mount (the capture tool has no pointer to
// hover). Consumed once.
let pendingCursor = null;
// Dev hook: ?pick=N selects PALETTE_256[N] as the ink on the first editor mount, as
// if picked from the "+" modal (the capture tool can't click a swatch), so a shot
// can show it landing as the selected palette-row tile. Consumed once.
let pendingPick = null;
// Dev hook: ?rect=x0,y0,x1,y1[,r[,sq]] selects the rect tool and draws its live drag
// preview for that box (radius r; sq=1 for the Shift square-lock) on the first editor
// mount (the capture tool can't drag), so a shot can show the tool mid-drag. Consumed once.
let pendingRect = null;
// Dev hook: ?fill=x,y[,r[,a]] selects the fill tool, sets its checkboxes (replace=r,
// all-tiles=a), and fills at (x,y) on the first editor mount (the capture tool can't
// click), so a shot can show the tool + result. Consumed once.
let pendingFill = null;

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

// --------------------------------------------------------------------------
// Rebuild — a subscriber of the doc (change + live) and prefs slices
// --------------------------------------------------------------------------
let current = null; // THREE.Object3D in the scene
let frameNext = true; // reframe camera on next build (sample/mode change)

function rebuild() {
  const d = doc.get();
  const opts = { transforms: d.transforms };
  const provided = VIEW_NAMES.filter((n) => d.views[n]);

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

  if (provided.length === 0) {
    build.setStats({ dims: null, voxels: 0, triangles: 0, warnings: [] });
    requestRender(); // the old mesh (if any) was just removed — redraw the empty scene
    return;
  }

  /** @type {Record<string, {width:number,height:number,data:Uint8ClampedArray}|null>} */
  const rawViews = {};
  for (const n of VIEW_NAMES) rawViews[n] = d.views[n] || null;

  const result = buildVoxels(rawViews, opts);
  const lowpoly = prefs.get().lowpoly;
  current = lowpoly
    ? wedgeMesh(result, { flat: FLAT })
    : voxelMesh(result, { greedy: true }); // greedy meshing is always on
  if (DIAG && current?.geometry) {
    const geo = current.geometry; // captured: current may change before load resolves
    import('./lib/diag.js').then(({ computeDiag }) => {
      // A fast live edit can run another rebuild() (disposing this geometry) before
      // the dynamic import settles; skip a stale read rather than measure a mesh
      // that's already been replaced.
      if (geo !== current?.geometry) return;
      // Tag the mode: only the low-poly (wedge) mesh is guaranteed watertight. The
      // greedy-voxel mesh (lowpoly off) deliberately leaves its step-riser T-junctions
      // unrepaired, so nonzero boundary/odd edges there are expected artifacts, not holes.
      document.title =
        `DIAG ${lowpoly ? 'lowpoly' : 'voxel'} ` + JSON.stringify(computeDiag(geo));
    });
  }
  scene.add(current);
  if (frameNext) {
    frameObject(current);
    frameNext = false;
  } else if (prevRotY != null) {
    current.rotation.y = prevRotY;
  }
  build.setStats({
    dims: result.dims,
    voxels: result.solidCount,
    triangles: current.userData.triangles,
    warnings: [...d.atlasWarnings, ...(result.warnings || [])],
  });
  requestRender(); // the mesh changed — redraw once even if the camera is idle
}

// Structural doc changes (load / resize / replace-all) and the rAF-coalesced
// live channel both rebuild; a lowpoly toggle rebuilds too (autoRotate doesn't).
const unsubDocChange = doc.subscribe(() => rebuild());
const unsubDocLive = doc.onLive(() => rebuild());
let lastLowpoly = prefs.get().lowpoly;
const unsubPrefs = prefs.subscribe((p) => {
  if (p.lowpoly !== lastLowpoly) {
    lastLowpoly = p.lowpoly;
    rebuild();
  }
});

// --------------------------------------------------------------------------
// Tile editor wiring (see the "Drawing editor" section of README.md and the
// header comment of components/sm-editor.js — docs/drawing-editor-plan.md is a
// superseded early design, kept for history only).
// --------------------------------------------------------------------------
// The tools panel (left half) always shows the editor for one face. Boot and
// sheet-swaps fall back to this face; the face picker switches which is active,
// laid out as mirror pairs (left/right, front/back, top/bottom).
const DEFAULT_FACE = 'left';
const TAB_ORDER = ['left', 'right', 'front', 'back', 'top', 'bottom'];

// --- editor session -------------------------------------------------------
// ONE <sm-editor>, created on the first build and never destroyed. A face swap,
// a tile resize and an all-tiles replace are property assignments — the element
// re-derives its working buffer in willUpdate — and the brush state itself
// (tool, ink, recency, per-tool options) lives in the session slice, which
// outlives even the element.
let editorEl = null;
// Whether the face the editor is currently showing had no independent art when
// it was selected — read by the sm-live handler (which lives on the dock, not in
// a per-mount closure).
let editingWasDerived = false;

// Build the editor element once and dock it. Everything here is either constant
// for the session or a one-shot dev hook consumed on its first update.
function ensureEditor() {
  if (editorEl) return editorEl;
  editorEl = /** @type {any} */ (document.createElement('sm-editor'));
  Object.assign(editorEl, {
    palette: PENCIL_PALETTE,
    palette256: PALETTE_256,
    faces: TAB_ORDER,
    sizeMin: TILE_MIN,
    sizeMax: TILE_MAX,
    openPaletteOnMount: pendingOpenPalette,
    previewCursor: pendingCursor,
    previewRect: pendingRect,
    pickIndex: pendingPick,
    fillOnMount: pendingFill,
  });
  pendingOpenPalette = false; // one-shot: they only fire on the first update
  pendingCursor = null;
  pendingRect = null;
  pendingPick = null;
  pendingFill = null;
  ui.editorDock.replaceChildren(editorEl);
  return editorEl;
}

// Point the persistent editor at a face. Called by a face pick, a sheet swap, a
// tile resize, an all-tiles replace, and boot. The face lands in the session
// slice (the canonical "which face" record); the per-face view model — working
// tile, onion-skin, alignment guides — is a pure derivation over the doc.
function showFace(name) {
  session.selectFace(name);
  const d = doc.get();
  const vm = editorViewModel(d, name);
  editingWasDerived = vm.wasDerived;
  Object.assign(ensureEditor(), {
    face: name,
    tile: vm.tile,
    tileW: d.tileW,
    tileH: d.tileH,
    mirrorBehind: vm.mirrorBehind,
    guides: vm.guides,
  });
}

// Select a face for editing. Called by a face pick, a sheet swap, a tile resize,
// and boot.
function enterDrawing(name) {
  const d = doc.get();
  if (!d.atlasImage || !d.tileW || !d.tileH) return;
  showFace(name);
}

// Load a NEW sheet (sample / dropped atlas / blank): the doc drops any pending
// live stroke from the old sheet, re-slices, and notifies (one rebuild); then
// the always-on editor re-points at the active face (a pending ?edit= face,
// else whatever was open, else the default).
function loadSheet(imageData, transforms) {
  frameNext = true;
  doc.loadAtlas(imageData, transforms);
  // Dev hook: ?tile=WxH resizes the fresh sheet once (the capture tool can't click
  // the stepper) before the editor opens, so a headless shot shows the result.
  if (pendingTileResize) {
    const { w, h } = pendingTileResize;
    pendingTileResize = null;
    doc.resizeTiles(w, h);
  }
  const face = pendingEditFace || session.get().face || DEFAULT_FACE;
  pendingEditFace = null;
  enterDrawing(face);
}

function onDownload() {
  if (!doc.get().atlasImage) return;
  // Fold any un-flushed live stroke into the canonical sheet BEFORE snapshotting
  // it — applyTileEdit only schedules the blit via rAF (paused in a backgrounded
  // tab), so without this drain the last stroke could be dropped from atlas.png.
  doc.drain();
  imageDataToBlob(doc.get().atlasImage)
    .then((b) => downloadBlob(b, 'atlas.png'))
    .catch((err) => build.setError(`Download failed: ${err.message}`));
}

// --------------------------------------------------------------------------
// UI wiring
// --------------------------------------------------------------------------
const ui = createUI({
  samples: SAMPLES,
  onSample: async (sample) => {
    let image;
    try {
      image = sample.atlas.image ?? (await urlToImageData(sample.atlas.url));
    } catch (err) {
      build.setError(`Couldn't load sample "${sample.name}": ${err.message}`);
      return;
    }
    const bad = validateSheet(image);
    if (bad) {
      build.setError(`Sample "${sample.name}" is unusable: ${bad}`);
      return;
    }
    loadSheet(image, { ...(sample.transforms || {}) });
  },
  onAtlas: (imageData) => {
    const bad = validateSheet(imageData);
    if (bad) {
      build.setError(bad);
      return;
    }
    loadSheet(imageData, {});
  },
  onDownload,
});

// <sm-editor> talks back in bubbling `sm-*` CustomEvents, heard once on the dock
// rather than through per-mount callbacks — so the wiring outlives any editor.
ui.editorDock.addEventListener('sm-live', (e) => {
  const { tile, dirty } = /** @type {CustomEvent} */ (e).detail;
  // An untouched derived/empty face stays that way (mirror-derived or empty);
  // otherwise the working buffer becomes the face's real art — or null again if
  // fully erased, reverting it to mirror-derived (doc.applyTileEdit decides).
  if (editingWasDerived && !dirty) return;
  doc.applyTileEdit(session.get().face, tile);
});
ui.editorDock.addEventListener('sm-select-face', (e) => {
  enterDrawing(/** @type {CustomEvent} */ (e).detail.face);
});
ui.editorDock.addEventListener('sm-resize-tile', (e) => {
  const { size } = /** @type {CustomEvent} */ (e).detail;
  // Tiles are locked SQUARE (the only registering shape) and the resize CENTERS
  // the art on every axis; re-point the editor at the same face at the new size.
  // (The number field keeps focus by itself — its element is never unmounted.)
  if (doc.resizeTiles(size, size)) showFace(session.get().face);
});
ui.editorDock.addEventListener('sm-replace-all-tiles', (e) => {
  const { target, fill } = /** @type {CustomEvent} */ (e).detail;
  // Fill with BOTH "replace" and "all tiles" on: recolor across the whole sheet,
  // then re-point the editor so its working buffer reflects the replaced tile.
  if (doc.replaceAllTiles(target, fill)) showFace(session.get().face);
});

// --------------------------------------------------------------------------
// Render loop
// --------------------------------------------------------------------------
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
  // Track CSS aspect independently of the (rounded) render-buffer size so an
  // odd one-pixel resize can't leave the projection matrix stale.
  const aspect = w / h;
  if (camera.aspect !== aspect) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    changed = true;
  }
  if (changed) requestRender();
}
window.addEventListener('resize', resize);
// The viewport fills the 50% stage, which can change width (e.g. a window
// resize). Observe its box directly so the render buffer + camera aspect stay
// correct without waiting on a window resize event.
const canvasResizeObs =
  typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
canvasResizeObs?.observe(canvas);

let rafId = 0;
function tick() {
  if (prefs.get().autoRotate && current) {
    current.rotation.y += 0.006;
    needsRender = true;
  }
  controls.update(); // advance damping every frame; it emits 'change' while moving
  if (needsRender) {
    renderer.render(scene, camera);
    needsRender = false;
  }
  rafId = requestAnimationFrame(tick);
}

// Vite HMR re-executes this module's top level on edit without unloading the old
// instance; without teardown the window resize handler, the ResizeObserver, the
// controls listener, the rAF loop, and this run's store subscriptions would
// accumulate a duplicate each edit. (The store singletons themselves persist —
// only the listeners belong to this execution.)
const hot = /** @type {any} */ (import.meta).hot;
if (hot) {
  hot.dispose(() => {
    window.removeEventListener('resize', resize);
    canvasResizeObs?.disconnect();
    controls.removeEventListener('change', requestRender);
    cancelAnimationFrame(rafId);
    unsubDocChange();
    unsubDocLive();
    unsubPrefs();
    ui.dispose();
  });
}

// Boot with a sample (?sample=<index|name> overrides, handy for testing).
const editParam = params.get('edit');
if (editParam && VIEW_NAMES.includes(editParam)) pendingEditFace = editParam;
const tileParam = params.get('tile');
if (tileParam) {
  const m = /^(\d+)(?:x(\d+))?$/i.exec(tileParam.trim());
  if (m) pendingTileResize = { w: clampTile(+m[1]), h: clampTile(+(m[2] ?? m[1])) };
}
if (params.get('palette') === '1') pendingOpenPalette = true;
const cursorParam = params.get('cursor');
if (cursorParam) {
  const n = parseInt(cursorParam, 10);
  if (n > 0) pendingCursor = n;
}
const pickParam = params.get('pick');
if (pickParam != null) {
  const n = parseInt(pickParam, 10);
  if (n >= 0 && n < PALETTE_256.length) pendingPick = n;
}
const rectParam = params.get('rect');
if (rectParam) {
  const p = rectParam.split(',').map((s) => parseInt(s, 10));
  if (p.length >= 4 && p.slice(0, 4).every(Number.isFinite)) {
    pendingRect = {
      x0: p[0],
      y0: p[1],
      x1: p[2],
      y1: p[3],
      r: p.length > 4 ? p[4] : 0,
      square: p.length > 5 && p[5] > 0,
    };
  }
}
const fillParam = params.get('fill');
if (fillParam) {
  const p = fillParam.split(',').map((s) => parseInt(s, 10));
  if (p.length >= 2 && p.slice(0, 2).every(Number.isFinite)) {
    pendingFill = {
      x: p[0],
      y: p[1],
      replace: p.length > 2 && p[2] > 0,
      all: p.length > 3 && p[3] > 0,
    };
  }
}
const q = params.get('sample');
let startIndex = 0;
if (q != null) {
  const byName = SAMPLES.findIndex((s) => s.name.toLowerCase() === q.toLowerCase());
  startIndex = byName >= 0 ? byName : Math.min(SAMPLES.length - 1, Math.max(0, +q || 0));
}
ui.selectSample(startIndex);
resize();
tick();
