// Finder folder windows: one vf-window per open folder, cloned from
// #tpl-folder-window (windows.html). icons.js fills its vf-icon-field with the
// folder's children.
//
// A window's box persists as a nine-slice pin, keyed like the folder's icon. It
// is kept at close() for the session and handed to desktop-state.js by pins(),
// which also reports the open windows' depth, so the boot reopens them.

import { VfWindow } from 'vintage-frames';
import markup from './windows.html?raw';
import trashMarkUrl from '../../assets/trash-indicator.png';
import { files, itemCount, isTrashed } from '../../state/files.js';
import { FINDER } from '../../state/shell.js';
import { cascadedBox } from '../../shell/layout.js';
import { cloneWindow, parseWindows } from '../../shell/windows.js';
import {
  folderViewport,
  fieldExtent,
  FOLDER_COUNT_AT,
  FOLDER_COUNT_AT_TRASHED,
  FOLDER_TRASH_MARK,
  FOLDER_TRASH_MARK_AT,
} from './layout.js';

/** The folder's desktop-state key, the same as its icon's in icons.js. */
const keyOf = (id) => `folder:${id}`;

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {ReturnType<typeof import('../../shell/windows.js').initWindows>} windows
 * @param {{savedPin?: (key: string) => import('../../shell/layout.js').Pin | null}} [opts]
 *   savedPin: a saved pin by item key (desktop-state.js windowPin), or null.
 */
