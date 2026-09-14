// Clipboard slice: one clipboard for the app. It holds the Finder's copied item
// references and the text/plain written to the system clipboard for them, or the
// Sprite Editor's copied pixels and their place on the tile. A copy of either
// kind replaces the other. The system clipboard holds only plain text and a PNG,
// which Chrome re-encodes without its text chunks. Session-only. The references
// are not pruned, so a paste skips removed items. The system clipboard calls
// live in the applications and src/system-clipboard.js.

import { createStore } from './store.js';
import { sameArt } from '../lib/select.js';

/**
 * @typedef {{kind: 'doc'|'folder'|'text', id: string}} ClipboardItemRef
 * @typedef {{float: import('../lib/select.js').Float, x: number, y: number}} ClipboardPixels
 *   The copied texels and the top-left of their rectangle in tile texels, which
 *   may be off the tile.
 * @typedef {{items: ClipboardItemRef[], text: string, pixels: ClipboardPixels|null,
 *   written: boolean}} ClipboardState
 *   text: the text/plain written to the system clipboard for these items.
 *   '' when nothing is copied.
 *   written: whether the system clipboard write of these pixels succeeded.
 * @typedef {{text: string|null, image: unknown|null}} SystemClipboard
 *   A read of the system clipboard: its text/plain and its image/png (a Blob
 *   in the browser), each null when absent.
 */

/** Normalizes line endings and trailing whitespace, which a clipboard round
 *  trip may change. */
const norm = (s) =>
  String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .trimEnd();

/**
 * What a paste uses. 'items' when the system clipboard's text matches the
 * slice's text, or when the system clipboard is unreadable and the slice has
 * items. 'image' when the system clipboard holds an image. Otherwise 'none'.
 * @param {ClipboardState} slice
 * @param {SystemClipboard|null} system  null: unreadable
 * @returns {'items'|'image'|'none'}
 */
export function pasteSource(slice, system) {
  const held = slice.items.length > 0;
  if (system == null) return held ? 'items' : 'none';
  if (held && system.text != null && norm(system.text) === norm(slice.text))
    return 'items';
  if (system.image != null) return 'image';
  return 'none';
}

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
      items: [],
      text: '',
      pixels: null,
      written: false,
    })
  );
  return {
    store,
    get: store.get,
    subscribe: store.subscribe,

    /** Record a copy: the item references, in order, and the text written to
     *  the system clipboard for them.
     *  @param {ClipboardItemRef[]} items @param {string} text */
    set(items, text) {
      store.patch({
        items: items.map((it) => ({ kind: it.kind, id: it.id })),
        text,
        pixels: null,
        written: false,
      });
    },

    /** Record a pixel copy: a copy of the texels and their top-left.
     *  @param {import('../lib/select.js').Float} float @param {number} x @param {number} y */
    setPixels(float, x, y) {
      store.patch({
        items: [],
        text: '',
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
      store.patch({ items: [], text: '', pixels: null, written: false });
    },
  };
}

export const clipboard = createClipboard();
