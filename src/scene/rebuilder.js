// Mesh rebuilder. Follows the active document and, on each doc change or live
// stroke flush, unions its layers' voxels, runs wedgeMesh and swaps the result
// into the stage. Writes the build stats to the build slice. With no active
// document the stage is emptied.
//
// It keeps one buildVoxels result per layer. A live flush rebuilds only the
// layer it edited and a re-slice rebuilds every layer, then the union is
// recomputed from the cache. A rename leaves the layers as they are and
// rebuilds nothing.
//
// It holds two meshes: the whole model's and the one in the stage. While
// prefs.singleLayer is on and the document has more than one layer, the stage
// shows the edited layer alone, in place in the whole model's lattice, and the
// triangle count is that mesh's. A layer switch or a toggle never carves and
// keeps the whole model.
//
// A new sheet generation or a newly activated document frames the camera on
// the whole model's lattice. A new mesh in the stage otherwise takes the
// previous auto-rotate angle. An empty build leaves the generation unconsumed,
// so the first real build of a fresh sheet still frames.
//
// onMesh receives each new mesh of the whole model with the mesher's record and
// the dims, and null before the old mesh is disposed, so a consumer's
// shared-geometry clone never outlives its geometry.

import {
  buildVoxels,
  unionVoxels,
  wedgeMesh,
  computeDiag,
  VIEW_NAMES,
} from 'sprite-machine';
import { toMesh } from 'sprite-machine/three';
import { workspace, followActive } from '../state/workspace.js';
import { prefs } from '../state/prefs.js';
import { build } from '../state/build.js';

/** @param {Record<string, object|null>} views  one layer's views */
const rawViewsOf = (views) =>
  Object.fromEntries(VIEW_NAMES.map((n) => [n, views[n] || null]));

const NO_STATS = { dims: null, voxels: 0, triangles: 0, warnings: [] };

// Free the geometry, the material and its map. material.dispose() does not free
// the skin texture.
/** @param {import('three').Object3D} obj */
const disposeMesh = (obj) =>
  obj.traverse?.((o) => {
    const m = /** @type {any} */ (o);
    m.geometry?.dispose?.();
    m.material?.map?.dispose?.();
    m.material?.dispose?.();
  });

/**
 * @param {ReturnType<typeof import('./stage.js').createStage>} stage
 * @param {{
 *   flat?: boolean,
 *   diag?: boolean,
 *   onMesh?: (m: {mesh: import('three').Object3D, model: ReturnType<typeof wedgeMesh>,
 *                 dims: {nx: number, ny: number, nz: number}}|null) => void,
 * }} [opts]  the ?flat / ?diag dev flags, and onMesh (see the header)
 */
