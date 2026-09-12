import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cascadeFrom,
  cascadeSlot,
  CASCADE_STEP,
  CASCADE_SLOTS,
  pinOf,
  pinTo,
  isPin,
  TOP_RESERVE,
  windowFrame,
  nearBox,
  NEAR,
} from '../src/shell/layout.js';

// No reserve and 100px bands. On R the middle is x ∈ [100, 900), y ∈ [100, 700).
const F = { reserve: 0, bands: { left: 100, top: 100, right: 100, bottom: 100 } };
const R = { width: 1000, height: 800 };
const box = (left, top, width, height) => ({ left, top, width, height });
const roundTrip = (b, from, to, frame = F, policy) =>
  pinTo(pinOf(b, from, frame), to, frame, policy);

test('cascade: the first open takes the doc box, each further one steps down-right, and a freed slot is reused', () => {
  const base = { left: 100, top: 100 };
  assert.deepEqual(cascadeFrom(base, []), { left: 100, top: 100, slot: 0 });
  const one = [{ left: 100, top: 100 }];
  assert.deepEqual(cascadeFrom(base, one), {
    left: 100 + CASCADE_STEP,
    top: 100 + CASCADE_STEP,
    slot: 1,
  });
  const two = [...one, { left: 100 + CASCADE_STEP, top: 100 + CASCADE_STEP }];
  assert.deepEqual(cascadeFrom(base, two), {
    left: 100 + 2 * CASCADE_STEP,
    top: 100 + 2 * CASCADE_STEP,
    slot: 2,
  });
  // Slot 0's window moved away and slot 1 is held, so the next open takes
  // slot 0.
  assert.deepEqual(
    cascadeFrom(base, [
      { left: 400, top: 300 },
      { left: 100 + CASCADE_STEP, top: 100 + CASCADE_STEP },
    ]),
    { left: 100, top: 100, slot: 0 }
  );
  // A window a pixel or two off its slot still holds it.
  assert.deepEqual(cascadeFrom(base, [{ left: 102, top: 99 }]), {
    left: 100 + CASCADE_STEP,
    top: 100 + CASCADE_STEP,
    slot: 1,
  });
  // A window half a step away does not.
  assert.deepEqual(cascadeFrom(base, [{ left: 100 + CASCADE_STEP / 2, top: 100 }]), {
    left: 100,
    top: 100,
    slot: 0,
  });
});

test('cascade: every slot held wraps instead of walking off the raster; a slot re-expresses on any doc box', () => {
  const base = { left: 100, top: 100 };
  const all = Array.from({ length: CASCADE_SLOTS }, (_, i) => ({
    left: 100 + CASCADE_STEP * i,
    top: 100 + CASCADE_STEP * i,
  }));
  assert.deepEqual(cascadeFrom(base, all), { left: 100, top: 100, slot: 0 });
  assert.deepEqual(cascadeFrom(base, [...all, { left: 100, top: 100 }]), {
    left: 100 + CASCADE_STEP,
    top: 100 + CASCADE_STEP,
    slot: 1,
  });
  // cascadeSlot gives a slot on any base box and wraps past CASCADE_SLOTS.
  const b = { left: 58, top: 64 };
  assert.deepEqual(
    cascadeSlot(base, 2),
    cascadeFrom(base, [cascadeSlot(base, 0), cascadeSlot(base, 1)])
  );
  assert.deepEqual(cascadeSlot(b, 2), {
    left: 58 + 2 * CASCADE_STEP,
    top: 64 + 2 * CASCADE_STEP,
    slot: 2,
  });
  assert.deepEqual(cascadeSlot(b, CASCADE_SLOTS + 1), cascadeSlot(b, 1));
});

test('near: a box reads at its target while every edge is within the tolerance — the far edges too', () => {
  const t = box(300, 40, 520, 700);
  assert.ok(nearBox(t, t));
  // A few px off on any edge is still near.
  assert.ok(nearBox(box(302, 38, 520, 700), t));
  assert.ok(nearBox(box(300, 40, 520 + NEAR, 700 - NEAR), t));
  // One edge past NEAR is not.
  assert.ok(!nearBox(box(300 + NEAR + 1, 40, 520, 700), t));
  assert.ok(!nearBox(box(300, 40, 520, 700 - NEAR - 1), t));
});

test('pin: a strut keeps its offset from its edge, a spring its fraction of the middle', () => {
  // Near struts (inside the top-left band): the box does not move.
  assert.deepEqual(roundTrip(box(30, 40, 50, 30), R, { width: 600, height: 500 }), {
    left: 30,
    top: 40,
    width: 50,
    height: 30,
  });
  // Far struts (inside the bottom-right band): the box keeps its right and
  // bottom offsets, with or without a fixed size.
  for (const to of [
    { width: 600, height: 500 },
    { width: 300, height: 250 },
  ]) {
    const want = { left: to.width - 60, top: to.height - 60, width: 40, height: 40 };
    assert.deepEqual(roundTrip(box(940, 740, 40, 40), R, to), want);
    assert.deepEqual(
      roundTrip(box(940, 740, 40, 40), R, to, F, { size: { width: 40, height: 40 } }),
      want
    );
  }
  // Near and far struts (band to band): both margins hold and the box
  // stretches.
  assert.deepEqual(roundTrip(box(50, 50, 900, 700), R, { width: 1400, height: 1200 }), {
    left: 50,
    top: 50,
    width: 1300,
    height: 1100,
  });
  // Springs (inside the middle, 25%–75% on both axes): position and size
  // both scale.
  assert.deepEqual(roundTrip(box(300, 250, 400, 300), R, { width: 1400, height: 1200 }), {
    left: 400,
    top: 350,
    width: 600,
    height: 500,
  });
  assert.deepEqual(roundTrip(box(300, 250, 400, 300), R, { width: 600, height: 500 }), {
    left: 200,
    top: 175,
    width: 200,
    height: 150,
  });
  // The same raster gives the same box.
  assert.deepEqual(roundTrip(box(300, 250, 400, 300), R, R), box(300, 250, 400, 300));
  // The reserve is the frame's y = 0. A box at TOP_RESERVE is a near strut at
  // offset 0 at any height.
  const under = box(14, TOP_RESERVE, 30, 187);
  const home = { width: 1000, height: 830 };
  for (const h of [400, 2000]) {
    assert.equal(
      roundTrip(under, home, { width: 1000, height: h }, windowFrame()).top,
      TOP_RESERVE
    );
  }
});

