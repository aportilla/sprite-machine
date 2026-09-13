import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LAYER_MAX } from 'sprite-machine';
import { createDoc } from '../src/state/doc.js';
import { fakeScheduler } from './helpers.mjs';

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

// A 3×2 atlas of 2×2 tiles (left front top / right back bottom) with one red
// pixel at front's top-left, sheet (2,0).
function carSheet() {
  const img = sheet(6, 4);
  setPx(img, 2, 0, RED);
  return img;
}

// Two layers of 2×2 tiles: layer 1's block is rows 4 to 8, and its front's
// top-left is sheet (2,4).
function twoLayerSheet() {
  const img = sheet(6, 8);
  setPx(img, 2, 0, RED);
  setPx(img, 2, 4, RED);
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
  assert.equal(s.layers.length, 1);
  assert.deepEqual(s.names, ['Layer 1']);
  assert.ok(s.layers[0].front, 'front has art');
  assert.deepEqual(getPx(s.layers[0].front, 0, 0), RED);
  assert.equal(s.layers[0].left, null, 'a blank tile slices to null');
});

test('a layered load slices every block and fits the names to the count', () => {
  const doc = createDoc(fakeScheduler());
  doc.loadAtlas(twoLayerSheet(), {}, { layers: 2, names: ['Body'] });
  const s = doc.get();
  assert.deepEqual([s.layers.length, s.tileW, s.tileH], [2, 2, 2]);
  assert.deepEqual(getPx(s.layers[1].front, 0, 0), RED, 'rows 4 to 8');
  assert.equal(s.layers[1].left, null);
  assert.deepEqual(s.names, ['Body', 'Layer 2'], 'a missing name takes the default');
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
  doc.applyTileEdit(0, 'front', tile);
  assert.equal(changes, 0, 'a stroke write never fires the change channel');
  assert.equal(lives, 0, 'the live notify waits for the frame');
  assert.equal(doc.get().layers[0].front, tile, 'the working buffer lands BY REFERENCE');
  assert.deepEqual(getPx(doc.get().atlasImage, 3, 1), CLEAR, 'no blit before the frame');
  fs.frame();
  assert.equal(lives, 1);
  assert.equal(changes, 0);
  assert.deepEqual(getPx(doc.get().atlasImage, 3, 1), GREEN, 'the frame blits the sheet');
});

test('a tile edit blits into its own layer’s block, and edits to two layers in one frame both land', () => {
  const fs = fakeScheduler();
  const doc = createDoc(fs);
  doc.loadAtlas(twoLayerSheet(), {}, { layers: 2 });
  /** @type {object[]} */
  const edits = [];
  doc.onLive((_, edit) => edits.push(edit));
  doc.applyTileEdit(1, 'front', workTile([1, 1, GREEN]));
  doc.applyTileEdit(0, 'top', workTile([0, 0, GREEN]));
  fs.frame();
  const img = doc.get().atlasImage;
  assert.deepEqual(getPx(img, 3, 5), GREEN, 'layer 1 front (1,1)');
  assert.deepEqual(getPx(img, 3, 1), CLEAR, 'not layer 0');
  assert.deepEqual(getPx(img, 4, 0), GREEN, 'layer 0 top (0,0)');
  assert.deepEqual(edits, [
    { layer: 1, face: 'front' },
    { layer: 0, face: 'top' },
  ]);
});

test('live edits coalesce: many strokes, one blit + one notify per frame', () => {
  const fs = fakeScheduler();
  const doc = createDoc(fs);
  doc.loadAtlas(carSheet());
  let lives = 0;
  doc.onLive(() => lives++);
  doc.applyTileEdit(0, 'front', workTile([0, 1, GREEN]));
  const last = workTile([1, 0, GREEN]);
  doc.applyTileEdit(0, 'front', last);
  assert.equal(fs.size, 1, 'one scheduled frame for both edits');
  fs.frame();
  assert.equal(lives, 1);
  assert.deepEqual(getPx(doc.get().atlasImage, 3, 0), GREEN, 'the LATEST tile won');
  fs.frame();
  assert.equal(lives, 1, 'an empty frame notifies nobody');
});

test('a fully-blank tile reverts the face to derived (the view is null)', () => {
  const fs = fakeScheduler();
  const doc = createDoc(fs);
  doc.loadAtlas(carSheet());
  doc.applyTileEdit(0, 'front', workTile(null));
  assert.equal(doc.get().layers[0].front, null);
  fs.frame();
  assert.deepEqual(getPx(doc.get().atlasImage, 2, 0), CLEAR, 'the erase still blits');
});

