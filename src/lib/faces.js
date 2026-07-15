// ---------------------------------------------------------------------------
// Face generation: turn the surface voxels into renderable quads. Pure (no
// THREE), so it's Node-testable. Two strategies, same output format:
//   - culledQuads: one quad per exposed face (hidden faces already dropped).
//   - greedyQuads: merge adjacent coplanar same-color faces into big rects.
// Both are appearance-identical; greedy just uses far fewer triangles.
//
// A quad is { normal:[3], color:uint32, corners:[[x,y,z]*4] } in voxel units,
// vertices CCW seen from outside (matches the winding lighting/culling expect).
// ---------------------------------------------------------------------------

import { voxIndex, FACE_KEYS } from './carve.js';

// Per-face geometry: outward normal, tangent axes, and a quad builder for a
// rectangle spanning tangent voxel range [aMin..aMax]x[bMin..bMax] on slice s.
// lo = min index, hi = max index + 1 (so a single voxel -> a unit quad).
export const FACE_GEO = {
  px: {
    normal: [1, 0, 0],
    N: 'x', A: 'y', B: 'z',
    quad: (aMin, aMax, bMin, bMax, s) => {
      const aLo = aMin, aHi = aMax + 1, bLo = bMin, bHi = bMax + 1, p = s + 1;
      return [[p, aLo, bHi], [p, aLo, bLo], [p, aHi, bLo], [p, aHi, bHi]];
    },
  },
  nx: {
    normal: [-1, 0, 0],
    N: 'x', A: 'y', B: 'z',
    quad: (aMin, aMax, bMin, bMax, s) => {
      const aLo = aMin, aHi = aMax + 1, bLo = bMin, bHi = bMax + 1, p = s;
      return [[p, aLo, bLo], [p, aLo, bHi], [p, aHi, bHi], [p, aHi, bLo]];
    },
  },
  py: {
    normal: [0, 1, 0],
    N: 'y', A: 'x', B: 'z',
    quad: (aMin, aMax, bMin, bMax, s) => {
      const aLo = aMin, aHi = aMax + 1, bLo = bMin, bHi = bMax + 1, p = s + 1;
      return [[aLo, p, bHi], [aHi, p, bHi], [aHi, p, bLo], [aLo, p, bLo]];
    },
  },
  ny: {
    normal: [0, -1, 0],
    N: 'y', A: 'x', B: 'z',
    quad: (aMin, aMax, bMin, bMax, s) => {
      const aLo = aMin, aHi = aMax + 1, bLo = bMin, bHi = bMax + 1, p = s;
      return [[aLo, p, bLo], [aHi, p, bLo], [aHi, p, bHi], [aLo, p, bHi]];
    },
  },
  pz: {
    normal: [0, 0, 1],
    N: 'z', A: 'x', B: 'y',
    quad: (aMin, aMax, bMin, bMax, s) => {
      const aLo = aMin, aHi = aMax + 1, bLo = bMin, bHi = bMax + 1, p = s + 1;
      return [[aLo, bLo, p], [aHi, bLo, p], [aHi, bHi, p], [aLo, bHi, p]];
    },
  },
  nz: {
    normal: [0, 0, -1],
    N: 'z', A: 'x', B: 'y',
    quad: (aMin, aMax, bMin, bMax, s) => {
      const aLo = aMin, aHi = aMax + 1, bLo = bMin, bHi = bMax + 1, p = s;
      return [[aHi, bLo, p], [aLo, bLo, p], [aLo, bHi, p], [aHi, bHi, p]];
    },
  },
};

const DIM = (dims, axis) => dims['n' + axis];

// Compose a voxel index from tangent coords (a,b) and slice s for a given face.
function idxFor(face, a, b, s, dims) {
  const g = FACE_GEO[face];
  const c = { x: 0, y: 0, z: 0 };
  c[g.N] = s;
  c[g.A] = a;
  c[g.B] = b;
  return voxIndex(c.x, c.y, c.z, dims);
}

function faceColorAt(face, a, b, s, dims, surfaceMask, faceColor) {
  const f = FACE_KEYS.indexOf(face);
  const idx = idxFor(face, a, b, s, dims);
  if (!(surfaceMask[idx] & (1 << f))) return -1;
  const c = faceColor.get(idx * 6 + f);
  return c == null ? -1 : c >>> 0;
}

/** One quad per exposed face. */
export function culledQuads(dims, surfaceMask, faceColor) {
  const quads = [];
  for (const face of FACE_KEYS) {
    const g = FACE_GEO[face];
    const dimN = DIM(dims, g.N);
    const dimA = DIM(dims, g.A);
    const dimB = DIM(dims, g.B);
    for (let s = 0; s < dimN; s++)
      for (let b = 0; b < dimB; b++)
        for (let a = 0; a < dimA; a++) {
          const c = faceColorAt(face, a, b, s, dims, surfaceMask, faceColor);
          if (c < 0) continue;
          quads.push({ normal: g.normal, color: c, corners: g.quad(a, a, b, b, s) });
        }
  }
  return quads;
}

/** Merge coplanar same-color faces per slice (classic greedy meshing). */
export function greedyQuads(dims, surfaceMask, faceColor) {
  const quads = [];
  for (const face of FACE_KEYS) {
    const g = FACE_GEO[face];
    const dimN = DIM(dims, g.N);
    const dimA = DIM(dims, g.A);
    const dimB = DIM(dims, g.B);
    // Packed colors set the alpha byte (>2^31), so they must live in a Uint32
    // array; presence is tracked separately (a color could equal any bit
    // pattern, so no in-band sentinel is safe).
    const cell = new Uint32Array(dimA * dimB);
    const has = new Uint8Array(dimA * dimB);
    const used = new Uint8Array(dimA * dimB);

    for (let s = 0; s < dimN; s++) {
      used.fill(0);
      for (let b = 0; b < dimB; b++)
        for (let a = 0; a < dimA; a++) {
          const c = faceColorAt(face, a, b, s, dims, surfaceMask, faceColor);
          const j = b * dimA + a;
          has[j] = c < 0 ? 0 : 1;
          cell[j] = c < 0 ? 0 : c;
        }

      for (let b = 0; b < dimB; b++) {
        for (let a = 0; a < dimA; a++) {
          const base = b * dimA + a;
          if (!has[base] || used[base]) continue;
          const c = cell[base];

          // grow width along A
          let w = 1;
          while (
            a + w < dimA &&
            has[base + w] &&
            cell[base + w] === c &&
            !used[base + w]
          )
            w++;

          // grow height along B while the whole row segment matches
          let h = 1;
          grow: for (; b + h < dimB; h++) {
            for (let k = 0; k < w; k++) {
              const j = (b + h) * dimA + a + k;
              if (!has[j] || cell[j] !== c || used[j]) break grow;
            }
          }

          for (let db = 0; db < h; db++)
            for (let da = 0; da < w; da++) used[(b + db) * dimA + a + da] = 1;

          quads.push({
            normal: g.normal,
            color: c,
            corners: g.quad(a, a + w - 1, b, b + h - 1, s),
          });
        }
      }
    }
  }
  return quads;
}

export function faceQuads(dims, surfaceMask, faceColor, greedy = true) {
  return greedy
    ? greedyQuads(dims, surfaceMask, faceColor)
    : culledQuads(dims, surfaceMask, faceColor);
}
