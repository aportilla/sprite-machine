// computeDiag — the geometry self-check behind ?diag=1 and the watertightness
// asserts. It reads position-based edge parity (a closed surface uses every
// undirected edge an even number of times; boundary/odd edges are real holes)
// plus a per-face normal histogram bucketed by dominant axis + sign. It is pure
// and duck-types the geometry, so THREE is never needed — plain stubs suffice.
// Run: node --test test/diag.test.mjs
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

test('indexed geometry is read the same as non-indexed', () => {
  // Same single triangle, but expressed via an explicit index buffer. triCount
  // comes from index.length / 3, and the result must match the non-indexed form.
  const pos = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const nrm = [0, 0, 1, 0, 0, 1, 0, 0, 1];

  const d = computeDiag(stub(pos, nrm, [0, 1, 2]));
  assert.equal(d.triCount, 1);
  assert.equal(d.boundaryEdges, 3);
  assert.equal(d.oddEdges, 3);
  assert.equal(d.uniqueEdges, 3);
  assert.deepEqual(d.hist, { px: 0, nx: 0, py: 0, ny: 0, pz: 1, nz: 0 });
});

test('two triangles sharing one edge — interior edge is even, rim is boundary', () => {
  // A unit quad split into two tris across the (1,0,0)-(0,1,0) diagonal. The
  // shared diagonal is used twice (even); the other 4 rim edges once each.
  // prettier-ignore
  const pos = [
    0, 0, 0,  1, 0, 0,  0, 1, 0, // tri A
    1, 0, 0,  1, 1, 0,  0, 1, 0, // tri B
  ];
  // Distinct first-vertex normals so the histogram splits across two buckets.
  // prettier-ignore
  const nrm = [
    1, 0,  0,  1, 0,  0,  1, 0,  0, // tri A first vertex -> px
    0, 0, -1,  0, 0, -1,  0, 0, -1, // tri B first vertex -> nz
  ];

  const d = computeDiag(stub(pos, nrm));
  assert.equal(d.triCount, 2);
  assert.equal(d.uniqueEdges, 5, 'shared diagonal collapses 6 edge-uses to 5 edges');
  assert.equal(d.boundaryEdges, 4, 'four rim edges are used once each');
  assert.equal(d.oddEdges, 4, 'the shared diagonal (used twice) is not odd');
  assert.deepEqual(
    d.hist,
    { px: 1, nx: 0, py: 0, ny: 0, pz: 0, nz: 1 },
    'one tally per triangle, keyed by its first vertex normal'
  );
});

test('histogram buckets by dominant axis + sign, reading only the first vertex normal', () => {
  // Six disjoint triangles, one per face axis. The axis is placed only on each
  // triangle's FIRST vertex (others zeroed) to prove computeDiag reads only the
  // first vertex's normal per triangle.
  const axes = [
    [1, 0, 0], // px
    [-1, 0, 0], // nx
    [0, 1, 0], // py
    [0, -1, 0], // ny
    [0, 0, 1], // pz
    [0, 0, -1], // nz
  ];
  const pos = [];
  const nrm = [];
  let ox = 0;
  for (const a of axes) {
    pos.push(ox, 0, 0, ox + 0.1, 0, 0, ox, 0.1, 0);
    ox += 10; // large offset keeps every triangle disjoint
    nrm.push(a[0], a[1], a[2], 0, 0, 0, 0, 0, 0);
  }

  const d = computeDiag(stub(pos, nrm));
  assert.equal(d.triCount, 6);
  assert.deepEqual(
    d.hist,
    { px: 1, nx: 1, py: 1, ny: 1, pz: 1, nz: 1 },
    'each axis+sign gets exactly one first-vertex tally'
  );
  // Six disjoint triangles => 18 distinct edges, all used exactly once.
  assert.equal(d.uniqueEdges, 18);
  assert.equal(d.boundaryEdges, 18);
  assert.equal(d.oddEdges, 18);
});
