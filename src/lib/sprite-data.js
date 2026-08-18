// ---------------------------------------------------------------------------
// Built-in samples + a grid -> ImageData helper. Both samples are 3x2 atlases
// (LEFT FRONT TOP / RIGHT BACK BOTTOM), so they flow through the same atlas
// path as a user-dropped sheet. They serve two roles: SEEDS (a truly virgin
// boot saves each one as an ordinary stored document — loaders.js
// seedDefaultDocs) and TEMPLATES (the File → New… dialog opens one as a
// fresh untitled copy). Each carries its native square `tile` size so the
// dialog can display it without decoding the atlas.
// ---------------------------------------------------------------------------

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
  tile: 8, // must match cubeAtlasImage()'s generator
};

// --- Car: a real 40x40 3x2 atlas (LEFT FRONT TOP / RIGHT BACK BOTTOM) --------
// A taxi drawn to the pipeline conventions (square tiles) -> no transforms.
// Faces left blank mirror-fill from their opposite.
export const CAR_ATLAS_SAMPLE = {
  name: 'Car',
  atlas: { url: carAtlasUrl }, // layout + 40x40 tiles auto-derived from 120x80
  tile: 40, // must match the shipped car-atlas.png (120×80 / 3×2)
};

// Order sets the New-dialog template order and the seeding order; the first
// entry is the default — the doc a virgin boot opens, and what ?sample boots
// load untitled when the param gives no name. Car first — the showcase sprite.
export const SAMPLES = [CAR_ATLAS_SAMPLE, CUBE_SAMPLE];
