// A selection on all faces: the marquee on the edited face read as a box
// through the layer's lattice, and projected onto the layer's other faces.
//
// The geometry is derived from VIEW_IMAGE_AXES. Every face is an image of two
// world axes. The marquee fixes an interval on each of the edited view's two
// axes; its third, the axis it looks along, is unbounded. Each image axis of
// another face takes the box's interval on the world axis it runs along,
// reversed when the two faces run that axis the other way, and the whole tile
// on the edited view's depth axis. A move and a flip project the same way.
//
// liftFaces carves the layer once and splits its solid voxels in two: those
// behind the marquee (the part) and the rest. Each face with art of its own
// gets a picture of each — the nearest voxel of that class on each texel's line
// of sight, with its depth and color — and its strays, painted texels with no
// voxel behind them. A texel's color is its own bytes where its voxel was the
// nearest before the move, since that art was its own, and its picture's
// nearest color where it was hidden (fillBuried).
//
// At each offset the part's picture moves and each face is composited by depth:
// the nearer picture at a texel, the part on a tie, the strays where neither
// reaches. Depth is the distance from the face's viewer, so a move along a
// face's line of sight moves no texel there and only changes the part's depth.
//
// Square tiles and no view transform: the caller keeps documents off the
// drawing convention out (the checkbox is greyed for them).

import {
  VIEWS,
  VIEW_NAMES,
  VIEW_AXES,
  VIEW_IMAGE_AXES,
  VIEW_TO_FACE,
  FACE_AXIS,
  FACE_INDEX,
  FACE_NORMAL,
  AXIS_INDEX,
  buildVoxels,
  voxIndex,
} from 'sprite-machine';

/** @typedef {{x0:number,y0:number,x1:number,y1:number}} Bounds */
/** @typedef {{width:number,height:number,data:Uint8ClampedArray}} Tile */
/** An inclusive world interval per lattice axis. @typedef {Record<string, number[]>} Box */

const DIMS = ['nx', 'ny', 'nz'];
const DIM_OF = { x: 'nx', y: 'ny', z: 'nz' };

// An inclusive interval carried between a view's image indices and its world
// axis. The reversal is the same both ways.
const span = ([lo, hi], flip, n) => (flip ? [n - 1 - hi, n - 1 - lo] : [lo, hi]);

const packTexel = (data, i) =>
  (data[i * 4] |
    (data[i * 4 + 1] << 8) |
    (data[i * 4 + 2] << 16) |
    (data[i * 4 + 3] << 24)) >>>
  0;

/** The box a marquee on `view` cuts through the lattice. @returns {Box} */
function boxOf(view, bounds, dims) {
  const vi = VIEW_IMAGE_AXES[view];
  /** @type {Box} */
  const box = {};
  for (const d of DIMS) box[d] = [0, dims[d] - 1];
  box[vi.colAxis] = span([bounds.x0, bounds.x1], vi.colFlip, dims[vi.colAxis]);
  box[vi.rowAxis] = span([bounds.y0, bounds.y1], vi.rowFlip, dims[vi.rowAxis]);
  return box;
}

/** The box's rectangle in `onto`'s image. */
function boxOnto(box, onto, dims) {
  const oi = VIEW_IMAGE_AXES[onto];
  const [x0, x1] = span(box[oi.colAxis], oi.colFlip, dims[oi.colAxis]);
  const [y0, y1] = span(box[oi.rowAxis], oi.rowFlip, dims[oi.rowAxis]);
  return { x0, y0, x1, y1 };
}

// -0 would show up in a projected delta and in an assertion.
const neg = (n) => -n || 0;

/** The world delta of a move on `view`, one entry per lattice axis. */
function worldDelta(view, dx, dy) {
  const vi = VIEW_IMAGE_AXES[view];
  const d = { nx: 0, ny: 0, nz: 0 };
  d[vi.colAxis] = vi.colFlip ? neg(dx) : dx;
  d[vi.rowAxis] = vi.rowFlip ? neg(dy) : dy;
  return d;
}

/**
 * The marquee's rectangle on another face, inclusive. A neighbour's spans the
 * whole tile on the edited view's depth axis. Bounds off the tile project off
 * it.
 * @param {string} view  the edited face
 * @param {Bounds} bounds  @param {string} onto  @param {number} t  tile size
 * @returns {Bounds}
 */
export function projectBounds(view, bounds, onto, t) {
  const dims = { nx: t, ny: t, nz: t };
  return boxOnto(boxOf(view, bounds, dims), onto, dims);
}

