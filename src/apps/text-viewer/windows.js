// Text Viewer windows: one vf-window per open text file, cloned from
// #tpl-text-window. The body shows the file's text, read-only. Nothing about a
// text window persists.
//
// The zoom box toggles between the expandedTextBox column and the previous box.
// nearBox reads the state at the click. The previous box is saved as a
// nine-slice pin. Without one the window returns to its placement. `keep` holds
// a zoomed window zoomed across a browser resize.

import { VfWindow } from 'vintage-frames';
import markup from './windows.html?raw';
import { files } from '../../state/files.js';
import { build } from '../../state/build.js';
import { TEXT_VIEWER } from '../../state/shell.js';
import { cascadedBox, nearBox } from '../../shell/layout.js';
import { cloneWindow, parseWindows } from '../../shell/windows.js';
import { expandedTextBox } from './layout.js';

/** A text's catalog item key, shared with its icon. */
const itemOf = (id) => `text:${id}`;

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {ReturnType<typeof import('../../shell/windows.js').initWindows>} windows
 */
export function initTextWindows(desktop, windows) {
  const tpl = /** @type {HTMLTemplateElement} */ (
    parseWindows(markup).querySelector('#tpl-text-window')
  );
  /** @type {Map<string, VfWindow>} text id -> window */
  const wins = new Map();

  const bodyOf = (win) => /** @type {any} */ (win.querySelector('.text-body'));
  /** The text id a window shows, or null. */
  const idOf = (win) => {
    for (const [id, w] of wins) if (w === win) return id;
    return null;
  };

  // The kit's close box fires vf-close but does not remove the window.
  const onClose = (e) => {
    const id = e.target instanceof VfWindow ? idOf(e.target) : null;
    if (id != null) close(id);
  };
  desktop.addEventListener('vf-close', onClose);

  /** Each zoomed window's pin from before the zoom. */
  const expandMemory = new WeakMap();
  /** @param {VfWindow} win */
  const zoom = (win) => {
    const cur = {
      left: win.left ?? 0,
      top: win.top ?? 0,
      width: win.width ?? 0,
      height: win.height ?? 0,
    };
    const column = expandedTextBox(desktop.width, desktop.height);
    if (nearBox(cur, column)) {
      const pin = expandMemory.get(win);
      expandMemory.delete(win);
      const back = pin ? windows.fromPin(win, pin) : windows.placed(win);
      if (back) windows.write(win, back);
    } else {
      expandMemory.set(win, windows.pinOf(win));
      windows.write(win, column);
    }
  };
  const onZoom = (e) => {
    const win = e.target;
    if (win instanceof VfWindow && idOf(win) != null) zoom(win);
  };
  desktop.addEventListener('vf-zoom', onZoom);

  async function open(id) {
    let win = wins.get(id);
    if (win) {
      desktop.bringToFront(win);
      return win;
    }
    const rec = files.textRec(id);
    if (!rec) return null;
    let text;
    try {
      text = await files.textOf(id);
    } catch (err) {
      build.setError(`Couldn't open “${rec.name}”: ${err.message}`);
      return null;
    }
    if (text == null) return null;
    win = wins.get(id); // another open finished during the await
    if (win) {
      desktop.bringToFront(win);
      return win;
    }
    win = cloneWindow(tpl);
    win.id = `win-text-${id}`;
    win.heading = files.textRec(id)?.name ?? rec.name;
    bodyOf(win).textContent = text;
    const size = { width: win.width ?? 0, height: win.height ?? 0 };
    const n = wins.size;
    // Append before adopt: the clamp reads the raster's lattice from a
    // connected element.
    desktop.append(win);
    wins.set(id, win);
    windows.adopt(win, {
      app: TEXT_VIEWER,
      place: (w, h) => cascadedBox(w, h, size, n),
      keep: expandedTextBox,
      item: itemOf(id),
    });
    desktop.bringToFront(win);
    return win;
  }

  function close(id) {
    const win = wins.get(id);
    if (!win) return;
    windows.release(win);
    win.remove(); // the kit picks the next active window
    wins.delete(id);
  }

  // Follow renames, and close windows whose text file was deleted.
  const sync = () => {
    const st = files.get();
    for (const [id, win] of [...wins]) {
      const rec = st.texts.find((t) => t.id === id);
      if (!rec) {
        close(id);
        continue;
      }
      if (win.heading !== rec.name) win.heading = rec.name;
    }
  };
  const unsubscribe = files.subscribe(sync);

  /** The text id of the window containing `node` (an element or a text
   *  node), or null. */
  const textOfNode = (node) => {
    const el = node instanceof Element ? node : (node?.parentElement ?? null);
    const win = el?.closest('vf-window');
    return win instanceof VfWindow ? idOf(win) : null;
  };

  return {
    /** Opens or raises a text file's window. Resolves the window, or null
     *  if the file is gone. */
    open,
    close,
    closeAll() {
      for (const id of [...wins.keys()]) close(id);
    },
    /** The text id of the active window, or null. */
    activeText() {
      const w = desktop.activeWindow;
      return w ? idOf(w) : null;
    },
    /** The selected text if the selection is anchored in a text window,
     *  otherwise ''. */
    selectedText() {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || textOfNode(sel.anchorNode) == null) return '';
      return sel.toString();
    },
    /** Selects all the body text in a text's window. */
    selectAll(id) {
      const win = wins.get(id);
      const body = win ? bodyOf(win) : null;
      const sel = document.getSelection();
      if (!body || !sel) return;
      const range = document.createRange();
      range.selectNodeContents(body);
      sel.removeAllRanges();
      sel.addRange(range);
    },
    dispose() {
      unsubscribe();
      desktop.removeEventListener('vf-close', onClose);
      desktop.removeEventListener('vf-zoom', onZoom);
      for (const id of [...wins.keys()]) close(id);
    },
  };
}
