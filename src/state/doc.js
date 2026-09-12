// Doc slice: one open document's sprite sheet, the face views sliced from it,
// per-view transforms and the tile geometry of the last slice. Tile edits are
// written back with that geometry, so it is never re-derived from the image
// size. Pixel data is held by reference and never cloned. views[face] may be
// the editor's working buffer.
//
// Two channels:
//   - subscribe: structural changes (a new atlas, a tile resize, replace all).
//   - onLive: stroke-rate edits, coalesced to one blit per animation frame.
// applyTileEdit mutates views[face] without a change notification, so the
// onion skin recomputes only on a face switch or a structural change.
//
// Every consumer of the canonical atlas calls drain() first.

import { createStore } from './store.js';
import {
  sliceAtlas,
  blitTile,
  cellOf,
  resizeAtlas,
  clampTile,
  isBlank,
} from 'sprite-machine';
import { replaceColorInRect } from '../lib/fill.js';

/**
 * @param {{schedule?: (fn: () => void) => any, cancel?: (id: any) => void}} [scheduler]
 *   Frame scheduler. Defaults to requestAnimationFrame.
 */
export function createDoc(scheduler = {}) {
  const schedule = scheduler.schedule ?? ((fn) => requestAnimationFrame(fn));
  const cancel = scheduler.cancel ?? ((id) => cancelAnimationFrame(id));

  const store = createStore({
    /** @type {{width:number,height:number,data:Uint8ClampedArray}|null} */
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
    // Sheet generation, incremented only by loadAtlas. A change means a new document.
    sheet: 0,
  });

  /** @type {Set<(s: ReturnType<typeof store.get>) => void>} */
  const liveListeners = new Set();
  let liveId = /** @type {any} */ (0);
  let livePending = null; // { face, tile } awaiting the frame blit

  // Blit the pending edit into the sheet and notify the live listeners.
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

  // Slice a sheet into a store patch. Callers merge it into a single patch so
  // a structural change notifies once.
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
    subscribe: store.subscribe, // structural changes

    /** Stroke-rate changes, one per animation frame. @param {(s: object) => void} fn */
    onLive(fn) {
      liveListeners.add(fn);
      return () => {
        liveListeners.delete(fn);
      };
    },

    // Load a new sheet. A pending live stroke belongs to the old sheet and is
    // dropped.
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

    // A tile edit from the editor. views[face] becomes the working buffer by
    // reference, or null when the tile is blank (the face reverts to
    // mirror-derived). The sheet blit and the live notification run on the
    // next frame.
    /** @param {string} face  @param {{width:number,height:number,data:Uint8ClampedArray}} tile */
    applyTileEdit(face, tile) {
      store.get().views[face] = isBlank(tile) ? null : tile;
      livePending = { face, tile };
      if (!liveId) liveId = schedule(flushLive);
    },

    // Blit any pending live stroke into the sheet now.
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

    // Resize every tile and re-slice. Sizes clamp to [TILE_MIN, TILE_MAX].
    // Returns whether anything changed.
    /** @param {number} newW  @param {number} newH  @param {'origin'|'center'} [anchor] */
    resizeTiles(newW, newH, anchor = 'center') {
      const s = store.get();
      if (!s.atlasImage) return false;
      const w = clampTile(newW);
      const h = clampTile(newH);
      if (w === s.tileW && h === s.tileH) return false;
      // Drain first so the pending stroke blits at the old tile size.
      this.drain();
      const atlasImage = resizeAtlas(store.get().atlasImage, w, h, { anchor });
      store.patch({ atlasImage, ...slicedPatch(atlasImage) });
      return true;
    },

    // Restore one face's art (undo/redo). Blits the tile, or transparency for
    // null, into the sheet and re-slices, so the change is structural. The
    // tile's data is copied.
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

    // Restore the whole sheet (undo/redo of a resize or replace all). The
    // image is adopted by reference. The sheet generation does not change.
    /** @param {{width:number,height:number,data:Uint8ClampedArray}} image */
    restoreAtlas(image) {
      this.dropLive();
      store.patch({ atlasImage: image, ...slicedPatch(image) });
    },

    // Replace every target texel with fill across all six tiles, within the
    // tiled region (cols*tileW × rows*tileH from the top left). Returns whether
    // anything changed.
    /**
     * @param {object} target  a color key: {transparent:true} or {r,g,b}
     * @param {object} fill  a color key
     */
    replaceAllTiles(target, fill) {
      if (!store.get().atlasImage) return false;
      // Drain first so the replace sees the latest pixels.
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
