// The headless entry (model.js): a sheet's pixels build the mesh at one unit
// per voxel with the document's transforms applied, and the glb carries the
// reader's scale. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildModel, modelToGlb } from '../src/model.js';
import { flip } from '../src/ingest.js';
import { glbParts } from '../src/gltf.js';
import { img, fill, sheet } from './helpers.mjs';

test("buildModel: one unit per voxel, a transforms chunk applied as the app applies it; modelToGlb: the reader's scale", () => {
  const t = 4;
  const halfFront = img(['RR..', 'RR..', 'RR..', 'RR..']); // a slab on the left
  const views = { left: fill(t, t, 'T'), top: fill(t, t, 'T') };

  // The document's transform (the front flipped) builds the mesh the
  // pre-flipped art builds: the same welded positions, the same index.
  const flipped = buildModel(sheet(t, { ...views, front: halfFront }), {
    transforms: { front: { flipX: true } },
  });
  const direct = buildModel(sheet(t, { ...views, front: flip(halfFront, true, false) }));
  assert.deepEqual(
    Array.from(flipped.mesh.geometry.attributes.position.array),
    Array.from(direct.mesh.geometry.attributes.position.array)
  );
  assert.deepEqual(
    Array.from(flipped.mesh.geometry.index.array),
    Array.from(direct.mesh.geometry.index.array)
  );

  // One unit per voxel: the lattice's height is the mesh's, Y as authored.
  assert.deepEqual(flipped.dims, { nx: t, ny: t, nz: t });
  assert.equal(flipped.unitsPerVoxel, 1);
  const bb = flipped.mesh.geometry.boundingBox;
  assert.equal(bb.min.y, 0);
  assert.equal(bb.max.y, t);
  assert.equal(flipped.triangles > 0, true);

  // The glb: positions in meters at the scale given, the extras recording it.
  const parts = glbParts(modelToGlb(flipped, { name: 'slab', voxelsPerMeter: t }));
  const prim = parts.json.meshes[0].primitives[0];
  assert.equal(parts.json.accessors[prim.attributes.POSITION].max[1], 1);
  assert.equal(parts.json.asset.extras['sprite-machine'].voxelsPerMeter, t);
  assert.equal(parts.json.nodes[0].name, 'slab');

  // A sheet with nothing painted is not a model.
  assert.throws(() => buildModel(sheet(t, {})), /no painted view/);
});
