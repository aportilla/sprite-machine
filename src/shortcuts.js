// Document-level tool keys: S, B, R, G, E and I pick a tool. Gesture keys
// (Esc, Shift) live in <sm-draw-canvas>.

import { session } from './state/session.js';
import { shell } from './state/shell.js';

export function initShortcuts() {
  /** @param {KeyboardEvent} e */
  const onKeyDown = (e) => {
    // Only while the Sprite Editor is front, the same gate as its menus.
    if (!shell.get().appActive) return;
    if (session.get().pickerOpen) return;
    // The kit's fields put their <input> in shadow DOM, so read the composed
    // path's innermost target.
    const target = e.composedPath ? e.composedPath()[0] : e.target;
    const tag = target && /** @type {Element} */ (target).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const tool = {
      s: 'select',
      b: 'pencil',
      r: 'rect',
      g: 'fill',
      e: 'eraser',
      i: 'eyedropper',
    }[k];
    if (!tool) return;
    session.setTool(tool);
    e.preventDefault();
  };
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}
