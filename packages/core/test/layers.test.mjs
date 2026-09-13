import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LAYER_MAX } from '../src/atlas.js';
import { layersChunk, parseLayersChunk, layerCount } from '../src/layers.js';

test('layersChunk and parseLayersChunk round-trip the names; a malformed chunk reads as null', () => {
  assert.equal(layersChunk(['Layer 1']), '{"layers":[{"name":"Layer 1"}]}');
  const names = ['Body', 'Wheels', ''];
  assert.deepEqual(parseLayersChunk(layersChunk(names)), names);

  const tooMany = layersChunk(Array.from({ length: LAYER_MAX + 1 }, (_, i) => `L${i}`));
  for (const bad of [
    undefined,
    '',
    'not json',
    '{}',
    '[]',
    '{"layers":[]}',
    '{"layers":{"name":"a"}}',
    '{"layers":[{"name":"a"},{"title":"b"}]}',
    '{"layers":[null]}',
    tooMany,
  ]) {
    assert.equal(parseLayersChunk(bad), null, String(bad));
  }
});

test('layerCount: the names’ count when it divides the height into whole blocks, else null', () => {
  assert.equal(layerCount(80, ['a']), 1);
  assert.equal(layerCount(80, ['a', 'b']), 2, '20 px tiles');
  assert.equal(layerCount(80, ['a', 'b', 'c']), null, 'no whole tile row');
  assert.equal(layerCount(80, null), null);
  assert.equal(layerCount(80, []), null);
});
