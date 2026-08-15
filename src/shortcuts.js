// ---------------------------------------------------------------------------
// Global editor shortcuts — the document-level half of the old key handler:
// B / R / G / I pick the pencil / rect / fill / eyedropper tools, E selects
// the transparent ink — straight session actions. Guards, in order:
// while the picker dialog is open the native <dialog> owns the keys (Esc
// closes it); keys typed into a text/number input never switch tools (the
// kit's fields host their <input> in shadow DOM, so check the COMPOSED path's
// innermost target, not the light-DOM tag); modifier chords pass through.
//
// The gesture-scoped keys (Esc to cancel a rect drag, Shift to square-lock it,
// B/R/G/I abandoning an in-flight box) live inside <sm-draw-canvas> — they're
// canvas business, and the two handlers compose without ordering coupling.
//
// Wired once by main.js; returns a dispose for HMR teardown.
// ---------------------------------------------------------------------------

import { session } from './state/session.js';

export function initShortcuts() {
  /** @param {KeyboardEvent} e */
  const onKeyDown = (e) => {
    if (session.get().pickerOpen) return;
    const target = e.composedPath ? e.composedPath()[0] : e.target;
    const tag = target && /** @type {Element} */ (target).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'b' || k === 'r' || k === 'g' || k === 'i') {
      session.setTool(
        k === 'b' ? 'pencil' : k === 'r' ? 'rect' : k === 'g' ? 'fill' : 'eyedropper'
      );
    } else if (k === 'e') {
      session.selectTransparent();
    } else {
      return;
    }
    e.preventDefault();
  };
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}
