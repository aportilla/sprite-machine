// Node-runnable tests for the doc slice: the canonical atlas, the silent
// stroke-write contract, and the rAF-coalesced live channel with its
// drain-before-consume guard — driven by an injectable frame scheduler.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDoc } from '../src/state/doc.js';

// A hand-cranked frame scheduler standing in for requestAnimationFrame.
function fakeScheduler() {
  let next = 1;
  const pending = new Map();
  return {
    schedule: (fn) => {
      const id = next++;
      pending.set(id, fn);
      return id;
    },
    cancel: (id) => pending.delete(id),
    frame() {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn();
    },
    get size() {
      return pending.size;
    },
  };
}

const sheet = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });

function setPx(img, x, y, [r, g, b, a = 255]) {
  const i = (y * img.width + x) * 4;
  img.data[i] = r;
  img.data[i + 1] = g;
  img.data[i + 2] = b;
  img.data[i + 3] = a;
}

const getPx = (img, x, y) => {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
};

const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const CLEAR = [0, 0, 0, 0];

// A 3×2 atlas of 2×2 tiles (layout: LEFT FRONT TOP / RIGHT BACK BOTTOM) with
// one red pixel in FRONT's top-left corner (sheet coords 2,0).
function carSheet() {
  const img = sheet(6, 4);
  setPx(img, 2, 0, RED);
  return img;
}

const workTile = (px) => {
  const t = { width: 2, height: 2, data: new Uint8ClampedArray(2 * 2 * 4) };
  if (px) setPx(t, px[0], px[1], px[2]);
  return t;
};

test('loadAtlas slices views + tile geometry in ONE change notification', () => {
  const doc = createDoc(fakeScheduler());
  let notified = 0;
  doc.subscribe(() => notified++);
  doc.loadAtlas(carSheet());
  assert.equal(notified, 1);
  const s = doc.get();
  assert.equal(s.tileW, 2);
  assert.equal(s.tileH, 2);
  assert.equal(s.cols, 3);
  assert.equal(s.rows, 2);
  assert.ok(s.views.front, 'front has art');
  assert.deepEqual(getPx(s.views.front, 0, 0), RED);
  assert.equal(s.views.left, null, 'a blank tile slices to null');
});

test('applyTileEdit: silent on the change channel, view stored by reference', () => {
  const fs = fakeScheduler();
  const doc = createDoc(fs);
  doc.loadAtlas(carSheet());
  let changes = 0;
  let lives = 0;
  doc.subscribe(() => changes++);
  doc.onLive(() => lives++);
  const tile = workTile([1, 1, GREEN]);
  doc.applyTileEdit('front', tile);
  assert.equal(changes, 0, 'a stroke write never fires the change channel');
  assert.equal(lives, 0, 'the live notify waits for the frame');
  assert.equal(doc.get().views.front, tile, 'the working buffer lands BY REFERENCE');
  assert.deepEqual(getPx(doc.get().atlasImage, 3, 1), CLEAR, 'no blit before the frame');
  fs.frame();
  assert.equal(lives, 1);
  assert.equal(changes, 0);
  assert.deepEqual(getPx(doc.get().atlasImage, 3, 1), GREEN, 'the frame blits the sheet');
});

test('live edits coalesce: many strokes, one blit + one notify per frame', () => {
  const fs = fakeScheduler();
  const doc = createDoc(fs);
  doc.loadAtlas(carSheet());
  let lives = 0;
  doc.onLive(() => lives++);
  doc.applyTileEdit('front', workTile([0, 1, GREEN]));
  const last = workTile([1, 0, GREEN]);
  doc.applyTileEdit('front', last);
  assert.equal(fs.size, 1, 'one scheduled frame for both edits');
  fs.frame();
  assert.equal(lives, 1);
  assert.deepEqual(getPx(doc.get().atlasImage, 3, 0), GREEN, 'the LATEST tile won');
  fs.frame();
  assert.equal(lives, 1, 'an empty frame notifies nobody');
});

test('a fully-blank tile reverts the face to derived (views[face] = null)', () => {
  const fs = fakeScheduler();
  const doc = createDoc(fs);
  doc.loadAtlas(carSheet());
  doc.applyTileEdit('front', workTile(null));
  assert.equal(doc.get().views.front, null);
  fs.frame();
  assert.deepEqual(getPx(doc.get().atlasImage, 2, 0), CLEAR, 'the erase still blits');
});

test('drain folds the pending stroke in now; nothing left for the frame', () => {
  const fs = fakeScheduler();
  const doc = createDoc(fs);
  doc.loadAtlas(carSheet());
  let lives = 0;
  doc.onLive(() => lives++);
  doc.applyTileEdit('front', workTile([1, 1, GREEN]));
  doc.drain();
  assert.equal(lives, 1);
  assert.deepEqual(getPx(doc.get().atlasImage, 3, 1), GREEN);
  fs.frame();
  assert.equal(lives, 1, 'the cancelled frame is empty');
  doc.drain();
  assert.equal(lives, 1, 'a drain with nothing pending is a no-op');
});