/**
 * A move on `view` as a move on another face. It is zero along that face's line
 * of sight.
 * @param {string} view  @param {number} dx  @param {number} dy  @param {string} onto
 * @returns {{dx:number, dy:number}}
 */
export function projectDelta(view, dx, dy, onto) {
  const w = worldDelta(view, dx, dy);
  const oi = VIEW_IMAGE_AXES[onto];
  return {
    dx: oi.colFlip ? neg(w[oi.colAxis]) : w[oi.colAxis],
    dy: oi.rowFlip ? neg(w[oi.rowAxis]) : w[oi.rowAxis],
  };
}

/**
 * A flip on `view` as a flip on another face, or null for the two faces that
 * look along the flipped axis.
 * @param {string} view  @param {'horizontal'|'vertical'} axis  @param {string} onto
 * @returns {'horizontal'|'vertical'|null}
 */
export function projectFlip(view, axis, onto) {
  const vi = VIEW_IMAGE_AXES[view];
  const dim = axis === 'horizontal' ? vi.colAxis : vi.rowAxis;
  const oi = VIEW_IMAGE_AXES[onto];
  if (oi.colAxis === dim) return 'horizontal';
  if (oi.rowAxis === dim) return 'vertical';
  return null;
}

// How a face sees the lattice: the world axis it looks along, the sign of its
// outward normal and the far end of that axis. Depth counts from the viewer.
function lookOf(onto, dims) {
  const key = VIEW_TO_FACE[onto];
  const axis = FACE_AXIS[key];
  return {
    axis,
    sign: FACE_NORMAL[key][AXIS_INDEX[axis]],
    far: dims[DIM_OF[axis]] - 1,
  };
}

const depthAt = (look, c) => (look.sign > 0 ? look.far - c : c);

const picture = (n) => ({
  has: new Uint8Array(n),
  depth: new Int32Array(n),
  color: new Uint32Array(n),
});

const NEIGHBORS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// A surface that was hidden has no art of its own: the texel's bytes belong to
// whatever hid it, so keeping them would leave a copy of that behind when it
// moves away. It takes the nearest color in its own picture instead. `own`
// marks the texels whose art was this picture's; a clear one never spreads, and
// a hidden texel no color reaches keeps its bytes.
function fillBuried(pic, own, t) {
  let ring = [];
  for (let i = 0; i < own.length; i++) {
    if (own[i] && pic.color[i] >>> 24 !== 0) ring.push(i);
  }
  while (ring.length) {
    const next = [];
    for (const i of ring) {
      const x = i % t;
      const y = (i - x) / t;
      for (const [dx, dy] of NEIGHBORS4) {
        const ax = x + dx;
        const ay = y + dy;
        if (ax < 0 || ay < 0 || ax >= t || ay >= t) continue;
        const j = ay * t + ax;
        if (!pic.has[j] || own[j]) continue;
        pic.color[j] = pic.color[i];
        own[j] = 1;
        next.push(j);
      }
    }
    ring = next;
  }
}

// One face's two pictures, its strays and its band.
function liftFace(onto, tile, model, box, t) {
  const { dims, solid, selected } = model;
  const spec = VIEWS[onto];
  const look = lookOf(onto, dims);
  const n = t * t;
  const part = picture(n);
  const rest = picture(n);
  const p = { u: 0, v: 0 };
  for (let z = 0; z < dims.nz; z++) {
    for (let y = 0; y < dims.ny; y++) {
      for (let x = 0; x < dims.nx; x++) {
        const idx = voxIndex(x, y, z, dims);
        if (!solid[idx]) continue;
        spec.projectInto(x, y, z, dims, p);
        const i = p.v * t + p.u;
        const d = depthAt(look, look.axis === 'x' ? x : look.axis === 'y' ? y : z);
        const pic = selected[idx] ? part : rest;
        if (pic.has[i] && d >= pic.depth[i]) continue;
        pic.has[i] = 1;
        pic.depth[i] = d;
      }
    }
  }

  // The art at a texel was its nearest voxel's, so only that picture owns it.
  // The other's surface there was never drawn — the texel's bytes belong to
  // whatever hid it — so fillBuried gives it the nearest color in its own
  // picture.
  const origin = new Uint8ClampedArray(tile.data.subarray(0, n * 4));
  const partOwn = new Uint8Array(n);
  const restOwn = new Uint8Array(n);
  const stray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!part.has[i] && !rest.has[i]) {
      if (origin[i * 4 + 3] !== 0) stray[i] = 1;
      continue;
    }
    const near = Math.min(
      part.has[i] ? part.depth[i] : Infinity,
      rest.has[i] ? rest.depth[i] : Infinity
    );
    if (part.has[i]) {
      part.color[i] = packTexel(origin, i);
      if (part.depth[i] === near) partOwn[i] = 1;
    }
    if (rest.has[i]) {
      rest.color[i] = packTexel(origin, i);
      if (rest.depth[i] === near) restOwn[i] = 1;
    }
  }
  fillBuried(part, partOwn, t);
  fillBuried(rest, restOwn, t);

  // The strays go with the band only when it moves whole, which is when the
  // rest has no texel in it.
  const band = boxOnto(box, onto, dims);
  let straysMove = true;
  for (let y = Math.max(0, band.y0); y <= Math.min(t - 1, band.y1); y++) {
    for (let x = Math.max(0, band.x0); x <= Math.min(t - 1, band.x1); x++) {
      if (rest.has[y * t + x]) straysMove = false;
    }
  }
  return { face: onto, part, rest, stray, origin, band, straysMove, look };
}

