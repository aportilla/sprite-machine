// Shell slice: the front application and the desktop pattern.
//
// frontApp is the application of the desktop's active window, or the Finder
// when no window is active. shell/windows.js seeds it from
// desktop.activeWindow at wire-up and updates it on vf-activate. appActive is
// frontApp === SPRITE_EDITOR and is written in the same patch.
//
// desktopPattern is painted by shell/desktop-pattern.js and persisted by
// desktop-state.js.

import { createStore } from './store.js';

/** Application ids. Both shell/ and apps/ import them from here. */
export const FINDER = 'finder';
export const SPRITE_EDITOR = 'sprite-editor';
export const TEXT_VIEWER = 'text-viewer';
export const DESKTOP_PATTERNS = 'desktop-patterns';
/** @typedef {typeof FINDER | typeof SPRITE_EDITOR | typeof TEXT_VIEWER | typeof DESKTOP_PATTERNS} AppId */
/** @type {readonly AppId[]} */
const APP_IDS = [FINDER, SPRITE_EDITOR, TEXT_VIEWER, DESKTOP_PATTERNS];

/** The kit's default desktop pattern, the 50% dither. */
export const DEFAULT_DESKTOP_PATTERN = 'gray-50';

export function createShell() {
  const store = createStore({
    /** @type {AppId} the application whose menus the bar holds */
    frontApp: FINDER,
    appActive: false,
    /** @type {string} a kit pattern name (`gray-50`, `bricks`, …) or sixteen
     *  hex digits, as vf-desktop's `pattern` takes */
    desktopPattern: DEFAULT_DESKTOP_PATTERN,
  });
  return {
    store,
    get: store.get,
    subscribe: store.subscribe,

    /** @param {AppId} id  Called only by shell/windows.js. */
    setFrontApp(id) {
      const frontApp = APP_IDS.includes(id) ? id : FINDER;
      if (store.get().frontApp === frontApp) return;
      store.patch({ frontApp, appActive: frontApp === SPRITE_EDITOR });
    },

    /** @param {string} v  Not validated here. shell/desktop-pattern.js
     *  validates a restored value. */
    setDesktopPattern(v) {
      const next = String(v ?? '').trim() || DEFAULT_DESKTOP_PATTERN;
      if (store.get().desktopPattern === next) return;
      store.patch({ desktopPattern: next });
    },
  };
}

export const shell = createShell();
