// ---------------------------------------------------------------------------
// `shell` slice — the desktop chrome's shared state: which of the four
// windows are on screen, and the Show Grid toggle. Store-driven so the menu
// checkmarks (View, plus the Tools menu's palette toggle), the windows'
// `hidden` attributes, and the canvas's grid overlay all read one truth (a
// menu pick, a close box, and a boot restore are the same action).
// ---------------------------------------------------------------------------

import { createStore } from './store.js';

/** The four desktop windows, by shell id. */
export const WINDOW_IDS = ['document', 'tools', 'sprite', 'stage'];

export function createShell() {
  const store = createStore({
    // All four windows are open by default (persistent panels, not
    // hunt-for-them popups); closing any is reversible from the menu bar
    // (View for the view windows, Tools → Tools Palette for the windoid).
    /** @type {Record<string, boolean>} */
    windows: { document: true, tools: true, sprite: true, stage: true },
    showGrid: false,
  });
  return {
    store,
    get: store.get,
    subscribe: store.subscribe,

    /** @param {string} id  @param {boolean} visible */
    setWindowVisible(id, visible) {
      const windows = store.get().windows;
      if (!(id in windows) || windows[id] === !!visible) return;
      store.patch({ windows: { ...windows, [id]: !!visible } });
    },

    /** @param {string} id */
    toggleWindow(id) {
      this.setWindowVisible(id, !store.get().windows[id]);
    },

    /** Hide every window (File → Quit leaves the bare desktop). */
    hideAll() {
      const windows = { ...store.get().windows };
      for (const id of WINDOW_IDS) windows[id] = false;
      store.patch({ windows });
    },

    /** @param {boolean} v */
    setShowGrid(v) {
      store.patch({ showGrid: !!v });
    },
  };
}

// The app-wide singleton (one desktop per page).
export const shell = createShell();
