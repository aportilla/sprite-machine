// ---------------------------------------------------------------------------
// Shared default options. Centralized so the pipeline, the mesh builders, and
// the UI can never drift on what "the defaults" are. Import and spread
// (`{ ...DEFAULT_MIRROR }`) rather than mutating these objects in place.
// ---------------------------------------------------------------------------

import { packRGBA } from './ingest.js';
import { hexToRgb } from './color.js';

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
// sensible. Each entry is { packed:uint32 (a=255), css:'#rrggbb', rgb:{r,g,b} };
// `css` is the source of truth and `packed`/`rgb` are derived from it so they
// can't drift (and the editor reads `rgb` directly instead of re-parsing css).
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
  const rgb = hexToRgb(css);
  return { packed: packRGBA(rgb.r, rgb.g, rgb.b, 255), css, rgb };
});

// ---------------------------------------------------------------------------
// PALETTE_256 — the full color palette shown persistently in the tile editor as
// a 16x16 grid: 256 DISTINCT colors laid out along a space-filling Hilbert curve
// (a locality-preserving 1-D color order poured into the grid along a 2-D Hilbert
// curve), so similar colors cluster both across and down: grayscale in the
// top-left, magentas/reds along the top, blues down the right, greens/cyans
// sweeping the bottom. This is a fixed, hand-verified arrangement, so it's
// spelled out literally below — one source row per grid row (PALETTE_256_ROWS).
//
// It's the standard xterm-256 set, with one wrinkle: xterm-256 names 256 indexed
// SLOTS but only 247 DISTINCT colors — 9 slots repeat a value where its system,
// 6x6x6 cube, and grayscale ranges overlap (#000000, #ffffff, #808080 and the
// six bright primaries/secondaries #ff0000/#00ff00/#ffff00/#0000ff/#ff00ff/
// #00ffff each land in two slots). Rather than waste nine cells on duplicates,
// each redundant copy is replaced by a filler INTERPOLATED from that cell's
// orthogonal Hilbert neighbors, so every one of the 256 cells is a distinct color
// that still sits naturally in its local cluster. The nine fillers are:
//   r0c1 #3f3f3f  r0c3 #7b7b7b  r0c10 #bc2087  r5c2 #ffafa2  r5c4 #bc674d
//   r5c15 #20009f r6c6 #b95151  r11c4 #75f24d  r13c13 #65e1eb
// (test/palette.test.mjs pins the 256-distinct invariant so a slip is caught).
// The array order is display-only: swatch identity never depends on the index.
// Each entry is { packed, css } to match PENCIL_PALETTE.
//
// WEDGE-SAFETY: the previous palette was a sparse 8x8x4 grid whose swatches were
// all >=36/channel apart, so the low-poly wedge gate (wedge-mesh.js sameMat,
// TOL2 = 12*12 squared-L2 on RGB) could never fuse two DISTINCT swatches — the
// artist had exact control over which corners smooth vs. stay crisp. xterm-256 is
// denser, so some adjacent swatches DO fall within the gate. Recomputed against the
// real PALETTE_256 with the real TOL2 there are 16 within-tolerance pairs:
//   - 10 near-neutral grays (the grayscale ramp + the two near-neutral fillers
//     #3f3f3f/#7b7b7b step ~5-10/channel), plus
//   - 6 FULLY SATURATED dark primaries/secondaries, where an xterm SYSTEM color
//     (channel 0x80=128) lands ~7-10 units from the matching 6x6x6-cube level
//     (0x87=135) at the same hue: #800000/#870000 (maroon), #000080/#000087 (navy),
//     #008000/#008700 (green), #800080/#870087 (purple), #808000/#878700 (olive),
//     #008080/#008787 (teal).
// So an author CAN place two of these on adjacent staircase voxels and get an
// unintended wedge — it's NOT "only near-neutrals". Impact is narrow (near-identical
// dark colors; a ~7-10 unit false-merge is nearly imperceptible). The 6x6x6 cube
// LEVELS {0,95,135,175,215,255} still stay >=40 apart *within* the cube; it's the
// system-vs-cube overlap at the low end that adds the six saturated pairs.
// test/palette.test.mjs pins the exact within-tolerance set, so any future palette
// edit that introduces a new near-duplicate must be consciously accepted.
// ---------------------------------------------------------------------------
// prettier-ignore — one row per grid row keeps the source mirroring the layout.
const PALETTE_256_ROWS = [
  '000000 3f3f3f 767676 7b7b7b 808080 949494 9e9e9e a8a8a8 af5f87 af5faf bc2087 d7005f d70087 d700af ff5f87 ff87af',
  '121212 080808 6c6c6c 626262 878787 8a8a8a b2b2b2 afafaf 875f87 ff5fff af0087 af00af ff0087 d700d7 d75f87 ff005f',
  '1c1c1c 3a3a3a 444444 5f5f5f e4e4e4 dadada bcbcbc c0c0c0 ff5faf ff5fd7 d787af af87af ff00af 800080 5f005f af005f',
  '262626 303030 4e4e4e 585858 eeeeee d7d7d7 d0d0d0 c6c6c6 d75fd7 d75faf d787d7 ffafff ff00d7 ff00ff 87005f 870087',
  'ffff87 ffff5f ffd7d7 ffafaf ffffff 800000 870000 af0000 d7afff ffd7ff d7afd7 ffafd7 5f00ff 5f00d7 00005f 000080',
  'ffffaf ffff00 ffafa2 ffaf87 bc674d 5f0000 d70000 ff0000 d787ff d75fff ff87d7 ff87ff 8700af 5f00af 5f0087 20009f',
  'ffffd7 afaf87 ff8787 d7afaf d7875f d75f5f b95151 875f5f af5fff af87ff 875fd7 875faf 8700d7 8700ff 0000af 0000d7',
  'd7d7af afaf5f ff875f ff5f5f ff5f00 d78787 af8787 af5f5f af5fd7 af87d7 875fff d700ff af00ff af00d7 000087 0000ff',
  'd7af87 d7d75f d7af00 d7d700 5fffaf 87ff87 87ffaf 5faf5f 5faf87 00d700 00d75f 008000 5f5fd7 005fff 0087ff 005fd7',
  'd7d787 d7af5f ffaf5f ffaf00 5fff87 5fff5f 5f875f 87af87 00af00 00af5f 005f00 008700 5f5faf 5f5f87 5f5fff 005faf',
  '878700 af875f ffd700 ffd75f 00ff5f 00ff87 5fd75f 87d7af 0087d7 0087af 005f5f 005f87 5fafff 8787ff 8787d7 5f87af',
  'af8700 87875f ffd7af ffd787 75f24d 00ff00 5fd787 87d787 5f8787 008787 00875f 008080 5f87ff 5f87d7 87afd7 8787af',
  'afaf00 d78700 afd75f 5fd700 5fff00 87d700 d7ffd7 afd7af 87afaf 5fafaf 5fd7d7 00ffff 00ffaf 00ffd7 afd7ff d7d7ff',
  '808000 ff8700 87d75f afd787 87ff5f 87ff00 afffd7 afffaf 00af87 5fafd7 5fd7af 87d7d7 5fd7ff 65e1eb afafff 87afff',
  '5f5f00 d75f00 5f8700 87af00 afd700 afff87 d7ff00 d7ffaf 00afaf 00d787 00d7af afd7d7 5fffd7 87ffd7 87ffff afafd7',
  '875f00 af5f00 87af5f 5faf00 afff00 afff5f d7ff5f d7ff87 00afd7 00afff 00d7d7 00d7ff 5fffff 87d7ff afffff d7ffff',
];

export const PALETTE_256 = PALETTE_256_ROWS.flatMap((row) =>
  row.split(' ').map((h) => {
    const css = `#${h}`;
    const rgb = hexToRgb(css);
    return { packed: packRGBA(rgb.r, rgb.g, rgb.b, 255), css, rgb };
  })
);
