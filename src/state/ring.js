// 3D Sprite Atlas state: the active document's settings and the rendered sheet.
//
// The settings API wraps the served context's ctx.ring (state/ring-settings.js).
// The served context is the active one. While no document is active, the last
// served context stays served until it closes. With none served, get() returns
// the defaults and the setters do nothing. subscribe fires on setting changes
// and on a switch to a document with different settings.
//
// The renderer (scene/ring.js) publishes the sheet canvas by reference after
// every render, once per frame during a stroke. Sheet listeners are called
// directly, outside any store, because of that rate. sheet() returns the last
// one for late subscribers.

import { SOFTWARE } from './files.js';
import { workspace as workspaceSingleton } from './workspace.js';
import { RING_DEFAULTS, RING_CHUNK_KEY, sameRingSettings } from './ring-settings.js';

export {
  RING_DEFAULTS,
  RING_PAPERS,
  RING_MAX_VIEWS,
  RING_MIN_SIZE,
  RING_MAX_SIZE,
  RING_CHUNK_KEY,
} from './ring-settings.js';

/**
 * @typedef {import('./ring-settings.js').RingSettings} RingSettings
 * @typedef {{canvas: HTMLCanvasElement, frame: number, views: number}} RingSheet
 *   canvas: the whole strip, `views` frames of `frame` px side by side.
 */

/**
 * @param {ReturnType<typeof import('./workspace.js').createWorkspace>} workspace
 */
export function createActiveRing(workspace) {
  /** @type {import('./workspace.js').DocContext|null} the served context */
  let ctx = null;
  /** @type {(() => void)|null} */
  let offCtx = null;
  /** @type {Set<(s: RingSettings) => void>} */
  const listeners = new Set();
  /** @type {RingSettings} the last notified snapshot */
  let last = RING_DEFAULTS;

  const get = () => (ctx ? ctx.ring.get() : RING_DEFAULTS);
  const notify = () => {
    const s = get();
    if (sameRingSettings(s, last)) return;
    last = s;
    for (const fn of listeners) fn(s);
  };
  const serve = (next) => {
    if (next === ctx) return;
    offCtx?.();
    ctx = next;
    offCtx = ctx ? ctx.ring.subscribe(notify) : null;
    notify();
  };
  const sync = () => {
    const active = workspace.active();
    if (active) serve(active);
    else if (ctx && !workspace.byKey(ctx.key)) serve(null);
  };
  const offWorkspace = workspace.subscribe(sync);
  sync();

  /** @param {(s: RingSettings) => void} fn  @returns {() => void} */
  const subscribe = (fn) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  };

  /** @type {RingSheet|null} */
  let sheet = null;
  /** @type {Set<(s: RingSheet|null) => void>} */
  const sheetListeners = new Set();

  return {
    /** Store-shaped (get + subscribe) for StoreController. */
    store: { get, subscribe },
    get,
    subscribe,

    /** @param {number} n */
    setViews(n) {
      ctx?.ring.setViews(n);
    },
    /** @param {number} d */
    setElevation(d) {
      ctx?.ring.setElevation(d);
    },
    /** @param {number} d */
    setOffset(d) {
      ctx?.ring.setOffset(d);
    },
    /** @param {number} n */
    setSize(n) {
      ctx?.ring.setSize(n);
    },
    /** @param {string} name */
    setPaper(name) {
      ctx?.ring.setPaper(name);
    },

    /** Store the sheet by reference and call every listener with it. Null
     *  means no model. */
    publishSheet(s) {
      sheet = s;
      for (const fn of sheetListeners) fn(s);
    },
    /** The last published sheet, or null. */
    sheet() {
      return sheet;
    },
    /** @param {(s: RingSheet|null) => void} fn  @returns {() => void} unsubscribe */
    onSheet(fn) {
      sheetListeners.add(fn);
      return () => {
        sheetListeners.delete(fn);
      };
    },

    /** Stop following the workspace. */
    dispose() {
      offWorkspace();
      serve(null);
    },
  };
}

/**
 * @typedef {{frame: number, scale: number, anchor: {x: number, y: number}, yaws: number[]}} RingGeometry
 *   frame: the tile's edge in px (equal to `size`). scale: the derived px per
 *   voxel, a float. anchor: the lattice floor's center in every frame. yaws:
 *   one per view, in sheet order.
 */

/** The ring record in both the export's PNG chunk and its TexturePacker JSON.
 *  frame duplicates size for importers that read it.
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
 * The export's PNG text chunks: a Title after the document, the Software
 * marker and the ring record as JSON.
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
 * The sheet's TexturePacker JSON, hash format (Phaser, PixiJS, Godot and Unity
 * importers load it).
 *   - `frames`: one per view, keyed `«slug»-«index»` in yaw order. Each is an
 *     untrimmed, unrotated `frame`×`frame` box with the anchor as a normalized
 *     `pivot` (x right, y down, 0..1) rounded to four places.
 *   - `animations`: the ring as one sequence (read by PixiJS AnimatedSprite).
 *   - `meta`: TexturePacker's fields, plus the ring record under a
 *     `sprite-machine` key.
 * @param {string} slug  the document's filename slug (the frame keys' prefix)
 * @param {Pick<RingSettings, 'views'|'elevation'|'offset'|'size'>} settings
 * @param {RingGeometry} geometry
 * @param {{image: string, version: string}} file  the sibling PNG's filename
 *   and the app version
 * @returns {object}  JSON-ready
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

export const ring = createActiveRing(workspaceSingleton);
