// ---------------------------------------------------------------------------
// The mesh rebuilder — the voxel pipeline's ONLY consumer, and just another
// store subscriber: it FOLLOWS THE ACTIVE DOCUMENT (the 3D View serves the
// active window), wiring that context's doc channels — change (load / resize
// / replace-all) and LIVE (the rAF-coalesced stroke flushes; it is that
// channel's only subscriber) — plus the lowpoly pref; each event runs
// ingest → carve → colorize → mesh and swaps the result into the stage. It
// writes what it measured into the `build` slice for the stats readout. No
// active document (the desktop focused with nothing open) empties the stage.
//
// Framing: a build of a NEW sheet (the doc's `sheet` generation moved) — or
// of a newly ACTIVATED document (a window switch is a new subject) — frames
// the camera; every other rebuild is in place and carries the auto-rotate
// spin forward (a fresh mesh starts at rotation 0 — without this the angle
// would visibly snap on every stroke). The generation is left unconsumed on
// an empty build, so the first real build of a fresh sheet still frames
// (e.g. the first stroke on a blank atlas).
//
// The MESH SEAM: `onMesh` hands every built mesh (with its dims) to one
// consumer outside the stage — the 3D Sprite Atlas's renderer (scene/ring.js
// takes a shared-geometry clone) — and null BEFORE the mesh is disposed, so
// no clone is left holding disposed geometry. The rebuilder stays the
// pipeline's only consumer; the seam carries its product.
//
// This being the pipeline's single call site is what makes the future
// Web-Worker carve a drop-in: making this function async is a local change.
// ---------------------------------------------------------------------------

import { buildVoxels } from '../lib/pipeline.js';
import { voxelMesh } from '../lib/mesh.js';
import { wedgeMesh } from '../lib/wedge-mesh.js';
import { VIEW_NAMES } from '../lib/views.js';
import { workspace, followActive } from '../state/workspace.js';
import { prefs } from '../state/prefs.js';
import { build } from '../state/build.js';

/**
 * @param {ReturnType<typeof import('./stage.js').createStage>} stage
 * @param {{
 *   flat?: boolean,
 *   diag?: boolean,
 *   onMesh?: (m: {mesh: import('three').Object3D, dims: {nx: number, ny: number, nz: number}}|null) => void,
 * }} [opts]  the ?flat / ?diag dev flags, and the mesh seam (see the header)
 */
export function initRebuilder(stage, { flat = false, diag = false, onMesh } = {}) {
  let current = null; // THREE.Object3D in the scene
  let activeCtx = null; // the followed context
  let framedSheet = 0; // active doc's sheet generation at the last framed build

  function removeMesh() {
    if (!current) return;
    onMesh?.(null); // the consumer drops its clone before the geometry dies
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
    stage.requestRender(); // the mesh changed — redraw once even if the camera is idle
  }

  // Follow the active document: structural changes and live flushes of ITS
  // doc rebuild; an activation switch is a new subject, so framing resets
  // (`framedSheet` back to never-matching) and the switch itself rebuilds.
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

  // A lowpoly toggle rebuilds too (autoRotate doesn't — the loop reads it per
  // frame).
  let lastLowpoly = prefs.get().lowpoly;
  const unsubPrefs = prefs.subscribe((p) => {
    if (p.lowpoly !== lastLowpoly) {
      lastLowpoly = p.lowpoly;
      rebuild();
    }
  });

  return {
    // HMR teardown: stop listening (the stage disposes the scene itself).
    dispose() {
      stopFollow();
      unsubPrefs();
    },
  };
}
