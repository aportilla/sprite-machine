// ---------------------------------------------------------------------------
// `ring` — the 3D Sprite Atlas as the app sees it: THE ACTIVE DOCUMENT'S
// settings, and the SHEET CHANNEL.
//
// THE SETTINGS ARE THE DOCUMENT'S (state/ring-settings.js: every DocContext
// carries its own store, `ctx.ring`, persisted in the document's PNG as a
// `sprite-machine:ring` chunk and restored by every open path). This module
// is the FAÇADE over whichever one the windoid serves: `get()` reads it,
// `subscribe` fires on its changes AND on a switch to another document's,
// and each setter routes to it — so the strip (sm-ring-controls), the body
// (sm-ring-view), File → Export Sprite Atlas…'s fields (apps/sprite-editor), the
// renderer's follower (scene/ring.js) and the windoid's height rule
// (shell/windows.js) all read one store-shaped object and follow the active
// document for free, the way the windoids themselves do. The served context
// is the ACTIVE one; while the desktop is focused (the Finder role, the
// windoid hidden) it stays the one last served — the windoid returns aimed
// where it was — until that document closes; with nothing served the
// defaults read and a setter is a no-op (nothing to write to; the ?ring
// boot hook seeds the boot document at its open instead). A switch that
// reads the same on every key notifies nobody — the store idiom.
//
// THE SHEET CHANNEL is the doc's `onLive` shape — hot, imperative, never
// through a store: the follower publishes the rendered sheet canvas (by
// reference) after every render, which lands per rebuild frame during a
// stroke; a store patch per frame would re-render every subscriber's
// template for pixels only the windoid's cells paint. `sheet()` hands a late
// subscriber (a reconnected windoid body) the last one. App-level: there is
// one renderer, serving the active document like the rebuilder it follows.
// ---------------------------------------------------------------------------

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
  /** @type {RingSettings} what the listeners last heard */
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
    /** Store-shaped (get + subscribe) for the Lit StoreController. */
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

    /** The follower's publish: stores the sheet by reference and calls every
     *  listener with it (null: no model — the cells show paper). */
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

    /** Stop following the workspace (tests; the app's singleton lives as
     *  long as the page). */
    dispose() {
      offWorkspace();
      serve(null);
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

// The app-wide singleton: the façade over the one workspace (one desktop,
// one windoid, one renderer per page).
export const ring = createActiveRing(workspaceSingleton);
