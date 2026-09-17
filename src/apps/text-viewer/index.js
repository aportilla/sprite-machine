// Text Viewer: the read-me application. Wires its menus to the text windows
// (windows.js). The Finder opens text files through actions.open.

import menus from './menus.html?raw';
import { prefs } from '../../state/prefs.js';
import { ring } from '../../state/ring.js';
import { TEXT_VIEWER } from '../../state/shell.js';
import { workspace } from '../../state/workspace.js';
import { initTextWindows } from './windows.js';

/** @type {import('../index.js').App} */
export const textViewer = {
  id: TEXT_VIEWER,
  name: 'Text Viewer',
  menus,
  init({ menus, deps }) {
    const { desktop, windows, modalOpen } = deps;
    const texts = initTextWindows(desktop, windows, { savedPin: deps.windowPin });
    const menu = (name) => {
      const m = menus.find((el) => el.dataset.menu === name);
      if (!m) throw new Error(`apps/text-viewer: missing menu ${name}`);
      return m;
    };
    const item = (m, value) => {
      const el = m.querySelector(`vf-menu-item[value="${value}"]`);
      if (!el) throw new Error(`apps/text-viewer: missing item ${value}`);
      return /** @type {any} */ (el);
    };
    const menuFile = menu('file');
    const menuEdit = menu('edit');
    const menuView = menu('view');

    /** @type {(() => void)[]} */
    const teardown = [];
    const on = (el, type, fn) => {
      el.addEventListener(type, fn);
      teardown.push(() => el.removeEventListener(type, fn));
    };
    const menuDetail = (e) => /** @type {CustomEvent} */ (e).detail;

    on(menuFile, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      switch (menuDetail(e).value) {
        case 'close': {
          const id = texts.activeText();
          if (id != null) texts.close(id);
          break;
        }
        case 'quit':
          texts.closeAll();
          break;
      }
    });

    on(menuEdit, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      switch (menuDetail(e).value) {
        case 'copy': {
          // The enabled item takes ⌘C, so the browser's own copy does not run.
          const text = texts.selectedText();
          if (text) navigator.clipboard?.writeText?.(text).catch(() => {});
          break;
        }
        case 'select-all': {
          const id = texts.activeText();
          if (id != null) texts.selectAll(id);
          break;
        }
      }
    });

    on(menuView, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      if (menuDetail(e).value === 'arrange') windows.arrange();
    });

    // Copy is disabled unless a text window holds a non-empty selection. A
    // disabled item leaves ⌘C to the browser.
    const itemCopy = item(menuEdit, 'copy');
    const syncCopy = () => {
      itemCopy.disabled = texts.selectedText() === '';
    };
    on(document, 'selectionchange', syncCopy);
    on(desktop, 'vf-activate', syncCopy);
    syncCopy();

    // Arrange Windows is disabled while every window is at its placement. The
    // subscribed stores are inputs to the placements.
    const itemArrange = item(menuView, 'arrange');
    const syncArrange = () => {
      itemArrange.disabled = windows.arranged();
    };
    teardown.push(
      workspace.subscribe(syncArrange),
      prefs.subscribe(syncArrange),
      ring.subscribe(syncArrange),
      windows.onLayout(syncArrange)
    );
    syncArrange();

    return {
      actions: {
        /** Opens a text file's window or brings it forward. */
        open: (id) => texts.open(id),
        /** Window geometry by key, for the desktop state snapshot (main.js). */
        pins: () => texts.pins(),
      },
      dispose() {
        for (const fn of teardown) fn();
        texts.dispose();
      },
    };
  },
};