test('dropLive discards the pending blit (a wholesale sheet swap is coming)', () => {
  const fs = fakeScheduler();
  const doc = createDoc(fs);
  doc.loadAtlas(carSheet());
  let lives = 0;
  doc.onLive(() => lives++);
  doc.applyTileEdit('front', workTile([1, 1, GREEN]));
  doc.dropLive();
  fs.frame();
  assert.equal(lives, 0);
  assert.deepEqual(getPx(doc.get().atlasImage, 3, 1), CLEAR, 'never blitted');
});

test('resizeTiles drains the pending stroke BEFORE resizing (old scale, old sheet)', () => {
  const fs = fakeScheduler();
  const doc = createDoc(fs);
  const original = carSheet();
  doc.loadAtlas(original);
  doc.applyTileEdit('front', workTile([1, 1, GREEN]));
  let sheetAtFlush = null;
  let blitAtFlush = null;
  doc.onLive((s) => {
    sheetAtFlush = s.atlasImage;
    blitAtFlush = getPx(s.atlasImage, 3, 1);
  });
  assert.equal(doc.resizeTiles(4, 4), true);
  assert.equal(sheetAtFlush, original, 'the drain blitted the OLD sheet…');
  assert.deepEqual(blitAtFlush, GREEN, '…at the OLD tile scale');
  const s = doc.get();
  assert.equal(s.tileW, 4);
  assert.notEqual(s.atlasImage, original, 'then the resize swapped the sheet');
});

test('resizeTiles: same-size is a silent no-op; sizes clamp to the tile bounds', () => {
  const doc = createDoc(fakeScheduler());
  doc.loadAtlas(carSheet());
  let changes = 0;
  doc.subscribe(() => changes++);
  assert.equal(doc.resizeTiles(2, 2), false);
  assert.equal(changes, 0);
  assert.equal(doc.resizeTiles(100, 100), true, 'over-max clamps, still a change');
  assert.equal(doc.get().tileW, 64);
  assert.equal(doc.resizeTiles(0, 0), true, 'under-min clamps to 1');
  assert.equal(doc.get().tileW, 1);
});

test('replaceAllTiles recolors every tile, one change notification', () => {
  const doc = createDoc(fakeScheduler());
  const img = carSheet();
  setPx(img, 5, 3, RED); // BOTTOM tile too — "all tiles" means all tiles
  doc.loadAtlas(img);
  let changes = 0;
  doc.subscribe(() => changes++);
  const t = { r: 255, g: 0, b: 0 };
  assert.equal(doc.replaceAllTiles(t, { r: 0, g: 255, b: 0 }), true);
  assert.equal(changes, 1);
  assert.deepEqual(getPx(doc.get().atlasImage, 2, 0), GREEN);
  assert.deepEqual(getPx(doc.get().atlasImage, 5, 3), GREEN);
  assert.deepEqual(getPx(doc.get().views.front, 0, 0), GREEN, 're-sliced views see it');
  assert.equal(doc.replaceAllTiles(t, { r: 0, g: 255, b: 0 }), false, 'nothing left');
  assert.equal(changes, 1, 'an unchanged sheet notifies nobody');
});

test('replaceAllTiles is scoped to the tiled region (remainder pixels untouched)', () => {
  const doc = createDoc(fakeScheduler());
  // A 7px-wide sheet over 3 columns rounds to 2px tiles: column x=6 is outside
  // every tile — invisible to the carve, present in a download.
  const img = sheet(7, 4);
  setPx(img, 2, 0, RED); // inside FRONT
  setPx(img, 6, 0, RED); // the remainder column
  doc.loadAtlas(img);
  doc.replaceAllTiles({ r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 });
  assert.deepEqual(getPx(doc.get().atlasImage, 2, 0), GREEN);
  assert.deepEqual(getPx(doc.get().atlasImage, 6, 0), RED, 'remainder left alone');
});

test('the sheet generation bumps on loadAtlas only — never on resize/replace', () => {
  const doc = createDoc(fakeScheduler());
  assert.equal(doc.get().sheet, 0);
  doc.loadAtlas(carSheet());
  assert.equal(doc.get().sheet, 1);
  doc.resizeTiles(4, 4);
  doc.replaceAllTiles({ r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 });
  assert.equal(doc.get().sheet, 1, 'same document, same generation');
  doc.loadAtlas(carSheet());
  assert.equal(doc.get().sheet, 2);
});

test('loadAtlas drops a pending stroke from the OLD sheet', () => {
  const fs = fakeScheduler();
  const doc = createDoc(fs);
  doc.loadAtlas(carSheet());
  let lives = 0;
  doc.onLive(() => lives++);
  doc.applyTileEdit('front', workTile([1, 1, GREEN]));
  const fresh = sheet(6, 4);
  doc.loadAtlas(fresh);
  fs.frame();
  assert.equal(lives, 0, 'the stale stroke never flushed');
  assert.deepEqual(getPx(fresh, 3, 1), CLEAR, 'nothing blitted into the new sheet');
});
