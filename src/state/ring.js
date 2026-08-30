// ---------------------------------------------------------------------------
// `ring` slice — the 3D Sprite Atlas's settings and its SHEET CHANNEL. The
// settings (view count, elevation, first-angle offset, px per voxel) are
// app-level and session-only, the prefs discipline: one ring, whichever
// document is active, nothing persisted (per-document settings in a PNG
// chunk are the planned follow-up — docs/sprite-atlas-plan.md §8). Written
// by the windoid's controls strip and File → Export Sprite Atlas…'s fields
// (the same settings, two surfaces — the dialog edits LIVE, no pending
// state), and by the ?ring capture hook; read by the renderer's follower
// (scene/ring.js), the windoid body, the status line, and shell/windows.js
// (the windoid's width follows the view count).
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

export const RING_DEFAULTS = { views: 4, elevation: 45, offset: 0, scale: 1 };
/** The view count's ceiling — the strip's width follows it (one cell per
 *  view), and past sixteen a strip is a wall. */
export const RING_MAX_VIEWS = 16;
/** Px per voxel, at most: a 64-tile sheet of sixteen views at 8× is ~14000
 *  px wide, inside every desktop GPU's render-target limit. */
export const RING_MAX_SCALE = 8;

/** The export's own text chunk: the settings, the frame, the anchor and the
 *  yaw list — enough for an engine importer to slice and align the sheet. */
export const RING_CHUNK_KEY = 'sprite-machine:ring';

/**
 * @typedef {{views: number, elevation: number, offset: number, scale: number}} RingSettings
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
    /** @param {number} n  px per voxel, 1..RING_MAX_SCALE */
    setScale(n) {
      set('scale', clampInt(n, 1, RING_MAX_SCALE));
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
 * document, the Software marker, and the ring chunk's JSON.
 * @param {string} name  the document's name
 * @param {RingSettings} settings
 * @param {{frame: number, anchor: {x: number, y: number}, yaws: number[]}} geometry
 * @returns {Record<string, string>}
 */
export function ringMetaChunks(name, settings, { frame, anchor, yaws }) {
  const { views, elevation, offset, scale } = settings;
  return {
    Title: `${name} atlas`,
    Software: SOFTWARE,
    [RING_CHUNK_KEY]: JSON.stringify({
      views,
      elevation,
      offset,
      scale,
      frame,
      anchor: { x: anchor.x, y: anchor.y },
      yaws: [...yaws],
    }),
  };
}

// The app-wide singleton (one ring per page, like the prefs).
export const ring = createRing();
