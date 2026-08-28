// ---------------------------------------------------------------------------
// Global editor shortcuts — the document-level half of the old key handler:
// S / B / R / G / E / I pick the selection / pencil / rect / fill / eraser /
// eyedropper tools — straight session actions. Guards, in order:
// while the picker dialog is open the native <dialog> owns the keys (Esc
// closes it); keys typed into a text/number input never switch tools (the
// kit's fields host their <input> in shadow DOM, so check the COMPOSED path's
// innermost target, not the light-DOM tag); modifier chords pass through.
//
// The gesture-scoped keys (Esc to cancel a rect drag or drop a selection,
// Shift to square-lock a rect or axis-lock a selection move, S/B/R/G/E/I
// abandoning an in-flight box) live inside <sm-draw-canvas> — they're canvas
// business, and the two handlers compose without ordering coupling.
//
// Wired once by main.js; returns a dispose for HMR teardown.
// ---------------------------------------------------------------------------

import { session } from './state/session.js';
import { shell } from './state/shell.js';

export function initShortcuts() {
  /** @param {KeyboardEvent} e */
  const onKeyDown = (e) => {
    // Desktop focused ("the Finder"): the tool keys belong to the
    // application, and the application isn't frontmost — same gate the menu
    // items get, which is what keeps the two surfaces agreeing.
    if (!shell.get().appActive) return;
    if (session.get().pickerOpen) return;
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
