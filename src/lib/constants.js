// ---------------------------------------------------------------------------
// Shared default options. Centralized so the pipeline, the mesh builders, and
// the UI can never drift on what "the defaults" are. Import and spread
// (`{ ...DEFAULT_MIRROR }`) rather than mutating these objects in place.
// ---------------------------------------------------------------------------

/**
 * Per-axis mirror-fill: a face with no view of its own is always filled from the
 * mirrored opposite view. On for every axis — objects are treated as symmetric,
 * so a half-drawn sheet (e.g. no LEFT/BACK/BOTTOM) still colors every face.
 */
export const DEFAULT_MIRROR = { x: true, y: true, z: true };

/** World-space size the largest grid axis is scaled to fill. */
export const DEFAULT_WORLD_SIZE = 2.5;
