// Doc slice: one open document's sprite sheet, the layers sliced from it and
// their names, per-view transforms and the tile geometry of the last slice. The
// sheet stacks one 3×2 block of tiles per layer, the first on top. Tile edits
// are written back with that geometry, so it is never re-derived from the
// image size. Pixel data is held by reference and never cloned.
// layers[layer][face] may be the editor's working buffer.
//
// Two channels:
//   - subscribe: structural changes (a new atlas, a tile resize, replace all, a
//     layer added, removed, moved or renamed).
//   - onLive: stroke-rate edits, coalesced to one blit per animation frame.
// applyTileEdit mutates layers[layer][face] without a change notification, so
// the underlay recomputes only on a face or layer switch or a structural change.
//
// Every consumer of the canonical atlas calls drain() first.

import { createStore } from './store.js';
import {
  sliceLayers,
  blitTile,
  cellOf,
  resizeAtlas,
  clampTile,
  isBlank,
  LAYER_MAX,
} from 'sprite-machine';
import { replaceColorInRect } from '../lib/fill.js';
import {
  appendBlock,
  removeBlock,
  moveBlock,
  fitLayerNames,
  nextLayerName,
} from '../lib/layers.js';

/** @typedef {{width:number,height:number,data:Uint8ClampedArray}} Tile */
/** @typedef {Record<string, Tile|null>} Views */
/** @typedef {{layer: number, face: string}} LiveEdit */

/**
 * @param {{schedule?: (fn: () => void) => any, cancel?: (id: any) => void}} [scheduler]
 *   Frame scheduler. Defaults to requestAnimationFrame.
 */
