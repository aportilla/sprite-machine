// Document icon rules (pure): the camera pose, the orthographic fit, and the
// raster passes that turn a render into a 32×32 icon. Used by
// scene/icon-renderer.js.
//
// orthoFit bounds the meshed geometry tightly, so the tile size does not affect
// the framing. The view direction and up vectors come from lib/ring.js
// (ringCameraDir, ringCameraUp). The render is supersampled and box-filtered,
// then inkOutline makes each pixel opaque or clear and draws a 1px black
// outline outside the model. framedHalf leaves room for that outline.

/** Icon edge in px, the kit's `large` vf-icon cell. */
export const ICON_SIZE = 32;
/** Pose in degrees: yaw from the front, elevation above the horizon. */
export const ICON_YAW = 35;
export const ICON_ELEV = 45;
/** Render samples per icon px on each axis. */
export const ICON_SUPERSAMPLE = 3;
/** Outline width in icon px. The fit leaves this margin on every side. */
export const ICON_OUTLINE = 1;

/**
 * The camera half-extent for a model fit of `half`, leaving ICON_OUTLINE px on
 * each side for the outline.
 * @param {number} half  the model's half-extent from orthoFit
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
 * The tight orthographic fit of a point cloud: the center to look at, the
 * half-extent of the square frame (the larger projected span), and the depth
 * along the view axis for the near and far planes. The screen basis matches
 * lookAt: right = up × dir, screen-up = dir × right.
 *
 * @param {ArrayLike<number>} positions  xyz triples in world coordinates
 * @param {Vec3} dir  unit, from the subject to the camera
 * @param {Vec3} up  unit, the camera's screen-up (perpendicular to `dir`)
 * @returns {{center: Vec3, half: number, depth: number}|null}  null for an empty cloud
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
    // Floored above zero so a degenerate cloud still gives a non-empty frustum.
    half: Math.max((maxU - minU) / 2, (maxV - minV) / 2, 1e-6),
    depth: maxW - minW,
  };
}

/**
 * Box-filter an RGBA raster down by an integer factor. Color is weighted by
 * alpha (premultiplied), so clear samples don't darken edges. Alpha is the
 * block's mean.
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
      if (!a) continue; // stays clear
      const o = (y * w + x) * 4;
      out[o] = r / a;
      out[o + 1] = g / a;
      out[o + 2] = b / a;
      out[o + 3] = a / n;
    }
  }
  return out;
}

/** Minimum alpha for a pixel to count as covered by the model. */
const COVERED = 128;

/**
 * Harden the silhouette and draw its outline. A pixel with alpha >= COVERED
 * becomes opaque in its own color. An uncovered pixel with a 4-connected
 * covered neighbour becomes black. Every other pixel becomes clear.
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
        out[o + 3] = 255; // outline: black, the color bytes are already zero
      }
    }
  }
  return out;
}
