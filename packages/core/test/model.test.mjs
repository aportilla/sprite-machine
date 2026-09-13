import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildModel, modelToGlb } from '../src/model.js';
import { flip } from '../src/ingest.js';
import { glbParts } from '../src/gltf.js';
import { img, fill, sheet, layeredSheet } from './helpers.mjs';

test("buildModel: one unit per voxel, a transforms chunk applied as the app applies it; modelToGlb: the reader's scale", () => {
  const t = 4;
  const halfFront = img(['RR..', 'RR..', 'RR..', 'RR..']); // a slab on the left
  const views = { left: fill(t, t, 'T'), top: fill(t, t, 'T') };

  // A flipX transform builds the same mesh as pre-flipped art.
  const flipped = buildModel(sheet(t, { ...views, front: halfFront }), {
    transforms: { front: { flipX: true } },
  });
  const direct = buildModel(sheet(t, { ...views, front: flip(halfFront, true, false) }));
  assert.deepEqual(
    Array.from(flipped.geometry.position),
    Array.from(direct.geometry.position)
  );
  assert.deepEqual(Array.from(flipped.geometry.index), Array.from(direct.geometry.index));

  // One unit per voxel: the mesh spans 0..t in y.
  assert.deepEqual(flipped.dims, { nx: t, ny: t, nz: t });
  assert.equal(flipped.unitsPerVoxel, 1);
  const bb = flipped.geometry.bounds;
  assert.equal(bb.min[1], 0);
  assert.equal(bb.max[1], t);
  assert.equal(flipped.triangles > 0, true);

  // The glb scales positions to meters by voxelsPerMeter and records it in extras.
  const parts = glbParts(modelToGlb(flipped, { name: 'slab', voxelsPerMeter: t }));
  const prim = parts.json.meshes[0].primitives[0];
  assert.equal(parts.json.accessors[prim.attributes.POSITION].max[1], 1);
  assert.equal(parts.json.asset.extras['sprite-machine'].voxelsPerMeter, t);
  assert.equal(parts.json.nodes[0].name, 'slab');

  assert.throws(() => buildModel(sheet(t, {})), /no painted view/);
});

test('buildModel with layers: the union of the blocks; without the option a sheet is one block; only a sheet blank in every layer throws', () => {
  const t = 4;
  const rows = (row) => img([row, row, row, row]);
  const box = (row) => ({ front: rows(row), left: fill(t, t, 'R'), top: rows(row) });
  const halves = layeredSheet(t, [box('RR..'), box('..RR')]);

  const layered = buildModel(halves, { layers: 2 });
  const whole = buildModel(sheet(t, box('RRRR')));
  assert.deepEqual(layered.dims, whole.dims);
  for (const attr of ['position', 'normal', 'uv', 'index']) {
    assert.deepEqual(
      Array.from(layered.geometry[attr]),
      Array.from(whole.geometry[attr]),
      attr
    );
  }

  assert.deepEqual(
    buildModel(halves).dims,
    { nx: t, ny: 2 * t, nz: 2 * t },
    'one block of t × 2t tiles'
  );

  assert.throws(
    () => buildModel(layeredSheet(t, [{}, {}]), { layers: 2 }),
    /no painted view/
  );
  assert.equal(
    buildModel(layeredSheet(t, [{}, box('RRRR')]), { layers: 2 }).triangles,
    12
  );
});
