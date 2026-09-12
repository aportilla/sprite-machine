// Node-runnable tests for the document icon's rules (lib/icon.js — pure,
// no THREE/DOM): the orthographic fit that frames a model in its 32×32 icon,
// the supersample's box filter and the outline's ink.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ICON_SIZE,
  ICON_OUTLINE,
  orthoFit,
  framedHalf,
  downsample,
  inkOutline,
} from '../src/lib/icon.js';
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
  // Several poses, the icon's 35°/45° among them.
  for (const [yaw, elev] of [
    [0, 0],
    [35, 45],
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

test('framedHalf: the model spans the icon less the outline on each side', () => {
  // A model of half-extent h in a frustum of framedHalf(h) covers this many
  // of the icon's pixels — the outline's margin left on both sides.
  for (const h of [1, 7.5, 32, 1e-6])
    assert.ok(
      near((h / framedHalf(h)) * ICON_SIZE, ICON_SIZE - 2 * ICON_OUTLINE),
      `h ${h}`
    );
});

/** A w×h RGBA raster from a list of [x, y, r, g, b, a] pixels. */
function raster(w, h, pixels) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (const [x, y, r, g, b, a] of pixels) out.set([r, g, b, a], (y * w + x) * 4);
  return out;
}
const px = (buf, w, x, y) =>
  Array.from(buf.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));

test('downsample: premultiplied — an edge takes the model’s color, not the clear’s', () => {
  // A 4×2 raster folded 2:1 into 2×1. The left block: two red samples over
  // two clear ones → red at half coverage, NOT half-black red. The right
  // block: red and blue, all opaque → their mean, opaque.
  const src = raster(4, 2, [
    [0, 0, 255, 0, 0, 255],
    [1, 1, 255, 0, 0, 255],
    [2, 0, 255, 0, 0, 255],
    [3, 0, 0, 0, 255, 255],
    [2, 1, 255, 0, 0, 255],
    [3, 1, 0, 0, 255, 255],
  ]);
  const out = downsample(src, 4, 2, 2);
  assert.equal(out.length, 2 * 1 * 4);
  assert.deepEqual(px(out, 2, 0, 0), [255, 0, 0, 128]);
  assert.deepEqual(px(out, 2, 1, 0), [128, 0, 128, 255]);

  // Coverage weights the color: three red opaque + one blue at quarter alpha
  // → mostly red, the alpha the block's mean.
  const weighted = downsample(
    raster(2, 2, [
      [0, 0, 255, 0, 0, 255],
      [1, 0, 255, 0, 0, 255],
      [0, 1, 255, 0, 0, 255],
      [1, 1, 0, 0, 255, 64],
    ]),
    2,
    2,
    2
  );
  const [r, , b, a] = px(weighted, 1, 0, 0);
  assert.ok(r > 220 && b < 40, `${r},${b}`);
  assert.equal(a, Math.round((3 * 255 + 64) / 4));

  // A clear block stays clear, and a factor of 1 is the identity.
  assert.deepEqual(px(downsample(raster(2, 2, []), 2, 2, 2), 1, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(Array.from(downsample(src, 4, 2, 1)), Array.from(src));
});

test('inkOutline: covered goes opaque, its four neighbors go black, the rest clear', () => {
  // One pixel covered by half, in the middle of a 3×3 raster: it keeps its
  // color and goes opaque; the four beside it are the ring; the diagonals
  // are not — the thin line, not the block.
  const one = inkOutline(raster(3, 3, [[1, 1, 200, 100, 50, 128]]), 3, 3);
  assert.deepEqual(px(one, 3, 1, 1), [200, 100, 50, 255]);
  for (const [x, y] of [
    [0, 1],
    [2, 1],
    [1, 0],
    [1, 2],
  ])
    assert.deepEqual(px(one, 3, x, y), [0, 0, 0, 255], `${x},${y}`);
  for (const [x, y] of [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ])
    assert.deepEqual(px(one, 3, x, y), [0, 0, 0, 0], `${x},${y}`);

  // Under half coverage is a sliver: dropped, and nothing ringed around it.
  const sliver = inkOutline(raster(3, 3, [[1, 1, 200, 100, 50, 127]]), 3, 3);
  assert.ok(sliver.every((v) => v === 0));

  // A pixel on the raster's edge rings inward only — no wrap to the far
  // side, and the output is never a partial pixel.
  const corner = inkOutline(raster(3, 3, [[0, 0, 9, 9, 9, 255]]), 3, 3);
  assert.deepEqual(px(corner, 3, 0, 0), [9, 9, 9, 255]);
  assert.deepEqual(px(corner, 3, 1, 0), [0, 0, 0, 255]);
  assert.deepEqual(px(corner, 3, 0, 1), [0, 0, 0, 255]);
  assert.deepEqual(px(corner, 3, 2, 0), [0, 0, 0, 0]);
  assert.deepEqual(px(corner, 3, 0, 2), [0, 0, 0, 0]);
  for (let i = 3; i < corner.length; i += 4)
    assert.ok(corner[i] === 0 || corner[i] === 255);
});
