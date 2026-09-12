// ---------------------------------------------------------------------------
// The document icon's geometry — PURE (no THREE, no DOM, Node-tested): the
// pose a document's 32×32 desktop art is rendered from, and the ORTHOGRAPHIC
// FIT that sizes it. scene/icon-renderer.js is the consumer.
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
// THE POSE is the 3D View's yaw at a higher elevation — 45° round from the
// front, so the FRONT, RIGHT and TOP faces all show (the stage's default
// framing is the same 45°, at 29.5° up), and 45° above the horizon. The
// direction and up vectors themselves are the ring's (ringCameraDir /
// ringCameraUp): one orthographic camera convention on the machine.
// ---------------------------------------------------------------------------

/** The icon resource's edge in px — the kit's `large` vf-icon cell. */
export const ICON_SIZE = 32;
/** The pose, in degrees: 45° round from the front, 45° above the horizon. */
export const ICON_YAW = 45;
export const ICON_ELEV = 45;

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
