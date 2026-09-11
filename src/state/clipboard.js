// ---------------------------------------------------------------------------
// `clipboard` slice — the in-app half of Edit → Copy / Paste over the
// Finder's files and folders (docs/clipboard-plan.md §2.2). The Mac had ONE
// Clipboard, and so does this app: the SYSTEM's is the truth of what is
// current, read at every paste. But the system clipboard carries only the
// well-known types — a PNG (sanitized: Chrome decodes and re-encodes it, so
// a document's text chunks do not survive the trip), plain text — and a
// folder with its subtree, a set of several icons, or a document's bytes
// with its chunks intact have no representation there. So the RICH payload
// rides here, keyed to what the app wrote to the system clipboard for it:
// the copied ITEMS — references into the catalog (`{kind, id}`), never
// bytes — and the TEXT the app put on the system clipboard beside them
// (the copied names, one per line — what the Mac's Finder gives a text
// editor). At a paste the system clipboard is read: if its text is the text
// this slice wrote, the slice's items are what is current and they paste
// from the store, chunks and subtrees intact; if instead it holds an image
// the app did not write, the image is the paste; anything else is nothing
// to paste. Where the system clipboard cannot be read at all (no secure
// context, a denied permission, Safari outside the gesture), the slice's
// items are trusted as they stand — the in-app half never depends on the
// system half. Session-only, never persisted; a reference to an item since
// emptied from the Trash simply skips at the paste — the Finder's own
// reading of a stale Clipboard. Pure: the store's shape and one selector,
// Node-tested; the system clipboard calls are the wire's (apps/finder).
// ---------------------------------------------------------------------------

import { createStore } from './store.js';

/**
 * @typedef {{kind: 'doc'|'folder'|'text', id: string}} ClipboardItemRef
 * @typedef {{items: ClipboardItemRef[], text: string}} ClipboardState
 *   text: what the app wrote to the system clipboard as `text/plain` for
 *   these items — the token a paste matches against; '' with nothing copied.
 * @typedef {{text: string|null, image: unknown|null}} SystemClipboard
 *   A read of the system clipboard: its `text/plain`, and its `image/png`
 *   (a Blob in the browser; opaque here) — each null when absent.
 */

/** Line endings and trailing whitespace the trip through a clipboard may
 *  rewrite (CRLF on some platforms) never break the match. */
const norm = (s) =>
  String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .trimEnd();

/**
 * What a paste pastes: `'items'` — the slice's references, when the system
 * clipboard's text is the text the slice wrote (or the system could not be
 * read at all and the slice holds something); `'image'` — the system
 * clipboard's picture, when it holds one the app did not write; `'none'`
 * otherwise (nothing copied, or text from elsewhere).
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

    /** Record a copy: the references, in the copier's order, and the text
     *  the system clipboard was handed for them.
     *  @param {ClipboardItemRef[]} items @param {string} text */
    set(items, text) {
      store.patch({ items: items.map((it) => ({ kind: it.kind, id: it.id })), text });
    },

    /** Nothing copied (a session's start; never called by the UI today —
     *  the Finder's Clipboard held its last copy until the next). */
    clear() {
      store.patch({ items: [], text: '' });
    },
  };
}

// The app-wide singleton (one Clipboard per machine).
export const clipboard = createClipboard();
