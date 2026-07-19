// Node-runnable correctness tests for T-junction elimination (pure integer
// geometry; no THREE/DOM). Run: node --test test/t-junction.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { eliminateTJunctions } from '../src/lib/t-junction.js';

// A vertex is a T-junction if it lies strictly interior to some triangle edge.
// (Copied from test/pipeline.test.mjs so this file is self-contained.)
function hasTJunction(tris) {
  const seen = new Set(),
    verts = [];
  for (const t of tris)
    for (const v of [t.a, t.b, t.c]) {
      const k = v.join(',');
      if (!seen.has(k)) seen.add(k), verts.push(v);
    }
  const interior = (p, q, v) => {
    const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const e = [v[0] - p[0], v[1] - p[1], v[2] - p[2]];
    const cx = d[1] * e[2] - d[2] * e[1];
    const cy = d[2] * e[0] - d[0] * e[2];
    const cz = d[0] * e[1] - d[1] * e[0];
    if (cx || cy || cz) return false; // not collinear
    const dot = d[0] * e[0] + d[1] * e[1] + d[2] * e[2];
    const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    return dot > 0 && dot < len2; // strictly between the endpoints
  };
  for (const t of tris)
    for (const [p, q] of [
      [t.a, t.b],
      [t.b, t.c],
      [t.c, t.a],
    ])
      for (const v of verts) if (interior(p, q, v)) return true;
  return false;
}

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
// inherit exactly the color+normal of the source triangle it was cut from.
// Provenance is decided by which source triangle's vertices the output triangle
// lies within; here we simply require each output color to be one of the inputs'
// AND to travel with the matching normal reference.
test('eliminateTJunctions preserves per-triangle color and normal', () => {
  const N0 = [0, 0, 1];
  const N1 = [0, 0, -1]; // deliberately different object identity + value
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
  // tri AS A UNIT — color and its original normal reference stay bonded.
  const validPairs = new Map(tris.map((t) => [t.color, t.normal]));
  for (const t of out) {
    assert.ok(validPairs.has(t.color), `unknown color ${t.color} in output`);
    // normal is passed by reference from the source triangle (===), not copied
    assert.equal(t.normal, validPairs.get(t.color), 'normal ref must match source');
  }
  // and the split triangle (color 111, the one whose edge got subdivided) is
  // present multiple times: its single triangle became several.
  const c111 = out.filter((t) => t.color === 111);
  assert.ok(c111.length >= 3, 'the subdivided triangle produced multiple pieces');
  // every color-111 piece keeps N0 by reference
  for (const t of c111) assert.equal(t.normal, N0);
});

// --- 4. Untouched triangles pass through by identity -------------------------
// A triangle with no interior vertices on any edge is returned as the SAME
// object (the function pushes `t` directly), not a rebuilt copy.
test('eliminateTJunctions returns clean triangles unchanged (same ref)', () => {
  const N = [0, 0, 1];
  const clean = { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], normal: N, color: 9 };
  const out = eliminateTJunctions([clean]);
  assert.equal(out.length, 1);
  assert.equal(out[0], clean); // untouched -> identical reference
  assert.ok(!hasTJunction(out));
});

// --- 5. Fan-fallback path (defensive safety net) ----------------------------
// triangulateConvex's fan fallback only fires if clean-ear clipping fails to
// make progress on a convex polygon. See summary: this is documented as a net
// that clean ear-clipping never reaches for the lattice inputs this module is
// fed, and it is not reachable through the public eliminateTJunctions API with
// a valid convex ring. What IS reachable and worth pinning: a convex ring with
// COLLINEAR boundary points (the multi-interior-vertex case above) is handled
// by the ear-clipping loop's onSeg guard WITHOUT dropping to the fan — the
// output is still T-junction-free and area-conserving, already asserted above.
// We additionally confirm a boundary with several collinear points on ONE edge
// re-triangulates cleanly (the collinear-tolerant path) rather than emitting a
// degenerate (zero-area) triangle.
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
