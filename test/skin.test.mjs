// The skin (src/lib/skin.js — pure, no THREE): the texture the mesher's
// occupancy merge paints from. A chart per multi-color rect holding its faces'
// colors verbatim (the round-trip, and each face's center sampling its own
// texel — the one test an orientation drift fails), a swatch per color for the
// uniform rects, replicated gutters that never overlap, a deterministic
// power-of-two pack, and the UV read tied to FACE_GEO's own corner order.
// Run: node --test test/skin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildVoxels } from '../src/lib/pipeline.js';
import { greedyQuads, FACE_GEO, idxFor } from '../src/lib/faces.js';
import { bakeSkin, uvOfLattice, swatchUV } from '../src/lib/skin.js';
import { packRGBA } from '../src/lib/ingest.js';
import { AXIS_INDEX, FACE_INDEX } from '../src/lib/views.js';
import { img, fill } from './helpers.mjs';

// A wall painted in two colors over a full side and top: the +z face (and the
// -z one mirror-filled from it) merges to ONE 4×4 rect on occupancy that
// crosses a color boundary — a chart; every other face is one color — a swatch.
const wall = () =>
  buildVoxels({
    front: img(['RRRR', 'RRRR', 'BBBB', 'BBBB']),
    right: fill(4, 4, 'T'),
    top: fill(4, 4, 'T'),
  });
const cube = () =>
  buildVoxels({ front: fill(3, 3, 'M'), right: fill(3, 3, 'N'), top: fill(3, 3, 'T') });

const skinOf = (r) => {
  const rects = greedyQuads(r.dims, r.surfaceMask);
  return { rects, skin: bakeSkin(rects, r.palette, r.faceColor, r.dims) };
};
const texel = (skin, u, v) => {
  const o = (v * skin.width + u) * 4;
  return packRGBA(skin.data[o], skin.data[o + 1], skin.data[o + 2], skin.data[o + 3]);
};
const faceKey = (r, rect, i, j) =>
  idxFor(rect.face, rect.a + i, rect.b + j, rect.s, r.dims) * 6 + FACE_INDEX[rect.face];
const colorAt = (r, rect, i, j) => r.faceColor.get(faceKey(r, rect, i, j)) >>> 0;
const eachFace = (rect, fn) => {
  for (let j = 0; j < rect.h; j++) for (let i = 0; i < rect.w; i++) fn(i, j);
};

test('the round-trip: a charted rect’s texels are its faces’ colors, one texel per face, and each face’s center samples its own texel', () => {
  const r = wall();
  const { rects, skin } = skinOf(r);
  assert.ok(skin.charts.some(Boolean), 'the two-color wall must chart at least one rect');
  const seen = new Set(); // every exposed face belongs to exactly one rect
  rects.forEach((rect, n) => {
    const chart = skin.charts[n];
    const g = FACE_GEO[rect.face];
    eachFace(rect, (i, j) => {
      const key = faceKey(r, rect, i, j);
      assert.ok(!seen.has(key), 'a face belongs to one rect');
      seen.add(key);
      if (!chart) return;
      // the texel says what the face says...
      assert.equal(texel(skin, chart.u0 + i, chart.v0 + j), colorAt(r, rect, i, j));
      // ...and the face's own center, as a point on the plane, lands in it
      const p = [0, 0, 0];
      p[AXIS_INDEX[g.N]] = rect.s;
      p[AXIS_INDEX[g.A]] = rect.a + i + 0.5;
      p[AXIS_INDEX[g.B]] = rect.b + j + 0.5;
      const [u, v] = uvOfLattice(chart, rect, p);
      assert.deepEqual([Math.floor(u), Math.floor(v)], [chart.u0 + i, chart.v0 + j]);
    });
  });
  let exposed = 0;
  for (const m of r.surfaceMask) for (let f = 0; f < 6; f++) if (m & (1 << f)) exposed++;
  assert.equal(seen.size, exposed);
});

test('a uniform rect is a swatch, a multi-color one a chart; the solid cube’s skin is the swatch strip alone', () => {
  const r = wall();
  const { rects, skin } = skinOf(r);
  rects.forEach((rect, n) => {
    const colors = new Set();
    eachFace(rect, (i, j) => colors.add(colorAt(r, rect, i, j)));
    assert.equal(
      !!skin.charts[n],
      colors.size > 1,
      `${rect.face} rect: ${colors.size} colors`
    );
  });
  const c = skinOf(cube()).skin;
  assert.ok(
    c.charts.every((ch) => ch === null),
    'one color per face: no chart'
  );
  let opaque = 0;
  for (let i = 3; i < c.data.length; i += 4) if (c.data[i]) opaque++;
  assert.equal(opaque, c.swatch.size, 'the strip alone: one texel per color');
});

