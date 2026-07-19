// Node-runnable tests for ingest.js: transform reorientation (rot/flip and their
// ordering), the flip identity fast-path, the pipeline's transforms branch, and
// ingestSprite's throw / empty-tile / valid-tile contracts. Pure — no THREE/DOM.
// Run: node --test test/ingest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { packRGBA, flip, applyTransform, ingestSprite } from '../src/lib/ingest.js';
import { buildVoxels } from '../src/lib/pipeline.js';
import { voxIndex } from '../src/lib/carve.js';

// --- tiny builders ----------------------------------------------------------
// An image whose pixels are labelled by their FIRST byte (R channel), so we can
// read a permutation by listing the first byte of each texel in row-major order.
// alpha is 255 everywhere so every texel is opaque/distinguishable.
function tag(width, height, tags) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < tags.length; i++) {
    data[i * 4] = tags[i];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}
const firstBytes = (img) => {
  const out = [];
  for (let i = 0; i < img.width * img.height; i++) out.push(img.data[i * 4]);
  return out;
};
// rows of chars -> ImageData-like (shared pattern from pipeline.test.mjs).
const C = { M: [199, 125, 214], N: [201, 184, 120] };
function img(rows, pal = C) {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      const i = (y * w + x) * 4;
      if (ch === '.' || ch === ' ') continue;
      const [r, g, b] = pal[ch];
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  return { width: w, height: h, data };
}
const fill = (w, h, ch) => img(Array.from({ length: h }, () => ch.repeat(w)));
const pk = (name) => packRGBA(...C[name], 255) >>> 0;

// A 2x2 whose texels are TL=1, TR=2, BL=3, BR=4 (row-major). Any reorientation
// is then a readable permutation of [1,2,3,4].
const grid2x2 = () => tag(2, 2, [1, 2, 3, 4]);

// --- flip -------------------------------------------------------------------
test('flip(img,true,false) mirrors columns; dims unchanged', () => {
  // 2x1: left tagged 10, right tagged 40 -> after flipX the row reverses.
  const out = flip(tag(2, 1, [10, 40]), true, false);
  assert.equal(out.width, 2);
  assert.equal(out.height, 1);
  assert.deepEqual(firstBytes(out), [40, 10]);
});

test('flip(img,false,true) mirrors rows', () => {
  // 2x2 TL,TR,BL,BR = 1,2,3,4 -> flipY swaps the two rows.
  assert.deepEqual(firstBytes(flip(grid2x2(), false, true)), [3, 4, 1, 2]);
});

test('flip(img,false,false) returns the SAME object (identity fast-path)', () => {
  // Covers ui.js mirrorImage, which delegates to flip — a no-op must not copy.
  const src = grid2x2();
  const out = flip(src, false, false);
  assert.equal(out, src); // same reference, not a fresh copy
});

// --- applyTransform: rotation -----------------------------------------------
test('applyTransform rot:2 is a 180° turn (full reversal)', () => {
  assert.deepEqual(firstBytes(applyTransform(grid2x2(), { rot: 2 })), [4, 3, 2, 1]);
});

test('applyTransform rot:3 is 270° CW; rot:-1 normalizes to the same', () => {
  const three = applyTransform(grid2x2(), { rot: 3 });
  assert.equal(three.width, 2);
  assert.equal(three.height, 2);
  assert.deepEqual(firstBytes(three), [2, 4, 1, 3]);
  // rot is reduced modulo 4 into 0..3, so -1 === 3.
  assert.deepEqual(firstBytes(applyTransform(grid2x2(), { rot: -1 })), [2, 4, 1, 3]);
});

// --- applyTransform: rot+flip ORDERING --------------------------------------
// The docstring says flips run AFTER rotation. rot:1 alone yields [3,1,4,2];
// flipping columns of THAT ([3,1,4,2] -> per-row swap) gives [1,3,2,4]. If flip
// ran BEFORE the rotation the result would differ — this pins the order.
test('applyTransform applies flips AFTER rotation', () => {
  assert.deepEqual(firstBytes(applyTransform(grid2x2(), { rot: 1 })), [3, 1, 4, 2]);
  // rot:1 then flipX = mirror the columns of [3,1,4,2].
  assert.deepEqual(
    firstBytes(applyTransform(grid2x2(), { rot: 1, flipX: true })),
    [1, 3, 2, 4]
  );
  // rot:1 then flipY = mirror the rows of [3,1,4,2].
  assert.deepEqual(
    firstBytes(applyTransform(grid2x2(), { rot: 1, flipY: true })),
    [4, 2, 3, 1]
  );
  // Sanity: applying flipX BEFORE the rotation would instead give rot(flipX(src)).
  const flipThenRot = applyTransform(flip(grid2x2(), true, false), { rot: 1 });
  assert.notDeepEqual(
    firstBytes(applyTransform(grid2x2(), { rot: 1, flipX: true })),
    firstBytes(flipThenRot)
  );
});

test('applyTransform with no options is a pass-through (same ref)', () => {
  const src = grid2x2();
  assert.equal(applyTransform(src), src); // rot 0 + no flip -> flip identity path
  assert.equal(applyTransform(src, {}), src);
});

