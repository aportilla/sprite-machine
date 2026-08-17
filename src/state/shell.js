// ---------------------------------------------------------------------------
// `shell` slice — the desktop chrome's shared state: which of the three
// UTILITY windows are wanted on screen, whether the APPLICATION is active
// (vs. the desktop — "the Finder"), the desktop-icon selection, and the Show
// Grid toggle. Store-driven so the menu checkmarks + enabled states, the
// windows' `hidden` attributes, and the canvas's grid overlay all read one
// truth (a menu pick, a close box, a desktop click and a boot restore are
// the same action). Document windows live elsewhere entirely: one exists per
// open document (the workspace), so their visibility is existence, not a
// flag here.
//
// TWO TRUTHS COMPOSE for the utility windows (Tools palette, 3D View, Sprite
// View): `windows[id]` is the WANTED flag (the View-menu toggle — intent,
// persisted) and `appActive` gates reality — a utility window is on screen
// iff wanted && appActive. Deactivation therefore never loses the user's
// palette arrangement: clicking back into a document restores exactly the
// windoids that were up. `appActive` itself is transient session state,
// written only from the desktop's vf-activate events (shell/windows.js), so
// it boots true and no boot path — ?hide=document included — can clear it.
// ---------------------------------------------------------------------------

import { createStore } from './store.js';

/** The utility (windoid) windows, by shell id — the whole shell-flag set;
 *  document windows are workspace-managed. */
export const WINDOW_IDS = ['tools', 'sprite', 'stage'];

export function createShell() {
  const store = createStore({
    // All three windoids are open by default (persistent panels, not
    // hunt-for-them popups); closing any is reversible from the menu bar
    // (View for the view windows, Tools → Tools Palette for the windoid).
    /** @type {Record<string, boolean>} */
    windows: { tools: true, sprite: true, stage: true },
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
