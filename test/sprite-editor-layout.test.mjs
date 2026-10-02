import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  initialPlacement,
  paletteFit,
  paletteGrid,
  PALETTE_MIN_HEIGHT,
  PALETTE_MIN_WIDTH,
  STAGE_MIN_HEIGHT,
  TOOLS_BOX,
  WINDOW_TOP,
  zoomedBox,
} from '../src/apps/sprite-editor/layout.js';

// The Tools palette's size. initialPlacement gives the palette a position only.
const TOOLS = TOOLS_BOX;
// A typical raster (1000×850 CSS at DSF 1, minus the 10px bezel).
const W = 980;
const H = 830;

test('placement: a tiny raster still yields finite, usable boxes in the window area; a zero-sized one places finitely', () => {
  const p = initialPlacement(300, 200, { ringShown: true });
  for (const b of [p.sprite, p.stage, p.ring, p.palette, p.doc]) {
    assert.ok(Number.isFinite(b.left) && Number.isFinite(b.top));
    assert.ok(b.width > 0 && b.height > 0);
    assert.ok(b.left >= 0 && b.top >= WINDOW_TOP);
  }
  const z = initialPlacement(0, 0, { ringShown: true });
  assert.ok(Object.values(z.ring).every(Number.isFinite) && z.ring.top >= WINDOW_TOP);
});

test('placement: the Color Palette sits centered under the Tools palette, the strip at the bottom under the doc box; the doc box and its zoom clear both', () => {
  const hidden = initialPlacement(W, H);
  const shown = initialPlacement(W, H, { ringShown: true });
  const { tools, palette, ring } = shown;
  assert.deepEqual(hidden.ring, ring, 'the strip placed alike, shown or hidden');
  const offCenter = palette.left + palette.width / 2 - (tools.left + TOOLS.width / 2);
  assert.ok(Math.abs(offCenter) <= 0.5, 'centered under the Tools palette');
  assert.ok(palette.top > tools.top + TOOLS.height, 'under the Tools palette');
  assert.equal(ring.left, shown.doc.left, 'the strip left-aligned with the doc box');
  assert.ok(ring.left + ring.width <= shown.sprite.left, 'the strip clears the rail');
  assert.ok(ring.top + ring.height <= H, 'on the raster');
  for (const opts of [{}, { ringShown: true }]) {
    const p = initialPlacement(W, H, opts);
    const bandTop = opts.ringShown ? p.ring.top : H;
    const tag = JSON.stringify(opts);
    for (const b of [p.doc, zoomedBox(W, H, p.doc, opts)]) {
      assert.ok(b.left >= tools.left + TOOLS.width, `clears the Tools palette ${tag}`);
      assert.ok(b.left >= palette.left + palette.width, `clears the Palette ${tag}`);
      assert.ok(b.top + b.height <= bandTop, `clears the bottom ${tag}`);
    }
  }
});

test('placement: the Color Palette shows every swatch, cut at the bottom margin, never shorter than with none', () => {
  for (let h = 250; h <= 1100; h += 50) {
    const none = initialPlacement(W, h).palette;
    for (const count of [7, 10, 11, 24, 60, 256]) {
      const { palette } = initialPlacement(W, h, { paletteCount: count });
      const tag = `${count} swatches at raster height ${h}`;
      const { columns, rows } = paletteGrid(palette.width, palette.height, 0);
      const room = paletteFit(palette.width, h - 8 - palette.top);
      assert.ok(palette.height >= none.height, `${tag} shorter than with none`);
      if (columns * rows < count) {
        assert.equal(
          palette.height,
          Math.max(none.height, room.height),
          `${tag} short of the margin`
        );
      } else if (palette.height > none.height) {
        assert.ok(columns * (rows - 1) < count, `${tag} a spare row`);
        assert.ok(palette.top + palette.height <= h - 8, `${tag} past the margin`);
      }
    }
  }
});

test('placement: the 3D View is square under the Full Sprite View, shortened to fit the raster down to its floor', () => {
  let squares = 0;
  let fitted = 0;
  for (let h = 300; h <= 1400; h += 25) {
    const { sprite, stage } = initialPlacement(W, h);
    const tag = `raster height ${h}`;
    assert.equal(stage.left, sprite.left, `${tag} left`);
    assert.equal(stage.width, sprite.width, `${tag} width`);
    assert.ok(
      stage.top > sprite.top + sprite.height,
      `${tag} under the Full Sprite View`
    );
    assert.ok(stage.height <= stage.width, `${tag} taller than square`);
    assert.ok(stage.height >= STAGE_MIN_HEIGHT, `${tag} under the floor`);
    const bottom = stage.top + stage.height;
    if (stage.height === stage.width) {
      assert.ok(bottom <= h - 8, `${tag} square past the bottom margin`);
      squares++;
    } else if (stage.height > STAGE_MIN_HEIGHT) {
      assert.equal(bottom, h - 8, `${tag} shortened short of the bottom margin`);
      fitted++;
    }
  }
  assert.ok(squares > 0 && fitted > 0, 'the sweep reaches both cases');
});

test('paletteFit: a grow snaps back to the cells the window shows, with no spare pixel', () => {
  const cells = (b) => {
    const { columns, rows } = paletteGrid(b.width, b.height, 0);
    return { columns, rows };
  };
  const floor = { width: PALETTE_MIN_WIDTH, height: PALETTE_MIN_HEIGHT };
  assert.deepEqual(paletteFit(floor.width, floor.height), floor, 'the floor is a fit');
  for (let width = PALETTE_MIN_WIDTH; width <= 260; width += 7) {
    for (let height = PALETTE_MIN_HEIGHT; height <= 260; height += 5) {
      const fit = paletteFit(width, height);
      const tag = `${width}×${height}`;
      assert.ok(fit.width <= width && fit.height <= height, `${tag} grew`);
      assert.deepEqual(paletteFit(fit.width, fit.height), fit, `${tag} moved again`);
      const shown = cells(fit);
      assert.deepEqual(shown, cells({ width, height }), `${tag} shows other cells`);
      // paletteGrid shows at least one column, so the one-column floor is skipped.
      if (fit.width > PALETTE_MIN_WIDTH) {
        assert.equal(cells({ ...fit, width: fit.width - 1 }).columns, shown.columns - 1);
      }
      assert.equal(cells({ ...fit, height: fit.height - 1 }).rows, shown.rows - 1);
    }
  }
});
