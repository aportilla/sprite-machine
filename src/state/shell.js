// ---------------------------------------------------------------------------
// `shell` slice — the desktop chrome's shared state: which APPLICATION is
// front (the Finder, the Sprite Editor or the Text Viewer — docs/apps-plan.md),
// its one-boolean shadow `appActive` (is the Sprite Editor front — "a
// document window is the desktop's active window"), and the DESKTOP PATTERN
// (System 7's General Controls / 7.5's Desktop Patterns setting — what the
// Desktop Patterns panel's Set writes, what shell/patterns.js paints onto
// the desktop and desktop-state.js persists).
// Store-driven so the menu bar's swap, the menu checkmarks + enabled states
// and the windows' `hidden` attributes read one truth (a menu pick and a
// desktop click are the same action). Document windows live elsewhere
// entirely: one exists per open document (the workspace), so their
// visibility is existence, not a flag here.
//
// THE FRONT APPLICATION is a reading of the desktop's active window, made
// in the one place the activation lands (shell/windows.js applyActive): a
// document window active → the Sprite Editor; a panel window active → the
// application its owner declared at adoption (a folder window and the
// Desktop Patterns panel say the Finder, a text window the Text Viewer);
// no active window, or a panel that declares nothing → the Finder, the
// desktop's application and the default. The menu bar belongs to the front
// application (shell/menu-bar.js swaps its menus on every change here),
// and `appActive` is `frontApp === SPRITE_EDITOR`, written in the SAME
// patch by the one setter, so the two can never disagree.
//
// Three of the UTILITY windows (Tools palette, 3D View, Sprite View) are
// PERMANENT chrome: no close box, no menu toggle — `appActive` alone decides
// whether they're on screen. The fourth, the 3D Sprite Atlas, is the one
// exception: it hides with the application like the rest AND behind its own
// toggle (prefs.showRing — View → 3D Sprite Atlas, its close box). They
// belong to the Sprite Editor, so they hide as a set while another
// application is front and return with it. Both fields are transient
// session state MIRRORING the desktop's own activation truth
// (desktop.activeWindow): shell/windows.js seeds them by READING that truth
// at wire-up and follows vf-activate thereafter — never from a constant of
// its own, so the mirror can't disagree with the kit. They therefore boot
// as the Finder (nothing has activated yet — a dialog-greeted boot stays
// desktop-focused, no windoids without a document window) and flip to the
// Sprite Editor the moment any document window opens: the kit activates a
// newly slotted window.
// ---------------------------------------------------------------------------

import { createStore } from './store.js';

/** The three applications' ids (docs/apps-plan.md §3.1) — the bottom of
 *  the dependency arrows, so shell/ and apps/ both import them. A fourth
 *  application is a fourth constant and a fourth directory under src/apps/. */
export const FINDER = 'finder';
export const SPRITE_EDITOR = 'sprite-editor';
export const TEXT_VIEWER = 'text-viewer';
/** @typedef {typeof FINDER | typeof SPRITE_EDITOR | typeof TEXT_VIEWER} AppId */

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
    /** @type {AppId} The front application — whose menus the bar holds.
     *  The Finder agrees with activeKey's null and the kit's empty boot;
     *  the operative seed is read off desktop.activeWindow at wire-up
     *  (shell/windows.js). */
    frontApp: FINDER,
    // Whether a document window is the desktop's active window — the Sprite
    // Editor front. False = another application's turn ("the Finder" for
    // the chrome that only asks this): utility windows hide, the options
    // strip blanks, the tool keys go inert. Always frontApp === SPRITE_EDITOR.
    appActive: false,
    /** @type {string} the desktop pattern — a kit library name (`gray-50`,
     *  `bricks`, …) or sixteen hex digits: exactly what vf-desktop's
     *  `pattern` takes. Restored from desktop-state at boot (a persisted
     *  setting, unlike the two above), else the dither. */
    desktopPattern: DEFAULT_DESKTOP_PATTERN,
  });
  return {
    store,
    get: store.get,
    subscribe: store.subscribe,

    /** @param {AppId} id  Written only from the desktop's activation wire
     *  (shell/windows.js: the activeWindow read at wire-up, vf-activate
     *  thereafter). One patch writes the id and its boolean shadow. */
    setFrontApp(id) {
      const frontApp = id === SPRITE_EDITOR || id === TEXT_VIEWER ? id : FINDER;
      if (store.get().frontApp === frontApp) return;
      store.patch({ frontApp, appActive: frontApp === SPRITE_EDITOR });
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