test('drain folds the pending stroke in now; nothing left for the frame', () => {
  const fs = fakeScheduler();
  const doc = createDoc(fs);
  doc.loadAtlas(carSheet());
  let lives = 0;
  doc.onLive(() => lives++);
  doc.applyTileEdit(0, 'front', workTile([1, 1, GREEN]));
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
  doc.applyTileEdit(0, 'front', workTile([1, 1, GREEN]));
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
  doc.applyTileEdit(0, 'front', workTile([1, 1, GREEN]));
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

test('resizeTiles: a same-size call is a no-op — the doc is unchanged', () => {
  const doc = createDoc(fakeScheduler());
  doc.loadAtlas(carSheet());
  assert.equal(doc.resizeTiles(2, 2), false);
  const s = doc.get();
  assert.equal(s.tileW, 2);
  assert.equal(s.tileH, 2);
  assert.deepEqual(getPx(s.atlasImage, 2, 0), RED, 'the sheet is as loaded');
});

test('replaceAllTiles recolors every tile in ONE change notification, scoped to the tiled region', () => {
  const doc = createDoc(fakeScheduler());
  // A 7 px wide sheet over 3 columns has 2 px tiles, so column x=6 is outside
  // every tile.
  const img = sheet(7, 4);
  setPx(img, 2, 0, RED); // front tile
  setPx(img, 5, 3, RED); // bottom tile
  setPx(img, 6, 0, RED); // remainder column
  doc.loadAtlas(img);
  let changes = 0;
  doc.subscribe(() => changes++);
  const t = { r: 255, g: 0, b: 0 };
  assert.equal(doc.replaceAllTiles(0, t, { r: 0, g: 255, b: 0 }), true);
  assert.equal(changes, 1);
  assert.deepEqual(getPx(doc.get().atlasImage, 2, 0), GREEN);
  assert.deepEqual(getPx(doc.get().atlasImage, 5, 3), GREEN);
  assert.deepEqual(
    getPx(doc.get().layers[0].front, 0, 0),
    GREEN,
    're-sliced views see it'
  );
  assert.deepEqual(getPx(doc.get().atlasImage, 6, 0), RED, 'the remainder is left alone');
  assert.equal(
    doc.replaceAllTiles(0, t, { r: 0, g: 255, b: 0 }),
    false,
    'nothing left inside the tiles'
  );
});

test('replaceAllTiles stays inside its layer’s block', () => {
  const doc = createDoc(fakeScheduler());
  doc.loadAtlas(twoLayerSheet(), {}, { layers: 2 });
  assert.equal(
    doc.replaceAllTiles(1, { r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }),
    true
  );
  assert.deepEqual(getPx(doc.get().atlasImage, 2, 4), GREEN, 'layer 1');
  assert.deepEqual(getPx(doc.get().atlasImage, 2, 0), RED, 'layer 0 untouched');
});

test('restoreTile addresses one layer', () => {
  const doc = createDoc(fakeScheduler());
  doc.loadAtlas(twoLayerSheet(), {}, { layers: 2 });
  doc.restoreTile(1, 'front', null);
  assert.deepEqual(getPx(doc.get().atlasImage, 2, 4), CLEAR);
  assert.equal(doc.get().layers[1].front, null);
  assert.deepEqual(getPx(doc.get().atlasImage, 2, 0), RED, 'layer 0 untouched');
});

test('addLayer and removeLayer change the count without a new sheet generation, and report whether they did', () => {
  const doc = createDoc(fakeScheduler());
  assert.equal(doc.addLayer(), false, 'no sheet yet');
  doc.loadAtlas(carSheet());
  let changes = 0;
  doc.subscribe(() => changes++);

  assert.equal(doc.addLayer(), true);
  let s = doc.get();
  assert.equal(changes, 1);
  assert.equal(s.sheet, 1, 'the same document');
  assert.deepEqual([s.atlasImage.width, s.atlasImage.height], [6, 8]);
  assert.deepEqual(s.names, ['Layer 1', 'Layer 2']);
  assert.ok(
    Object.values(s.layers[1]).every((v) => v === null),
    'a transparent block'
  );
  assert.deepEqual(getPx(s.layers[0].front, 0, 0), RED, 'layer 0 keeps its art');

  assert.equal(doc.removeLayer(0), true);
  s = doc.get();
  assert.deepEqual([s.atlasImage.height, s.layers.length, s.names], [4, 1, ['Layer 2']]);
  assert.equal(s.layers[0].front, null, 'the blank layer moved up');
  assert.equal(s.sheet, 1);
  assert.equal(doc.removeLayer(0), false, 'never the only layer');
  assert.equal(doc.removeLayer(3), false);

  while (doc.get().layers.length < LAYER_MAX) doc.addLayer();
  assert.equal(doc.addLayer(), false, 'not past LAYER_MAX');
});

test('the sheet generation bumps on loadAtlas only — never on resize/replace', () => {
  const doc = createDoc(fakeScheduler());
  assert.equal(doc.get().sheet, 0);
  doc.loadAtlas(carSheet());
  assert.equal(doc.get().sheet, 1);
  doc.resizeTiles(4, 4);
  doc.replaceAllTiles(0, { r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 });
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
  doc.applyTileEdit(0, 'front', workTile([1, 1, GREEN]));
  const fresh = sheet(6, 4);
  doc.loadAtlas(fresh);
  fs.frame();
  assert.equal(lives, 0, 'the stale stroke never flushed');
  assert.deepEqual(getPx(fresh, 3, 1), CLEAR, 'nothing blitted into the new sheet');
});