export function initFolderWindows(desktop, windows, { savedPin = () => null } = {}) {
  const tpl = /** @type {HTMLTemplateElement} */ (
    parseWindows(markup).querySelector('#tpl-folder-window')
  );
  /** @type {Map<string, VfWindow>} folder id -> its open window */
  const wins = new Map();
  /** @type {Map<string, import('../../shell/layout.js').Pin>} folder id -> the pin
   *  its window closed at this session */
  const remembered = new Map();
  /** @type {Set<() => void>} a window opened or closed */
  const changed = new Set();
  /** @type {Set<(id: string, field: HTMLElement) => void>} a window about
   *  to close, its field still live */
  const willClose = new Set();
  const notify = () => {
    for (const fn of changed) fn();
  };

  const fieldOf = (win) =>
    /** @type {any} */ (win.querySelector(':scope > vf-icon-field'));
  const countOf = (win) => /** @type {any} */ (win.querySelector('.folder-count'));
  const lineOf = (win) =>
    /** @type {any} */ (win.querySelector(':scope > vf-container[slot="header"]'));
  const markOf = (win) => /** @type {any} */ (win.querySelector('.folder-trash-mark'));
  /** The folder a window shows, or null. */
  const idOf = (win) => {
    for (const [id, w] of wins) if (w === win) return id;
    return null;
  };

  /** The header's trash mark: a 1:1 vf-img at the start of the count line. */
  function makeMark() {
    const mark = /** @type {any} */ (document.createElement('vf-img'));
    mark.className = 'folder-trash-mark';
    mark.width = FOLDER_TRASH_MARK.width;
    mark.height = FOLDER_TRASH_MARK.height;
    mark.left = FOLDER_TRASH_MARK_AT.left;
    mark.top = FOLDER_TRASH_MARK_AT.top;
    const img = document.createElement('img');
    img.alt = 'in the Trash';
    img.src = trashMarkUrl;
    mark.append(img);
    return mark;
  }

  /** Update the header's item count, and its trash mark while the folder is
   *  trashed. */
  function count(id) {
    const win = wins.get(id);
    if (!win) return;
    const st = files.get();
    const n = itemCount(st, id);
    const label = countOf(win);
    const text = `${n} item${n === 1 ? '' : 's'}`;
    if (label && label.textContent !== text) label.textContent = text;
    const trashed = isTrashed(st, id);
    const mark = markOf(win);
    if (trashed && !mark) lineOf(win)?.prepend(makeMark());
    else if (!trashed && mark) mark.remove();
    const at = trashed ? FOLDER_COUNT_AT_TRASHED : FOLDER_COUNT_AT;
    if (label && label.left !== at.left) label.left = at.left;
  }

  // The close box only fires vf-close. Closing removes the window.
  const onClose = (e) => {
    const id = e.target instanceof VfWindow ? idOf(e.target) : null;
    if (id != null) close(id);
  };
  desktop.addEventListener('vf-close', onClose);
  // A grow box commit changes the viewport, so the field refits.
  const onGrow = (e) => {
    if (!(/** @type {CustomEvent} */ (e).detail?.commit)) return;
    const id = e.target instanceof VfWindow ? idOf(e.target) : null;
    if (id != null) fit(id);
  };
  desktop.addEventListener('vf-resize', onGrow);

  function open(id) {
    const rec = files.get().folders.find((f) => f.id === id);
    if (!rec) return null;
    let win = wins.get(id);
    if (win) {
      desktop.bringToFront(win);
      return win;
    }
    // cloneWindow upgrades the clone, so width and height are readable before
    // the append.
    win = cloneWindow(tpl);
    win.id = `win-folder-${id}`;
    win.heading = rec.name;
    fieldOf(win).label = rec.name;
    const size = { width: win.width ?? 0, height: win.height ?? 0 };
    const n = wins.size;
    // Append before adopt: the clamp reads the raster's lattice from a
    // connected element.
    desktop.append(win);
    wins.set(id, win);
    // This session's pin, else the saved pin, else the cascade.
    windows.adopt(win, {
      app: FINDER,
      place: (w, h) => cascadedBox(w, h, size, n),
      pin: remembered.get(id) ?? savedPin(keyOf(id)),
      item: keyOf(id),
    });
    remembered.delete(id);
    desktop.bringToFront(win);
    count(id);
    fit(id);
    notify();
    return win;
  }

  function close(id) {
    const win = wins.get(id);
    if (!win) return;
    for (const fn of willClose) fn(id, fieldOf(win));
    remembered.set(id, windows.pinOf(win));
    windows.release(win);
    win.remove(); // the kit activates the next window
    wins.delete(id);
    notify();
  }

  /** Size the field to the viewport, grown to hold every icon. The field's size
   *  is the scroll range. */
  function fit(id) {
    const win = wins.get(id);
    if (!win) return;
    const field = fieldOf(win);
    const positions = [...field.querySelectorAll(':scope > vf-icon')].map((el) => ({
      left: /** @type {any} */ (el).left ?? 0,
      top: /** @type {any} */ (el).top ?? 0,
    }));
    const ext = fieldExtent(
      positions,
      folderViewport({ width: win.width ?? 0, height: win.height ?? 0 })
    );
    if (field.width !== ext.width) field.width = ext.width;
    if (field.height !== ext.height) field.height = ext.height;
  }

  // Update titles and counts from the listing. A folder that no longer exists
  // closes its window.
  const sync = () => {
    const st = files.get();
    for (const [id, win] of [...wins]) {
      const rec = st.folders.find((f) => f.id === id);
      if (!rec) {
        close(id);
        continue;
      }
      if (win.heading !== rec.name) win.heading = rec.name;
      const field = fieldOf(win);
      if (field.label !== rec.name) field.label = rec.name;
      count(id);
    }
  };
  const unsubscribe = files.subscribe(sync);

  return {
    /** Open a folder's window or bring it forward. Returns it, or null for an
     *  unknown folder. */
    open,
    close,
    /** @param {string} id */
    isOpen: (id) => wins.has(id),
    /** The open folders' fields as `[id, field]` pairs.
     *  @returns {[string, any][]} */
    fields: () =>
      [...wins].map(([id, win]) => /** @type {[string, any]} */ ([id, fieldOf(win)])),
    /** The folder whose window `el` is or sits in, or null. */
    folderOf(el) {
      const win = el instanceof VfWindow ? el : el?.closest?.('vf-window');
      return win ? idOf(win) : null;
    },
    /** The folder whose window is the desktop's active window, or null. */
    activeFolder() {
      const w = desktop.activeWindow;
      return w ? idOf(w) : null;
    },
    /** The plane's viewport of an open folder's window, or null. */
    viewportOf(id) {
      const win = wins.get(id);
      return win
        ? folderViewport({ width: win.width ?? 0, height: win.height ?? 0 })
        : null;
    },
    /** Refit a field's size after its icons change. */
    fit,
    /** Every known folder window by item key, for the desktop state: the open
     *  ones read live, over the boxes of those closed this session. */
    pins() {
      const out = {};
      for (const [id, pin] of remembered) out[keyOf(id)] = { pin };
      for (const [id, win] of wins) out[keyOf(id)] = windows.record(win);
      return out;
    },
    /** A window opened or closed. Returns the unsubscribe. */
    onChange(fn) {
      changed.add(fn);
      return () => {
        changed.delete(fn);
      };
    },
    /** A window is about to close: `fn(id, field)` with the field still live.
     *  Returns the unsubscribe. */
    onWillClose(fn) {
      willClose.add(fn);
      return () => {
        willClose.delete(fn);
      };
    },
    dispose() {
      unsubscribe();
      desktop.removeEventListener('vf-close', onClose);
      desktop.removeEventListener('vf-resize', onGrow);
      for (const id of [...wins.keys()]) close(id);
      changed.clear();
      willClose.clear();
    },
  };
}
