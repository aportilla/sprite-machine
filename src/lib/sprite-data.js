// ---------------------------------------------------------------------------
// Built-in samples + a grid -> ImageData helper. Both samples are 3x2 atlases
// (LEFT FRONT TOP / RIGHT BACK BOTTOM), so they flow through the same atlas
// path as a user-dropped sheet.
// ---------------------------------------------------------------------------

import carAtlasUrl from '../assets/car-atlas.png';

/** @returns {ImageData} */
export function gridToImageData(rows, palette) {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.' || ch === ' ') continue;
      const c = palette[ch];
      const i = (y * w + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

// --- Cube: reference demo, generated as a 3x2 atlas of solid tiles ----------
// Row 0: left(tan) front(magenta) top(teal). Row 1 blank -> mirror-X fills the
// right, back/bottom fall back (matches the original reference cube).
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
};

// --- Car: a real 40x40 3x2 atlas (LEFT FRONT TOP / RIGHT BACK BOTTOM) --------
// A taxi drawn to the pipeline conventions (square tiles) -> no transforms.
// Faces left blank mirror-fill from their opposite.
export const CAR_ATLAS_SAMPLE = {
  name: 'Car',
  atlas: { url: carAtlasUrl }, // layout + 40x40 tiles auto-derived from 120x80
};

// Order sets the picker-menu order; the first entry is the default loaded on
// boot (?sample=<index|name> overrides). Car first — it's the showcase sprite.
export const SAMPLES = [CAR_ATLAS_SAMPLE, CUBE_SAMPLE];