/**
 * Carve the layer and split it at the marquee: the solid voxels behind the
 * rectangle, and the rest. Each face with art of its own, the edited face
 * aside, gets its two pictures (§2.2 of the plan). A face with none is
 * mirror-derived and stays derived.
 * @param {Record<string, Tile|null>} views  one layer's six tiles
 * @param {string} view  the edited face
 * @param {Bounds} bounds  the marquee at its lift origin, inside the tile
 * @param {number} t  the tile size
 */
export function liftFaces(views, view, bounds, t) {
  const raw = Object.fromEntries(VIEW_NAMES.map((n) => [n, views?.[n] || null]));
  const { dims, solid } = buildVoxels(raw);
  const box = boxOf(view, bounds, dims);
  const selected = new Uint8Array(solid.length);
  const lo = (d) => Math.max(0, box[d][0]);
  const hi = (d) => Math.min(dims[d] - 1, box[d][1]);
  for (let z = lo('nz'); z <= hi('nz'); z++) {
    for (let y = lo('ny'); y <= hi('ny'); y++) {
      for (let x = lo('nx'); x <= hi('nx'); x++) {
        const i = voxIndex(x, y, z, dims);
        if (solid[i]) selected[i] = 1;
      }
    }
  }
  const model = { dims, solid, selected };
  const faces = VIEW_NAMES.filter((n) => n !== view && views?.[n]).map((onto) =>
    liftFace(onto, views[onto], model, box, t)
  );
  return { dims, solid, selected, box, faces };
}

/**
 * A lifted selection over the layer's other faces. The verbs mirror the
 * canvas's, and each returns the faces whose tile changed. `tile` is handed to
 * doc.applyTileEdit by reference, as the canvas's working buffer is.
 * @param {Record<string, Tile|null>} views  @param {string} view
 * @param {Bounds} bounds  @param {number} t
 */
