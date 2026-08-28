// Node-runnable tests for the selection tool's primitives (pure, no DOM):
// the bounds helpers, the axis lock, and the lift / clear / composite trio
// with the transparency rule and the no-wrap clip. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeBounds,
  boundsContain,
  translateBounds,
  constrainAxis,
  liftRect,
  clearRect,
  compositeFloat,
} from '../src/lib/select.js';

// A w×h RGBA buffer painted from a map of "x,y" → [r,g,b] (everything else
// transparent), and the inverse: the set of "x,y" keys holding an opaque
// texel, for shape assertions.
function buffer(w, h, paint = {}) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (const [key, rgb] of Object.entries(paint)) {
    const [x, y] = key.split(',').map(Number);
    const i = (y * w + x) * 4;
    d[i] = rgb[0];
    d[i + 1] = rgb[1];
    d[i + 2] = rgb[2];
    d[i + 3] = 255;
  }
  return d;
}
function opaqueKeys(d, w) {
  const keys = new Set();
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] !== 0) {
      const p = (i - 3) / 4;
      keys.add(`${p % w},${Math.floor(p / w)}`);
    }
  }
  return keys;
}
const texel = (d, w, x, y) =>
  Array.from(d.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];

test('normalizeBounds orders any corner pair top-left → bottom-right', () => {
  const b = { x0: 2, y0: 3, x1: 7, y1: 9 };
  assert.deepEqual(normalizeBounds({ px: 2, py: 3 }, { px: 7, py: 9 }), b);
  assert.deepEqual(normalizeBounds({ px: 7, py: 9 }, { px: 2, py: 3 }), b);
  assert.deepEqual(normalizeBounds({ px: 7, py: 3 }, { px: 2, py: 9 }), b);
  assert.deepEqual(normalizeBounds({ px: 2, py: 9 }, { px: 7, py: 3 }), b);
  // A single texel is its own 1×1 bounds.
  assert.deepEqual(normalizeBounds({ px: 4, py: 4 }, { px: 4, py: 4 }), {
    x0: 4,
    y0: 4,
    x1: 4,
    y1: 4,
  });
});

test('boundsContain is inclusive on all four edges', () => {
  const b = { x0: 2, y0: 3, x1: 7, y1: 9 };
  for (const [x, y] of [
    [2, 3],
    [7, 3],
    [2, 9],
    [7, 9],
    [4, 6],
  ])
    assert.ok(boundsContain(b, x, y), `${x},${y} inside`);
  for (const [x, y] of [
    [1, 3],
    [8, 3],
    [2, 2],
    [2, 10],
    [0, 0],
  ])
    assert.ok(!boundsContain(b, x, y), `${x},${y} outside`);
});

test('translateBounds is a pure shift — it may leave the tile', () => {
  const b = { x0: 2, y0: 3, x1: 7, y1: 9 };
  assert.deepEqual(translateBounds(b, 5, -4), { x0: 7, y0: -1, x1: 12, y1: 5 });
  assert.deepEqual(b, { x0: 2, y0: 3, x1: 7, y1: 9 }, 'the input is untouched');
  assert.deepEqual(translateBounds(b, 0, 0), b);
});

test('constrainAxis: the dominant axis wins, a tie keeps dx, zero stays zero', () => {
  assert.deepEqual(constrainAxis(5, 2), { dx: 5, dy: 0 }, 'wider wins');
  assert.deepEqual(constrainAxis(-5, 2), { dx: -5, dy: 0 }, 'sign kept');
  assert.deepEqual(constrainAxis(1, -6), { dx: 0, dy: -6 }, 'taller wins');
  assert.deepEqual(constrainAxis(3, 3), { dx: 3, dy: 0 }, 'a tie keeps dx');
  assert.deepEqual(constrainAxis(-3, 3), { dx: -3, dy: 0 }, 'a tie keeps dx (signed)');
  assert.deepEqual(constrainAxis(0, 0), { dx: 0, dy: 0 });
});

