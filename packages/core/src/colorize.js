// Colorize: a color for every exposed face of every surface voxel. For a face with
// outward normal n, the first of:
//   1. The facing view's texel for the voxel. A view paints every face it passes
//      through, not only the first it meets, so a wall inside a notch takes the
//      art drawn in front of it.
//   2. The opposite view's texel, when mirror-fill is on for the face's axis. The
//      facing view wins where it has paint of its own; the opposite fills what it
//      leaves blank.
//   3. The average of already-colored neighbor faces.
//   4. The dominant body color.
// The carve keeps a voxel only where every plane group covers it, so 1 or 2 finds
// paint for every face whose axis has a view: every face traces back to a texel
// someone painted. 3 and 4 are left for an axis no view observes.
// Sampled and averaged colors snap to the nearest palette color.

import { unpackRGBA, packRGBA } from './ingest.js';
import { voxIndex, unvoxIndex } from './carve.js';
import { VIEWS, FACE_KEYS, FACE_TO_VIEW, FACE_OPPOSITE, FACE_AXIS } from './views.js';
import { DEFAULT_MIRROR } from './constants.js';

/** The distinct colors of all solid view texels. */
export function buildPalette(gviews) {
  const seen = new Set();
  const palette = [];
  for (const gv of Object.values(gviews)) {
    const { occ, rgb } = gv;
    for (let i = 0; i < occ.length; i++) {
      if (!occ[i]) continue;
      const c = rgb[i] >>> 0;
      if (!seen.has(c)) {
        seen.add(c);
        palette.push(c);
      }
    }
  }
  return palette;
}

export function makeSnapper(palette) {
  const cache = new Map();
  const pal = palette.map((c) => ({ c: c >>> 0, ...unpackRGBA(c) }));
  return (color) => {
    const key = color >>> 0;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const { r, g, b } = unpackRGBA(key);
    let best = key;
    let bestD = Infinity;
    for (const p of pal) {
      const d = (r - p.r) ** 2 + (g - p.g) ** 2 + (b - p.b) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p.c;
      }
    }
    cache.set(key, best);
    return best;
  };
}

// Reused projection scratch. sampleView reads it immediately.
const _sampleP = { u: 0, v: 0 };
function sampleView(gv, name, x, y, z, dims) {
  VIEWS[name].projectInto(x, y, z, dims, _sampleP);
  const i = _sampleP.v * gv.imgW + _sampleP.u;
  return gv.occ[i] ? gv.rgb[i] >>> 0 : null;
}

/**
 * @param {Uint8Array} surfaceMask  6-bit exposure per voxel
 * @param {Record<string,{occ,rgb,imgW,imgH}>} gviews
 * @param {{nx,ny,nz}} dims
 * @param {{mirror?:{x?:boolean,y?:boolean,z?:boolean}}} [opts]
 * @returns {{faceColor: Map<number, number>, palette: number[]}}
 *   faceColor key = idx*6 + faceIndex, value = packed RGBA; palette = solid colors.
 */
export function colorize(surfaceMask, gviews, dims, opts = {}) {
  const mirror = { ...DEFAULT_MIRROR, ...(opts.mirror || {}) };
  const palette = buildPalette(gviews);
  const snap = palette.length ? makeSnapper(palette) : (c) => c;
  const faceColor = new Map();
  const pending = []; // faces needing relaxation/fallback

  for (let idx = 0; idx < surfaceMask.length; idx++) {
    const mask = surfaceMask[idx];
    if (!mask) continue;
    const { x, y, z } = unvoxIndex(idx, dims);

    for (let f = 0; f < 6; f++) {
      if (!(mask & (1 << f))) continue;
      const faceKey = FACE_KEYS[f];
      const key = idx * 6 + f;

      // 1. The facing view.
      const facing = FACE_TO_VIEW[faceKey];
      let color = gviews[facing]
        ? sampleView(gviews[facing], facing, x, y, z, dims)
        : null;
      // 2. The mirrored opposite view.
      if (color == null && mirror[FACE_AXIS[faceKey]]) {
        const opp = FACE_TO_VIEW[FACE_OPPOSITE[faceKey]];
        if (gviews[opp]) color = sampleView(gviews[opp], opp, x, y, z, dims);
      }
      if (color != null) faceColor.set(key, snap(color));
      else pending.push({ key, idx, x, y, z, f });
    }
  }

  // 3. Relaxation: average already-colored neighbor faces.
  const TANGENTIAL = {
    x: [
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ],
    y: [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
    ],
    z: [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
    ],
  };
  for (let pass = 0; pass < 4 && pending.length; pass++) {
    const still = [];
    for (const item of pending) {
      const faceKey = FACE_KEYS[item.f];
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      // same voxel, other colored faces
      for (let f2 = 0; f2 < 6; f2++) {
        const c = faceColor.get(item.idx * 6 + f2);
        if (c != null) {
          const u = unpackRGBA(c);
          r += u.r;
          g += u.g;
          b += u.b;
          n++;
        }
      }
      // same face on tangential neighbor voxels
      for (const [dx, dy, dz] of TANGENTIAL[FACE_AXIS[faceKey]]) {
        const ax = item.x + dx,
          ay = item.y + dy,
          az = item.z + dz;
        if (ax < 0 || ay < 0 || az < 0) continue;
        if (ax >= dims.nx || ay >= dims.ny || az >= dims.nz) continue;
        const c = faceColor.get(voxIndex(ax, ay, az, dims) * 6 + item.f);
        if (c != null) {
          const u = unpackRGBA(c);
          r += u.r;
          g += u.g;
          b += u.b;
          n++;
        }
      }
      if (n > 0) {
        faceColor.set(
          item.key,
          snap(packRGBA(Math.round(r / n), Math.round(g / n), Math.round(b / n)))
        );
      } else still.push(item);
    }
    pending.length = 0;
    pending.push(...still);
  }

  // 4. Dominant body color for anything left.
  if (pending.length) {
    const tally = new Map();
    for (const c of faceColor.values()) tally.set(c, (tally.get(c) || 0) + 1);
    let dom = palette[0] ?? packRGBA(200, 200, 200);
    let domN = -1;
    for (const [c, k] of tally) if (k > domN) (domN = k), (dom = c);
    for (const item of pending) faceColor.set(item.key, dom);
  }

  return { faceColor, palette };
}
