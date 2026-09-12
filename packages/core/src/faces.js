// Face geometry: each face key's tangent axes (A, B) and normal axis (N), and the
// lattice lookups idxFor (tangent coords to voxel index) and pointOf (tangent
// coords to a 3D point).
//
// A face's plane at slice s sits at s along N for a negative face and at s + 1 for
// a positive one. Tangent (a, b) is the voxel's own A/B coordinate, so the unit
// square [a, a+1] × [b, b+1] on the plane is that voxel's face.

import { voxIndex } from './carve.js';
import { FACE_NORMAL, AXIS_INDEX } from './views.js';

// The outward normal's sign is in FACE_NORMAL.
export const FACE_GEO = {
  px: { N: 'x', A: 'y', B: 'z' },
  nx: { N: 'x', A: 'y', B: 'z' },
  py: { N: 'y', A: 'x', B: 'z' },
  ny: { N: 'y', A: 'x', B: 'z' },
  pz: { N: 'z', A: 'x', B: 'y' },
  nz: { N: 'z', A: 'x', B: 'y' },
};

/**
 * The index of the voxel whose face is at tangent coords (a, b) on slice s.
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
 * The 3D lattice point at tangent (a, b) on the plane of face at slice s.
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
