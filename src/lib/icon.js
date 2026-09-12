// ---------------------------------------------------------------------------
// The document icon's rules — PURE (no THREE, no DOM, Node-tested): the pose
// a document's 32×32 desktop art is rendered from, the ORTHOGRAPHIC FIT that
// sizes it, and the two raster passes that make the render an icon — the
// supersample's box filter and the outline's ink. scene/icon-renderer.js is
// the consumer.
//
// THE FRAME IS THE MODEL'S, NOT THE LATTICE'S — the one place this parts
// company with the 3D Sprite Atlas (lib/ring.js), and deliberately. A ring
// frame fits the whole voxel box at every yaw, because a sprite must not
// jitter through an animation; an icon is one still of one document, and what
// it owes is legibility at 32 px. So the fit is the TIGHT projected bounding
// box of the geometry the mesher actually produced: a two-voxel cube painted
// in the middle of a 64 tile fills its icon exactly as a 64-voxel ship does,
// and the tile size never enters it.
//
// THE POSE is a three-quarter view from higher up — 35° round from the
// front, so the FRONT, RIGHT and TOP faces all show with the front the
// larger (the user's call, Sep 11 2026, over the 3D View's own 45°, where
// the two flanks came out even), and 45° above the horizon (the stage's
// default framing is 29.5° up). The direction and up vectors themselves are
// the ring's (ringCameraDir / ringCameraUp): one orthographic camera
// convention on the machine.
//
// SMOOTH INSIDE, INKED OUTSIDE (the user's call, Sep 11 2026, over the hard
// point-sampled buffer of the same day). The model is rendered SUPERSAMPLED
// — ICON_SUPERSAMPLE px per icon px on each axis — and box-filtered down, so
// the geometry's own edges (face against face, a wedge's slope, a one-voxel
// detail) land as coverage rather than as a point sample's hit or miss. Then
// the silhouette is inked as a System 7 icon's is: every pixel the model
// covers by half or more is OPAQUE in its own color — the edge is hard, an
// icon's idiom — and a one-pixel BLACK ring runs around that coverage, so
// the art reads as an object on any desktop pattern. The ring lies OUTSIDE
// the model, so the fit leaves it room: the model spans the icon less
// ICON_OUTLINE on every side (framedHalf).
// ---------------------------------------------------------------------------

/** The icon resource's edge in px — the kit's `large` vf-icon cell. */
export const ICON_SIZE = 32;
/** The pose, in degrees: 35° round from the front, 45° above the horizon. */
export const ICON_YAW = 35;
export const ICON_ELEV = 45;
/** Samples per icon px on each axis: the render is this many times the
 * icon's size, and `downsample` folds every ICON_SUPERSAMPLE² block into
 * one pixel. */
export const ICON_SUPERSAMPLE = 3;
/** The outline's width in icon px — the margin the fit leaves outside the
 * model on every side, since the ring `inkOutline` draws lies outside the
 * model's coverage and has to land inside the icon. */
export const ICON_OUTLINE = 1;

/**
 * The half-extent the camera frames for a model whose tight fit is `half`:
 * the model spans the icon less its outline margin on each side, and the
 * margin is what the ring is drawn into.
 * @param {number} half  the model's projected half-extent (orthoFit's)
 * @returns {number}
 */
export const framedHalf = (half) => (half * ICON_SIZE) / (ICON_SIZE - 2 * ICON_OUTLINE);

/** @typedef {[number, number, number]} Vec3 */

/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** @param {Vec3} v @returns {Vec3} */
const unit = (v) => {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
};

/**
 * The tight orthographic fit of a point cloud for a camera pose: where the
 * camera looks, the half-extent that SQUARES the projected bounding box
 * around it (the larger of the two spans, so the frame stays square and the
 * smaller axis takes the margin), and the cloud's depth along the view axis,
 * which the caller brackets its near and far planes by.
 *
 * The screen basis is the one `lookAt` builds from the same two vectors —
 * right = up × dir, screen-up = dir × right — so a camera posed at the
 * returned center with this `dir` and `up`, and a frustum of ±half, frames
 * exactly these points.
 *
 * @param {ArrayLike<number>} positions  xyz triples (a geometry's position
 *   attribute, in world coordinates)
 * @param {Vec3} dir  unit, from the subject OUT to the camera
 * @param {Vec3} up  unit, the camera's screen-up (perpendicular to `dir`)
 * @returns {{center: Vec3, half: number, depth: number}|null}  null for an
 *   empty cloud (no point to frame)
 */
