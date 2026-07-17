// ---------------------------------------------------------------------------
// Editor alignment guides: for the face being drawn, compute how far the OTHER
// faces' pixels reach along the two axes it shares with them — the "furthest
// extent" box inside which a painted pixel can survive the visual-hull carve.
//
// Strict registration (no crop / no re-anchor) makes a face's pixel grid a
// literal slice of the voxel lattice, so a FRONT pixel at (col cx, row ry) only
// becomes a voxel where the TOP/BOTTOM plane covers column cx AND the LEFT/RIGHT
// plane covers row ry. Each world axis belongs to two projection planes; the
// edited face sits on one, and the OTHER plane sharing that axis is the one that
// constrains it. These guides surface exactly that while drawing.
//
// Pure (ImageData-like views in, plain typed arrays out) so it's Node-testable.
// ---------------------------------------------------------------------------
import { VIEW_NAMES, VIEW_AXES, VIEW_IMAGE_AXES } from './views.js';

const ALL_AXES = ['nx', 'ny', 'nz'];
const ALPHA_SOLID = 128; // matches ingest.js hard-pixel threshold

// The (up to two) views whose projection plane is spanned by world axes {a, b}.
function viewsOnPlane(a, b) {
  return VIEW_NAMES.filter((n) => {
    const [c, r] = VIEW_AXES[n];
    return (c === a || r === a) && (c === b || r === b);
  });
}

// A view's occupancy reduced to a 1-D mask along one world axis, indexed by
// WORLD coordinate: mask[c] = 1 if any pixel of the view projects onto c.
function axisMask(view, ia, worldAxis) {
  const { width: w, height: h, data } = view;
  const solid = (u, v) => data[(v * w + u) * 4 + 3] >= ALPHA_SOLID;
  if (ia.colAxis === worldAxis) {
    const m = new Uint8Array(w);
    for (let u = 0; u < w; u++) {
      let any = 0;
      for (let v = 0; v < h; v++) if (solid(u, v)) { any = 1; break; }
      m[ia.colFlip ? w - 1 - u : u] = any;
    }
    return m;
  }
  const m = new Uint8Array(h);
  for (let v = 0; v < h; v++) {
    let any = 0;
    for (let u = 0; u < w; u++) if (solid(u, v)) { any = 1; break; }
    m[ia.rowFlip ? h - 1 - v : v] = any;
  }
  return m;
}

// Union the sibling views' occupancy along `worldAxis` into the edited face's
// own index space (length `len`, `flip` = the edited face's direction on that
// axis). Returns null when NO sibling constrains the axis (nothing to draw).
function axisSupport(views, siblings, worldAxis, len, flip) {
  const support = new Uint8Array(len);
  let constrained = false;
  for (const s of siblings) {
    const view = views[s];
    if (!view) continue; // absent view doesn't constrain the plane (carve unions)
    constrained = true;
    const mask = axisMask(view, VIEW_IMAGE_AXES[s], worldAxis);
    for (let i = 0; i < len; i++) {
      const c = flip ? len - 1 - i : i; // world coord for edited-face index i
      if (c < mask.length && mask[c]) support[i] = 1;
    }
  }
  return constrained ? support : null;
}

const firstSet = (a) => {
  if (!a) return null;
  for (let i = 0; i < a.length; i++) if (a[i]) return i;
  return null;
};
const lastSet = (a) => {
  if (!a) return null;
  for (let i = a.length - 1; i >= 0; i--) if (a[i]) return i;
  return null;
};

/**
 * @param {Record<string,{width:number,height:number,data:ArrayLike<number>}|null>} views
 *   all six face tiles by name (null = absent / mirror-derived).
 * @param {string} name  the face being edited.
 * @param {number} tileW @param {number} tileH  the edited face's image size.
 * @returns {{colSupport:Uint8Array|null, rowSupport:Uint8Array|null,
 *            extent:{uMin:number|null,uMax:number|null,vMin:number|null,vMax:number|null}}}
 *   colSupport/rowSupport are per-column/row support masks in the edited face's
 *   frame; extent gives the outermost supported column/row (null if unconstrained).
 */
export function faceGuides(views, name, tileW, tileH) {
  const ia = VIEW_IMAGE_AXES[name];
  const [colAxis, rowAxis] = VIEW_AXES[name];
  const depthAxis = ALL_AXES.find((a) => a !== colAxis && a !== rowAxis);
  // The constraining plane for each axis is the OTHER plane containing it
  // (i.e. {axis, depthAxis}), never the edited face's own plane.
  const colSupport = axisSupport(
    views, viewsOnPlane(colAxis, depthAxis), colAxis, tileW, ia.colFlip
  );
  const rowSupport = axisSupport(
    views, viewsOnPlane(rowAxis, depthAxis), rowAxis, tileH, ia.rowFlip
  );
  return {
    colSupport,
    rowSupport,
    extent: {
      uMin: firstSet(colSupport),
      uMax: lastSet(colSupport),
      vMin: firstSet(rowSupport),
      vMax: lastSet(rowSupport),
    },
  };
}
