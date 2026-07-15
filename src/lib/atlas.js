// ---------------------------------------------------------------------------
// Atlas slicing: cut a packed sprite sheet into the six named face tiles.
//
// Pure (operates on {width,height,data}, returns the same shape) so it's
// Node-testable and its output drops straight into buildVoxels(). The tile size
// is derived from the image dimensions and the layout grid unless given
// explicitly: a 3x2 layout on a 120x80 sheet => 40x40 tiles.
// ---------------------------------------------------------------------------

// Grid of view names (row-major). null = an intentionally empty cell.
export const DEFAULT_ATLAS_LAYOUT = [
  ['right', 'front', 'top'],
  ['left', 'back', 'bottom'],
];

export function layoutSize(layout) {
  const rows = layout.length;
  const cols = Math.max(...layout.map((r) => r.length));
  return { rows, cols };
}

/**
 * @param {number} width  @param {number} height
 * @param {string[][]} layout
 * @returns {{tileW:number, tileH:number, cols:number, rows:number}}
 */
export function deriveTileSize(width, height, layout = DEFAULT_ATLAS_LAYOUT) {
  const { rows, cols } = layoutSize(layout);
  return { tileW: width / cols, tileH: height / rows, cols, rows };
}

function subTile(img, sx, sy, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((sy + y) * img.width + (sx + x)) * 4;
      const d = (y * w + x) * 4;
      out[d] = img.data[s];
      out[d + 1] = img.data[s + 1];
      out[d + 2] = img.data[s + 2];
      out[d + 3] = img.data[s + 3];
    }
  }
  return { width: w, height: h, data: out };
}

const isBlank = (tile) => {
  for (let i = 3; i < tile.data.length; i += 4) if (tile.data[i] !== 0) return false;
  return true;
};

/**
 * @param {{width:number,height:number,data:ArrayLike<number>}} img
 * @param {{layout?:string[][], tileW?:number, tileH?:number}} [opts]
 * @returns {{views:Record<string,{width,height,data}|null>,
 *            tileW:number, tileH:number, cols:number, rows:number,
 *            warnings:string[]}}
 */
export function sliceAtlas(img, opts = {}) {
  const layout = opts.layout || DEFAULT_ATLAS_LAYOUT;
  const { rows, cols } = layoutSize(layout);
  const warnings = [];

  let tileW = opts.tileW;
  let tileH = opts.tileH;
  if (!tileW || !tileH) {
    tileW = img.width / cols;
    tileH = img.height / rows;
  }
  tileW = Math.round(tileW);
  tileH = Math.round(tileH);

  if (cols * tileW !== img.width || rows * tileH !== img.height) {
    warnings.push(
      `Layout ${cols}x${rows} at ${tileW}x${tileH} tiles = ` +
        `${cols * tileW}x${rows * tileH}px, but image is ${img.width}x${img.height}px. ` +
        `Tiles are read from the top-left; check tile size / layout.`
    );
  }

  const views = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < (layout[r] || []).length; c++) {
      const name = layout[r][c];
      if (!name) continue;
      const sx = c * tileW;
      const sy = r * tileH;
      if (sx + tileW > img.width || sy + tileH > img.height) continue;
      const tile = subTile(img, sx, sy, tileW, tileH);
      views[name] = isBlank(tile) ? null : tile;
    }
  }
  return { views, tileW, tileH, cols, rows, warnings };
}
