// A minimal observable store. Every slice is built on it.
//
// - get() returns the current snapshot. patch() replaces the object, so
//   Object.is on two snapshots detects a change.
// - patch() does nothing when every key is Object.is-equal to the current value.
// - Values are held by reference and never cloned. Pixel buffers keep their
//   identity.
// - Notification is synchronous and covers the whole slice.

/**
 * @template {object} S
 * @param {S} initial
 */
export function createStore(initial) {
  let state = Object.assign({}, initial);
  /** @type {Set<(s: S) => void>} */
  const listeners = new Set();
  return {
    get: () => state,
    /** @param {Partial<S>} partial */
    patch(partial) {
      let changed = false;
      for (const k in partial)
        if (!Object.is(state[k], partial[k])) {
          changed = true;
          break;
        }
      if (!changed) return;
      state = Object.assign({}, state, partial);
      for (const fn of listeners) fn(state);
    },
    /** @param {(s: S) => void} fn  @returns {() => void} unsubscribe */
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
