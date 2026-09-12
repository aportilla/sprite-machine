// Geometry self-check for development (the app's ?diag=1). Edges are matched by
// vertex position. A closed surface uses every undirected edge exactly twice, so
// edges used an odd number of times are boundaries. Also returns a histogram of
// triangle normals by axis.

/** @param {import('three').BufferGeometry} geo */
export function computeDiag(geo) {
  const pos = geo.attributes.position.array;
  const nrm = geo.attributes.normal.array;
  const idx = geo.index ? geo.index.array : null;
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  const key = (i) => {
    const x = Math.round(pos[i * 3] * 1e4);
    const y = Math.round(pos[i * 3 + 1] * 1e4);
    const z = Math.round(pos[i * 3 + 2] * 1e4);
    return x + ',' + y + ',' + z;
  };
  const edges = new Map();
  const axis = (i) => {
    const ax = Math.abs(nrm[i * 3]),
      ay = Math.abs(nrm[i * 3 + 1]),
      az = Math.abs(nrm[i * 3 + 2]);
    if (ax >= ay && ax >= az) return nrm[i * 3] > 0 ? 'px' : 'nx';
    if (ay >= az) return nrm[i * 3 + 1] > 0 ? 'py' : 'ny';
    return nrm[i * 3 + 2] > 0 ? 'pz' : 'nz';
  };
  const hist = { px: 0, nx: 0, py: 0, ny: 0, pz: 0, nz: 0 };
  for (let t = 0; t < triCount; t++) {
    const a = idx ? idx[t * 3] : t * 3;
    const b = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const c = idx ? idx[t * 3 + 2] : t * 3 + 2;
    hist[axis(a)]++;
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const ka = key(p),
        kb = key(q);
      const e = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      edges.set(e, (edges.get(e) || 0) + 1);
    }
  }
  let boundary = 0,
    odd = 0;
  for (const n of edges.values()) {
    if (n === 1) boundary++;
    if (n % 2 === 1) odd++;
  }
  return {
    triCount,
    hist,
    uniqueEdges: edges.size,
    boundaryEdges: boundary,
    oddEdges: odd,
  };
}
