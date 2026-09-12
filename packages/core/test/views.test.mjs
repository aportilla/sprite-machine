import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VIEW_IMAGE_AXES } from '../src/views.js';

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
