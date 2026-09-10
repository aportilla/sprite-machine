// ---------------------------------------------------------------------------
// EDGE HINTS — for the face being edited, the line of each NEIGHBOURING face's
// tile that lies against the lattice edge the two share. The editor draws them
// one texel deep just outside the draw canvas, on the canvas's own texel
// lattice, so the author can line a feature up across the seam: editing FRONT,
// the strip on the left edge is the RIGHT tile's front-most column, the strip
// above is the TOP tile's front row.
//
// NOTHING HERE IS AUTHORED. views.js publishes VIEW_IMAGE_AXES — for each view,
// which world axis its image columns and rows run along and whether the image
// index runs WITH the world coordinate or against it — probed from the
// projections at load so it cannot drift from them. EDGE_SEAMS is probed from
// that, the same way, so the twenty-four (view, edge) entries are a reading of
// the projection convention rather than a second copy of it.
//
// The derivation, for view V and edge E:
//   1. E sits on V's column axis (left/right) or its row axis (top/bottom), at
//      image index 0 (left/top) or max (right/bottom). Through V's flip that
//      names a world END of that axis, and so an outward sign.
//   2. The NEIGHBOUR is the face whose outward normal points that way —
//      faceKeyOf(axis, sign), read back as a view name.
//   3. N's plane spans V's DEPTH axis (the world axis V's image does not span)
//      and the axis running along the seam. The scan STARTS at V's own facing
//      extreme along the depth axis — max where V's normal is positive, 0
//      where it is negative — which through N's flip is the first or last row
//      or column of N's tile.
//   4. The strip runs BACKWARDS iff V's and N's flips on the shared tangent
//      axis differ.
//
// THE STRIP IS A FIRST HIT, not the tile's outermost line: from the seam it
// walks INWARD along the depth axis to the first painted texel, so editing
// FRONT the left strip is the front-most COLOURED pixel of the side art at
// each row — the nose profile — rather than whatever sits on the tile's edge.
// Sprites are drawn with margins inside their tiles (the built-in Car has one
// on every side), so the outermost line is almost always empty, and it is the
// wrong thing besides: registration is about the axis the two faces SHARE — a
// roof line at row y in the side view must be at row y in the front view —
// and how deep the evidence sits does not bear on it. This is the pipeline's
// own idiom, the depth-aware first hit colorize already colours faces by.
//
// The result is symmetric, as a cube's twelve edges make it: every entry pairs
// with the neighbour's entry pointing back, reversal included (test/edges).
//
// A neighbour with no art of its own contributes its MIRROR-DERIVED art — its
// opposite's tile through the one mirror implementation (ingest's flip, along
// MIRROR_AXIS), the same picture the onion-skin shows and the carve colours.
// With neither, the strip is transparent.
//
// Pure, no DOM: the frame comes back as plain RGBA the canvas puts down in one
// blit. It is CHANGE-CHANNEL state — a stroke on V can never move a strip,
// since V's four neighbours are the four faces other than V and its opposite,
// and that set is closed under VIEW_OPPOSITE.
// ---------------------------------------------------------------------------

import {
  VIEW_NAMES,
  VIEW_AXES,
  VIEW_IMAGE_AXES,
  VIEW_OPPOSITE,
  VIEW_TO_FACE,
  FACE_TO_VIEW,
  FACE_NORMAL,
  AXIS_INDEX,
  MIRROR_AXIS,
  faceKeyOf,
  flip,
} from 'sprite-machine';

// How deep the hint band is, in texels, on each side of the canvas. ONE: a
// seam is one lattice line, and the strip is that line. It is a constant so
// the frame's arithmetic here and the canvas's fit (sm-draw-canvas #layout)
// read the same number, not a setting — a deeper band would be a different
// feature, with a different rule for what fills it.
export const EDGE_HINT = 1;

/** The four canvas edges, in the order the frame writes them. */
export const EDGE_NAMES = ['left', 'right', 'top', 'bottom'];

// Grid-dimension name (VIEW_AXES' vocabulary) -> world axis name (FACE_NORMAL's).
const AXIS_OF = { nx: 'x', ny: 'y', nz: 'z' };
const DIMS = ['nx', 'ny', 'nz'];

/**
 * @typedef {object} Seam
 * @property {string} view     the neighbouring view's name
 * @property {'col'|'row'} line  the scan runs down a column or across a row
 * @property {'first'|'last'} from  the end of its tile the scan starts at — the
 *   seam — walking inward from there to the first painted texel
 * @property {boolean} reverse  the strip runs against this edge's own direction
 */