// --- pipeline transforms branch (the only end-to-end coverage) --------------
// rot:2 on the FRONT view moves its content from the top image row to the bottom
// row, so the solid voxel lands at a different world Y — proving the transform
// actually reoriented the sprite before ingest.
test('buildVoxels opts.transforms reorients a view (rot:2 flips world Y)', () => {
  const views = { front: img(['MM', '..', '..']), right: fill(1, 3, 'N') };
  const base = buildVoxels(views, { mirror: { x: false, y: false, z: false } });
  const xf = buildVoxels(views, {
    mirror: { x: false, y: false, z: false },
    transforms: { front: { rot: 2 } },
  });
  assert.deepEqual(base.dims, { nx: 2, ny: 3, nz: 1 });
  assert.deepEqual(xf.dims, base.dims);
  assert.equal(base.solidCount, 2);
  assert.equal(xf.solidCount, 2);
  // Untransformed: content in the top image row -> world y = ny-1 = 2.
  assert.equal(base.solid[voxIndex(0, 2, 0, base.dims)], 1);
  assert.equal(base.solid[voxIndex(1, 2, 0, base.dims)], 1);
  assert.equal(base.solid[voxIndex(0, 0, 0, base.dims)], 0);
  // rot:2 moves it to the bottom image row -> world y = 0 instead.
  assert.equal(xf.solid[voxIndex(0, 0, 0, xf.dims)], 1);
  assert.equal(xf.solid[voxIndex(1, 0, 0, xf.dims)], 1);
  assert.equal(xf.solid[voxIndex(0, 2, 0, xf.dims)], 0);
});

test('buildVoxels transforms flipX swaps the +z face colors of a two-tone front', () => {
  const views = { front: img(['MN']), right: img(['N']) };
  const base = buildVoxels(views, { mirror: { x: false, y: false, z: false } });
  const xf = buildVoxels(views, {
    mirror: { x: false, y: false, z: false },
    transforms: { front: { flipX: true } },
  });
  const pz = (r, x) => r.faceColor.get(voxIndex(x, 0, 0, r.dims) * 6 + 4) >>> 0;
  // Base: front row 'MN' -> M at x=0, N at x=1.
  assert.deepEqual([pz(base, 0), pz(base, 1)], [pk('M'), pk('N')]);
  // flipX mirrors the columns before ingest -> the two swap.
  assert.deepEqual([pz(xf, 0), pz(xf, 1)], [pk('N'), pk('M')]);
});

// --- ingestSprite contracts -------------------------------------------------
test('ingestSprite throws on a zero dimension', () => {
  assert.throws(
    () => ingestSprite({ width: 0, height: 1, data: new Uint8ClampedArray(4) }),
    /expected/
  );
  assert.throws(
    () => ingestSprite({ width: 1, height: 0, data: new Uint8ClampedArray(4) }),
    /expected/
  );
});

test('ingestSprite throws on truncated data (length < w*h*4)', () => {
  // 2x2 needs 16 bytes; give it 15.
  assert.throws(
    () => ingestSprite({ width: 2, height: 2, data: new Uint8ClampedArray(15) }),
    /expected/
  );
  // Missing data entirely also throws.
  assert.throws(() => ingestSprite({ width: 1, height: 1, data: null }), /expected/);
});

test('ingestSprite returns null for a fully transparent tile', () => {
  // alpha 0 everywhere (and below ALPHA_SOLID=128) -> nothing solid -> absent.
  assert.equal(ingestSprite(tag(3, 2, [])), null); // all-zero data
  const belowThreshold = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([9, 9, 9, 127]),
  };
  assert.equal(ingestSprite(belowThreshold), null);
});

test('ingestSprite returns {w,h,occ,rgb} for a valid tile', () => {
  const v = ingestSprite(grid2x2()); // TL=1,TR=2,BL=3,BR=4, all opaque
  assert.equal(v.w, 2);
  assert.equal(v.h, 2);
  assert.ok(v.occ instanceof Uint8Array);
  assert.ok(v.rgb instanceof Uint32Array);
  assert.deepEqual([...v.occ], [1, 1, 1, 1]); // every texel opaque
  // rgb packs (tag,0,0,255): alpha is forced to 255 regardless of source alpha.
  assert.deepEqual(
    [...v.rgb].map((x) => x >>> 0),
    [1, 2, 3, 4].map((r) => packRGBA(r, 0, 0, 255) >>> 0)
  );
});

test('ingestSprite marks only opaque texels solid (alpha >= 128 gate)', () => {
  // Two texels: first opaque (a=200), second transparent (a=100 < 128).
  const im = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([50, 0, 0, 200, 60, 0, 0, 100]),
  };
  const v = ingestSprite(im);
  assert.deepEqual([...v.occ], [1, 0]);
  assert.equal(v.rgb[0] >>> 0, packRGBA(50, 0, 0, 255) >>> 0);
  assert.equal(v.rgb[1] >>> 0, 0); // transparent texel left unpacked
});
