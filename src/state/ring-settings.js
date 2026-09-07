// ---------------------------------------------------------------------------
// The 3D Sprite Atlas's SETTINGS — a per-document store (state/workspace.js
// gives every DocContext one as `ctx.ring`, the selection store's idiom):
// the view count, the elevation, the first-angle offset, the tile's edge in
// px, and the body's paper. A document's atlas configuration is the
// document's own — it rides with the document into its PNG (a
// `sprite-machine:ring` text chunk beside the transforms', written by
// state/files.js and read back by every open path), a change dirties the
// document, and the strip, the dialog and the renderer all read the ACTIVE
// document's through the façade in state/ring.js. Pure: this module knows
// nothing about the workspace, so files.js can import it without a cycle.
//
// Every setter clamps, rounds to an integer, treats NaN as a no-op (a
// vf-number-field's valueAsNumber is NaN mid-edit) and is silent on an
// unchanged value (the shell slice's idiom). The constructor's `init` goes
// through the same setters, so a chunk's garbage — a string, a value past
// the range, a key the slice never had — costs nothing but that field.
// ---------------------------------------------------------------------------

import { createStore } from './store.js';

export const RING_DEFAULTS = Object.freeze({
  views: 4,
  elevation: 45,
  offset: 0,
  size: 64,
  paper: 'white',
});
/** The body's PAPER — the three the slice admits, each naming the kit
 *  pattern the windoid paints for it (vintage-frames docs/PATTERNS.md):
 *  `white` and `black` are the flat fills, and `gray` is the `dots` motif
 *  — a 1-bit surface shows gray as a dither, and dots is the paper the
 *  atlas wore before there was a setting. A VIEWING setting: the frames
 *  render over a transparent clear, so the export carries no paper and
 *  neither chunk writes it. The default is white — and today NOTHING in
 *  the UI writes it (a radio column in the strip was built and retired on
 *  2026-09-03; the user's intent is to pick the paper FOR the user one
 *  day, from the sheet's own content — a sprite with a lot of white in
 *  it reads better on black, and the reverse — rather than ask); only
 *  the ?ring= capture hook seeds it. The plumbing is kept for that. */
export const RING_PAPERS = { white: 'white', black: 'black', gray: 'dots' };
/** The view count's ceiling: the strip scrolls past what fits its window,
 *  but a 255-px tile at sixteen views is already a 4080-px sheet, and past
 *  sixteen a ring is a wall. */
export const RING_MAX_VIEWS = 16;
/** The tile's edge in px — greater than 1, less than 256 (the ask); the
 *  model's lattice envelope is fit to it, so px per voxel is derived. A
 *  16-view sheet at 255 is 4080 px wide, inside every desktop GPU's
 *  render-target limit. The default is the engine-friendly power of two —
 *  the editor's own tile ceiling. */
export const RING_MIN_SIZE = 2;
export const RING_MAX_SIZE = 255;

/** The text chunk's keyword — on a DOCUMENT, the four settings the sheet
 *  depends on (`ringChunk`); on an exported sheet, the same four plus the
 *  frame, the anchor and the yaw list (state/ring.js `ringMetaChunks`) —
 *  enough for an engine importer to slice and align it. One keyword: a
 *  reader tells the two files apart by their Title (`«name»` / `«name»
 *  atlas`) and their dimensions, and the settings read the same in both. */
export const RING_CHUNK_KEY = 'sprite-machine:ring';

/**
 * @typedef {{views: number, elevation: number, offset: number, size: number, paper: string}} RingSettings
 *   paper: a RING_PAPERS key.
 * @typedef {Pick<RingSettings, 'views'|'elevation'|'offset'|'size'>} RingChunkSettings
 */

const int = (v) => (Number.isFinite(v) ? Math.round(v) : NaN);
const clampInt = (v, lo, hi) => Math.min(Math.max(int(v), lo), hi);

/**
 * One document's settings store.
 * @param {Partial<RingSettings>|null} [init]  a chunk's settings (or a boot
 *   seed) applied through the setters — anything invalid keeps its default
 */
export function createRingSettings(init = null) {
  const store = createStore({ ...RING_DEFAULTS });

  const set = (key, v) => {
    if (Number.isNaN(v) || store.get()[key] === v) return;
    store.patch({ [key]: v });
  };

  const api = {
    store,
    get: store.get,
    subscribe: store.subscribe,

    /** @param {number} n  1..RING_MAX_VIEWS */
    setViews(n) {
      set('views', clampInt(n, 1, RING_MAX_VIEWS));
    },
    /** @param {number} d  degrees above the horizon, 0..90 */
    setElevation(d) {
      set('elevation', clampInt(d, 0, 90));
    },
    /** @param {number} d  the first view's yaw, normalized into [0, 360) */
    setOffset(d) {
      const i = int(d);
      set('offset', Number.isNaN(i) ? NaN : ((i % 360) + 360) % 360);
    },
    /** @param {number} n  the tile's edge in px, RING_MIN_SIZE..RING_MAX_SIZE */
    setSize(n) {
      set('size', clampInt(n, RING_MIN_SIZE, RING_MAX_SIZE));
    },
    /** @param {string} name  a RING_PAPERS key; anything else is a no-op
     *  (the NaN rule's shape — a stray value changes nothing) */
    setPaper(name) {
      if (!Object.hasOwn(RING_PAPERS, name)) return;
      set('paper', name);
    },
  };

  if (init) {
    api.setViews(init.views);
    api.setElevation(init.elevation);
    api.setOffset(init.offset);
    api.setSize(init.size);
    api.setPaper(init.paper);
  }
  return api;
}

/** Two snapshots that read the same on every key. */
export function sameRingSettings(a, b) {
  return (
    a === b ||
    (a.views === b.views &&
      a.elevation === b.elevation &&
      a.offset === b.offset &&
      a.size === b.size &&
      a.paper === b.paper)
  );
}

/**
 * The document chunk's text: the four settings as JSON. ALWAYS written on
 * a save (unlike the transforms chunk, omitted at identity): a setting's
 * default is the writing version's choice, not a mathematical fact, so a
 * document says what its configuration IS rather than trusting the reader
 * to share its defaults.
 * @param {RingChunkSettings} settings  (a whole snapshot is fine — the paper
 *   is left out)
 * @returns {string}
 */
export function ringChunk({ views, elevation, offset, size }) {
  return JSON.stringify({ views, elevation, offset, size });
}

/**
 * A document chunk's text back to settings — a plain object for
 * `createRingSettings(init)` to validate through its setters. Null for an
 * absent chunk, a torn one, or anything but a JSON object: the document
 * then opens at the defaults, the way a chunkless (older, or foreign) PNG
 * does.
 * @param {string|undefined|null} text
 * @returns {Partial<RingChunkSettings>|null}
 */
export function parseRingChunk(text) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
