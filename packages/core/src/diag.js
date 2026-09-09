// ---------------------------------------------------------------------------
// Geometry self-check — a dev probe (the app reads it under ?diag=1; a
// consumer can read it off any built mesh). Watertightness via
// position-based edge parity + a per-face normal histogram: a closed surface
// uses every undirected edge exactly twice; edges used an odd number of times
// are boundaries — a genuine hole in a mesh that should be closed.
//
// MODE MATTERS: a nonzero boundary/odd count is only a "hole" for a mesh that
// claims to be watertight. The low-poly (wedge) mesh is — its T-junctions are
// repaired (t-junction.js) — but the greedy-voxel mesh (low-poly OFF) deliberately
// leaves its step-riser T-junctions unrepaired, so it reports nonzero boundary/odd
// edges as EXPECTED artifacts, not holes. main.js tags the ?diag=1 title with the
// mode so the two conditions aren't conflated. This function just counts; it never
// asserts watertightness on its own.
// ---------------------------------------------------------------------------

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
