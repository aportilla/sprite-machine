import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

import { readSheet, decodePng, encodePng, inflate, deflate } from '../src/browser.js';
import { readSheet as readSheetNode } from '../src/node.js';
import { encodePng as encodeStored } from '../src/png-encode.js';
import { setTextChunks } from '../src/png-chunks.js';
import { layersChunk } from '../src/layers.js';
import { fill, layeredSheet } from './helpers.mjs';

test('readSheet over the stream inflate reads what the Node entry reads', async () => {
  const t = 4;
  const cube = { front: fill(t, t, 'R'), left: fill(t, t, 'T'), top: fill(t, t, 'T') };
  const bytes = setTextChunks(encodeStored(layeredSheet(t, [cube, cube])), {
    Title: 'slab',
    'sprite-machine:transforms': JSON.stringify({ front: { flipX: true } }),
    'sprite-machine:layers': layersChunk(['Body', 'Detail']),
  });
  assert.deepEqual(await readSheet(bytes), readSheetNode(bytes));
  await assert.rejects(readSheet(new Uint8Array([1, 2, 3])), /not a PNG/);
});

test('encodePng deflates its rows: decodePng reads the pixels back, zlib inflates the stream, and a flat image is smaller than stored', async () => {
  const width = 24;
  const height = 16;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = i % 4 === 3 ? 255 : (i >> 6) & 0xff;
  const png = await encodePng({ width, height, data });
  const back = await decodePng(png);
  assert.deepEqual([back.width, back.height], [width, height]);
  assert.deepEqual(back.data, data);
  assert.ok(png.length < encodeStored({ width, height, data }).length);

  const raw = Uint8Array.from({ length: 70000 }, (_, i) => (i * 7) % 251);
  const z = await deflate(raw);
  assert.deepEqual(new Uint8Array(inflateSync(z)), raw);
  assert.deepEqual(await inflate(z), raw);
  await assert.rejects(inflate(Uint8Array.of(1, 2, 3)));
});
