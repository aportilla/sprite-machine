// What the applications' windows and dialogs share: parsing a windows.html,
// cloning a window from its template, a text selection's window, and an alert
// asked with its message.

import { effectiveScale } from 'vintage-frames';

/** @typedef {import('vintage-frames').VfWindow} VfWindow */

/**
 * Parses an application's windows.html into a host element of this document,
 * with every custom element upgraded so a window takes properties before it
 * is appended. Template content stays inert until cloneWindow.
 * @param {string} html
 * @returns {HTMLElement}
 */
export function parseWindows(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  customElements.upgrade(host);
  return host;
}

/**
 * A window cloned from its template and upgraded, ready for properties.
 * importNode, not cloneNode: customElements.upgrade() is a no-op on nodes
 * still owned by the template's document. On an un-upgraded element, Lit
 * applies a property only at its first update, after connectedCallback.
 * @param {HTMLTemplateElement} tpl
 * @returns {VfWindow}
 */
export function cloneWindow(tpl) {
  const win = /** @type {VfWindow} */ (
    document.importNode(/** @type {Element} */ (tpl.content.firstElementChild), true)
  );
  customElements.upgrade(win);
  return win;
}

/**
 * The selected text when the selection is anchored in one of `app`'s
 * windows, otherwise ''.
 * @param {import('vintage-frames/shell').WindowManager} windows
 * @param {string} app
 */
export function selectedTextIn(windows, app) {
  const sel = document.getSelection();
  const at = sel?.anchorNode ?? null;
  const el = at instanceof Element ? at : (at?.parentElement ?? null);
  const win = el?.closest('vf-window') ?? null;
  if (!sel || sel.isCollapsed || windows.appOf(win) !== app) return '';
  return sel.toString();
}

/** Selects everything in `node`. @param {Node|null} node */
export function selectContents(node) {
  const sel = document.getSelection();
  if (!node || !sel) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Each alert's authored height, the least it is asked at. */
const authored = new WeakMap();

/**
 * Ask `dialog`, an alert from an application's dialogs.html, with `message`
 * in its [data-message] paragraph. Resolves the pressed button's value, or
 * null for Escape.
 *
 * A longer message grows the box, as the kit's own Finder alerts do: 16 under
 * the message, the button row, then 16 and the plain frame's 10 below it. It
 * is measured once shown, since a closed dialog lays out nothing; the new size
 * lands before the first paint.
 * @param {import('vintage-frames/shell').AppContext} ctx
 * @param {import('vintage-frames').VfDialog} dialog
 * @param {string} message
 * @returns {Promise<string|null>}
 */
export function alert(ctx, dialog, message) {
  const text = /** @type {import('vintage-frames').VfParagraph} */ (
    dialog.querySelector('[data-message]')
  );
  const buttons = /** @type {HTMLElement & {top?: number|null}} */ (
    dialog.querySelector('vf-button-group')
  );
  if (!authored.has(dialog)) authored.set(dialog, dialog.height ?? 0);
  text.textContent = message;
  const answer = ctx.ask(dialog);
  const scale = effectiveScale(text);
  const tall = Math.ceil(text.getBoundingClientRect().height / scale);
  const row = Math.ceil(buttons.getBoundingClientRect().height / scale);
  dialog.height = Math.max(authored.get(dialog), (text.top ?? 0) + tall + 16 + row + 26);
  buttons.top = dialog.height - 26;
  return answer;
}
