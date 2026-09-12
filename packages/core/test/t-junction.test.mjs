import { test } from 'node:test';
import assert from 'node:assert/strict';

import { eliminateTJunctions } from '../src/t-junction.js';
import { hasTJunction } from './helpers.mjs';

// Twice the triangle area: the magnitude of the edge cross product.
const tri2Area = (t) => {
  const u = [t.b[0] - t.a[0], t.b[1] - t.a[1], t.b[2] - t.a[2]];
  const v = [t.c[0] - t.a[0], t.c[1] - t.a[1], t.c[2] - t.a[2]];
  const cx = u[1] * v[2] - u[2] * v[1];
  const cy = u[2] * v[0] - u[0] * v[2];
  const cz = u[0] * v[1] - u[1] * v[0];
  return Math.hypot(cx, cy, cz);
};
const totalArea = (tris) => tris.reduce((n, t) => n + tri2Area(t), 0);

// A rect's bottom edge spans x=0..4 at y=0, z=0. Three neighbors put vertices
// on it at x=1, 2 and 3.
test('eliminateTJunctions splits a long edge at multiple interior verts', () => {
  const N = [0, 0, 1];
  const tris = [
    // the rect (two tris)
    { a: [0, 0, 0], b: [4, 0, 0], c: [4, 2, 0], normal: N, color: 1 },
    { a: [0, 0, 0], b: [4, 2, 0], c: [0, 2, 0], normal: N, color: 1 },
    // three neighbors below
    { a: [1, 0, 0], b: [1, -2, 0], c: [0, -2, 0], normal: N, color: 2 },
    { a: [2, 0, 0], b: [2, -2, 0], c: [1, -2, 0], normal: N, color: 3 },
    { a: [3, 0, 0], b: [3, -2, 0], c: [2, -2, 0], normal: N, color: 4 },
  ];
  assert.ok(hasTJunction(tris), 'setup must contain T-junctions on the long edge');
  const out = eliminateTJunctions(tris);
  assert.ok(!hasTJunction(out), 'repaired mesh has no interior-edge vertices');
  assert.ok(out.length > tris.length, 'the long edge was subdivided into more tris');
});

test('eliminateTJunctions conserves total triangle area', () => {
  const N = [0, 0, 1];
  const tris = [
    { a: [0, 0, 0], b: [4, 0, 0], c: [4, 2, 0], normal: N, color: 1 },
    { a: [0, 0, 0], b: [4, 2, 0], c: [0, 2, 0], normal: N, color: 1 },
    { a: [1, 0, 0], b: [1, -2, 0], c: [0, -2, 0], normal: N, color: 2 },
    { a: [2, 0, 0], b: [2, -2, 0], c: [1, -2, 0], normal: N, color: 3 },
    { a: [3, 0, 0], b: [3, -2, 0], c: [2, -2, 0], normal: N, color: 4 },
  ];
  const before = totalArea(tris);
  const out = eliminateTJunctions(tris);
  const after = totalArea(out);
  assert.ok(before > 0, 'sanity: input has nonzero area');
  assert.ok(Math.abs(before - after) < 1e-9, `area drift ${before} -> ${after}`);
});

// The two rect triangles are coplanar but carry distinct colors and normals.
// Each output triangle keeps the color and normal of its source.
test('eliminateTJunctions preserves per-triangle color and normal', () => {
  const N0 = [0, 0, 1];
  const N1 = [0, 0, -1];
  const tris = [
    { a: [0, 0, 0], b: [4, 0, 0], c: [4, 2, 0], normal: N0, color: 111 },
    { a: [0, 2, 0], b: [4, 2, 0], c: [0, 0, 0], normal: N1, color: 222 },
    // neighbors with vertices at x=1,2,3 on the long edge
    { a: [1, 0, 0], b: [1, -2, 0], c: [0, -2, 0], normal: N0, color: 5 },
    { a: [2, 0, 0], b: [2, -2, 0], c: [1, -2, 0], normal: N0, color: 6 },
    { a: [3, 0, 0], b: [3, -2, 0], c: [2, -2, 0], normal: N0, color: 7 },
  ];
  const out = eliminateTJunctions(tris);
  const validPairs = new Map(tris.map((t) => [t.color, t.normal]));
  for (const t of out) {
    assert.ok(validPairs.has(t.color), `unknown color ${t.color} in output`);
    assert.deepEqual(t.normal, validPairs.get(t.color), 'normal must match its source');
  }
  const c111 = out.filter((t) => t.color === 111);
  assert.ok(c111.length >= 3, 'the subdivided triangle produced multiple pieces');
  for (const t of c111) assert.deepEqual(t.normal, N0);
});

// A slope or region edge can be a 45° diagonal, and a vertex on it is a
// T-junction too.
test('eliminateTJunctions splits a 45° diagonal edge at a lattice vertex on it', () => {
  const N = [0, 0, 1];
  const tris = [
    // hypotenuse (0,0) -> (4,4)
    { a: [0, 0, 0], b: [4, 4, 0], c: [0, 4, 0], normal: N, color: 1 },
    // neighbors below the diagonal with vertices at (1,1) and (3,3)
    { a: [1, 1, 0], b: [2, 0, 0], c: [1, 0, 0], normal: N, color: 2 },
    { a: [3, 3, 0], b: [4, 2, 0], c: [3, 2, 0], normal: N, color: 3 },
  ];
  assert.ok(hasTJunction(tris), 'setup: vertices sit inside the diagonal');
  const out = eliminateTJunctions(tris);
  assert.ok(!hasTJunction(out));
  assert.ok(Math.abs(totalArea(tris) - totalArea(out)) < 1e-9);
  for (const t of out) assert.ok(tri2Area(t) > 1e-9, 'no degenerate output triangle');
  assert.ok(out.filter((t) => t.color === 1).length >= 3, 'the diagonal was subdivided');
});

// Several collinear points on one edge go through ear clipping's onSeg guard.
test('eliminateTJunctions emits no degenerate tris on a collinear-heavy edge', () => {
  const N = [0, 0, 1];
  const tris = [
    // edge x=0..4, neighbors add points at x=1,2,3
    { a: [0, 0, 0], b: [4, 0, 0], c: [2, 3, 0], normal: N, color: 1 },
    { a: [1, 0, 0], b: [1, -1, 0], c: [0, -1, 0], normal: N, color: 2 },
    { a: [2, 0, 0], b: [2, -1, 0], c: [1, -1, 0], normal: N, color: 3 },
    { a: [3, 0, 0], b: [3, -1, 0], c: [2, -1, 0], normal: N, color: 4 },
  ];
  const out = eliminateTJunctions(tris);
  assert.ok(!hasTJunction(out));
  for (const t of out) assert.ok(tri2Area(t) > 1e-9, 'no degenerate output triangle');
  assert.ok(Math.abs(totalArea(tris) - totalArea(out)) < 1e-9);
});
