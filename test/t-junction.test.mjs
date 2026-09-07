// Node-runnable correctness tests for T-junction elimination (pure integer
// geometry; no THREE/DOM): a long edge splits at every interior lattice vertex,
// the area is conserved, each piece keeps its source's color and normal, and a
// collinear-heavy edge yields no degenerate triangle.
// Run: node --test test/t-junction.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { eliminateTJunctions } from '../src/lib/t-junction.js';
import { hasTJunction } from './helpers.mjs';

// Twice the triangle area = magnitude of the edge cross-product.
const tri2Area = (t) => {
  const u = [t.b[0] - t.a[0], t.b[1] - t.a[1], t.b[2] - t.a[2]];
  const v = [t.c[0] - t.a[0], t.c[1] - t.a[1], t.c[2] - t.a[2]];
  const cx = u[1] * v[2] - u[2] * v[1];
  const cy = u[2] * v[0] - u[0] * v[2];
  const cz = u[0] * v[1] - u[1] * v[0];
  return Math.hypot(cx, cy, cz);
};
const totalArea = (tris) => tris.reduce((n, t) => n + tri2Area(t), 0);

// --- 1. Long edge with MULTIPLE interior lattice vertices -------------------
// A merged rect spans x=0..4 along its bottom edge (y=0,z=0). Three neighbor
// triangles poke vertices at x=1, x=2, x=3 into that edge's interior. The
// repair must split the rect's long edge at all three points.
test('eliminateTJunctions splits a long edge at multiple interior verts', () => {
  const N = [0, 0, 1];
  const tris = [
    // the merged base rect (two tris), long bottom edge x=0..4 at y=0,z=0
    { a: [0, 0, 0], b: [4, 0, 0], c: [4, 2, 0], normal: N, color: 1 },
    { a: [0, 0, 0], b: [4, 2, 0], c: [0, 2, 0], normal: N, color: 1 },
    // three unit neighbors below, each contributing one interior vertex
    { a: [1, 0, 0], b: [1, -2, 0], c: [0, -2, 0], normal: N, color: 2 },
    { a: [2, 0, 0], b: [2, -2, 0], c: [1, -2, 0], normal: N, color: 3 },
    { a: [3, 0, 0], b: [3, -2, 0], c: [2, -2, 0], normal: N, color: 4 },
  ];
  // all three of x=1,2,3 land strictly interior to the rect's x=0..4 edge
  assert.ok(hasTJunction(tris), 'setup must contain T-junctions on the long edge');
  const out = eliminateTJunctions(tris);
  assert.ok(!hasTJunction(out), 'repaired mesh has no interior-edge vertices');
  assert.ok(out.length > tris.length, 'the long edge was subdivided into more tris');
});

// --- 2. Area conservation ---------------------------------------------------
// Re-triangulating a convex polygon at added boundary points must not change
// the covered area. Compare the summed triangle area before/after.
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

// --- 3. Color + normal preservation -----------------------------------------
// Give the two rect triangles DISTINCT colors and DISTINCT normals (even though
// they are coplanar, the field is carried verbatim). Every output triangle must
// inherit exactly the color+normal of the source triangle it was cut from; here
// we require each output color to be one of the inputs' AND to travel with the
// matching normal value.
test('eliminateTJunctions preserves per-triangle color and normal', () => {
  const N0 = [0, 0, 1];
  const N1 = [0, 0, -1]; // deliberately a different value
  const tris = [
    { a: [0, 0, 0], b: [4, 0, 0], c: [4, 2, 0], normal: N0, color: 111 },
    { a: [0, 2, 0], b: [4, 2, 0], c: [0, 0, 0], normal: N1, color: 222 },
    // neighbor putting interior vertices at x=1,2,3 on the shared long edge
    { a: [1, 0, 0], b: [1, -2, 0], c: [0, -2, 0], normal: N0, color: 5 },
    { a: [2, 0, 0], b: [2, -2, 0], c: [1, -2, 0], normal: N0, color: 6 },
    { a: [3, 0, 0], b: [3, -2, 0], c: [2, -2, 0], normal: N0, color: 7 },
  ];
  const out = eliminateTJunctions(tris);
  // Every output tri must carry a (color, normal) pair that came from an input
  // tri AS A UNIT — color and its source normal stay bonded.
  const validPairs = new Map(tris.map((t) => [t.color, t.normal]));
  for (const t of out) {
    assert.ok(validPairs.has(t.color), `unknown color ${t.color} in output`);
    assert.deepEqual(t.normal, validPairs.get(t.color), 'normal must match its source');
  }
  // and the split triangle (color 111, the one whose edge got subdivided) is
  // present multiple times: its single triangle became several.
  const c111 = out.filter((t) => t.color === 111);
  assert.ok(c111.length >= 3, 'the subdivided triangle produced multiple pieces');
  // every color-111 piece keeps N0
  for (const t of c111) assert.deepEqual(t.normal, N0);
});

// --- 3b. A 45° diagonal edge ---------------------------------------------------
// A slope block's staircase edge and a region's cut beside it are long
// diagonals since the planar merge; a corner of another plane landing on one
// is a T-junction the repair must split exactly like an axis-aligned edge's.
test('eliminateTJunctions splits a 45° diagonal edge at a lattice vertex on it', () => {
  const N = [0, 0, 1];
  const tris = [
    // a slope-shaped triangle whose hypotenuse runs (0,0) -> (4,4)
    { a: [0, 0, 0], b: [4, 4, 0], c: [0, 4, 0], normal: N, color: 1 },
    // neighbours below the diagonal with vertices at (1,1) and (3,3)
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

// --- 4. Fan-fallback path (defensive safety net) ----------------------------
// triangulateConvex's fan fallback only fires if clean-ear clipping fails to
// make progress on a convex polygon — a net that clean ear-clipping never
// reaches for the lattice inputs this module is fed, and not reachable through
// the public eliminateTJunctions API with a valid convex ring. What IS reachable
// and worth pinning: a convex ring with COLLINEAR boundary points (the
// multi-interior-vertex case above) is handled by the ear-clipping loop's onSeg
// guard WITHOUT dropping to the fan — the output is still T-junction-free and
// area-conserving, already asserted above. We additionally confirm a boundary
// with several collinear points on ONE edge re-triangulates cleanly (the
// collinear-tolerant path) rather than emitting a degenerate (zero-area)
// triangle.
test('eliminateTJunctions emits no degenerate tris on a collinear-heavy edge', () => {
  const N = [0, 0, 1];
  const tris = [
    // long edge x=0..4 with interior points x=1,2,3 forced in by neighbors
    { a: [0, 0, 0], b: [4, 0, 0], c: [2, 3, 0], normal: N, color: 1 },
    { a: [1, 0, 0], b: [1, -1, 0], c: [0, -1, 0], normal: N, color: 2 },
    { a: [2, 0, 0], b: [2, -1, 0], c: [1, -1, 0], normal: N, color: 3 },
    { a: [3, 0, 0], b: [3, -1, 0], c: [2, -1, 0], normal: N, color: 4 },
  ];
  const out = eliminateTJunctions(tris);
  assert.ok(!hasTJunction(out));
  // no zero-area (degenerate) triangles slipped through
  for (const t of out) assert.ok(tri2Area(t) > 1e-9, 'no degenerate output triangle');
  // area is still conserved through the collinear-tolerant re-triangulation
  assert.ok(Math.abs(totalArea(tris) - totalArea(out)) < 1e-9);
});
