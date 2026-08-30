// Node-runnable tests for the ring slice (state/ring.js): the 3D Sprite
// Atlas's settings — defaults, clamps, the NaN no-op, silence on an unchanged
// value — the sheet channel, and the export's metadata chunks. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createRing,
  ringMetaChunks,
  RING_DEFAULTS,
  RING_MAX_VIEWS,
  RING_MAX_SCALE,
  RING_CHUNK_KEY,
} from '../src/state/ring.js';
import { SOFTWARE } from '../src/state/files.js';

test('the defaults: four views, 45° up, from the front, 1 px per voxel', () => {
  assert.deepEqual(RING_DEFAULTS, { views: 4, elevation: 45, offset: 0, scale: 1 });
  assert.deepEqual(createRing().get(), RING_DEFAULTS);
  assert.equal(RING_MAX_VIEWS, 16);
  assert.equal(RING_MAX_SCALE, 8);
});

test('setViews: integer, clamped 1..16, NaN a no-op, silent when unchanged', () => {
  const r = createRing();
  let fired = 0;
  r.subscribe(() => fired++);
  r.setViews(8);
  assert.equal(r.get().views, 8);
  assert.equal(fired, 1);
  r.setViews(8);
  assert.equal(fired, 1, 'a same-value write is a silent no-op');
  r.setViews(7.6);
  assert.equal(r.get().views, 8, 'rounds — still 8, still silent');
  assert.equal(fired, 1);
  r.setViews(0);
  assert.equal(r.get().views, 1);
  r.setViews(99);
  assert.equal(r.get().views, RING_MAX_VIEWS);
  r.setViews(NaN);
  assert.equal(r.get().views, RING_MAX_VIEWS, 'NaN (a field mid-edit) changes nothing');
  assert.equal(fired, 3);
});

test('setElevation / setScale: clamped to their ranges', () => {
  const r = createRing();
  r.setElevation(-5);
  assert.equal(r.get().elevation, 0);
  r.setElevation(120);
  assert.equal(r.get().elevation, 90);
  r.setElevation(30.4);
  assert.equal(r.get().elevation, 30);
  r.setScale(0);
  assert.equal(r.get().scale, 1);
  r.setScale(20);
  assert.equal(r.get().scale, RING_MAX_SCALE);
  r.setScale(2);
  assert.equal(r.get().scale, 2);
});

test('setOffset: normalized into [0, 360)', () => {
  const r = createRing();
  r.setOffset(370);
  assert.equal(r.get().offset, 10);
  r.setOffset(-10);
  assert.equal(r.get().offset, 350);
  r.setOffset(360);
  assert.equal(r.get().offset, 0);
  r.setOffset(45);
  assert.equal(r.get().offset, 45);
  let fired = 0;
  r.subscribe(() => fired++);
  r.setOffset(405);
  assert.equal(fired, 0, '405 normalizes to the 45 already held — silent');
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

test('the sheet channel never touches the store', () => {
  const r = createRing();
  let fired = 0;
  r.subscribe(() => fired++);
  r.publishSheet({ canvas: {}, frame: 1, views: 1 });
  assert.equal(fired, 0);
});

test('ringMetaChunks: Title, Software, and a JSON that round-trips', () => {
  const settings = { views: 8, elevation: 30, offset: 45, scale: 2 };
  const geometry = { frame: 123, anchor: { x: 61.5, y: 96.1 }, yaws: [45, 90, 135] };
  const chunks = ringMetaChunks('Car', settings, geometry);
  assert.deepEqual(Object.keys(chunks), ['Title', 'Software', RING_CHUNK_KEY]);
  assert.equal(chunks.Title, 'Car atlas');
  assert.equal(chunks.Software, SOFTWARE);
  assert.deepEqual(JSON.parse(chunks[RING_CHUNK_KEY]), {
    ...settings,
    frame: 123,
    anchor: { x: 61.5, y: 96.1 },
    yaws: [45, 90, 135],
  });
  // The JSON copies its inputs — a later mutation of the caller's arrays
  // can't reach a chunk already built.
  geometry.yaws.push(180);
  assert.deepEqual(JSON.parse(chunks[RING_CHUNK_KEY]).yaws, [45, 90, 135]);
});