test('the gutter: a chart’s padding replicates its nearest body texel, and no two padded charts overlap', () => {
  const { skin } = skinOf(wall());
  const cover = new Uint8Array(skin.width * skin.height);
  const claim = (u, v) => {
    assert.equal(cover[v * skin.width + u], 0, `texel ${u},${v} claimed twice`);
    cover[v * skin.width + u] = 1;
  };
  for (const chart of skin.charts) {
    if (!chart) continue;
    const { u0, v0, w, h } = chart;
    for (let v = v0 - 1; v <= v0 + h; v++)
      for (let u = u0 - 1; u <= u0 + w; u++) {
        claim(u, v);
        const cu = Math.min(u0 + w - 1, Math.max(u0, u));
        const cv = Math.min(v0 + h - 1, Math.max(v0, v));
        assert.equal(texel(skin, u, v), texel(skin, cu, cv));
      }
  }
  for (const { u, v } of skin.swatch.values()) claim(u, v);
});

test('the swatches: every color in the palette and on the faces has one, holding its color, read at its center', () => {
  const r = wall();
  const { skin } = skinOf(r);
  const union = new Set([...r.palette, ...r.faceColor.values()].map((c) => c >>> 0));
  assert.equal(skin.swatch.size, union.size);
  for (const c of union) {
    const at = skin.swatch.get(c);
    assert.ok(at, `no swatch for ${c.toString(16)}`);
    assert.equal(texel(skin, at.u, at.v), c);
    assert.deepEqual(swatchUV(skin, c), [at.u + 0.5, at.v + 0.5]);
  }
});

test('determinism and size: the same input bakes byte-identical, power-of-two on both axes; one uniform rect is the smallest sheet', () => {
  const a = skinOf(wall()).skin;
  const b = skinOf(wall()).skin;
  assert.deepEqual([a.width, a.height], [b.width, b.height]);
  assert.deepEqual(a.data, b.data);
  const pow2 = (n) => n > 0 && (n & (n - 1)) === 0;
  assert.ok(pow2(a.width) && pow2(a.height), `${a.width}×${a.height}`);
  // One 1×1 rect of one color: no chart, one swatch, and the sheet no bigger
  // than the empty bake's — the floor.
  const dims = { nx: 1, ny: 1, nz: 1 };
  const c = packRGBA(10, 20, 30);
  const rect = {
    face: 'pz',
    s: 0,
    a: 0,
    b: 0,
    w: 1,
    h: 1,
    normal: [0, 0, 1],
    corners: [],
  };
  const one = bakeSkin([rect], [c], new Map([[FACE_INDEX.pz, c]]), dims);
  const floor = bakeSkin([], [], new Map(), dims);
  assert.deepEqual(one.charts, [null]);
  assert.equal(one.swatch.size, 1);
  assert.deepEqual([one.width, one.height], [floor.width, floor.height]);
});

test('uvOfLattice: a rect’s corners are the chart’s corners on every face, in quad()’s own order; an edge’s interior point lands between', () => {
  const chart = { u0: 5, v0: 3, w: 4, h: 2 };
  for (const face of Object.keys(FACE_GEO)) {
    const g = FACE_GEO[face];
    const rect = {
      face,
      s: 2,
      a: 1,
      b: 6,
      w: 4,
      h: 2,
      normal: [],
      corners: g.quad(1, 4, 6, 7, 2),
    };
    const uvs = rect.corners.map((p) => uvOfLattice(chart, rect, p));
    // The expectation derives from each corner's own coordinate along A and B:
    // at the rect's origin it is the chart's origin, at the far end the far edge.
    rect.corners.forEach((p, k) => {
      const ca = p[AXIS_INDEX[g.A]];
      const cb = p[AXIS_INDEX[g.B]];
      assert.ok(
        ca === rect.a || ca === rect.a + rect.w,
        `${face}: corner off the rect on A`
      );
      assert.ok(
        cb === rect.b || cb === rect.b + rect.h,
        `${face}: corner off the rect on B`
      );
      assert.deepEqual(uvs[k], [
        ca === rect.a ? chart.u0 : chart.u0 + chart.w,
        cb === rect.b ? chart.v0 : chart.v0 + chart.h,
      ]);
    });
    assert.equal(new Set(uvs.map(String)).size, 4, `${face}: four distinct corners`);
    const p = rect.corners[0].slice();
    p[AXIS_INDEX[g.A]] = rect.a + 2;
    const [u] = uvOfLattice(chart, rect, p);
    assert.ok(
      u > chart.u0 && u < chart.u0 + chart.w,
      `${face}: an interior point between`
    );
  }
});
