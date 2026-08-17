// ---------------------------------------------------------------------------
// Small shared color helpers (pure — no DOM, no THREE). The editor palette build
// (constants.js) and the Colors dialog's used-in-document badge scan
// (sm-color-picker.js) funnel through these so the parse/key/scan logic
// lives in exactly one place.
//
// NOTE: rgbKey is a 24-bit BIG-endian RGB key (0xRRGGBB) for Set/Map dedup of
// OPAQUE colors — deliberately distinct from ingest.js's canonical little-endian
// packRGBA (which carries alpha and drives the render pipeline). This one only
// ever identifies "which color", never round-trips to bytes.
// ---------------------------------------------------------------------------

/**
 * Parse a `#rrggbb` string into {r,g,b} bytes.
 * @param {string} css  a 7-char hex color (leading '#').
 * @returns {{r:number,g:number,b:number}}
 */
export function hexToRgb(css) {
  return {
    r: parseInt(css.slice(1, 3), 16),
    g: parseInt(css.slice(3, 5), 16),
    b: parseInt(css.slice(5, 7), 16),
  };
}

/**
 * A 24-bit key (0xRRGGBB) identifying an opaque color for dedup.
 * @param {{r:number,g:number,b:number}} c
 * @returns {number}
 */
export const rgbKey = ({ r, g, b }) => (r << 16) | (g << 8) | b;

/**
 * Distinct opaque colors in an RGBA byte buffer, as {r,g,b}, in first-seen order.
 * Alpha-0 texels are skipped (the hard-pixel rule: strokes are only ever 0 or 255),
 * so stray RGB under a transparent texel never leaks into the palette.
 * @param {ArrayLike<number>} data  RGBA bytes (w*h*4)
 * @returns {{r:number,g:number,b:number}[]}
 */
export function distinctColors(data) {
  const seen = new Set();
  const out = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  return out;
}
