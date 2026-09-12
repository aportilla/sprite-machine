// Ingest: a sprite image to occupancy and color typed arrays, at native size. No
// THREE or DOM.
//
// Tiles are not cropped to their alpha bounds. A texel's place in its tile is its
// lattice position and must line up across faces.
//
// Input is ImageData-like { width, height, data } with RGBA bytes. Colors pack into
// a Uint32 as bytes r, g, b, a, little-endian.

// Sprites are hard pixel art. A texel is solid at alpha >= 128, which tolerates the
// ±1 alpha noise privacy browsers add to canvas reads.
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

// Mirror an image horizontally (flipX) and/or vertically (flipY). With both false
// it returns the same object, otherwise a new copy.
export function flip(img, flipX, flipY) {
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
 * Reorient a sprite to the pipeline's view conventions before ingest. rot is
 * quarter-turns clockwise (0-3). Flips apply after the rotation.
 * @param {{width,height,data}} img
 * @param {{rot?:number, flipX?:boolean, flipY?:boolean}} t
 */
export function applyTransform(img, t = {}) {
  let out = img;
  const rot = (((t.rot || 0) % 4) + 4) % 4;
  for (let i = 0; i < rot; i++) out = rot90cw(out);
  return flip(out, !!t.flipX, !!t.flipY);
}

/**
 * Occupancy and color for a whole tile at native size. A fully transparent tile
 * returns null and counts as absent.
 * @param {{width:number,height:number,data:ArrayLike<number>}} img
 * @returns {{w:number,h:number,occ:Uint8Array,rgb:Uint32Array} | null}
 */
export function ingestSprite(img) {
  const { width: W, height: H, data } = img;
  if (!(W > 0) || !(H > 0) || !data || data.length < W * H * 4) {
    throw new Error(
      `ingestSprite: expected {width>0, height>0, data.length>=w*h*4}, got ` +
        `${W}×${H} with ${data ? data.length : 'no'} bytes.`
    );
  }
  const occ = new Uint8Array(W * H);
  const rgb = new Uint32Array(W * H);
  let any = false;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4;
      if (data[si + 3] >= ALPHA_SOLID) {
        const di = y * W + x;
        occ[di] = 1;
        rgb[di] = packRGBA(data[si], data[si + 1], data[si + 2], 255);
        any = true;
      }
    }
  }
  if (!any) return null;
  return { w: W, h: H, occ, rgb };
}

/**
 * Copy a view into a targetW × targetH grid at native scale with its (0,0) texel
 * at (offX, offY). Uncovered cells stay empty and texels outside are clipped.
 * @returns {{occ:Uint8Array, rgb:Uint32Array}}
 */
export function placeView(view, targetW, targetH, offX, offY) {
  const { w, h, occ, rgb } = view;
  if (w === targetW && h === targetH) return { occ, rgb }; // assumes offX = offY = 0
  const outOcc = new Uint8Array(targetW * targetH);
  const outRgb = new Uint32Array(targetW * targetH);
  for (let sy = 0; sy < h; sy++) {
    const ty = sy + offY;
    if (ty < 0 || ty >= targetH) continue;
    for (let sx = 0; sx < w; sx++) {
      const tx = sx + offX;
      if (tx < 0 || tx >= targetW) continue;
      const di = ty * targetW + tx;
      const si = sy * w + sx;
      outOcc[di] = occ[si];
      outRgb[di] = rgb[si];
    }
  }
  return { occ: outOcc, rgb: outRgb };
}
