import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildVoxels } from './lib/pipeline.js';
import { voxelMesh } from './lib/mesh.js';
import { wedgeMesh } from './lib/wedge-mesh.js';
import { SAMPLES } from './lib/sprite-data.js';
import {
  sliceAtlas,
  blitTile,
  cellOf,
  resizeAtlas,
  clampTile,
  isBlank,
  validateSheet,
  TILE_MIN,
  TILE_MAX,
} from './lib/atlas.js';
import { VIEW_NAMES, VIEW_OPPOSITE, MIRROR_AXIS } from './lib/views.js';
import { replaceColorInRect } from './lib/fill.js';
import { PENCIL_PALETTE, PALETTE_256 } from './lib/constants.js';
import { faceGuides } from './lib/guides.js';
import { urlToImageData, imageDataToBlob, downloadBlob } from './image-io.js';
import { createUI, mirrorImage } from './ui.js';
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
    requestRender(); // the old mesh (if any) was just removed — redraw the empty scene
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
      // A fast live edit can run another rebuild() (disposing this geometry) before
      // the dynamic import settles; skip a stale read rather than measure a mesh
      // that's already been replaced.
      if (geo !== current?.geometry) return;
      // Tag the mode: only the low-poly (wedge) mesh is guaranteed watertight. The
      // greedy-voxel mesh (lowpoly off) deliberately leaves its step-riser T-junctions
      // unrepaired, so nonzero boundary/odd edges there are expected artifacts, not holes.
      const mode = state.lowpoly ? 'lowpoly' : 'voxel';
      document.title = `DIAG ${mode} ` + JSON.stringify(computeDiag(geo));
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
  requestRender(); // the mesh changed — redraw once even if the camera is idle
}

// Re-slice the canonical atlas into face views (at its current tile size) and
// rebuild the mesh. Does NOT touch drawing mode — callers decide whether an open
// editor survives: a tile resize keeps it (re-mounting at the new size), a
// wholesale sheet swap closes it first (sliceAndBuild).
function refreshFromAtlas(reframe) {
  const sliced = sliceAtlas(state.atlasImage);
  state.views = sliced.views;
  state.atlasWarnings = sliced.warnings;
  state.tileW = sliced.tileW;
  state.tileH = sliced.tileH;
  state.cols = sliced.cols;
  state.rows = sliced.rows;
  if (reframe) frameNext = true;
  rebuild();
}

// Load a NEW sheet (sample / dropped atlas / blank): it replaces every view
// wholesale, so any pending live stroke from the old sheet is now stale — drop
// it, refresh, then re-mount the always-on editor on the active face (a pending
// ?edit= face, else whatever was open, else the default).
function sliceAndBuild(reframe) {
  if (!state.atlasImage) return;
  dropLive();
  refreshFromAtlas(reframe);
  // Dev hook: ?tile=WxH resizes the fresh sheet once (the capture tool can't click
  // the stepper) before the editor opens, so a headless shot shows the result.
  if (pendingTileResize) {
    const { w, h } = pendingTileResize;
    pendingTileResize = null;
    resizeTiles(w, h);
  }
  const face = pendingEditFace || editingName || DEFAULT_FACE;
  pendingEditFace = null;
  enterDrawing(face);
}

// --------------------------------------------------------------------------
// Tile editor wiring (see the "Drawing editor" section of README.md and the
// header comment of components/sm-editor.js — docs/drawing-editor-plan.md is a
// superseded early design, kept for history only).
// --------------------------------------------------------------------------
// The tools panel (right half) always shows the editor for one face. Boot and
// sheet-swaps fall back to this face; the tabs switch which face is active. Tabs
// are laid out as mirror pairs (left/right, front/back, top/bottom).
const DEFAULT_FACE = 'left';
const TAB_ORDER = ['left', 'right', 'front', 'back', 'top', 'bottom'];

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
  rebuild();
}

// Discard any pending live rebuild without flushing it — used before a wholesale
// sheet swap so a stale tile can't blit into a freshly loaded atlas (which may
// have a different tile size) on the next frame.
function dropLive() {
  if (liveRAF) {
    cancelAnimationFrame(liveRAF);
    liveRAF = 0;
  }
  livePending = null;
}

