// Text Viewer: the read-me application. It opens the library's text files (the
// `text` kind), one window each (windows.js), and wires its menus. The window
// manager places a window, opens it out of its icon and closes it back into
// it, and retitles or closes it as its file is renamed or removed. The zoom box
// toggles a reading column (layout.js).

import { VfWindow } from 'vintage-frames';
import { defineApp, nearBox } from 'vintage-frames/shell';
import menus from './menus.html?raw';
import dialogs from './dialogs.html?raw';
import textArt from '../../assets/text-file.png';
import { TEXT } from '../../state/kinds.js';
import { textOf } from '../../texts/index.js';
import { alert, selectContents, selectedTextIn } from '../windows.js';
import { bodyOf, textWindow } from './windows.js';
import { expandedTextBox } from './layout.js';

export const TEXT_VIEWER = 'text-viewer';

export function textViewer() {
  /** Opens a text file's window out of `from`; init sets it. */
  let openText = (
    /** @type {import('vintage-frames/shell').Item} */ _item,
    /** @type {import('vintage-frames').VfViewportBox|null} */ _from
  ) => {};

  return defineApp({
    id: TEXT_VIEWER,
    name: 'Text Viewer',
    menus,
    dialogs,
    kinds: {
      [TEXT]: {
        art: textArt,
        open: (item, from) => openText(item, from),
        size: (item) => new TextEncoder().encode(textOf(item) ?? '').byteLength,
      },
    },
    init(ctx) {
      const { desktop, windows } = ctx;

      openText = (item, from) => {
        const text = textOf(item);
        if (text == null) {
          void alert(
            ctx,
            ctx.dialog('alert'),
            `“${item.name}” can’t be opened: its text is no longer part of Sprite Machine.`
          );
          return;
        }
        windows.open({
          app: TEXT_VIEWER,
          item: item.id,
          from,
          create: () => textWindow(item.name, text),
          keep: expandedTextBox,
        });
      };

      // The zoom box toggles between the reading column and the box the window
      // had before, or its placement without one. `keep` holds a zoomed window
      // zoomed across a browser resize.
      /** Each zoomed window's pin from before the zoom. */
      const before = new WeakMap();
      ctx.on(desktop, 'vf-zoom', (e) => {
        const win = e.target;
        if (!(win instanceof VfWindow) || windows.appOf(win) !== TEXT_VIEWER) return;
        const cur = {
          left: win.left ?? 0,
          top: win.top ?? 0,
          width: win.width ?? 0,
          height: win.height ?? 0,
        };
        const column = expandedTextBox(windows.area);
        if (nearBox(cur, column)) {
          const pin = before.get(win);
          before.delete(win);
          const back = pin ? windows.fromPin(win, pin) : windows.placed(win);
          if (back) windows.write(win, back);
        } else {
          before.set(win, windows.pinOf(win));
          windows.write(win, column);
        }
      });

      /** The active window, when it is a text window. */
      const active = () => {
        const w = desktop.activeWindow;
        return w instanceof VfWindow && windows.appOf(w) === TEXT_VIEWER ? w : null;
      };

      ctx.onMenu((value) => {
        const win = active();
        if (value === 'close' && win) windows.requestClose(win);
        else if (value === 'quit') {
          for (const w of windows.windowsOf(TEXT_VIEWER)) windows.requestClose(w);
        }
        // The enabled item takes ⌘C, so the browser's own copy does not run.
        else if (value === 'copy') {
          navigator.clipboard
            ?.writeText?.(selectedTextIn(windows, TEXT_VIEWER))
            .catch(() => {});
        } else if (value === 'select-all' && win) selectContents(bodyOf(win));
        else if (value === 'arrange') windows.arrange();
      });
      // Copy is disabled unless a text window holds a selection, so ⌘C falls
      // through to the browser.
      ctx.gate(ctx.item('copy'), () => selectedTextIn(windows, TEXT_VIEWER) !== '');
      ctx.gate(ctx.item('arrange'), () => !windows.arranged());
      ctx.onDispose(() => {
        for (const w of windows.windowsOf(TEXT_VIEWER)) w.remove();
      });

      return {
        /** Opens a text file's window, or brings it forward. The boot reopens
         *  the last session's windows through it.
         *  @param {{item?: string|null, from?: import('vintage-frames').VfViewportBox|null}} target */
        open({ item, from = null }) {
          const it = ctx.catalog?.item(item);
          if (it?.kind === TEXT) openText(it, from);
        },
      };
    },
  });
}
