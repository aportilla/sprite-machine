// Desktop Patterns: the control panel application. Wires its menus to the panel
// window (windows.js). The Sprite Machine menu opens it through actions.open.

import menus from './menus.html?raw';
import { prefs } from '../../state/prefs.js';
import { ring } from '../../state/ring.js';
import { DESKTOP_PATTERNS } from '../../state/shell.js';
import { workspace } from '../../state/workspace.js';
import { initPatternsWindow } from './windows.js';

/** @type {import('../index.js').App} */
export const desktopPatterns = {
  id: DESKTOP_PATTERNS,
  name: 'Desktop Patterns',
  menus,
  init({ menus, deps }) {
    const { desktop, windows, modalOpen } = deps;
    const panel = initPatternsWindow(desktop, windows);
    const menu = (name) => {
      const m = menus.find((el) => el.dataset.menu === name);
      if (!m) throw new Error(`apps/desktop-patterns: missing menu ${name}`);
      return m;
    };
    const item = (m, value) => {
      const el = m.querySelector(`vf-menu-item[value="${value}"]`);
      if (!el) throw new Error(`apps/desktop-patterns: missing item ${value}`);
      return /** @type {any} */ (el);
    };
    const menuFile = menu('file');
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
        case 'close':
        case 'quit':
          // A pattern chosen but not set is discarded.
          panel.close();
          break;
      }
    });

    on(menuView, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      if (menuDetail(e).value === 'arrange') windows.arrange();
    });

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
        /** Opens the panel or brings it forward. */
        open: () => panel.open(),
      },
      dispose() {
        for (const fn of teardown) fn();
        panel.dispose();
      },
    };
  },
};
