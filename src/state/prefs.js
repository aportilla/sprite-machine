// ---------------------------------------------------------------------------
// `prefs` slice — the view toggles. `lowpoly` / `autoRotate` are the render
// toggles, written by the stage controls (and the ?lowpoly / ?rotate boot
// params): `lowpoly` is read by the rebuilder, `autoRotate` by the render
// loop as a plain per-frame read. `showRing` is the 3D Sprite Atlas
// windoid's toggle — View → 3D Sprite Atlas (and ?ring=…), its close box the
// same uncheck — read by shell/windows.js (the windoid's visibility, the
// placement's shortened doc box) and the renderer's follower (scene/ring.js
// renders only while shown); OFF every load. Nothing here persists — every
// load boots the defaults.
// ---------------------------------------------------------------------------

import { createStore } from './store.js';

export function createPrefs() {
  const store = createStore({
    lowpoly: true, // additive 45° wedges over same-color staircases (default on)
    autoRotate: true,
    showRing: false, // the 3D Sprite Atlas windoid (View → 3D Sprite Atlas), off by default
  });
  return {
    store,
    get: store.get,
    subscribe: store.subscribe,
    /** @param {boolean} v */
    setLowpoly(v) {
      store.patch({ lowpoly: !!v });
    },
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
