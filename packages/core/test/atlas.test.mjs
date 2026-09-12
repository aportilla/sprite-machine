import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sliceAtlas,
  validateSheet,
  blitTile,
  cellOf,
  contentBounds,
  isBlank,
  resizeTileTo,
  resizeAtlas,
  splitLow,
} from '../src/atlas.js';
import { buildVoxels } from '../src/pipeline.js';
import { voxIndex } from '../src/carve.js';
import { VIEW_DISPLAY_ORDER, VIEW_NAMES } from '../src/views.js';

// A divisible, fully opaque sheet. Every cell slices to a non-null tile.
function makeSheet(tileW, tileH, cols, rows) {
  const W = tileW * cols;
  const H = tileH * rows;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      data[i] = (x * 7) & 255;
      data[i + 1] = (y * 5) & 255;
      data[i + 2] = ((x + y) * 3) & 255;
      data[i + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

test('round-trip: slice then blit every view reproduces the sheet byte-for-byte', () => {
  const sheet = makeSheet(4, 3, 3, 2);
  const { views, tileW, tileH } = sliceAtlas(sheet);
  const rebuilt = {
    width: sheet.width,
    height: sheet.height,
    data: new Uint8ClampedArray(sheet.data.length),
  };
  for (const name of VIEW_DISPLAY_ORDER) {
    const t = views[name];
    assert.ok(t, `expected a non-null tile for ${name}`);
    const { r, c } = cellOf(name);
    blitTile(rebuilt, t, c * tileW, r * tileH);
  }
  assert.deepEqual(rebuilt.data, sheet.data);
});

test('empty tile blitted in re-slices back to null via isBlank', () => {
  const sheet = makeSheet(4, 3, 3, 2);
  const { tileW, tileH } = sliceAtlas(sheet);
  // Erase the front cell with a transparent tile.
  const blank = {
    width: tileW,
    height: tileH,
    data: new Uint8ClampedArray(tileW * tileH * 4),
  };
  const { r, c } = cellOf('front');
  blitTile(sheet, blank, c * tileW, r * tileH);
  const re = sliceAtlas(sheet);
  assert.equal(re.views.front, null, 'erased cell should slice to null');
  assert.ok(re.views.back, 'untouched cells stay non-null');
});

test('blitTile only touches its rect (a non-divisible remainder is left alone)', () => {
  // On a 7x5 sheet, a 3x2 grid of 2x2 tiles leaves the last column and row uncovered.
  const W = 7;
  const H = 5;
  const sheet = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  const mark = (x, y, v) => {
    const i = (y * W + x) * 4;
    sheet.data[i] = sheet.data[i + 1] = sheet.data[i + 2] = sheet.data[i + 3] = v;
  };
  mark(6, 4, 200); // a remainder pixel
  const opaque = {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray(2 * 2 * 4).fill(255),
  };
  blitTile(sheet, opaque, 0, 0); // fills [0,2)x[0,2)
  const at = (x, y) => sheet.data[(y * W + x) * 4];
  assert.equal(at(0, 0), 255, 'blitted rect written');
  assert.equal(at(1, 1), 255, 'blitted rect written');
  assert.equal(at(2, 0), 0, 'outside the rect untouched');
  assert.equal(at(6, 4), 200, 'remainder pixel preserved');
});

test('cellOf returns the correct {r,c} for all six views', () => {
  const expected = {
    left: { r: 0, c: 0 },
    front: { r: 0, c: 1 },
    top: { r: 0, c: 2 },
    right: { r: 1, c: 0 },
    back: { r: 1, c: 1 },
    bottom: { r: 1, c: 2 },
  };
  for (const [name, rc] of Object.entries(expected)) {
    assert.deepEqual(cellOf(name), rc, `cell for ${name}`);
  }
  assert.equal(cellOf('nope'), null, 'unknown view → null');
});

// contentBounds

// A w×h tile with opaque texels only at the given [x,y] coordinates.
function dottedTile(w, h, dots) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (const [x, y] of dots) data[(y * w + x) * 4 + 3] = 255;
  return { width: w, height: h, data };
}

test('contentBounds: a tight box around the content, the whole tile when full, null exactly when isBlank', () => {
  const t = dottedTile(8, 6, [
    [2, 1],
    [5, 4],
  ]);
  assert.deepEqual(contentBounds(t), { x: 2, y: 1, width: 4, height: 4 });
  // A single texel is a 1×1 box.
  assert.deepEqual(contentBounds(dottedTile(3, 3, [[1, 2]])), {
    x: 1,
    y: 2,
    width: 1,
    height: 1,
  });
  // A fully opaque tile trims nothing.
  const full = { width: 4, height: 3, data: new Uint8ClampedArray(4 * 3 * 4).fill(255) };
  assert.deepEqual(contentBounds(full), { x: 0, y: 0, width: 4, height: 3 });
  // contentBounds and isBlank share the alpha !== 0 rule. Any nonzero alpha is content.
  const blank = dottedTile(4, 4, []);
  assert.equal(contentBounds(blank), null, 'all-transparent → null');
  assert.ok(isBlank(blank), '…and isBlank agrees');
  const faint = dottedTile(4, 4, []);
  faint.data[(2 * 4 + 3) * 4 + 3] = 1;
  assert.deepEqual(contentBounds(faint), { x: 3, y: 2, width: 1, height: 1 });
  assert.ok(!isBlank(faint), '…and isBlank agrees');
});

// Tile and atlas resize

// A 2x2 tile with one opaque marker texel at (0,0).
function markerTile() {
  const data = new Uint8ClampedArray(2 * 2 * 4);
  data[0] = 11; // R at texel (0,0)
  data[1] = 22; // G
  data[2] = 33; // B
  data[3] = 255; // A
  return { width: 2, height: 2, data };
}
const alphaAt = (t, x, y) => t.data[(y * t.width + x) * 4 + 3];

// A 3x2 sheet with an asymmetric, distinctly colored shape per face, so a wrong
// resize anchor changes the carved solid.
const PAL = {
  R: [220, 60, 60],
  G: [80, 190, 90],
  B: [70, 90, 200],
  Y: [220, 210, 90],
  C: [100, 200, 210],
  M: [200, 120, 210],
};
// Each tile is opaque except for one transparent corner.
const TILE_ART = {
  left: ['.RRR', 'RRRR', 'RRRR', 'RRRR'],
  front: ['GGG.', 'GGGG', 'GGGG', 'GGGG'],
  top: ['BBBB', 'BBBB', 'BBBB', 'BBB.'],
  right: ['YYYY', 'YYYY', 'YYYY', '.YYY'],
  back: ['.CCC', 'CCCC', 'CCCC', 'CCCC'],
  bottom: ['MMMM', 'MMMM', 'MMMM', 'MMM.'],
};
function artSheet(tile) {
  const cols = 3;
  const rows = 2;
  const W = cols * tile;
  const H = rows * tile;
  const sheet = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  for (const name of VIEW_NAMES) {
    const { r, c } = cellOf(name);
    const rowsArt = TILE_ART[name];
    for (let y = 0; y < tile; y++) {
      for (let x = 0; x < tile; x++) {
        const ch = rowsArt[y][x];
        if (ch === '.') continue;
        const [rr, gg, bb] = PAL[ch];
        const i = ((r * tile + y) * W + (c * tile + x)) * 4;
        sheet.data[i] = rr;
        sheet.data[i + 1] = gg;
        sheet.data[i + 2] = bb;
        sheet.data[i + 3] = 255;
      }
    }
  }
  return sheet;
}

function voxelsOf(sheet) {
  const { views } = sliceAtlas(sheet);
  const raw = {};
  for (const n of VIEW_NAMES) raw[n] = views[n] || null;
  return buildVoxels(raw);
}

// Asserts that grown's lattice is base's plus delta on each axis, and that every
// voxel of base reappears at (x+off, y+off, z+off) with the same solid bit and
// face colors.
function assertRegistered(base, grown, delta, off) {
  assert.deepEqual(grown.dims, {
    nx: base.dims.nx + delta,
    ny: base.dims.ny + delta,
    nz: base.dims.nz + delta,
  });
  assert.equal(grown.solidCount, base.solidCount, 'solid voxel count unchanged');
  for (let z = 0; z < base.dims.nz; z++) {
    for (let y = 0; y < base.dims.ny; y++) {
      for (let x = 0; x < base.dims.nx; x++) {
        const bi = voxIndex(x, y, z, base.dims);
        const gi = voxIndex(x + off, y + off, z + off, grown.dims);
        assert.equal(grown.solid[gi], base.solid[bi], `solid @ ${x},${y},${z}`);
        for (let f = 0; f < 6; f++) {
          assert.equal(
            grown.faceColor.get(gi * 6 + f),
            base.faceColor.get(bi * 6 + f),
            `face ${f} color @ ${x},${y},${z}`
          );
        }
      }
    }
  }
}

test('resizeAtlas: a square grow preserves every voxel + face color (registration held)', () => {
  const base = voxelsOf(artSheet(4));
  assert.ok(base.solidCount > 0, 'the base sheet carves to a non-empty solid');
  const grown = voxelsOf(resizeAtlas(artSheet(4), 6, 6, { anchor: 'origin' }));
  assertRegistered(base, grown, 2, 0);
});

test('resizeAtlas: an asymmetric (non-square) resize falls out of registration — depth shears (accepted, warned)', () => {
  // The tiles have the requested size.
  const sheet = resizeAtlas(artSheet(4), 6, 4, { anchor: 'origin' }); // W 4→6
  assert.equal(sheet.width, 6 * 3);
  assert.equal(sheet.height, 4 * 2);
  const { tileW, tileH } = sliceAtlas(sheet);
  assert.equal(tileW, 6);
  assert.equal(tileH, 4);
  // nz is both the side tile's width and the top tile's height, so W ≠ H
  // over-constrains depth. reconcileDims takes the max.
  const base = voxelsOf(artSheet(4)); // 4×4×4
  const skew = voxelsOf(sheet);
  assert.notEqual(skew.dims.nz, base.dims.nz, 'depth axis is double-booked → shifts');
  assert.ok(skew.solidCount < base.solidCount, 'asymmetric resize shears voxels away');
  assert.ok(skew.warnings.length > 0, 'the shear is surfaced as a warning');
});

test('resizeAtlas: shrinking below the object extent crops without throwing', () => {
  const small = voxelsOf(resizeAtlas(artSheet(4), 2, 2, { anchor: 'origin' }));
  assert.deepEqual(small.dims, { nx: 2, ny: 2, nz: 2 });
  assert.ok(small.solidCount <= 8, 'solid is clamped to the smaller lattice');
});

// Centered resize (anchor: 'center')

test('splitLow: ±1 steps alternate ends; any change divides within one texel', () => {
  // Single-step grows pad alternating ends.
  assert.equal(splitLow(4, 5), 1); // old even → pad the low end
  assert.equal(splitLow(5, 6), 0); // old odd  → pad the high end
  assert.equal(splitLow(6, 7), 1);
  assert.equal(splitLow(7, 8), 0);
  // Shrinks alternate too. A negative result crops the low end.
  assert.equal(splitLow(5, 4), 0);
  assert.equal(splitLow(4, 3), -1);
  for (const [o, n] of [
    [4, 6],
    [4, 7],
    [4, 8],
    [10, 3],
    [3, 10],
    [40, 41],
    [41, 40],
  ]) {
    const low = splitLow(o, n);
    const high = n - o - low;
    assert.ok(Math.abs(low - high) <= 1, `${o}->${n}: ${low}/${high} within one texel`);
  }
});

test('resizeTileTo: places a tile at an explicit offset, padding + clipping', () => {
  const out = resizeTileTo(markerTile(), 4, 4, 1, 1); // 2×2 marker offset into a 4×4
  assert.equal(alphaAt(out, 1, 1), 255, 'marker moved to (1,1)');
  assert.equal(out.data[(1 * 4 + 1) * 4], 11, 'RGB carried to the new position');
  assert.equal(alphaAt(out, 0, 0), 0, 'origin padded transparent');
  // A negative offset crops that edge.
  const crop = resizeTileTo(markerTile(), 2, 2, -1, 0);
  assert.equal(alphaAt(crop, 0, 0), 0, 'the (0,0) marker was cropped from the left');
  // A zero offset anchors top-left.
  const grow = resizeTileTo(markerTile(), 4, 4, 0, 0);
  assert.equal(alphaAt(grow, 0, 0), 255, 'marker stays at top-left');
  assert.equal(grow.data[0], 11, 'RGB carried through');
  assert.equal(alphaAt(grow, 3, 3), 0, 'far corner padded transparent');
});

test('resizeAtlas center: a square grow keeps the solid intact, just translated to center', () => {
  const base = voxelsOf(artSheet(4));
  const grown = voxelsOf(resizeAtlas(artSheet(4), 6, 6, { anchor: 'center' }));
  assertRegistered(base, grown, 2, splitLow(4, 6));
});

test("resizeAtlas center: a grow keeps the object centered (where 'origin' hugs the corner)", () => {
  // Empty lines below and above the solid along an axis.
  const gaps = ({ dims, solid }, axis) => {
    let lo = Infinity;
    let hi = -1;
    for (let z = 0; z < dims.nz; z++) {
      for (let y = 0; y < dims.ny; y++) {
        for (let x = 0; x < dims.nx; x++) {
          if (!solid[voxIndex(x, y, z, dims)]) continue;
          const c = axis === 'x' ? x : axis === 'y' ? y : z;
          if (c < lo) lo = c;
          if (c > hi) hi = c;
        }
      }
    }
    const size = axis === 'x' ? dims.nx : axis === 'y' ? dims.ny : dims.nz;
    return { loGap: lo, hiGap: size - 1 - hi };
  };
  const centered = voxelsOf(resizeAtlas(artSheet(4), 10, 10, { anchor: 'center' }));
  const origin = voxelsOf(resizeAtlas(artSheet(4), 10, 10, { anchor: 'origin' }));
  for (const axis of ['x', 'y', 'z']) {
    const c = gaps(centered, axis);
    const o = gaps(origin, axis);
    assert.ok(
      Math.abs(c.loGap - c.hiGap) <= 1,
      `centered ${axis}: ${c.loGap}/${c.hiGap} balanced around the middle`
    );
    // splitLow(4, 10) is 3, so centering moves the art three lines off the low corner.
    assert.ok(
      c.loGap > o.loGap,
      `centered ${axis} sits off the low corner (origin loGap ${o.loGap} < ${c.loGap})`
    );
  }
});

// sliceAtlas warnings and guards

test('sliceAtlas: a sheet too small to split (sub-1px tiles) bails with no views and a warning', () => {
  // A 1×1 sheet gives tileW = round(1/3) = 0.
  const tiny = { width: 1, height: 1, data: new Uint8ClampedArray(1 * 1 * 4) };
  const res = sliceAtlas(tiny);
  assert.equal(res.tileW, 0, 'derived tile width collapses to 0');
  assert.deepEqual(Object.keys(res.views), [], 'no view tiles produced at all');
  assert.ok(
    Object.values(res.views).every((v) => v === null),
    'every view value is null (vacuously — none were populated)'
  );
  assert.equal(res.warnings.length, 1, 'exactly the one guard warning');
});

test('sliceAtlas: a non-divisible sheet warns and still reads tiles from the top-left', () => {
  // 7×5 gives tileW = round(7/3) = 2 and tileH = round(5/2) = 3, which don't divide
  // the sheet. The opaque (0,0) pixel makes the left cell non-null.
  const W = 7;
  const H = 5;
  const sheet = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  sheet.data[0] = 99; // R at (0,0)
  sheet.data[3] = 255; // A at (0,0)
  const res = sliceAtlas(sheet);
  assert.equal(res.tileW, 2, 'tileW = round(7/3)');
  assert.equal(res.tileH, 3, 'tileH = round(5/2)');
  assert.equal(res.warnings.length, 1, 'just the divisibility mismatch warning');
  assert.ok(res.views.left, 'the top-left cell still slices to a tile');
  assert.equal(res.views.left.data[0], 99, 'and it reads the top-left pixel');
});

// validateSheet

test('validateSheet: rejects null, zero-sized, and short-buffer sheets; accepts a well-formed one', () => {
  assert.ok(validateSheet(null), 'null → an error');
  assert.ok(
    validateSheet({ width: 0, height: 4, data: new Uint8ClampedArray(0) }),
    'zero width → an error'
  );
  assert.ok(
    validateSheet({ width: 4, height: 0, data: new Uint8ClampedArray(0) }),
    'zero height → an error'
  );
  // Buffer of 10 bytes where 4×4 RGBA needs 64.
  assert.ok(
    validateSheet({ width: 4, height: 4, data: new Uint8ClampedArray(10) }),
    'under-length data buffer → an error'
  );
  assert.equal(
    validateSheet({ width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4) }),
    null,
    'a correctly-sized sheet passes (null)'
  );
});
