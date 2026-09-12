// Node-runnable tests for the Finder's icon arithmetic (apps/finder/layout.js):
// the icons' FRAME for the resize rule — the desktop below the menu bar in
// uniform bands, the default column a strut — against the windows' frame, and
// CLEAN UP's assignment onto a lattice. Never where an icon goes.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pinOf, pinTo, MENU_BAR, windowFrame } from '../src/shell/layout.js';
import {
  cleanUp,
  desktopLattice,
  folderLattice,
  latticeCell,
  latticeSlot,
  ICON_CELL,
  ICON_FRAME,
} from '../src/apps/finder/layout.js';
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
  // The default column runs down the RIGHT edge, so it is a FAR strut: it
  // keeps its 16px from the right edge on any width — as the old left-edge
  // column kept its 16 from the left. Its rows are springs below the
  // menu-bar frame's top band, so they spread with the height, centered on
  // their fraction (a fixed-size box).
  const icon = { ...latticeSlot(desktopLattice(W, H), 2), ...cell };
  for (const w of [500, 1400]) {
    const pos = roundTrip(icon, home, { width: w, height: H }, ICON_FRAME, {
      size: cell,
    });
    assert.deepEqual(pos, { ...latticeSlot(desktopLattice(w, H), 2), ...cell });
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

test('clean up: every icon on a cell, one icon per cell, a tidy set held', () => {
  for (const grid of [desktopLattice(W, H), folderLattice(400)]) {
    const onCell = (p) =>
      Number.isInteger((p.left - grid.left) / grid.dx) &&
      Number.isInteger((p.top - grid.top) / grid.dy);
    // Slop: four icons nudged off four cells, one of them far enough to be
    // nearer its neighbour's cell than its own.
    const cells = [
      latticeCell(grid, 0, 0),
      latticeCell(grid, 1, 0),
      latticeCell(grid, 0, 1),
      latticeCell(grid, 1, 1),
    ];
    const nudged = cells.map((c, i) => ({ left: c.left + 7 * i, top: c.top - 5 * i }));
    nudged.push({ left: cells[0].left + 3, top: cells[0].top + 2 }); // onto a taken cell
    const out = cleanUp(grid, nudged);
    assert.equal(out.length, nudged.length);
    for (const p of out) assert.ok(onCell(p), `off the lattice: ${JSON.stringify(p)}`);
    assert.equal(new Set(out.map((p) => `${p.left},${p.top}`)).size, out.length);
    // An already-tidy set does not move.
    assert.deepEqual(cleanUp(grid, cells), cells);
  }
});