test('pin: continuous across every seam — no pop where a strut meets the spring', () => {
  // Edges within 2px of each seam map monotonically, with no jump larger than
  // the middle's scale (at most 2 here), shrinking or growing.
  for (const to of [
    { width: 600, height: 800 },
    { width: 1400, height: 800 },
  ]) {
    for (const seam of [100, 900]) {
      let prev = null;
      for (let v = seam - 2; v <= seam + 2; v++) {
        const { left } = roundTrip(box(v, 300, 0, 10), R, to);
        if (prev !== null) {
          assert.ok(
            left >= prev && left - prev <= 2,
            `seam ${seam}, v ${v}: ${prev} → ${left}`
          );
        }
        prev = left;
      }
    }
  }
});

test('pin: an edge outside the raster is a strut with a negative offset — it hangs the same', () => {
  // Off the left: the offset stays −30.
  assert.equal(
    roundTrip(box(-30, 50, 100, 40), R, { width: 600, height: 500 }).left,
    -30
  );
  // Off the right by 40: still 40 past the new right edge at the same width.
  assert.deepEqual(roundTrip(box(960, 50, 80, 40), R, { width: 600, height: 500 }), {
    left: 560,
    top: 50,
    width: 80,
    height: 40,
  });
});

test('pin: a fixed-size box resolves through the anchor rule', () => {
  const size = { width: 200, height: 100 };
  // x: the left edge is a near strut and holds at 50.
  // y: two springs, so the mapped center holds. 250–350 on 800 is 25%–41.7%
  // of the middle, which on 1400 maps to 400–600, center 500.
  assert.deepEqual(
    roundTrip(box(50, 250, 200, 100), R, { width: 1000, height: 1400 }, F, { size }),
    {
      left: 50,
      top: 450,
      width: 200,
      height: 100,
    }
  );
  // A lone far strut holds: the right edge keeps its 50px offset.
  assert.deepEqual(
    roundTrip(box(700, 50, 250, 40), R, { width: 600, height: 800 }, F, {
      size: { width: 250, height: 40 },
    }),
    { left: 300, top: 50, width: 250, height: 40 }
  );
  // Opposite struts: the near edge holds and the box keeps its size past the
  // far edge.
  assert.deepEqual(
    roundTrip(box(50, 50, 900, 40), R, { width: 600, height: 800 }, F, {
      size: { width: 900, height: 40 },
    }),
    { left: 50, top: 50, width: 900, height: 40 }
  );
  // The policy size wins over the pinned size. The strut edge holds.
  assert.deepEqual(
    roundTrip(box(30, 30, 50, 100), R, { width: 600, height: 500 }, F, {
      size: { width: 50, height: 150 },
    }),
    { left: 30, top: 30, width: 50, height: 150 }
  );
});

test('pin: a resizable box floors its size and anchors the same way', () => {
  // The spring box maps to 100×100 on a 400×400 raster, under the 164×160
  // floor. The floored box centers on the mapped center (200, 200).
  const min = { width: 164, height: 160 };
  assert.deepEqual(
    roundTrip(box(300, 250, 400, 300), R, { width: 400, height: 400 }, F, { min }),
    {
      left: 118,
      top: 120,
      width: 164,
      height: 160,
    }
  );
});

test('pin: a degenerate span collapses the middle to a seam, and grows back exactly', () => {
  // 150×120 is smaller than the two bands. Springs collapse to the near
  // band's edge (100), struts keep their offsets, and the pins map back to R
  // exactly.
  const tiny = { width: 150, height: 120 };
  const spring = box(300, 250, 400, 300);
  const pin = pinOf(spring, R, F);
  assert.deepEqual(pinTo(pin, tiny, F, { min: { width: 80, height: 54 } }), {
    left: 60,
    top: 73,
    width: 80,
    height: 54,
  });
  assert.deepEqual(pinTo(pin, R, F), spring);
  const corner = box(940, 740, 40, 40);
  const cpin = pinOf(corner, R, F);
  assert.deepEqual(pinTo(cpin, tiny, F), { left: 90, top: 60, width: 40, height: 40 });
  assert.deepEqual(pinTo(cpin, R, F), corner);
});

test('pin: what pinOf reads is a pin — stored and parsed back too — and a stale or garbled record is not', () => {
  const pin = pinOf(box(300, 250, 400, 300), R, F);
  assert.ok(isPin(pin));
  assert.ok(isPin(JSON.parse(JSON.stringify(pin))));
  for (const bad of [
    null,
    { left: 1, top: 2 },
    { x: [], y: [] },
    { x: pin.x, y: [pin.y[0], { kind: 'sideways', v: 1 }] },
    { x: pin.x, y: [pin.y[0], { kind: 'near', v: NaN }] },
  ]) {
    assert.equal(isPin(bad), false, JSON.stringify(bad));
  }
});
