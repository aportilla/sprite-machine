// Built-in samples and a grid-to-ImageData helper. Each sample is a 3×2 atlas:
// left, front, top over right, back, bottom. A first boot saves each one as a
// stored document (loaders.js seedDefaultDocs), and File → New… opens one as an
// untitled copy. `tile` lets the dialog show the tile size without decoding.

import carAtlasUrl from '../assets/car-atlas.png';

/** @returns {ImageData} */
export function gridToImageData(rows, palette) {
  const h = rows.length;
  if (h === 0) throw new Error('gridToImageData: rows must be non-empty.');
  const w = rows[0].length;
  for (const row of rows) {
    if (row.length !== w) {
      throw new Error(
        `gridToImageData: ragged rows (expected width ${w}, got ${row.length}).`
      );
    }
  }
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.' || ch === ' ') continue;
      const c = palette[ch];
      if (!c)
        throw new Error(`gridToImageData: no palette entry for '${ch}' at (${x},${y}).`);
      const i = (y * w + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

// Cube: a generated atlas of solid tiles. Row 0 is left (tan), front (magenta)
// and top (teal). Row 1 is blank, so those faces mirror-fill.
const CUBE_PAL = { T: [169, 220, 214], M: [199, 125, 214], N: [201, 184, 120] };

function cubeAtlasImage() {
  const tile = 8;
  const grid = [
    ['N', 'M', 'T'],
    ['.', '.', '.'],
  ];
  const rows = [];
  for (const cells of grid)
    for (let ty = 0; ty < tile; ty++)
      rows.push(cells.map((ch) => ch.repeat(tile)).join(''));
  return gridToImageData(rows, CUBE_PAL);
}

export const CUBE_SAMPLE = {
  name: 'Cube',
  atlas: { image: cubeAtlasImage() },
  tile: 8, // must match cubeAtlasImage()'s generator
};

// Car: a taxi with 40×40 tiles. Blank faces mirror-fill from their opposite.
export const CAR_ATLAS_SAMPLE = {
  name: 'Car',
  atlas: { url: carAtlasUrl }, // tile size derived from the 120x80 image
  tile: 40, // must match the shipped car-atlas.png (120×80 / 3×2)
};

// Order is the New… dialog order and the seeding order. The first entry is the
// default: a first boot opens it, and ?sample with no name loads it.
export const SAMPLES = [CAR_ATLAS_SAMPLE, CUBE_SAMPLE];
