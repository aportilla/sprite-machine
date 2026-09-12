// Color helpers shared by the palettes and the Colors dialog.

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
 * Format {r,g,b} bytes as a `#rrggbb` string.
 * @param {{r:number,g:number,b:number}} c
 * @returns {string}
 */
export const rgbToHex = ({ r, g, b }) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/**
 * Normalize typed hex to `#rrggbb`, or null if it isn't valid. Accepts an
 * optional `#`, 3 or 6 digits, any case and surrounding whitespace.
 * @param {string} text
 * @returns {string|null}
 */
export function normalizeHex(text) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!m) return null;
  const d = m[1].toLowerCase();
  return d.length === 3 ? `#${d[0]}${d[0]}${d[1]}${d[1]}${d[2]}${d[2]}` : `#${d}`;
}

/**
 * A 24-bit key (0xRRGGBB) identifying an opaque color for dedup.
 * @param {{r:number,g:number,b:number}} c
 * @returns {number}
 */
export const rgbKey = ({ r, g, b }) => (r << 16) | (g << 8) | b;
