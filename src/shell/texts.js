// ---------------------------------------------------------------------------
// Text windows — TeachText's (Sep 10 2026). ONE vf-window per OPEN text file,
// cloned from #tpl-text-window (index.html): the classic read-me window —
// the striped bar and close box of a document-tier window, movable,
// resizable, the kit's vertical rail on the frame's edge with the grow box
// in its corner cell (`scrollbars="vertical"`: TeachText wrapped its text
// to the window and scrolled it up and down; there was no sideways), and a
// body that is the file's text, verbatim, in one paragraph on the kit's
// body face — plain text, DISPLAY ONLY in this first pass: no insertion
// point, no editing, the mouse selects and copies as prose. The folder
// windows' shape (shell/folders.js), pared down:
//
//   THE LIFECYCLE. open(id) LOADS the text first (files.textOf — an
//   IndexedDB round-trip, so the open is async, as a document's is), then
//   clones, titles, fills and appends the window (a second open brings the
//   existing one forward), adopts it into windows.js as a PANEL with the
//   pure placement (layout.js folderBox: the doc box's corner stepped by
//   the cascade per text window already open — a session truth, captured
//   at the open) so Arrange Windows re-places it and a browser resize
//   re-pins it like every window, and brings it to the front through the
//   kit's one funnel. close(id) — the close box, File → Close on the front
//   text window, a file that vanished (emptied from the Trash) — drops it
//   from the panel set and REMOVES the node: existence IS visibility.
//
//   NOTHING PERSISTS — not the box, not the scroll, not that it was open:
//   a text window is an application's window (TeachText's, on a real
//   machine), placed fresh at every open like a document window, never a
//   folder window's remembered pin.
//
//   THE TEXT VIEWER'S TURN. Opening a read-me on System 7 switched you to
//   TeachText: the front application's palettes hid and the menu bar
//   became TeachText's. Here a text window is adopted as the TEXT VIEWER's
//   panel (windows.addPanel's `app` — apps/text-viewer is the
//   application, its menus File / Edit / View), so holding the desktop's
//   active state makes the Text Viewer the front application (windows.js
//   applyActive): a text window front deactivates the Sprite Editor
//   exactly as a folder window does — the windoids hide, the options strip
//   goes, the bar swaps — and closing it hands active to the topmost
//   document window. activeText() reads which text's window holds active —
//   what the Text Viewer's File → Close closes; closeAll() is its Quit;
//   selectAll() and selectedText() are its Edit menu's two commands over
//   the read-me's prose (the window's DOM is this module's, so the
//   selection's reading and writing live here, the application calling
//   through).
//
//   THE TITLE follows the model: the listing drives it (a rename from the
//   icon retitles the window), and a text whose record is gone closes its
//   window — the folder windows' sync.
//
//   THE ZOOM BOX (Sep 11 2026 — the template declares `zoomable`) expands
//   a read-me to a READING COLUMN: the whole desktop below the menu bar,
//   20 in from every edge but never wider than 520, centered — the height
//   of any screen, never the width of a wide one (layout.js
//   expandedTextBox). A second click puts it back where it was. The
//   window layer owns the toggle (windows.js onZoom — this module only
//   declares the box at adoption): the state is read at the click, by
//   how close the window sits to the column, and a browser resize keeps
//   an expanded window expanded.
// ---------------------------------------------------------------------------

import { VfWindow } from 'vintage-frames';
import { files } from '../state/files.js';
import { build } from '../state/build.js';
import { TEXT_VIEWER } from '../state/shell.js';
import { expandedTextBox, folderBox } from './layout.js';

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {ReturnType<typeof import('./windows.js').initWindows>} windows
 */
