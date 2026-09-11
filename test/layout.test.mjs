// Node-runnable tests for the desktop's geometry (shell/layout.js): the
// RESIZE RULE — the nine-slice pin — the cascade's slot rules and the
// nearness reading. The applications' placements are their own
// (sprite-editor-layout.test.mjs, finder-layout.test.mjs). Never where a
// window goes. Run: node --test
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

// A plain frame for the pin arithmetic: no reserve, uniform 100px bands —
// on a 1000×800 raster the middle is x ∈ [100, 900), y ∈ [100, 700).
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
  // Slot 0's window was dragged elsewhere, slot 1 is held: the next open
  // lands back on slot 0 (a closed window simply isn't in the list).
  assert.deepEqual(
    cascadeFrom(base, [
      { left: 400, top: 300 },
      { left: 100 + CASCADE_STEP, top: 100 + CASCADE_STEP },
    ]),
    { left: 100, top: 100, slot: 0 }
  );
  // A landing a pixel or two off its slot (a lattice snap, an edge clamp)
  // still holds it…
  assert.deepEqual(cascadeFrom(base, [{ left: 102, top: 99 }]), {
    left: 100 + CASCADE_STEP,
    top: 100 + CASCADE_STEP,
    slot: 1,
  });
  // …but a window half a step away does not.
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
  // A window that opened on slot 2 of one raster's doc box lands on slot 2
  // of another's (the resize rule for an untouched window), wrapping past
  // the slot count the way an open would.
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
  // A lattice snap or a nudge off, on any edge, still reads near…
  assert.ok(nearBox(box(302, 38, 520, 700), t));
  assert.ok(nearBox(box(300, 40, 520 + NEAR, 700 - NEAR), t));
  // …one edge past it does not: a move, or a grow with the top-left held.
  assert.ok(!nearBox(box(300 + NEAR + 1, 40, 520, 700), t));
  assert.ok(!nearBox(box(300, 40, 520, 700 - NEAR - 1), t));
});

test('pin: a strut keeps its offset from its edge, a spring its fraction of the middle', () => {
  // NEAR struts (wholly inside the top-left band): the box does not move.
  assert.deepEqual(roundTrip(box(30, 40, 50, 30), R, { width: 600, height: 500 }), {
    left: 30,
    top: 40,
    width: 50,
    height: 30,
  });
  // FAR struts (wholly inside the bottom-right band): it keeps its offsets
  // from the right and bottom edges — a rigid corner widget, the same under
  // a fixed-size policy, on any raster.
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
  // NEAR + FAR (spanning band to band): both margins hold, the box
  // stretches with the raster.
  assert.deepEqual(roundTrip(box(50, 50, 900, 700), R, { width: 1400, height: 1200 }), {
    left: 50,
    top: 50,
    width: 1300,
    height: 1100,
  });
  // SPRINGS (wholly inside the middle): 25%…75% of the middle on both axes,
  // so position AND size scale with it, up or down (a resizable box).
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
  // Same raster → the same box, exactly.
  assert.deepEqual(roundTrip(box(300, 250, 400, 300), R, R), box(300, 250, 400, 300));
  // The frame's reserve is its y = 0 line: a box riding the options strip's
  // bottom edge is a near strut at offset 0 on any raster height.
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
  // Edges a pixel either side of both seams map to a monotone run with no
  // jump bigger than the spring's own step (the middle's ratio, ≤ 2 here),
  // on a shrink and on a grow alike.
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
  // Off the right by 40: still 40 past the new right edge, same width.
  assert.deepEqual(roundTrip(box(960, 50, 80, 40), R, { width: 600, height: 500 }), {
    left: 560,
    top: 50,
    width: 80,
    height: 40,
  });
});

test('pin: a fixed-size box resolves through the anchor rule', () => {
  const size = { width: 200, height: 100 };
  // x: a lone NEAR strut holds (left 50; the right edge is a spring).
  // y: two springs — the mapped CENTER holds: 250…350 on an 800 raster is
  // the middle's 25%…41.7%, which on 1400 maps to 400…600, center 500.
  assert.deepEqual(
    roundTrip(box(50, 250, 200, 100), R, { width: 1000, height: 1400 }, F, { size }),
    {
      left: 50,
      top: 450,
      width: 200,
      height: 100,
    }
  );
  // A lone FAR strut holds: the right edge keeps its 50px offset.
  assert.deepEqual(
    roundTrip(box(700, 50, 250, 40), R, { width: 600, height: 800 }, F, {
      size: { width: 250, height: 40 },
    }),
    { left: 300, top: 50, width: 250, height: 40 }
  );
  // Opposite struts (the box spans the middle) — the NEAR edge holds, and
  // the box hangs off the far edge rather than shrinking (no grow box).
  assert.deepEqual(
    roundTrip(box(50, 50, 900, 40), R, { width: 600, height: 800 }, F, {
      size: { width: 900, height: 40 },
    }),
    { left: 50, top: 50, width: 900, height: 40 }
  );
  // The LIVE size wins over the one the pin was read with (the Sprite
  // View's height re-derives on a document switch — not a move): the strut
  // edge holds, the new size hangs off it.
  assert.deepEqual(
    roundTrip(box(30, 30, 50, 100), R, { width: 600, height: 500 }, F, {
      size: { width: 50, height: 150 },
    }),
    { left: 30, top: 30, width: 50, height: 150 }
  );
});

test('pin: a resizable box floors its size and anchors the same way', () => {
  // The spring box (25%…75% of the middle) on a 400×400 raster would map
  // to 100×100 — under a 164×160 floor, so the floor holds around the
  // mapped center (200, 200).
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
  // 150×120 is narrower and shorter than the two bands: every spring lands
  // at the near band's edge (100), struts keep their offsets (overlapping
  // is fine), everything finite — and the same pins map home exactly.
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
