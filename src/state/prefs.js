// Prefs slice: view toggles. Nothing persists. Every load starts at the defaults.

import { createStore } from './store.js';

export function createPrefs() {
  const store = createStore({
    autoRotate: false, // the 3D View's auto-spin
    showRing: false, // the 3D Sprite Atlas windoid (View → 3D Sprite Atlas)
    showPalette: false, // the Color Palette windoid (View → Color Palette)
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
    /** @param {boolean} v */
    setShowPalette(v) {
      store.patch({ showPalette: !!v });
    },
  };
}

export const prefs = createPrefs();
