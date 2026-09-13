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
// A new sheet generation or a newly activated document frames the camera. Other
// rebuilds keep the previous auto-rotate angle. An empty build leaves the
// generation unconsumed, so the first real build of a fresh sheet still frames.
//
// onMesh receives each new mesh with its dims, and null before the old mesh is
// disposed, so a consumer's shared-geometry clone never outlives its geometry.

import {
  buildVoxels,
  unionVoxels,
  wedgeMesh,
  computeDiag,
  VIEW_NAMES,
} from 'sprite-machine';
import { workspace, followActive } from '../state/workspace.js';
import { build } from '../state/build.js';

/** @param {Record<string, object|null>} views  one layer's views */
const rawViewsOf = (views) =>
  Object.fromEntries(VIEW_NAMES.map((n) => [n, views[n] || null]));

/**
 * @param {ReturnType<typeof import('./stage.js').createStage>} stage
 * @param {{
 *   flat?: boolean,
 *   diag?: boolean,
 *   onMesh?: (m: {mesh: import('three').Object3D, dims: {nx: number, ny: number, nz: number}}|null) => void,
 * }} [opts]  the ?flat / ?diag dev flags, and onMesh (see the header)
 */
export function initRebuilder(stage, { flat = false, diag = false, onMesh } = {}) {
  let current = null; // THREE.Object3D in the scene
  let activeCtx = null;
  let framedSheet = 0; // active doc's sheet generation at the last framed build
  /** @type {(ReturnType<typeof buildVoxels>|null)[]} per layer, null until built */
  let cache = [];
  /** @type {object[]|null} the doc's `layers` the cache was built from */
  let cachedLayers = null;

  function removeMesh() {
    if (!current) return;
    onMesh?.(null); // before the geometry is disposed
    stage.scene.remove(current);
    // Free the geometry, the material and its map. material.dispose() does not
    // free the skin texture.
    current.traverse?.((o) => {
      o.geometry?.dispose?.();
      o.material?.map?.dispose?.();
      o.material?.dispose?.();
    });
    current = null;
    stage.setSpinTarget(null);
  }

  /** @param {number|null} [edited]  the layer a live flush edited */
  function rebuild(edited = null) {
    const ctx = activeCtx;
    if (!ctx) {
      removeMesh();
      build.setStats({ dims: null, voxels: 0, triangles: 0, warnings: [] });
      stage.requestRender();
      return;
    }
    const d = ctx.doc.get();
    if (d.layers !== cachedLayers) {
      cachedLayers = d.layers;
      cache = d.layers.map(() => null);
    } else if (edited != null) {
      cache[edited] = null;
    } else {
      return;
    }
    const opts = { transforms: d.transforms };
    d.layers.forEach((views, i) => {
      cache[i] ??= buildVoxels(rawViewsOf(views), opts);
    });
    const result = unionVoxels(cache);

    const prevRotY = current ? current.rotation.y : null;
    removeMesh();

    if (result.providedViews.length === 0) {
      build.setStats({ dims: null, voxels: 0, triangles: 0, warnings: [] });
      stage.requestRender(); // redraw after removing the old mesh
      return;
    }

    current = wedgeMesh(result, { flat });
    if (diag && current?.geometry) {
      // The wedge mesh is watertight, so a nonzero boundary or odd-edge count
      // is a hole.
      document.title = 'DIAG ' + JSON.stringify(computeDiag(current.geometry));
    }
    stage.scene.add(current);
    stage.setSpinTarget(current);
    onMesh?.({ mesh: current, dims: result.dims });
    if (d.sheet !== framedSheet) {
      stage.frameObject(current);
      framedSheet = d.sheet;
    } else if (prevRotY != null) {
      current.rotation.y = prevRotY;
    }
    build.setStats({
      dims: result.dims,
      voxels: result.solidCount,
      triangles: current.userData.triangles,
      warnings: [...d.atlasWarnings, ...(result.warnings || [])],
    });
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

  return {
    // HMR teardown. The stage disposes the scene.
    dispose() {
      stopFollow();
    },
  };
}
