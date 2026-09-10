// Node-runnable tests for the desktop's window + icon arithmetic
// (shell/layout.js): the RESIZE RULE — the nine-slice pin in both frames, and
// the placement as its fixed point — the cascade's slot rules, and a tiny
// raster's finiteness. Never where a window goes. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  initialPlacement,
  cascadeFrom,
  cascadeSlot,
  CASCADE_STEP,
  CASCADE_SLOTS,
  iconDefault,
  pinOf,
  pinTo,
  isPin,
  spriteHeightFor,
  SPRITE_WIDTH,
  ringHeightFor,
  RING_MIN_WIDTH,
  TOP_RESERVE,
  MENU_BAR,
  ICON_CELL,
  TOOLS_BOX,
  WINDOW_FRAME,
  ICON_FRAME,
} from '../src/shell/layout.js';

// The Tools palette's box — the placement's one fixed input.
const TOOLS = TOOLS_BOX;
// A typical raster (1000×850 CSS at DSF 1, minus the 10px bezel).
const W = 980;
const H = 830;

// A plain frame for the pin arithmetic: no reserve, uniform 100px bands —
// on a 1000×800 raster the middle is x ∈ [100, 900), y ∈ [100, 700).
const F = { reserve: 0, bands: { left: 100, top: 100, right: 100, bottom: 100 } };
const R = { width: 1000, height: 800 };
const box = (left, top, width, height) => ({ left, top, width, height });
const roundTrip = (b, from, to, frame = F, policy) =>
  pinTo(pinOf(b, from, frame), to, frame, policy);

test('placement: a tiny raster still yields finite, usable boxes; a zero-sized one places and pins finitely', () => {
  const p = initialPlacement(300, 200, TOOLS, { ringShown: true });
  for (const b of [p.sprite, p.stage, p.ring, p.doc]) {
    assert.ok(Number.isFinite(b.left) && Number.isFinite(b.top));
    assert.ok(b.width > 0 && b.height > 0);
    assert.ok(b.left >= 0 && b.top >= TOP_RESERVE);
  }
  // 0×0: the floors keep the ring finite and at the reserve, and its pin —
  // read on a raster with no middle at all — maps finitely.
  const z = initialPlacement(0, 0, TOOLS, { ringShown: true });
  assert.ok(Object.values(z.ring).every(Number.isFinite) && z.ring.top >= TOP_RESERVE);
  const rp = pinTo(
    pinOf(z.ring, { width: 0, height: 0 }, WINDOW_FRAME),
    { width: 600, height: 500 },
    WINDOW_FRAME,
    { size: { height: z.ring.height }, min: { width: RING_MIN_WIDTH } }
  );
  assert.ok(Object.values(rp).every(Number.isFinite));
});

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
      roundTrip(under, home, { width: 1000, height: h }, WINDOW_FRAME).top,
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

