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

// The window frame with the Sprite Editor's bands, to compare with ICON_FRAME.
const WINDOW_FRAME = windowFrame(FRAME_BANDS);
// A typical raster: 1000×850 CSS px at DSF 1, less the 10px bezel.
const W = 980;
const H = 830;
const roundTrip = (b, from, to, frame, policy) =>
  pinTo(pinOf(b, from, frame), to, frame, policy);

test('icon pin: the frame is the desktop below the MENU BAR, uniform bands, a fixed cell', () => {
  const cell = { width: ICON_CELL, height: ICON_CELL };
  const home = { width: W, height: H };
  // The default column is on the right edge, a far strut that keeps its
  // offset at any width. Its rows are springs that spread with the height.
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
  // An icon at the menu bar's bottom edge stays there at any height.
  const high = { left: 16, top: MENU_BAR, ...cell };
  for (const h of [300, 2000]) {
    assert.equal(
      roundTrip(high, home, { width: W, height: h }, ICON_FRAME, { size: cell }).top,
      MENU_BAR
    );
  }
  // The window frame's top band extends through the Sprite Editor's rail
  // head. The icon frame's is only the band below the menu bar. A box 220px
  // down is a strut in the window frame and a spring in the icon frame.
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
    // Four icons nudged off their cells, one nearer a neighbor's cell than
    // its own.
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
