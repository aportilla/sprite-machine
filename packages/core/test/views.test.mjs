import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  VIEWS,
  VIEW_NAMES,
  VIEW_TO_FACE,
  VIEW_IMAGE_AXES,
  FACE_NORMAL,
} from '../src/views.js';

// A view seen from outside its face has image right × image up along the
// face's outward normal. A mirrored view has it along the inward one.
test('every view is its face seen from outside, not a mirror image', () => {
  const d = { nx: 3, ny: 3, nz: 3 };
  const cross = (a, b) =>
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]].map(
      (c) => c + 0
    );
  for (const name of VIEW_NAMES) {
    const o = VIEWS[name].project(1, 1, 1, d);
    const steps = [0, 1, 2].map((axis) => {
      const p = [1, 1, 1];
      p[axis] += 1;
      const q = VIEWS[name].project(p[0], p[1], p[2], d);
      return [q.u - o.u, q.v - o.v];
    });
    const right = steps.map(([du]) => du);
    const up = steps.map(([, dv]) => -dv);
    assert.deepEqual(cross(right, up), FACE_NORMAL[VIEW_TO_FACE[name]], name);
  }
});

test('VIEW_IMAGE_AXES: front/top orientations', () => {
  assert.deepEqual(VIEW_IMAGE_AXES.front, {
    colAxis: 'nx',
    colFlip: false,
    rowAxis: 'ny',
    rowFlip: true,
  });
  assert.deepEqual(VIEW_IMAGE_AXES.top, {
    colAxis: 'nx',
    colFlip: true,
    rowAxis: 'nz',
    rowFlip: true,
  });
});
