import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  projectBounds,
  projectDelta,
  projectFlip,
  liftFaces,
  createFaceSelection,
} from '../src/lib/select-faces.js';
import { liftRect, clearRect, compositeFloat } from '../src/lib/select.js';
import {
  VIEWS,
  VIEW_NAMES,
  VIEW_AXES,
  VIEW_OPPOSITE,
  VIEW_TO_FACE,
  FACE_INDEX,
  buildVoxels,
  voxIndex,
  unpackRGBA,
} from 'sprite-machine';

const T = 4;
const DIMS = { nx: T, ny: T, nz: T };
const DIM_NAMES = ['nx', 'ny', 'nz'];

const inRect = (b, p) => p.u >= b.x0 && p.u <= b.x1 && p.v >= b.y0 && p.v <= b.y1;
const depthDim = (view) => DIM_NAMES.find((d) => !VIEW_AXES[view].includes(d));
const coordOf = { nx: (v) => v.x, ny: (v) => v.y, nz: (v) => v.z };

/** Every lattice cell, in any order. */
function cells(dims = DIMS) {
  const out = [];
  for (let z = 0; z < dims.nz; z++)
    for (let y = 0; y < dims.ny; y++)
      for (let x = 0; x < dims.nx; x++) out.push({ x, y, z });
  return out;
}

/** The one cell whose pixel on `view` is `at`, on `from`'s line of sight. A move
 *  never changes the depth coordinate, so it is unique. */
function cellAt(view, from, at) {
  const dim = depthDim(view);
  return cells().find((c) => {
    const p = VIEWS[view].project(c.x, c.y, c.z, DIMS);
    return p.u === at.u && p.v === at.v && coordOf[dim](c) === coordOf[dim](from);
  });
}

// Geometry

test('projectBounds: the box behind the rectangle projects onto exactly the projected one', () => {
  const rect = { x0: 1, y0: 0, x1: 2, y1: 2 };
  for (const view of VIEW_NAMES) {
    const box = cells().filter((c) =>
      inRect(rect, VIEWS[view].project(c.x, c.y, c.z, DIMS))
    );
    for (const onto of VIEW_NAMES) {
      const out = projectBounds(view, rect, onto, T);
      const hit = box.map((c) => VIEWS[onto].project(c.x, c.y, c.z, DIMS));
      const label = `${view} -> ${onto}`;
      for (const p of hit) assert.ok(inRect(out, p), `${label}: ${p.u},${p.v} outside`);
      assert.deepEqual(
        {
          x0: Math.min(...hit.map((p) => p.u)),
          x1: Math.max(...hit.map((p) => p.u)),
          y0: Math.min(...hit.map((p) => p.v)),
          y1: Math.max(...hit.map((p) => p.v)),
        },
        { x0: out.x0, x1: out.x1, y0: out.y0, y1: out.y1 },
        `${label}: not tight`
      );
    }
  }
});

test('the opposite face takes the mirrored rectangle, and projecting it back returns the original', () => {
  const rect = { x0: 0, y0: 1, x1: 2, y1: 2 };
  for (const view of VIEW_NAMES) {
    const opp = VIEW_OPPOSITE[view];
    const out = projectBounds(view, rect, opp, T);
    assert.deepEqual(out, {
      x0: T - 1 - rect.x1,
      y0: rect.y0,
      x1: T - 1 - rect.x0,
      y1: rect.y1,
    });
    assert.deepEqual(projectBounds(opp, out, view, T), rect, `${view} round trip`);
  }
});

test('a neighbour spans the whole tile on the edited face’s depth axis', () => {
  const rect = { x0: 1, y0: 1, x1: 1, y1: 2 };
  for (const view of VIEW_NAMES) {
    const depth = depthDim(view);
    for (const onto of VIEW_NAMES) {
      if (onto === view || onto === VIEW_OPPOSITE[view]) continue;
      const out = projectBounds(view, rect, onto, T);
      const [col, row] = VIEW_AXES[onto];
      const span = col === depth ? [out.x0, out.x1] : [out.y0, out.y1];
      assert.equal(col === depth || row === depth, true, `${view} -> ${onto}`);
      assert.deepEqual(span, [0, T - 1], `${view} -> ${onto}`);
    }
  }
});

