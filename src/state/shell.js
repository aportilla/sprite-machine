// ---------------------------------------------------------------------------
// `shell` slice — the desktop chrome's shared state: whether the APPLICATION
// is active (vs. the desktop — "the Finder") and the desktop-icon selection.
// Store-driven so the menu checkmarks + enabled states and the windows'
// `hidden` attributes read one truth (a menu pick and a desktop click are
// the same action). Document windows live elsewhere entirely: one exists per
// open document (the workspace), so their visibility is existence, not a
// flag here.
//
// The three UTILITY windows (Tools palette, 3D View, Sprite View) are
// PERMANENT chrome: no close box, no menu toggle — `appActive` alone decides
// whether they're on screen. They belong to the application, so they hide as
// a set while the desktop is focused and return with it. `appActive` is
// transient session state MIRRORING the desktop's own activation truth
// (desktop.activeWindow): shell/windows.js seeds it by READING that truth at
// wire-up and follows vf-activate thereafter — never from a constant of its
// own, so the mirror can't disagree with the kit. It therefore boots false
// (nothing has activated yet — a dialog-greeted boot stays desktop-focused,
// no windoids without a document window) and flips true the moment any
// document window opens: the kit activates a newly slotted window, hidden
// ones included, which is what keeps ?hide=document captures' windoids up.
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
    // blanks, and the document-scoped menu items disable. False agrees with
    // activeKey's null and the kit's empty boot; the operative seed is read
    // off desktop.activeWindow at wire-up (shell/windows.js).
    appActive: false,
    /** @type {string[]} selected desktop-icon keys ("doc:<id>") */
    iconSelection: [],
  });
  return {
    store,
    get: store.get,
    subscribe: store.subscribe,

    /** @param {boolean} v  Written only from the desktop's activation wire
     *  (shell/windows.js: the activeWindow read at wire-up, vf-activate
     *  thereafter). */
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
  };
}

// The app-wide singleton (one desktop per page).
export const shell = createShell();
