// Engine defaults. Treat them as read-only and copy with a spread
// (`{ ...DEFAULT_MIRROR }`).

/**
 * Per-axis mirror-fill: a face with no view of its own is colored from the
 * mirrored opposite view. On for every axis, so a half-drawn sheet still colors
 * every face.
 */
export const DEFAULT_MIRROR = { x: true, y: true, z: true };

/**
 * World-space size the largest grid axis is scaled to, in the app's stage units.
 * model.js uses one unit per voxel.
 */
export const DEFAULT_WORLD_SIZE = 2.5;
