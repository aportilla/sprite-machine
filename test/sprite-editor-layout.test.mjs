// Node-runnable tests for the Sprite Editor's window arithmetic
// (apps/sprite-editor/layout.js): a tiny raster's finiteness, and the
// placement as a FIXED POINT of the resize rule in the frame its bands
// widen. Never where a window goes. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pinOf, pinTo, TOP_RESERVE, windowFrame } from '../src/shell/layout.js';
import {
  initialPlacement,
  spriteHeightFor,
  SPRITE_WIDTH,
  ringHeightFor,
  RING_MIN_WIDTH,
  TOOLS_BOX,
  FRAME_BANDS,
} from '../src/apps/sprite-editor/layout.js';

// The Tools palette's box — its markup's, the one windoid the placement
// writes a position for alone.
const TOOLS = TOOLS_BOX;
// The windows' frame, its top and right bands widened for the rail.
const WINDOW_FRAME = windowFrame(FRAME_BANDS);
// A typical raster (1000×850 CSS at DSF 1, minus the 10px bezel).
const W = 980;
const H = 830;
const roundTrip = (b, from, to, frame, policy) =>
  pinTo(pinOf(b, from, frame), to, frame, policy);

test('placement: a tiny raster still yields finite, usable boxes; a zero-sized one places and pins finitely', () => {
  const p = initialPlacement(300, 200, { ringShown: true });
  for (const b of [p.sprite, p.stage, p.ring, p.doc]) {
    assert.ok(Number.isFinite(b.left) && Number.isFinite(b.top));
    assert.ok(b.width > 0 && b.height > 0);
    assert.ok(b.left >= 0 && b.top >= TOP_RESERVE);
  }
  // 0×0: the floors keep the ring finite and at the reserve, and its pin —
  // read on a raster with no middle at all — maps finitely.
  const z = initialPlacement(0, 0, { ringShown: true });
  assert.ok(Object.values(z.ring).every(Number.isFinite) && z.ring.top >= TOP_RESERVE);
  const rp = pinTo(
    pinOf(z.ring, { width: 0, height: 0 }, WINDOW_FRAME),
    { width: 600, height: 500 },
    WINDOW_FRAME,
    { size: { height: z.ring.height }, min: { width: RING_MIN_WIDTH } }
  );
  assert.ok(Object.values(rp).every(Number.isFinite));
});

test('pin: the placement is a fixed point — a resize lands the windoids where Arrange would', () => {
  // The window frame's top band runs through the stage's top edge (a GAP of
  // slack past it) and its right band covers the rail column (the rail's
  // left edge an inset inside it): the bands hold the rail, so the stage's
  // top edge and the rail's left edges are struts…
  const home = initialPlacement(W, H);
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
    const p0 = initialPlacement(r0.width, r0.height);
    for (const r1 of rasters) {
      const p1 = initialPlacement(r1.width, r1.height);
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
          const g0 = initialPlacement(r0.width, r0.height, opts);
          const g1 = initialPlacement(r1.width, r1.height, opts);
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
  const p = initialPlacement(odd.width, odd.height);
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
