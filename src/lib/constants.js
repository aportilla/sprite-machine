// ---------------------------------------------------------------------------
// Shared default options. Centralized so the pipeline, the three mesh builders,
// and the UI can never drift on what "the defaults" are. Import and spread
// (`{ ...DEFAULT_MIRROR }`) rather than mutating these objects in place.
// ---------------------------------------------------------------------------

/** Per-axis mirror-fill defaults: vehicles are usually left/right symmetric. */
export const DEFAULT_MIRROR = { x: true, y: false, z: false };

/** World-space size the largest grid axis is scaled to fill. */
export const DEFAULT_WORLD_SIZE = 2.5;

/** Alpha byte at/above which a sprite pixel counts as solid (0..255). */
export const DEFAULT_ALPHA_THRESHOLD = 128;
