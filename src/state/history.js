// History slice: one document's bounded undo/redo. Entry kinds:
//   - `tile`: one gesture on one face of one layer ({layer, face, before,
//     after} tile snapshots), pushed by the editor when the canvas commits a
//     gesture.
//   - `atlas`: a pair of whole-sheet {image, names} snapshots for a resize,
//     replace all or a layer added, removed or moved, recorded by
//     withAtlasSnapshot.
//   - `names`: a pair of layer name lists for a rename, recorded by
//     withNamesSnapshot.
//
// Entries apply through doc.restoreTile, doc.restoreAtlas and doc.setNames,
// which are structural changes. Snapshots are copied on push and on apply, so
// no live buffer can alter an entry. A wholesale load (a new doc sheet
// generation) clears both stacks.

import { createStore } from './store.js';

export const HISTORY_LIMIT = 50;

const copyTile = (t) =>
  t == null
    ? null
    : { width: t.width, height: t.height, data: new Uint8ClampedArray(t.data) };

/**
 * @param {ReturnType<typeof import('./doc.js').createDoc>} doc
 * @param {{limit?: number}} [opts]
 */
export function createHistory(doc, { limit = HISTORY_LIMIT } = {}) {
  const store = createStore({ canUndo: false, canRedo: false });

  /** @type {object[]} */
  let undoStack = [];
  /** @type {object[]} */
  let redoStack = [];
  let lastSheet = doc.get().sheet;

  const sync = () =>
    store.patch({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });

  function push(entry) {
    undoStack.push(entry);
    if (undoStack.length > limit) undoStack.shift();
    redoStack = [];
    sync();
  }

  // The sheet and its names, copied.
  const atlasSnapshot = () => {
    const s = doc.get();
    return { image: copyTile(s.atlasImage), names: [...s.names] };
  };

  // Apply one side of an entry. Restores take copies because restoreAtlas
  // adopts its image by reference.
  function apply(entry, direction) {
    const side = direction === 'undo' ? entry.before : entry.after;
    if (entry.kind === 'tile') doc.restoreTile(entry.layer, entry.face, copyTile(side));
    else if (entry.kind === 'names') doc.setNames([...side]);
    else doc.restoreAtlas(copyTile(side.image), [...side.names]);
  }

  const unsub = doc.subscribe((s) => {
    if (s.sheet !== lastSheet) {
      lastSheet = s.sheet;
      undoStack = [];
      redoStack = [];
      sync();
    }
  });

  return {
    store,
    get: store.get,
    subscribe: store.subscribe,

    /** One committed gesture on one face of one layer. The buffers are copied,
     *  so callers may pass their live working tile. A pair with identical bytes
     *  is not recorded.
     *  @param {number} layer
     *  @param {string} face
     *  @param {{width:number,height:number,data:Uint8ClampedArray}|null} before
     *  @param {{width:number,height:number,data:Uint8ClampedArray}|null} after */
    pushTile(layer, face, before, after) {
      if (
        before &&
        after &&
        before.data.length === after.data.length &&
        before.data.every((v, i) => v === after.data[i])
      ) {
        return;
      }
      push({
        kind: 'tile',
        layer,
        face,
        before: copyTile(before),
        after: copyTile(after),
      });
    },

    /** Run a whole-atlas mutation. `fn` returns whether anything changed, and
     *  the before/after pair of sheet and names is recorded only if it did.
     *  Returns `fn`'s result. */
    withAtlasSnapshot(fn) {
      doc.drain();
      if (!doc.get().atlasImage) return fn();
      const before = atlasSnapshot();
      const changed = fn();
      if (changed) {
        doc.drain(); // fn may have left a pending live blit
        push({ kind: 'atlas', before, after: atlasSnapshot() });
      }
      return changed;
    },

    /** Run a layer rename. `fn` returns whether the names changed, and the
     *  before/after pair is recorded only if they did. Returns `fn`'s result. */
    withNamesSnapshot(fn) {
      const before = [...doc.get().names];
      const changed = fn();
      if (changed) push({ kind: 'names', before, after: [...doc.get().names] });
      return changed;
    },

    undo() {
      const entry = undoStack.pop();
      if (!entry) return false;
      apply(entry, 'undo');
      redoStack.push(entry);
      sync();
      return true;
    },

    redo() {
      const entry = redoStack.pop();
      if (!entry) return false;
      apply(entry, 'redo');
      undoStack.push(entry);
      sync();
      return true;
    },

    clear() {
      undoStack = [];
      redoStack = [];
      sync();
    },

    dispose() {
      unsub();
    },
  };
}
