import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readSheet, sheetToGlb } from '../src/node.js';
import { encodePng } from '../src/png-encode.js';
import { setTextChunks } from '../src/png-chunks.js';
import { layersChunk } from '../src/layers.js';
import { glbParts } from '../src/gltf.js';
import { fill, sheet, layeredSheet } from './helpers.mjs';

test('readSheet round-trips the encoder and reads the document chunks; sheetToGlb names the model from them', () => {
  const t = 4;
  const image = sheet(t, {
    front: fill(t, t, 'R'),
    left: fill(t, t, 'T'),
    top: fill(t, t, 'T'),
  });
  const transforms = { front: { flipX: true } };
  const bytes = setTextChunks(encodePng(image), {
    Title: 'slab',
    'sprite-machine:transforms': JSON.stringify(transforms),
  });

  const back = readSheet(bytes);
  assert.equal(back.image.width, image.width);
  assert.equal(back.image.height, image.height);
  assert.deepEqual(Array.from(back.image.data), Array.from(image.data));
  assert.equal(back.name, 'slab');
  assert.deepEqual(back.transforms, transforms);
  assert.equal(back.chunks.Title, 'slab');

  assert.equal(glbParts(sheetToGlb(bytes)).json.nodes[0].name, 'slab');
  assert.equal(back.layers, null, 'no layers chunk');
  assert.throws(() => readSheet(new Uint8Array([1, 2, 3])), /not a PNG/);
});

test('readSheet returns the layer names; sheetToGlb builds as many layers as the chunk names', () => {
  const t = 4;
  const cube = { front: fill(t, t, 'R'), left: fill(t, t, 'T'), top: fill(t, t, 'T') };
  const plain = encodePng(layeredSheet(t, [cube, cube]));
  const named = setTextChunks(plain, {
    'sprite-machine:layers': layersChunk(['Body', 'Detail']),
  });
  assert.deepEqual(readSheet(named).layers, ['Body', 'Detail']);
  const dims = (bytes) =>
    glbParts(sheetToGlb(bytes)).json.asset.extras['sprite-machine'].dims;
  assert.deepEqual(dims(named), { nx: t, ny: t, nz: t });
  assert.deepEqual(dims(plain), { nx: t, ny: 2 * t, nz: 2 * t }, 'no chunk: one block');
});
