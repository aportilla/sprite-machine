// ---------------------------------------------------------------------------
// `ring` slice — the 3D Sprite Atlas's settings and its SHEET CHANNEL. The
// settings (view count, elevation, first-angle offset, the tile's edge in
// px) are app-level and session-only, the prefs discipline: one ring,
// whichever document is active, nothing persisted (per-document settings in
// a PNG chunk are the planned follow-up — docs/sprite-atlas-plan.md §8).
// Written by the windoid's controls strip and File → Export Sprite Atlas…'s
// fields (the same settings, two surfaces — the dialog edits LIVE, no
// pending state), and by the ?ring capture hook; read by the renderer's
// follower (scene/ring.js), the windoid body, and shell/windows.js (the
// windoid's height follows the tile size — docs/ring-size-plan.md).
//
// THE SHEET CHANNEL is the doc's `onLive` shape — hot, imperative, never
// through the store: the follower publishes the rendered sheet canvas (by
// reference) after every render, which lands per rebuild frame during a
// stroke; a store patch per frame would re-render every subscriber's
// template for pixels only the windoid's cells paint. `sheet()` hands a late
// subscriber (a reconnected windoid body) the last one.
//
// Every setter clamps, rounds to an integer, treats NaN as a no-op (a
// vf-number-field's valueAsNumber is NaN mid-edit) and is silent on an
// unchanged value (the shell slice's idiom).
// ---------------------------------------------------------------------------

import { createStore } from './store.js';
import { SOFTWARE } from './files.js';

export const RING_DEFAULTS = { views: 4, elevation: 45, offset: 0, size: 64 };
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

/** The export's own text chunk: the settings, the frame, the anchor and the
 *  yaw list — enough for an engine importer to slice and align the sheet. */
export const RING_CHUNK_KEY = 'sprite-machine:ring';

/**
 * @typedef {{views: number, elevation: number, offset: number, size: number}} RingSettings
 * @typedef {{canvas: HTMLCanvasElement, frame: number, views: number}} RingSheet
 *   canvas: the whole strip, `views` frames of `frame` px side by side.
 */

const int = (v) => (Number.isFinite(v) ? Math.round(v) : NaN);
const clampInt = (v, lo, hi) => Math.min(Math.max(int(v), lo), hi);

export function createRing() {
  const store = createStore({ ...RING_DEFAULTS });
  /** @type {RingSheet|null} */
  let sheet = null;
  /** @type {Set<(s: RingSheet|null) => void>} */
  const listeners = new Set();

  const set = (key, v) => {
    if (Number.isNaN(v) || store.get()[key] === v) return;
    store.patch({ [key]: v });
  };

  return {
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

    /** The follower's publish: stores the sheet by reference and calls every
     *  listener with it (null: no model — the cells show paper). */
    publishSheet(s) {
      sheet = s;
      for (const fn of listeners) fn(s);
    },
    /** The last published sheet, or null. */
    sheet() {
      return sheet;
    },
    /** @param {(s: RingSheet|null) => void} fn  @returns {() => void} unsubscribe */
    onSheet(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/**
 * The metadata chunks the export writes beside the pixels (pure; the
 * exporter passes what it knows): a Title naming the sheet after the
 * document, the Software marker, and the ring chunk's JSON — the settings,
 * then the frame (equal to `size`; an importer reading `frame` keeps
 * working), the DERIVED px per voxel (`scale`, a float — how an engine
 * relates the sprite's px to the lattice's units), the anchor and the yaw
 * list.
 * @param {string} name  the document's name
 * @param {RingSettings} settings
 * @param {{frame: number, scale: number, anchor: {x: number, y: number}, yaws: number[]}} geometry
 * @returns {Record<string, string>}
 */
export function ringMetaChunks(name, settings, { frame, scale, anchor, yaws }) {
  const { views, elevation, offset, size } = settings;
  return {
    Title: `${name} atlas`,
    Software: SOFTWARE,
    [RING_CHUNK_KEY]: JSON.stringify({
      views,
      elevation,
      offset,
      size,
      frame,
      scale,
      anchor: { x: anchor.x, y: anchor.y },
      yaws: [...yaws],
    }),
  };
}

// The app-wide singleton (one ring per page, like the prefs).
export const ring = createRing();
