// The library's kinds, as items of the shell's catalog (vintage-frames/shell):
// a sprite document and a text file. Each keeps little in its item's `data`.
// Pure, so the defaults, the conversion and the backup format run under Node.

/** A sprite document's kind, which the Sprite Editor opens. Its PNG bytes are
 *  in the Sprite Editor's sheet store under the item's id (state/sheets.js). */
export const SPRITE = 'sprite';
/** A text file's kind, which the Text Viewer opens. */
export const TEXT = 'text';

// The catalog's own ids and kinds, restated: vintage-frames/shell's entry
// needs a DOM, so its TRASH and FOLDER can't be imported under Node.
export const TRASH = 'trash';
export const FOLDER = 'folder';

/**
 * A document's data: its icon, a data URI of the model render, or null, and
 * its PNG's byte length.
 * @param {{data?: unknown}} item
 * @returns {{icon: string|null, size: number}}
 */
export function spriteData(item) {
  const d = /** @type {any} */ (item.data ?? {});
  return {
    icon: typeof d.icon === 'string' && d.icon ? d.icon : null,
    size: Number.isFinite(d.size) ? d.size : 0,
  };
}

/**
 * A text file's data: the key of a built-in (src/texts/), or null, and its own
 * words, '' for a built-in.
 * @param {{data?: unknown}} item
 * @returns {{builtin: string|null, text: string}}
 */
export function textData(item) {
  const d = /** @type {any} */ (item.data ?? {});
  return {
    builtin: typeof d.builtin === 'string' && d.builtin ? d.builtin : null,
    text: typeof d.text === 'string' ? d.text : '',
  };
}
