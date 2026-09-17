import { test } from 'node:test';
import assert from 'node:assert/strict';

import { traceRegions, faceRegions } from '../src/regions.js';
import { buildVoxels } from '../src/pipeline.js';
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
  // The ring without its bottom-left cell. The centre and the outside touch at
  // (1, 1), so the outer loop visits that corner twice.
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
  // the notch above each step, right angle at the lower left
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
  // caps of another colour keep the shape and paint their own cells
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

test('a 1:2 staircase wall and its long halves are one region with one diagonal edge, shallow or steep', () => {
  // Columns 3, 3, 2, 2, 1, 1 high, and a long half over each notch pair with
  // its right angle at the lower left.
  const wall = cellsOf(['##....', '####..', '######'], 9);
  const caps = [
    { a: 2, b: 2 },
    { a: 4, b: 1 },
  ].map((c) => ({ ...c, hiA: false, hiB: false, run: 'a', color: 9 }));
  const [r] = traceRegions(wall, caps);
  assert.ok(
    sameRing(r.outer, [
      [0, 0],
      [6, 0],
      [6, 1],
      [2, 3],
      [0, 3],
    ]),
    `the steps are one diagonal: ${JSON.stringify(r.outer)}`
  );
  assert.deepEqual([r.holes.length, r.uniform, r.area2], [0, 9, 2 * 12 + 2 * 2]);

  const [steep] = traceRegions(
    wall.map((c) => ({ ...c, a: c.b, b: c.a })),
    caps.map((h) => ({ ...h, a: h.b, b: h.a, run: 'b' }))
  );
  assert.ok(
    sameRing(steep.outer, [
      [0, 0],
      [3, 0],
      [3, 2],
      [1, 6],
      [0, 6],
    ]),
    `the wall on its side: ${JSON.stringify(steep.outer)}`
  );
  assert.equal(steep.area2, r.area2);

  // A long half paints its second cell with color2.
  const two = traceRegions(wall, [{ ...caps[0], color: 5, color2: 6 }, caps[1]])[0];
  const texel = (g, a, b) => g.texels[a - g.a + (b - g.b) * g.w];
  assert.equal(two.uniform, null);
  assert.deepEqual([texel(two, 2, 2), texel(two, 3, 2), texel(two, 4, 1)], [5, 6, 9]);
  assert.equal(presentCount(two), 12 + 2 * 2);
});

test('a corner where a 45° edge meets a 1:2 edge keeps its vertex', () => {
  const [r] = traceRegions(cellsOf(['#...', '##..', '####'], 9), [
    { a: 1, b: 2, hiA: false, hiB: false, color: 9 },
    { a: 2, b: 1, hiA: false, hiB: false, run: 'a', color: 9 },
  ]);
  assert.ok(
    sameRing(r.outer, [
      [0, 0],
      [4, 0],
      [4, 1],
      [2, 2],
      [1, 3],
      [0, 3],
    ]),
    JSON.stringify(r.outer)
  );
  assert.equal(r.area2, 2 * 7 + 1 + 2);
});

test('a hole whose first edge is a 1:2 diagonal belongs to the outer around it, not to an island on that edge', () => {
  // A ring of cells, each two halves, around a 3×2 hole. A long half hangs
  // from the hole's top-left corner, and an island half touches its far end.
  const square = (a, b) => [
    { a, b, hiA: false, hiB: false, color: 1 },
    { a, b, hiA: true, hiB: true, color: 1 },
  ];
  const ring = [];
  for (let b = 0; b < 4; b++)
    for (let a = 0; a < 5; a++)
      if (a === 0 || a === 4 || b === 0 || b === 3) ring.push(...square(a, b));
  const long = { a: 1, b: 2, hiA: false, hiB: true, run: 'a', color: 1 };
  const island = { a: 2, b: 2, hiA: true, hiB: false, color: 1 };
  const regions = traceRegions([], [long, island, ...ring]);
  assert.equal(regions.length, 2);
  const big = regions.find((g) => g.area2 === 2 * 14 + 2);
  const small = regions.find((g) => g.area2 === 1);
  assert.ok(big && small, JSON.stringify(regions.map((g) => g.area2)));
  assert.deepEqual([big.holes.length, small.holes.length], [1, 0]);
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
