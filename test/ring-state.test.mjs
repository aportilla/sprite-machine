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
  RING_MIN_SIZE,
  RING_MAX_SIZE,
  RING_PAPERS,
  RING_CHUNK_KEY,
} from '../src/state/ring.js';
import { SOFTWARE } from '../src/state/files.js';

test('the defaults: four views, 45° up, from the front, a 64 px tile, white paper', () => {
  assert.deepEqual(RING_DEFAULTS, {
    views: 4,
    elevation: 45,
    offset: 0,
    size: 64,
    paper: 'white',
  });
  assert.deepEqual(createRing().get(), RING_DEFAULTS);
  assert.equal(RING_MAX_VIEWS, 16);
  // The tile's edge: greater than 1, less than 256.
  assert.equal(RING_MIN_SIZE, 2);
  assert.equal(RING_MAX_SIZE, 255);
});

test('the papers: three choices in the strip’s order, each a kit pattern by name; gray is the dots dither', () => {
  assert.deepEqual(Object.keys(RING_PAPERS), ['white', 'black', 'gray']);
  assert.deepEqual(RING_PAPERS, { white: 'white', black: 'black', gray: 'dots' });
  assert.ok(
    Object.hasOwn(RING_PAPERS, RING_DEFAULTS.paper),
    'the default is one of them'
  );
});

test('setPaper: a RING_PAPERS key, anything else a no-op, silent when unchanged', () => {
  const r = createRing();
  let fired = 0;
  r.subscribe(() => fired++);
  r.setPaper('gray');
  assert.equal(r.get().paper, 'gray');
  assert.equal(fired, 1);
  r.setPaper('gray');
  assert.equal(fired, 1, 'a same-value write is a silent no-op');
  r.setPaper('black');
  assert.equal(r.get().paper, 'black');
  for (const bad of ['dots', 'grey', 'toString', '', undefined, null, 3]) {
    r.setPaper(/** @type {any} */ (bad));
    assert.equal(r.get().paper, 'black', `${String(bad)} changes nothing`);
  }
  assert.equal(fired, 2);
  r.setPaper('white');
  assert.equal(r.get().paper, 'white');
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

test('setElevation / setSize: clamped to their ranges', () => {
  const r = createRing();
  r.setElevation(-5);
  assert.equal(r.get().elevation, 0);
  r.setElevation(120);
  assert.equal(r.get().elevation, 90);
  r.setElevation(30.4);
  assert.equal(r.get().elevation, 30);
  r.setSize(0);
  assert.equal(r.get().size, RING_MIN_SIZE, 'never a 1-px (or 0-px) tile');
  r.setSize(1);
  assert.equal(r.get().size, RING_MIN_SIZE);
  r.setSize(256);
  assert.equal(r.get().size, RING_MAX_SIZE, 'less than 256');
  r.setSize(1000);
  assert.equal(r.get().size, RING_MAX_SIZE);
  r.setSize(128.4);
  assert.equal(r.get().size, 128, 'an integer');
  let fired = 0;
  r.subscribe(() => fired++);
  r.setSize(NaN);
  r.setSize(128);
  assert.equal(fired, 0, 'NaN (a field mid-edit) and a same value are silent');
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
  // The JSON copies its inputs — a later mutation of the caller's arrays
  // can't reach a chunk already built.
  geometry.yaws.push(180);
  assert.deepEqual(JSON.parse(chunks[RING_CHUNK_KEY]).yaws, [45, 90, 135]);
});
