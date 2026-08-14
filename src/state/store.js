// ---------------------------------------------------------------------------
// The whole state mechanism: a hand-rolled observable store. ~30 lines, zero
// dependencies, pure JS — so every slice built on it gets direct Node tests.
//
// Semantics the slices rely on:
//   - `get()` returns the CURRENT snapshot object; a patch replaces the object
//     (spread), so `Object.is` on the snapshot is a valid "did anything change"
//     check for subscribers.
//   - `patch()` is a no-op (no new object, no notification) when every key is
//     `Object.is`-equal to what's already there — callers can patch freely
//     without generating phantom change events.
//   - Values are held BY REFERENCE, never cloned: pixel buffers (`views`,
//     `atlasImage`) keep their identity, which downstream code depends on.
//   - Notification is synchronous and coarse-grained (whole slice): the
//     subscribers are a handful of small lit templates and a rebuilder, and
//     re-render is a cheap diff. No per-key selectors until measured to matter.
// ---------------------------------------------------------------------------

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
