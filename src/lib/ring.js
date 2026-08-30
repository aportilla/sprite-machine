// ---------------------------------------------------------------------------
// The 3D Sprite Atlas's geometry — PURE (no THREE, no DOM, Node-tested): the
// numbers scene/ring-renderer.js poses its camera by, components read out,
// and the export writes into its metadata chunk. "Ring" is the feature's code
// name: the model rendered orthographically from a RING of evenly stepped yaw
// angles at one elevation — the rotation set an engine consumes.
//
// Voxel units throughout: the renderer multiplies by `s` (world units per
// voxel, the mesh builders' own expression) exactly once. Angles are degrees
// at the API, radians inside.
//
// THE FRAME IS THE LATTICE'S ENVELOPE, NOT THE CONTENT'S. Every frame is a
// square of F px sized so the whole nx×ny×nz voxel box fits at EVERY yaw and
// this elevation: the box's XZ footprint turns inside its bounding circle (r
// = hypot(nx, nz) / 2), so the projected envelope is the same at every yaw
// — that circle swept up the box's height. The frame therefore never changes
// size between angles, between strokes, or with the first-angle offset: a
// sprite can't jitter in an animation, and one setting change is one
// predictable re-layout. It is loose at yaw 0 (a cube uses 40 of its 56.57
// width) — accepted: the sprite stays centered and the margin is
// transparent. A tight per-frame bound would breathe with the angle.
//
// THE YAW CONVENTION: yaw 0 puts the camera on +z (the FRONT face toward
// it); positive yaw walks the camera toward +x, so the second of four views
// shows the RIGHT face — front → right → back → left. A sign flip in
// ringCameraDir reverses it.
//
// THE ANCHOR: the lattice floor's center (0, 0, 0) projects to the same
// point in every frame — x at the frame's center, y a fixed distance below
// it — the feet-row an engine aligns a rotation set by. Yaw-independent by
// construction (the API takes no yaw).
// ---------------------------------------------------------------------------

const RAD = Math.PI / 180;

/**
 * The n yaws of a ring: offset + i·(360/n), i = 0..n−1, unwrapped (an offset
 * of 45 with four views is [45, 135, 225, 315]).
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
 * The lattice's projected envelope at an elevation, in voxel units: the
 * nx×nz footprint's bounding CIRCLE (radius r = hypot(nx, nz) / 2 — the box
 * turns inside it, so the envelope is the same at every yaw) swept up the
 * height:
 *   width  = 2r
 *   height = ny·cos e + 2r·sin e
 * (e = 0: the side elevation, ny tall; e = 90: the plan, 2r tall.)
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
 * The frame: a SQUARE of F = ceil(max(width, height) · scale) px, and the
 * orthographic half-extent that puts exactly `scale` px on a voxel: half =
 * F / (2·scale) voxel units — at least the envelope's half, so the box
 * always fits, centered. The same for every yaw and every first-angle
 * offset (the API takes neither).
 * @param {{nx: number, ny: number, nz: number}} dims
 * @param {number} elevation  degrees
 * @param {number} scale  px per voxel
 * @returns {{px: number, half: number}}
 */
export function ringFrame(dims, elevation, scale) {
  const { width, height } = ringEnvelope(dims, elevation);
  const px = Math.max(1, Math.ceil(Math.max(width, height) * scale));
  return { px, half: px / (2 * scale) };
}

/**
 * The sheet: `views` frames side by side, one row.
 * @param {number} views
 * @param {number} framePx
 * @returns {{width: number, height: number}}
 */
export function ringSheet(views, framePx) {
  return { width: Math.max(1, Math.floor(views)) * framePx, height: framePx };
}

/**
 * Unit camera direction — from the lattice center OUT to the camera:
 * [sin yaw · cos e, sin e, cos yaw · cos e]. Yaw 0 → +z (FRONT faces the
 * camera), yaw 90 → +x (RIGHT), elevation → up.
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
 * The camera's screen-up vector for that pose — the TRUE one, so e = 90
 * (straight down, where lookAt's default +y up degenerates) is well
 * defined: [−sin e · sin yaw, cos e, −sin e · cos yaw]. Unit, and
 * perpendicular to ringCameraDir; at e = 0 it is world +y.
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
 * The lattice center the camera looks at and every frame centers on, in
 * voxel units: [0, ny / 2, 0] — X/Z are centered by the mesh builders
 * (finishVoxelMesh), Y runs from 0.
 * @param {{nx: number, ny: number, nz: number}} dims
 * @returns {[number, number, number]}
 */
export function ringCenter(dims) {
  return [0, dims.ny / 2, 0];
}

/**
 * Where the lattice floor's center (0, 0, 0) lands in EVERY frame, in px from
 * the frame's top-left: x = F/2, y = F/2 + (ny/2)·cos e·scale — the floor
 * point sits ny/2 below the center along world −y, whose screen-up component
 * is cos e. The engine anchor (feet-row), yaw-independent by construction.
 * @param {{nx: number, ny: number, nz: number}} dims
 * @param {number} elevation  degrees
 * @param {number} scale  px per voxel
 * @param {number} framePx
 * @returns {{x: number, y: number}}
 */
export function ringAnchor(dims, elevation, scale, framePx) {
  const e = elevation * RAD;
  return { x: framePx / 2, y: framePx / 2 + (dims.ny / 2) * Math.cos(e) * scale };
}