export function createDoc(scheduler = {}) {
  const schedule = scheduler.schedule ?? ((fn) => requestAnimationFrame(fn));
  const cancel = scheduler.cancel ?? ((id) => cancelAnimationFrame(id));

  const store = createStore({
    /** @type {Tile|null} */
    atlasImage: null,
    /** @type {Views[]} one per layer, in block order */
    layers: [],
    /** @type {string[]} one per layer, in block order */
    names: [],
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

  /** @type {Set<(s: ReturnType<typeof store.get>, edit: LiveEdit) => void>} */
  const liveListeners = new Set();
  let liveId = /** @type {any} */ (0);
  /** @type {Map<string, LiveEdit & {tile: Tile}>} edits awaiting the frame blit, the latest per layer and face */
  const pending = new Map();

  const inRange = (layer) => Number.isInteger(layer) && layer >= 0;

  // Blit the pending edits into the sheet and notify the live listeners once per
  // edit.
  function flushLive() {
    liveId = 0;
    const edits = [...pending.values()];
    pending.clear();
    const s = store.get();
    for (const { layer, face, tile } of edits) {
      const cell = cellOf(face);
      if (cell && s.atlasImage) {
        blitTile(
          s.atlasImage,
          tile,
          cell.c * s.tileW,
          (s.rows * layer + cell.r) * s.tileH
        );
      }
    }
    for (const { layer, face } of edits) {
      for (const fn of liveListeners) fn(s, { layer, face });
    }
  }

  // Slice `count` layers of a sheet into a store patch. Callers merge it into a
  // single patch so a structural change notifies once.
  function slicedPatch(atlasImage, count) {
    const sliced = sliceLayers(atlasImage, { layers: count });
    return {
      layers: sliced.layers,
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

    /** Stroke-rate changes, one call per edited layer and face per animation
     *  frame. @param {(s: object, edit: LiveEdit) => void} fn */
    onLive(fn) {
      liveListeners.add(fn);
      return () => {
        liveListeners.delete(fn);
      };
    },

    // Load a new sheet. A pending live stroke belongs to the old sheet and is
    // dropped.
    /**
     * @param {object} imageData
     * @param {Record<string, object>} [transforms]
     * @param {{layers?: number, names?: string[]|null}} [stack]  the layer
     *   count (lib/sheet-shape.js sheetLayers) and the chunk's names, fitted to it
     */
    loadAtlas(imageData, transforms = {}, { layers = 1, names = null } = {}) {
      this.dropLive();
      const sliced = slicedPatch(imageData, layers);
      store.patch({
        atlasImage: /** @type {Tile} */ (imageData),
        transforms,
        names: fitLayerNames(names, sliced.layers.length),
        sheet: store.get().sheet + 1,
        ...sliced,
      });
    },

    // A tile edit from the editor. layers[layer][face] becomes the working
    // buffer by reference, or null when the tile is blank (the face reverts to
    // mirror-derived). The sheet blit and the live notification run on the
    // next frame.
    /** @param {number} layer  @param {string} face  @param {Tile} tile */
    applyTileEdit(layer, face, tile) {
      const views = store.get().layers[layer];
      if (!views) return;
      views[face] = isBlank(tile) ? null : tile;
      pending.set(`${layer}:${face}`, { layer, face, tile });
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
      pending.clear();
    },

    // Resize every tile of every layer and re-slice. Sizes clamp to
    // [TILE_MIN, TILE_MAX]. Returns whether anything changed.
    /** @param {number} newW  @param {number} newH  @param {'origin'|'center'} [anchor] */
    resizeTiles(newW, newH, anchor = 'center') {
      const s = store.get();
      if (!s.atlasImage) return false;
      const w = clampTile(newW);
      const h = clampTile(newH);
      if (w === s.tileW && h === s.tileH) return false;
      // Drain first so the pending stroke blits at the old tile size.
      this.drain();
      const count = s.layers.length;
      const atlasImage = resizeAtlas(store.get().atlasImage, w, h, {
        anchor,
        layers: count,
      });
      store.patch({ atlasImage, ...slicedPatch(atlasImage, count) });
      return true;
    },

    // Restore one face of one layer (undo/redo). Blits the tile, or
    // transparency for null, into the sheet and re-slices, so the change is
    // structural. The tile's data is copied.
    /** @param {number} layer  @param {string} face  @param {Tile|null} tile */
    restoreTile(layer, face, tile) {
      const s = store.get();
      const cell = cellOf(face);
      if (!s.atlasImage || !cell || !inRange(layer) || layer >= s.layers.length) return;
      this.dropLive();
      const t = tile ?? {
        width: s.tileW,
        height: s.tileH,
        data: new Uint8ClampedArray(s.tileW * s.tileH * 4),
      };
      blitTile(s.atlasImage, t, cell.c * s.tileW, (s.rows * layer + cell.r) * s.tileH);
      store.patch(slicedPatch(s.atlasImage, s.layers.length));
    },

    // Restore the whole sheet and its layer names (undo/redo of a resize,
    // replace all or a layer added, removed or moved). The image is adopted by
    // reference and sliced into as many layers as there are names. The sheet
    // generation does not change.
    /** @param {Tile} image  @param {string[]} names */
    restoreAtlas(image, names) {
      this.dropLive();
      const count = Math.max(1, names.length);
      store.patch({
        atlasImage: image,
        names: fitLayerNames(names, count),
        ...slicedPatch(image, count),
      });
    },

    // Replace every target texel with fill across one layer's six tiles, within
    // the tiled region of its block. Returns whether anything changed.
    /**
     * @param {number} layer
     * @param {object} target  a color key: {transparent:true} or {r,g,b}
     * @param {object} fill  a color key
     */
    replaceAllTiles(layer, target, fill) {
      const s0 = store.get();
      if (!s0.atlasImage || !inRange(layer) || layer >= s0.layers.length) return false;
      // Drain first so the replace sees the latest pixels.
      this.drain();
      const s = store.get();
      const { data, width, height } = s.atlasImage;
      const changed = replaceColorInRect(
        data,
        width,
        height,
        0,
        s.rows * layer * s.tileH,
        s.cols * s.tileW,
        s.rows * s.tileH,
        target,
        fill
      );
      if (!changed) return false;
      store.patch(slicedPatch(s.atlasImage, s.layers.length));
      return true;
    },

    // Append a transparent layer named `name`, or by lib/layers.js nextLayerName
    // when it is blank. Returns whether the sheet changed: false with no sheet
    // or at LAYER_MAX.
    /** @param {string} [name] */
    addLayer(name) {
      const s0 = store.get();
      if (!s0.atlasImage || s0.layers.length >= LAYER_MAX) return false;
      this.drain();
      const s = store.get();
      const atlasImage = appendBlock(s.atlasImage, s.rows * s.tileH);
      const names = [
        ...s.names,
        String(name ?? '').trim() ? name : nextLayerName(s.names),
      ];
      store.patch({ atlasImage, names, ...slicedPatch(atlasImage, names.length) });
      return true;
    },

    // Remove a layer's block and its name. Returns whether the sheet changed:
    // false with no sheet, for the only layer or an index out of range.
    /** @param {number} index */
    removeLayer(index) {
      const s0 = store.get();
      const count = s0.layers.length;
      if (!s0.atlasImage || count <= 1 || !inRange(index) || index >= count) return false;
      this.drain();
      const s = store.get();
      const atlasImage = removeBlock(s.atlasImage, index, s.rows * s.tileH);
      const names = s.names.filter((_, i) => i !== index);
      store.patch({ atlasImage, names, ...slicedPatch(atlasImage, names.length) });
      return true;
    },

    // Move a layer's block and its name to index `to`. Returns whether the sheet
    // changed: false with no sheet, an index out of range or `to` the same.
    /** @param {number} index  @param {number} to */
    moveLayer(index, to) {
      const s0 = store.get();
      const count = s0.layers.length;
      if (!s0.atlasImage || !inRange(index) || !inRange(to)) return false;
      if (index >= count || to >= count || index === to) return false;
      this.drain();
      const s = store.get();
      const atlasImage = moveBlock(s.atlasImage, index, to, s.rows * s.tileH);
      const names = [...s.names];
      names.splice(to, 0, ...names.splice(index, 1));
      store.patch({ atlasImage, names, ...slicedPatch(atlasImage, count) });
      return true;
    },

    // Name a layer. Returns whether the names changed. A blank name is refused.
    /** @param {number} index  @param {string} name */
    renameLayer(index, name) {
      const { names } = store.get();
      if (!inRange(index) || index >= names.length) return false;
      if (!String(name ?? '').trim() || names[index] === name) return false;
      store.patch({ names: names.map((n, i) => (i === index ? name : n)) });
      return true;
    },

    // Restore the layer names (undo/redo of a rename), fitted to the layer
    // count. Returns whether they changed.
    /** @param {string[]} names */
    setNames(names) {
      const s = store.get();
      const next = fitLayerNames(names, s.layers.length);
      if (next.length === s.names.length && next.every((n, i) => n === s.names[i])) {
        return false;
      }
      store.patch({ names: next });
      return true;
    },
  };
}