test('pin: the placement is a fixed point — a resize lands the windoids where Arrange would', () => {
  // The window frame's top band runs through the stage's top edge (a GAP of
  // slack past it) and its right band covers the rail column (the rail's
  // left edge an inset inside it): the bands hold the rail, so the stage's
  // top edge and the rail's left edges are struts…
  const home = initialPlacement(W, H, TOOLS);
  const { bands } = WINDOW_FRAME;
  assert.ok(
    bands.top > home.stage.top - TOP_RESERVE &&
      bands.top <= home.stage.top - TOP_RESERVE + 8
  );
  assert.ok(bands.right > W - home.stage.left && bands.right <= W - home.stage.left + 14);
  // …and every placed windoid re-pins onto any other raster EXACTLY as
  // initialPlacement puts it there — the test that retires the "untouched
  // window follows the placement" special case. The document window is
  // content: its top-left (the cascade slot) is a fixed point too, while
  // its right and bottom edges spring with the vacancy — inside it, never
  // into the rail or off the bottom.
  const rasters = [
    { width: 980, height: 830 },
    { width: 760, height: 620 },
    { width: 1400, height: 1000 },
    { width: 1001, height: 831 }, // odd: the slack survives a k = 2 snap (below)
  ];
  const spriteSize = { width: SPRITE_WIDTH, height: spriteHeightFor(SPRITE_WIDTH) };
  const stageMin = { width: 164, height: 160 };
  for (const r0 of rasters) {
    const p0 = initialPlacement(r0.width, r0.height, TOOLS);
    for (const r1 of rasters) {
      const p1 = initialPlacement(r1.width, r1.height, TOOLS);
      const tools0 = { ...p0.tools, ...TOOLS };
      assert.deepEqual(
        roundTrip(tools0, r0, r1, WINDOW_FRAME, { size: TOOLS }),
        { ...p1.tools, ...TOOLS },
        `tools ${JSON.stringify([r0, r1])}`
      );
      assert.deepEqual(
        roundTrip(p0.sprite, r0, r1, WINDOW_FRAME, { size: spriteSize }),
        p1.sprite,
        `sprite ${JSON.stringify([r0, r1])}`
      );
      assert.deepEqual(
        roundTrip(p0.stage, r0, r1, WINDOW_FRAME, { min: stageMin }),
        p1.stage,
        `stage ${JSON.stringify([r0, r1])}`
      );
      // The 3D Sprite Atlas strip: bottom-docked at the doc box's left, a
      // MIXED box — its y axis a fixed size (the bottom edge a far strut,
      // the top following), its x axis resizable and floored at the strip
      // (the left edge a near strut; the right edge springs with the
      // middle, like the document window's) — so its left, top and height
      // are a fixed point WITHOUT a frame change, at the default four views
      // and at the widest ring (capped at the vacancy), at two tile sizes,
      // while its width is content: inside the vacancy, never under the
      // strip's floor. (A 255 tile on the 620 raster trips the header's
      // top-band caveat — the near edge wins there, accepted — so the
      // sizes here stay under it.)
      for (const views of [4, 16]) {
        for (const size of [64, 128]) {
          const opts = { ringViews: views, ringSize: size };
          const g0 = initialPlacement(r0.width, r0.height, TOOLS, opts);
          const g1 = initialPlacement(r1.width, r1.height, TOOLS, opts);
          const ring = roundTrip(g0.ring, r0, r1, WINDOW_FRAME, {
            size: { height: ringHeightFor(size) },
            min: { width: RING_MIN_WIDTH },
          });
          const tag = `ring(${views}, ${size}) ${JSON.stringify([r0, r1])}`;
          assert.equal(ring.left, g1.ring.left, `${tag} left`);
          assert.equal(ring.top, g1.ring.top, `${tag} top`);
          assert.equal(ring.height, g1.ring.height, `${tag} height`);
          assert.ok(ring.width >= RING_MIN_WIDTH, `${tag} under the floor`);
          assert.ok(
            ring.left + ring.width <= p1.sprite.left - 14,
            `${tag} runs into the rail`
          );
        }
      }
      const doc = roundTrip(p0.doc, r0, r1, WINDOW_FRAME, {
        min: { width: 80, height: 54 },
      });
      assert.equal(doc.left, p1.doc.left, `doc left ${JSON.stringify([r0, r1])}`);
      assert.equal(doc.top, p1.doc.top, `doc top ${JSON.stringify([r0, r1])}`);
      assert.ok(doc.left + doc.width <= p1.sprite.left - 14, 'doc runs into the rail');
      assert.ok(doc.top + doc.height <= r1.height - 8, 'doc runs off the bottom');
    }
  }
  // The slack: a placed rail edge snapped onto a 2px lattice still reads as
  // a strut on every side (the boundary is no place to park an edge).
  const odd = rasters[3];
  const p = initialPlacement(odd.width, odd.height, TOOLS);
  const snap2 = (v) => Math.round(v / 2) * 2;
  const stage = {
    left: snap2(p.stage.left),
    top: snap2(p.stage.top),
    width: snap2(p.stage.width),
    height: snap2(p.stage.height),
  };
  const pin = pinOf(stage, odd, WINDOW_FRAME);
  assert.deepEqual(
    [pin.x[0].kind, pin.x[1].kind, pin.y[0].kind, pin.y[1].kind],
    ['far', 'far', 'near', 'far']
  );
});

test('icon pin: the frame is the desktop below the MENU BAR, uniform bands, a fixed cell', () => {
  const cell = { width: ICON_CELL, height: ICON_CELL };
  const home = { width: W, height: H };
  // The default column at x = 16 is a near strut: it stays at 16 on any
  // width (the old plain-fraction pin slid it inward on a shrink) — and its
  // rows are springs below the menu-bar frame's top band, so they spread
  // with the height, centered on their fraction (a fixed-size box).
  const icon = { ...iconDefault(2, H), ...cell };
  for (const w of [500, 1400]) {
    const pos = roundTrip(icon, home, { width: w, height: H }, ICON_FRAME, {
      size: cell,
    });
    assert.deepEqual(pos, icon);
  }
  assert.ok(
    roundTrip(icon, home, { width: W, height: 500 }, ICON_FRAME, { size: cell }).top <
      icon.top
  );
  assert.ok(
    roundTrip(icon, home, { width: W, height: 1400 }, ICON_FRAME, { size: cell }).top >
      icon.top
  );
  // An icon riding the menu bar's bottom edge stays riding it at any height.
  const high = { left: 16, top: MENU_BAR, ...cell };
  for (const h of [300, 2000]) {
    assert.equal(
      roundTrip(high, home, { width: W, height: h }, ICON_FRAME, { size: cell }).top,
      MENU_BAR
    );
  }
  // The seams are the FINDER frame's, not the application's: the window
  // frame's top band runs through the rail head (~240px below the strip),
  // the icon frame's is the bare band below the menu bar. A box 200px down
  // is a top strut for a window — it stays put as the raster grows — and a
  // spring for an icon, which moves down with the middle.
  const b = { left: 16, top: 220, ...cell };
  const wide = { width: 1000, height: 820 };
  const tall = { width: 1000, height: 1620 };
  assert.equal(roundTrip(b, wide, tall, WINDOW_FRAME, { size: cell }).top, 220);
  assert.ok(roundTrip(b, wide, tall, ICON_FRAME, { size: cell }).top > 220);
});
