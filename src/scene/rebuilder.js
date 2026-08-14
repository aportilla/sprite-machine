// ---------------------------------------------------------------------------
// The mesh rebuilder — the voxel pipeline's ONLY consumer, and just another
// store subscriber: it listens to the doc's change channel (load / resize /
// replace-all), the doc's LIVE channel (the rAF-coalesced stroke flushes — it
// is that channel's only subscriber), and the lowpoly pref; each event runs
// ingest → carve → colorize → mesh and swaps the result into the stage. It
// writes what it measured into the `build` slice for the stats readout.
//
// Framing: a build of a NEW sheet (the doc's `sheet` generation moved) frames
// the camera; every other rebuild is in place and carries the auto-rotate spin
// forward (a fresh mesh starts at rotation 0 — without this the angle would
// visibly snap on every stroke). The generation is left unconsumed on an empty
// build, so the first real build of a fresh sheet still frames (e.g. the first
// stroke on a blank atlas).
//
// This being the pipeline's single call site is what makes the future
// Web-Worker carve a drop-in: making this function async is a local change.
// ---------------------------------------------------------------------------

import { buildVoxels } from '../lib/pipeline.js';
import { voxelMesh } from '../lib/mesh.js';
import { wedgeMesh } from '../lib/wedge-mesh.js';
import { VIEW_NAMES } from '../lib/views.js';
import { doc } from '../state/doc.js';
import { prefs } from '../state/prefs.js';
import { build } from '../state/build.js';

/**
 * @param {ReturnType<typeof import('./stage.js').createStage>} stage
 * @param {{flat?: boolean, diag?: boolean}} [opts]  the ?flat / ?diag dev flags
 */
export function initRebuilder(stage, { flat = false, diag = false } = {}) {
  let current = null; // THREE.Object3D in the scene
  let framedSheet = 0; // doc sheet generation at the last framed build

  function rebuild() {
    const d = doc.get();
    const opts = { transforms: d.transforms };
    const provided = VIEW_NAMES.filter((n) => d.views[n]);

    const prevRotY = current ? current.rotation.y : null;

    if (current) {
      stage.scene.remove(current);
      // Free the GPU resources of the mesh we're replacing. Both builders emit a
      // single vertex-colored MeshStandardMaterial (no textures to dispose).
      current.traverse?.((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
      current = null;
      stage.setSpinTarget(null);
    }

    if (provided.length === 0) {
      build.setStats({ dims: null, voxels: 0, triangles: 0, warnings: [] });
      stage.requestRender(); // the old mesh (if any) was just removed — redraw
      return;
    }

    /** @type {Record<string, {width:number,height:number,data:Uint8ClampedArray}|null>} */
    const rawViews = {};
    for (const n of VIEW_NAMES) rawViews[n] = d.views[n] || null;

    const result = buildVoxels(rawViews, opts);
    const lowpoly = prefs.get().lowpoly;
    current = lowpoly ? wedgeMesh(result, { flat }) : voxelMesh(result, { greedy: true }); // greedy meshing is always on
    if (diag && current?.geometry) {
      const geo = current.geometry; // captured: current may change before load resolves
      import('../lib/diag.js').then(({ computeDiag }) => {
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
    stage.scene.add(current);
    stage.setSpinTarget(current);
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
    stage.requestRender(); // the mesh changed — redraw once even if the camera is idle
  }

  // Structural changes and live flushes both rebuild; a lowpoly toggle rebuilds
  // too (autoRotate doesn't — the loop reads it per frame).
  let lastLowpoly = prefs.get().lowpoly;
  const unsubs = [
    doc.subscribe(() => rebuild()),
    doc.onLive(() => rebuild()),
    prefs.subscribe((p) => {
      if (p.lowpoly !== lastLowpoly) {
        lastLowpoly = p.lowpoly;
        rebuild();
      }
    }),
  ];

  return {
    // HMR teardown: stop listening (the stage disposes the scene itself).
    dispose() {
      for (const u of unsubs) u();
    },
  };
}
