// Clipboard slice: the copied Finder item references and the text/plain written
// to the system clipboard for them. The system clipboard holds only plain text
// and a PNG, which Chrome re-encodes without its text chunks. Session-only. The
// references are not pruned, so a paste skips removed items. The system
// clipboard calls live in apps/finder.

import { createStore } from './store.js';

/**
 * @typedef {{kind: 'doc'|'folder'|'text', id: string}} ClipboardItemRef
 * @typedef {{items: ClipboardItemRef[], text: string}} ClipboardState
 *   text: the text/plain written to the system clipboard for these items.
 *   '' when nothing is copied.
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

export function createClipboard() {
  const store = createStore(
    /** @type {ClipboardState} */ ({
      items: [],
      text: '',
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
      store.patch({ items: items.map((it) => ({ kind: it.kind, id: it.id })), text });
    },

    clear() {
      store.patch({ items: [], text: '' });
    },
  };
}

export const clipboard = createClipboard();
