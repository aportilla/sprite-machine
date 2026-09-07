// ---------------------------------------------------------------------------
// Face generation: turn the surface voxels into renderable rectangles. Pure (no
// THREE), so it's Node-testable. Two strategies, same output format:
//   - culledQuads: one unit rect per exposed face (hidden faces already dropped).
//   - greedyQuads: merge adjacent coplanar exposed faces into big rects — on
//     OCCUPANCY ALONE. Color is never consulted: a flat wall is one rectangle
//     whatever is painted on it, and the paint rides the skin texture
//     (skin.js) — a texel per voxel face where a rectangle crosses a color
//     boundary, a swatch where it does not. (Until Sep 7 2026 the merge was
//     color-aware, so a painted wall shattered into one rect per color region
//     and every boundary fed the T-junction repair — color doing geometry's
//     job. The Car went 1784 → 900 triangles when the merge stopped looking.)
// Both are appearance-identical; greedy just uses far fewer triangles.
//
// A rect is { face, s, a, b, w, h, normal:[3], corners:[[x,y,z]*4] }: the face
// key, its slice index along the normal axis, its tangent origin and extent —
// a along FACE_GEO[face].A, b along .B, so the voxel faces it covers are
// (a..a+w-1) × (b..b+h-1) on slice s — the outward normal, and its four
// corners in voxel units, CCW seen from outside (matches the winding
// lighting/culling expect). The tangent record is what the skin's baker and
// its UV read need; the corners are what the mesher emits.
// ---------------------------------------------------------------------------

import { voxIndex, FACE_KEYS } from './carve.js';
import { FACE_NORMAL } from './views.js';

// Per-face geometry: tangent axes and a quad builder for a rectangle spanning
// tangent voxel range [aMin..aMax]x[bMin..bMax] on slice s (lo = min index,
// hi = max index + 1, so a single voxel -> a unit quad). The outward normal is
// read from the shared FACE_NORMAL (views.js), not restated here.
export const FACE_GEO = {
  px: {
    N: 'x',
    A: 'y',
    B: 'z',
    quad: (aMin, aMax, bMin, bMax, s) => {
      const aLo = aMin,
        aHi = aMax + 1,
        bLo = bMin,
        bHi = bMax + 1,
        p = s + 1;
      return [
        [p, aLo, bHi],
        [p, aLo, bLo],
        [p, aHi, bLo],
        [p, aHi, bHi],
      ];
    },
  },
  nx: {
    N: 'x',
    A: 'y',
    B: 'z',
    quad: (aMin, aMax, bMin, bMax, s) => {
      const aLo = aMin,
        aHi = aMax + 1,
        bLo = bMin,
        bHi = bMax + 1,
        p = s;
      return [
        [p, aLo, bLo],
        [p, aLo, bHi],
        [p, aHi, bHi],
        [p, aHi, bLo],
      ];
    },
  },
  py: {
    N: 'y',
    A: 'x',
    B: 'z',
    quad: (aMin, aMax, bMin, bMax, s) => {
      const aLo = aMin,
        aHi = aMax + 1,
        bLo = bMin,
        bHi = bMax + 1,
        p = s + 1;
      return [
        [aLo, p, bHi],
        [aHi, p, bHi],
        [aHi, p, bLo],
        [aLo, p, bLo],
      ];
    },
  },
  ny: {
    N: 'y',
    A: 'x',
    B: 'z',
    quad: (aMin, aMax, bMin, bMax, s) => {
      const aLo = aMin,
        aHi = aMax + 1,
        bLo = bMin,
        bHi = bMax + 1,
        p = s;
      return [
        [aLo, p, bLo],
        [aHi, p, bLo],
        [aHi, p, bHi],
        [aLo, p, bHi],
      ];
    },
  },
  pz: {
    N: 'z',
    A: 'x',
    B: 'y',
    quad: (aMin, aMax, bMin, bMax, s) => {
      const aLo = aMin,
        aHi = aMax + 1,
        bLo = bMin,
        bHi = bMax + 1,
        p = s + 1;
      return [
        [aLo, bLo, p],
        [aHi, bLo, p],
        [aHi, bHi, p],
        [aLo, bHi, p],
      ];
    },
  },
  nz: {
    N: 'z',
    A: 'x',
    B: 'y',
    quad: (aMin, aMax, bMin, bMax, s) => {
      const aLo = aMin,
        aHi = aMax + 1,
        bLo = bMin,
        bHi = bMax + 1,
        p = s;
      return [
        [aHi, bLo, p],
        [aLo, bLo, p],
        [aLo, bHi, p],
        [aHi, bHi, p],
      ];
    },
  },
};

