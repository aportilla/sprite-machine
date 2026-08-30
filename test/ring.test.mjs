// Node-runnable tests for the 3D Sprite Atlas's geometry (lib/ring.js — pure,
// no THREE/DOM): the yaw ring, the lattice envelope, the square frame, the
// camera pose, and the engine anchor. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ringYaws,
  ringEnvelope,
  ringFrame,
  ringSheet,
  ringCameraDir,
  ringCameraUp,
  ringCenter,
  ringAnchor,
} from '../src/lib/ring.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const nearVec = (a, b, eps = 1e-9) =>
  a.length === b.length && a.every((v, i) => near(v, b[i], eps));
const len = (v) => Math.hypot(...v);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

// The Car at its shipped 40px tile — the drive's oracle dims.
const CAR = { nx: 40, ny: 40, nz: 40 };

test('ringYaws: offset + i·(360/n), unwrapped', () => {
  assert.deepEqual(ringYaws(4, 0), [0, 90, 180, 270]);
  assert.deepEqual(ringYaws(4, 45), [45, 135, 225, 315]);
  assert.deepEqual(ringYaws(1, 30), [30]);
  // Non-integer steps come out exact to the step, not rounded.
  const three = ringYaws(3, 0);
  assert.equal(three.length, 3);
  assert.ok(near(three[1], 120) && near(three[2], 240));
  const seven = ringYaws(7, 10);
  assert.equal(seven.length, 7);
  for (let i = 1; i < 7; i++) assert.ok(near(seven[i] - seven[i - 1], 360 / 7));
  // A yaw past 360 is left unwrapped — the renderer's trig doesn't care, and
  // the export's metadata lists exactly what was rendered.
  assert.deepEqual(ringYaws(2, 350), [350, 530]);
});

test('ringEnvelope: the footprint circle swept up the height', () => {
  const r = Math.hypot(CAR.nx, CAR.nz) / 2;
  // e = 0: the side elevation — the circle's width, the box's own height.
  let env = ringEnvelope(CAR, 0);
  assert.ok(near(env.width, 2 * r) && near(env.height, CAR.ny));
  // e = 90: the plan — the circle both ways.
  env = ringEnvelope(CAR, 90);
  assert.ok(near(env.width, 2 * r) && near(env.height, 2 * r));
  // The worked numbers: dims 40³ at 45° ≈ 56.57 × 68.28.
  env = ringEnvelope(CAR, 45);
  assert.ok(near(env.width, 56.5685, 1e-3), `width ${env.width}`);
  assert.ok(near(env.height, 68.2843, 1e-3), `height ${env.height}`);
  // Between the endpoints the height is a sinusoid (ny·cos e + 2r·sin e): it
  // peaks somewhere in the middle — a box is tallest on screen when its
  // diagonal stands up — never past the bounding SPHERE's diameter, and
  // never under the smaller endpoint. Tall and flat boxes alike.
  for (const d of [{ nx: 10, ny: 100, nz: 10 }, { nx: 100, ny: 4, nz: 100 }, CAR]) {
    const two = Math.hypot(d.nx, d.nz);
    const sphere = Math.hypot(two, d.ny);
    for (let e = 0; e <= 90; e += 5) {
      const h = ringEnvelope(d, e).height;
      assert.ok(h <= sphere + 1e-9, `over the sphere at ${e}`);
      assert.ok(h >= Math.min(two, d.ny) - 1e-9, `under the endpoints at ${e}`);
    }
  }
});

