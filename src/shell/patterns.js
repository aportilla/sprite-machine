// ---------------------------------------------------------------------------
// The desktop pattern — System 7.5's Desktop Patterns control panel, in two
// halves:
//
//   THE WIRE: shell.desktopPattern (a kit library name — gray-50, bricks, …
//   docs/PATTERNS.md in vintage-frames — or sixteen hex digits) is the one
//   truth, and this module writes it onto the desktop's own `pattern`
//   (vf-desktop paints it as the screen's background: black ink on white
//   paper, one whole-surface raster, 1-bit at every density and zoom). The
//   boot restore lands here too: desktop-state.js hands back what the last
//   session set, and only a value the kit's own grammar parses is taken — a
//   corrupt blob keeps the dither and never trips vf-desktop's
//   unknown-value warning. Written synchronously at wire-up, before the
//   desktop's first render, so a restored pattern never flashes the dither.
//
//   THE PANEL: Sprite Machine → Desktop Patterns opens ONE window — cloned
//   from #tpl-patterns-window (index.html) — a DOCUMENT-TIER window (the
//   striped title bar, a close box, movable, fixed-size: the classic
//   control panel, not a windoid, whose slim bar carries no title) whose
//   body is <sm-desktop-patterns>: the preview well over the 38-pattern
//   grid over Set Desktop Pattern. It is the FINDER's window: on a real
//   System 7 machine a control panel opened in the Finder's layer, and here
//   it is adopted as the Finder's panel (windows.addPanel's `app`), so its
//   holding the desktop's active state makes the Finder the front
//   application (shell/windows.js's activation wire) — the Sprite Editor
//   deactivates: the windoids hide, the options strip goes, the bar swaps
//   to the Finder's menus — which also clears the desktop for previewing.
//   Closing it hands active to the topmost document window (the kit
//   promotes the survivor), so the Sprite Editor returns where it was; a
//   second pick while it's open just brings it forward. Existence IS
//   visibility: the close box removes the window (the document windows'
//   discipline), and nothing about it persists but the pattern itself.
//   Placed by shell/layout.js centeredBox and adopted by windows.js as a
//   PANEL, so Arrange Windows re-centers it and a browser resize re-pins
//   it like every window; the Finder's File → Close closes it while it is
//   front.
// ---------------------------------------------------------------------------

import { parsePattern } from 'vintage-frames';
import { shell, FINDER } from '../state/shell.js';
import { centeredBox } from './layout.js';

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {ReturnType<typeof import('./windows.js').initWindows>} windows
 * @param {{saved?: string|null}} [opts]
 *   saved: the last session's pattern (desktop-state.js), restored if the
 *   kit's grammar parses it; null/absent leaves the slice's default.
 */
export function initPatterns(desktop, windows, { saved = null } = {}) {
  // --- the wire ----------------------------------------------------------------
  if (saved != null && parsePattern(saved) !== null) shell.setDesktopPattern(saved);
  const apply = () => {
    const v = shell.get().desktopPattern;
    if (desktop.pattern !== v) desktop.pattern = v;
  };
  const unsubscribe = shell.subscribe(apply);
  apply();

  // --- the panel ----------------------------------------------------------------
  const tpl = /** @type {HTMLTemplateElement} */ (
    document.getElementById('tpl-patterns-window')
  );
  /** @type {import('vintage-frames').VfWindow|null} the open panel, or null */
  let win = null;

  // The close box fires vf-close on the window itself (it never removes
  // itself — "the consumer decides what closing means"): here, removal.
  const onClose = (e) => {
    if (e.target === win) close();
  };

  function open() {
    if (win) {
      // One panel: a second pick brings the open one forward (which also
      // re-activates it, through the kit's one funnel).
      desktop.bringToFront(win);
      return;
    }
    // importNode + upgrade, the document-window recipe (windows.js
    // createDocWindow explains both): the clone lives in THIS document and
    // its declared width/height are readable before the append.
    win = /** @type {import('vintage-frames').VfWindow} */ (
      document.importNode(tpl.content.firstElementChild, true)
    );
    customElements.upgrade(win);
    win.id = 'win-patterns';
    win.addEventListener('vf-close', onClose);
    // Append first (the clamp reads the live raster's lattice off a
    // connected element), then place: the kit activates the newcomer at
    // slot-in — a document-tier window opening brings its owner forward,
    // and this one's owner is the Finder (see the header).
    desktop.append(win);
    const size = { width: win.width ?? 0, height: win.height ?? 0 };
    windows.addPanel(win, (w, h) => centeredBox(w, h, size), null, { app: FINDER });
    // Settle the light-DOM order now (no pointer gesture is in flight at a
    // menu-driven open) and make it the active window through the kit's one
    // funnel — the createDocWindow discipline.
    desktop.bringToFront(win);
  }

  function close() {
    if (!win) return;
    windows.removePanel(win);
    win.removeEventListener('vf-close', onClose);
    win.remove(); // existence IS visibility; the kit re-asserts active
    win = null;
  }

  return {
    /** Sprite Machine → Desktop Patterns. */
    open,
    /** The close box's path, the Finder's File → Close's; also the HMR
     *  teardown's. */
    close,
    /** Whether the panel holds the desktop's active state — the Finder's
     *  front window, what its Close closes. */
    isActive: () => win != null && desktop.activeWindow === win,
    /** The open panel window, or null. */
    get window() {
      return win;
    },
    dispose() {
      unsubscribe();
      close();
    },
  };
}
