// ---------------------------------------------------------------------------
// The desktop pattern's wire — the desktop's, not an application's: System
// 7.5's Desktop Patterns setting belonged to the machine, painted on the
// desk whichever application was front. shell.desktopPattern (a kit library
// name — gray-50, bricks, … docs/PATTERNS.md in vintage-frames — or sixteen
// hex digits) is the one truth, and this module writes it onto the
// desktop's own `pattern` (vf-desktop paints it as the screen's background:
// black ink on white paper, one whole-surface raster, 1-bit at every
// density and zoom). The boot restore lands here too: desktop-state.js
// hands back what the last session set, and only a value the kit's own
// grammar parses is taken — a corrupt blob keeps the dither and never trips
// vf-desktop's unknown-value warning. Written synchronously at wire-up,
// before the desktop's first render, so a restored pattern never flashes
// the dither.
//
// The control panel that sets it is an application of its own
// (apps/desktop-patterns — its window, the preview well, the chooser and
// Set Desktop Pattern), which writes the slice through its one setter;
// this wire never knows who wrote it.
// ---------------------------------------------------------------------------

import { parsePattern } from 'vintage-frames';
import { shell } from '../state/shell.js';

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {{saved?: string|null}} [opts]
 *   saved: the last session's pattern (desktop-state.js), restored if the
 *   kit's grammar parses it; null/absent leaves the slice's default.
 */
export function initDesktopPattern(desktop, { saved = null } = {}) {
  if (saved != null && parsePattern(saved) !== null) shell.setDesktopPattern(saved);
  const apply = () => {
    const v = shell.get().desktopPattern;
    if (desktop.pattern !== v) desktop.pattern = v;
  };
  const unsubscribe = shell.subscribe(apply);
  apply();
  return {
    dispose() {
      unsubscribe();
    },
  };
}
