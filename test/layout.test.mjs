// Node-runnable tests for the desktop's window + icon arithmetic
// (shell/layout.js): the smart initial placement, the document-window
// cascade, the icons' default lattice, and the nine-slice resize rule in
// both frames. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  initialPlacement,
  cascadeFrom,
  cascadeSlot,
  CASCADE_STEP,
  CASCADE_SLOTS,
  zoomedBox,
  iconDefault,
  pinOf,
  pinTo,
  spriteHeightFor,
  SPRITE_CHROME,
  SPRITE_WIDTH,
  ATLAS_GRID,
  TOP_RESERVE,
  MENU_BAR,
  ICON_CELL,
  BAND,
  WINDOW_FRAME,
  ICON_FRAME,
} from '../src/shell/layout.js';

const TOOLS = { width: 30, height: 158 };
// The capture tool's raster (1000×850 CSS at DSF 1, minus the 10px bezel).
const W = 980;
const H = 830;

// A plain frame for the pin arithmetic: no reserve, uniform 100px bands —
// on a 1000×800 raster the middle is x ∈ [100, 900), y ∈ [100, 700).
const F = { reserve: 0, bands: { left: 100, top: 100, right: 100, bottom: 100 } };
const R = { width: 1000, height: 800 };
const box = (left, top, width, height) => ({ left, top, width, height });
const roundTrip = (b, from, to, frame = F, policy) =>
  pinTo(pinOf(b, from, frame), to, frame, policy);

test('placement: the sprite/stage rail is one right-flush column, sprite fixed', () => {
  const p = initialPlacement(W, H, TOOLS);
  // The sprite windoid is FIXED-size: the atlas grid block's width, its
  // height derived (the face grid exactly fills its body below the picker
  // strip).
  assert.equal(p.sprite.width, SPRITE_WIDTH);
  assert.equal(p.sprite.height, spriteHeightFor(SPRITE_WIDTH));
  // Both right-flush behind the side inset at the SAME width, below the
  // options strip, sprite on top, stage under it with a gap, absorbing the
  // rest of the height down to the bottom gap.
  assert.equal(p.sprite.left + p.sprite.width, W - 14);
  assert.equal(p.stage.width, SPRITE_WIDTH);
  assert.equal(p.stage.left, p.sprite.left);
  assert.ok(p.sprite.top > TOP_RESERVE);
  assert.equal(p.stage.top, p.sprite.top + p.sprite.height + 8);
  assert.equal(p.stage.top + p.stage.height, H - 8);
});

test('sprite sizing: height derives from width through the tile ratio + chrome', () => {
  // The windoid width yields WHOLE grid cells: the body minus the interior
  // rules splits evenly across the columns (the vf-grid states cell sizes
  // in whole system px, and the exact-fill contract needs them to sum back
  // to the body).
  const cellW =
    (SPRITE_WIDTH - SPRITE_CHROME.w - (ATLAS_GRID.cols - 1)) / ATLAS_GRID.cols;
  assert.equal(cellW, ATLAS_GRID.cell);
  assert.ok(Number.isInteger(cellW));
  // The default ratio is the square tile: square cells, one rule between
  // the rows.
  assert.equal(
    spriteHeightFor(SPRITE_WIDTH),
    ATLAS_GRID.rows * ATLAS_GRID.cell + (ATLAS_GRID.rows - 1) + SPRITE_CHROME.h
  );
  // A live tile's own ratio wins (the ?tile=WxH shear hook): the cell
  // height rounds through it.
  assert.equal(
    spriteHeightFor(SPRITE_WIDTH, 0.5),
    ATLAS_GRID.rows * (ATLAS_GRID.cell / 2) + (ATLAS_GRID.rows - 1) + SPRITE_CHROME.h
  );
});

test('placement: Tools sits top-left, above the rail band', () => {
  const p = initialPlacement(W, H, TOOLS);
  assert.equal(p.tools.left, 14);
  assert.equal(p.tools.top, TOP_RESERVE + 8);
  assert.ok(p.tools.left + TOOLS.width < p.doc.left);
});

