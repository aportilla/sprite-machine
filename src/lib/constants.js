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
// PALETTE_168 — the full color palette shown in the tile editor's Colors dialog
// as a 21x8 grid: 168 DISTINCT NAMED colors, laid out as value-banded hue rows.
// Row 1 is the grayscale ramp (White and Black up front, then a 21-step
// dark-to-light run); rows 2-8 each sweep the hue wheel red -> yellow -> green
// -> cyan -> blue -> violet -> magenta at one value band, ordered darkest
// ("darkest", "dark", "deep", "strong", "vivid") down to "light" and "palest" —
// so a column reads roughly as one hue across seven values. This is a fixed,
// hand-verified arrangement, so it's spelled out literally below — one source
// row per grid row (PALETTE_168_ROWS). The array order is display-only: swatch
// identity never depends on the index. Each entry is { packed, css, rgb, name }
// — `css` is the source of truth, `packed`/`rgb` derive from it, and `name` is
// the human color name the dialog's hover readout shows.
//
// WEDGE-SAFETY: the low-poly wedge gate (wedge-mesh.js sameMat, TOL2 = 12*12
// squared-L2 on RGB) fuses two faces whose colors sit within ~12 Euclidean
// units, so palette neighbors closer than that can auto-smooth a staircase the
// author meant to keep stepped. Recomputed against the real PALETTE_168 with
// the real TOL2 there are 8 within-tolerance pairs — all same-hue neighbors in
// the darkest and palest rows (the grayscale ramp steps ~10-13/channel, so
// unlike the old xterm-256 set NO gray pair merges):
//   #625700/#625f00 (Dark Olive/Olive)    #006865/#005e67 (Deep Teal/Petrol)
//   #009a96/#00a39c (Teal/Persian Green)  #ffc9c9/#ffd2ca (Blush/Peach)
//   #fff2c5/#fffbc2 (Vanilla/Cream)       #bef5f9/#bdefff (Ice Blue/Pale Sky)
//   #c8fdff/#cef6ff (Celeste/Pale Cyan)   #bce4f7/#badcf1 (Frost/Glacier)
// So an author CAN place two of these on adjacent staircase voxels and get an
// unintended (near-imperceptible — the pairs are near-identical shades) wedge.
// test/palette.test.mjs pins the exact within-tolerance set, so any future
// palette edit that introduces a new near-duplicate must be consciously
// accepted. The minimum pairwise distance overall is 8 units (Dark Olive vs
// Olive); every other row keeps its neighbors comfortably outside the gate.
// ---------------------------------------------------------------------------
// One [hex, name] entry per line, grouped into one array per grid row, keeps
// the source mirroring the layout.
const PALETTE_168_ROWS = [
  [
    // Row 1 — grayscale ramp
    ['#ffffff', 'White'],
    ['#000000', 'Black'],
    ['#222222', 'Ink'],
    ['#2b2b2b', 'Onyx'],
    ['#353535', 'Charcoal'],
    ['#3f3f3f', 'Graphite'],
    ['#494949', 'Gunmetal'],
    ['#545454', 'Slate Gray'],
    ['#5f5f5f', 'Pewter'],
    ['#6a6a6a', 'Iron'],
    ['#757575', 'Steel'],
    ['#818181', 'Nickel'],
    ['#8c8c8c', 'Stone'],
    ['#989898', 'Ash'],
    ['#a4a4a4', 'Cement'],
    ['#b1b1b1', 'Silver'],
    ['#bdbdbd', 'Platinum'],
    ['#cacaca', 'Fog'],
    ['#d6d6d6', 'Dove Gray'],
    ['#e3e3e3', 'Mist'],
    ['#f0f0f0', 'Porcelain'],
  ],
  [
    // Row 2 — darkest
    ['#7f0004', 'Oxblood'],
    ['#6b0002', 'Maroon'],
    ['#5d1f00', 'Chocolate'],
    ['#5e3f00', 'Sepia'],
    ['#625700', 'Dark Olive'],
    ['#625f00', 'Olive'],
    ['#006c00', 'Forest Green'],
    ['#005c00', 'Pine'],
    ['#006421', 'Hunter Green'],
    ['#006c43', 'Evergreen'],
    ['#006865', 'Deep Teal'],
    ['#005e67', 'Petrol'],
    ['#004e69', 'Marine Blue'],
    ['#003f69', 'Prussian Blue'],
    ['#003676', 'Navy'],
    ['#071d89', 'Midnight Blue'],
    ['#1f0061', 'Deep Indigo'],
    ['#490e61', 'Deep Purple'],
    ['#770060', 'Dark Magenta'],
    ['#770545', 'Tyrian Purple'],
    ['#780028', 'Burgundy'],
  ],
  [
    // Row 3 — dark
    ['#bb0001', 'Brick Red'],
    ['#a90004', 'Carmine'],
    ['#a53400', 'Burnt Orange'],
    ['#a06800', 'Ochre'],
    ['#9f8800', 'Antique Gold'],
    ['#9b9a00', 'Brass'],
    ['#319400', 'Kelly Green'],
    ['#007a15', 'Shamrock'],
    ['#008038', 'Fern Green'],
    ['#008664', 'Sea Green'],
    ['#009a96', 'Teal'],
    ['#008da0', 'Ocean Teal'],
    ['#0077a4', 'Cerulean'],
    ['#0063b3', 'Sapphire'],
    ['#00419e', 'Cobalt'],
    ['#0032a9', 'Ultramarine'],
    ['#4b0082', 'Indigo'],
    ['#5f1193', 'Grape'],
    ['#8e1a85', 'Mardi Gras'],
    ['#b80067', 'Cranberry'],
    ['#bb003f', 'Ruby'],
  ],
  [
    // Row 4 — deep
    ['#e51c00', 'Crimson'],
    ['#ff0000', 'Red'],
    ['#e85800', 'Persimmon'],
    ['#e89300', 'Marigold'],
    ['#e3b500', 'Old Gold'],
    ['#cadd00', 'Pear'],
    ['#1cc100', 'Grass Green'],
    ['#179c0f', 'True Green'],
    ['#049c34', 'Clover'],
    ['#00a176', 'Jade'],
    ['#00a39c', 'Persian Green'],
    ['#00a1b6', 'Peacock'],
    ['#43a2cf', 'Azure'],
    ['#0085d4', 'True Blue'],
    ['#005fc3', 'Lapis'],
    ['#0000ff', 'Blue'],
    ['#551ab7', 'Gentian'],
    ['#770fc8', 'French Violet'],
    ['#a42dac', 'Byzantine'],
    ['#e3107a', 'Rose Red'],
    ['#ed004e', 'Cherry'],
  ],
  [
    // Row 5 — strong
    ['#f11632', 'Scarlet'],
    ['#f43d00', 'Vermilion'],
    ['#ff7f00', 'Orange'],
    ['#ffba00', 'Amber'],
    ['#ffe63f', 'Golden Yellow'],
    ['#e3ff52', 'Chartreuse'],
    ['#00e91d', 'Neon Green'],
    ['#00bb34', 'Bright Green'],
    ['#15ba4d', 'Leaf Green'],
    ['#12bd8d', 'Jungle Green'],
    ['#00b7aa', 'Lagoon'],
    ['#00afca', 'Caribbean'],
    ['#00aaec', 'Capri'],
    ['#0a96dc', 'Pacific Blue'],
    ['#006bc8', 'Denim'],
    ['#0039de', 'Royal Blue'],
    ['#5c2eee', 'Han Purple'],
    ['#8f00ff', 'Violet'],
    ['#bc3fd5', 'Deep Fuchsia'],
    ['#ec25ba', 'Hot Magenta'],
    ['#ee1565', 'Amaranth'],
  ],
  [
    // Row 6 — vivid
    ['#fb2f41', 'Poppy'],
    ['#ff5e00', 'Tangerine'],
    ['#ff9a00', 'Orange Peel'],
    ['#ffd200', 'Gold'],
    ['#f7f100', 'Lemon'],
    ['#ffff00', 'Yellow'],
    ['#00ff00', 'Green'],
    ['#2ddb4b', 'Malachite'],
    ['#53d17d', 'Emerald'],
    ['#48d5b2', 'Spearmint'],
    ['#00c8c0', 'Turquoise'],
    ['#00d0de', 'Dark Turquoise'],
    ['#00c2ea', 'Vivid Sky'],
    ['#04b4ff', 'Deep Sky Blue'],
    ['#009ef3', 'Dodger Blue'],
    ['#0079dd', 'French Blue'],
    ['#7a69ee', 'Slate Blue'],
    ['#a36aff', 'Veronica'],
    ['#d350ff', 'Heliotrope'],
    ['#ff00ff', 'Magenta'],
    ['#ff1b9a', 'Neon Pink'],
  ],
  [
    // Row 7 — light
    ['#ff868e', 'Salmon'],
    ['#ffa489', 'Coral'],
    ['#ffc586', 'Apricot'],
    ['#ffe577', 'Buttercup'],
    ['#f9fa73', 'Daffodil'],
    ['#f1ffc1', 'Pale Lime'],
    ['#a2ff79', 'Light Green'],
    ['#8be583', 'Mint Green'],
    ['#8de3a7', 'Mint'],
    ['#79ecd1', 'Seafoam'],
    ['#59f1ec', 'Aquamarine'],
    ['#00ffff', 'Cyan'],
    ['#76e9ff', 'Sky Blue'],
    ['#4bd3fe', 'Maya Blue'],
    ['#5dcaf8', 'Summer Sky'],
    ['#79aff2', 'Jordy Blue'],
    ['#9f94eb', 'Medium Purple'],
    ['#bb9fff', 'Bright Lavender'],
    ['#e199ff', 'Mauve'],
    ['#f889ff', 'Fuchsia Pink'],
    ['#ff81c4', 'Carnation'],
  ],
  [
    // Row 8 — palest
    ['#ffc9c9', 'Blush'],
    ['#ffd2ca', 'Peach'],
    ['#ffe5c7', 'Champagne'],
    ['#fff2c5', 'Vanilla'],
    ['#fffbc2', 'Cream'],
    ['#f7ffd8', 'Parchment'],
    ['#d9fab3', 'Celery'],
    ['#c5ebb6', 'Tea Green'],
    ['#c4f0cf', 'Celadon'],
    ['#c1f3e8', 'Magic Mint'],
    ['#bef5f9', 'Ice Blue'],
    ['#c8fdff', 'Celeste'],
    ['#cef6ff', 'Pale Cyan'],
    ['#bdefff', 'Pale Sky'],
    ['#bce4f7', 'Frost'],
    ['#badcf1', 'Glacier'],
    ['#c9bae4', 'Wisteria'],
    ['#d4ceff', 'Periwinkle'],
    ['#eed3ff', 'Pale Mauve'],
    ['#ffccec', 'Pink Lace'],
    ['#ffc9d7', 'Baby Pink'],
  ],
];

export const PALETTE_168 = PALETTE_168_ROWS.flat().map(([css, name]) => {
  const rgb = hexToRgb(css);
  return { packed: packRGBA(rgb.r, rgb.g, rgb.b, 255), css, rgb, name };
});
