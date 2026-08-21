// Node-runnable tests for the desktop's window + icon arithmetic
// (shell/layout.js): the smart initial placement, the document-window
// cascade, the icons' default lattice, and the resize re-pin rule in both
// frames. Run: node --test
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
  spriteHeightFor,
  SPRITE_CHROME,
  SPRITE_WIDTH,
  ATLAS_GRID,
  TOP_RESERVE,
  MENU_BAR,
  ICON_CELL,
} from '../src/shell/layout.js';

const TOOLS = { width: 30, height: 158 };
// The capture tool's raster (1000×850 CSS at DSF 1, minus the 10px bezel).
const W = 980;
const H = 830;

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

test('pin: left is a fraction of the raster, top of the space below the strip', () => {
  // 25% across, 50% down the OPEN space (the band above is fixed chrome).
  const pin = pinOf(
    { left: 250, top: TOP_RESERVE + 400 },
    { width: 1000, height: TOP_RESERVE + 800 }
  );
  assert.deepEqual(pinTo(pin, { width: 500, height: TOP_RESERVE + 400 }), {
    left: 125,
    top: TOP_RESERVE + 200,
  });
  // Same raster → same position.
  assert.deepEqual(pinTo(pin, { width: 1000, height: TOP_RESERVE + 800 }), {
    left: 250,
    top: TOP_RESERVE + 400,
  });
});

test('pin: a window tucked under the options strip stays tucked under it', () => {
  // The pin's y = 0 line is the strip's bottom edge, not the raster's top —
  // a shrink can't slide the window up beneath the menu bar, and a grow
  // can't float it down away from the strip.
  const pin = pinOf({ left: 14, top: TOP_RESERVE }, { width: 1000, height: 830 });
  assert.equal(pinTo(pin, { width: 1000, height: 400 }).top, TOP_RESERVE);
  assert.equal(pinTo(pin, { width: 1000, height: 2000 }).top, TOP_RESERVE);
});

test('pin: no clamp — an edge-hugging window may hang off a shrunk raster', () => {
  // A 300-wide window at left 700 of 1000: at 60% width its left lands at
  // 420, putting its right edge (720) past the 600 raster — by design, so
  // growing back is exact.
  const pin = pinOf({ left: 700, top: 64 }, { width: 1000, height: 800 });
  assert.equal(pinTo(pin, { width: 600, height: 800 }).left, 420);
});

test('pin: a long resize drag cannot ratchet — every event maps the SAME fraction', () => {
  // The regression: re-deriving the fraction per event from the just-rounded
  // position walked windows down the screen (round-half-up never rounds
  // back). The contract is the one windows.js keeps: pinOf once, pinTo per
  // event — so a hundred wiggles land exactly home.
  const home = { width: 980, height: 830 };
  const pin = pinOf({ left: 172, top: 191 }, home);
  let pos = null;
  for (let i = 0; i < 100; i++) {
    const h = 830 + (i % 2 === 0 ? -(150 + i) : 150 + i); // wiggle up and down
    pos = pinTo(pin, { width: 980, height: h });
    assert.ok(Number.isFinite(pos.top));
  }
  assert.deepEqual(pinTo(pin, home), { left: 172, top: 191 });
});

test('pin: a zero-sized raster degrades gracefully', () => {
  const pin = pinOf({ left: 10, top: 100 }, { width: 0, height: 0 });
  const pos = pinTo(pin, { width: 600, height: 500 });
  assert.ok(Number.isFinite(pos.left) && Number.isFinite(pos.top));
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

test('icon pin: the frame is the desktop below the MENU BAR, not the strip', () => {
  // 50% down the space below the 20px menu bar, 10% across.
  const pin = pinOf(
    { left: 100, top: MENU_BAR + 405 },
    { width: 1000, height: MENU_BAR + 810 },
    MENU_BAR
  );
  assert.deepEqual(pinTo(pin, { width: 500, height: MENU_BAR + 400 }, MENU_BAR), {
    left: 50,
    top: MENU_BAR + 200,
  });
  // An icon riding the menu bar's bottom edge stays riding it at any height.
  const high = pinOf({ left: 16, top: MENU_BAR }, { width: 1000, height: 830 }, MENU_BAR);
  assert.equal(pinTo(high, { width: 1000, height: 300 }, MENU_BAR).top, MENU_BAR);
  assert.equal(pinTo(high, { width: 1000, height: 2000 }, MENU_BAR).top, MENU_BAR);
});

test('icon pin: an icon under the options strip is NOT pinned to it (unlike a window)', () => {
  // The strip is application chrome, no part of the icon frame: an icon at
  // the strip's bottom edge scales away from it as the raster grows — where
  // the same box pinned in the WINDOW frame would stay tucked against it.
  const box = { left: 16, top: TOP_RESERVE };
  const wide = { width: 1000, height: 820 };
  const tall = { width: 1000, height: 1620 };
  assert.equal(pinTo(pinOf(box, wide), tall).top, TOP_RESERVE);
  assert.ok(pinTo(pinOf(box, wide, MENU_BAR), tall, MENU_BAR).top > TOP_RESERVE);
});
