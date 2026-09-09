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

// Human-facing view names -> face normals. Its inverse
// FACE_TO_VIEW is consumed by colorize, VIEW_TO_FACE by the edge hints (which
// need a view's own face to know which way it looks); every pair is already
// implied by the face metadata below.
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

// Outward unit normals per face key. The single source of truth for per-face
// axis/direction — FACE_AXIS, carve's NEIGHBORS, and faces.js's quad normals are
// all derived from this so they can't drift from the convention the 6-bit surface
// mask and the faceColor keying (idx*6+f) depend on.
export const FACE_NORMAL = {
  px: [1, 0, 0],
  nx: [-1, 0, 0],
  py: [0, 1, 0],
  ny: [0, -1, 0],
  pz: [0, 0, 1],
  nz: [0, 0, -1],
};

// Canonical face-key order: the 6-bit surface-exposure mask and the faceColor map
// (keyed idx*6+f) both index by this position, so it is load-bearing. Co-located
// with FACE_NORMAL; carve.js re-exports it for the consumers that read it there.
export const FACE_KEYS = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

// Face key -> its index in FACE_KEYS (memoized indexOf).
export const FACE_INDEX = Object.fromEntries(FACE_KEYS.map((k, i) => [k, i]));

// World-axis name -> its index in an [x, y, z] triple.
export const AXIS_INDEX = { x: 0, y: 1, z: 2 };

// The face key whose outward normal points along world `axis` with `sign` (±1).
// Derived from FACE_NORMAL so an (axis, sign) pair can never drift from the normals.
export const faceKeyOf = (axis, sign) =>
  FACE_KEYS.find((k) => FACE_NORMAL[k][AXIS_INDEX[axis]] === sign);

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

// For each face/view: the image dimensions in grid units and the pixel projection.
// The march axis + direction used for first-hit visibility is NOT stored here — it
// is derived from FACE_NORMAL in colorize.firstHitFromFace, the single source of
// truth (a `step`/`from` field here would be a silent drift hazard).
//
// projectInto(x,y,z,d,out) writes integer image coords into the reused `out` (no
// per-voxel allocation in carve's hot triple loop); project() is the allocating
// convenience that delegates to it, so each view has exactly ONE formula. `imgW`/
// `imgH` give the expected view image size for a grid, so carve can place each view
// at native scale (padding, never stretching) and index it 1:1.
export const VIEWS = {
  // FRONT: looks toward -z from +z. Sees +z face. Image = X (right) by Y (up).
  front: {
    imgW: (d) => d.nx,
    imgH: (d) => d.ny,
    projectInto: (x, y, z, d, o) => ((o.u = x), (o.v = d.ny - 1 - y), o),
    project(x, y, z, d) {
      return this.projectInto(x, y, z, d, { u: 0, v: 0 });
    },
  },
  // BACK: looks toward +z from -z. Sees -z face. Left-right mirrored vs front.
  back: {
    imgW: (d) => d.nx,
    imgH: (d) => d.ny,
    projectInto: (x, y, z, d, o) => ((o.u = d.nx - 1 - x), (o.v = d.ny - 1 - y), o),
    project(x, y, z, d) {
      return this.projectInto(x, y, z, d, { u: 0, v: 0 });
    },
  },
  // LEFT: the atlas tile drawn as the object's LEFT side. It colors the +x face
  // — viewed straight-on from +x that face reads as a left-side profile, so the
  // *tile* is named by how it reads (a deliberate labeling choice; see README),
  // not by the world axis it happens to occupy. Image = Z by Y. u = nz-1-z puts
  // the object's front (+z) at the left column, matching a nose-left profile.
  left: {
    imgW: (d) => d.nz,
    imgH: (d) => d.ny,
    projectInto: (x, y, z, d, o) => ((o.u = d.nz - 1 - z), (o.v = d.ny - 1 - y), o),
    project(x, y, z, d) {
      return this.projectInto(x, y, z, d, { u: 0, v: 0 });
    },
  },
  // RIGHT: the object's RIGHT side; colors the -x face, which reads as a
  // right-side profile. Mirror of left along z — u = z puts front at the right column.
  right: {
    imgW: (d) => d.nz,
    imgH: (d) => d.ny,
    projectInto: (x, y, z, d, o) => ((o.u = z), (o.v = d.ny - 1 - y), o),
    project(x, y, z, d) {
      return this.projectInto(x, y, z, d, { u: 0, v: 0 });
    },
  },
  // TOP: looks toward -y from +y. Sees +y face. Image = X by Z.
  // Looking straight down: v = nz-1-z puts the object's front (+z, z=nz-1) on
  // the TOP row of the image (v=0), matching the FRONT view's top-is-v=0.
  top: {
    imgW: (d) => d.nx,
    imgH: (d) => d.nz,
    projectInto: (x, y, z, d, o) => ((o.u = x), (o.v = d.nz - 1 - z), o),
    project(x, y, z, d) {
      return this.projectInto(x, y, z, d, { u: 0, v: 0 });
    },
  },
  // BOTTOM: looks toward +y from -y. Sees -y face. The car is flipped SIDEWAYS
  // (rolled about its front-back axis), NOT end-over-end — so the front stays on
  // the TOP row like TOP (v = nz-1-z) and only left/right swap (u = nx-1-x). That
  // way the TOP and BOTTOM tiles register front-to-front on the same edge.
  bottom: {
    imgW: (d) => d.nx,
    imgH: (d) => d.nz,
    projectInto: (x, y, z, d, o) => ((o.u = d.nx - 1 - x), (o.v = d.nz - 1 - z), o),
    project(x, y, z, d) {
      return this.projectInto(x, y, z, d, { u: 0, v: 0 });
    },
  },
};

