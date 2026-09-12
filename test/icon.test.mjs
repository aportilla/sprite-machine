// Node-runnable tests for the document icon's geometry (lib/icon.js — pure,
// no THREE/DOM): the orthographic fit that frames a model in its 32×32 icon.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { orthoFit } from '../src/lib/icon.js';
import { ringCameraDir, ringCameraUp } from '../src/lib/ring.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The corners of an axis-aligned box, as a flat xyz cloud. */
function boxCloud(x0, y0, z0, x1, y1, z1) {
  const out = [];
  for (const x of [x0, x1])
    for (const y of [y0, y1]) for (const z of [z0, z1]) out.push(x, y, z);
  return out;
}

/** The pose's screen basis, as lookAt builds it. */
const basis = (dir, up) => ({ right: cross(up, dir), sup: cross(dir, cross(up, dir)) });

test('orthoFit: the screen basis is lookAt’s, and the frame is the projection’s box', () => {
  // Looking down +z with +y up: the screen plane is world x/y, depth is z.
  const fit = orthoFit(boxCloud(-2, -1, -5, 2, 1, 5), [0, 0, 1], [0, 1, 0]);
  assert.ok(fit);
  assert.ok(near(fit.half, 2), `half ${fit.half}`); // the x span, the larger
  assert.ok(near(fit.depth, 10), `depth ${fit.depth}`);
  assert.ok(
    fit.center.every((v) => near(v, 0)),
    fit.center.join(',')
  );

  // Turned on its side, the other span wins — the frame stays SQUARE and the
  // smaller axis is what takes the margin.
  const tall = orthoFit(boxCloud(-1, -3, -5, 1, 3, 5), [0, 0, 1], [0, 1, 0]);
  assert.ok(near(tall.half, 3), `half ${tall.half}`);
});

test('orthoFit: the center is the projected box’s, not the cloud’s centroid', () => {
  // Ten points bunched at one end and one lone point at the other: the frame
  // centers on the EXTREMES, so nothing hangs outside it.
  const cloud = [];
  for (let i = 0; i < 10; i++) cloud.push(0, 0, 0);
  cloud.push(4, 0, 0);
  const fit = orthoFit(cloud, [0, 0, 1], [0, 1, 0]);
  assert.ok(near(fit.center[0], 2), `center.x ${fit.center[0]}`);
  assert.ok(near(fit.half, 2), `half ${fit.half}`);

  // Moving the whole cloud moves the frame with it, the same size.
  const moved = cloud.map((v, i) => v + [7, -3, 11][i % 3]);
  const after = orthoFit(moved, [0, 0, 1], [0, 1, 0]);
  assert.ok(near(after.half, fit.half));
  assert.ok(near(after.center[0], fit.center[0] + 7));
  assert.ok(near(after.center[1], fit.center[1] - 3));
  assert.ok(near(after.center[2], fit.center[2] + 11));
});

test('orthoFit: the frame holds every point, and is tight on its larger axis', () => {
  // A lattice-ish cloud: a 5×3×7 box of points, off-center in every axis.
  const cloud = [];
  for (let x = 0; x < 5; x++)
    for (let y = 0; y < 3; y++)
      for (let z = 0; z < 7; z++) cloud.push(x - 1, y + 2, z - 4);
  // Several poses, the icon's 45°/45° among them.
  for (const [yaw, elev] of [
    [0, 0],
    [45, 45],
    [30, 10],
    [200, 75],
    [45, 90],
  ]) {
    const dir = ringCameraDir(yaw, elev);
    const up = ringCameraUp(yaw, elev);
    const fit = orthoFit(cloud, dir, up);
    const { right, sup } = basis(dir, up);
    const c = [dot(fit.center, right), dot(fit.center, sup)];
    let widest = 0;
    for (let i = 0; i < cloud.length; i += 3) {
      const p = [cloud[i], cloud[i + 1], cloud[i + 2]];
      const u = Math.abs(dot(p, right) - c[0]);
      const v = Math.abs(dot(p, sup) - c[1]);
      assert.ok(
        u <= fit.half + 1e-9 && v <= fit.half + 1e-9,
        `${yaw}/${elev}: (${u}, ${v}) outside ${fit.half}`
      );
      widest = Math.max(widest, u, v);
    }
    // Tight: something touches the frame's edge — the model fills its icon.
    assert.ok(
      near(widest, fit.half, 1e-9),
      `${yaw}/${elev}: widest ${widest} of ${fit.half}`
    );
  }
});

test('orthoFit: nothing to frame, and nothing to divide by', () => {
  assert.equal(orthoFit([], [0, 0, 1], [0, 1, 0]), null);
  assert.equal(orthoFit([1, 2], [0, 0, 1], [0, 1, 0]), null);
  assert.equal(orthoFit(null, [0, 0, 1], [0, 1, 0]), null);
  // One point has no extent: the half is floored off zero, so the camera it
  // poses still has a frustum.
  const dot0 = orthoFit([3, 4, 5], [0, 0, 1], [0, 1, 0]);
  assert.ok(dot0.half > 0);
  assert.ok(near(dot0.depth, 0));
  assert.deepEqual(dot0.center, [3, 4, 5]);
});
