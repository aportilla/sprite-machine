// The Node adapter (node.js): a document PNG decodes to the pixels the
// encoder was given, its Title chunk to the name and its transforms chunk to
// the object — and sheetToGlb names the model from the chunk. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readSheet, sheetToGlb } from '../src/node.js';
import { encodePng } from '../src/png-encode.js';
import { setTextChunks } from '../src/png-chunks.js';
import { glbParts } from '../src/gltf.js';
import { fill, sheet } from './helpers.mjs';

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
  assert.throws(() => readSheet(new Uint8Array([1, 2, 3])), /not a PNG/);
});
