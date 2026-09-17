// Prefs slice: view toggles. Only the 3D Sprite Atlas is restored, by main.js
// from the desktop state; the rest start at their defaults every load.

import { createStore } from './store.js';

export function createPrefs() {
  const store = createStore({
    autoRotate: false, // the 3D View's auto-spin
    singleLayer: false, // the 3D View shows only the edited layer
    showRing: false, // the 3D Sprite Atlas windoid (View → 3D Sprite Atlas)
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
    setSingleLayer(v) {
      store.patch({ singleLayer: !!v });
    },
    /** @param {boolean} v */
    setShowRing(v) {
      store.patch({ showRing: !!v });
    },
  };
}

export const prefs = createPrefs();
