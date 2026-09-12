// Writes shell.desktopPattern (a kit pattern name or sixteen hex digits) to
// vf-desktop's `pattern`. Runs synchronously before the desktop's first render,
// so a restored pattern does not flash the default dither.

import { parsePattern } from 'vintage-frames';
import { shell } from '../state/shell.js';

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {{saved?: string|null}} [opts]
 *   saved: the last session's pattern (desktop-state.js), restored only if
 *   parsePattern accepts it. Null keeps the slice's default.
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
