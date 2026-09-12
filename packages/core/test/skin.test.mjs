import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildVoxels } from '../src/pipeline.js';
import { FACE_GEO, idxFor, pointOf } from '../src/faces.js';
import { faceRegions, traceRegions } from '../src/regions.js';
import { bakeSkin, uvOfLattice, swatchUV } from '../src/skin.js';
import { packRGBA } from '../src/ingest.js';
import { AXIS_INDEX, FACE_INDEX } from '../src/views.js';
import { img, fill } from './helpers.mjs';

// A two-color wall. The +z and -z faces are each one 4×4 region crossing a color
// boundary (a chart). Every other face is one color (a swatch).
const wall = () =>
  buildVoxels({
    front: img(['RRRR', 'RRRR', 'BBBB', 'BBBB']),
    right: fill(4, 4, 'T'),
    top: fill(4, 4, 'T'),
  });
const cube = () =>
  buildVoxels({ front: fill(3, 3, 'M'), right: fill(3, 3, 'N'), top: fill(3, 3, 'T') });

const skinOf = (r) => {
  const regions = faceRegions(r.dims, r.surfaceMask, r.faceColor);
  return { regions, skin: bakeSkin(regions, r.palette, r.faceColor) };
};
const texel = (skin, u, v) => {
  const o = (v * skin.width + u) * 4;
  return packRGBA(skin.data[o], skin.data[o + 1], skin.data[o + 2], skin.data[o + 3]);
};
const faceKey = (r, region, i, j) =>
  idxFor(region.face, region.a + i, region.b + j, region.s, r.dims) * 6 +
  FACE_INDEX[region.face];
const colorAt = (r, region, i, j) => r.faceColor.get(faceKey(r, region, i, j)) >>> 0;
const eachCell = (region, fn) => {
  for (let j = 0; j < region.h; j++)
    for (let i = 0; i < region.w; i++) if (region.present[j * region.w + i]) fn(i, j);
};

test('the round-trip: a charted region’s texels are its faces’ colors, one texel per face, and each face’s center samples its own texel', () => {
  const r = wall();
  const { regions, skin } = skinOf(r);
  assert.ok(
    skin.charts.some(Boolean),
    'the two-color wall must chart at least one region'
  );
  const seen = new Set();
  regions.forEach((region, n) => {
    const chart = skin.charts[n];
    const g = FACE_GEO[region.face];
    eachCell(region, (i, j) => {
      const key = faceKey(r, region, i, j);
      assert.ok(!seen.has(key), 'a face belongs to one region');
      seen.add(key);
      if (!chart) return;
      // the texel holds the face's color
      assert.equal(texel(skin, chart.u0 + i, chart.v0 + j), colorAt(r, region, i, j));
      // and the face's center maps into that texel
      const p = [0, 0, 0];
      p[AXIS_INDEX[g.N]] = region.s;
      p[AXIS_INDEX[g.A]] = region.a + i + 0.5;
      p[AXIS_INDEX[g.B]] = region.b + j + 0.5;
      const [u, v] = uvOfLattice(chart, region, p);
      assert.deepEqual([Math.floor(u), Math.floor(v)], [chart.u0 + i, chart.v0 + j]);
    });
  });
  let exposed = 0;
  for (const m of r.surfaceMask) for (let f = 0; f < 6; f++) if (m & (1 << f)) exposed++;
  assert.equal(seen.size, exposed);
});

