// Node-runnable tests for the editor-session slice: the tool/ink/recency
// semantics that used to live as element methods (#selectColor, #switchTool,
// #touchRecent, the willUpdate clamps). Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSession, RECENT_SLOTS } from '../src/state/session.js';
import { PENCIL_PALETTE } from '../src/lib/constants.js';

const RED = { r: 255, g: 0, b: 0 };
const GREEN = { r: 0, g: 255, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };

test('boot: pencil active, ink seeded from the palette, recency row empty', () => {
  const s = createSession();
  const st = s.get();
  assert.equal(st.tool, 'pencil');
  assert.deepEqual(st.ink, PENCIL_PALETTE[0].rgb);
  assert.deepEqual(st.recent, [], 'the untouched mount default never enters recency');
  assert.equal(st.erase, false);
});

test('pickColor: copies the ink, clears erase, promotes to MRU', () => {
  const s = createSession();
  s.selectTransparent();
  s.pickColor(RED);
  const st = s.get();
  assert.deepEqual(st.ink, RED);
  assert.notEqual(st.ink, RED, 'the ink is a copy, not the caller object');
  assert.equal(st.erase, false);
  assert.deepEqual(st.recent, [RED], 'slot 0 is the current ink');
});

test('eyedropper is a sticky tool: a pick leaves it selected', () => {
  const s = createSession();
  s.setTool('eyedropper');
  assert.equal(s.get().tool, 'eyedropper');
  s.pickColor(RED); // an eyedrop of a painted texel
  assert.equal(s.get().tool, 'eyedropper', 'sampling does not switch tools');
  s.selectTransparent(); // an eyedrop of empty space
  assert.equal(s.get().tool, 'eyedropper', 'a transparent sample does not either');
  s.setTool('pencil');
  assert.equal(s.get().tool, 'pencil', 'only an explicit tool pick leaves it');
});

test('MRU: a second pick pushes the first down; a re-pick promotes, not duplicates', () => {
  const s = createSession();
  s.pickColor(RED);
  s.pickColor(GREEN);
  assert.deepEqual(s.get().recent, [GREEN, RED]);
  s.pickColor(RED); // recency re-pick
  assert.deepEqual(s.get().recent, [RED, GREEN], 'promoted, no duplicate');
});

test('MRU: the list caps at RECENT_SLOTS + 1 (current + the last-used row)', () => {
  const s = createSession();
  const inks = [RED, GREEN, BLUE, { r: 9, g: 9, b: 9 }, { r: 7, g: 7, b: 7 }];
  for (const c of inks) s.pickColor(c);
  const recent = s.get().recent;
  assert.equal(recent.length, RECENT_SLOTS + 1);
  assert.deepEqual(recent[0], inks[4], 'newest first');
  assert.deepEqual(recent.at(-1), inks[1], 'oldest surviving pick last');
});

test('selectTransparent: erase on, ink untouched', () => {
  const s = createSession();
  s.pickColor(RED);
  s.selectTransparent();
  const st = s.get();
  assert.equal(st.erase, true);
  assert.deepEqual(st.ink, RED, 'the solid ink survives for when erase ends');
});

test('setTool: selects the tool and returns to painting (out of eraser)', () => {
  const s = createSession();
  s.selectTransparent();
  s.setTool('rect');
  const st = s.get();
  assert.equal(st.tool, 'rect');
  assert.equal(st.erase, false);
});

test('setPencilSize / setCornerRadius clamp and round against the given bound', () => {
  const s = createSession();
  s.setPencilSize(99, 40);
  assert.equal(s.get().pencilSize, 40);
  s.setPencilSize(0, 40);
  assert.equal(s.get().pencilSize, 1, 'floor is 1');
  s.setPencilSize(3.6, 40);
  assert.equal(s.get().pencilSize, 4, 'rounded');
  s.setPencilSize(NaN, 40);
  assert.equal(s.get().pencilSize, 1, 'garbage falls back to 1');
  s.setCornerRadius(99, 20);
  assert.equal(s.get().cornerRadius, 20);
  s.setCornerRadius(-3, 20);
  assert.equal(s.get().cornerRadius, 0, 'floor is 0 (sharp)');
  s.setCornerRadius(NaN, 20);
  assert.equal(s.get().cornerRadius, 0, 'garbage falls back to 0');
});

test('clampTools: a shrink re-clamps persisted values down (the resize rule)', () => {
  const s = createSession();
  s.setPencilSize(30, 40);
  s.setCornerRadius(15, 20);
  s.clampTools(8, 4); // tile shrank
  assert.equal(s.get().pencilSize, 8);
  assert.equal(s.get().cornerRadius, 4);
  s.clampTools(64, 32); // a grow leaves in-bounds values alone
  assert.equal(s.get().pencilSize, 8);
  assert.equal(s.get().cornerRadius, 4);
});

test('picker open/close and the fill checkboxes are plain flags', () => {
  const s = createSession();
  s.openPicker();
  assert.equal(s.get().pickerOpen, true);
  s.closePicker();
  assert.equal(s.get().pickerOpen, false);
  s.setFillReplace(true);
  s.setFillAllTiles(true);
  assert.equal(s.get().fillReplace, true);
  assert.equal(s.get().fillAllTiles, true);
});

test('selectFace stores the face', () => {
  const s = createSession();
  s.selectFace('top');
  assert.equal(s.get().face, 'top');
});