test('placement: the document box sits top-left beside Tools, leaving the cascade room', () => {
  const p = initialPlacement(W, H, TOOLS);
  const x0 = 14 + TOOLS.width + 14; // the vacant middle's left edge
  const x1 = p.sprite.left - 14; // …and its right edge (the rail's inset)
  const y1 = H - 8; // …and its bottom
  // Top-left aligned with the Tools palette: its top, a side inset right of it.
  assert.equal(p.doc.left, x0);
  assert.equal(p.doc.top, p.tools.top);
  // The room left at the right and bottom is exactly the cascade's: the
  // LAST slot lands flush with the vacancy's edges, every earlier one inside.
  const room = (CASCADE_SLOTS - 1) * CASCADE_STEP;
  assert.equal(p.doc.left + p.doc.width, x1 - room);
  assert.equal(p.doc.top + p.doc.height, y1 - room);
  let occupied = [];
  for (let i = 0; i < CASCADE_SLOTS; i++) {
    const s = cascadeFrom(p.doc, occupied);
    assert.ok(s.left + p.doc.width <= x1, `slot ${i} runs into the rail`);
    assert.ok(s.top + p.doc.height <= y1, `slot ${i} runs off the bottom`);
    occupied = [...occupied, s];
  }
  const last = occupied[CASCADE_SLOTS - 1];
  assert.equal(last.left + p.doc.width, x1);
  assert.equal(last.top + p.doc.height, y1);
});

test('placement: the rail is one column — the stage takes the sprite width on any raster', () => {
  // Tall and narrow, or squat and wide: the stage never derives a width of
  // its own. The sprite windoid's fixed size is untouched by the raster,
  // and the stage still bottoms out at the gap.
  for (const [w, h] of [
    [400, 2000],
    [2400, 500],
  ]) {
    const p = initialPlacement(w, h, TOOLS);
    assert.equal(p.sprite.width, SPRITE_WIDTH);
    assert.equal(p.stage.width, SPRITE_WIDTH);
    assert.equal(p.stage.left, p.sprite.left);
    assert.equal(p.stage.top + p.stage.height, h - 8);
  }
});

test('placement: a tiny raster still yields finite, usable boxes', () => {
  const p = initialPlacement(300, 200, TOOLS);
  for (const box of [p.sprite, p.stage, p.doc]) {
    assert.ok(Number.isFinite(box.left) && Number.isFinite(box.top));
    assert.ok(box.width > 0 && box.height > 0);
    assert.ok(box.left >= 0 && box.top >= TOP_RESERVE);
  }
});

test('cascade: the first open takes the doc box, each further one steps down-right', () => {
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
});

