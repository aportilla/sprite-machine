// Desktop Patterns window: the panel, cloned from windows.html at each open.
// Its chooser starts at the desktop's pattern, and Set Desktop Pattern calls
// `set` with the choice.

import markup from './windows.html?raw';
import { cloneWindow, parseWindows } from '../windows.js';

const tpl = /** @type {HTMLTemplateElement} */ (
  parseWindows(markup).querySelector('#tpl-patterns-window')
);

/** @param {string} current  @param {(pattern: string) => void} set */
export function patternsWindow(current, set) {
  const win = cloneWindow(tpl);
  const chooser = /** @type {any} */ (win.querySelector('sm-desktop-patterns'));
  chooser.pattern = current;
  chooser.addEventListener('sm-set-pattern', (/** @type {Event} */ e) =>
    set(/** @type {CustomEvent} */ (e).detail.pattern)
  );
  return win;
}