export function orthoFit(positions, dir, up) {
  const n = positions?.length ?? 0;
  if (n < 3) return null;
  const right = unit(cross(up, dir));
  const sup = cross(dir, right);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  let minW = Infinity;
  let maxW = -Infinity;
  for (let i = 0; i + 2 < n; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const u = x * right[0] + y * right[1] + z * right[2];
    const v = x * sup[0] + y * sup[1] + z * sup[2];
    const w = x * dir[0] + y * dir[1] + z * dir[2];
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
    if (w < minW) minW = w;
    if (w > maxW) maxW = w;
  }
  const cu = (minU + maxU) / 2;
  const cv = (minV + maxV) / 2;
  const cw = (minW + maxW) / 2;
  return {
    center: [
      cu * right[0] + cv * sup[0] + cw * dir[0],
      cu * right[1] + cv * sup[1] + cw * dir[1],
      cu * right[2] + cv * sup[2] + cw * dir[2],
    ],
    // Floored off zero: a degenerate cloud (one point, a flat plane seen
    // edge-on) would otherwise hand the camera an empty frustum.
    half: Math.max((maxU - minU) / 2, (maxV - minV) / 2, 1e-6),
    depth: maxW - minW,
  };
}

/**
 * Box-filter an RGBA raster down by an integer factor: each output pixel is
 * its factor×factor block of samples folded into one, PREMULTIPLIED — the
 * color is the mean of the covered samples' colors alone, weighted by their
 * alpha (a clear sample has no color to lend, only its absence), and the
 * alpha is the block's mean coverage. A straight mean would drag every edge
 * toward the clear samples' black.
 *
 * @param {ArrayLike<number>} src  RGBA bytes, straight alpha, row-major
 * @param {number} width  of `src`, a multiple of `factor`
 * @param {number} height  of `src`, a multiple of `factor`
 * @param {number} factor  samples per output px on each axis (≥ 1)
 * @returns {Uint8ClampedArray}  RGBA bytes, (width/factor)×(height/factor)
 */
export function downsample(src, width, height, factor) {
  const f = Math.max(1, Math.floor(factor));
  const w = Math.floor(width / f);
  const h = Math.floor(height / f);
  const out = new Uint8ClampedArray(w * h * 4);
  const n = f * f;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < f; sy++) {
        let i = ((y * f + sy) * width + x * f) * 4;
        for (let sx = 0; sx < f; sx++, i += 4) {
          const sa = src[i + 3];
          if (!sa) continue;
          r += src[i] * sa;
          g += src[i + 1] * sa;
          b += src[i + 2] * sa;
          a += sa;
        }
      }
      if (!a) continue; // clear, as the buffer came
      const o = (y * w + x) * 4;
      out[o] = r / a;
      out[o + 1] = g / a;
      out[o + 2] = b / a;
      out[o + 3] = a / n;
    }
  }
  return out;
}

/** The coverage a pixel needs to count as the model's: half. */
const COVERED = 128;

/**
 * Ink the icon's outline. Every pixel the model covers by half or more goes
 * OPAQUE in its own color — the silhouette is hard, as an icon's is; every
 * clear pixel with a covered one beside it (four-connected, so a diagonal
 * edge is the thin line a 1-bit icon draws, not a stair of blocks) goes
 * BLACK — the ring; and everything else goes clear, including a sliver the
 * model covers by less than half, which no ring is drawn around either. The
 * result is a raster with no partial pixel: opaque or clear.
 *
 * @param {ArrayLike<number>} rgba  RGBA bytes, straight alpha, row-major
 * @param {number} width
 * @param {number} height
 * @returns {Uint8ClampedArray}  a new RGBA raster of the same size
 */
export function inkOutline(rgba, width, height) {
  const out = new Uint8ClampedArray(width * height * 4);
  const covered = (x, y) =>
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height &&
    rgba[(y * width + x) * 4 + 3] >= COVERED;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (covered(x, y)) {
        out[o] = rgba[o];
        out[o + 1] = rgba[o + 1];
        out[o + 2] = rgba[o + 2];
        out[o + 3] = 255;
      } else if (
        covered(x - 1, y) ||
        covered(x + 1, y) ||
        covered(x, y - 1) ||
        covered(x, y + 1)
      ) {
        out[o + 3] = 255; // the ring: black, the color bytes already zero
      }
    }
  }
  return out;
}
