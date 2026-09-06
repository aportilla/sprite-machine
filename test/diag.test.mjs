// computeDiag — the geometry self-check behind ?diag=1 and the watertightness
// asserts. It reads position-based edge parity (a closed surface uses every
// undirected edge an even number of times; boundary/odd edges are a hole in a
// mesh that should be closed) plus a per-face normal histogram bucketed by
// dominant axis + sign. It is pure and duck-types the geometry, so THREE is
// never needed — plain stubs suffice. Pinned on the two ends: a closed
// surface and an open one. Run: node --test test/diag.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeDiag } from '../src/lib/diag.js';

// A geometry-like stub: computeDiag only reads geo.attributes.position.array,
// geo.attributes.normal.array, and geo.index (null => non-indexed geometry,
// so triCount = position.length / 9 and triangle t uses verts t*3, t*3+1, t*3+2).
function stub(position, normal, index = null) {
  return {
    attributes: {
      position: { array: position },
      normal: { array: normal },
    },
    index: index ? { array: index } : null,
  };
}

test('closed surface (tetrahedron) — no boundary or odd edges', () => {
  // 4 vertices, 4 triangular faces. Every undirected edge is shared by exactly
  // two triangles, so a welded tetrahedron is watertight.
  const V = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const faces = [
    [0, 1, 2],
    [0, 1, 3],
    [0, 2, 3],
    [1, 2, 3],
  ];
  const pos = [];
  const nrm = [];
  for (const f of faces) {
    for (const vi of f) {
      pos.push(...V[vi]);
      nrm.push(0, 1, 0); // first-vertex axis of every tri -> py
    }
  }

  const d = computeDiag(stub(pos, nrm));
  assert.equal(d.triCount, 4, 'four triangles');
  assert.equal(d.boundaryEdges, 0, 'a closed surface has no boundary edges');
  assert.equal(d.oddEdges, 0, 'every edge is used an even number of times');
  // A tetrahedron has 6 distinct undirected edges, each shared by two faces.
  assert.equal(d.uniqueEdges, 6, 'six shared edges');
  assert.deepEqual(
    d.hist,
    { px: 0, nx: 0, py: 4, ny: 0, pz: 0, nz: 0 },
    'all four first-vertex normals bucket to py'
  );
});

test('open surface (single triangle) — every edge is a boundary', () => {
  const pos = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const nrm = [0, 0, 1, 0, 0, 1, 0, 0, 1]; // facing +Z

  const d = computeDiag(stub(pos, nrm));
  assert.equal(d.triCount, 1, 'one triangle');
  assert.equal(d.uniqueEdges, 3, 'three distinct edges');
  assert.equal(d.boundaryEdges, 3, 'each edge is used exactly once => boundary');
  assert.equal(d.oddEdges, 3, 'each edge is used an odd number of times');
  assert.deepEqual(
    d.hist,
    { px: 0, nx: 0, py: 0, ny: 0, pz: 1, nz: 0 },
    'the lone triangle buckets to pz'
  );
});