test('cascade: a freed slot is reused — a closed or dragged-away window gives it back', () => {
  const base = { left: 100, top: 100 };
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
  // still holds it.
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

test('cascade: every slot held wraps instead of walking off the raster', () => {
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
});

test('cascade: a slot re-expresses on any doc box — the same step of a new raster', () => {
  // A window that opened on slot 2 of one raster's doc box lands on slot 2
  // of another's (the resize rule for an untouched window), wrapping past
  // the slot count the way an open would.
  const a = { left: 100, top: 100 };
  const b = { left: 58, top: 64 };
  assert.deepEqual(
    cascadeSlot(a, 2),
    cascadeFrom(a, [cascadeSlot(a, 0), cascadeSlot(a, 1)])
  );
  assert.deepEqual(cascadeSlot(b, 2), {
    left: 58 + 2 * CASCADE_STEP,
    top: 64 + 2 * CASCADE_STEP,
    slot: 2,
  });
  assert.deepEqual(cascadeSlot(b, CASCADE_SLOTS + 1), cascadeSlot(b, 1));
});

test('zoom: the zoomed box fills the vacancy right and down from a held top-left', () => {
  const p = initialPlacement(W, H, TOOLS);
  const x1 = p.sprite.left - 14; // the vacant middle's right edge (the rail's inset)
  const y1 = H - 8; // …and its bottom
  // From the doc box's own top-left, the zoomed state is the whole vacancy:
  // the doc box plus exactly the cascade room it left.
  const room = (CASCADE_SLOTS - 1) * CASCADE_STEP;
  const z = zoomedBox(W, H, p.doc);
  assert.equal(z.left, p.doc.left);
  assert.equal(z.top, p.doc.top);
  assert.equal(z.left + z.width, x1);
  assert.equal(z.top + z.height, y1);
  assert.equal(z.width, p.doc.width + room);
  assert.equal(z.height, p.doc.height + room);
  // From a dragged top-left the far edges land on the SAME boundaries —
  // a zoom never moves the top-left, only the far edges.
  const dragged = { left: p.doc.left + 100, top: p.doc.top + 60 };
  const zd = zoomedBox(W, H, dragged);
  assert.equal(zd.left, dragged.left);
  assert.equal(zd.top, dragged.top);
  assert.equal(zd.left + zd.width, x1);
  assert.equal(zd.top + zd.height, y1);
});

test('zoom: a window dragged past the vacancy still gets a workable floor', () => {
  // Top-left beyond the vacancy's edges: the arithmetic would go negative,
  // so both extents floor (DOC_MIN) instead — the box may hang off the
  // raster, the resize rule's own recoverable-by-a-drag posture.
  const z = zoomedBox(W, H, { left: W - 20, top: H - 20 });
  assert.equal(z.left, W - 20);
  assert.equal(z.top, H - 20);
  assert.ok(z.width >= 220 && z.height >= 220);
});

test('pin: a strut keeps its offset from its edge, a spring its fraction of the middle', () => {
  // Wholly inside the top-left band: both edges per axis are NEAR struts —
  // the box does not move at all.
  assert.deepEqual(roundTrip(box(30, 40, 50, 30), R, { width: 600, height: 500 }), {
    left: 30,
    top: 40,
    width: 50,
    height: 30,
  });
  // Wholly inside the bottom-right band: FAR struts — it keeps its offsets
  // from the right and bottom edges.
  assert.deepEqual(roundTrip(box(940, 740, 40, 40), R, { width: 600, height: 500 }), {
    left: 540,
    top: 440,
    width: 40,
    height: 40,
  });
  // Wholly inside the middle: SPRINGS — 25%…75% of the middle on both axes,
  // so position AND size scale with it (a resizable box).
  assert.deepEqual(roundTrip(box(300, 250, 400, 300), R, { width: 1400, height: 1200 }), {
    left: 400,
    top: 350,
    width: 600,
    height: 500,
  });
  // Same raster → the same box, exactly.
  assert.deepEqual(roundTrip(box(300, 250, 400, 300), R, R), box(300, 250, 400, 300));
});

test('pin: the frame reserve is the y = 0 line — a box under the strip stays under it', () => {
  // The window frame: a box riding the options strip's bottom edge is a
  // near strut at offset 0 on any raster height.
  const b = box(14, TOP_RESERVE, 30, 158);
  const home = { width: 1000, height: 830 };
  assert.equal(
    roundTrip(b, home, { width: 1000, height: 400 }, WINDOW_FRAME).top,
    TOP_RESERVE
  );
  assert.equal(
    roundTrip(b, home, { width: 1000, height: 2000 }, WINDOW_FRAME).top,
    TOP_RESERVE
  );
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

test('pin: a corner widget is rigid — same size, same corner offsets, on any raster', () => {
  const widget = box(930, 750, 60, 40); // 10px off the bottom-right corner
  for (const to of [
    { width: 600, height: 500 },
    { width: 1400, height: 1200 },
    { width: 300, height: 250 },
  ]) {
    const want = { left: to.width - 70, top: to.height - 50, width: 60, height: 40 };
    assert.deepEqual(roundTrip(widget, R, to), want); // resizable
    assert.deepEqual(
      roundTrip(widget, R, to, F, { size: { width: 60, height: 40 } }),
      want
    );
  }
});

test('pin: near + far stretches with the raster, spring + spring scales with the middle', () => {
  // Spanning from the left band to the right band: both margins hold.
  assert.deepEqual(roundTrip(box(50, 50, 900, 700), R, { width: 1400, height: 1200 }), {
    left: 50,
    top: 50,
    width: 1300,
    height: 1100,
  });
  // Inside the middle: the box is the middle's 25%…75% on both rasters.
  const scaled = roundTrip(box(300, 250, 400, 300), R, { width: 600, height: 500 });
  assert.deepEqual(scaled, { left: 200, top: 175, width: 200, height: 150 });
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

test('pin: the placement is a fixed point — a resize lands the windoids where Arrange would', () => {
  // The window frame's top and right bands hold the rail (the stage's top
  // edge and the rail's left edges are struts), so every placed windoid
  // re-pins onto any other raster EXACTLY as initialPlacement puts it there
  // — the test that retires the "untouched window follows the placement"
  // special case. The document window is content: its top-left (the
  // cascade slot) is a fixed point too, while its right and bottom edges
  // spring with the vacancy — inside it, never into the rail or off the
  // bottom.
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

test('pin: a long resize drag cannot ratchet — every event maps the SAME pin', () => {
  // The regression: re-deriving the pin per event from the just-rounded
  // geometry walked windows down the screen (round-half-up never rounds
  // back). The contract is the one windows.js keeps: pinOf once, pinTo per
  // event — so a hundred wiggles land exactly home, springs included.
  const home = { width: 980, height: 830 };
  const b = box(172, 391, 300, 200); // its edges: near, spring; spring, spring
  const pin = pinOf(b, home, WINDOW_FRAME);
  for (let i = 0; i < 100; i++) {
    const h = 830 + (i % 2 === 0 ? -(150 + i) : 150 + i); // wiggle up and down
    const pos = pinTo(pin, { width: 980, height: h }, WINDOW_FRAME);
    assert.ok(Number.isFinite(pos.top) && Number.isFinite(pos.height));
  }
  assert.deepEqual(pinTo(pin, home, WINDOW_FRAME), b);
});

test('pin: a zero-sized raster degrades gracefully', () => {
  const pin = pinOf(box(10, 100, 50, 50), { width: 0, height: 0 }, WINDOW_FRAME);
  const pos = pinTo(pin, { width: 600, height: 500 }, WINDOW_FRAME);
  for (const v of Object.values(pos)) assert.ok(Number.isFinite(v));
});

test('frames: the window bands hold the rail, the icon bands are the bare spec', () => {
  assert.equal(BAND, 100);
  assert.equal(WINDOW_FRAME.reserve, TOP_RESERVE);
  assert.equal(ICON_FRAME.reserve, MENU_BAR);
  // Uniform floors at the left and bottom; the top band runs through the
  // stage's top edge (a GAP of slack past it), the right band covers the
  // rail column (the rail's left edge sits an inset inside it).
  const p = initialPlacement(W, H, TOOLS);
  const { bands } = WINDOW_FRAME;
  assert.equal(bands.left, BAND);
  assert.equal(bands.bottom, BAND);
  assert.ok(
    bands.top > p.stage.top - TOP_RESERVE && bands.top <= p.stage.top - TOP_RESERVE + 8
  );
  assert.ok(bands.right > W - p.stage.left && bands.right <= W - p.stage.left + 14);
  assert.deepEqual(ICON_FRAME.bands, {
    left: BAND,
    top: BAND,
    right: BAND,
    bottom: BAND,
  });
});

test('icon defaults: a raster-derived column below the Tools band, wrapping', () => {
  // The tall case: one column at the classic left edge, 72px pitch.
  assert.deepEqual(iconDefault(0, 830), { left: 16, top: 340 });
  assert.deepEqual(iconDefault(1, 830), { left: 16, top: 412 });
  // 830 tall fits six cells (the sixth tops at 700, whose 64px cell still
  // bottoms inside the raster); the seventh folds into a second column back
  // at the top of the band, one 80px column pitch to the right.
  assert.deepEqual(iconDefault(5, 830), { left: 16, top: 700 });
  assert.deepEqual(iconDefault(6, 830), { left: 96, top: 340 });
  // A short raster wraps sooner: at 410 only one cell fits per column.
  assert.deepEqual(iconDefault(1, 410), { left: 96, top: 340 });
  // Every default cell it deals out bottoms inside the raster it was dealt
  // for (the whole point of deriving from it).
  for (let slot = 0; slot < 12; slot++) {
    const p = iconDefault(slot, 620);
    assert.ok(p.top + ICON_CELL <= 620, `slot ${slot}: top ${p.top}`);
  }
  // A raster too short for even one cell still yields finite positions
  // (a single row — the boot clamp pulls it up into frame).
  const p = iconDefault(3, 100);
  assert.ok(Number.isFinite(p.left) && Number.isFinite(p.top));
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
});

test("icon pin: the seams are the FINDER frame's, not the application's", () => {
  // The window frame's top band runs through the rail head (~240px below the
  // strip); the icon frame's is the bare 100 below the menu bar. A box 200px
  // down is a top strut for a window — it stays put as the raster grows —
  // and a spring for an icon, which moves down with the middle.
  const b = { left: 16, top: 220, ...{ width: ICON_CELL, height: ICON_CELL } };
  const wide = { width: 1000, height: 820 };
  const tall = { width: 1000, height: 1620 };
  const size = { width: ICON_CELL, height: ICON_CELL };
  assert.equal(roundTrip(b, wide, tall, WINDOW_FRAME, { size }).top, 220);
  assert.ok(roundTrip(b, wide, tall, ICON_FRAME, { size }).top > 220);
});
