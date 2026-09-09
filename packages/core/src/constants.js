// ---------------------------------------------------------------------------
// The engine's defaults. Centralized so the pipeline, the mesher and every
// consumer can never drift on what "the defaults" are. Import and spread
// (`{ ...DEFAULT_MIRROR }`) rather than mutating these objects in place.
// (The editor's palettes, which shared this file before the engine became a
// package, are the app's src/lib/palette.js.)
// ---------------------------------------------------------------------------

/**
 * Per-axis mirror-fill: a face with no view of its own is always filled from the
 * mirrored opposite view. On for every axis — objects are treated as symmetric,
 * so a half-drawn sheet (e.g. no LEFT/BACK/BOTTOM) still colors every face.
 */
export const DEFAULT_MIRROR = { x: true, y: true, z: true };

/**
 * World-space size the largest grid axis is scaled to fill — the app's stage
 * units. A headless build (model.js) uses one unit per voxel instead.
 */
export const DEFAULT_WORLD_SIZE = 2.5;
