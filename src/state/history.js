// History slice: one document's bounded undo/redo over its pixels. Entry kinds:
//   - `tile`: one gesture on one face ({face, before, after} tile snapshots),
//     pushed by the editor when the canvas commits a gesture.
//   - `atlas`: a whole-sheet snapshot pair for resize and replace all,
//     recorded by withAtlasSnapshot.
//
// Entries apply through doc.restoreTile and doc.restoreAtlas, which are
// structural changes. Snapshots are copied on push and on apply, so no live
// buffer can alter an entry. A wholesale load (a new doc sheet generation)
// clears both stacks.

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

  // Apply one side of an entry. Restores take copies because restoreAtlas
  // adopts its image by reference.
  function apply(entry, direction) {
    const art = direction === 'undo' ? entry.before : entry.after;
    if (entry.kind === 'tile') doc.restoreTile(entry.face, copyTile(art));
    else doc.restoreAtlas(copyTile(art));
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

    /** One committed gesture on one face. The buffers are copied, so callers
     *  may pass their live working tile. A pair with identical bytes is not
     *  recorded.
     *  @param {string} face
     *  @param {{width:number,height:number,data:Uint8ClampedArray}|null} before
     *  @param {{width:number,height:number,data:Uint8ClampedArray}|null} after */
    pushTile(face, before, after) {
      if (
        before &&
        after &&
        before.data.length === after.data.length &&
        before.data.every((v, i) => v === after.data[i])
      ) {
        return;
      }
      push({ kind: 'tile', face, before: copyTile(before), after: copyTile(after) });
    },

    /** Run a whole-atlas mutation. `fn` returns whether anything changed, and
     *  the before/after pair is recorded only if it did. Returns `fn`'s result. */
    withAtlasSnapshot(fn) {
      doc.drain();
      const image = doc.get().atlasImage;
      if (!image) return fn();
      const before = copyTile(image);
      const changed = fn();
      if (changed) {
        doc.drain(); // fn may have left a pending live blit
        push({ kind: 'atlas', before, after: copyTile(doc.get().atlasImage) });
      }
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
