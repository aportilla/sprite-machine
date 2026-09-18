import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDoc } from '../src/state/doc.js';
import { createHistory } from '../src/state/history.js';
import { fakeScheduler } from './helpers.mjs';

const sheet = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });

const tile = (px) => {
  const t = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
  if (px) {
    const [x, y, rgba] = px;
    t.data.set(rgba, (y * 2 + x) * 4);
  }
  return t;
};

const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];

const frontAlphaAt = (doc) => {
  // The front tile is column 1, row 0 of a 3×2 sheet of 2×2 tiles. Its texel
  // (0,0) is sheet (2,0).
  const s = doc.get();
  return s.atlasImage.data[(0 * s.atlasImage.width + 2) * 4 + 3];
};

function makeWorld({ layers = 1 } = {}) {
  const frames = fakeScheduler();
  const doc = createDoc(frames);
  doc.loadAtlas(sheet(6, 4 * layers), {}, { layers });
  const history = createHistory(doc, { limit: 3 });
  return { doc, history, frames };
}

test('starts with nothing to undo or redo', () => {
  const { history } = makeWorld();
  assert.deepEqual(history.get(), { canUndo: false, canRedo: false });
  assert.equal(history.undo(), false);
  assert.equal(history.redo(), false);
});

test('a tile entry undoes and redoes through the doc structurally', () => {
  const { doc, history, frames } = makeWorld();
  const before = tile(null);
  const after = tile([0, 0, RED]);
  doc.applyTileEdit(0, 'front', after);
  frames.frame();
  history.pushTile(0, 'front', before, after);
  assert.equal(history.get().canUndo, true);
  assert.equal(frontAlphaAt(doc), 255);

  let structural = 0;
  const unsub = doc.subscribe(() => structural++);
  assert.equal(history.undo(), true);
  assert.equal(structural, 1, 'a restore is a CHANGE-channel event');
  assert.equal(frontAlphaAt(doc), 0, 'the pixel is gone from the sheet');
  assert.equal(
    doc.get().layers[0].front,
    null,
    'a blank restore reverts the face to derived'
  );
  assert.deepEqual(history.get(), { canUndo: false, canRedo: true });

  assert.equal(history.redo(), true);
  assert.equal(frontAlphaAt(doc), 255);
  assert.deepEqual(history.get(), { canUndo: true, canRedo: false });
  unsub();
});

test('a faces entry undoes and redoes every face as ONE step, and drops the pairs that changed nothing', () => {
  const { doc, history, frames } = makeWorld();
  // The top tile is column 2, row 0; its texel (1,1) is sheet (5,1).
  const topAlpha = () => doc.get().atlasImage.data[(1 * 6 + 5) * 4 + 3];
  doc.applyTileEdit(0, 'front', tile([0, 0, RED]));
  doc.applyTileEdit(0, 'top', tile([1, 1, RED]));
  frames.frame();
  history.pushFaces(0, [
    { face: 'front', before: tile(null), after: tile([0, 0, RED]) },
    { face: 'top', before: tile(null), after: tile([1, 1, RED]) },
    { face: 'left', before: tile([0, 0, GREEN]), after: tile([0, 0, GREEN]) },
  ]);

  let structural = 0;
  const unsub = doc.subscribe(() => structural++);
  assert.equal(history.undo(), true);
  assert.equal(structural, 1, 'one restore for both faces');
  assert.deepEqual([frontAlphaAt(doc), topAlpha()], [0, 0]);
  assert.deepEqual(history.get(), { canUndo: false, canRedo: true }, 'one entry');
  history.redo();
  assert.deepEqual([frontAlphaAt(doc), topAlpha()], [255, 255]);
  unsub();
});

test('a faces entry of pairs that all match is not recorded', () => {
  const { history } = makeWorld();
  history.pushFaces(0, [{ face: 'front', before: tile(null), after: tile(null) }]);
  history.pushFaces(0, []);
  assert.equal(history.get().canUndo, false);
});

test('an identical before/after pair is dropped, not recorded', () => {
  const { history } = makeWorld();
  history.pushTile(0, 'front', tile([0, 0, RED]), tile([0, 0, RED]));
  assert.equal(history.get().canUndo, false);
});

test('snapshots are copies — mutating the pushed buffer later changes nothing', () => {
  const { doc, history, frames } = makeWorld();
  const work = tile([0, 0, RED]);
  doc.applyTileEdit(0, 'front', work);
  frames.frame();
  history.pushTile(0, 'front', tile(null), work);
  work.data.set(GREEN, 0);
  history.undo();
  history.redo();
  const f = doc.get().layers[0].front;
  assert.deepEqual(
    [...f.data.subarray(0, 4)],
    RED,
    'the entry kept RED, not the mutated GREEN'
  );
});

test('withAtlasSnapshot records a whole-sheet pair and undoes a resize', () => {
  const { doc, history } = makeWorld();
  const changed = history.withAtlasSnapshot(() => doc.resizeTiles(3, 3));
  assert.equal(changed, true);
  assert.equal(doc.get().tileW, 3);
  assert.equal(history.get().canUndo, true);

  history.undo();
  assert.equal(doc.get().tileW, 2, 'the resize is undone');
  history.redo();
  assert.equal(doc.get().tileW, 3);
});

