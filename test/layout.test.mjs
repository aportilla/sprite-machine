// Node-runnable tests for the desktop's window + icon arithmetic
// (shell/layout.js): the smart initial placement, the icons' default
// lattice, and the resize re-pin rule in both frames. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  initialPlacement,
  iconDefault,
  pinOf,
  pinTo,
  TOP_RESERVE,
  MENU_BAR,
  ICON_CELL,
} from '../src/shell/layout.js';

const TOOLS = { width: 30, height: 158 };
// The capture tool's raster (1000×850 CSS at DSF 1, minus the 10px bezel).
const W = 980;
const H = 830;

test('placement: the sprite/stage rail is right-flush, stacked, 3:4', () => {
  const p = initialPlacement(W, H, TOOLS);
  // Both rail windoids share one box shape and column.
  assert.equal(p.sprite.left, p.stage.left);
  assert.equal(p.sprite.width, p.stage.width);
  assert.equal(p.sprite.height, p.stage.height);
  // 3:4 (w:h), to the rounding of the width.
  assert.equal(p.sprite.width, Math.round(p.sprite.height * (3 / 4)));
  // Right-flush behind the side inset, below the options strip, sprite on
  // top, stage under it with a gap, bottoming out inside the raster.
  assert.equal(p.sprite.left + p.sprite.width, W - 14);
  assert.ok(p.sprite.top > TOP_RESERVE);
  assert.ok(p.stage.top > p.sprite.top + p.sprite.height);
  assert.ok(p.stage.top + p.stage.height <= H);
});

test('placement: Tools sits top-left, above the rail band', () => {
  const p = initialPlacement(W, H, TOOLS);
  assert.equal(p.tools.left, 14);
  assert.equal(p.tools.top, TOP_RESERVE + 8);
  assert.ok(p.tools.left + TOOLS.width < p.doc.left);
});

test('placement: the document box fills ~2/3 of the vacant middle, centered', () => {
  const p = initialPlacement(W, H, TOOLS);
  const x0 = 14 + TOOLS.width + 14; // the vacant middle's left edge
  const x1 = p.sprite.left - 14; // …and its right edge
  const vacantW = x1 - x0;
  const vacantH = H - 8 - (TOP_RESERVE + 8);
  assert.equal(p.doc.width, Math.round(vacantW * (2 / 3)));
  assert.equal(p.doc.height, Math.round(vacantH * (2 / 3)));
  // Centered: equal margins each side, to a rounding pixel.
  const leftMargin = p.doc.left - x0;
  const rightMargin = x1 - (p.doc.left + p.doc.width);
  assert.ok(Math.abs(leftMargin - rightMargin) <= 1, `${leftMargin} vs ${rightMargin}`);
  // Entirely inside the vacancy.
  assert.ok(p.doc.left >= x0 && p.doc.left + p.doc.width <= x1);
  assert.ok(p.doc.top > TOP_RESERVE && p.doc.top + p.doc.height <= H);
});

test('placement: a narrow raster caps the rail width at 30%, aspect kept', () => {
  // Tall and narrow: the height-derived width (~720) would swallow the
  // raster; the cap holds it to 30% and re-derives the height from it.
  const p = initialPlacement(400, 2000, TOOLS);
  assert.equal(p.sprite.width, Math.floor(400 * 0.3));
  assert.equal(p.sprite.height, Math.round(p.sprite.width / (3 / 4)));
});

test('placement: a tiny raster still yields finite, usable boxes', () => {
  const p = initialPlacement(300, 200, TOOLS);
  for (const box of [p.sprite, p.stage, p.doc]) {
    assert.ok(Number.isFinite(box.left) && Number.isFinite(box.top));
    assert.ok(box.width > 0 && box.height > 0);
    assert.ok(box.left >= 0 && box.top >= TOP_RESERVE);
  }
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
