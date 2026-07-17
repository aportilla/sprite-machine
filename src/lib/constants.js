// ---------------------------------------------------------------------------
// Shared default options. Centralized so the pipeline, the mesh builders, and
// the UI can never drift on what "the defaults" are. Import and spread
// (`{ ...DEFAULT_MIRROR }`) rather than mutating these objects in place.
// ---------------------------------------------------------------------------

import { packRGBA } from './ingest.js';

/**
 * Per-axis mirror-fill: a face with no view of its own is always filled from the
 * mirrored opposite view. On for every axis — objects are treated as symmetric,
 * so a half-drawn sheet (e.g. no LEFT/BACK/BOTTOM) still colors every face.
 */
export const DEFAULT_MIRROR = { x: true, y: true, z: true };

/** World-space size the largest grid axis is scaled to fill. */
export const DEFAULT_WORLD_SIZE = 2.5;

// ---------------------------------------------------------------------------
// PENCIL_PALETTE — the fixed DB16 (DawnBringer 16) ramp used only by the in-app
// tile editor's brush. This is an AUTHORING palette, distinct from the per-sprite
// RENDER palette derived by colorize.js (buildPalette). Drawn pixels are already
// exact palette colors, so the render-time palette snap is a no-op on them.
//
// Why DB16 is safe against the low-poly wedge merge: `sameMat` fuses two faces
// whose colors are within ~12 Euclidean units (wedge-mesh.js). DB16's minimum
// pairwise distance is ~47 (between #442434 and #4e4a4e), so no two distinct
// swatches can ever false-merge into a smooth wedge. Its neutral grays also keep
// palette[0] body-color fallbacks
// sensible. Each entry is { packed:uint32 (a=255), css:'#rrggbb' }; `css` is the
// source of truth and `packed` is derived from it so the two can't drift.
// ---------------------------------------------------------------------------
const DB16_HEX = [
  '#140c1c',
  '#442434',
  '#30346d',
  '#4e4a4e',
  '#854c30',
  '#346524',
  '#d04648',
  '#757161',
  '#597dce',
  '#d27d2c',
  '#8595a1',
  '#6daa2c',
  '#d2aa99',
  '#6dc2ca',
  '#dad45e',
  '#deeed6',
];

export const PENCIL_PALETTE = DB16_HEX.map((css) => {
  const r = parseInt(css.slice(1, 3), 16);
  const g = parseInt(css.slice(3, 5), 16);
  const b = parseInt(css.slice(5, 7), 16);
  return { packed: packRGBA(r, g, b, 255), css };
});

// ---------------------------------------------------------------------------
// WEDGE_SAFE_256 — the full 256-color palette shown persistently in the tile
// editor. An 8x8x4 RGB grid (the classic 8-bit "3-3-2" layout: 8 reds x 8 greens
// x 4 blues), ordered blue-major so a 16-wide grid reads as four constant-blue
// bands.
//
// Deliberately NOT a dense artist ramp (e.g. AAP-256): the low-poly wedge gate
// (wedge-mesh.js sameMat, TOL2 = 12*12) fuses two touching faces into a smooth
// 45-degree ramp whenever their colors sit within ~12 per channel. That is the
// artist's exact, local control over every wedge — same color => ramp, different
// => crisp step. A dense palette with sub-12 neighbors would silently merge
// corners the artist wanted sharp. This 8x8x4 grid keeps every distinct swatch
// >=36 apart (the min red/green step) — a comfortable 3x the ~12 slack, like
// DB16's ~47 minimum — so a pick from it can never false-merge. Finer shades stay
// reachable via the custom picker, which warns when a pick lands within the slack
// of a color already on the tile.
//
// Blue uses {0,73,146,255} rather than four even quarters so that r==g==b lands
// on four true neutrals (black, two mid-grays, white) while full blue (255) is
// still present. Each entry is { packed, css } to match PENCIL_PALETTE.
// ---------------------------------------------------------------------------
const RG_LEVELS = [0, 36, 73, 109, 146, 182, 219, 255]; // 8 even levels, ~36 apart
const B_LEVELS = [0, 73, 146, 255]; // 4 levels; with r==g gives black/white + 2 grays
const cubeHex2 = (n) => n.toString(16).padStart(2, '0');

export const WEDGE_SAFE_256 = [];
for (const b of B_LEVELS) {
  for (const g of RG_LEVELS) {
    for (const r of RG_LEVELS) {
      WEDGE_SAFE_256.push({
        packed: packRGBA(r, g, b, 255),
        css: `#${cubeHex2(r)}${cubeHex2(g)}${cubeHex2(b)}`,
      });
    }
  }
}
