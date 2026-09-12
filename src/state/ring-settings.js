// Per-document 3D Sprite Atlas settings (ctx.ring), saved in the document PNG
// as a sprite-machine:ring chunk (state/files.js). The app reads the active
// document's settings through state/ring.js. This module does not import the
// workspace, so files.js can import it without a cycle.
//
// Every setter clamps, rounds to an integer, ignores NaN (a vf-number-field's
// valueAsNumber is NaN mid-edit) and does nothing on an unchanged value.
// createRingSettings runs `init` through the setters, so an invalid field
// keeps its default.

import { createStore } from './store.js';

export const RING_DEFAULTS = Object.freeze({
  views: 4,
  elevation: 45,
  offset: 0,
  size: 64,
  paper: 'white',
});
/** Paper name to kit pattern name. Paper affects only the view. The frames
 *  render over a transparent clear and no chunk stores it. No UI sets it. */
export const RING_PAPERS = { white: 'white', black: 'black', gray: 'dots' };
export const RING_MAX_VIEWS = 16;
/** Tile edge bounds in px. The model's lattice is fit to the tile, so px per
 *  voxel is derived. A 16-view sheet at 255 px is 4080 px wide, inside desktop
 *  GPU render-target limits. */
export const RING_MIN_SIZE = 2;
export const RING_MAX_SIZE = 255;

/** PNG text chunk keyword. On a document it holds the four sheet settings
 *  (`ringChunk`). On an exported sheet it also holds the frame, scale, anchor
 *  and yaws (state/ring.js `ringMetaChunks`). The Title and the dimensions tell
 *  the two files apart. */
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
 * @param {Partial<RingSettings>|null} [init]  initial values, validated by the
 *   setters
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
    /** @param {string} name  a RING_PAPERS key. Anything else is ignored. */
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

/** Whether two snapshots are equal on every key. */
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
 * The document chunk's text: the four sheet settings as JSON. Written on every
 * save, defaults included, so a reader never depends on its own defaults.
 * @param {RingChunkSettings} settings  a full snapshot also works (paper is dropped)
 * @returns {string}
 */
export function ringChunk({ views, elevation, offset, size }) {
  return JSON.stringify({ views, elevation, offset, size });
}

/**
 * Parse a document chunk's text for `createRingSettings(init)`. Null for a
 * missing or malformed chunk, or JSON that is not an object. The document then
 * opens at the defaults.
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
