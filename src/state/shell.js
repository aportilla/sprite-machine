// ---------------------------------------------------------------------------
// `shell` slice — the desktop chrome's shared state: whether the APPLICATION
// is active (vs. the desktop — "the Finder"), the desktop-icon selection,
// and the Show Grid toggle. Store-driven so the menu checkmarks + enabled
// states, the windows' `hidden` attributes, and the canvas's grid overlay
// all read one truth (a menu pick, a desktop click and a boot restore are
// the same action). Document windows live elsewhere entirely: one exists per
// open document (the workspace), so their visibility is existence, not a
// flag here.
//
// The three UTILITY windows (Tools palette, 3D View, Sprite View) are
// PERMANENT chrome: no close box, no menu toggle — `appActive` alone decides
// whether they're on screen. They belong to the application, so they hide as
// a set while the desktop is focused and return with it. `appActive` is
// transient session state, written only from the desktop's vf-activate
// events (shell/windows.js), so it boots true and no boot path —
// ?hide=document included — can clear it.
// ---------------------------------------------------------------------------

import { createStore } from './store.js';

/** The utility (windoid) windows, by shell id — permanent chrome (their
 *  geometry persists; their visibility is appActive's alone); document
 *  windows are workspace-managed. */
export const WINDOW_IDS = ['tools', 'sprite', 'stage'];

export function createShell() {
  const store = createStore({
    // Whether a document window is the desktop's active window. False =
    // desktop focus ("the Finder"): utility windows hide, the options strip
    // blanks, and the document-scoped menu items disable.
    appActive: true,
    /** @type {string[]} selected desktop-icon keys ("sample:Car" / "doc:<id>") */
    iconSelection: [],
    showGrid: false,
  });
  return {
    store,
    get: store.get,
    subscribe: store.subscribe,

    /** @param {boolean} v  Written only from the desktop's vf-activate wire. */
    setAppActive(v) {
      if (store.get().appActive === !!v) return;
      store.patch({ appActive: !!v });
    },

    /** @param {string[]} keys  The icon layer reports every selection change. */
    setIconSelection(keys) {
      const prev = store.get().iconSelection;
      if (prev.length === keys.length && prev.every((k, i) => k === keys[i])) return;
      store.patch({ iconSelection: [...keys] });
    },

    /** @param {boolean} v */
    setShowGrid(v) {
      store.patch({ showGrid: !!v });
    },
  };
}

// The app-wide singleton (one desktop per page).
export const shell = createShell();
