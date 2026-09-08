// ---------------------------------------------------------------------------
// Folder windows — the Finder's windows (Sep 7 2026). ONE vf-window per OPEN
// folder, cloned from #tpl-folder-window (index.html): the striped bar and
// close box of a document-tier window, movable, resizable, the kit's rails
// on both edges, a header line reading the folder's item count over the
// Finder's double rule (two kit rules — index.html, layout.js), and a body
// that is one PLACED vf-icon-field at the plane's origin — the container
// shell/icons.js renders the folder's children into (the documents and the
// folders whose container this folder is). The patterns.js panel shape,
// generalized to many:
//
//   THE LIFECYCLE. open(id) clones, titles and appends the window (a second
//   open brings the existing one forward), adopts it into windows.js as a
//   PANEL with the pure placement (layout.js folderBox: the doc box's corner
//   stepped by the cascade per folder window already open — a session
//   truth, captured at the open) so Arrange Windows re-places it and a
//   browser resize re-pins it like every window, and brings it to the front
//   through the kit's one funnel. close(id) — the close box, File → Close on
//   the front folder window, a vanished folder — drops it from the panel
//   set and REMOVES the node: existence IS visibility, the document
//   windows' discipline. Nothing about the window persists: not its box,
//   not its scroll, not that it was open — the windows' principle (a
//   browser reopens on another monitor all the time; the Finder remembered
//   both, and this app does not). The icons inside keep their positions
//   through the desktop-state blob, by item, the way the desktop's do.
//
//   THE FINDER'S TURN. A panel holding the desktop's active state mirrors
//   as the desktop-focused role (windows.js applyActive: a DOCUMENT window
//   active, not any window), so clicking into a folder window — or opening
//   one — deactivates the application: the windoids hide, the options strip
//   goes, the document-scoped items grey, exactly what a System 7 Finder
//   window did to the front application; closing it hands active to the
//   topmost document window (the kit promotes the survivor), and the
//   application returns where it was. activeFolder() reads which folder's
//   window holds active — the Finder's "front window", what New Folder
//   creates in, what File → Close closes, what Select All selects in.
//
//   THE HEADER COUNT follows the model (the files slice's childrenOf), never
//   the DOM — re-counted on every listing change, "N items", plain ink.
//
//   THE FIELD'S EXTENT (fit): the field is a declared box — the plane's
//   viewport at least, so the rubber band reaches every visible px, grown
//   to hold every icon plus the inset (layout.js fieldExtent) — which IS the
//   scroll range (the kit sizes its plane to placed content, and its rails
//   follow a moved icon by themselves, 0.7.0). Re-derived at open, after the
//   icon layer renders into it, and on a grow box's commit; the viewport is
//   arithmetic on the window's size (layout.js folderViewport), nothing
//   measured.
// ---------------------------------------------------------------------------

import { VfWindow } from 'vintage-frames';
import { files, childrenOf } from '../state/files.js';
import { folderBox, folderViewport, fieldExtent } from './layout.js';

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {ReturnType<typeof import('./windows.js').initWindows>} windows
 */