export const VIEW_NAMES = Object.keys(VIEWS);

// The six view names in atlas-sheet (row-major) order, matching atlas.js
// DEFAULT_ATLAS_LAYOUT (LEFT FRONT TOP / RIGHT BACK BOTTOM). A pinned convention
// (a test asserts it equals the layout) — there is no on-screen faces-preview
// grid; the editor switches faces with text tabs.
export const VIEW_DISPLAY_ORDER = ['left', 'front', 'top', 'right', 'back', 'bottom'];

// Which image edge of a view's tile the object's FRONT (+z, the "nose") points
// toward. A projection-convention pin (a test checks it against VIEWS' projections)
// and the reference behind the README's per-face "Front points" column. Derived
// meaning: in LEFT, front (z=nz-1) maps to u=0, the left column; TOP and BOTTOM
// both put the front on their TOP edge (BOTTOM is the sideways flip of TOP);
// FRONT/BACK look straight down +z/-z, so their nose points out of / into the
// screen — there is no in-plane front edge (null).
export const VIEW_FRONT_EDGE = {
  right: 'right',
  left: 'left',
  top: 'top',
  bottom: 'top',
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
// IMAGE axis. It is 'x' for EVERY pair (a single constant, not a per-view table
// that would imply the axis varies): the projections make each pair mirror
// HORIZONTALLY — left↔right and front↔back on the X/Z planes, and top↔bottom too
// because BOTTOM is the sideways (left/right) flip of TOP, not an end-over-end one.
// (mirrorImage's 'y' branch in derive.js is therefore unexercised in practice.)
export const MIRROR_AXIS = 'x';

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

// For each view: which world axis its image COLUMNS (u) and ROWS (v) run along,
// and whether the image index runs the SAME direction as the world coordinate
// (flip:false) or the OPPOSITE (flip:true). Probed from project() at load so it
// can never drift from the projections above (test/views.test.mjs pins it).
// Consumed by the sheet resize (src/lib/atlas.js resizeAtlas) to place each
// face's tile so every face sharing a world axis shifts identically.
const AXIS_ARG = { nx: 0, ny: 1, nz: 2 };
function probeFlip(spec, axisName, which) {
  const d = { nx: 2, ny: 2, nz: 2 };
  const at = (coord) => {
    const p = [0, 0, 0];
    p[AXIS_ARG[axisName]] = coord;
    return spec.project(p[0], p[1], p[2], d)[which];
  };
  return at(0) > at(1); // world coord 0 -> higher image index => flipped
}
export const VIEW_IMAGE_AXES = Object.fromEntries(
  VIEW_NAMES.map((name) => {
    const [colAxis, rowAxis] = VIEW_AXES[name];
    return [
      name,
      {
        colAxis,
        colFlip: probeFlip(VIEWS[name], colAxis, 'u'),
        rowAxis,
        rowFlip: probeFlip(VIEWS[name], rowAxis, 'v'),
      },
    ];
  })
);