test('projectDelta moves a voxel’s pixel the same way, and is zero along the line of sight', () => {
  const from = { x: 1, y: 1, z: 1 };
  for (const view of VIEW_NAMES) {
    const p0 = VIEWS[view].project(from.x, from.y, from.z, DIMS);
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 2],
    ]) {
      const moved = cellAt(view, from, { u: p0.u + dx, v: p0.v + dy });
      if (!moved) continue; // off the lattice
      for (const onto of VIEW_NAMES) {
        const d = projectDelta(view, dx, dy, onto);
        const q0 = VIEWS[onto].project(from.x, from.y, from.z, DIMS);
        const q1 = VIEWS[onto].project(moved.x, moved.y, moved.z, DIMS);
        assert.deepEqual(
          { dx: q1.u - q0.u, dy: q1.v - q0.v },
          d,
          `${view} (${dx},${dy}) -> ${onto}`
        );
      }
      // The two faces looking along the moved axis see no move at all.
      const still = VIEW_NAMES.filter((n) => {
        const d = projectDelta(view, dx, dy, n);
        return d.dx === 0 && d.dy === 0;
      });
      assert.equal(still.length, dx && dy ? 0 : 2, `${view} (${dx},${dy})`);
    }
  }
});

test('projectFlip mirrors the projected rectangle, and is null for the faces that look along the axis', () => {
  const rect = { x0: 0, y0: 1, x1: 2, y1: 2 };
  const from = { x: 1, y: 1, z: 1 };
  for (const view of VIEW_NAMES) {
    for (const axis of /** @type {const} */ (['horizontal', 'vertical'])) {
      const p0 = VIEWS[view].project(from.x, from.y, from.z, DIMS);
      // The same voxel mirrored within the rectangle, on the edited face.
      const mirrored = cellAt(view, from, {
        u: axis === 'horizontal' ? rect.x0 + rect.x1 - p0.u : p0.u,
        v: axis === 'vertical' ? rect.y0 + rect.y1 - p0.v : p0.v,
      });
      let nulls = 0;
      for (const onto of VIEW_NAMES) {
        const band = projectBounds(view, rect, onto, T);
        const q0 = VIEWS[onto].project(from.x, from.y, from.z, DIMS);
        const q1 = VIEWS[onto].project(mirrored.x, mirrored.y, mirrored.z, DIMS);
        const got = projectFlip(view, axis, onto);
        const label = `${view} ${axis} -> ${onto}`;
        if (got === null) {
          nulls++;
          assert.deepEqual(q1, q0, `${label}: the picture should hold still`);
        } else if (got === 'horizontal') {
          assert.deepEqual(q1, { u: band.x0 + band.x1 - q0.u, v: q0.v }, label);
        } else {
          assert.deepEqual(q1, { u: q0.u, v: band.y0 + band.y1 - q0.v }, label);
        }
      }
      assert.equal(nulls, 2, `${view} ${axis}: two faces look along it`);
      assert.equal(projectFlip(view, axis, VIEW_OPPOSITE[view]), axis);
    }
  }
});

// Layers. Art is written as rows, '.' clear.

const COLORS = { r: [255, 0, 0], g: [0, 170, 0], b: [0, 0, 255] };

function tile(rows) {
  const data = new Uint8ClampedArray(T * T * 4);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      data.set([...COLORS[ch], 255], (y * T + x) * 4);
    })
  );
  return { width: T, height: T, data };
}

const px = (t, x, y) => [...t.data.subarray((y * T + x) * 4, (y * T + x) * 4 + 4)];
const bytes = (t) => [...t.data];

/**
 * A shelf high across the back (y=2, z 0..1) and a box under it (y=0, z 0..1,
 * x 0..1). Drawn on front, left and top; right, back and bottom are derived.
 */
const stacked = () => ({
  front: tile(['....', 'gggg', '....', 'rr..']),
  left: tile(['....', '..gg', '....', '..rr']),
  top: tile(['....', '....', 'gggg', 'gggg']),
});

/**
 * Two low bars, one behind the other along z with a gap: the near one (B, z=3)
 * and the far one (A, z=0, x 0..1). The top tile's fourth column is a stray:
 * the front face cuts it away.
 */
const bars = () => ({
  front: tile(['....', '....', '....', 'rrr.']),
  left: tile(['....', '....', '....', 'r..g']),
  top: tile(['.rrr', '....', '....', 'b.gg']),
});

const modelOf = (views) => buildVoxels({ ...views });
const faceColorAt = (m, cell, view) =>
  unpackRGBA(
    m.faceColor.get(
      voxIndex(cell.x, cell.y, cell.z, m.dims) * 6 + FACE_INDEX[VIEW_TO_FACE[view]]
    )
  );

// The lift

test('a rectangle around everything puts every painted texel of every face with art in the part', () => {
  const views = stacked();
  const lift = liftFaces(views, 'left', { x0: 0, y0: 0, x1: T - 1, y1: T - 1 }, T);
  assert.deepEqual(
    lift.faces.map((f) => f.face),
    ['front', 'top'],
    'the edited face and the derived faces take no part'
  );
  for (const f of lift.faces) {
    for (let i = 0; i < T * T; i++) {
      const painted = f.origin[i * 4 + 3] !== 0;
      assert.equal(f.rest.has[i], 0, `${f.face}: nothing is left over`);
      assert.equal(!!f.part.has[i], painted, `${f.face}: texel ${i}`);
      assert.equal(f.stray[i], 0, `${f.face}: no strays`);
    }
    assert.equal(f.straysMove, true, 'the band moves whole');
  }
});

