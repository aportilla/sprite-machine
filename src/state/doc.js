// ---------------------------------------------------------------------------
// `doc` slice — the canonical document: the sprite sheet (`atlasImage`), the
// face views sliced from it, per-view transforms, and the rounded tile geometry
// from the last slice (the editor writes tiles back using these, so they must
// never be re-derived from dimensions). Everything is held BY REFERENCE —
// identity is the contract (`views[face]` may literally be the editor's working
// buffer), so this slice never clones pixel data.
//
// TWO CHANNELS — the formalization of the app's two-speed state system:
//   - `subscribe` (change; structural, low-frequency): a new atlas, a tile
//     resize, an all-tiles replace. Drives templates and view-model
//     recomputation.
//   - `onLive` (live; stroke-rate, coalesced to one blit per animation frame):
//     blit-then-notify. Its only subscriber is the mesh rebuilder.
// `applyTileEdit` mutates `views[face]` SILENTLY on the change channel — the
// same staleness contract as before: guides / onion-skin recompute only on a
// face switch or structural change, never mid-stroke.
//
// DRAIN-BEFORE-CONSUME has exactly one owner: every canonical-atlas consumer
// (download snapshot, tile resize, all-tiles replace) calls `drain()` first so
// the pending live stroke is folded in — never dropped, never blitted at the
// wrong scale. The frame scheduler is injectable so Node tests drive it by hand.
// ---------------------------------------------------------------------------

import { createStore } from './store.js';
import {
  sliceAtlas,
  blitTile,
  cellOf,
  resizeAtlas,
  clampTile,
  isBlank,
} from '../lib/atlas.js';
import { replaceColorInRect } from '../lib/fill.js';

/**
 * @param {{schedule?: (fn: () => void) => any, cancel?: (id: any) => void}} [scheduler]
 *   Frame scheduler; defaults to requestAnimationFrame. Injectable for tests.
 */
