// Edge hints: for the face being edited, the neighbouring faces' texels along
// each shared edge, drawn one texel outside the draw canvas.
//
// EDGE_SEAMS is derived at load from VIEW_IMAGE_AXES. For view V and edge E:
//   1. E lies on V's column axis (left/right) or row axis (top/bottom), at index
//      0 (left/top) or max (right/bottom). V's flip gives the world end of that
//      axis and an outward sign.
//   2. The neighbour N is the face whose outward normal points that way.
//   3. The scan starts at V's facing extreme along V's depth axis, which N's
//      flip maps to the first or last row or column of N's tile.
//   4. The strip runs backwards when V and N flip differently on the shared
//      tangent axis.
//
// Each strip texel is the first painted texel walking inward from the seam. A
// neighbour with no art uses its opposite's tile mirrored along MIRROR_AXIS.
//
// A stroke on V never changes V's hint frame, since V's neighbours exclude V and
// its opposite.

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

// Hint band depth in texels on each side. sm-draw-canvas #layout reads it too.
export const EDGE_HINT = 1;

/** The four canvas edges, in the order the frame writes them. */
export const EDGE_NAMES = ['left', 'right', 'top', 'bottom'];

// VIEW_AXES dimension name -> FACE_NORMAL axis name.
const AXIS_OF = { nx: 'x', ny: 'y', nz: 'z' };
const DIMS = ['nx', 'ny', 'nz'];

/**
 * @typedef {object} Seam
 * @property {string} view     the neighbouring view
 * @property {'col'|'row'} line  the scan runs down a column or across a row
 * @property {'first'|'last'} from  the tile end at the seam, where the scan starts
 * @property {boolean} reverse  the strip runs against this edge's direction
 */

/** @returns {Seam} */
function seamFor(view, edge) {
  const vi = VIEW_IMAGE_AXES[view];
  const onCol = edge === 'left' || edge === 'right';
  const low = edge === 'left' || edge === 'top'; // image index 0
  // 1. The outward sign of this edge's world end.
  const edgeAxis = onCol ? vi.colAxis : vi.rowAxis;
  const edgeFlip = onCol ? vi.colFlip : vi.rowFlip;
  const sign = (low ? edgeFlip : !edgeFlip) ? 1 : -1;
  // 2. The neighbour whose outward normal points that way.
  const n = FACE_TO_VIEW[faceKeyOf(AXIS_OF[edgeAxis], sign)];
  const ni = VIEW_IMAGE_AXES[n];
  // 3. Scan start: V's facing extreme on its depth axis, in N's image.
  const [colAxis, rowAxis] = VIEW_AXES[view];
  const depth = DIMS.find((d) => d !== colAxis && d !== rowAxis);
  const facesHigh = FACE_NORMAL[VIEW_TO_FACE[view]][AXIS_INDEX[AXIS_OF[depth]]] > 0;
  const depthIsCol = ni.colAxis === depth;
  const depthFlip = depthIsCol ? ni.colFlip : ni.rowFlip;
  // 4. Direction along the seam.
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
 * Each view's four seams, derived at load.
 * @type {Record<string, Record<string, Seam>>}
 */
export const EDGE_SEAMS = Object.fromEntries(
  VIEW_NAMES.map((view) => [
    view,
    Object.fromEntries(EDGE_NAMES.map((edge) => [edge, seamFor(view, edge)])),
  ])
);

// A view's own tile, else its opposite's mirrored along MIRROR_AXIS, else null.
/** @returns {{width:number,height:number,data:ArrayLike<number>}|null} */
function effectiveTile(views, name) {
  const own = views?.[name] || null;
  if (own) return own;
  const opp = views?.[VIEW_OPPOSITE[name]] || null;
  // The cast widens MIRROR_AXIS's literal type so tsc accepts the 'y' comparison.
  const axis = /** @type {'x'|'y'} */ (MIRROR_AXIS);
  return opp ? flip(opp, axis === 'x', axis === 'y') : null;
}

// Write one strip: for each texel along the seam, the first painted texel
// walking inward. A non-square sheet can make the edge longer than the source
// line. Texels past the line stay transparent.
function writeStrip(out, frameW, tileW, tileH, edge, seam, views) {
  const src = effectiveTile(views, seam.view);
  if (!src) return;
  const { width: sw, height: sh, data } = src;
  const onCol = edge === 'left' || edge === 'right';
  const len = onCol ? tileH : tileW;
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
      if (data[s + 3] === 0) continue; // transparent: keep walking
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
 * The hint frame for one face: a (tileW + 2) x (tileH + 2) RGBA image. Each
 * edge holds the neighbour's first painted texels in from the shared seam. The
 * interior and the four corners are transparent.
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