export function initTexts(desktop, windows) {
  const tpl = /** @type {HTMLTemplateElement} */ (
    document.getElementById('tpl-text-window')
  );
  /** @type {Map<string, VfWindow>} text id -> its open window */
  const wins = new Map();
  /** @type {Set<() => void>} a window opened or closed */
  const changed = new Set();
  const notify = () => {
    for (const fn of changed) fn();
  };

  const bodyOf = (win) => /** @type {any} */ (win.querySelector('.text-body'));
  /** The text a window shows, or null (not a text window). */
  const idOf = (win) => {
    for (const [id, w] of wins) if (w === win) return id;
    return null;
  };

  // The close box fires vf-close on the window itself (it never removes
  // itself — "the consumer decides what closing means"): here, removal.
  const onClose = (e) => {
    const id = e.target instanceof VfWindow ? idOf(e.target) : null;
    if (id != null) close(id);
  };
  desktop.addEventListener('vf-close', onClose);

  async function open(id) {
    let win = wins.get(id);
    if (win) {
      desktop.bringToFront(win);
      return win;
    }
    const rec = files.textRec(id);
    if (!rec) return null;
    // The text first — the window opens with its content, never empty and
    // then filled. A record gone between the listing and the read opens
    // nothing.
    let text;
    try {
      text = await files.textOf(id);
    } catch (err) {
      build.setError(`Couldn't open “${rec.name}”: ${err.message}`);
      return null;
    }
    if (text == null) return null;
    win = wins.get(id); // a second open landed during the read
    if (win) {
      desktop.bringToFront(win);
      return win;
    }
    // importNode + upgrade, the document-window recipe (windows.js
    // createDocWindow explains both): the clone lives in THIS document and
    // its declared width/height are readable before the append.
    win = /** @type {VfWindow} */ (
      document.importNode(tpl.content.firstElementChild, true)
    );
    customElements.upgrade(win);
    win.id = `win-text-${id}`;
    win.heading = files.textRec(id)?.name ?? rec.name;
    bodyOf(win).textContent = text;
    const size = { width: win.width ?? 0, height: win.height ?? 0 };
    const n = wins.size;
    // Append first (the clamp reads the live raster's lattice off a
    // connected element), then place: the kit activates the newcomer at
    // slot-in — the read-me's application coming forward.
    desktop.append(win);
    wins.set(id, win);
    // The Text Viewer's panel: the bar shows its menus while it is front,
    // and its zoom box toggles the reading column (see the header).
    windows.addPanel(win, (w, h) => folderBox(w, h, size, n), null, {
      app: TEXT_VIEWER,
      expanded: expandedTextBox,
    });
    desktop.bringToFront(win);
    notify();
    return win;
  }

  function close(id) {
    const win = wins.get(id);
    if (!win) return;
    windows.removePanel(win);
    win.remove(); // existence IS visibility; the kit re-asserts active
    wins.delete(id);
    notify();
  }

  // The listing drives the titles; a text file that vanished (emptied from
  // the Trash) closes its window.
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

  /** The text whose window `node` sits in, or null — a light-DOM node of
   *  the window (the selection's anchor is the slotted text node inside
   *  the body's paragraph), an element or a text node alike. */
  const textOfNode = (node) => {
    const el = node instanceof Element ? node : (node?.parentElement ?? null);
    const win = el?.closest('vf-window');
    return win instanceof VfWindow ? idOf(win) : null;
  };

  return {
    /** Open a text file's window (or bring it forward). Resolves it, or
     *  null for a file that is gone. */
    open,
    /** Close a text file's window (the close box's path, File → Close's). */
    close,
    /** Close every open text window, in turn — TeachText's Quit (a read-me
     *  is read-only, so nothing asks). */
    closeAll() {
      for (const id of [...wins.keys()]) close(id);
    },
    /** @param {string} id */
    isOpen: (id) => wins.has(id),
    /** The text file whose window holds the desktop's active state — the
     *  front read-me — or null. */
    activeText() {
      const w = desktop.activeWindow;
      return w ? idOf(w) : null;
    },
    /** The prose the mouse has selected in one of these windows, or '' —
     *  what the Text Viewer's Edit → Copy hands the system clipboard, and
     *  what its gate reads (live while this is not empty). A selection
     *  anchored anywhere else — a field, another window — is not the
     *  read-me's and reads empty here. */
    selectedText() {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || textOfNode(sel.anchorNode) == null) return '';
      return sel.toString();
    },
    /** Select the whole text of a window's body — the Text Viewer's Edit →
     *  Select All over the front read-me (one Range over the paragraph, so
     *  the kit's own copy path and selectedText() both read it). */
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
    /** A window opened or closed. Returns the unsubscribe. */
    onChange(fn) {
      changed.add(fn);
      return () => {
        changed.delete(fn);
      };
    },
    dispose() {
      unsubscribe();
      desktop.removeEventListener('vf-close', onClose);
      for (const id of [...wins.keys()]) close(id);
      changed.clear();
    },
  };
}
