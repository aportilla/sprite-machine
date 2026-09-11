// ---------------------------------------------------------------------------
// DESKTOP PATTERNS — the control panel as an application of its own
// (docs/apps-plan.md; the user's call, Sep 11 2026): a desk accessory's
// seat, front while its panel (shell/patterns.js — the window, the well,
// the chooser and the Set button are that module's and its component's)
// holds the desktop's active state, its menus File / View (menus.html
// beside this file) on the bar then and off it otherwise
// (shell/menu-bar.js). The smallest of the four: Close and Quit over the
// one panel, and Arrange Windows. The panel opens from the Sprite Machine
// menu — the Apple menu's Control Panels — and closes from its close box
// or from here; nothing else is an application command.
//
// THE GATES: off the bar the items claim no key (the kit's contract), and
// on it Close and Quit are always live (the application is front only with
// the panel active); Arrange Windows reads the windows' state. Every
// handler guards on "no modal open" (deps.modalOpen).
// ---------------------------------------------------------------------------

import menus from './menus.html?raw';
import { prefs } from '../../state/prefs.js';
import { ring } from '../../state/ring.js';
import { DESKTOP_PATTERNS } from '../../state/shell.js';
import { workspace } from '../../state/workspace.js';

/** @type {import('../index.js').App} */
export const desktopPatterns = {
  id: DESKTOP_PATTERNS,
  name: 'Desktop Patterns',
  menus,
  init({ menus, deps }) {
    const { windows, patterns, modalOpen } = deps;
    /** A menu of this application's, by its data-menu. */
    const menu = (name) => {
      const m = menus.find((el) => el.dataset.menu === name);
      if (!m) throw new Error(`apps/desktop-patterns: missing menu ${name}`);
      return m;
    };
    /** An item within one of this application's menus, by its value. */
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

    // --- menus ------------------------------------------------------------------
    on(menuFile, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      switch (menuDetail(e).value) {
        case 'close':
        case 'quit':
          // One panel ever, so Close and Quit are the same removal (a
          // selection never set is discarded — the close box's path); the
          // kit then hands active to the topmost document window, or
          // leaves the bare desktop to the Finder.
          patterns.close();
          break;
      }
    });

    on(menuView, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      // Arrange Windows — the arrange alone (windows.js): every window back
      // to its placement, the panel re-centered.
      if (menuDetail(e).value === 'arrange') windows.arrange();
    });

    // --- the gates ----------------------------------------------------------------
    // Arrange Windows ⌘J — the arrange alone here: greyed while the screen
    // IS the arrangement (windows.arranged), live the moment the panel — or
    // anything else on screen — sits off its placement. windows.onLayout is
    // the geometry signal; the stores cover the placement's inputs.
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
      actions: {},
      dispose() {
        for (const fn of teardown) fn();
      },
    };
  },
};
