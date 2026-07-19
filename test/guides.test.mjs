// Node-runnable tests for the editor alignment guides (pure, no THREE/DOM).
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { faceGuides } from '../src/lib/guides.js';
import { VIEW_IMAGE_AXES, VIEWS, VIEW_AXES } from '../src/lib/views.js';

// tiny sprite builder: rows of chars -> ImageData-like (any non-'.' is opaque).
function img(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (rows[y][x] !== '.') data[(y * w + x) * 4 + 3] = 255;
  return { width: w, height: h, data };
}

// VIEW_IMAGE_AXES is probed from project(); pin it so it can't silently drift.
test('VIEW_IMAGE_AXES agrees with the projections it is probed from', () => {
  const d = { nx: 2, ny: 2, nz: 2 };
  const ARG = { nx: 0, ny: 1, nz: 2 };
  for (const name of Object.keys(VIEWS)) {
    const ia = VIEW_IMAGE_AXES[name];
    const [colAxis, rowAxis] = VIEW_AXES[name];
    assert.equal(ia.colAxis, colAxis, `${name} colAxis`);
    assert.equal(ia.rowAxis, rowAxis, `${name} rowAxis`);
    const idx = (axis, coord, which) => {
      const p = [0, 0, 0];
      p[ARG[axis]] = coord;
      return VIEWS[name].project(p[0], p[1], p[2], d)[which];
    };
    assert.equal(ia.colFlip, idx(colAxis, 0, 'u') > idx(colAxis, 1, 'u'));
    assert.equal(ia.rowFlip, idx(rowAxis, 0, 'v') > idx(rowAxis, 1, 'v'));
  }
});

// Spot-check the well-known orientations the guides rely on.
test('VIEW_IMAGE_AXES: front/top orientations', () => {
  assert.deepEqual(VIEW_IMAGE_AXES.front, {
    colAxis: 'nx',
    colFlip: false,
    rowAxis: 'ny',
    rowFlip: true,
  });
  assert.deepEqual(VIEW_IMAGE_AXES.top, {
    colAxis: 'nx',
    colFlip: false,
    rowAxis: 'nz',
    rowFlip: true,
  });
});

// Editing FRONT: TOP/BOTTOM constrain columns (X), LEFT/RIGHT constrain rows (Y).
test('faceGuides(front): top sets the column extent, side sets the row extent', () => {
  const views = {
    top: img(['.T.', '.T.', '.T.']), // content only in column x=1
    right: img(['...', '...', 'NNN']), // content only in world y=0 (bottom row)
  };
  const g = faceGuides(views, 'front', 3, 3);
  // TOP's single column x=1 -> front column 1 supported (identity on X).
  assert.deepEqual([...g.colSupport], [0, 1, 0]);
  assert.equal(g.extent.uMin, 1);
  assert.equal(g.extent.uMax, 1);
  // SIDE's world y=0 lands on front's BOTTOM image row (v=2).
  assert.deepEqual([...g.rowSupport], [0, 0, 1]);
  assert.equal(g.extent.vMin, 2);
  assert.equal(g.extent.vMax, 2);
});

// An axis with no constraining view drawn yields null support (no hairlines).
test('faceGuides: an unconstrained axis reports null (nothing to draw)', () => {
  const g = faceGuides({ top: img(['TTT', 'TTT', 'TTT']) }, 'front', 3, 3);
  assert.notEqual(g.colSupport, null); // top constrains columns
  assert.equal(g.rowSupport, null); // no left/right -> rows unconstrained
  assert.equal(g.extent.vMin, null);
  assert.equal(g.extent.vMax, null);
});

// Editing TOP: cols run along X (nx, identity — colFlip:false); rows run along Z
// (nz, rowFlip:true). FRONT/BACK constrain columns, LEFT/RIGHT constrain rows.
// The rowFlip on nz is the whole point of this case: RIGHT content near the
// image's LEFT column (nz=0) must land on TOP's BOTTOM row (v=2), not its top.
test('faceGuides(top): front sets the column extent, right sets the (flipped) row extent', () => {
  const views = {
    front: img(['F..', 'F..', 'F..']), // content only in image col u=0 -> world x=0
    right: img(['R..', 'R..', 'R..']), // content only in image col u=0 -> world z=0
  };
  const g = faceGuides(views, 'top', 3, 3);
  // FRONT's col u=0 is world x=0; TOP's cols are identity on X -> col 0.
  assert.deepEqual([...g.colSupport], [1, 0, 0]);
  assert.equal(g.extent.uMin, 0);
  assert.equal(g.extent.uMax, 0);
  // RIGHT's col u=0 is world z=0; TOP's rows are FLIPPED on Z -> world z=0 = row 2.
  assert.deepEqual([...g.rowSupport], [0, 0, 1]);
  assert.equal(g.extent.vMin, 2);
  assert.equal(g.extent.vMax, 2);
});

// Sibling occupancy at the OTHER end must map to the opposite edge — a mirror of
// the case above, so a dropped/incorrect flip on either axis cannot pass both.
test('faceGuides(top): opposite-corner siblings land on the opposite edges', () => {
  const views = {
    front: img(['..F', '..F', '..F']), // world x=2
    right: img(['..R', '..R', '..R']), // world z=2
  };
  const g = faceGuides(views, 'top', 3, 3);
  assert.deepEqual([...g.colSupport], [0, 0, 1]); // x=2 -> col 2 (identity)
  assert.deepEqual([...g.rowSupport], [1, 0, 0]); // z=2 -> row 0 (flipped)
  assert.deepEqual(g.extent, { uMin: 2, uMax: 2, vMin: 0, vMax: 0 });
});