test('a part over a body: a shared texel is in both pictures, and the body’s own texels are untouched by a move', () => {
  const views = stacked();
  const boxRect = { x0: 2, y0: 3, x1: 3, y1: 3 }; // the box, on the left face
  const top = liftFaces(views, 'left', boxRect, T).faces.find((f) => f.face === 'top');
  const has = (pic, x, y) => !!pic.has[y * T + x];
  assert.deepEqual([has(top.part, 3, 3), has(top.rest, 3, 3)], [true, true], 'both');
  assert.deepEqual(
    [has(top.part, 0, 3), has(top.rest, 0, 3)],
    [false, true],
    'the shelf'
  );
  assert.equal(top.straysMove, false, 'the rest has texels in the band');

  const sel = createFaceSelection(views, 'left', boxRect, T);
  assert.deepEqual(sel.faces, ['front', 'top']);
  assert.deepEqual(
    sel.moveTo(-2, 0),
    ['top'],
    'front sees the move along its own sight line'
  );
  const moved = sel.tile('top');
  assert.deepEqual(px(moved, 0, 2), [...COLORS.g, 255], 'the shelf alone stays put');
  assert.deepEqual(px(moved, 0, 3), [...COLORS.g, 255]);
  assert.deepEqual(px(moved, 3, 2), [...COLORS.g, 255], 'and where the box left it');
});

test('a part that comes out from under an overhang paints the color the model gave that surface', () => {
  const views = stacked();
  const m = modelOf(views);
  // The box's top-left voxel, hidden under the shelf at the lift.
  const want = faceColorAt(m, { x: 1, y: 0, z: 1 }, 'top');
  const sel = createFaceSelection(views, 'left', { x0: 2, y0: 3, x1: 3, y1: 3 }, T);
  sel.moveTo(-2, 0);
  assert.deepEqual(px(sel.tile('top'), 2, 0), [want.r, want.g, want.b, 255]);
});

test('a move along a face’s line of sight brings the part in front, moving no texel of that face', () => {
  const views = bars();
  const m = modelOf(views);
  const far = { x: 0, y: 0, z: 0 }; // bar A, behind bar B on the front face
  const want = faceColorAt(m, far, 'front');
  const sel = createFaceSelection(views, 'left', { x0: 3, y0: 3, x1: 3, y1: 3 }, T);
  const before = bytes(sel.tile('front'));
  sel.moveTo(-3, 0); // A onto B's cell: the part wins the tie
  const front = sel.tile('front');
  assert.deepEqual(
    [...front.data].map((_, i) => (i % 4 === 3 ? front.data[i] : 0)),
    before.map((_, i) => (i % 4 === 3 ? before[i] : 0)),
    'the silhouette holds still'
  );
  assert.deepEqual(px(front, 0, 3), [want.r, want.g, want.b, 255], 'the part shows');
  assert.deepEqual(px(front, 2, 3), [...COLORS.r, 255], 'where the part never reached');
});

test('a stray goes with a band that moves whole, and a part covers one it lands on', () => {
  const views = bars();
  const sel = createFaceSelection(views, 'left', { x0: 3, y0: 3, x1: 3, y1: 3 }, T);
  assert.deepEqual(
    px(sel.tile('top'), 0, 3),
    [...COLORS.b, 255],
    'the stray, at the start'
  );
  sel.moveTo(-3, 0);
  const top = sel.tile('top');
  assert.deepEqual(px(top, 0, 3), [0, 0, 0, 0], 'it left with the band');
  assert.deepEqual(px(top, 0, 0), [...COLORS.b, 255], 'and landed three rows on');
  assert.deepEqual(
    px(top, 1, 0),
    [...COLORS.r, 255],
    'the near bar keeps its own texels'
  );
  assert.deepEqual(px(top, 2, 0), [...COLORS.g, 255], 'the part takes the tie');
});

test('moveTo is a function of the offset: a move back to zero restores every face byte for byte', () => {
  const views = stacked();
  const sel = createFaceSelection(views, 'left', { x0: 2, y0: 3, x1: 3, y1: 3 }, T);
  const origin = Object.fromEntries(sel.faces.map((f) => [f, bytes(sel.tile(f))]));
  sel.moveTo(-1, 0);
  const once = bytes(sel.tile('top'));
  sel.moveTo(-2, 0);
  sel.moveTo(-1, 0);
  assert.deepEqual(bytes(sel.tile('top')), once, 'two moves equal one');
  sel.moveTo(0, 0);
  for (const f of sel.faces) assert.deepEqual(bytes(sel.tile(f)), origin[f], f);
});