test('liftRect copies exactly the rect and counts its opaque texels', () => {
  const W = 8;
  const H = 6;
  const src = buffer(W, H, { '2,1': RED, '3,2': BLUE, '6,4': RED });
  const before = src.slice();
  const f = liftRect(src, W, { x0: 2, y0: 1, x1: 4, y1: 3 });
  assert.equal(f.width, 3);
  assert.equal(f.height, 3);
  assert.equal(f.data.length, 3 * 3 * 4);
  assert.deepEqual(texel(f.data, 3, 0, 0), [255, 0, 0, 255], '(2,1) → float (0,0)');
  assert.deepEqual(texel(f.data, 3, 1, 1), [0, 0, 255, 255], '(3,2) → float (1,1)');
  assert.deepEqual(texel(f.data, 3, 2, 2), [0, 0, 0, 0], 'an empty texel lifts empty');
  assert.equal(f.opaque, 2, 'two painted texels inside the rect; (6,4) is outside');
  assert.deepEqual(src, before, 'the source is untouched');
});

test('liftRect: opaque is 0 over empty space; stray RGB under alpha 0 is empty', () => {
  const W = 5;
  const src = buffer(W, 5);
  // Stray RGB under alpha 0 — the hard-pixel rule says it is not a pixel.
  src[(2 * W + 2) * 4] = 200;
  src[(2 * W + 2) * 4 + 1] = 100;
  const f = liftRect(src, W, { x0: 1, y0: 1, x1: 3, y1: 3 });
  assert.equal(f.opaque, 0);
  const g = liftRect(
    buffer(W, 5, { '1,1': RED, '2,2': RED, '3,3': RED, '4,4': RED }),
    W,
    {
      x0: 1,
      y0: 1,
      x1: 3,
      y1: 3,
    }
  );
  assert.equal(g.opaque, 3, 'N painted texels inside count N; the one outside does not');
});

test('clearRect zeroes all four bytes of the rect and reports whether anything changed', () => {
  const W = 6;
  const d = buffer(W, 6, { '1,1': RED, '2,2': BLUE, '5,5': RED });
  // Stray RGB under alpha 0 inside the rect — counts as a change to clear.
  d[(3 * W + 3) * 4] = 77;
  assert.equal(clearRect(d, W, { x0: 1, y0: 1, x1: 3, y1: 3 }), true);
  for (let y = 1; y <= 3; y++)
    for (let x = 1; x <= 3; x++)
      assert.deepEqual(texel(d, W, x, y), [0, 0, 0, 0], `${x},${y} cleared`);
  assert.deepEqual(texel(d, W, 5, 5), [255, 0, 0, 255], 'outside the rect untouched');
  assert.equal(
    clearRect(d, W, { x0: 1, y0: 1, x1: 3, y1: 3 }),
    false,
    'an already-transparent rect reports no change'
  );
});

test('identity: lift → clear → composite at the origin reproduces the buffer byte-for-byte', () => {
  const W = 10;
  const H = 8;
  const src = buffer(W, H, {
    '2,2': RED,
    '3,2': BLUE,
    '4,5': RED,
    '8,7': BLUE,
    '0,0': RED,
  });
  const original = src.slice();
  const sel = { x0: 2, y0: 2, x1: 5, y1: 5 };
  const float = liftRect(src, W, sel);
  const base = src.slice();
  clearRect(base, W, sel);
  const out = new Uint8ClampedArray(src.length);
  compositeFloat(out, base, W, H, float, sel.x0, sel.y0);
  assert.deepEqual(out, original);
  // And the base really is the hole: nothing of the selection remains in it.
  assert.deepEqual([...opaqueKeys(base, W)].sort(), ['0,0', '8,7']);
});

test('the rule: a transparent float texel leaves the base art under it; an opaque one overwrites', () => {
  const W = 10;
  const H = 6;
  // The selection at (1,1)-(2,2) holds one painted texel (1,1) and three empty.
  const src = buffer(W, H, { '1,1': RED, '6,1': BLUE, '7,2': BLUE });
  const sel = { x0: 1, y0: 1, x1: 2, y1: 2 };
  const float = liftRect(src, W, sel);
  const base = src.slice();
  clearRect(base, W, sel);
  // Move it by (+5, 0): the float now covers (6,1)-(7,2).
  const out = new Uint8ClampedArray(src.length);
  compositeFloat(out, base, W, H, float, sel.x0 + 5, sel.y0);
  assert.deepEqual(
    texel(out, W, 6, 1),
    [255, 0, 0, 255],
    'the opaque texel overwrites (6,1)'
  );
  assert.deepEqual(
    texel(out, W, 7, 2),
    [0, 0, 255, 255],
    'a transparent float texel landed on (7,2) and left the blue there'
  );
  assert.deepEqual(texel(out, W, 1, 1), [0, 0, 0, 0], 'the origin is the hole');
  assert.deepEqual([...opaqueKeys(out, W)].sort(), ['6,1', '7,2']);
});

