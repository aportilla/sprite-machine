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
  centeredBox,
  iconDefault,
  pinOf,
  pinTo,
  spriteHeightFor,
  SPRITE_CHROME,
  SPRITE_STRIP,
  SPRITE_PICKER,
  SPRITE_PICKER_AT,
  STAGE_STRIP,
  SPRITE_WIDTH,
  ATLAS_GRID,
  ringWidthFor,
  ringRowWidth,
  ringHeightFor,
  RING_CHROME,
  RING_STRIP,
  RING_MIN_WIDTH,
  RING_FIELD,
  RING_FIELDS,
  RING_CAPTION_HEIGHT,
  TOP_RESERVE,
  MENU_BAR,
  ICON_CELL,
  BAND,
  WINDOW_FRAME,
  ICON_FRAME,
} from '../src/shell/layout.js';
import { RING_DEFAULTS } from '../src/state/ring.js';

const TOOLS = { width: 30, height: 187 };
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

test("the windoids' headers: the picker's band and the checkbox row, rule included", () => {
  // The Sprite View's header holds the face picker block — six 21px cubes
  // with 12px gaps over the kit's 19px radio row under the 26px icons —
  // 8 in from the top and 8 above the rule; the chrome counts it.
  assert.deepEqual(SPRITE_PICKER, { width: 6 * 21 + 5 * 12, height: 26 + 19 });
  assert.equal(SPRITE_STRIP, 8 + SPRITE_PICKER.height + 8 + 1);
  assert.equal(SPRITE_STRIP, 62);
  assert.deepEqual(SPRITE_CHROME, { w: 2, h: 12 + 2 + SPRITE_STRIP });
  // The block centers across the fixed header's interior on whole px.
  assert.equal(SPRITE_PICKER_AT.left, (SPRITE_WIDTH - 2 - SPRITE_PICKER.width) / 2);
  assert.ok(Number.isInteger(SPRITE_PICKER_AT.left));
  assert.equal(SPRITE_PICKER_AT.top, 8);
  // The 3D View's header: the kit's 20px checkbox row over the rule.
  assert.equal(STAGE_STRIP, 24);
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

test("ring strip: the controls are a DITL whose arithmetic is the header's height and the width floor", () => {
  // The kit's metrics, stated once: a 74 × 25 number field, a 16px caption.
  assert.deepEqual(RING_FIELD, { width: 74, height: 25 });
  assert.equal(RING_CAPTION_HEIGHT, 16);
  const { box, rows, cols, captionDy } = RING_FIELDS;
  // Down: two rows 4 in from the top, 4 apart, 4 above the bottom.
  assert.deepEqual(rows, [4, 4 + 25 + 4]);
  assert.equal(box.height, 4 + 25 + 4 + 25 + 4);
  // A caption drops (25 − 16) / 2 floored below its row — where the
  // baselines meet (the caption's 12px ascent at 16 below the row; the
  // field's text at 1 + 1 + 2 + 12).
  assert.equal(captionDy, 4);
  assert.equal(captionDy + 12, 1 + 1 + 2 + 12);
  // Across: inset, caption, gap, field, gap, caption, gap, field, inset.
  assert.equal(cols[0].caption, 8);
  assert.equal(cols[0].field, cols[0].caption + cols[0].width + 6);
  assert.equal(cols[1].caption, cols[0].field + RING_FIELD.width + 6);
  assert.equal(cols[1].field, cols[1].caption + cols[1].width + 6);
  assert.equal(box.width, cols[1].field + RING_FIELD.width + 8);
  // Every item inside the box, in whole system px.
  for (const c of cols) {
    assert.ok(c.caption + c.width <= box.width);
    assert.ok(c.field + RING_FIELD.width <= box.width);
    for (const v of [c.caption, c.width, c.field]) assert.ok(Number.isInteger(v));
  }
  for (const r of rows) {
    assert.ok(r + RING_FIELD.height <= box.height);
    assert.ok(r + captionDy + RING_CAPTION_HEIGHT <= box.height);
  }
  // The DITL reproduces the strip as it was first measured (the plan's
  // as-built 258 × 62 — ring-size-plan.md): the strip is the controls over
  // the header's rule (the window's header-height, rule included), the
  // floor the controls plus the borders. (The paper setting has no column
  // — its radios were built and retired; ring-size-plan.md note 8.)
  assert.deepEqual(box, { width: 258, height: 62 });
  assert.equal(RING_STRIP, box.height + 1);
  assert.equal(RING_STRIP, 63);
  assert.equal(RING_MIN_WIDTH, box.width + RING_CHROME.w);
  assert.equal(RING_MIN_WIDTH, 260);
  assert.equal('paper' in RING_FIELDS, false);
});

test('ring sizing: the height derives from the tile size, the width seeds from the row, both floored', () => {
  // The chrome: the two side borders; 12 dot bar + 2 borders + the two-row
  // strip + the kit's horizontal rail (15 px inside the frame) over one row
  // of size-px cells.
  assert.deepEqual(RING_CHROME, { w: 2, h: 12 + 2 + RING_STRIP + 15 });
  assert.equal(ringHeightFor(64), RING_CHROME.h + 64);
  assert.equal(ringHeightFor(255), RING_CHROME.h + 255);
  assert.equal(ringHeightFor(0), RING_CHROME.h + 1, 'never a zero row');
  // The row's own width — the paper the view declares to the kit's scroll
  // area: n cells of size, butted (rules="none"), no perimeter.
  assert.equal(ringRowWidth(4, 64), 4 * 64);
  assert.equal(ringRowWidth(1, 128), 128);
  assert.equal(ringRowWidth(0, 64), 64, 'never fewer than one cell');
  // The natural row: the row + 2 borders, floored at the strip (a short
  // ring never clips the controls — the default four 64s among them, two
  // px under the floor now that no rules pad the row).
  assert.equal(ringWidthFor(4, 64), Math.max(RING_MIN_WIDTH, 4 * 64 + 2));
  assert.equal(ringWidthFor(4, 70), Math.max(RING_MIN_WIDTH, 4 * 70 + 2));
  assert.equal(ringWidthFor(16, 255), 16 * 255 + 2);
  assert.equal(ringWidthFor(1, 128), RING_MIN_WIDTH, 'a short ring floors at the strip');
  assert.equal(ringWidthFor(0, 64), RING_MIN_WIDTH, 'never fewer than one cell');
  // The layout's default size mirrors the slice's (one truth, restated for
  // the no-opts call), and the Sprite View's cell is no longer the ring's.
  assert.equal(RING_DEFAULTS.size, 64);
  assert.equal(
    initialPlacement(W, H, TOOLS).ring.height,
    ringHeightFor(RING_DEFAULTS.size)
  );
  assert.equal(ATLAS_GRID.cell, 70);
});

test("placement: the ring docks on the bottom margin at the doc box's left — the tile's height, the row's width", () => {
  const p = initialPlacement(W, H, TOOLS);
  const x1 = p.sprite.left - 14; // the vacancy's right edge
  assert.equal(p.ring.left, p.doc.left);
  assert.equal(p.ring.top + p.ring.height, H - 8);
  assert.equal(p.ring.height, ringHeightFor(64));
  assert.equal(p.ring.width, ringWidthFor(4, 64));
  // The tile size moves the height (the bottom stays docked); the view
  // count seeds the width; nothing else about the box moves.
  const big = initialPlacement(W, H, TOOLS, { ringSize: 200 });
  assert.equal(big.ring.height, ringHeightFor(200));
  assert.equal(big.ring.top + big.ring.height, H - 8);
  assert.equal(big.ring.left, p.ring.left);
  // (four 200-px cells outgrow this raster's vacancy — the cap below.)
  assert.equal(big.ring.width, Math.min(ringWidthFor(4, 200), x1 - p.doc.left));
  const eight = initialPlacement(W, H, TOOLS, { ringViews: 8 });
  assert.equal(eight.ring.width, ringWidthFor(8, 64));
  assert.equal(eight.ring.top, p.ring.top);
  // A row wider than the vacant middle is CAPPED at it — a fresh strip
  // never runs under the rail (the rail goes live instead) — and never
  // drops under the strip's floor.
  const wide = initialPlacement(W, H, TOOLS, { ringViews: 16, ringSize: 255 });
  assert.ok(ringWidthFor(16, 255) > x1 - p.doc.left);
  assert.equal(wide.ring.left + wide.ring.width, x1);
  const tiny = initialPlacement(300, 400, TOOLS, { ringViews: 16 });
  assert.equal(tiny.ring.width, RING_MIN_WIDTH);
});

test('placement: a shown ring shortens the doc box; hidden, nothing changes', () => {
  const off = initialPlacement(W, H, TOOLS);
  const hidden = initialPlacement(W, H, TOOLS, { ringShown: false });
  assert.deepEqual(hidden, off, 'the default is the hidden placement exactly');
  const on = initialPlacement(W, H, TOOLS, { ringShown: true });
  // Everything but the doc box is untouched…
  assert.deepEqual(on.tools, off.tools);
  assert.deepEqual(on.sprite, off.sprite);
  assert.deepEqual(on.stage, off.stage);
  assert.deepEqual(on.ring, off.ring);
  assert.equal(on.doc.left, off.doc.left);
  assert.equal(on.doc.top, off.doc.top);
  assert.equal(on.doc.width, off.doc.width);
  // …and the doc box bottom + the cascade room lands a GAP above the strip,
  // so every cascade slot still clears it.
  const room = (CASCADE_SLOTS - 1) * CASCADE_STEP;
  assert.equal(on.doc.top + on.doc.height + room, on.ring.top - 8);
  let occupied = [];
  for (let i = 0; i < CASCADE_SLOTS; i++) {
    const s = cascadeFrom(on.doc, occupied);
    assert.ok(s.top + on.doc.height <= on.ring.top - 8, `slot ${i} runs into the strip`);
    occupied = [...occupied, s];
  }
  // …by the tile's own height: a bigger tile takes more of the vacancy.
  const tall = initialPlacement(W, H, TOOLS, { ringShown: true, ringSize: 200 });
  assert.equal(tall.doc.height, on.doc.height - (ringHeightFor(200) - ringHeightFor(64)));
  assert.equal(tall.doc.top + tall.doc.height + room, tall.ring.top - 8);
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
  const p = initialPlacement(300, 200, TOOLS, { ringShown: true });
  for (const box of [p.sprite, p.stage, p.ring, p.doc]) {
    assert.ok(Number.isFinite(box.left) && Number.isFinite(box.top));
    assert.ok(box.width > 0 && box.height > 0);
    assert.ok(box.left >= 0 && box.top >= TOP_RESERVE);
  }
});

test('panel placement: centeredBox centers a fixed-size panel in the open area below the strip', () => {
  const size = { width: 248, height: 304 }; // the Desktop Patterns window (index.html)
  const b = centeredBox(W, H, size);
  assert.equal(b.width, size.width);
  assert.equal(b.height, size.height);
  // Centered on the raster's width, and on the open area BELOW the options
  // strip's band (the windows' frame, whether or not the strip is showing).
  assert.equal(b.left, Math.floor((W - size.width) / 2));
  assert.equal(b.top, TOP_RESERVE + Math.floor((H - TOP_RESERVE - size.height) / 2));
  assert.ok(Number.isInteger(b.left) && Number.isInteger(b.top));
  // A raster smaller than the panel floors the top-left at the reserve and
  // the left edge — the title bar stays grabbable; the clamp does the rest.
  const t = centeredBox(200, 200, size);
  assert.equal(t.left, 0);
  assert.equal(t.top, TOP_RESERVE);
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

test('zoom: a shown ring stops the zoomed box a gap above the strip', () => {
  const p = initialPlacement(W, H, TOOLS, { ringShown: true });
  const z = zoomedBox(W, H, p.doc, { ringShown: true });
  assert.equal(z.left, p.doc.left);
  assert.equal(z.top, p.doc.top);
  assert.equal(z.top + z.height, p.ring.top - 8);
  // The right edge is the rail's inset either way; the default is unchanged.
  assert.equal(z.width, zoomedBox(W, H, p.doc).width);
  assert.deepEqual(zoomedBox(W, H, p.doc, { ringShown: false }), zoomedBox(W, H, p.doc));
  // The band is the tile's own: a bigger tile stops the zoom higher.
  const zt = zoomedBox(W, H, p.doc, { ringShown: true, ringSize: 200 });
  assert.equal(zt.top + zt.height, H - 8 - ringHeightFor(200) - 8);
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
  const b = box(14, TOP_RESERVE, 30, 187);
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
  // The ring's placement on a degenerate raster is finite and floored at the
  // reserve (the Math.max floors), and its pin maps finitely too.
  const p = initialPlacement(0, 0, TOOLS, { ringShown: true });
  for (const v of Object.values(p.ring)) assert.ok(Number.isFinite(v));
  assert.ok(p.ring.top >= TOP_RESERVE);
  const rp = pinTo(
    pinOf(p.ring, { width: 0, height: 0 }, WINDOW_FRAME),
    { width: 600, height: 500 },
    WINDOW_FRAME,
    {
      size: { height: p.ring.height },
      min: { width: RING_MIN_WIDTH },
    }
  );
  for (const v of Object.values(rp)) assert.ok(Number.isFinite(v));
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
