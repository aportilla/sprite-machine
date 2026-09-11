// ---------------------------------------------------------------------------
// `prefs` slice — the view toggles. `autoRotate` is the one render toggle,
// written by the 3D View's controls strip and read by the render loop as a
// plain per-frame read — OFF every load, so the model sits still until asked
// to spin. (A second toggle, `lowpoly` — the strip's "smooth" box — lived
// here until Sep 4 2026; the low-poly wedge pass is ALWAYS ON now, the
// rebuilder building the wedge mesh unconditionally, so it is no state at
// all.) `showRing` is the 3D Sprite Atlas windoid's toggle — View → 3D
// Sprite Atlas, its close box the same uncheck — read by the Sprite
// Editor's windows (apps/sprite-editor/windows.js: the windoid's
// visibility, the placement's shortened doc box) and the renderer's follower (scene/ring.js renders only while
// shown); OFF every load. Nothing here persists — every load boots the
// defaults.
// ---------------------------------------------------------------------------

import { createStore } from './store.js';

export function createPrefs() {
  const store = createStore({
    autoRotate: false, // the 3D View's auto-spin (off by default — the model sits still)
    showRing: false, // the 3D Sprite Atlas windoid (View → 3D Sprite Atlas), off by default
  });
  return {
    store,
    get: store.get,
    subscribe: store.subscribe,
    /** @param {boolean} v */
    setAutoRotate(v) {
      store.patch({ autoRotate: !!v });
    },
    /** @param {boolean} v */
    setShowRing(v) {
      store.patch({ showRing: !!v });
    },
  };
}

// The app-wide singleton (there is exactly one preferences set per page).
export const prefs = createPrefs();
