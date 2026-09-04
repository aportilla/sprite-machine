// ---------------------------------------------------------------------------
// Ingest: sprite image -> occupancy + color typed arrays, at NATIVE size — the
// tile is NOT cropped. No THREE / no DOM here so it runs unchanged in Node tests.
//
// Strict registration: a tile is a literal slice of the voxel lattice, so texel
// (u,v) maps 1:1 to a fixed lattice line. We deliberately do NOT crop to the
// alpha bounding box — where a pixel sits inside its tile IS its position in the
// object, and must line up across faces (a FRONT pixel only survives the carve
// where the SIDE covers its row and the TOP covers its column). Cropping would
// throw that registration away.
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

// Axis-flip blit: mirror an image horizontally (flipX) and/or vertically (flipY).
// Exported so derive.js's display-only mirrorImage reuses one flip implementation.
// A no-op (both false) returns the SAME object; any flip returns a fresh copy.
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
 * Reorient a sprite so it matches the pipeline's view conventions. Applied
 * before ingest. `rot` is quarter-turns clockwise (0-3); flips run after rot.
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
 * Ingest a sprite at NATIVE size — occupancy/color for the WHOLE tile, no crop.
 * The tile's own dimensions become the view's dimensions, so its texels register
 * 1:1 against the other faces. A fully transparent tile has nothing to constrain
 * and returns null (treated as absent — the mirror partner colors it).
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
  if (!any) return null; // fully transparent -> absent (mirror-filled)
  return { w: W, h: H, occ, rgb };
}

/**
 * Copy a view into a (targetW,targetH) grid buffer at NATIVE scale — no
 * resampling — with its (0,0) texel at (offX,offY). Under strict registration
 * gridViews passes offX=offY=0, so for a well-formed (uniform-tile) sheet every
 * view already equals the grid on the axes it constrains and this is the exact
 * fast-path identity copy below. It stays general only to pad the degenerate
 * case where a malformed sheet gives views of unequal size (origin-anchored,
 * far end left empty); the bounds guards keep that from indexing out of range.
 * @returns {{occ:Uint8Array, rgb:Uint32Array}}
 */
export function placeView(view, targetW, targetH, offX, offY) {
  const { w, h, occ, rgb } = view;
  if (w === targetW && h === targetH) return { occ, rgb }; // exact fit (offX/offY==0)
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
