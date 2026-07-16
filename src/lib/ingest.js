// ---------------------------------------------------------------------------
// Ingest: sprite image -> occupancy + color typed arrays, cropped to the alpha
// bounding box. No THREE / no DOM here so it runs unchanged in Node tests.
//
// Input shape is ImageData-compatible: { width, height, data } where data is an
// RGBA byte array (canvas.getImageData().data in the browser; a plain array in
// tests). Output packs color as a Uint32 (bytes r,g,b,a, little-endian).
// ---------------------------------------------------------------------------

// Sprites are assumed to be HARD pixel art: every texel is either fully opaque
// or fully transparent, no partial coverage. A pixel counts as solid at alpha
// >= 128 — the 50%-coverage midpoint, robust to privacy-browser canvas farbling
// that perturbs a 0/255 alpha by ±1 (see the wedge-mesh farbling note).
const ALPHA_SOLID = 128;

export const packRGBA = (r, g, b, a = 255) =>
  ((r & 255) | ((g & 255) << 8) | ((b & 255) << 16) | ((a & 255) << 24)) >>> 0;

export const unpackRGBA = (v) => ({
  r: v & 255,
  g: (v >>> 8) & 255,
  b: (v >>> 16) & 255,
  a: (v >>> 24) & 255,
});

function rot90cw(img) {
  const { width: W, height: H, data } = img;
  const nW = H,
    nH = W;
  const out = new Uint8ClampedArray(nW * nH * 4);
  for (let dy = 0; dy < nH; dy++) {
    for (let dx = 0; dx < nW; dx++) {
      const sx = dy,
        sy = H - 1 - dx;
      const s = (sy * W + sx) * 4;
      const d = (dy * nW + dx) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
      out[d + 3] = data[s + 3];
    }
  }
  return { width: nW, height: nH, data: out };
}

function flip(img, flipX, flipY) {
  if (!flipX && !flipY) return img;
  const { width: W, height: H, data } = img;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = flipX ? W - 1 - x : x;
      const sy = flipY ? H - 1 - y : y;
      const s = (sy * W + sx) * 4;
      const d = (y * W + x) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
      out[d + 3] = data[s + 3];
    }
  }
  return { width: W, height: H, data: out };
}

/**
 * Reorient a sprite so it matches the pipeline's view conventions. Applied
 * before ingest. `rot` is quarter-turns clockwise (0-3); flips run after rot.
 * @param {{width,height,data}} img
 * @param {{rot?:number, flipX?:boolean, flipY?:boolean}} t
 */
export function applyTransform(img, t = {}) {
  let out = img;
  const rot = ((t.rot || 0) % 4 + 4) % 4;
  for (let i = 0; i < rot; i++) out = rot90cw(out);
  return flip(out, !!t.flipX, !!t.flipY);
}

/**
 * @param {{width:number,height:number,data:ArrayLike<number>}} img
 * @returns {{w:number,h:number,occ:Uint8Array,rgb:Uint32Array,
 *            bbox:{x0:number,y0:number,x1:number,y1:number},
 *            srcW:number, srcH:number} | null}  null if fully transparent.
 */
export function ingestSprite(img) {
  const { width: W, height: H, data } = img;
  if (!(W > 0) || !(H > 0) || !data || data.length < W * H * 4) {
    throw new Error(
      `ingestSprite: expected {width>0, height>0, data.length>=w*h*4}, got ` +
        `${W}×${H} with ${data ? data.length : 'no'} bytes.`
    );
  }
  const solid = (a) => a >= ALPHA_SOLID;

  // Find the occupied bounding box.
  let x0 = W,
    y0 = H,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = data[(y * W + x) * 4 + 3];
      if (solid(a)) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null; // nothing solid

  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const occ = new Uint8Array(w * h);
  const rgb = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((y + y0) * W + (x + x0)) * 4;
      const a = data[si + 3];
      const di = y * w + x;
      if (solid(a)) {
        occ[di] = 1;
        rgb[di] = packRGBA(data[si], data[si + 1], data[si + 2], 255);
      }
    }
  }
  return { w, h, occ, rgb, bbox: { x0, y0, x1, y1 }, srcW: W, srcH: H };
}

/**
 * Nearest-neighbor resample a cropped view to an exact target size, so that
 * projection can index it 1:1 against the reconciled grid.
 * @returns {{occ:Uint8Array, rgb:Uint32Array}}
 */
export function resampleView(view, targetW, targetH) {
  const { w, h, occ, rgb } = view;
  if (w === targetW && h === targetH) return { occ, rgb };
  const outOcc = new Uint8Array(targetW * targetH);
  const outRgb = new Uint32Array(targetW * targetH);
  for (let ty = 0; ty < targetH; ty++) {
    // Sample the source pixel nearest the center of the target texel.
    const sy = Math.min(h - 1, Math.floor(((ty + 0.5) * h) / targetH));
    for (let tx = 0; tx < targetW; tx++) {
      const sx = Math.min(w - 1, Math.floor(((tx + 0.5) * w) / targetW));
      const si = sy * w + sx;
      const di = ty * targetW + tx;
      outOcc[di] = occ[si];
      outRgb[di] = rgb[si];
    }
  }
  return { occ: outOcc, rgb: outRgb };
}
