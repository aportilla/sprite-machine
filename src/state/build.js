// ---------------------------------------------------------------------------
// `build` slice — the last mesh build's readout. Written by the rebuilder
// (stats + warnings) and the loaders (errors); the 3D View's status line
// reads the triangle count off it (dims null = no build yet, the line
// empty). An `error` (a failed decode / unusable sample) stands until the
// next successful build's `setStats` clears it — the same contract the old
// `ui.setStats` / `ui.setError` pair implemented — but `error` and
// `warnings` are RECORDED ONLY: the status line reads its count regardless,
// and no other surface shows them yet.
// ---------------------------------------------------------------------------

import { createStore } from './store.js';

export function createBuild() {
  const store = createStore({
    /** @type {{nx:number,ny:number,nz:number}|null} */
    dims: null,
    voxels: 0,
    triangles: 0,
    /** @type {string[]} */
    warnings: [],
    /** @type {string|null} */
    error: null,
  });
  return {
    store,
    get: store.get,
    subscribe: store.subscribe,
    /** @param {{dims:object|null, voxels:number, triangles:number, warnings:string[]}} s */
    setStats({ dims, voxels, triangles, warnings }) {
      // A successful build clears any standing error.
      store.patch({ dims, voxels, triangles, warnings, error: null });
    },
    /** @param {string} msg */
    setError(msg) {
      store.patch({ error: msg });
    },
  };
}

export const build = createBuild();