export function initFolders(desktop, windows) {
  const tpl = /** @type {HTMLTemplateElement} */ (
    document.getElementById('tpl-folder-window')
  );
  /** @type {Map<string, VfWindow>} folder id -> its open window */
  const wins = new Map();
  /** @type {Set<() => void>} a window opened or closed */
  const changed = new Set();
  /** @type {Set<(id: string, field: HTMLElement) => void>} a window about
   *  to close — its field still live, for the icon layer to remember the
   *  positions inside it */
  const willClose = new Set();
  const notify = () => {
    for (const fn of changed) fn();
  };

  const fieldOf = (win) =>
    /** @type {any} */ (win.querySelector(':scope > vf-icon-field'));
  const countOf = (win) => /** @type {any} */ (win.querySelector('.folder-count'));
  /** The folder a window shows, or null (not a folder window). */
  const idOf = (win) => {
    for (const [id, w] of wins) if (w === win) return id;
    return null;
  };

  /** The header line: the folder's item count off the model. */
  function count(id) {
    const win = wins.get(id);
    if (!win) return;
    const c = childrenOf(files.get(), id);
    const n = c.docs.length + c.folders.length;
    const label = countOf(win);
    const text = `${n} item${n === 1 ? '' : 's'}`;
    if (label && label.textContent !== text) label.textContent = text;
  }

  // The close box fires vf-close on the window itself (it never removes
  // itself — "the consumer decides what closing means"): here, removal.
  const onClose = (e) => {
    const id = e.target instanceof VfWindow ? idOf(e.target) : null;
    if (id != null) close(id);
  };
  desktop.addEventListener('vf-close', onClose);
  // A grow box's commit: the plane's viewport moved, so the field's extent
  // re-derives (a bigger body wants a bigger band surface; a smaller one
  // keeps every icon inside the range).
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
    // importNode + upgrade, the document-window recipe (windows.js
    // createDocWindow explains both): the clone lives in THIS document and
    // its declared width/height are readable before the append.
    win = /** @type {VfWindow} */ (
      document.importNode(tpl.content.firstElementChild, true)
    );
    customElements.upgrade(win);
    win.id = `win-folder-${id}`;
    win.heading = rec.name;
    fieldOf(win).label = rec.name;
    const size = { width: win.width ?? 0, height: win.height ?? 0 };
    const n = wins.size;
    // Append first (the clamp reads the live raster's lattice off a
    // connected element), then place: the kit activates the newcomer at
    // slot-in — the Finder's window coming forward.
    desktop.append(win);
    wins.set(id, win);
    windows.addPanel(win, (w, h) => folderBox(w, h, size, n));
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
    windows.removePanel(win);
    win.remove(); // existence IS visibility; the kit re-asserts active
    wins.delete(id);
    notify();
  }

  /** The field's declared box from its icons and the plane's viewport. */
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

  // The listing drives the titles and the counts; a folder that vanished
  // (a future delete) closes its window.
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
    /** Open a folder's window (or bring it forward). Returns it, or null
     *  for an unknown folder. */
    open,
    /** Close a folder's window (the close box's path, File → Close's). */
    close,
    /** @param {string} id */
    isOpen: (id) => wins.has(id),
    /** The open folders' fields, `[id, field]` each — the icon layer's
     *  roots beside the desktop's.
     *  @returns {[string, any][]} */
    fields: () =>
      [...wins].map(([id, win]) => /** @type {[string, any]} */ ([id, fieldOf(win)])),
    /** The field element of an open folder, or null. */
    fieldFor: (id) => (wins.has(id) ? fieldOf(wins.get(id)) : null),
    /** The folder whose window `el` is or sits in, or null. */
    folderOf(el) {
      const win = el instanceof VfWindow ? el : el?.closest?.('vf-window');
      return win ? idOf(win) : null;
    },
    /** The folder whose window holds the desktop's active state — the
     *  Finder's front window — or null. */
    activeFolder() {
      const w = desktop.activeWindow;
      return w ? idOf(w) : null;
    },
    /** The plane's viewport for an open folder's window (the lattice's
     *  wrap width), or null. */
    viewportOf(id) {
      const win = wins.get(id);
      return win
        ? folderViewport({ width: win.width ?? 0, height: win.height ?? 0 })
        : null;
    },
    /** Re-derive a field's extent (the icon layer calls it after rendering
     *  into the field; a drop into it too). */
    fit,
    /** A window opened or closed. Returns the unsubscribe. */
    onChange(fn) {
      changed.add(fn);
      return () => {
        changed.delete(fn);
      };
    },
    /** A window is about to close — `fn(id, field)` with the field still
     *  live. Returns the unsubscribe. */
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
