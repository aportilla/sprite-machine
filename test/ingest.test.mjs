// Node-runnable tests for ingest.js: flip and applyTransform (rot, flip and
// their ordering), the pipeline's transforms branch, and ingestSprite's throw /
// alpha-gate / returned-shape contracts. Pure — no THREE/DOM.
// Run: node --test test/ingest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { packRGBA, flip, applyTransform, ingestSprite } from '../src/lib/ingest.js';
import { buildVoxels } from '../src/lib/pipeline.js';
import { voxIndex } from '../src/lib/carve.js';
import { C, img, fill } from './helpers.mjs';

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
const pk = (name) => packRGBA(...C[name], 255) >>> 0;

// A 2x2 whose texels are TL=1, TR=2, BL=3, BR=4 (row-major). Any reorientation
// is then a readable permutation of [1,2,3,4].
const grid2x2 = () => tag(2, 2, [1, 2, 3, 4]);

// --- flip -------------------------------------------------------------------
test('flip mirrors columns (flipX) or rows (flipY); dims unchanged', () => {
  // 2x1: left tagged 10, right tagged 40 -> flipX reverses the row.
  const x = flip(tag(2, 1, [10, 40]), true, false);
  assert.equal(x.width, 2);
  assert.equal(x.height, 1);
  assert.deepEqual(firstBytes(x), [40, 10]);
  // 2x2 TL,TR,BL,BR = 1,2,3,4 -> flipY swaps the two rows.
  assert.deepEqual(firstBytes(flip(grid2x2(), false, true)), [3, 4, 1, 2]);
  // Neither flip leaves the pixels where they were.
  assert.deepEqual(firstBytes(flip(grid2x2(), false, false)), [1, 2, 3, 4]);
});

// --- applyTransform: rotation -----------------------------------------------
test('applyTransform rotates: rot:2 reverses, rot:3 is 270° CW, rot:-1 normalizes to 3', () => {
  assert.deepEqual(firstBytes(applyTransform(grid2x2(), { rot: 2 })), [4, 3, 2, 1]);
  const three = applyTransform(grid2x2(), { rot: 3 });
  assert.equal(three.width, 2);
  assert.equal(three.height, 2);
  assert.deepEqual(firstBytes(three), [2, 4, 1, 3]);
  // rot is reduced modulo 4 into 0..3, so -1 === 3.
  assert.deepEqual(firstBytes(applyTransform(grid2x2(), { rot: -1 })), [2, 4, 1, 3]);
  // No options at all is the identity.
  assert.deepEqual(firstBytes(applyTransform(grid2x2())), [1, 2, 3, 4]);
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
test('ingestSprite throws on a zero dimension or truncated data', () => {
  const bad = (width, height, data) => () => ingestSprite({ width, height, data });
  assert.throws(bad(0, 1, new Uint8ClampedArray(4)), /expected/);
  assert.throws(bad(1, 0, new Uint8ClampedArray(4)), /expected/);
  assert.throws(bad(2, 2, new Uint8ClampedArray(15)), /expected/); // 2x2 needs 16 bytes
  assert.throws(bad(1, 1, null), /expected/); // missing data entirely
});

test('ingestSprite gates on alpha >= 128 and returns {w,h,occ,rgb}; an empty tile is null', () => {
  const px = (r, a) => ({
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([r, 0, 0, a]),
  });
  // Nothing solid anywhere -> the tile is absent (null), not an empty grid.
  assert.equal(ingestSprite(tag(3, 2, [])), null); // all-zero data
  assert.equal(ingestSprite(px(9, 127)), null); // just under the gate
  assert.notEqual(ingestSprite(px(9, 128)), null); // on the gate: solid
  // Two texels: first opaque (a=200), second transparent (a=100 < 128).
  const gated = ingestSprite({
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([50, 0, 0, 200, 60, 0, 0, 100]),
  });
  assert.deepEqual([...gated.occ], [1, 0]);
  assert.equal(gated.rgb[0] >>> 0, packRGBA(50, 0, 0, 255) >>> 0);
  assert.equal(gated.rgb[1] >>> 0, 0); // transparent texel left unpacked
  // The returned shape for a valid tile.
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