test('clear leaves the rest alone, and a rectangle over clear texels selects nothing', () => {
  const views = stacked();
  const sel = createFaceSelection(views, 'left', { x0: 2, y0: 3, x1: 3, y1: 3 }, T);
  assert.deepEqual(sel.clear(), ['front'], 'not the face the shelf hides it on');
  assert.deepEqual(px(sel.tile('front'), 0, 3), [0, 0, 0, 0], 'the box is gone');
  assert.deepEqual(
    px(sel.tile('top'), 3, 3),
    [...COLORS.g, 255],
    'the shelf still needs it'
  );

  const empty = createFaceSelection(views, 'left', { x0: 0, y0: 0, x1: 1, y1: 0 }, T);
  assert.deepEqual(empty.moveTo(2, 2), [], 'nothing behind the rectangle');

  const all = createFaceSelection(
    views,
    'left',
    { x0: 0, y0: 0, x1: T - 1, y1: T - 1 },
    T
  );
  assert.deepEqual(all.clear().sort(), ['front', 'top']);
  assert.deepEqual(
    bytes(all.tile('top')),
    new Array(T * T * 4).fill(0),
    'every voxel was selected'
  );
});

test('a flip mirrors the part where the axis shows, and holds the picture still where it does not', () => {
  const views = stacked();
  const sel = createFaceSelection(
    views,
    'left',
    { x0: 0, y0: 0, x1: T - 1, y1: T - 1 },
    T
  );
  const front = bytes(sel.tile('front'));
  assert.deepEqual(sel.flip('horizontal'), ['top']);
  assert.deepEqual(bytes(sel.tile('front')), front, 'front looks along the flipped axis');
  assert.deepEqual(
    px(sel.tile('top'), 0, 0),
    [...COLORS.g, 255],
    'the shelf is forward now'
  );
  assert.deepEqual(px(sel.tile('top'), 0, 3), [0, 0, 0, 0]);
  assert.deepEqual(sel.flip('horizontal'), ['top'], 'and back');
  assert.deepEqual(bytes(sel.tile('top')), bytes(views.top));
});

test('the rule is the voxel move: carving the moved faces gives the old solid with the selected voxels moved', () => {
  const views = stacked();
  const rect = { x0: 2, y0: 3, x1: 3, y1: 3 };
  const before = modelOf(views);
  const sel = createFaceSelection(views, 'left', rect, T);
  sel.moveTo(-2, 0); // the box slides forward two, out from under the shelf

  // The edited face moves as the canvas moves it: lift the rectangle, clear the
  // hole, composite the float at the offset.
  const base = new Uint8ClampedArray(views.left.data);
  const float = liftRect(base, T, rect);
  clearRect(base, T, rect);
  const left = { width: T, height: T, data: new Uint8ClampedArray(T * T * 4) };
  compositeFloat(left.data, base, T, T, float, rect.x0 - 2, rect.y0);

  // The selected voxels are the ones at y=0, two steps forward along z.
  const after = modelOf({ left, front: sel.tile('front'), top: sel.tile('top') });
  assert.deepEqual(after.dims, before.dims);
  for (const c of cells(after.dims)) {
    const want =
      c.y === 0
        ? c.z >= 2 && before.solid[voxIndex(c.x, c.y, c.z - 2, before.dims)]
        : before.solid[voxIndex(c.x, c.y, c.z, before.dims)];
    assert.equal(
      !!after.solid[voxIndex(c.x, c.y, c.z, after.dims)],
      !!want,
      `${c.x},${c.y},${c.z}`
    );
  }
});

test('takePairs returns copies of the faces changed since the last take', () => {
  const views = stacked();
  const sel = createFaceSelection(views, 'left', { x0: 2, y0: 3, x1: 3, y1: 3 }, T);
  assert.deepEqual(sel.takePairs(), [], 'nothing has moved');
  sel.moveTo(-2, 0);
  const pairs = sel.takePairs();
  assert.deepEqual(
    pairs.map((p) => p.face),
    ['top']
  );
  assert.deepEqual(pairs[0].before, views.top, 'the tile as it was');
  assert.notEqual(pairs[0].after.data, sel.tile('top').data, 'a copy, not the buffer');
  assert.deepEqual(sel.takePairs(), [], 'nothing new since');
  sel.moveTo(0, 0);
  assert.deepEqual(
    sel.takePairs().map((p) => p.face),
    ['top'],
    'the move back is its own pair'
  );
});
