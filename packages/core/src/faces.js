// ---------------------------------------------------------------------------
// The face vocabulary's GEOMETRY: for each face key, the axes its plane spans
// (A, B — the tangent frame every 2D read of a face uses: the regions, the
// skin's charts and the UV read) and the axis it faces along (N), plus the two
// lattice reads built on them — a tangent coordinate's voxel index (idxFor)
// and its 3D point (pointOf). Pure, no THREE, Node-testable.
//
// A face's plane sits at slice s along N: at s for a negative face (the
// voxel's near side), at s + 1 for a positive one. Tangent (a, b) is the
// voxel's own A/B coordinate, so the unit square [a, a+1] × [b, b+1] on the
// plane IS that voxel's face, and a texel per face is a texel per unit
// square — the skin's orientation rule, stated once (skin.js).
//
// Until Sep 7 2026 this module also merged faces into greedy rectangles
// (culledQuads / greedyQuads); the mesher traces coplanar REGIONS now
// (regions.js) — a rectangle being the region with four corners — so the quad
// builders went with their last consumer.
// ---------------------------------------------------------------------------

import { voxIndex } from './carve.js';
import { FACE_NORMAL, AXIS_INDEX } from './views.js';

// Per-face tangent axes and the normal axis. The outward normal is read from
// the shared FACE_NORMAL (views.js), not restated here.
export const FACE_GEO = {
  px: { N: 'x', A: 'y', B: 'z' },
  nx: { N: 'x', A: 'y', B: 'z' },
  py: { N: 'y', A: 'x', B: 'z' },
  ny: { N: 'y', A: 'x', B: 'z' },
  pz: { N: 'z', A: 'x', B: 'y' },
  nz: { N: 'z', A: 'x', B: 'y' },
};

/**
 * The voxel index behind tangent coords (a, b) on slice s of `face` — the
 * lattice cell whose face that is. One home: the regions, the skin's baker
 * and every test compose it here.
 * @param {string} face  a FACE_KEYS key
 * @param {number} a  along FACE_GEO[face].A
 * @param {number} b  along FACE_GEO[face].B
 * @param {number} s  the slice along FACE_GEO[face].N
 * @param {{nx:number, ny:number, nz:number}} dims
 */
export function idxFor(face, a, b, s, dims) {
  const g = FACE_GEO[face];
  const c = { x: 0, y: 0, z: 0 };
  c[g.N] = s;
  c[g.A] = a;
  c[g.B] = b;
  return voxIndex(c.x, c.y, c.z, dims);
}

/**
 * The 3D lattice point at tangent (a, b) on the plane of `face` at slice s —
 * the plane at s + 1 for a positive face, at s for a negative one.
 * @param {string} face
 * @param {number} a
 * @param {number} b
 * @param {number} s
 * @returns {number[]}
 */
export function pointOf(face, a, b, s) {
  const g = FACE_GEO[face];
  const c = { x: 0, y: 0, z: 0 };
  c[g.N] = s + (FACE_NORMAL[face][AXIS_INDEX[g.N]] > 0 ? 1 : 0);
  c[g.A] = a;
  c[g.B] = b;
  return [c.x, c.y, c.z];
}
