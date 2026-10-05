// Text Viewer windows: one per open text file, a copy of windows.html's, the
// body the file's text verbatim and read-only.

/** A text window's body, whose contents Select All selects.
 *  @param {import('vintage-frames').VfWindow} win */
export const bodyOf = (win) =>
  /** @type {HTMLElement} */ (win.querySelector('.text-body'));

/** `win`, a fresh text window, titled `name` and showing `text`.
 *  @param {import('vintage-frames').VfWindow} win @param {string} name
 *  @param {string} text */
export function textWindow(win, name, text) {
  win.heading = name;
  bodyOf(win).textContent = text;
  return win;
}
