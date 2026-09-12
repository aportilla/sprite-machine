// View conventions and projections.
//
// World frame: +x right, +y up, +z toward the front (camera).
// A view is an orthographic render of one face. project(x, y, z, dims) -> {u, v}
// gives the view pixel for a voxel, with (0, 0) at top-left and v growing down.
//
// View image sizes in grid dims:
//   FRONT/BACK : nx wide, ny tall (X/Y plane)
//   LEFT/RIGHT : nz wide, ny tall (Z/Y plane)
//   TOP/BOTTOM : nx wide, nz tall (X/Z plane)
//
// The mappings are the same for every model. Art drawn upright and left to
// right, as seen from outside the object, appears that way on the model.

/** @typedef {{nx:number, ny:number, nz:number}} Dims */

// View name -> the face key it colors, and the inverse.
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

// Outward unit normal per face key. FACE_AXIS, carve's NEIGHBORS and faces.js
// derive from it.
export const FACE_NORMAL = {
  px: [1, 0, 0],
  nx: [-1, 0, 0],
  py: [0, 1, 0],
  ny: [0, -1, 0],
  pz: [0, 0, 1],
  nz: [0, 0, -1],
};

// Face-key order. The 6-bit surface mask and the faceColor keys (idx*6 + f)
// index by position, so the order must not change. carve.js re-exports it.
export const FACE_KEYS = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

// Face key -> index in FACE_KEYS.
export const FACE_INDEX = Object.fromEntries(FACE_KEYS.map((k, i) => [k, i]));

// Axis name -> index in an [x, y, z] triple.
export const AXIS_INDEX = { x: 0, y: 1, z: 2 };

// The face key whose outward normal points along world `axis` with `sign` (±1).
export const faceKeyOf = (axis, sign) =>
  FACE_KEYS.find((k) => FACE_NORMAL[k][AXIS_INDEX[axis]] === sign);

// The world axis of each face's normal. colorize uses it for mirror-fill.
export const FACE_AXIS = Object.fromEntries(
  Object.entries(FACE_NORMAL).map(([k, n]) => [k, n[0] ? 'x' : n[1] ? 'y' : 'z'])
);

// Opposite face, for mirror-fill.
export const FACE_OPPOSITE = {
  px: 'nx',
  nx: 'px',
  py: 'ny',
  ny: 'py',
  pz: 'nz',
  nz: 'pz',
};

// Per view: the image size for a grid (imgW, imgH) and the pixel projection.
// projectInto writes into a reused `out` so carve's per-voxel loop does not
// allocate. project allocates and delegates to it.
export const VIEWS = {
  // FRONT: looks toward -z and sees the +z face. Image is X by Y.
  front: {
    imgW: (d) => d.nx,
    imgH: (d) => d.ny,
    projectInto: (x, y, z, d, o) => ((o.u = x), (o.v = d.ny - 1 - y), o),
    project(x, y, z, d) {
      return this.projectInto(x, y, z, d, { u: 0, v: 0 });
    },
  },
  // BACK: looks toward +z and sees the -z face. Mirrored left to right from FRONT.
  back: {
    imgW: (d) => d.nx,
    imgH: (d) => d.ny,
    projectInto: (x, y, z, d, o) => ((o.u = d.nx - 1 - x), (o.v = d.ny - 1 - y), o),
    project(x, y, z, d) {
      return this.projectInto(x, y, z, d, { u: 0, v: 0 });
    },
  },
  // LEFT: the tile for the object's left side. It colors the +x face, which
  // seen from +x reads as a left-side profile (see README). Image is Z by Y.
  // u = nz-1-z puts the front (+z) in the left column.
  left: {
    imgW: (d) => d.nz,
    imgH: (d) => d.ny,
    projectInto: (x, y, z, d, o) => ((o.u = d.nz - 1 - z), (o.v = d.ny - 1 - y), o),
    project(x, y, z, d) {
      return this.projectInto(x, y, z, d, { u: 0, v: 0 });
    },
  },
  // RIGHT: the object's right side. It colors the -x face. u = z puts the front
  // in the right column.
  right: {
    imgW: (d) => d.nz,
    imgH: (d) => d.ny,
    projectInto: (x, y, z, d, o) => ((o.u = z), (o.v = d.ny - 1 - y), o),
    project(x, y, z, d) {
      return this.projectInto(x, y, z, d, { u: 0, v: 0 });
    },
  },
  // TOP: looks toward -y and sees the +y face. Image is X by Z.
  // v = nz-1-z puts the front (+z) on the top row.
  top: {
    imgW: (d) => d.nx,
    imgH: (d) => d.nz,
    projectInto: (x, y, z, d, o) => ((o.u = x), (o.v = d.nz - 1 - z), o),
    project(x, y, z, d) {
      return this.projectInto(x, y, z, d, { u: 0, v: 0 });
    },
  },
  // BOTTOM: looks toward +y and sees the -y face. The object is rolled about its
  // front-back axis, so the front stays on the top row as in TOP (v = nz-1-z)
  // and only u flips (u = nx-1-x).
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

// View names in atlas row-major order, matching atlas.js DEFAULT_ATLAS_LAYOUT.
export const VIEW_DISPLAY_ORDER = ['left', 'front', 'top', 'right', 'back', 'bottom'];

// The edge of each view's tile that the object's front (+z) points toward.
// FRONT and BACK look along z, so they have none (null).
export const VIEW_FRONT_EDGE = {
  right: 'right',
  left: 'left',
  top: 'top',
  bottom: 'top',
  front: null,
  back: null,
};

// Each view's opposite, the mirror-fill source for a view with no art.
export const VIEW_OPPOSITE = {
  right: 'left',
  left: 'right',
  front: 'back',
  back: 'front',
  top: 'bottom',
  bottom: 'top',
};

// The image axis along which an opposite view's tile is flipped to display a
// mirror-derived face. Every pair mirrors horizontally, top and bottom included,
// because BOTTOM is TOP rolled sideways.
export const MIRROR_AXIS = 'x';

// The grid dims a view's image constrains: [axis for imgW, axis for imgH].
// Used by dimension reconciliation.
export const VIEW_AXES = {
  front: ['nx', 'ny'],
  back: ['nx', 'ny'],
  right: ['nz', 'ny'],
  left: ['nz', 'ny'],
  top: ['nx', 'nz'],
  bottom: ['nx', 'nz'],
};

// Per view: the axis its image columns (u) and rows (v) run along, and whether
// the image index runs against the world coordinate (flip). Probed from
// project() at load. atlas.js resizeAtlas uses it so faces that share an axis
// shift together.
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
