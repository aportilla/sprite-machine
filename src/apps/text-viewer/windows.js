// ---------------------------------------------------------------------------
// The TEXT VIEWER's windows — TeachText's (Sep 10 2026). ONE vf-window per
// OPEN text file, cloned from #tpl-text-window (windows.html beside this
// file): the classic read-me window — the striped bar and close box of a
// document-tier window, movable, resizable, the kit's vertical rail on the
// frame's edge with the grow box in its corner cell (`scrollbars="vertical"`:
// TeachText wrapped its text to the window and scrolled it up and down;
// there was no sideways), and a body that is the file's text, verbatim, in
// one paragraph on the kit's body face — plain text, DISPLAY ONLY in this
// first pass: no insertion point, no editing, the mouse selects and copies
// as prose. The application's own windows (docs/app-windows-plan.md): the
// window manager (shell/windows.js) runs them like every window and knows
// nothing about them but what they declare at adoption.
//
//   THE LIFECYCLE. open(id) LOADS the text first (files.textOf — an
//   IndexedDB round-trip, so the open is async, as a document's is), then
//   clones, titles, fills and appends the window (a second open brings the
//   existing one forward), adopts it into the window manager with its
//   placement — the shell's cascade from the desktop's WINDOW_ORIGIN
//   (shell/layout.js cascadedBox), stepped per text window already open, a
//   session truth captured at the open — so Arrange Windows re-places it
//   and a browser resize re-pins it like every window, and brings it to the
//   front through the kit's one funnel. close(id) — the close box, File →
//   Close on the front text window, a file that vanished (emptied from the
//   Trash) — releases it and REMOVES the node: existence IS visibility.
//
//   NOTHING PERSISTS — not the box, not the scroll, not that it was open:
//   a text window is an application's window (TeachText's, on a real
//   machine), placed fresh at every open like a document window, never a
//   folder window's remembered pin.
//
//   THE TEXT VIEWER'S TURN. Opening a read-me on System 7 switched you to
//   TeachText: the front application's palettes hid and the menu bar
//   became TeachText's. Here a text window is adopted as the TEXT VIEWER's
//   (adopt's `app`), so holding the desktop's active state makes the Text
//   Viewer the front application (the manager's activation wire): a text
//   window front deactivates the Sprite Editor exactly as a folder window
//   does — the windoids hide, the options strip goes, the bar swaps — and
//   closing it hands active to the topmost document window. Its `item`
//   (`text:<id>`, the icon's key) is how the Finder's icon layer knows it
//   is open — the manager's isOpen, the icon's ghost — without reaching in
//   here. activeText() reads which text's window holds active — what the
//   File → Close closes; closeAll() is the Quit; selectAll() and
//   selectedText() are the Edit menu's two commands over the read-me's
//   prose (index.js beside this file wires the menus to these verbs).
//
//   THE TITLE follows the model: the listing drives it (a rename from the
//   icon retitles the window), and a text whose record is gone closes its
//   window.
//
//   THE ZOOM BOX (Sep 11 2026 — the template declares `zoomable`) expands a
//   read-me to a READING COLUMN: the whole desktop below the menu bar, 20
//   in from every edge but never wider than 520, centered — the height of
//   any screen, never the width of a wide one (layout.js expandedTextBox).
//   A second click puts it back where it was. It is System 7's
//   standard-state / user-state toggle, and the Text Viewer's own meaning
//   of "zoomed" (the document window's is the Sprite Editor's, different
//   in every rule), with the state READ at the click, never kept: a window
//   whose every edge sits near the column on the live raster
//   (shell/layout.js nearBox — a lattice snap or a nudge off still counts)
//   goes back to what it had, and any other goes to the column. The column
//   MOVES the window as well as sizing it, so what the expand records is
//   the whole box — as its nine-slice pin on the raster it sat on
//   (windows.pinOf, a folder window's remembered-box discipline), so the
//   restore lands where a browser resize would have carried the window had
//   it never expanded, on screen (windows.fromPin). With nothing recorded —
//   a window grown by hand onto the column, a record already spent — its
//   placement is the fallback (windows.placed): its authored size at the
//   slot it opened on, where Arrange Windows sends it. The column pads from
//   the menu bar, above the windows' reserve (the options strip is hidden
//   while the Text Viewer is front), so its write snaps onto the lattice
//   and never clamps. The one thing it asks of the manager is `keep`,
//   declared at adoption: a browser resize keeps an expanded window
//   expanded.
// ---------------------------------------------------------------------------

import { VfWindow } from 'vintage-frames';
import markup from './windows.html?raw';
import { files } from '../../state/files.js';
import { build } from '../../state/build.js';
import { TEXT_VIEWER } from '../../state/shell.js';
import { cascadedBox, nearBox } from '../../shell/layout.js';
import { cloneWindow, parseWindows } from '../../shell/windows.js';
import { expandedTextBox } from './layout.js';

/** A text's catalog item — its icon's key, so the window manager's isOpen
 *  names both. */
const itemOf = (id) => `text:${id}`;

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {ReturnType<typeof import('../../shell/windows.js').initWindows>} windows
 */
export function initTextWindows(desktop, windows) {
  const tpl = /** @type {HTMLTemplateElement} */ (
    parseWindows(markup).querySelector('#tpl-text-window')
  );
  /** @type {Map<string, VfWindow>} text id -> its open window */
  const wins = new Map();

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

  // --- the zoom box (header) ----------------------------------------------------
  /** Pre-expand pins, per window — recorded by the expand, spent by the
   *  restore. A WeakMap, so a closed window's record dies with its node. */
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
  // The kit's zoom box fires vf-zoom on the window and leaves what zooming
  // MEANS to the page — here, the column.
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
    win = cloneWindow(tpl);
    win.id = `win-text-${id}`;
    win.heading = files.textRec(id)?.name ?? rec.name;
    bodyOf(win).textContent = text;
    const size = { width: win.width ?? 0, height: win.height ?? 0 };
    const n = wins.size;
    // Append first (the clamp reads the live raster's lattice off a
    // connected element), then adopt: the kit activates the newcomer at
    // slot-in — the read-me's application coming forward.
    desktop.append(win);
    wins.set(id, win);
    // The Text Viewer's window: the bar shows its menus while it is front,
    // it opens on the cascade from the desktop's origin, its zoom box's
    // column is the box it keeps across a resize, and its item is the
    // icon's ghost (see the header).
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
    win.remove(); // existence IS visibility; the kit re-asserts active
    wins.delete(id);
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
    /** The text file whose window holds the desktop's active state — the
     *  front read-me — or null. */
    activeText() {
      const w = desktop.activeWindow;
      return w ? idOf(w) : null;
    },
    /** The prose the mouse has selected in one of these windows, or '' —
     *  what the Edit → Copy hands the system clipboard, and what its gate
     *  reads (live while this is not empty). A selection anchored anywhere
     *  else — a field, another window — is not the read-me's and reads
     *  empty here. */
    selectedText() {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || textOfNode(sel.anchorNode) == null) return '';
      return sel.toString();
    },
    /** Select the whole text of a window's body — the Edit → Select All
     *  over the front read-me (one Range over the paragraph, so the kit's
     *  own copy path and selectedText() both read it). */
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
