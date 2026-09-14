// System clipboard reads for a paste, shared by the Finder and the Sprite Editor:
// the Async Clipboard API for ⌘V and a menu pick, and the paste event's
// clipboardData for the browser's own Edit → Paste.

/**
 * The system clipboard's first text/plain and image/png, each null when absent,
 * or null when the clipboard cannot be read.
 * @returns {Promise<{text: string|null, image: Blob|null}|null>}
 */
export async function readSystemClipboard() {
  if (!navigator.clipboard?.read) return null;
  try {
    const items = await navigator.clipboard.read();
    let text = null;
    let image = null;
    for (const it of items) {
      if (text == null && it.types.includes('text/plain')) {
        text = await (await it.getType('text/plain')).text();
      }
      if (image == null && it.types.includes('image/png')) {
        image = await it.getType('image/png');
      }
    }
    return { text, image };
  } catch {
    return null;
  }
}

/**
 * The image/png a paste event carries, or null. Call it during the event.
 * @param {DataTransfer} dt
 * @returns {Blob|null}
 */
export function pastedPng(dt) {
  for (const f of dt.files) if (f.type === 'image/png') return f;
  for (const it of dt.items) {
    if (it.kind === 'file' && it.type === 'image/png') return it.getAsFile();
  }
  return null;
}
