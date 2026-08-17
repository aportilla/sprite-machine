// Node-runnable tests for the editor-session slice: the tool/ink semantics
// that used to live as element methods (#selectColor, #switchTool, the
// willUpdate clamps). Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSession } from '../src/state/session.js';
import { PENCIL_PALETTE } from '../src/lib/constants.js';

const RED = { r: 255, g: 0, b: 0 };
const GREEN = { r: 0, g: 255, b: 0 };

test('boot: pencil active, ink seeded from the palette', () => {
  const s = createSession();
  const st = s.get();
  assert.equal(st.tool, 'pencil');
  assert.deepEqual(st.ink, PENCIL_PALETTE[0].rgb);
});

test('pickColor: copies the ink', () => {
  const s = createSession();
  s.pickColor(RED);
  const st = s.get();
  assert.deepEqual(st.ink, RED);
  assert.notEqual(st.ink, RED, 'the ink is a copy, not the caller object');
});

test('eyedropper is a sticky tool: a pick leaves it selected', () => {
  const s = createSession();
  s.setTool('eyedropper');
  assert.equal(s.get().tool, 'eyedropper');
  s.pickColor(RED); // an eyedrop of a painted texel
  assert.equal(s.get().tool, 'eyedropper', 'sampling does not switch tools');
  s.setTool('pencil');
  assert.equal(s.get().tool, 'pencil', 'only an explicit tool pick leaves it');
});

test('eraserSize is its own setting — independent of pencilSize both ways', () => {
  const s = createSession();
  assert.equal(s.get().eraserSize, 1, 'boots at 1, like the pencil');
  s.setPencilSize(4, 40);
  s.setEraserSize(9, 40);
  assert.equal(s.get().pencilSize, 4, 'setting the eraser leaves the pencil alone');
  assert.equal(s.get().eraserSize, 9);
  s.setPencilSize(12, 40);
  assert.equal(s.get().eraserSize, 9, 'and vice versa');
});

test('setEraserSize clamps and rounds like the pencil (its own code path)', () => {
  const s = createSession();
  s.setEraserSize(99, 40);
  assert.equal(s.get().eraserSize, 40);
  s.setEraserSize(0, 40);
  assert.equal(s.get().eraserSize, 1, 'floor is 1');
  s.setEraserSize(3.6, 40);
  assert.equal(s.get().eraserSize, 4, 'rounded');
  s.setEraserSize(NaN, 40);
  assert.equal(s.get().eraserSize, 1, 'garbage falls back to 1');
});

test('the eraser is a sticky tool: selecting it leaves the ink untouched', () => {
  const s = createSession();
  s.pickColor(RED);
  s.setTool('eraser');
  const st = s.get();
  assert.equal(st.tool, 'eraser');
  assert.deepEqual(st.ink, RED, 'the solid ink survives for when erasing ends');
});

test('pickColor while the eraser is held returns to the pencil', () => {
  const s = createSession();
  s.setTool('eraser');
  s.pickColor(GREEN); // picking a color means "paint with this"
  const st = s.get();
  assert.equal(st.tool, 'pencil');
  assert.deepEqual(st.ink, GREEN);
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
  s.setEraserSize(25, 40);
  s.setCornerRadius(15, 20);
  s.clampTools(8, 4); // tile shrank
  assert.equal(s.get().pencilSize, 8);
  assert.equal(s.get().eraserSize, 8);
  assert.equal(s.get().cornerRadius, 4);
  s.clampTools(64, 32); // a grow leaves in-bounds values alone
  assert.equal(s.get().pencilSize, 8);
  assert.equal(s.get().eraserSize, 8);
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

// (The edited FACE is per-document-window state now — it lives on the
// workspace context, tested in workspace.test.mjs.)