test('ringFrame: a square that always holds the envelope, scale px per voxel', () => {
  for (const [e, scale] of [
    [0, 1],
    [30, 1],
    [45, 1],
    [45, 2],
    [60, 3],
    [90, 8],
  ]) {
    const { px, half } = ringFrame(CAR, e, scale);
    const env = ringEnvelope(CAR, e);
    assert.equal(px, Math.ceil(Math.max(env.width, env.height) * scale));
    assert.ok(near(2 * half * scale, px), 'half puts exactly scale px on a voxel');
    assert.ok(
      env.width / 2 <= half + 1e-9 && env.height / 2 <= half + 1e-9,
      'the box fits'
    );
  }
  // The worked numbers: 69 at scale 1, 137 at scale 2.
  assert.equal(ringFrame(CAR, 45, 1).px, 69);
  assert.equal(ringFrame(CAR, 45, 2).px, 137);
  // The frame is the same for every yaw and offset: the API takes neither
  // (a guard against a future "tight per-yaw" regression).
  assert.equal(ringFrame.length, 3);
});

test('ringSheet: n frames in one row', () => {
  assert.deepEqual(ringSheet(4, 69), { width: 276, height: 69 });
  assert.deepEqual(ringSheet(1, 57), { width: 57, height: 57 });
});

test('ringCameraDir / ringCameraUp: unit, perpendicular, the stated poses', () => {
  assert.ok(nearVec(ringCameraDir(0, 0), [0, 0, 1]), 'yaw 0 → +z (the FRONT faces it)');
  assert.ok(nearVec(ringCameraDir(90, 0), [1, 0, 0]), 'yaw 90 → +x (the RIGHT)');
  assert.ok(nearVec(ringCameraDir(180, 0), [0, 0, -1]));
  assert.ok(nearVec(ringCameraDir(270, 0), [-1, 0, 0]));
  for (const yaw of [0, 33, 90, 200]) {
    assert.ok(nearVec(ringCameraDir(yaw, 90), [0, 1, 0]), 'straight down at e = 90');
    assert.ok(nearVec(ringCameraUp(yaw, 0), [0, 1, 0]), 'world up at e = 0');
  }
  for (const yaw of [0, 33, 90, 137, 200, 315]) {
    for (const e of [0, 15, 45, 75, 90]) {
      const d = ringCameraDir(yaw, e);
      const u = ringCameraUp(yaw, e);
      assert.ok(near(len(d), 1), `dir unit at ${yaw}/${e}`);
      assert.ok(near(len(u), 1), `up unit at ${yaw}/${e}`);
      assert.ok(near(dot(d, u), 0), `dir ⟂ up at ${yaw}/${e}`);
      // Up never points below the horizon: the frame's top is the far side.
      assert.ok(u[1] >= -1e-9, `up has no downward component at ${yaw}/${e}`);
    }
  }
});

test('ringCenter: the lattice center — X/Z centered, Y from 0', () => {
  assert.deepEqual(ringCenter(CAR), [0, 20, 0]);
  assert.deepEqual(ringCenter({ nx: 12, ny: 30, nz: 10 }), [0, 15, 0]);
});

test('ringAnchor: the floor center, yaw-independent by arity', () => {
  const F = ringFrame(CAR, 0, 1).px;
  // e = 0: the feet sit ny/2 straight below the center.
  assert.deepEqual(ringAnchor(CAR, 0, 1, F), { x: F / 2, y: F / 2 + CAR.ny / 2 });
  // e = 90: looking straight down, the floor center IS the frame center.
  const F90 = ringFrame(CAR, 90, 1).px;
  const a90 = ringAnchor(CAR, 90, 1, F90);
  assert.ok(near(a90.x, F90 / 2) && near(a90.y, F90 / 2, 1e-9));
  // The worked number: 45°, scale 1 → 34.5 + 14.14.
  const a45 = ringAnchor(CAR, 45, 1, 69);
  assert.ok(near(a45.x, 34.5) && near(a45.y, 34.5 + 20 * Math.SQRT1_2, 1e-9));
  // Scale multiplies the drop.
  const a2 = ringAnchor(CAR, 45, 2, 137);
  assert.ok(near(a2.y - 137 / 2, 2 * (a45.y - 34.5)));
  assert.equal(ringAnchor.length, 4, 'no yaw in the signature');
});