export function createDoc(scheduler = {}) {
  const schedule = scheduler.schedule ?? ((fn) => requestAnimationFrame(fn));
  const cancel = scheduler.cancel ?? ((id) => cancelAnimationFrame(id));

  const store = createStore({
    /** @type {{width:number,height:number,data:Uint8ClampedArray}|null} the canonical sheet */
    atlasImage: null,
    /** @type {Record<string, {width:number,height:number,data:Uint8ClampedArray}|null>} */
    views: {},
    /** @type {Record<string, object>} per-view reorientation (rot/flip) */
    transforms: {},
    /** @type {string[]} */
    atlasWarnings: [],
    tileW: 0,
    tileH: 0,
    cols: 0,
    rows: 0,
    // Sheet GENERATION: bumped only by a wholesale load, never by a resize or
    // replace — "is this still the same document?" for consumers that behave
    // differently on a fresh sheet (the rebuilder frames the camera on one).
    sheet: 0,
  });

  /** @type {Set<(s: ReturnType<typeof store.get>) => void>} */
  const liveListeners = new Set();
  let liveId = /** @type {any} */ (0);
  let livePending = null; // { face, tile } awaiting the frame blit

  // Blit the coalesced pending edit into the canonical sheet and notify the
  // live channel. At most one of these per animation frame.
  function flushLive() {
    liveId = 0;
    const p = livePending;
    livePending = null;
    if (!p) return;
    const s = store.get();
    const cell = cellOf(p.face);
    if (cell && s.atlasImage) {
      blitTile(s.atlasImage, p.tile, cell.c * s.tileW, cell.r * s.tileH);
    }
    for (const fn of liveListeners) fn(s);
  }

  // Slice the (already stored or incoming) sheet and return the patch that
  // makes the store reflect it — callers fold it into ONE patch so a structural
  // change is a single change notification.
  function slicedPatch(atlasImage) {
    const sliced = sliceAtlas(atlasImage);
    return {
      views: sliced.views,
      atlasWarnings: sliced.warnings,
      tileW: sliced.tileW,
      tileH: sliced.tileH,
      cols: sliced.cols,
      rows: sliced.rows,
    };
  }

  return {
    store,
    get: store.get,
    subscribe: store.subscribe, // the CHANGE channel (structural)

    /** The LIVE channel (stroke-rate, rAF-coalesced). @param {(s: object) => void} fn */
    onLive(fn) {
      liveListeners.add(fn);
      return () => {
        liveListeners.delete(fn);
      };
    },

    // Load a NEW sheet wholesale. Any pending live stroke belongs to the old
    // sheet (possibly at another tile size) — drop it rather than blit it into
    // the fresh atlas on the next frame.
    /** @param {object} imageData  @param {Record<string, object>} [transforms] */
    loadAtlas(imageData, transforms = {}) {
      this.dropLive();
      store.patch({
        atlasImage: imageData,
        transforms,
        sheet: store.get().sheet + 1,
        ...slicedPatch(imageData),
      });
    },

    // One live/committed tile edit from the editor. The face's view becomes the
    // working buffer BY REFERENCE (or null again if fully erased — reverting a
    // face to mirror-derived), silently on the change channel; the sheet blit +
    // live notification are coalesced to the next frame.
    /** @param {string} face  @param {{width:number,height:number,data:Uint8ClampedArray}} tile */
    applyTileEdit(face, tile) {
      store.get().views[face] = isBlank(tile) ? null : tile;
      livePending = { face, tile };
      if (!liveId) liveId = schedule(flushLive);
    },

    // Fold any un-flushed live stroke into the canonical sheet NOW. The one
    // owner of the drain-before-consume guard.
    drain() {
      if (liveId) {
        cancel(liveId);
        flushLive();
      }
    },

    // Discard any pending live blit without flushing it.
    dropLive() {
      if (liveId) {
        cancel(liveId);
        liveId = 0;
      }
      livePending = null;
    },

    // Resize every tile (the whole atlas moves together, then re-slice). Tiles
    // are clamped to [TILE_MIN, TILE_MAX]; a same-size call is a no-op (e.g. ±
    // at a bound). Returns whether anything changed.
    /** @param {number} newW  @param {number} newH  @param {'origin'|'center'} [anchor] */
    resizeTiles(newW, newH, anchor = 'center') {
      const s = store.get();
      if (!s.atlasImage) return false;
      const w = clampTile(newW);
      const h = clampTile(newH);
      if (w === s.tileW && h === s.tileH) return false;
      // Fold the pending stroke in BEFORE rebuilding at a new size, so the last
      // edit isn't dropped or blitted at the wrong scale.
      this.drain();
      const atlasImage = resizeAtlas(store.get().atlasImage, w, h, { anchor });
      store.patch({ atlasImage, ...slicedPatch(atlasImage) });
      return true;
    },

    // Restore ONE face's art wholesale (the undo/redo path): blit the tile —
    // or transparency for a blank/null one — into the canonical sheet and
    // re-slice, so the change is STRUCTURAL (templates re-derive, the canvas
    // resets its working buffer, the rebuilder rebuilds). The tile's data is
    // COPIED in by the blit; callers may keep their snapshot.
    /** @param {string} face  @param {{width:number,height:number,data:Uint8ClampedArray}|null} tile */
    restoreTile(face, tile) {
      const s = store.get();
      const cell = cellOf(face);
      if (!s.atlasImage || !cell) return;
      this.dropLive();
      const t = tile ?? {
        width: s.tileW,
        height: s.tileH,
        data: new Uint8ClampedArray(s.tileW * s.tileH * 4),
      };
      blitTile(s.atlasImage, t, cell.c * s.tileW, cell.r * s.tileH);
      store.patch(slicedPatch(s.atlasImage));
    },

    // Restore the WHOLE sheet (the undo/redo path for resize / replace-all).
    // The image is adopted BY REFERENCE — pass a copy if the snapshot must
    // survive later edits. No sheet bump: this is the same document.
    /** @param {{width:number,height:number,data:Uint8ClampedArray}} image */
    restoreAtlas(image) {
      this.dropLive();
      store.patch({ atlasImage: image, ...slicedPatch(image) });
    },

    // Replace every `target` texel with `fill` across all six tiles. Scoped to
    // the tiled region (the top-left cols*tileW × rows*tileH block) so a
    // non-divisible sheet's remainder pixels are left untouched. Returns whether
    // anything changed (an unchanged sheet notifies nobody).
    /** @param {object} target  @param {object} fill — color keys ({transparent:true} | {r,g,b}) */
    replaceAllTiles(target, fill) {
      if (!store.get().atlasImage) return false;
      // Fold the pending stroke in first so the replace sees the latest pixels.
      this.drain();
      const s = store.get();
      const { data, width, height } = s.atlasImage;
      const changed = replaceColorInRect(
        data,
        width,
        height,
        0,
        0,
        s.cols * s.tileW,
        s.rows * s.tileH,
        target,
        fill
      );
      if (!changed) return false;
      store.patch(slicedPatch(s.atlasImage));
      return true;
    },
  };
}

// No singleton: every document context (state/workspace.js) owns its own
// createDoc() instance — one canonical doc per open document window.