test('a one-color region is a swatch, a multi-color one a chart; the solid cube’s skin is the swatch strip alone', () => {
  const r = wall();
  const { regions, skin } = skinOf(r);
  regions.forEach((region, n) => {
    const colors = new Set();
    eachCell(region, (i, j) => colors.add(colorAt(r, region, i, j)));
    assert.equal(
      !!skin.charts[n],
      colors.size > 1,
      `${region.face} region: ${colors.size} colors`
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

test('the gutter: a chart’s padding takes its nearest piece texel, holes and cut corners flood from their edges, and no two padded charts overlap', () => {
  const { skin } = skinOf(wall());
  const cover = new Uint8Array(skin.width * skin.height);
  const claim = (u, v) => {
    assert.equal(cover[v * skin.width + u], 0, `texel ${u},${v} claimed twice`);
    cover[v * skin.width + u] = 1;
  };
  // The wall's regions are full boxes, so the nearest piece is the clamped texel.
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

  // A two-color staircase region with caps. The box beyond the diagonal is not
  // a piece, but every texel of the padded box is opaque.
  const cells = [];
  for (let b = 0; b < 3; b++)
    for (let a = 0; a < 3 - b; a++)
      cells.push({ a, b, color: a < 2 ? 0xff112233 : 0xff445566 });
  const caps = [1, 2].map((b) => ({
    a: 3 - b,
    b,
    hiA: false,
    hiB: false,
    color: 0xff112233,
  }));
  const [stair] = traceRegions(cells, caps);
  assert.equal(stair.uniform, null);
  const s = bakeSkin([stair], [], new Map());
  const [chart] = s.charts;
  assert.ok(chart);
  for (let v = chart.v0 - 1; v <= chart.v0 + chart.h; v++)
    for (let u = chart.u0 - 1; u <= chart.u0 + chart.w; u++) {
      const o = (v * s.width + u) * 4;
      assert.equal(s.data[o + 3], 255, `texel ${u},${v} of the padded box is painted`);
    }
  assert.equal(
    texel(s, chart.u0 + 2, chart.v0),
    0xff445566,
    'a piece keeps its own color'
  );
  assert.equal(
    texel(s, chart.u0 + 2, chart.v0 + 2),
    0xff112233,
    'beyond the diagonal, the nearest piece'
  );
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

test('determinism and size: the same input bakes byte-identical, power-of-two on both axes; one one-color region is the smallest sheet', () => {
  const a = skinOf(wall()).skin;
  const b = skinOf(wall()).skin;
  assert.deepEqual([a.width, a.height], [b.width, b.height]);
  assert.deepEqual(a.data, b.data);
  const pow2 = (n) => n > 0 && (n & (n - 1)) === 0;
  assert.ok(pow2(a.width) && pow2(a.height), `${a.width}×${a.height}`);
  // One cell of one color bakes to the same size as an empty bake.
  const c = packRGBA(10, 20, 30);
  const [one] = traceRegions([{ a: 0, b: 0, color: c }], []);
  const baked = bakeSkin([one], [c], new Map());
  const floor = bakeSkin([], [], new Map());
  assert.deepEqual(baked.charts, [null]);
  assert.equal(baked.swatch.size, 1);
  assert.deepEqual([baked.width, baked.height], [floor.width, floor.height]);
});

test('uvOfLattice: a region’s box corners are the chart’s corners on every face; an edge’s interior point lands between', () => {
  const chart = { u0: 5, v0: 3, w: 4, h: 2 };
  for (const face of Object.keys(FACE_GEO)) {
    const g = FACE_GEO[face];
    const region = { face, s: 2, a: 1, b: 6, w: 4, h: 2 };
    const corners = [
      [1, 6],
      [5, 6],
      [5, 8],
      [1, 8],
    ].map(([a, b]) => pointOf(face, a, b, 2));
    const uvs = corners.map((p) => uvOfLattice(chart, region, p));
    // The box origin maps to the chart origin, the far end to the far edge.
    corners.forEach((p, k) => {
      const ca = p[AXIS_INDEX[g.A]];
      const cb = p[AXIS_INDEX[g.B]];
      assert.deepEqual(uvs[k], [
        ca === region.a ? chart.u0 : chart.u0 + chart.w,
        cb === region.b ? chart.v0 : chart.v0 + chart.h,
      ]);
    });
    assert.equal(new Set(uvs.map(String)).size, 4, `${face}: four distinct corners`);
    const p = corners[0].slice();
    p[AXIS_INDEX[g.A]] = region.a + 2;
    const [u] = uvOfLattice(chart, region, p);
    assert.ok(
      u > chart.u0 && u < chart.u0 + chart.w,
      `${face}: an interior point between`
    );
    // The plane is at s + 1 for a positive face, s for a negative one.
    assert.equal(
      corners[0][AXIS_INDEX[g.N]],
      face[0] === 'p' ? 3 : 2,
      `${face}: the plane`
    );
  }
});