test('withAtlasSnapshot drops a no-op (nothing changed, nothing recorded)', () => {
  const { doc, history } = makeWorld();
  const changed = history.withAtlasSnapshot(() => doc.resizeTiles(2, 2));
  assert.equal(changed, false);
  assert.equal(history.get().canUndo, false);
});

test('withAtlasSnapshot folds a pending live stroke into the BEFORE side', () => {
  const { doc, history } = makeWorld();
  doc.applyTileEdit(0, 'front', tile([0, 0, RED])); // pending: no frame has run
  history.withAtlasSnapshot(() => doc.resizeTiles(3, 3));
  history.undo();
  assert.equal(doc.get().tileW, 2);
  assert.equal(frontAlphaAt(doc), 255, 'the drained stroke survives the undo');
});

test('an atlas undo does not disturb the stored snapshot (copy-out)', () => {
  const { doc, history, frames } = makeWorld();
  history.withAtlasSnapshot(() => doc.resizeTiles(3, 3));
  history.undo();
  // Edit the restored sheet, then redo and undo. The entry still holds the
  // unedited 2px sheet.
  doc.applyTileEdit(0, 'front', tile([0, 0, RED]));
  frames.frame();
  history.redo();
  history.undo();
  assert.equal(doc.get().tileW, 2);
  assert.equal(frontAlphaAt(doc), 0, 'the snapshot predates the edit');
});

test('an atlas entry restores the layer names with the sheet', () => {
  const { doc, history } = makeWorld();
  const changed = history.withAtlasSnapshot(() => doc.addLayer());
  assert.equal(changed, true);
  assert.deepEqual(doc.get().names, ['Layer 1', 'Layer 2']);
  history.undo();
  assert.deepEqual([doc.get().layers.length, doc.get().names], [1, ['Layer 1']]);
  history.redo();
  assert.deepEqual(
    [doc.get().layers.length, doc.get().names],
    [2, ['Layer 1', 'Layer 2']]
  );
});

test('a names entry undoes and redoes a rename; a rename to the same name records nothing', () => {
  const { doc, history } = makeWorld({ layers: 2 });
  history.withNamesSnapshot(() => doc.renameLayer(1, 'Wheels'));
  history.withNamesSnapshot(() => doc.renameLayer(1, 'Wheels'));
  history.undo();
  assert.deepEqual(doc.get().names, ['Layer 1', 'Layer 2']);
  assert.equal(history.get().canUndo, false, 'one entry');
  history.redo();
  assert.deepEqual(doc.get().names, ['Layer 1', 'Wheels']);
});

test('a new edit clears the redo stack', () => {
  const { history } = makeWorld();
  history.pushTile(0, 'front', tile(null), tile([0, 0, RED]));
  history.undo();
  assert.equal(history.get().canRedo, true);
  history.pushTile(0, 'front', tile(null), tile([0, 0, GREEN]));
  assert.equal(history.get().canRedo, false);
});

test('the stack is bounded — the oldest entry falls off', () => {
  const { history } = makeWorld(); // limit 3
  const colors = [RED, GREEN, [0, 0, 255, 255], [255, 255, 0, 255]];
  for (const c of colors) history.pushTile(0, 'front', tile(null), tile([0, 0, c]));
  let undone = 0;
  while (history.undo()) undone++;
  assert.equal(undone, 3, 'only the newest three survive');
});

test('a wholesale load clears both stacks', () => {
  const { doc, history } = makeWorld();
  history.pushTile(0, 'front', tile(null), tile([0, 0, RED]));
  history.undo();
  assert.equal(history.get().canRedo, true);
  doc.loadAtlas(sheet(6, 4));
  assert.deepEqual(history.get(), { canUndo: false, canRedo: false });
});

test('undoing a tile entry for a NON-current face still lands on the sheet', () => {
  const { doc, history, frames } = makeWorld();
  doc.applyTileEdit(0, 'top', tile([1, 1, RED]));
  frames.frame();
  history.pushTile(0, 'top', tile(null), tile([1, 1, RED]));
  // The top tile is column 2, row 0. Its texel (1,1) is sheet (5,1).
  const topAlpha = () => doc.get().atlasImage.data[(1 * 6 + 5) * 4 + 3];
  assert.equal(topAlpha(), 255);
  history.undo();
  assert.equal(topAlpha(), 0);
});

test('a tile entry restores on its own layer', () => {
  const { doc, history, frames } = makeWorld({ layers: 2 });
  doc.applyTileEdit(1, 'top', tile([1, 1, RED]));
  frames.frame();
  history.pushTile(1, 'top', tile(null), tile([1, 1, RED]));
  // Layer 1's top texel (1,1) is sheet (5, 5); layer 0's is (5, 1).
  const alphaAt = (y) => doc.get().atlasImage.data[(y * 6 + 5) * 4 + 3];
  doc.applyTileEdit(0, 'top', tile([1, 1, GREEN]));
  frames.frame();
  history.undo();
  assert.equal(alphaAt(5), 0, 'layer 1 restored');
  assert.equal(alphaAt(1), 255, 'layer 0 untouched');
});
