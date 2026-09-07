// ---------------------------------------------------------------------------
// `ring` slice — the 3D Sprite Atlas's settings and its SHEET CHANNEL. The
// settings (view count, elevation, first-angle offset, the tile's edge in
// px, and the body's paper) are app-level and session-only, the prefs
// discipline: one ring, whichever document is active, nothing persisted
// (per-document settings in a PNG chunk are the planned follow-up —
// docs/sprite-atlas-plan.md §8). Written by the windoid's controls strip and
// File → Export Sprite Atlas…'s fields (the same settings, two surfaces —
// the dialog edits LIVE, no pending state; the paper has no control today
// — see RING_PAPERS — a viewing choice the export never carries), and by
// the ?ring capture hook; read by the renderer's follower (scene/ring.js),
// the windoid body, and shell/windows.js (the windoid's height follows the
// tile size — docs/ring-size-plan.md).
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

export const RING_DEFAULTS = {
  views: 4,
  elevation: 45,
  offset: 0,
  size: 64,
  paper: 'white',
};
/** The body's PAPER — the three the slice admits, each naming the kit
 *  pattern the windoid paints for it (vintage-frames docs/PATTERNS.md):
 *  `white` and `black` are the flat fills, and `gray` is the `dots` motif
 *  — a 1-bit surface shows gray as a dither, and dots is the paper the
 *  atlas wore before there was a setting. A VIEWING setting: the frames
 *  render over a transparent clear, so the export carries no paper and
 *  the chunk omits it. The default is white — and today NOTHING in the UI
 *  writes it (a radio column in the strip was built and retired on
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

/** The export's own text chunk: the settings, the frame, the anchor and the
 *  yaw list — enough for an engine importer to slice and align the sheet
 *  (the TexturePacker JSON beside the PNG carries the same record, in the
 *  shape engines already read — `texturePackerJson`). */
export const RING_CHUNK_KEY = 'sprite-machine:ring';

/**
 * @typedef {{views: number, elevation: number, offset: number, size: number, paper: string}} RingSettings
 *   paper: a RING_PAPERS key.
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
    /** @param {string} name  a RING_PAPERS key; anything else is a no-op
     *  (the NaN rule's shape — a stray value changes nothing) */
    setPaper(name) {
      if (!Object.hasOwn(RING_PAPERS, name)) return;
      set('paper', name);
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
 * @typedef {{frame: number, scale: number, anchor: {x: number, y: number}, yaws: number[]}} RingGeometry
 *   frame: the tile's edge in px (equal to `size`); scale: the DERIVED px
 *   per voxel, a float; anchor: where the lattice floor's center lands in
 *   every frame (the feet-row); yaws: one per view, in sheet order.
 */

/** The ring's own record — the settings (the four the sheet depends on;
 *  the paper is the windoid's own and never written), then the frame (an
 *  importer reading `frame` keeps working), the scale (how an engine relates
 *  the sprite's px to the lattice's units), the anchor and the yaw list. The
 *  one object the PNG chunk and the TexturePacker JSON both carry.
 *  @param {Pick<RingSettings, 'views'|'elevation'|'offset'|'size'>} settings
 *  @param {RingGeometry} geometry */
function ringRecord({ views, elevation, offset, size }, { frame, scale, anchor, yaws }) {
  return {
    views,
    elevation,
    offset,
    size,
    frame,
    scale,
    anchor: { x: anchor.x, y: anchor.y },
    yaws: [...yaws],
  };
}

/**
 * The metadata chunks the export writes beside the pixels (pure; the
 * exporter passes what it knows): a Title naming the sheet after the
 * document, the Software marker, and the ring chunk's JSON — `ringRecord`.
 * @param {string} name  the document's name
 * @param {Pick<RingSettings, 'views'|'elevation'|'offset'|'size'>} settings
 * @param {RingGeometry} geometry
 * @returns {Record<string, string>}
 */
export function ringMetaChunks(name, settings, geometry) {
  return {
    Title: `${name} atlas`,
    Software: SOFTWARE,
    [RING_CHUNK_KEY]: JSON.stringify(ringRecord(settings, geometry)),
  };
}

/**
 * The sheet's TexturePacker JSON (the "JSON hash" flavor — what Phaser,
 * PixiJS and the Godot / Unity importers load by filename pair; pure): one
 * frame per view, keyed `«slug»-«index»` in yaw order, each an untrimmed,
 * unrotated `frame`×`frame` box at its column of the strip, carrying the
 * engine anchor as its normalized **pivot** (TexturePacker's own field: x
 * right, y DOWN from the frame's top-left, 0..1 — so the feet-row becomes
 * the origin an engine actually uses, with no reader code — rounded to
 * four places, TexturePacker's own short decimals: under 0.03 px of error
 * at the 255-px ceiling, while the record below keeps the anchor exact); an
 * `animations` block naming the ring as one sequence in that order (the
 * TexturePacker extension PixiJS's AnimatedSprite reads); and `meta` in
 * TexturePacker's shape (`app`, `version`, `image` — the sibling PNG's
 * filename — `format`, the sheet `size`, `scale`) plus the ring's own
 * record under a `sprite-machine` key (loaders ignore keys they don't
 * know — the same object as the PNG chunk).
 * @param {string} slug  the document's filename slug (the frame keys' prefix)
 * @param {Pick<RingSettings, 'views'|'elevation'|'offset'|'size'>} settings
 * @param {RingGeometry} geometry
 * @param {{image: string, version: string}} file  the PNG's filename beside
 *   this JSON, and the app version the meta names
 * @returns {object}  JSON-ready (the exporter stringifies it)
 */
export function texturePackerJson(slug, settings, geometry, { image, version }) {
  const { frame, anchor, yaws } = geometry;
  const keys = yaws.map((_, i) => `${slug}-${i}`);
  const short = (v) => Math.round(v * 1e4) / 1e4;
  const pivot = { x: short(anchor.x / frame), y: short(anchor.y / frame) };
  /** @type {Record<string, object>} */
  const frames = {};
  keys.forEach((key, i) => {
    frames[key] = {
      frame: { x: i * frame, y: 0, w: frame, h: frame },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: frame, h: frame },
      sourceSize: { w: frame, h: frame },
      pivot: { ...pivot },
    };
  });
  return {
    frames,
    animations: { [slug]: keys },
    meta: {
      app: 'sprite-machine',
      version,
      image,
      format: 'RGBA8888',
      size: { w: yaws.length * frame, h: frame },
      scale: '1',
      'sprite-machine': ringRecord(settings, geometry),
    },
  };
}

// The app-wide singleton (one ring per page, like the prefs).
export const ring = createRing();
