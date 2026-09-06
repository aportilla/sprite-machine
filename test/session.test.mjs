// Node-runnable tests for the editor-session slice (state/session.js): the
// tool / ink semantics, the tool settings' clamps and the tip-shape gate.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSession } from '../src/state/session.js';
import { PENCIL_PALETTE } from '../src/lib/constants.js';
import { PENCIL_SHAPES } from '../src/lib/brush.js';

const RED = { r: 255, g: 0, b: 0 };
const GREEN = { r: 0, g: 255, b: 0 };

test('boot: pencil active, ink seeded from the palette', () => {
  const s = createSession();
  const st = s.get();
  assert.equal(st.tool, 'pencil');
  assert.deepEqual(st.ink, PENCIL_PALETTE[0].rgb);
});

test('the eyedropper, selection and eraser are sticky tools: a pick or a switch leaves them and the ink alone', () => {
  for (const tool of ['eyedropper', 'select']) {
    const s = createSession();
    s.setTool(tool);
    s.pickColor(RED); // an eyedrop of a painted texel, ⌘K → OK, an Alt-sample
    assert.equal(s.get().tool, tool, `${tool}: a pick does not switch tools`);
    assert.deepEqual(s.get().ink, RED, `${tool}: but it does take the ink`);
    s.setTool('pencil');
    assert.equal(s.get().tool, 'pencil', 'only an explicit tool pick leaves it');
  }
  const s = createSession();
  s.pickColor(RED);
  s.setTool('eraser');
  assert.equal(s.get().tool, 'eraser');
  assert.deepEqual(s.get().ink, RED, 'the solid ink survives for when erasing ends');
});

test('pickColor while the eraser is held returns to the pencil', () => {
  const s = createSession();
  s.setTool('eraser');
  s.pickColor(GREEN); // picking a color means "paint with this"
  const st = s.get();
  assert.equal(st.tool, 'pencil');
  assert.deepEqual(st.ink, GREEN);
});

test('the tool settings clamp and round against the given bound; clampTools re-clamps them on a shrink', () => {
  // [setter, key, bound, floor]: a size floors at 1, the radius at 0 (sharp).
  const table = [
    ['setPencilSize', 'pencilSize', 40, 1],
    ['setEraserSize', 'eraserSize', 40, 1],
    ['setCornerRadius', 'cornerRadius', 20, 0],
  ];
  for (const [setter, key, bound, floor] of table) {
    const s = createSession();
    s[setter](3.6, bound);
    assert.equal(s.get()[key], 4, `${setter}: rounded`);
    s[setter](bound + 59, bound);
    assert.equal(s.get()[key], bound, `${setter}: capped at the bound`);
    s[setter](floor - 3, bound);
    assert.equal(s.get()[key], floor, `${setter}: floored`);
  }
  const s = createSession();
  s.setPencilSize(7, 40);
  s.setPencilSize(NaN, 40);
  assert.equal(s.get().pencilSize, 1, 'garbage falls back to the floor');
  // The resize rule: a shrink re-clamps persisted values down, a grow leaves
  // in-bounds values alone.
  const sizes = ({ pencilSize, eraserSize, cornerRadius }) => ({
    pencilSize,
    eraserSize,
    cornerRadius,
  });
  s.setPencilSize(30, 40);
  s.setEraserSize(25, 40);
  s.setCornerRadius(15, 20);
  s.clampTools(8, 4); // tile shrank
  assert.deepEqual(sizes(s.get()), { pencilSize: 8, eraserSize: 8, cornerRadius: 4 });
  s.clampTools(64, 32);
  assert.deepEqual(sizes(s.get()), { pencilSize: 8, eraserSize: 8, cornerRadius: 4 });
});

test('the tip shapes: circle every load for both tools; each setter takes the two names and nothing else', () => {
  const s = createSession();
  assert.equal(s.get().pencilShape, 'circle');
  assert.equal(s.get().eraserShape, 'circle');
  for (const [setter, key] of [
    ['setPencilShape', 'pencilShape'],
    ['setEraserShape', 'eraserShape'],
  ]) {
    for (const shape of PENCIL_SHAPES) {
      s[setter](shape);
      assert.equal(s.get()[key], shape);
    }
    const held = s.get()[key];
    s[setter]('blob');
    assert.equal(s.get()[key], held, `${setter}: an unknown shape is a no-op`);
    s[setter](/** @type {any} */ (undefined));
    assert.equal(s.get()[key], held, `${setter}: so is a missing one`);
  }
});

test('picker open/close and the fill checkboxes are plain flags', () => {
  const s = createSession();
  s.openPicker();
  assert.equal(s.get().pickerOpen, true);
  s.closePicker();
  assert.equal(s.get().pickerOpen, false);
  // Contiguous is the tool's resting state; on-all-faces starts off.
  assert.equal(s.get().fillContiguous, true);
  assert.equal(s.get().fillAllFaces, false);
  s.setFillContiguous(false);
  s.setFillAllFaces(true);
  assert.equal(s.get().fillContiguous, false);
  assert.equal(s.get().fillAllFaces, true);
});

// (The edited FACE is per-document-window state now — it lives on the
// workspace context, tested in workspace.test.mjs.)
