// Node-runnable tests for the view definitions (pure, no THREE/DOM) — chiefly
// VIEW_IMAGE_AXES, the per-view image-axis table atlas.js's resize consumes.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VIEW_IMAGE_AXES, VIEWS, VIEW_AXES } from '../src/lib/views.js';

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

// Spot-check the well-known orientations the resize's registration relies on.
test('VIEW_IMAGE_AXES: front/top orientations', () => {
  assert.deepEqual(VIEW_IMAGE_AXES.front, {
    colAxis: 'nx',
    colFlip: false,
    rowAxis: 'ny',
    rowFlip: true,
  });
  assert.deepEqual(VIEW_IMAGE_AXES.top, {
    colAxis: 'nx',
    colFlip: false,
    rowAxis: 'nz',
    rowFlip: true,
  });
});
