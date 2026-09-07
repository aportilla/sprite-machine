// Node-runnable tests for the ring slice (state/ring.js): the 3D Sprite
// Atlas's settings — every setter's range and the paper's name gate — the
// sheet channel, and the export's metadata chunks. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createRing,
  ringMetaChunks,
  texturePackerJson,
  RING_MAX_VIEWS,
  RING_MIN_SIZE,
  RING_MAX_SIZE,
  RING_CHUNK_KEY,
} from '../src/state/ring.js';
import { SOFTWARE } from '../src/state/files.js';

test('the setters: an integer inside its range, clamped at either bound (the offset wrapped into [0, 360)); NaN a no-op; the paper a name or a no-op', () => {
  // [setter, key, input, expected]: per setter an in-range value, then one
  // case per bound — or, for the offset, either side of the wrap.
  const rows = [
    ['setViews', 'views', 7.6, 8],
    ['setViews', 'views', 0, 1],
    ['setViews', 'views', 99, RING_MAX_VIEWS],
    ['setElevation', 'elevation', 30, 30],
    ['setElevation', 'elevation', -5, 0],
    ['setElevation', 'elevation', 120, 90],
    ['setSize', 'size', 128, 128],
    ['setSize', 'size', 0, RING_MIN_SIZE],
    ['setSize', 'size', 1000, RING_MAX_SIZE],
    ['setOffset', 'offset', 45, 45],
    ['setOffset', 'offset', 370, 10],
    ['setOffset', 'offset', -10, 350],
  ];
  const r = createRing();
  for (const [setter, key, input, want] of rows) {
    r[setter](input);
    assert.equal(r.get()[key], want, `${setter}(${input})`);
  }
  r.setViews(8);
  r.setViews(NaN);
  assert.equal(r.get().views, 8, 'NaN (a field mid-edit) changes nothing');
  r.setPaper('gray');
  assert.equal(r.get().paper, 'gray', 'a RING_PAPERS key sets');
  r.setPaper('dots');
  assert.equal(r.get().paper, 'gray', 'a pattern name, or anything else, is a no-op');
});

test('the sheet channel: by reference, every listener, unsubscribe stops', () => {
  const r = createRing();
  assert.equal(r.sheet(), null);
  const seenA = [];
  const seenB = [];
  const offA = r.onSheet((s) => seenA.push(s));
  r.onSheet((s) => seenB.push(s));
  const sheet = { canvas: {}, frame: 69, views: 4 };
  r.publishSheet(sheet);
  assert.equal(seenA[0], sheet, 'the same reference');
  assert.equal(seenB[0], sheet);
  assert.equal(r.sheet(), sheet, 'a late subscriber can read the last one');
  offA();
  r.publishSheet(null);
  assert.equal(seenA.length, 1, 'unsubscribed');
  assert.equal(seenB.length, 2);
  assert.equal(r.sheet(), null);
});

test('ringMetaChunks: Title, Software, and a JSON that round-trips — the paper never in it', () => {
  const settings = { views: 8, elevation: 30, offset: 45, size: 123 };
  // The frame equals the size (kept for importers reading `frame`); the
  // scale is the derived px per voxel, a float.
  const geometry = {
    frame: 123,
    scale: 1.8014,
    anchor: { x: 61.5, y: 96.1 },
    yaws: [45, 90, 135],
  };
  // The slice's whole snapshot goes in (the exporter passes ring.get()); the
  // paper is a viewing choice and stays out of the file.
  const chunks = ringMetaChunks('Car', { ...settings, paper: 'black' }, geometry);
  assert.deepEqual(Object.keys(chunks), ['Title', 'Software', RING_CHUNK_KEY]);
  assert.equal(chunks.Title, 'Car atlas');
  assert.equal(chunks.Software, SOFTWARE);
  assert.deepEqual(JSON.parse(chunks[RING_CHUNK_KEY]), {
    ...settings,
    frame: 123,
    scale: 1.8014,
    anchor: { x: 61.5, y: 96.1 },
    yaws: [45, 90, 135],
  });
});

test('texturePackerJson: one untrimmed frame per yaw at its column with the anchor as a normalized pivot, the ring as one animation, and meta naming the sibling PNG plus the same record the chunk carries', () => {
  const settings = { views: 3, elevation: 30, offset: 45, size: 100, paper: 'gray' };
  // The anchor is a projection, so its row is a long float; the pivot it
  // becomes is rounded to four places, the record keeping it exact.
  const geometry = {
    frame: 100,
    scale: 1.25,
    anchor: { x: 50, y: 80.00966799187808 },
    yaws: [45, 165, 285],
  };
  const tp = texturePackerJson('car', settings, geometry, {
    image: 'car-atlas.png',
    version: '1.2.3',
  });
  assert.deepEqual(Object.keys(tp.frames), ['car-0', 'car-1', 'car-2']);
  assert.deepEqual(tp.frames['car-2'], {
    frame: { x: 200, y: 0, w: 100, h: 100 },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: 100, h: 100 },
    sourceSize: { w: 100, h: 100 },
    pivot: { x: 0.5, y: 0.8001 },
  });
  assert.deepEqual(tp.animations, { car: ['car-0', 'car-1', 'car-2'] });
  assert.equal(tp.meta.image, 'car-atlas.png');
  assert.equal(tp.meta.version, '1.2.3');
  assert.deepEqual(tp.meta.size, { w: 300, h: 100 });
  assert.deepEqual(
    tp.meta['sprite-machine'],
    JSON.parse(ringMetaChunks('Car', settings, geometry)[RING_CHUNK_KEY]),
    'the same record as the PNG chunk, the paper never in it'
  );
});
