import { test } from 'node:test';
import assert from 'node:assert/strict';

import { weldVertices } from '../src/weld.js';

const f32 = (a) => Float32Array.from(a);

test('weldVertices merges equal vertices, keeps first-seen order and indexes every triangle', () => {
  // Two triangles sharing the edge (1,0,0)-(0,1,0).
  const position = f32([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const normal = f32([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uv = f32([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]);
  const out = weldVertices(position, normal, uv);
  assert.deepEqual(Array.from(out.index), [0, 1, 2, 1, 3, 2]);
  assert.deepEqual(Array.from(out.position), [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
  assert.deepEqual(Array.from(out.normal), [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  assert.deepEqual(Array.from(out.uv), [0, 0, 1, 0, 0, 1, 1, 1]);
  assert.equal(out.index.length / 3, 2, 'the triangle count is unchanged');
});

test('weldVertices keeps vertices apart that differ only in normal or only in uv', () => {
  // The same triangle twice.
  const position = f32([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normal = f32([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uv = f32([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const same = weldVertices(position, normal, uv);
  assert.equal(same.position.length / 3, 3);
  assert.deepEqual(Array.from(same.index), [0, 1, 2, 0, 1, 2]);

  const flipped = f32([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1]);
  assert.equal(
    weldVertices(position, flipped, uv).position.length / 3,
    6,
    'normals differ'
  );

  const shifted = f32([0, 0, 1, 0, 0, 1, 0.5, 0.5, 1, 0.5, 0.5, 1]);
  assert.equal(
    weldVertices(position, normal, shifted).position.length / 3,
    6,
    'uvs differ'
  );
});