// Apply one live/committed tile edit. `wasDerived` = the face had no independent
// art when the editor opened; if the user drew nothing (`!dirty`) it stays that
// way (mirror-derived or empty). Otherwise the working buffer becomes the face's
// real art — or null again if fully erased, reverting it to mirror-derived.
function applyTileEdit(name, wasDerived, tile, dirty) {
  if (wasDerived && !dirty) return; // untouched derived/empty face: leave as-is
  state.views[name] = isBlank(tile) ? null : tile;
  livePending = { name, tile };
  if (!liveRAF) liveRAF = requestAnimationFrame(flushLive);
}

// --- editor session -------------------------------------------------------
// ONE <sm-editor>, created on the first build and never destroyed. A face swap,
// a tile resize and an all-tiles replace are property assignments — the element
// re-derives its working buffer in willUpdate — so the brush selection (tool,
// ink, recency, per-tool options) simply persists because the element does.
// That is what retires the old caller-owned `brush` bag and the focus-restore
// hack the per-swap re-mount used to need.
let editorEl = null;
let editingName = null;
// Whether the face the editor is currently showing had no independent art when
// it was selected — read by the sm-live handler (which lives on the dock, not in
// a per-mount closure).
let editingWasDerived = false;

const freshTile = () => ({
  width: state.tileW,
  height: state.tileH,
  data: new Uint8ClampedArray(state.tileW * state.tileH * 4),
});

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
// tile resize, an all-tiles replace, and boot.
function showFace(name) {
  const existing = state.views[name] || null;
  editingName = name;
  editingWasDerived = existing == null;
  // Onion-skin: the opposite face's OWN art, mirrored, faded behind the canvas —
  // only when it has independent art (a derived opposite is just this face's own
  // mirror, so it would overlay identically and add nothing). A derived face
  // opens with an empty canvas and relies on this faded mirror as its reference.
  const oppArt = state.views[VIEW_OPPOSITE[name]];
  Object.assign(ensureEditor(), {
    face: name,
    tile: existing || freshTile(),
    tileW: state.tileW,
    tileH: state.tileH,
    mirrorBehind: oppArt ? mirrorImage(oppArt, MIRROR_AXIS) : null,
    // Hairline extent rules from the orthogonal faces sharing each of this face's
    // axes — where a painted pixel can survive the (now strict) carve.
    guides: faceGuides(state.views, name, state.tileW, state.tileH),
  });
}

// Fill with BOTH "replace" and "all tiles" on: replace every `target` texel with
// `fill` across all six tiles, then re-slice + rebuild + re-point the editor at the
// same face so its working buffer reflects the replaced current tile. `target`/`fill`
// are color keys ({transparent:true} | {r,g,b}). Scoped to the tiled region (the
// top-left cols*tileW × rows*tileH block — the six tiles are contiguous there) rather
// than the whole ImageData, so a non-divisible sheet's remainder pixels (outside every
// tile, invisible to the carve but present in a download) are left untouched. Any
// un-flushed live stroke is folded in first (same guard as resizeTiles) so the replace
// sees the latest pixels and none are dropped.
function replaceColorAllTiles(target, fill) {
  if (!state.atlasImage) return;
  if (liveRAF) {
    cancelAnimationFrame(liveRAF);
    flushLive();
  }
  const { data, width, height } = state.atlasImage;
  const changed = replaceColorInRect(
    data,
    width,
    height,
    0,
    0,
    state.cols * state.tileW,
    state.rows * state.tileH,
    target,
    fill
  );
  if (!changed) return;
  const face = editingName;
  refreshFromAtlas(false); // re-slice all views + rebuild the mesh (keep the camera)
  if (face) showFace(face); // re-point at the same face, now on the replaced pixels
}

