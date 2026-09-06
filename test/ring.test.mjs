// Node-runnable tests for the 3D Sprite Atlas's geometry (lib/ring.js — pure,
// no THREE/DOM): the yaw ring, the lattice envelope, the square frame, the
// camera pose, and the engine anchor. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ringYaws,
  ringEnvelope,
  ringFrame,
  ringCameraDir,
  ringCameraUp,
  ringAnchor,
} from '../src/lib/ring.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const nearVec = (a, b, eps = 1e-9) =>
  a.length === b.length && a.every((v, i) => near(v, b[i], eps));
const len = (v) => Math.hypot(...v);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

// The Car at its shipped 40px tile.
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

test("ringFrame: the tile IS the frame; the envelope's larger extent fills it, the scale derived", () => {
  for (const [e, size] of [
    [0, 64],
    [30, 2],
    [45, 64],
    [45, 128],
    [60, 200],
    [90, 255],
  ]) {
    const { px, half, scale } = ringFrame(CAR, e, size);
    const env = ringEnvelope(CAR, e);
    const span = Math.max(env.width, env.height);
    assert.equal(px, size, 'the frame is the tile');
    assert.ok(
      near(2 * half, span),
      "half is the envelope's larger half — it fills the tile"
    );
    assert.ok(near(scale * span, px), 'scale px per voxel spans the tile exactly');
    assert.ok(
      env.width / 2 <= half + 1e-9 && env.height / 2 <= half + 1e-9,
      'the box fits'
    );
  }
  // The worked numbers: the Car's envelope is 68.28 tall at 45°, so a 64
  // tile holds it at 0.937 px per voxel, and a 137 tile at just over 2 (the
  // old "scale 2" frame).
  assert.ok(near(ringFrame(CAR, 45, 64).scale, 64 / 68.2843, 1e-4));
  assert.ok(ringFrame(CAR, 45, 137).scale > 2);
  // Never a zero frame (the slice clamps first; this is the last guard).
  assert.equal(ringFrame(CAR, 45, 0).px, 1);
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

test('ringAnchor: the floor center', () => {
  const S = 64;
  // e = 0: the feet sit ny/2 voxels straight below the center, at the
  // frame's derived scale (the envelope's larger extent spans the tile).
  const { scale: s0 } = ringFrame(CAR, 0, S);
  const a0 = ringAnchor(CAR, 0, S);
  assert.ok(near(a0.x, S / 2) && near(a0.y, S / 2 + (CAR.ny / 2) * s0));
  // e = 90: looking straight down, the floor center IS the frame center.
  const a90 = ringAnchor(CAR, 90, S);
  assert.ok(near(a90.x, S / 2) && near(a90.y, S / 2, 1e-9));
  // The worked number: 45° in a 69 tile (the old 1-px-per-voxel frame, now
  // 69 / 68.28 px per voxel) → 34.5 + 14.14 × that.
  const a45 = ringAnchor(CAR, 45, 69);
  const { scale: s45 } = ringFrame(CAR, 45, 69);
  assert.ok(near(a45.x, 34.5) && near(a45.y, 34.5 + 20 * Math.SQRT1_2 * s45, 1e-9));
  // Doubling the tile doubles the drop.
  const a2 = ringAnchor(CAR, 45, 138);
  assert.ok(near(a2.y - 69, 2 * (a45.y - 34.5)));
});
