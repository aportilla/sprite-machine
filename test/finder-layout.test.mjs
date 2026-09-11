// Node-runnable tests for the Finder's icon arithmetic (apps/finder/layout.js):
// the icons' FRAME for the resize rule — the desktop below the menu bar in
// uniform bands, the default column a strut — against the windows' frame.
// Never where an icon goes. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pinOf, pinTo, MENU_BAR, windowFrame } from '../src/shell/layout.js';
import { iconDefault, ICON_CELL, ICON_FRAME } from '../src/apps/finder/layout.js';
import { FRAME_BANDS } from '../src/apps/sprite-editor/layout.js';

// The windows' frame as the desktop runs it, its top band widened through
// the Sprite Editor's rail head — the frame the icons' is set against.
const WINDOW_FRAME = windowFrame(FRAME_BANDS);
// A typical raster (1000×850 CSS at DSF 1, minus the 10px bezel).
const W = 980;
const H = 830;
const roundTrip = (b, from, to, frame, policy) =>
  pinTo(pinOf(b, from, frame), to, frame, policy);

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
