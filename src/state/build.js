// Build slice: the last mesh build's readout. The rebuilder writes stats and
// warnings. The loaders write errors. dims is null until the first build.
// triangles counts the mesh the 3D View shows. dims, voxels and warnings are
// the whole model's.

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
      store.patch({ dims, voxels, triangles, warnings, error: null });
    },
    /** @param {string} msg */
    setError(msg) {
      store.patch({ error: msg });
    },
  };
}

export const build = createBuild();
