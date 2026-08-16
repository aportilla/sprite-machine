// ---------------------------------------------------------------------------
// `history` slice — bounded undo/redo over the document's pixels. Two entry
// kinds, matching the two ways the doc changes:
//   - `tile`: one gesture's effect on one face ({face, before, after} — tile
//     buffer snapshots, ≤16KB each at tile 64), pushed by the editor when the
//     canvas commits a gesture;
//   - `atlas`: a whole-sheet snapshot pair, for the ops that move every tile
//     at once (resize, all-tiles replace) — captured via `withAtlasSnapshot`.
//
// Undo/redo apply through the doc's restore actions (restoreTile /
// restoreAtlas), which are STRUCTURAL — templates re-derive, the canvas
// resets, the rebuilder rebuilds — so an undo behaves like any other document
// change. Snapshots are copied IN on push and copied OUT on atlas-apply, so
// no live buffer can mutate an entry after the fact.
//
// A wholesale load (the doc's sheet generation moved) CLEARS both stacks: the
// history belongs to the document, and undoing across a load would resurrect
// pixels from a different one.
// ---------------------------------------------------------------------------

import { createStore } from './store.js';
import { doc } from './doc.js';

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
  // Only the menu-facing booleans live in the store; the stacks are plain
  // fields (nobody renders them, and entries are big).
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

  // Apply one entry's chosen side. Restores go through COPIES so the stacks'
  // snapshots survive the edits that follow (restoreAtlas adopts by
  // reference; restoreTile's blit copies anyway, but symmetry is cheap).
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

    /** One committed gesture on one face. Buffers are snapshotted here —
     *  callers may hand in their live working tile. A no-op pair (identical
     *  bytes) is dropped rather than recorded.
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

    /** Run a whole-atlas mutation under snapshot: drain, snapshot, run `fn`
     *  (which returns whether anything changed), and record the pair only on
     *  a real change. Returns `fn`'s result. */
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

    /** HMR teardown. */
    dispose() {
      unsub();
    },
  };
}

// The app-wide singleton, wired to the doc singleton (one history per
// document; the factory stays available for Node tests with their own doc).
export const history = createHistory(doc);
