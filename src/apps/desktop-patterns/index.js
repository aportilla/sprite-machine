// Desktop Patterns: the control panel application. Its item in the Sprite
// Machine menu opens one panel (windows.js), centered, with no icon to open out
// of or close into. Only Set Desktop Pattern changes the desktop's pattern,
// which the shell saves with the session; closing discards an unset choice.

import { centeredBox, defineApp } from 'vintage-frames/shell';
import menus from './menus.html?raw';
import { patternsWindow } from './windows.js';

const DESKTOP_PATTERNS = 'desktop-patterns';

/** The kit's default desktop pattern, the 50% dither. */
const DEFAULT_PATTERN = 'gray-50';

export function desktopPatterns() {
  return defineApp({
    id: DESKTOP_PATTERNS,
    name: 'Desktop Patterns',
    menus,
    init(ctx) {
      const { desktop, windows } = ctx;
      /** @type {import('vintage-frames').VfWindow|null} the panel, while it is open */
      let panel = null;

      const open = () => {
        if (panel?.isConnected) {
          desktop.bringToFront(panel);
          return;
        }
        const win = patternsWindow(desktop.pattern ?? DEFAULT_PATTERN, (pattern) => {
          desktop.pattern = pattern;
        });
        const size = { width: win.width ?? 0, height: win.height ?? 0 };
        panel = windows.open({
          app: DESKTOP_PATTERNS,
          create: () => win,
          place: (area) => centeredBox(area, size),
        });
      };
      // No ellipsis: it opens a window, not a dialog.
      ctx.systemItem(DESKTOP_PATTERNS, 'Desktop Patterns', open);

      ctx.onMenu((value) => {
        if ((value === 'close' || value === 'quit') && panel?.isConnected) {
          windows.requestClose(panel);
        } else if (value === 'arrange') windows.arrange();
      });
      ctx.gate(ctx.item('arrange'), () => !windows.arranged());
      ctx.onDispose(() => panel?.remove());
    },
  });
}
