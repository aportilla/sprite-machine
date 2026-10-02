// Text Viewer windows: one per open text file, cloned from windows.html, the
// body the file's text verbatim and read-only.

import markup from './windows.html?raw';
import { cloneWindow, parseWindows } from '../windows.js';

const tpl = /** @type {HTMLTemplateElement} */ (
  parseWindows(markup).querySelector('#tpl-text-window')
);

/** A text window's body, whose contents Select All selects.
 *  @param {import('vintage-frames').VfWindow} win */
export const bodyOf = (win) =>
  /** @type {HTMLElement} */ (win.querySelector('.text-body'));

/** A window titled `name` showing `text`. @param {string} name @param {string} text */
export function textWindow(name, text) {
  const win = cloneWindow(tpl);
  win.heading = name;
  bodyOf(win).textContent = text;
  return win;
}
