// Mesh rebuilder. Follows the active document and, on each doc change or live
// stroke flush, runs buildVoxels and wedgeMesh and swaps the result into the
// stage. Writes the build stats to the build slice. With no active document the
// stage is emptied.
//
// A new sheet generation or a newly activated document frames the camera. Other
// rebuilds keep the previous auto-rotate angle. An empty build leaves the
// generation unconsumed, so the first real build of a fresh sheet still frames.
//
// onMesh receives each new mesh with its dims, and null before the old mesh is
// disposed, so a consumer's shared-geometry clone never outlives its geometry.

import { buildVoxels, wedgeMesh, computeDiag, VIEW_NAMES } from 'sprite-machine';
import { workspace, followActive } from '../state/workspace.js';
import { build } from '../state/build.js';

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

  function rebuild() {
    const ctx = activeCtx;
    if (!ctx) {
      removeMesh();
      build.setStats({ dims: null, voxels: 0, triangles: 0, warnings: [] });
      stage.requestRender();
      return;
    }
    const d = ctx.doc.get();
    const opts = { transforms: d.transforms };
    const provided = VIEW_NAMES.filter((n) => d.views[n]);

    const prevRotY = current ? current.rotation.y : null;
    removeMesh();

    if (provided.length === 0) {
      build.setStats({ dims: null, voxels: 0, triangles: 0, warnings: [] });
      stage.requestRender(); // redraw after removing the old mesh
      return;
    }

    /** @type {Record<string, {width:number,height:number,data:Uint8ClampedArray}|null>} */
    const rawViews = {};
    for (const n of VIEW_NAMES) rawViews[n] = d.views[n] || null;

    const result = buildVoxels(rawViews, opts);
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
  // resets framing and rebuilds.
  const stopFollow = followActive(workspace, (ctx) => {
    activeCtx = ctx;
    framedSheet = -1;
    if (!ctx) {
      rebuild();
      return;
    }
    const unsubs = [ctx.doc.subscribe(() => rebuild()), ctx.doc.onLive(() => rebuild())];
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
