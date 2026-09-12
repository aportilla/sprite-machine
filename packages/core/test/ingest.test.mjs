import { test } from 'node:test';
import assert from 'node:assert/strict';

import { packRGBA, flip, applyTransform, ingestSprite } from '../src/ingest.js';
import { buildVoxels } from '../src/pipeline.js';
import { voxIndex } from '../src/carve.js';
import { C, img, fill } from './helpers.mjs';

// An opaque image whose texels are tagged by their R byte, so a reorientation
// reads as a permutation of the tags.
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

// A 2x2 tagged TL=1, TR=2, BL=3, BR=4.
const grid2x2 = () => tag(2, 2, [1, 2, 3, 4]);

test('flip mirrors columns (flipX) or rows (flipY); dims unchanged', () => {
  const x = flip(tag(2, 1, [10, 40]), true, false);
  assert.equal(x.width, 2);
  assert.equal(x.height, 1);
  assert.deepEqual(firstBytes(x), [40, 10]);
  // flipY swaps the rows.
  assert.deepEqual(firstBytes(flip(grid2x2(), false, true)), [3, 4, 1, 2]);
  // No flip is the identity.
  assert.deepEqual(firstBytes(flip(grid2x2(), false, false)), [1, 2, 3, 4]);
});

test('applyTransform rotates: rot:2 reverses, rot:3 is 270° CW, rot:-1 normalizes to 3', () => {
  assert.deepEqual(firstBytes(applyTransform(grid2x2(), { rot: 2 })), [4, 3, 2, 1]);
  const three = applyTransform(grid2x2(), { rot: 3 });
  assert.equal(three.width, 2);
  assert.equal(three.height, 2);
  assert.deepEqual(firstBytes(three), [2, 4, 1, 3]);
  // rot is taken modulo 4, so -1 is 3.
  assert.deepEqual(firstBytes(applyTransform(grid2x2(), { rot: -1 })), [2, 4, 1, 3]);
  // No options is the identity.
  assert.deepEqual(firstBytes(applyTransform(grid2x2())), [1, 2, 3, 4]);
});

test('applyTransform applies flips AFTER rotation', () => {
  assert.deepEqual(firstBytes(applyTransform(grid2x2(), { rot: 1 })), [3, 1, 4, 2]);
  // flipX mirrors the columns of [3,1,4,2].
  assert.deepEqual(
    firstBytes(applyTransform(grid2x2(), { rot: 1, flipX: true })),
    [1, 3, 2, 4]
  );
  // flipY mirrors the rows of [3,1,4,2].
  assert.deepEqual(
    firstBytes(applyTransform(grid2x2(), { rot: 1, flipY: true })),
    [4, 2, 3, 1]
  );
  const flipThenRot = applyTransform(flip(grid2x2(), true, false), { rot: 1 });
  assert.notDeepEqual(
    firstBytes(applyTransform(grid2x2(), { rot: 1, flipX: true })),
    firstBytes(flipThenRot)
  );
});

// rot:2 on the front view moves its content from the top image row to the
// bottom, so the solid lands at a different world y.
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
  // Untransformed: the top image row is world y = ny-1 = 2.
  assert.equal(base.solid[voxIndex(0, 2, 0, base.dims)], 1);
  assert.equal(base.solid[voxIndex(1, 2, 0, base.dims)], 1);
  assert.equal(base.solid[voxIndex(0, 0, 0, base.dims)], 0);
  // rot:2: the content is at world y = 0.
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
  // Base: M at x=0, N at x=1.
  assert.deepEqual([pz(base, 0), pz(base, 1)], [pk('M'), pk('N')]);
  // flipX swaps them.
  assert.deepEqual([pz(xf, 0), pz(xf, 1)], [pk('N'), pk('M')]);
});

test('ingestSprite throws on a zero dimension or truncated data', () => {
  const bad = (width, height, data) => () => ingestSprite({ width, height, data });
  assert.throws(bad(0, 1, new Uint8ClampedArray(4)), /expected/);
  assert.throws(bad(1, 0, new Uint8ClampedArray(4)), /expected/);
  assert.throws(bad(2, 2, new Uint8ClampedArray(15)), /expected/); // 2x2 needs 16 bytes
  assert.throws(bad(1, 1, null), /expected/); // no data
});

test('ingestSprite gates on alpha >= 128 and returns {w,h,occ,rgb}; an empty tile is null', () => {
  const px = (r, a) => ({
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([r, 0, 0, a]),
  });
  // A tile with nothing solid is null.
  assert.equal(ingestSprite(tag(3, 2, [])), null); // all-zero data
  assert.equal(ingestSprite(px(9, 127)), null); // just under the gate
  assert.notEqual(ingestSprite(px(9, 128)), null); // on the gate: solid
  // Two texels: a=200 is solid, a=100 is not.
  const gated = ingestSprite({
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([50, 0, 0, 200, 60, 0, 0, 100]),
  });
  assert.deepEqual([...gated.occ], [1, 0]);
  assert.equal(gated.rgb[0] >>> 0, packRGBA(50, 0, 0, 255) >>> 0);
  assert.equal(gated.rgb[1] >>> 0, 0); // transparent texel left unpacked
  const v = ingestSprite(grid2x2());
  assert.equal(v.w, 2);
  assert.equal(v.h, 2);
  assert.ok(v.occ instanceof Uint8Array);
  assert.ok(v.rgb instanceof Uint32Array);
  assert.deepEqual([...v.occ], [1, 1, 1, 1]);
  // rgb packs (tag, 0, 0, 255). Alpha is always 255.
  assert.deepEqual(
    [...v.rgb].map((x) => x >>> 0),
    [1, 2, 3, 4].map((r) => packRGBA(r, 0, 0, 255) >>> 0)
  );
});
