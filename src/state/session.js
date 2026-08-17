// ---------------------------------------------------------------------------
// `session` slice — the shared editor UI state that used to trap six UI regions
// inside one element: the active tool and ink, the MRU color recency, the
// per-tool options, and the picker dialog's open flag. APP-LEVEL by design
// (System 7: one palette, one ink, however many documents are open); the
// per-window half — which face a document window is editing — lives on its
// workspace context, not here.
//
// Every action is a named, Node-tested function carrying the exact semantics of
// the old element methods (`#selectColor`, `#switchTool`, `#touchRecent`, the
// willUpdate clamps). Pure JS, zero deps beyond the palette it seeds from.
//
// Clamp BOUNDS are the caller's job (they derive from the doc's tile geometry,
// which this slice deliberately doesn't know); the clamping itself lives here so
// a persisted value can never escape its bounds.
// ---------------------------------------------------------------------------

import { createStore } from './store.js';
import { PENCIL_PALETTE } from '../lib/constants.js';
import { rgbKey } from '../lib/color.js';

// How many "last used" colors show under the current swatch (recency slot 0 is
// the current ink itself, so the list holds one extra).
export const RECENT_SLOTS = 3;

const clampBrush = (n, max) => Math.max(1, Math.min(max, Math.round(Number(n) || 1)));
const clampRadius = (n, max) => Math.max(0, Math.min(max, Math.round(Number(n) || 0)));

export function createSession() {
  const store = createStore({
    // The active tool: 'pencil' | 'rect' | 'fill' | 'eraser' | 'eyedropper'.
    // The eraser is a formal tool mode (a pencil that writes transparency),
    // not an ink: the ink below is always a solid color.
    tool: 'pencil',
    // The active color. Seeded from the pencil palette so it is never null —
    // but NOT entered into `recent`: the untouched mount default never joins
    // the recency row.
    ink: { ...PENCIL_PALETTE[0].rgb },
    /** @type {{r:number,g:number,b:number}[]} MRU inks, current at [0] */
    recent: [],
    pencilSize: 1, // the pencil's N×N tip footprint, in texels
    // The eraser's N×N tip footprint — its OWN setting, deliberately
    // independent of the pencil's (not a DRY slip: the two may diverge).
    eraserSize: 1,
    cornerRadius: 0, // the rect tool's corner radius, in texels (0 = sharp)
    fillReplace: false,
    fillAllTiles: false,
    pickerOpen: false,
  });

  return {
    store,
    get: store.get,
    subscribe: store.subscribe,

    // Select a tool — every tool (the eraser and eyedropper included) is a
    // sticky mode: it stays selected until another tool is picked. The ink is
    // always set (seeded at boot), so there is nothing to "ensure".
    /** @param {'pencil'|'rect'|'fill'|'eraser'|'eyedropper'} tool */
    setTool(tool) {
      store.patch({ tool });
    },

    // The single path every color pick funnels through (picker dialog, in-sprite
    // eyedrop, recency swatch): make `color` the ink and promote it to the top
    // of the recency list. Picking a color while the ERASER is held means "paint
    // with this" — it returns to the pencil; any other tool is untouched, so an
    // eyedrop leaves the eyedropper selected (sticky modality).
    /** @param {{r:number,g:number,b:number}} color */
    pickColor(color) {
      const ink = { r: color.r, g: color.g, b: color.b };
      const key = rgbKey(ink);
      const recent = [ink, ...store.get().recent.filter((x) => rgbKey(x) !== key)].slice(
        0,
        RECENT_SLOTS + 1
      );
      const patch = { ink, recent };
      if (store.get().tool === 'eraser') patch.tool = 'pencil';
      store.patch(patch);
    },

    /** @param {number} n  @param {number} max */
    setPencilSize(n, max) {
      store.patch({ pencilSize: clampBrush(n, max) });
    },

    /** @param {number} n  @param {number} max */
    setEraserSize(n, max) {
      store.patch({ eraserSize: clampBrush(n, max) });
    },

    /** @param {number} n  @param {number} max */
    setCornerRadius(n, max) {
      store.patch({ cornerRadius: clampRadius(n, max) });
    },

    // A tile resize can leave the persisted pencil / eraser size or corner
    // radius past the new bounds — re-clamp them (the old willUpdate clamp,
    // relocated).
    /** @param {number} brushMax  @param {number} radiusMax */
    clampTools(brushMax, radiusMax) {
      const s = store.get();
      store.patch({
        pencilSize: clampBrush(s.pencilSize, brushMax),
        eraserSize: clampBrush(s.eraserSize, brushMax),
        cornerRadius: clampRadius(s.cornerRadius, radiusMax),
      });
    },

    /** @param {boolean} v */
    setFillReplace(v) {
      store.patch({ fillReplace: !!v });
    },

    /** @param {boolean} v */
    setFillAllTiles(v) {
      store.patch({ fillAllTiles: !!v });
    },

    openPicker() {
      store.patch({ pickerOpen: true });
    },

    closePicker() {
      store.patch({ pickerOpen: false });
    },
  };
}

// The app-wide singleton: ONE editor session per page, and it outlives every
// element — session state can no longer die with a DOM node.
export const session = createSession();
