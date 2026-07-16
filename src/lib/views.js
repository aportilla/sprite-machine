// ---------------------------------------------------------------------------
// View conventions and projection mappings.
//
// World frame:  +x = right, +y = up, +z = toward the front (camera).
// A "view" is an orthographic face render. Each view has:
//   - normal:   the world-space outward normal of the face it observes.
//   - axis:     the world axis it looks ALONG (the depth / extrusion axis).
//   - project(x, y, z, dims) -> {u, v}: which pixel of the view a voxel maps to.
//                u,v are image coords with (0,0) = top-left, v growing DOWN.
//
// The image width/height of a view are tied to two of the grid dims:
//   FRONT/BACK : image is (nx wide, ny tall)  -> sees the X/Y plane
//   LEFT/RIGHT : image is (nz wide, ny tall)  -> sees the Z/Y plane
//   TOP/BOTTOM : image is (nx wide, nz tall)  -> sees the X/Z plane
//
// These six mappings are set-and-forget: identical for every model. They were
// chosen so that, standing at the camera and looking at each face, the sprite's
// pixel (col,row) lands where a human artist expects (art drawn upright and
// left-to-right as seen from outside the object).
// ---------------------------------------------------------------------------

/** @typedef {{nx:number, ny:number, nz:number}} Dims */

// Human-facing view names <-> face normals.
export const VIEW_TO_FACE = {
  right: 'nx',
  left: 'px',
  top: 'py',
  bottom: 'ny',
  front: 'pz',
  back: 'nz',
};
export const FACE_TO_VIEW = Object.fromEntries(
  Object.entries(VIEW_TO_FACE).map(([k, v]) => [v, k])
);

// Outward unit normals per face key.
export const FACE_NORMAL = {
  px: [1, 0, 0],
  nx: [-1, 0, 0],
  py: [0, 1, 0],
  ny: [0, -1, 0],
  pz: [0, 0, 1],
  nz: [0, 0, -1],
};

// Which world axis each face's outward normal lies on. Derived from
// FACE_NORMAL so it can't drift; used by colorize for mirror-fill.
export const FACE_AXIS = Object.fromEntries(
  Object.entries(FACE_NORMAL).map(([k, n]) => [k, n[0] ? 'x' : n[1] ? 'y' : 'z'])
);

// Opposite face (for mirror-fill).
export const FACE_OPPOSITE = {
  px: 'nx',
  nx: 'px',
  py: 'ny',
  ny: 'py',
  pz: 'nz',
  nz: 'pz',
};

// For each face/view: the image dimensions in grid units, the march axis &
// direction used for first-hit visibility, and the pixel projection.
//
// project() returns integer image coords. `imgW`/`imgH` give the expected view
// image size for a grid, so ingest can validate/resample.
export const VIEWS = {
  // FRONT: looks toward -z from +z. Sees +z face. Image = X (right) by Y (up).
  front: {
    face: 'pz',
    axis: 'z',
    step: -1, // marching inward from the camera: z decreases
    from: 'max', // first-hit search starts at max z
    imgW: (d) => d.nx,
    imgH: (d) => d.ny,
    project: (x, y, z, d) => ({ u: x, v: d.ny - 1 - y }),
  },
  // BACK: looks toward +z from -z. Sees -z face. Left-right mirrored vs front.
  back: {
    face: 'nz',
    axis: 'z',
    step: 1,
    from: 'min',
    imgW: (d) => d.nx,
    imgH: (d) => d.ny,
    project: (x, y, z, d) => ({ u: d.nx - 1 - x, v: d.ny - 1 - y }),
  },
  // LEFT: the atlas tile drawn as the object's LEFT side. It colors the +x face
  // — viewed straight-on from +x that face reads as a left-side profile, so the
  // *tile* is named by how it reads (a deliberate labeling choice; see README),
  // not by the world axis it happens to occupy. Image = Z by Y. u = nz-1-z puts
  // the object's front (+z) at the left column, matching a nose-left profile.
  left: {
    face: 'px',
    axis: 'x',
    step: -1,
    from: 'max',
    imgW: (d) => d.nz,
    imgH: (d) => d.ny,
    project: (x, y, z, d) => ({ u: d.nz - 1 - z, v: d.ny - 1 - y }),
  },
  // RIGHT: the object's RIGHT side; colors the -x face, which reads as a
  // right-side profile. Mirror of left along z — u = z puts front at the right column.
  right: {
    face: 'nx',
    axis: 'x',
    step: 1,
    from: 'min',
    imgW: (d) => d.nz,
    imgH: (d) => d.ny,
    project: (x, y, z, d) => ({ u: z, v: d.ny - 1 - y }),
  },
  // TOP: looks toward -y from +y. Sees +y face. Image = X by Z.
  // Looking straight down: v = nz-1-z puts the object's front (+z, z=nz-1) on
  // the TOP row of the image (v=0), matching the FRONT view's top-is-v=0.
  top: {
    face: 'py',
    axis: 'y',
    step: -1,
    from: 'max',
    imgW: (d) => d.nx,
    imgH: (d) => d.nz,
    project: (x, y, z, d) => ({ u: x, v: d.nz - 1 - z }),
  },
  // BOTTOM: looks toward +y from -y. Sees -y face. Mirror of top along z.
  bottom: {
    face: 'ny',
    axis: 'y',
    step: 1,
    from: 'min',
    imgW: (d) => d.nx,
    imgH: (d) => d.nz,
    project: (x, y, z, d) => ({ u: x, v: z }),
  },
};

export const VIEW_NAMES = Object.keys(VIEWS);

// The six view names in the order the UI's face-preview grid lays them out
// (a 3x2 arrangement). Matches the atlas layout (atlas.js DEFAULT_ATLAS_LAYOUT:
// LEFT FRONT TOP / RIGHT BACK BOTTOM) so the preview reads like the sheet.
export const VIEW_DISPLAY_ORDER = ['left', 'front', 'top', 'right', 'back', 'bottom'];

// Which image edge of a view's tile the object's FRONT (+z, the "nose") points
// toward — used by the UI to mark orientation on each face thumbnail. Derived
// from the projections in VIEWS: e.g. in LEFT, front (z=nz-1) maps to u=0, the
// left column. FRONT/BACK look straight down +z/-z, so their nose points out of
// / into the screen — there is no in-plane front edge (null).
export const VIEW_FRONT_EDGE = {
  right: 'right',
  left: 'left',
  top: 'top',
  bottom: 'bottom',
  front: null,
  back: null,
};

// Each view's opposite (the mirror-fill source when a view has no art of its own).
export const VIEW_OPPOSITE = {
  right: 'left',
  left: 'right',
  front: 'back',
  back: 'front',
  top: 'bottom',
  bottom: 'top',
};

// To DISPLAY a mirror-derived face, flip its opposite view's tile along this
// IMAGE axis. Follows the projections: the X/Z-plane pairs (left↔right,
// front↔back) mirror horizontally; the Y pair (top↔bottom) mirrors vertically.
export const VIEW_MIRROR_AXIS = {
  right: 'x',
  left: 'x',
  front: 'x',
  back: 'x',
  top: 'y',
  bottom: 'y',
};

// Which grid axes a view's (imgW, imgH) constrain. Used by dimension
// reconciliation. Each entry: [axisForImgW, axisForImgH].
export const VIEW_AXES = {
  front: ['nx', 'ny'],
  back: ['nx', 'ny'],
  right: ['nz', 'ny'],
  left: ['nz', 'ny'],
  top: ['nx', 'nz'],
  bottom: ['nx', 'nz'],
};