// Resize every tile from the editor's tile-size stepper. Tiles are locked SQUARE, so
// the editor always calls this with newW===newH: it resizes the WHOLE atlas so every
// face moves together, then re-slices and re-points the editor at the same face at the
// new size. (The number field keeps focus by itself now — the element it lives in is
// never unmounted.) It CENTERS the art on every axis (anchor 'center') so the sprite
// stays put in the canvas as the tile grows or shrinks instead of hugging a corner — a
// square resize stays in registration (the whole solid just translates), though
// centering the vertical axis means a ground-rested sprite no longer pins to y=0 and
// floats up as the tile grows (accepted: the author wanted centered artwork). The
// ?tile / ?tile=WxH dev hook drives this same path; an asymmetric pair still shears the
// shared depth axis and warns.
/** @param {number} newW @param {number} newH @param {'origin'|'center'} [anchor] */
function resizeTiles(newW, newH, anchor = 'center') {
  if (!state.atlasImage) return;
  const w = clampTile(newW);
  const h = clampTile(newH);
  if (w === state.tileW && h === state.tileH) return; // no-op (e.g. ± at a bound)
  // Fold any un-flushed live stroke into the canonical sheet BEFORE we rebuild it
  // at a new size, so the last edit isn't dropped or blitted at the wrong scale.
  if (liveRAF) {
    cancelAnimationFrame(liveRAF);
    flushLive();
  }
  state.atlasImage = resizeAtlas(state.atlasImage, w, h, { anchor });
  const face = editingName;
  refreshFromAtlas(false); // keep the camera — the world size is normalized anyway
  if (face) showFace(face); // re-point at the new size (same face, same element)
}

// Select a face for editing. Called by a face pick, a sheet swap, a tile resize,
// and boot.
function enterDrawing(name) {
  if (!state.atlasImage || !state.tileW || !state.tileH) return;
  showFace(name);
}

function onDownload() {
  if (!state.atlasImage) return;
  // Fold any un-flushed live stroke into the canonical sheet BEFORE snapshotting
  // it — applyTileEdit only schedules the blit via rAF (paused in a backgrounded
  // tab), so without this drain the last stroke could be dropped from atlas.png.
  // Same guard as resizeTiles / replaceColorAllTiles, the sibling canonical consumers.
  if (liveRAF) {
    cancelAnimationFrame(liveRAF);
    flushLive();
  }
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
    let image;
    try {
      image = sample.atlas.image ?? (await urlToImageData(sample.atlas.url));
    } catch (err) {
      ui.setError(`Couldn't load sample "${sample.name}": ${err.message}`);
      return;
    }
    const bad = validateSheet(image);
    if (bad) {
      ui.setError(`Sample "${sample.name}" is unusable: ${bad}`);
      return;
    }
    state.atlasImage = image;
    state.transforms = { ...(sample.transforms || {}) };
    ui.syncControls();
    sliceAndBuild(true);
  },
  onAtlas: (imageData) => {
    const bad = validateSheet(imageData);
    if (bad) {
      ui.setError(bad);
      return;
    }
    state.atlasImage = imageData;
    state.transforms = {};
    sliceAndBuild(true);
  },
  onOptionChange: () => rebuild(),
  onDownload,
});

// <sm-editor> talks back in bubbling `sm-*` CustomEvents, heard once on the dock
// rather than through per-mount callbacks — so the wiring outlives any editor.
ui.editorDock.addEventListener('sm-live', (e) => {
  const { tile, dirty } = /** @type {CustomEvent} */ (e).detail;
  applyTileEdit(editingName, editingWasDerived, tile, dirty);
});
ui.editorDock.addEventListener('sm-select-face', (e) => {
  enterDrawing(/** @type {CustomEvent} */ (e).detail.face);
});
ui.editorDock.addEventListener('sm-resize-tile', (e) => {
  const { size } = /** @type {CustomEvent} */ (e).detail;
  resizeTiles(size, size);
});
ui.editorDock.addEventListener('sm-replace-all-tiles', (e) => {
  const { target, fill } = /** @type {CustomEvent} */ (e).detail;
  replaceColorAllTiles(target, fill);
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
  if (state.autoRotate && current) {
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
// controls listener, and the rAF loop would accumulate a duplicate each edit.
const hot = /** @type {any} */ (import.meta).hot;
if (hot) {
  hot.dispose(() => {
    window.removeEventListener('resize', resize);
    canvasResizeObs?.disconnect();
    controls.removeEventListener('change', requestRender);
    cancelAnimationFrame(rafId);
  });
}

// Boot with a sample (?sample=<index|name> overrides, handy for testing).
if (params.get('lowpoly') != null) state.lowpoly = params.get('lowpoly') === '1';
if (params.get('rotate') === '0') state.autoRotate = false;
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