// Editing RIGHT: cols run along Z (nz, colFlip:false) and are constrained by
// TOP/BOTTOM; rows run along Y (ny, rowFlip:true) and are constrained by
// FRONT/BACK. TOP's OWN cols are X, so TOP constrains RIGHT's Z-columns through
// TOP's ROWS (top rowAxis=nz, rowFlip:true) — a two-step flip that a sign error
// on either the top-view probe or the edited-face mapping would disturb.
test('faceGuides(right): top sets the column extent, front sets the (flipped) row extent', () => {
  const views = {
    top: img(['TTT', '...', '...']), // top image row v=0 -> world z=2
    front: img(['FFF', '...', '...']), // front image row v=0 -> world y=2
  };
  const g = faceGuides(views, 'right', 3, 3);
  // TOP row v=0 is world z=2; RIGHT's cols are identity on Z -> col 2.
  assert.deepEqual([...g.colSupport], [0, 0, 1]);
  assert.equal(g.extent.uMin, 2);
  assert.equal(g.extent.uMax, 2);
  // FRONT row v=0 is world y=2; RIGHT's rows are FLIPPED on Y -> world y=2 = row 0.
  assert.deepEqual([...g.rowSupport], [1, 0, 0]);
  assert.equal(g.extent.vMin, 0);
  assert.equal(g.extent.vMax, 0);
});

// Mirror of the RIGHT case: sibling content at the far end must reach the far
// edge on both axes (top bottom-row -> world z=0 -> col 0; front bottom-row ->
// world y=0 -> row 2).
test('faceGuides(right): far-end siblings land on the opposite edges', () => {
  const views = {
    top: img(['...', '...', 'TTT']), // top row v=2 -> world z=0
    front: img(['...', '...', 'FFF']), // front row v=2 -> world y=0
  };
  const g = faceGuides(views, 'right', 3, 3);
  assert.deepEqual([...g.colSupport], [1, 0, 0]); // z=0 -> col 0
  assert.deepEqual([...g.rowSupport], [0, 0, 1]); // y=0 -> row 2 (flipped)
  assert.deepEqual(g.extent, { uMin: 0, uMax: 0, vMin: 2, vMax: 2 });
});

// Both siblings on a plane present with DIFFERING extents -> the support is their
// UNION in the edited face's frame. Editing TOP, columns are constrained by BOTH
// front (nx, colFlip:false) and back (nx, colFlip:true): front's u=0 is world x=0
// but back's u=0 is world x=2, so opposite image edges map to opposite TOP columns
// and the union spans both ends with the middle left unsupported.
test('faceGuides(top): both column siblings union (front + back, opposite flips)', () => {
  const views = {
    front: img(['F..', 'F..', 'F..']), // world x=0 (front colFlip:false)
    back: img(['B..', 'B..', 'B..']), // world x=2 (back colFlip:true)
  };
  const g = faceGuides(views, 'top', 3, 3);
  assert.deepEqual([...g.colSupport], [1, 0, 1]); // union of {0} and {2}
  assert.equal(g.extent.uMin, 0);
  assert.equal(g.extent.uMax, 2);
  // Neither front nor back constrains TOP's rows (they touch cols only).
  assert.equal(g.rowSupport, null);
  assert.equal(g.extent.vMin, null);
  assert.equal(g.extent.vMax, null);
});

// Union again on the ROW axis, editing RIGHT: rows come from BOTH front and back
// (ny, rowFlip:true each). front bottom-row -> world y=0 -> row 2; back top-row ->
// world y=2 -> row 0. The union covers both ends; a lone sibling would cover only
// one. (Columns unconstrained here: no top/bottom given.)
test('faceGuides(right): both row siblings union (front + back)', () => {
  const views = {
    front: img(['...', '...', 'FFF']), // world y=0 -> row 2
    back: img(['BBB', '...', '...']), // world y=2 -> row 0
  };
  const g = faceGuides(views, 'right', 3, 3);
  assert.deepEqual([...g.rowSupport], [1, 0, 1]); // union of {2} and {0}
  assert.equal(g.extent.vMin, 0);
  assert.equal(g.extent.vMax, 2);
  assert.equal(g.colSupport, null); // no top/bottom -> columns unconstrained
  assert.equal(g.extent.uMin, null);
  assert.equal(g.extent.uMax, null);
});

// A partially-overlapping union: extents that share an index still merge (not
// replace). front covers world y {0,1} (rows {2,1}); back covers world y {2}
// (row {0}) -> all three rows set, proving the second sibling ORs into the first.
test('faceGuides(right): overlapping row siblings OR together to fill the extent', () => {
  const views = {
    front: img(['...', 'FFF', 'FFF']), // world y=1,0 -> rows 1,2
    back: img(['BBB', '...', '...']), // world y=2 -> row 0
  };
  const g = faceGuides(views, 'right', 3, 3);
  assert.deepEqual([...g.rowSupport], [1, 1, 1]);
  assert.equal(g.extent.vMin, 0);
  assert.equal(g.extent.vMax, 2);
});
