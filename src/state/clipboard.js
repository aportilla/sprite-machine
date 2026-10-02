// Clipboard slice: the Sprite Editor's copied pixels and their place on the
// tile. The system clipboard holds only plain text and a PNG, which Chrome
// re-encodes without its text chunks. Session-only. The Finder's Copy and
// Paste are the kit's. The system clipboard calls live in the Sprite Editor
// and src/system-clipboard.js.

import { createStore } from './store.js';
import { sameArt } from '../lib/select.js';

/**
 * @typedef {{float: import('../lib/select.js').Float, x: number, y: number}} ClipboardPixels
 *   The copied texels and the top-left of their rectangle in tile texels, which
 *   may be off the tile.
 * @typedef {{pixels: ClipboardPixels|null, written: boolean}} ClipboardState
 *   written: whether the system clipboard write of these pixels succeeded.
 */

/**
 * What a pixel paste uses: 'pixels' for an image that is the slice's pixels, an
 * unreadable system clipboard, or no image after their write failed; 'image'
 * for any other image; else 'none'.
 * @param {ClipboardState} slice
 * @param {{image: import('../lib/select.js').Float|null}|null} system
 *   null: unreadable. image: the decoded and hardened image/png, or null.
 * @returns {'pixels'|'image'|'none'}
 */
export function pixelPasteSource(slice, system) {
  const held = slice.pixels != null;
  if (system == null) return held ? 'pixels' : 'none';
  if (system.image != null)
    return held && sameArt(system.image, slice.pixels.float) ? 'pixels' : 'image';
  return held && !slice.written ? 'pixels' : 'none';
}

export function createClipboard() {
  const store = createStore(
    /** @type {ClipboardState} */ ({
      pixels: null,
      written: false,
    })
  );
  return {
    store,
    get: store.get,
    subscribe: store.subscribe,

    /** Record a pixel copy: a copy of the texels and their top-left.
     *  @param {import('../lib/select.js').Float} float @param {number} x @param {number} y */
    setPixels(float, x, y) {
      store.patch({
        pixels: {
          float: {
            width: float.width,
            height: float.height,
            data: new Uint8ClampedArray(float.data),
            opaque: float.opaque,
          },
          x,
          y,
        },
        written: false,
      });
    },

    /** Record that the system clipboard holds `pixels`, unless a newer copy has
     *  replaced them. @param {ClipboardPixels} pixels */
    markWritten(pixels) {
      if (store.get().pixels === pixels) store.patch({ written: true });
    },

    clear() {
      store.patch({ pixels: null, written: false });
    },
  };
}

export const clipboard = createClipboard();
