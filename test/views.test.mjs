// Node-runnable test for the view definitions (pure, no THREE/DOM): the
// well-known orientations in VIEW_IMAGE_AXES, the per-view image-axis table
// atlas.js's resize consumes. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VIEW_IMAGE_AXES } from '../src/lib/views.js';

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
