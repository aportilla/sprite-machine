import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeDiag } from '../src/diag.js';

// A geometry with the fields computeDiag reads. A null index means non-indexed
// geometry.
function stub(position, normal, index = null) {
  return { position, normal, index };
}

test('closed surface (tetrahedron) — no boundary or odd edges', () => {
  // A tetrahedron has 6 edges, each shared by two of its 4 faces.
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
      nrm.push(0, 1, 0); // every normal buckets to py
    }
  }

  const d = computeDiag(stub(pos, nrm));
  assert.equal(d.triCount, 4, 'four triangles');
  assert.equal(d.boundaryEdges, 0, 'a closed surface has no boundary edges');
  assert.equal(d.oddEdges, 0, 'every edge is used an even number of times');
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
