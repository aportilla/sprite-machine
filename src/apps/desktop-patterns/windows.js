// Desktop Patterns window: the panel, a copy of windows.html's at each open.
// Its chooser starts at the desktop's pattern, and Set Desktop Pattern calls
// `set` with the choice.

/** `win`, a fresh panel, its choice seeded from `current`.
 *  @param {import('vintage-frames').VfWindow} win  @param {string} current
 *  @param {(pattern: string) => void} set */
export function patternsWindow(win, current, set) {
  const chooser = /** @type {any} */ (win.querySelector('sm-desktop-patterns'));
  chooser.pattern = current;
  chooser.addEventListener('sm-set-pattern', (/** @type {Event} */ e) =>
    set(/** @type {CustomEvent} */ (e).detail.pattern)
  );
  return win;
}
