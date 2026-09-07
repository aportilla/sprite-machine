// The coplanar regions (src/lib/regions.js — pure, no THREE): a plane's
// pieces traced into loops with every collinear run merged, outers and holes
// told apart and paired, two cells meeting at a corner two regions while a
// bay open at a corner rides one loop through it twice, and a staircase wall
// with its gable caps folded in as ONE region with one straight diagonal edge
// — the reason the module exists. Run: node --test test/regions.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { traceRegions, faceRegions } from '../src/lib/regions.js';
import { buildVoxels } from '../src/lib/pipeline.js';
import { fill } from './helpers.mjs';

/** Rows of '#' (top row first, b counting up from the bottom row) -> cells. */
const cellsOf = (rows, color = 1) => {
  const out = [];
  rows.forEach((row, j) =>
    [...row].forEach((ch, i) => {
      if (ch === '#') out.push({ a: i, b: rows.length - 1 - j, color });
    })
  );
  return out;
};
/** A loop equals an expected ring up to rotation (same direction). */
const sameRing = (loop, expected) => {
  if (loop.length !== expected.length) return false;
  const k = loop.findIndex(([a, b]) => a === expected[0][0] && b === expected[0][1]);
  if (k < 0) return false;
  return expected.every(([a, b], i) => {
    const [la, lb] = loop[(k + i) % loop.length];
    return la === a && lb === b;
  });
};
const presentCount = (r) => r.present.reduce((n, p) => n + p, 0);

test('one cell is a four-corner outer of one colour; an L keeps its six corners', () => {
  const [one] = traceRegions([{ a: 2, b: 3, color: 7 }], []);
  assert.ok(
    sameRing(one.outer, [
      [2, 3],
      [3, 3],
      [3, 4],
      [2, 4],
    ]),
    'CCW around the cell'
  );
  assert.deepEqual([one.holes.length, one.a, one.b, one.w, one.h], [0, 2, 3, 1, 1]);
  assert.deepEqual([one.uniform, one.area2, presentCount(one)], [7, 2, 1]);

  const ells = traceRegions(cellsOf(['#.', '##']), []);
  assert.equal(ells.length, 1);
  assert.ok(
    sameRing(ells[0].outer, [
      [0, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [1, 2],
      [0, 2],
    ]),
    'the straight runs merged, the corners kept'
  );
});

test('a ring is one region with a hole; two cells on a corner are two regions', () => {
  const [ring] = traceRegions(cellsOf(['###', '#.#', '###']), []);
  assert.ok(
    sameRing(ring.outer, [
      [0, 0],
      [3, 0],
      [3, 3],
      [0, 3],
    ])
  );
  assert.equal(ring.holes.length, 1);
  assert.ok(
    sameRing(ring.holes[0], [
      [1, 1],
      [1, 2],
      [2, 2],
      [2, 1],
    ]),
    'the hole runs the other way, the region on its left'
  );
  assert.deepEqual([presentCount(ring), ring.w, ring.h], [8, 3, 3]);

  const pair = traceRegions(cellsOf(['.#', '#.']), []);
  assert.equal(pair.length, 2, 'a corner touch joins nothing');
  for (const r of pair) assert.equal(r.outer.length, 4);
});

test('a bay that opens onto the outside at a corner is no hole: one outer loop through the pinch twice', () => {
  // the ring less its bottom-left cell: the centre and the outside touch at
  // (1, 1), so the boundary is ONE curve visiting that corner twice — the
  // self-touching ring earcut builds itself when it bridges a hole
  const regions = traceRegions(cellsOf(['###', '#.#', '.##']), []);
  assert.equal(regions.length, 1);
  const [r] = regions;
  assert.equal(r.holes.length, 0);
  assert.equal(
    r.outer.filter(([a, b]) => a === 1 && b === 1).length,
    2,
    'the pinch, twice'
  );
  assert.equal(r.outer.length, 10);
  assert.deepEqual([presentCount(r), r.area2], [7, 14]);
});

test('a staircase wall and its gable caps are one region with ONE straight diagonal edge', () => {
  const wall = cellsOf(['#...', '##..', '###.', '####'], 9);
  // the notch above each step's last cell, its right angle at the lower-left
  const caps = [1, 2, 3].map((b) => ({ a: 4 - b, b, hiA: false, hiB: false, color: 9 }));
  const [r] = traceRegions(wall, caps);
  assert.ok(
    sameRing(r.outer, [
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 4],
      [0, 4],
    ]),
    `the sawtooth is one diagonal: ${JSON.stringify(r.outer)}`
  );
  assert.deepEqual([r.holes.length, r.uniform, r.area2], [0, 9, 2 * 10 + 3]);
  // a cap of another colour keeps the shape, charts the region and paints its cell
  const two = traceRegions(
    wall,
    caps.map((c) => ({ ...c, color: 5 }))
  )[0];
  assert.equal(two.outer.length, 5);
  assert.equal(two.uniform, null);
  assert.equal(
    two.texels[3 - two.a + (1 - two.b) * two.w],
    5,
    "the cap's cell holds the cap's colour"
  );
  assert.equal(two.texels[0], 9);
});

test('faceRegions: a solid cube is six quads, every exposed face in one region', () => {
  const r = buildVoxels(
    { front: fill(3, 3, 'M'), right: fill(3, 3, 'N'), top: fill(3, 3, 'T') },
    { mirror: { x: true, y: false, z: false } }
  );
  const regions = faceRegions(r.dims, r.surfaceMask, r.faceColor);
  assert.equal(regions.length, 6);
  let covered = 0;
  for (const g of regions) {
    assert.equal(g.outer.length, 4);
    assert.equal(g.holes.length, 0);
    assert.notEqual(g.uniform, null, 'one colour a face');
    covered += presentCount(g);
  }
  let exposed = 0;
  for (const m of r.surfaceMask) for (let f = 0; f < 6; f++) if (m & (1 << f)) exposed++;
  assert.equal(covered, exposed);
});
