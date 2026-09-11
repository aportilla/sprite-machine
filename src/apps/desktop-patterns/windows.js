// ---------------------------------------------------------------------------
// DESKTOP PATTERNS' window — System 7.5's Desktop Patterns control panel.
// Sprite Machine → Desktop Patterns opens ONE window, cloned from
// #tpl-patterns-window (windows.html beside this file): a DOCUMENT-TIER
// window (the striped title bar, a close box, movable, fixed-size: the
// classic control panel, not a windoid, whose slim bar carries no title)
// whose body is <sm-desktop-patterns>: the preview well over the 38-pattern
// grid over Set Desktop Pattern. The application's own window
// (docs/app-windows-plan.md): the window manager (shell/windows.js) adopts
// it as Desktop Patterns' (adopt's `app`), so its holding the desktop's
// active state makes Desktop Patterns the front application — the Sprite
// Editor deactivates: the windoids hide, the options strip goes, the bar
// swaps to the control panel's menus — which also clears the desktop for
// previewing. Closing it — the close box, its File → Close or Quit — hands
// active to the topmost document window (the kit promotes the survivor),
// so the Sprite Editor returns where it was, or leaves the bare desktop to
// the Finder; a second pick while it's open just brings it forward.
// Existence IS visibility: the close box removes the window (the document
// windows' discipline), and nothing about it persists but the pattern
// itself (the desktop's wire, shell/desktop-pattern.js). Placed by the
// shell's centeredBox and adopted with it, so Arrange Windows re-centers it
// and a browser resize re-pins it like every window.
// ---------------------------------------------------------------------------

import markup from './windows.html?raw';
import { DESKTOP_PATTERNS } from '../../state/shell.js';
import { centeredBox } from '../../shell/layout.js';
import { cloneWindow, parseWindows } from '../../shell/windows.js';

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {ReturnType<typeof import('../../shell/windows.js').initWindows>} windows
 */
export function initPatternsWindow(desktop, windows) {
  const tpl = /** @type {HTMLTemplateElement} */ (
    parseWindows(markup).querySelector('#tpl-patterns-window')
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
    win = cloneWindow(tpl);
    win.id = 'win-patterns';
    win.addEventListener('vf-close', onClose);
    // Append first (the clamp reads the live raster's lattice off a
    // connected element), then adopt: the kit activates the newcomer at
    // slot-in — a document-tier window opening brings its owner forward,
    // and this one's owner is Desktop Patterns, whose menus the bar shows
    // while it is front.
    desktop.append(win);
    const size = { width: win.width ?? 0, height: win.height ?? 0 };
    windows.adopt(win, {
      app: DESKTOP_PATTERNS,
      place: (w, h) => centeredBox(w, h, size),
    });
    // Settle the light-DOM order now (no pointer gesture is in flight at a
    // menu-driven open) and make it the active window through the kit's one
    // funnel.
    desktop.bringToFront(win);
  }

  function close() {
    if (!win) return;
    windows.release(win);
    win.removeEventListener('vf-close', onClose);
    win.remove(); // existence IS visibility; the kit re-asserts active
    win = null;
  }

  return {
    /** Sprite Machine → Desktop Patterns (through the registry). */
    open,
    /** The close box's path, and the application's File → Close and Quit. */
    close,
    dispose() {
      close();
    },
  };
}
