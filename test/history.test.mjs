// Node-runnable tests for the history slice: tile-gesture entries, whole-atlas
// snapshot entries, the bound, redo clearing, load-boundary clearing, and that
// restores are structural doc changes with intact snapshots.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDoc } from '../src/state/doc.js';
import { createHistory } from '../src/state/history.js';

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
  };
}

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
  // FRONT is tile (col 1, row 0) in a 3×2 sheet of 2×2 tiles; texel (0,0) of
  // it lands at sheet (2,0).
  const s = doc.get();
  return s.atlasImage.data[(0 * s.atlasImage.width + 2) * 4 + 3];
};

function makeWorld() {
  const frames = fakeScheduler();
  const doc = createDoc(frames);
  doc.loadAtlas(sheet(6, 4));
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
  doc.applyTileEdit('front', after);
  frames.frame();
  history.pushTile('front', before, after);
  assert.equal(history.get().canUndo, true);
  assert.equal(frontAlphaAt(doc), 255);

  let structural = 0;
  const unsub = doc.subscribe(() => structural++);
  assert.equal(history.undo(), true);
  assert.equal(structural, 1, 'a restore is a CHANGE-channel event');
  assert.equal(frontAlphaAt(doc), 0, 'the pixel is gone from the sheet');
  assert.equal(
    doc.get().views.front,
    null,
    'a blank restore reverts the face to derived'
  );
  assert.deepEqual(history.get(), { canUndo: false, canRedo: true });

  assert.equal(history.redo(), true);
  assert.equal(frontAlphaAt(doc), 255);
  assert.deepEqual(history.get(), { canUndo: true, canRedo: false });
  unsub();
});

test('an identical before/after pair is dropped, not recorded', () => {
  const { history } = makeWorld();
  history.pushTile('front', tile([0, 0, RED]), tile([0, 0, RED]));
  assert.equal(history.get().canUndo, false);
});

test('snapshots are copies — mutating the pushed buffer later changes nothing', () => {
  const { doc, history, frames } = makeWorld();
  const work = tile([0, 0, RED]);
  doc.applyTileEdit('front', work);
  frames.frame();
  history.pushTile('front', tile(null), work);
  work.data.set(GREEN, 0); // the live buffer moves on (next gesture)
  history.undo();
  history.redo();
  const f = doc.get().views.front;
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
  const { doc, history, frames } = makeWorld();
  doc.applyTileEdit('front', tile([0, 0, RED])); // pending — frame never cranked
  history.withAtlasSnapshot(() => doc.resizeTiles(3, 3));
  history.undo();
  assert.equal(doc.get().tileW, 2);
  assert.equal(frontAlphaAt(doc), 255, 'the drained stroke survives the undo');
});

test('an atlas undo does not disturb the stored snapshot (copy-out)', () => {
  const { doc, history, frames } = makeWorld();
  history.withAtlasSnapshot(() => doc.resizeTiles(3, 3));
  history.undo();
  // Edit the restored sheet, then redo/undo again: the entry must still hold
  // the clean 2px sheet, not the edited one.
  doc.applyTileEdit('front', tile([0, 0, RED]));
  frames.frame();
  history.redo();
  history.undo();
  assert.equal(doc.get().tileW, 2);
  assert.equal(frontAlphaAt(doc), 0, 'the snapshot predates the edit');
});

test('a new edit clears the redo stack', () => {
  const { history } = makeWorld();
  history.pushTile('front', tile(null), tile([0, 0, RED]));
  history.undo();
  assert.equal(history.get().canRedo, true);
  history.pushTile('front', tile(null), tile([0, 0, GREEN]));
  assert.equal(history.get().canRedo, false);
});

test('the stack is bounded — the oldest entry falls off', () => {
  const { doc, history } = makeWorld(); // limit 3
  const colors = [RED, GREEN, [0, 0, 255, 255], [255, 255, 0, 255]];
  for (const c of colors) history.pushTile('front', tile(null), tile([0, 0, c]));
  let undone = 0;
  while (history.undo()) undone++;
  assert.equal(undone, 3, 'only the newest three survive');
});

test('a wholesale load clears both stacks', () => {
  const { doc, history } = makeWorld();
  history.pushTile('front', tile(null), tile([0, 0, RED]));
  history.undo();
  assert.equal(history.get().canRedo, true);
  doc.loadAtlas(sheet(6, 4));
  assert.deepEqual(history.get(), { canUndo: false, canRedo: false });
});

test('undoing a tile entry for a NON-current face still lands on the sheet', () => {
  const { doc, history, frames } = makeWorld();
  doc.applyTileEdit('top', tile([1, 1, RED]));
  frames.frame();
  history.pushTile('top', tile(null), tile([1, 1, RED]));
  // TOP is tile (col 2, row 0): texel (1,1) → sheet (5,1).
  const topAlpha = () => doc.get().atlasImage.data[(1 * 6 + 5) * 4 + 3];
  assert.equal(topAlpha(), 255);
  history.undo();
  assert.equal(topAlpha(), 0);
});
