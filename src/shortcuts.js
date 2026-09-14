// Document-level keys: S, B, R, G, E and I pick a tool, and 1 to LAYER_MAX pick
// the active document's layer. Gesture and selection keys (Esc, Shift, Delete,
// Backspace) live in <sm-draw-canvas>.

import { LAYER_MAX } from 'sprite-machine';
import { session } from './state/session.js';
import { shell } from './state/shell.js';
import { workspace } from './state/workspace.js';

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
    const digit = /^[0-9]$/.test(k) ? Number(k) : 0;
    if (digit >= 1 && digit <= LAYER_MAX) {
      // A switch mid-drag would reset the canvas under the gesture.
      const ctx = workspace.active();
      if (!ctx || session.get().gesture || digit > ctx.doc.get().layers.length) return;
      workspace.setLayer(ctx.key, digit - 1);
      e.preventDefault();
      return;
    }
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
