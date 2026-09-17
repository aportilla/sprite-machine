// Session slice: editor UI state shared by every document window. The face and
// layer a window edits are on its workspace context.
//
// Setters clamp to bounds the caller derives from the doc's tile geometry.

import { createStore } from './store.js';
import { PENCIL_PALETTE } from '../lib/palette.js';
import { PENCIL_SHAPES } from '../lib/brush.js';

const clampBrush = (n, max) => Math.max(1, Math.min(max, Math.round(Number(n) || 1)));
const clampRadius = (n, max) => Math.max(0, Math.min(max, Math.round(Number(n) || 0)));

export function createSession() {
  const store = createStore({
    // 'select' | 'pencil' | 'rect' | 'fill' | 'eraser' | 'eyedropper'. The
    // eraser is a tool that writes transparency, so the ink is always a color.
    tool: 'pencil',
    // The active color, seeded from the pencil palette.
    ink: { ...PENCIL_PALETTE[0].rgb },
    pencilSize: 1, // the pencil's N×N tip footprint, in texels
    // 'circle' (the disc inscribed in the N×N box, lib/brush.js brushRows) or
    // 'square'. A right-button pencil stroke erases with this shape.
    pencilShape: 'circle',
    // The eraser's N×N tip and shape, independent of the pencil's.
    eraserSize: 1,
    eraserShape: 'circle',
    cornerRadius: 0, // the rect tool's corner radius, in texels (0 = sharp)
    // Fill tool options. Contiguous fills a 4-connected region. Otherwise every
    // matching texel on the face is recolored, or on every face with
    // fillAllFaces.
    fillContiguous: true,
    fillAllFaces: false,
    pickerOpen: false,
    // A canvas drag is in progress, from press to release. The layer keys wait
    // for it, since a switch would reset the canvas mid-gesture.
    gesture: false,
    // Option (Alt) is held over the Sprite Editor. The Tools palette and the
    // canvas's preview show the eyedropper (lib/tools.js springTool). `tool`
    // is unchanged.
    option: false,
  });

  return {
    store,
    get: store.get,
    subscribe: store.subscribe,

    /** @param {'select'|'pencil'|'rect'|'fill'|'eraser'|'eyedropper'} tool */
    setTool(tool) {
      store.patch({ tool });
    },

    // Every color pick goes through here, from the picker and the eyedropper.
    /** @param {{r:number,g:number,b:number}} color */
    pickColor(color) {
      const patch = { ink: { r: color.r, g: color.g, b: color.b } };
      if (store.get().tool === 'eraser') patch.tool = 'pencil';
      store.patch(patch);
    },

    /** @param {number} n  @param {number} max */
    setPencilSize(n, max) {
      store.patch({ pencilSize: clampBrush(n, max) });
    },

    /** @param {string} shape */
    setPencilShape(shape) {
      if (!PENCIL_SHAPES.includes(/** @type {any} */ (shape))) return;
      store.patch({ pencilShape: shape });
    },

    /** @param {number} n  @param {number} max */
    setEraserSize(n, max) {
      store.patch({ eraserSize: clampBrush(n, max) });
    },

    /** @param {string} shape */
    setEraserShape(shape) {
      if (!PENCIL_SHAPES.includes(/** @type {any} */ (shape))) return;
      store.patch({ eraserShape: shape });
    },

    /** @param {number} n  @param {number} max */
    setCornerRadius(n, max) {
      store.patch({ cornerRadius: clampRadius(n, max) });
    },

    // Re-clamp the tip sizes and corner radius after a tile resize.
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
    setFillContiguous(v) {
      store.patch({ fillContiguous: !!v });
    },

    /** @param {boolean} v */
    setFillAllFaces(v) {
      store.patch({ fillAllFaces: !!v });
    },

    openPicker() {
      store.patch({ pickerOpen: true });
    },

    closePicker() {
      store.patch({ pickerOpen: false });
    },

    /** @param {boolean} v */
    setGesture(v) {
      store.patch({ gesture: !!v });
    },

    /** @param {boolean} v */
    setOption(v) {
      store.patch({ option: !!v });
    },
  };
}

export const session = createSession();
