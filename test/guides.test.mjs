// Node-runnable tests for the editor alignment guides (pure, no THREE/DOM).
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { faceGuides } from '../src/lib/guides.js';
import { VIEW_IMAGE_AXES, VIEWS, VIEW_AXES } from '../src/lib/views.js';

// tiny sprite builder: rows of chars -> ImageData-like (any non-'.' is opaque).
function img(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (rows[y][x] !== '.') data[(y * w + x) * 4 + 3] = 255;
  return { width: w, height: h, data };
}

// VIEW_IMAGE_AXES is probed from project(); pin it so it can't silently drift.
test('VIEW_IMAGE_AXES agrees with the projections it is probed from', () => {
  const d = { nx: 2, ny: 2, nz: 2 };
  const ARG = { nx: 0, ny: 1, nz: 2 };
  for (const name of Object.keys(VIEWS)) {
    const ia = VIEW_IMAGE_AXES[name];
    const [colAxis, rowAxis] = VIEW_AXES[name];
    assert.equal(ia.colAxis, colAxis, `${name} colAxis`);
    assert.equal(ia.rowAxis, rowAxis, `${name} rowAxis`);
    const idx = (axis, coord, which) => {
      const p = [0, 0, 0];
      p[ARG[axis]] = coord;
      return VIEWS[name].project(p[0], p[1], p[2], d)[which];
    };
    assert.equal(ia.colFlip, idx(colAxis, 0, 'u') > idx(colAxis, 1, 'u'));
    assert.equal(ia.rowFlip, idx(rowAxis, 0, 'v') > idx(rowAxis, 1, 'v'));
  }
});

// Spot-check the well-known orientations the guides rely on.
test('VIEW_IMAGE_AXES: front/top orientations', () => {
  assert.deepEqual(VIEW_IMAGE_AXES.front, {
    colAxis: 'nx', colFlip: false, rowAxis: 'ny', rowFlip: true,
  });
  assert.deepEqual(VIEW_IMAGE_AXES.top, {
    colAxis: 'nx', colFlip: false, rowAxis: 'nz', rowFlip: true,
  });
});

// Editing FRONT: TOP/BOTTOM constrain columns (X), LEFT/RIGHT constrain rows (Y).
test('faceGuides(front): top sets the column extent, side sets the row extent', () => {
  const views = {
    top: img(['.T.', '.T.', '.T.']), // content only in column x=1
    right: img(['...', '...', 'NNN']), // content only in world y=0 (bottom row)
  };
  const g = faceGuides(views, 'front', 3, 3);
  // TOP's single column x=1 -> front column 1 supported (identity on X).
  assert.deepEqual([...g.colSupport], [0, 1, 0]);
  assert.equal(g.extent.uMin, 1);
  assert.equal(g.extent.uMax, 1);
  // SIDE's world y=0 lands on front's BOTTOM image row (v=2).
  assert.deepEqual([...g.rowSupport], [0, 0, 1]);
  assert.equal(g.extent.vMin, 2);
  assert.equal(g.extent.vMax, 2);
});

// An axis with no constraining view drawn yields null support (no hairlines).
test('faceGuides: an unconstrained axis reports null (nothing to draw)', () => {
  const g = faceGuides({ top: img(['TTT', 'TTT', 'TTT']) }, 'front', 3, 3);
  assert.notEqual(g.colSupport, null); // top constrains columns
  assert.equal(g.rowSupport, null); // no left/right -> rows unconstrained
  assert.equal(g.extent.vMin, null);
  assert.equal(g.extent.vMax, null);
});
