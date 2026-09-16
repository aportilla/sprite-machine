import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pinOf, pinTo, TOP_RESERVE, windowFrame } from '../src/shell/layout.js';
import {
  initialPlacement,
  paletteFit,
  paletteGrid,
  PALETTE_MIN_HEIGHT,
  PALETTE_MIN_WIDTH,
  spriteHeightFor,
  SPRITE_WIDTH,
  ringHeightFor,
  RING_MIN_WIDTH,
  TOOLS_BOX,
  FRAME_BANDS,
  zoomedBox,
} from '../src/apps/sprite-editor/layout.js';

// The Tools palette's size. initialPlacement gives the palette a position only.
const TOOLS = TOOLS_BOX;
// The window frame, with its left, top and right bands widened for the docked
// windoids.
const WINDOW_FRAME = windowFrame(FRAME_BANDS);
// A typical raster (1000×850 CSS at DSF 1, minus the 10px bezel).
const W = 980;
const H = 830;
const roundTrip = (b, from, to, frame, policy) =>
  pinTo(pinOf(b, from, frame), to, frame, policy);

test('placement: a tiny raster still yields finite, usable boxes; a zero-sized one places and pins finitely', () => {
  const p = initialPlacement(300, 200, { ringShown: true });
  for (const b of [p.sprite, p.stage, p.ring, p.palette, p.doc]) {
    assert.ok(Number.isFinite(b.left) && Number.isFinite(b.top));
    assert.ok(b.width > 0 && b.height > 0);
    assert.ok(b.left >= 0 && b.top >= TOP_RESERVE);
  }
  // On a 0×0 raster the ring box stays finite and its pin maps finitely.
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

test('placement: the Color Palette and the strip share the bottom band, the strip right of the Palette; the doc box and its zoom stay above the band', () => {
  const hidden = initialPlacement(W, H);
  const shown = initialPlacement(W, H, { ringShown: true });
  const { palette, ring } = shown;
  assert.deepEqual(hidden.ring, ring, 'the strip placed alike, shown or hidden');
  assert.equal(palette.left, shown.doc.left, 'left-aligned with the doc box');
  assert.ok(ring.left >= palette.left + palette.width, 'the strip right of the Palette');
  assert.ok(ring.left + ring.width <= shown.sprite.left, 'the strip clears the rail');
  assert.equal(
    palette.top + palette.height,
    ring.top + ring.height,
    'level at the bottom'
  );
  assert.ok(palette.top + palette.height <= H, 'on the raster');
  for (const opts of [{}, { ringShown: true }]) {
    const p = initialPlacement(W, H, opts);
    const bandTop = Math.min(p.palette.top, opts.ringShown ? p.ring.top : H);
    const tag = JSON.stringify(opts);
    assert.ok(p.doc.top + p.doc.height <= bandTop, `the doc box clears ${tag}`);
    const z = zoomedBox(W, H, p.doc, opts);
    assert.ok(z.top + z.height <= bandTop, `the zoom clears ${tag}`);
  }
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

test('pin: the placement is a fixed point — a resize lands the windoids where Arrange would', () => {
  // The top band reaches just past the stage's top edge and the right band
  // covers the rail column, so those edges are struts.
  const home = initialPlacement(W, H);
  const { bands } = WINDOW_FRAME;
  assert.ok(
    bands.top > home.stage.top - TOP_RESERVE &&
      bands.top <= home.stage.top - TOP_RESERVE + 8
  );
  assert.ok(bands.right > W - home.stage.left && bands.right <= W - home.stage.left + 14);
  // Every placed windoid re-pins onto another raster exactly where
  // initialPlacement puts it. The document window's top-left is a fixed point
  // too. Its right and bottom edges spring but stay clear of the rail and the
  // bottom edge.
  const rasters = [
    { width: 980, height: 830 },
    { width: 760, height: 620 },
    { width: 1400, height: 1000 },
    { width: 1001, height: 831 }, // odd, for the 2px snap check below
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
      // The 3D Sprite Atlas strip has a fixed height and a width floored at
      // RING_MIN_WIDTH. Its left, top and height are a fixed point beside the
      // Color Palette. Its width springs but stays clear of the rail. Tile sizes
      // stay small: a tall strip's top on a short raster falls in the top band
      // and pins near. The Palette keeps its size.
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
          const { width, height } = g0.palette;
          assert.deepEqual(
            roundTrip(g0.palette, r0, r1, WINDOW_FRAME, { size: { width, height } }),
            g1.palette,
            `palette ${tag}`
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
  // Snapped to a 2px lattice, every stage edge is still a strut.
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