export function createFaceSelection(views, view, bounds, t) {
  const lift = liftFaces(views, view, bounds, t);
  const n = t * t;
  const faces = lift.faces.map((f) => ({
    ...f,
    tile: { width: t, height: t, data: new Uint8ClampedArray(f.origin) },
    // The bytes as last committed, for takePairs.
    base: new Uint8ClampedArray(f.origin),
    px: new Uint32Array(n),
    covered: new Uint8Array(n),
  }));
  let offset = { dx: 0, dy: 0 };
  let flipX = false;
  let flipY = false;
  let cleared = false;

  // The part's picture in `f`'s image: the projected move, and a mirror on each
  // image axis an active flip reaches.
  const mirrors = (onto, axis) =>
    (flipX && projectFlip(view, 'horizontal', onto) === axis) ||
    (flipY && projectFlip(view, 'vertical', onto) === axis);

  function moveOf(f) {
    const { dx, dy } = projectDelta(view, offset.dx, offset.dy, f.face);
    const vi = VIEW_IMAGE_AXES[view];
    const dim = DIM_OF[f.look.axis];
    const [c0, c1] = lift.box[dim];
    const world = worldDelta(view, offset.dx, offset.dy);
    return {
      dx,
      dy,
      mx: mirrors(f.face, 'horizontal'),
      my: mirrors(f.face, 'vertical'),
      // A flip along the face's line of sight leaves its picture and mirrors
      // the part's depths within the box.
      deep: (flipX && vi.colAxis === dim) || (flipY && vi.rowAxis === dim),
      sum: depthAt(f.look, c0) + depthAt(f.look, c1),
      shift: f.look.sign > 0 ? neg(world[dim]) : world[dim],
    };
  }

  // Composite one face and write it into its tile. Returns whether a byte
  // changed.
  function paint(f) {
    const { part, rest, stray, origin, band } = f;
    const px = f.px.fill(0);
    const covered = f.covered.fill(0);
    const m = moveOf(f);
    const mirrorX = band.x0 + band.x1;
    const mirrorY = band.y0 + band.y1;
    for (let y = 0; y < t; y++) {
      for (let x = 0; x < t; x++) {
        const i = y * t + x;
        let hasPart = false;
        let pDepth = 0;
        let pColor = 0;
        if (!cleared) {
          const bx = x - m.dx;
          const by = y - m.dy;
          const sx = m.mx ? mirrorX - bx : bx;
          const sy = m.my ? mirrorY - by : by;
          if (sx >= 0 && sy >= 0 && sx < t && sy < t && part.has[sy * t + sx]) {
            const j = sy * t + sx;
            hasPart = true;
            pColor = part.color[j];
            pDepth = (m.deep ? m.sum - part.depth[j] : part.depth[j]) + m.shift;
          }
        }
        if (hasPart && (!rest.has[i] || pDepth <= rest.depth[i])) {
          px[i] = pColor;
          covered[i] = 1;
        } else if (rest.has[i]) {
          px[i] = rest.color[i];
          covered[i] = 1;
        }
      }
    }
    // Strays where neither picture reaches. Those in a band that moves whole go
    // with it, over any that stayed.
    const moving = !cleared && f.straysMove;
    const inBand = (x, y) => x >= band.x0 && x <= band.x1 && y >= band.y0 && y <= band.y1;
    for (let y = 0; y < t; y++) {
      for (let x = 0; x < t; x++) {
        const i = y * t + x;
        if (!stray[i] || (moving && inBand(x, y)) || covered[i]) continue;
        px[i] = packTexel(origin, i);
      }
    }
    if (moving) {
      for (let y = Math.max(0, band.y0); y <= Math.min(t - 1, band.y1); y++) {
        for (let x = Math.max(0, band.x0); x <= Math.min(t - 1, band.x1); x++) {
          if (!stray[y * t + x]) continue;
          const dx = (m.mx ? mirrorX - x : x) + m.dx;
          const dy = (m.my ? mirrorY - y : y) + m.dy;
          if (dx < 0 || dy < 0 || dx >= t || dy >= t || covered[dy * t + dx]) continue;
          px[dy * t + dx] = packTexel(origin, y * t + x);
        }
      }
    }
    let changed = false;
    const out = f.tile.data;
    for (let i = 0; i < n; i++) {
      const c = px[i];
      const j = i * 4;
      const r = c & 255;
      const g = (c >>> 8) & 255;
      const b = (c >>> 16) & 255;
      const a = (c >>> 24) & 255;
      if (out[j] === r && out[j + 1] === g && out[j + 2] === b && out[j + 3] === a)
        continue;
      out[j] = r;
      out[j + 1] = g;
      out[j + 2] = b;
      out[j + 3] = a;
      changed = true;
    }
    return changed;
  }

  const repaint = () => faces.filter((f) => paint(f)).map((f) => f.face);

  return {
    /** The faces this selection writes, the edited face aside. */
    faces: faces.map((f) => f.face),

    /** The part at an absolute offset on the edited face. */
    moveTo(dx, dy) {
      offset = { dx, dy };
      return repaint();
    },

    /** Mirror the part within the box. @param {'horizontal'|'vertical'} axis */
    flip(axis) {
      if (axis === 'horizontal') flipX = !flipX;
      else flipY = !flipY;
      return repaint();
    },

    /** Drop the part: every face shows the rest alone, and its strays. */
    clear() {
      cleared = true;
      return repaint();
    },

    /** One face's working tile, held by reference. @param {string} face */
    tile(face) {
      return faces.find((f) => f.face === face)?.tile ?? null;
    },

    /** The faces changed since the last take, as copies. */
    takePairs() {
      const pairs = [];
      for (const f of faces) {
        if (f.base.every((v, i) => v === f.tile.data[i])) continue;
        pairs.push({
          face: f.face,
          before: { width: t, height: t, data: new Uint8ClampedArray(f.base) },
          after: { width: t, height: t, data: new Uint8ClampedArray(f.tile.data) },
        });
        f.base.set(f.tile.data);
      }
      return pairs;
    },
  };
}