test('clipping, no wrap: a float past the right edge never lands on the next row', () => {
  const W = 8;
  const H = 6;
  // A 3-wide fully painted float lifted from the left.
  const src = buffer(W, H, {
    '0,0': RED,
    '1,0': RED,
    '2,0': RED,
    '0,1': RED,
    '1,1': RED,
    '2,1': RED,
  });
  const sel = { x0: 0, y0: 0, x1: 2, y1: 1 };
  const float = liftRect(src, W, sel);
  const base = buffer(W, H); // an empty base makes every landing visible
  const out = new Uint8ClampedArray(src.length);
  // ox = 6: the float spans x = 6..8 — 8 is off the tile, and a linear-index
  // wrap would land it at (0, y+1).
  compositeFloat(out, base, W, H, float, 6, 0);
  assert.deepEqual([...opaqueKeys(out, W)].sort(), ['6,0', '6,1', '7,0', '7,1']);
  assert.deepEqual(texel(out, W, 0, 1), [0, 0, 0, 0], 'nothing wrapped onto row 1');
  assert.deepEqual(texel(out, W, 0, 2), [0, 0, 0, 0], 'nothing wrapped onto row 2');
});

test('clipping: past the bottom writes nothing past h; a negative offset clips left/top', () => {
  const W = 6;
  const H = 5;
  const src = buffer(W, H, { '0,0': RED, '1,0': RED, '0,1': RED, '1,1': RED });
  const sel = { x0: 0, y0: 0, x1: 1, y1: 1 };
  const float = liftRect(src, W, sel);
  const base = buffer(W, H);
  const out = new Uint8ClampedArray(src.length);
  compositeFloat(out, base, W, H, float, 2, 4); // rows 4 and 5; 5 is off
  assert.deepEqual([...opaqueKeys(out, W)].sort(), ['2,4', '3,4']);
  assert.equal(out.length, W * H * 4, 'the buffer never grew');
  compositeFloat(out, base, W, H, float, -1, -1); // only (1,1) of the float lands, at (0,0)
  assert.deepEqual([...opaqueKeys(out, W)], ['0,0']);
  compositeFloat(out, base, W, H, float, -2, 0); // wholly off the left: nothing lands
  assert.deepEqual([...opaqueKeys(out, W)], []);
  compositeFloat(out, base, W, H, float, 0, H); // wholly off the bottom: nothing lands
  assert.deepEqual([...opaqueKeys(out, W)], []);
});

test('reversible: partially off-tile then back on-tile reproduces the full float', () => {
  const W = 8;
  const H = 8;
  const src = buffer(W, H, { '3,3': RED, '4,3': BLUE, '3,4': BLUE, '4,4': RED });
  const original = src.slice();
  const sel = { x0: 3, y0: 3, x1: 4, y1: 4 };
  const float = liftRect(src, W, sel);
  const base = src.slice();
  clearRect(base, W, sel);
  const out = new Uint8ClampedArray(src.length);
  compositeFloat(out, base, W, H, float, 7, 7); // only (3,3)'s texel lands, at (7,7)
  assert.deepEqual([...opaqueKeys(out, W)], ['7,7']);
  compositeFloat(out, base, W, H, float, -1, -1); // only (4,4)'s texel lands, at (0,0)
  assert.deepEqual([...opaqueKeys(out, W)], ['0,0']);
  compositeFloat(out, base, W, H, float, sel.x0, sel.y0); // home again
  assert.deepEqual(
    out,
    original,
    'the float buffer was never clipped, only the composite'
  );
  assert.equal(float.opaque, 4);
});

test('compositeFloat may composite in place when out === base', () => {
  const W = 6;
  const H = 4;
  const src = buffer(W, H, { '0,0': RED, '5,3': BLUE });
  const float = liftRect(src, W, { x0: 0, y0: 0, x1: 0, y1: 0 });
  const buf = src.slice();
  compositeFloat(buf, buf, W, H, float, 2, 2);
  assert.deepEqual([...opaqueKeys(buf, W)].sort(), ['0,0', '2,2', '5,3']);
});
