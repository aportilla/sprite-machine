// 3D Sprite Atlas geometry (pure): the camera pose, frame and anchor for
// rendering the model orthographically from a ring of evenly spaced yaws at
// one elevation. Used by scene/ring-renderer.js, the atlas components and the
// export metadata.
//
// Units are voxels. The renderer multiplies by `s` (world units per voxel)
// once. Angles are degrees at the API and radians inside.
//
// The frame is a square tile of `size` px that fits the whole nx×ny×nz lattice
// at every yaw, so the sprite keeps the same scale and center across angles.
// Px per voxel is derived from that fit.
//
// Yaw 0 puts the camera on +z, facing the front. Positive yaw moves it toward
// +x, so four views show front, right, back, left.

const RAD = Math.PI / 180;

/**
 * The yaws of a ring: offset + i·(360/n) for i = 0..n−1, unwrapped.
 * @param {number} views
 * @param {number} offset  degrees
 * @returns {number[]}
 */
export function ringYaws(views, offset) {
  const n = Math.max(1, Math.floor(views));
  const step = 360 / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(offset + i * step);
  return out;
}

/**
 * The lattice's projected envelope at an elevation, in voxel units. The nx×nz
 * footprint turns inside a circle of radius r = hypot(nx, nz) / 2, so at every
 * yaw:
 *   width  = 2r
 *   height = ny·cos e + 2r·sin e
 * @param {{nx: number, ny: number, nz: number}} dims
 * @param {number} elevation  degrees above the horizon, 0..90
 * @returns {{width: number, height: number}}
 */
export function ringEnvelope(dims, elevation) {
  const e = elevation * RAD;
  const r = Math.hypot(dims.nx, dims.nz) / 2;
  return { width: 2 * r, height: dims.ny * Math.cos(e) + 2 * r * Math.sin(e) };
}

/**
 * The square frame of `size` px. half = max(width, height) / 2 voxel units and
 * scale = size / max(width, height) px per voxel, the same for every yaw.
 * @param {{nx: number, ny: number, nz: number}} dims
 * @param {number} elevation  degrees
 * @param {number} size  the tile's edge, px
 * @returns {{px: number, half: number, scale: number}}
 */
export function ringFrame(dims, elevation, size) {
  const { width, height } = ringEnvelope(dims, elevation);
  const px = Math.max(1, Math.round(size));
  const span = Math.max(width, height, 1e-9);
  return { px, half: span / 2, scale: px / span };
}

/**
 * The sheet size: `views` frames in one row.
 * @param {number} views
 * @param {number} framePx
 * @returns {{width: number, height: number}}
 */
export function ringSheet(views, framePx) {
  return { width: Math.max(1, Math.floor(views)) * framePx, height: framePx };
}

/**
 * Unit direction from the lattice center to the camera:
 * [sin yaw · cos e, sin e, cos yaw · cos e]. Yaw 0 is +z (front), yaw 90 is +x
 * (right).
 * @param {number} yaw  degrees
 * @param {number} elevation  degrees
 * @returns {[number, number, number]}
 */
export function ringCameraDir(yaw, elevation) {
  const y = yaw * RAD;
  const e = elevation * RAD;
  return [Math.sin(y) * Math.cos(e), Math.sin(e), Math.cos(y) * Math.cos(e)];
}

/**
 * The camera's unit screen-up vector, perpendicular to ringCameraDir:
 * [−sin e · sin yaw, cos e, −sin e · cos yaw]. It stays defined at e = 90,
 * where lookAt's default +y up degenerates.
 * @param {number} yaw  degrees
 * @param {number} elevation  degrees
 * @returns {[number, number, number]}
 */
export function ringCameraUp(yaw, elevation) {
  const y = yaw * RAD;
  const e = elevation * RAD;
  return [-Math.sin(e) * Math.sin(y), Math.cos(e), -Math.sin(e) * Math.cos(y)];
}

/**
 * The lattice center the camera looks at, in voxel units. The mesh builders
 * center X and Z (finishVoxelMesh). Y starts at 0.
 * @param {{nx: number, ny: number, nz: number}} dims
 * @returns {[number, number, number]}
 */
export function ringCenter(dims) {
  return [0, dims.ny / 2, 0];
}

/**
 * Where the lattice floor's center (0, 0, 0) lands in every frame, in px from
 * the top-left: x = F/2, y = F/2 + (ny/2)·cos e·scale. The same for every yaw.
 * @param {{nx: number, ny: number, nz: number}} dims
 * @param {number} elevation  degrees
 * @param {number} size  the tile's edge, px
 * @returns {{x: number, y: number}}
 */
export function ringAnchor(dims, elevation, size) {
  const e = elevation * RAD;
  const { px, scale } = ringFrame(dims, elevation, size);
  return { x: px / 2, y: px / 2 + (dims.ny / 2) * Math.cos(e) * scale };
}
