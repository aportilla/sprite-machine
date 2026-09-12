// Desktop Patterns window: at most one, cloned from #tpl-patterns-window. Only
// the chosen pattern persists (shell/desktop-pattern.js).

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
  /** @type {import('vintage-frames').VfWindow|null} the open panel */
  let win = null;

  // The kit's close box fires vf-close but does not remove the window.
  const onClose = (e) => {
    if (e.target === win) close();
  };

  function open() {
    if (win) {
      desktop.bringToFront(win);
      return;
    }
    win = cloneWindow(tpl);
    win.id = 'win-patterns';
    win.addEventListener('vf-close', onClose);
    // Append before adopt: the clamp reads the raster's lattice from a
    // connected element.
    desktop.append(win);
    const size = { width: win.width ?? 0, height: win.height ?? 0 };
    windows.adopt(win, {
      app: DESKTOP_PATTERNS,
      place: (w, h) => centeredBox(w, h, size),
    });
    // bringToFront syncs the DOM order with the z-order and activates the window.
    desktop.bringToFront(win);
  }

  function close() {
    if (!win) return;
    windows.release(win);
    win.removeEventListener('vf-close', onClose);
    win.remove(); // the kit picks the next active window
    win = null;
  }

  return {
    open,
    close,
    dispose() {
      close();
    },
  };
}
