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
//   ANOTHER APPLICATION'S TURN. Opening a read-me on System 7 switched you
//   to TeachText: the front application's palettes hid. Here a panel
//   holding the desktop's active state mirrors as the desktop-focused role
//   (windows.js applyActive — a DOCUMENT window active, not any window),
//   so a text window front deactivates Sprite Machine exactly as a folder
//   window does — the windoids hide, the options strip goes, the
//   document-scoped items grey — and closing it hands active to the
//   topmost document window. activeText() reads which text's window holds
//   active — what File → Close closes.
//
//   THE TITLE follows the model: the listing drives it (a rename from the
//   icon retitles the window), and a text whose record is gone closes its
//   window — the folder windows' sync.
// ---------------------------------------------------------------------------

import { VfWindow } from 'vintage-frames';
import { files } from '../state/files.js';
import { build } from '../state/build.js';
import { folderBox } from './layout.js';

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
    windows.addPanel(win, (w, h) => folderBox(w, h, size, n));
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

  return {
    /** Open a text file's window (or bring it forward). Resolves it, or
     *  null for a file that is gone. */
    open,
    /** Close a text file's window (the close box's path, File → Close's). */
    close,
    /** @param {string} id */
    isOpen: (id) => wins.has(id),
    /** The text file whose window holds the desktop's active state — the
     *  front read-me — or null. */
    activeText() {
      const w = desktop.activeWindow;
      return w ? idOf(w) : null;
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
