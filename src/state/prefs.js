// ---------------------------------------------------------------------------
// `prefs` slice — the view toggles. `lowpoly` / `autoRotate` are the render
// toggles, written by the stage controls (and the ?lowpoly / ?rotate boot
// params): `lowpoly` is read by the rebuilder, `autoRotate` by the render
// loop as a plain per-frame read. `showGuides` is the editor's extent rules
// — the alignment guides over every document canvas — written by
// View → Guides (and ?guides=1), read by each document window's canvas; OFF
// by default: the rules are a registration aid you ask for, not furniture.
// `canvasDither` is the paper under the art: white by default, the kit's 50%
// dither with View → Dither Background (and ?dither=1) — the classic
// transparency look, so WHITE art reads against it. Nothing here persists —
// every load boots the defaults.
// ---------------------------------------------------------------------------

import { createStore } from './store.js';

export function createPrefs() {
  const store = createStore({
    lowpoly: true, // additive 45° wedges over same-color staircases (default on)
    autoRotate: true,
    showGuides: false, // the canvas's extent rules (View → Guides), off by default
    canvasDither: false, // the canvas paper: white, or the 50% dither (View → Dither Background)
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
    setShowGuides(v) {
      store.patch({ showGuides: !!v });
    },
    /** @param {boolean} v */
    setCanvasDither(v) {
      store.patch({ canvasDither: !!v });
    },
  };
}

// The app-wide singleton (there is exactly one preferences set per page).
export const prefs = createPrefs();