const DIM = (dims, axis) => dims['n' + axis];

/**
 * The voxel index behind tangent coords (a, b) on slice s of `face` — the
 * lattice cell whose face that is. One home: the merge, the skin's baker and
 * the mesher's swatch read all compose it here.
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

// `f` is the caller's known FACE_KEYS index for `face` (constant across a whole
// per-face pass), threaded in so the greedy triple loop never re-scans for it.
function exposedAt(face, f, a, b, s, dims, surfaceMask) {
  return (surfaceMask[idxFor(face, a, b, s, dims)] & (1 << f)) !== 0;
}

/** One unit rect per exposed face. */
export function culledQuads(dims, surfaceMask) {
  const quads = [];
  FACE_KEYS.forEach((face, f) => {
    const g = FACE_GEO[face];
    const normal = FACE_NORMAL[face];
    const dimN = DIM(dims, g.N);
    const dimA = DIM(dims, g.A);
    const dimB = DIM(dims, g.B);
    for (let s = 0; s < dimN; s++)
      for (let b = 0; b < dimB; b++)
        for (let a = 0; a < dimA; a++) {
          if (!exposedAt(face, f, a, b, s, dims, surfaceMask)) continue;
          quads.push({
            face,
            s,
            a,
            b,
            w: 1,
            h: 1,
            normal,
            corners: g.quad(a, a, b, b, s),
          });
        }
  });
  return quads;
}

/** Merge coplanar exposed faces per slice on occupancy alone (classic greedy meshing). */
export function greedyQuads(dims, surfaceMask) {
  const quads = [];
  FACE_KEYS.forEach((face, f) => {
    const g = FACE_GEO[face];
    const normal = FACE_NORMAL[face];
    const dimN = DIM(dims, g.N);
    const dimA = DIM(dims, g.A);
    const dimB = DIM(dims, g.B);
    const has = new Uint8Array(dimA * dimB);
    const used = new Uint8Array(dimA * dimB);

    for (let s = 0; s < dimN; s++) {
      used.fill(0);
      for (let b = 0; b < dimB; b++)
        for (let a = 0; a < dimA; a++)
          has[b * dimA + a] = exposedAt(face, f, a, b, s, dims, surfaceMask) ? 1 : 0;

      for (let b = 0; b < dimB; b++) {
        for (let a = 0; a < dimA; a++) {
          const base = b * dimA + a;
          if (!has[base] || used[base]) continue;

          // grow width along A
          let w = 1;
          while (a + w < dimA && has[base + w] && !used[base + w]) w++;

          // grow height along B while the whole row segment is exposed and free
          let h = 1;
          grow: for (; b + h < dimB; h++) {
            for (let k = 0; k < w; k++) {
              const j = (b + h) * dimA + a + k;
              if (!has[j] || used[j]) break grow;
            }
          }

          for (let db = 0; db < h; db++)
            for (let da = 0; da < w; da++) used[(b + db) * dimA + a + da] = 1;

          quads.push({
            face,
            s,
            a,
            b,
            w,
            h,
            normal,
            corners: g.quad(a, a + w - 1, b, b + h - 1, s),
          });
        }
      }
    }
  });
  return quads;
}

export function faceQuads(dims, surfaceMask, greedy = true) {
  return greedy ? greedyQuads(dims, surfaceMask) : culledQuads(dims, surfaceMask);
}
