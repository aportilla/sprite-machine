// Node-runnable tests for the edge hints (pure, no DOM): the seam table probed
// from the projection convention, and the frame the editor draws from it.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EDGE_SEAMS, EDGE_NAMES, edgeHintFrame } from '../src/lib/edges.js';
import { VIEW_NAMES } from 'sprite-machine';

const N = 5; // square tiles: the registering shape

const tile = () => ({
  width: N,
  height: N,
  data: new Uint8ClampedArray(N * N * 4),
});
const sheet = () => Object.fromEntries(VIEW_NAMES.map((v) => [v, tile()]));
const blank = () => Object.fromEntries(VIEW_NAMES.map((v) => [v, null]));

const put = (img, x, y, rgba) => img.data.set(rgba, (y * img.width + x) * 4);
const at = (img, x, y) =>
  Array.from(img.data.subarray((y * img.width + x) * 4).slice(0, 4));

// The texel of a face's OWN tile at index i along one of its four edges, and
// the one `depth` steps in from it — the same seam line, further from the seam.
const edgeTexel = (edge, i, depth = 0) =>
  edge === 'left'
    ? [depth, i]
    : edge === 'right'
      ? [N - 1 - depth, i]
      : edge === 'top'
        ? [i, depth]
        : [i, N - 1 - depth];

// Where index i of one edge's strip lands in the (N+2) x (N+2) frame.
const stripTexel = (edge, i) =>
  edge === 'left'
    ? [0, 1 + i]
    : edge === 'right'
      ? [N + 1, 1 + i]
      : edge === 'top'
        ? [1 + i, 0]
        : [1 + i, N + 1];

// THE RULE, over all twenty-four entries: the strip a face shows on one edge
// reads the NEIGHBOUR'S OWN line running in from that seam, nearest texel
// first, and the two line up texel for texel. Marking a texel on a face's own
// edge — with a DECOY one step deeper on the same line — proves the line
// choice, the direction along the seam and which end the scan starts from, all
// at once; run both ways round it proves the cube's twelve seams symmetric.
test('EDGE_SEAMS: a texel on a face edge shows in the neighbour strip that meets it', () => {
  for (const view of VIEW_NAMES) {
    for (const edge of EDGE_NAMES) {
      const seam = EDGE_SEAMS[view][edge];
      // The neighbour's edge pointing back at us — exactly one of its four.
      const back = EDGE_NAMES.filter((e) => EDGE_SEAMS[seam.view][e].view === view);
      assert.equal(back.length, 1, `${view}.${edge} <- ${seam.view}`);
      const backSeam = EDGE_SEAMS[seam.view][back[0]];
      assert.equal(backSeam.reverse, seam.reverse, `${view}.${edge} reversal disagrees`);

      for (const i of [0, 1, N - 1]) {
        const views = sheet();
        const mark = [10 + i, 20, 30, 255];
        put(views[view], ...edgeTexel(edge, i), mark);
        put(views[view], ...edgeTexel(edge, i, 1), [99, 99, 99, 255]); // the decoy
        const frame = edgeHintFrame(views, N, N, seam.view);
        const j = seam.reverse ? N - 1 - i : i;
        assert.deepEqual(
          at(frame, ...stripTexel(back[0], j)),
          mark,
          `${view}.${edge}[${i}] should reach ${seam.view}.${back[0]}[${j}]`
        );
      }
    }
  }
});

// The strip is the first PAINTED texel in from the seam, not the tile's
// outermost line: sprites carry margins inside their tiles (the built-in Car
// has one on every side), so the outermost line is almost always empty.
test('the strip walks in from the seam past transparent texels', () => {
  const views = sheet();
  const ink = [40, 50, 60, 255];
  put(views.right, N - 3, 2, ink); // three texels in from the RIGHT tile front
  const frame = edgeHintFrame(views, N, N, 'front');
  assert.deepEqual(at(frame, ...stripTexel('left', 2)), ink);
});

// The convention as a human states it: looking at the FRONT, the strip beyond
// the left edge is the front-most COLOURED pixel of the object's own RIGHT
// side — the nose profile, row by row.
test('editing FRONT, the left strip is the RIGHT tile front-most painted texel', () => {
  const views = sheet();
  const nose = [200, 30, 40, 255];
  put(views.right, N - 1, 2, nose); // the RIGHT view puts the front at u = max
  put(views.right, N - 2, 2, [1, 1, 1, 255]); // the body behind it
  const frame = edgeHintFrame(views, N, N, 'front');
  assert.deepEqual(at(frame, ...stripTexel('left', 2)), nose);
});

// A neighbour with no art of its own shows what the model actually renders:
// its opposite, mirrored (MIRROR_AXIS — the onion-skin's own picture).
test('a mirror-derived neighbour contributes its opposite, mirrored', () => {
  const views = sheet();
  const ink = [7, 8, 9, 255];
  views.right = null; // the Car ships without one
  put(views.left, 0, 3, ink); // left's first column mirrors to right's last
  const frame = edgeHintFrame(views, N, N, 'front');
  assert.deepEqual(at(frame, ...stripTexel('left', 3)), ink);
});

test('a neighbour with no art at all leaves its strip transparent', () => {
  const views = blank();
  const frame = edgeHintFrame(views, N, N, 'front');
  assert.ok(frame.data.every((b) => b === 0));
});

// The frame's shape: one texel of margin all round, and nothing in the corners
// — a corner is a lattice EDGE of the voxel box, shared by no single face.
test('edgeHintFrame: the art area and the four corners stay transparent', () => {
  const views = sheet();
  for (const v of VIEW_NAMES) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) put(views[v], x, y, [1, 2, 3, 255]);
    }
  }
  const frame = edgeHintFrame(views, N, N, 'front');
  assert.equal(frame.width, N + 2);
  assert.equal(frame.height, N + 2);
  for (const [x, y] of [
    [0, 0],
    [N + 1, 0],
    [0, N + 1],
    [N + 1, N + 1],
  ]) {
    assert.deepEqual(at(frame, x, y), [0, 0, 0, 0], `corner ${x},${y}`);
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      assert.deepEqual(at(frame, 1 + x, 1 + y), [0, 0, 0, 0], `art ${x},${y}`);
    }
  }
});

test('edgeHintFrame: no frame without a tile', () => {
  assert.equal(edgeHintFrame(sheet(), 0, 0, 'front'), null);
});