export function initRebuilder(stage, { flat = false, diag = false, onMesh } = {}) {
  let activeCtx = null;
  let framedSheet = 0; // active doc's sheet generation at the last framed build
  /** @type {(ReturnType<typeof buildVoxels>|null)[]} per layer, null until built */
  let cache = [];
  /** @type {object[]|null} the doc's `layers` the cache was built from */
  let cachedLayers = null;
  /**
   * The whole model's mesh and readout, or null while no layer has a view.
   * @type {{mesh: import('three').Object3D, triangles: number,
   *         stats: {dims: {nx: number, ny: number, nz: number}, voxels: number,
   *                 warnings: string[]}}|null}
   */
  let whole = null;
  /** @type {import('three').Object3D|null} the mesh in the stage */
  let shown = null;
  /** @type {number|null} the layer the stage shows alone, null for the whole model */
  let shownLayer = null;
  let spinY = 0; // the shown mesh's auto-rotate angle, carried to the next one

  // Take the mesh out of the stage. The whole model's mesh is not disposed.
  function unshow() {
    if (!shown) return;
    spinY = shown.rotation.y;
    stage.scene.remove(shown);
    if (shown !== whole?.mesh) disposeMesh(shown);
    shown = null;
    stage.setSpinTarget(null);
  }

  // Dispose the whole model's mesh. unshow() runs first.
  function dropWhole() {
    if (!whole) return;
    onMesh?.(null); // before the geometry is disposed
    disposeMesh(whole.mesh);
    whole = null;
  }

  /** @param {number|null} [edited]  the layer a live flush edited */
  function rebuild(edited = null) {
    const ctx = activeCtx;
    if (!ctx) {
      if (!whole) return; // nothing shown, and the stats are already blank
      unshow();
      dropWhole();
      build.setStats(NO_STATS);
      stage.requestRender();
      return;
    }
    const d = ctx.doc.get();
    const layer = prefs.get().singleLayer && d.layers.length > 1 ? ctx.layer : null;
    let remodel = true;
    if (d.layers !== cachedLayers) {
      cachedLayers = d.layers;
      cache = d.layers.map(() => null);
    } else if (edited != null) {
      cache[edited] = null;
    } else if (layer !== shownLayer) {
      remodel = false;
    } else {
      return;
    }
    shownLayer = layer;
    unshow();

    if (remodel) {
      dropWhole();
      const opts = { transforms: d.transforms };
      d.layers.forEach((views, i) => {
        cache[i] ??= buildVoxels(rawViewsOf(views), opts);
      });
      const result = unionVoxels(cache);
      if (result.providedViews.length > 0) {
        const model = wedgeMesh(result, { flat });
        whole = {
          mesh: toMesh(model),
          triangles: model.triangles,
          stats: {
            dims: result.dims,
            voxels: result.solidCount,
            warnings: [...d.atlasWarnings, ...(result.warnings || [])],
          },
        };
        if (diag) {
          // The wedge mesh is watertight, so a nonzero boundary or odd-edge count
          // is a hole.
          document.title = 'DIAG ' + JSON.stringify(computeDiag(model.geometry));
        }
        onMesh?.({ mesh: whole.mesh, model, dims: result.dims });
      }
    }

    if (!whole) {
      build.setStats(NO_STATS);
      stage.requestRender(); // redraw after removing the old mesh
      return;
    }

    let triangles = whole.triangles;
    if (layer == null) {
      shown = whole.mesh;
    } else {
      // An empty layer has no provided view and shows nothing.
      const alone = unionVoxels(cache, { only: layer });
      triangles = 0;
      if (alone.providedViews.length > 0) {
        const model = wedgeMesh(alone, { flat });
        shown = toMesh(model);
        triangles = model.triangles;
      }
    }
    if (d.sheet !== framedSheet) {
      stage.frameLattice(whole.stats.dims);
      framedSheet = d.sheet;
      spinY = 0;
    }
    if (shown) {
      shown.rotation.y = spinY;
      stage.scene.add(shown);
      stage.setSpinTarget(shown);
    }
    build.setStats({ ...whole.stats, triangles });
    stage.requestRender(); // redraw even if the camera is idle
  }

  // Rebuild on the active doc's changes and live flushes. Switching documents
  // drops the cache, resets framing and rebuilds.
  const stopFollow = followActive(workspace, (ctx) => {
    activeCtx = ctx;
    framedSheet = -1;
    cache = [];
    cachedLayers = null;
    if (!ctx) {
      rebuild();
      return;
    }
    const unsubs = [
      ctx.doc.subscribe(() => rebuild()),
      ctx.doc.onLive((_, edit) => rebuild(edit.layer)),
    ];
    rebuild();
    return () => unsubs.forEach((u) => u());
  });
  // A layer switch changes the workspace store and the checkbox changes prefs.
  // Any other change to either returns early.
  const unsubShown = [
    workspace.subscribe(() => rebuild()),
    prefs.subscribe(() => rebuild()),
  ];

  return {
    // HMR teardown. The stage disposes the scene.
    dispose() {
      stopFollow();
      unsubShown.forEach((u) => u());
    },
  };
}