/** @returns {Seam} */
function seamFor(view, edge) {
  const vi = VIEW_IMAGE_AXES[view];
  const onCol = edge === 'left' || edge === 'right';
  const low = edge === 'left' || edge === 'top'; // the image index there is 0
  // 1. the world end this edge sits at, and so the outward sign.
  const edgeAxis = onCol ? vi.colAxis : vi.rowAxis;
  const edgeFlip = onCol ? vi.colFlip : vi.rowFlip;
  const sign = (low ? edgeFlip : !edgeFlip) ? 1 : -1;
  // 2. the neighbour: the face whose outward normal points that way.
  const n = FACE_TO_VIEW[faceKeyOf(AXIS_OF[edgeAxis], sign)];
  const ni = VIEW_IMAGE_AXES[n];
  // 3. where the scan starts: V's facing extreme along its depth axis, in N's image.
  const [colAxis, rowAxis] = VIEW_AXES[view];
  const depth = DIMS.find((d) => d !== colAxis && d !== rowAxis);
  const facesHigh = FACE_NORMAL[VIEW_TO_FACE[view]][AXIS_INDEX[AXIS_OF[depth]]] > 0;
  const depthIsCol = ni.colAxis === depth;
  const depthFlip = depthIsCol ? ni.colFlip : ni.rowFlip;
  // 4. the direction along the seam.
  const tangent = onCol ? vi.rowAxis : vi.colAxis;
  const vTanFlip = onCol ? vi.rowFlip : vi.colFlip;
  const nTanFlip = ni.colAxis === tangent ? ni.colFlip : ni.rowFlip;
  return {
    view: n,
    line: depthIsCol ? 'col' : 'row',
    from: facesHigh !== depthFlip ? 'last' : 'first',
    reverse: vTanFlip !== nTanFlip,
  };
}

/**
 * Every view's four seams, probed from the projection convention at load.
 * @type {Record<string, Record<string, Seam>>}
 */
export const EDGE_SEAMS = Object.fromEntries(
  VIEW_NAMES.map((view) => [
    view,
    Object.fromEntries(EDGE_NAMES.map((edge) => [edge, seamFor(view, edge)])),
  ])
);

// The art a neighbour actually shows: its own tile, else its opposite's
// mirrored (the ONE mirror implementation, ingest's flip along MIRROR_AXIS —
// the same picture derive.js paints behind the canvas), else nothing. A whole
// tile is mirrored to read one line of it; this runs on structural changes
// alone, four times at most, so the copy is cheaper than a second statement of
// the mirror rule.
/** @returns {{width:number,height:number,data:ArrayLike<number>}|null} */
function effectiveTile(views, name) {
  const own = views?.[name] || null;
  if (own) return own;
  const opp = views?.[VIEW_OPPOSITE[name]] || null;
  // The cast keeps the axis a variable: MIRROR_AXIS is 'x' for every pair, and
  // tsc narrows the constant to that literal, but the rule is the token's.
  const axis = /** @type {'x'|'y'} */ (MIRROR_AXIS);
  return opp ? flip(opp, axis === 'x', axis === 'y') : null;
}

// One strip into the frame's RGBA: per texel along the seam, the FIRST PAINTED
// texel walking in from it. Reads defensively — a sheared sheet (a dropped
// non-square one, which already warns) can put a tileH-long edge against a
// tileW-long line, and a texel with no line to read is simply left transparent.
function writeStrip(out, frameW, tileW, tileH, edge, seam, views) {
  const src = effectiveTile(views, seam.view);
  if (!src) return;
  const { width: sw, height: sh, data } = src;
  const onCol = edge === 'left' || edge === 'right';
  const len = onCol ? tileH : tileW;
  // The scan: down the line, from the seam end inward.
  const down = seam.line === 'col';
  const span = down ? sw : sh; // texels between the seam and the far side
  const start = seam.from === 'first' ? 0 : span - 1;
  const step = seam.from === 'first' ? 1 : -1;
  for (let i = 0; i < len; i++) {
    const t = seam.reverse ? len - 1 - i : i; // this texel's line, in N's image
    if (t >= (down ? sh : sw)) continue;
    for (let n = 0; n < span; n++) {
      const c = start + n * step;
      const s = ((down ? t * sw + c : c * sw + t) | 0) * 4;
      if (data[s + 3] === 0) continue; // transparent: keep walking inward
      const dx =
        edge === 'left' ? 0 : edge === 'right' ? tileW + EDGE_HINT : EDGE_HINT + i;
      const dy = onCol ? EDGE_HINT + i : edge === 'top' ? 0 : tileH + EDGE_HINT;
      const d = (dy * frameW + dx) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
      out[d + 3] = data[s + 3];
      break;
    }
  }
}

/**
 * The hint FRAME for one face: a (tileW + 2) x (tileH + 2) RGBA image, the art's
 * own area and the four corners transparent, each edge carrying the
 * neighbouring face's first painted texel in from their shared seam. A corner
 * is a lattice EDGE of the voxel box, shared by no single face, so there is
 * nothing honest to draw there.
 *
 * @param {Record<string, {width:number,height:number,data:ArrayLike<number>}|null>} views
 * @param {number} tileW
 * @param {number} tileH
 * @param {string} view  the face being edited
 * @returns {{width:number,height:number,data:Uint8ClampedArray}|null}
 */
export function edgeHintFrame(views, tileW, tileH, view) {
  const seams = EDGE_SEAMS[view];
  if (!seams || !(tileW > 0) || !(tileH > 0)) return null;
  const width = tileW + 2 * EDGE_HINT;
  const height = tileH + 2 * EDGE_HINT;
  const data = new Uint8ClampedArray(width * height * 4);
  for (const edge of EDGE_NAMES) {
    writeStrip(data, width, tileW, tileH, edge, seams[edge], views);
  }
  return { width, height, data };
}
