// ---------------------------------------------------------------------------
// `shell` slice — the desktop chrome's shared state: whether the APPLICATION
// is active (vs. the desktop — "the Finder") and the DESKTOP PATTERN
// (System 7's General Controls / 7.5's Desktop Patterns setting — what the
// Desktop Patterns panel's Set writes, what shell/patterns.js paints onto
// the desktop and desktop-state.js persists).
// Store-driven so the menu checkmarks + enabled states and the windows'
// `hidden` attributes read one truth (a menu pick and a desktop click are
// the same action). Document windows live elsewhere entirely: one exists per
// open document (the workspace), so their visibility is existence, not a
// flag here.
//
// Three of the UTILITY windows (Tools palette, 3D View, Sprite View) are
// PERMANENT chrome: no close box, no menu toggle — `appActive` alone decides
// whether they're on screen. The fourth, the 3D Sprite Atlas, is the one
// exception: it hides with the application like the rest AND behind its own
// toggle (prefs.showRing — View → 3D Sprite Atlas, its close box). They
// belong to the application, so they hide as
// a set while the desktop is focused and return with it. `appActive` is
// transient session state MIRRORING the desktop's own activation truth
// (desktop.activeWindow): shell/windows.js seeds it by READING that truth at
// wire-up and follows vf-activate thereafter — never from a constant of its
// own, so the mirror can't disagree with the kit. It therefore boots false
// (nothing has activated yet — a dialog-greeted boot stays desktop-focused,
// no windoids without a document window) and flips true the moment any
// document window opens: the kit activates a newly slotted window.
// ---------------------------------------------------------------------------

import { createStore } from './store.js';

/** The utility (windoid) windows, by shell id — the three permanent ones
 *  (visibility appActive's alone) and the toggleable 3D Sprite Atlas
 *  (`ring`: appActive AND prefs.showRing); document windows are
 *  workspace-managed. */
export const WINDOW_IDS = ['tools', 'sprite', 'stage', 'ring'];

/** The desktop pattern a desktop boots on — the kit's own default, the
 *  classic 50% dither (vintage-frames docs/PATTERNS.md). */
export const DEFAULT_DESKTOP_PATTERN = 'gray-50';

export function createShell() {
  const store = createStore({
    // Whether a document window is the desktop's active window. False =
    // desktop focus ("the Finder"): utility windows hide, the options strip
    // blanks, and the document-scoped menu items disable. False agrees with
    // activeKey's null and the kit's empty boot; the operative seed is read
    // off desktop.activeWindow at wire-up (shell/windows.js).
    appActive: false,
    /** @type {string} the desktop pattern — a kit library name (`gray-50`,
     *  `bricks`, …) or sixteen hex digits: exactly what vf-desktop's
     *  `pattern` takes. Restored from desktop-state at boot (a persisted
     *  setting, unlike the flag above), else the dither. */
    desktopPattern: DEFAULT_DESKTOP_PATTERN,
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

    /** @param {string} v  A kit pattern name or sixteen hex digits — the
     *  Desktop Patterns panel's Set, or the boot restore. Stored as given
     *  (trimmed; an empty write is the default): the slice doesn't validate
     *  — the wire (shell/patterns.js) checks a restored value against the
     *  kit's grammar, and the panel only ever sets library names. */
    setDesktopPattern(v) {
      const next = String(v ?? '').trim() || DEFAULT_DESKTOP_PATTERN;
      if (store.get().desktopPattern === next) return;
      store.patch({ desktopPattern: next });
    },
  };
}

// The app-wide singleton (one desktop per page).
export const shell = createShell();
