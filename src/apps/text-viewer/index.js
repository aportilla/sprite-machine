// ---------------------------------------------------------------------------
// The TEXT VIEWER — the read-me application, TeachText's seat
// (docs/apps-plan.md): front while one of its windows holds the desktop's
// active state, its menus File / Edit / View (menus.html beside this file)
// on the bar then and off it otherwise (shell/menu-bar.js). The smallest
// application: Close and Quit over its windows, Copy and Select All over the
// read-me's prose — the two commands TeachText left live on a read-only
// document — and Arrange Windows. Its windows are its own
// (docs/app-windows-plan.md): windows.js beside this file makes them — their
// markup (windows.html), their text, their zoom box, the prose selection's
// reading and writing — and this module wires the bar to those verbs.
// `open` is its public verb: the Finder's icon layer opens a text file
// through it, at the double-click.
//
// THE GATES: off the bar the items claim no key (the kit's contract), and
// on it Close, Quit and Select All are always live (the application is
// front only with a text window active). Copy alone reads something: the
// document's selection — live while the prose selected lies in a text
// window and is not empty (selectionchange, and the active window
// changing) — and greyed it claims nothing, so ⌘C falls through as it
// always did. Every handler guards on "no modal open" (deps.modalOpen).
// ---------------------------------------------------------------------------

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
    // The application's windows (the header).
    const texts = initTextWindows(desktop, windows);
    /** A menu of this application's, by its data-menu. */
    const menu = (name) => {
      const m = menus.find((el) => el.dataset.menu === name);
      if (!m) throw new Error(`apps/text-viewer: missing menu ${name}`);
      return m;
    };
    /** An item within one of this application's menus, by its value. */
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

    // --- menus ------------------------------------------------------------------
    on(menuFile, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      switch (menuDetail(e).value) {
        case 'close': {
          // The front read-me.
          const id = texts.activeText();
          if (id != null) texts.close(id);
          break;
        }
        case 'quit':
          // Every text window in turn — TeachText's Quit; a read-me is
          // read-only, so nothing asks. The last close hands active to the
          // topmost document window, or leaves the bare desktop.
          texts.closeAll();
          break;
      }
    });

    on(menuEdit, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      switch (menuDetail(e).value) {
        case 'copy': {
          // The selected prose to the system clipboard — what the browser's
          // own copy would do (the item claims the stroke, so the write is
          // the page's); silent on failure, like the Finder's.
          const text = texts.selectedText();
          if (text) navigator.clipboard?.writeText?.(text).catch(() => {});
          break;
        }
        case 'select-all': {
          // One Range over the front read-me's text.
          const id = texts.activeText();
          if (id != null) texts.selectAll(id);
          break;
        }
      }
    });

    on(menuView, 'vf-menu-select', (e) => {
      if (modalOpen()) return;
      // Arrange Windows — the arrange alone (the window manager): every
      // window back to its placement, the text windows onto their cascade.
      if (menuDetail(e).value === 'arrange') windows.arrange();
    });

    // --- the gates ----------------------------------------------------------------
    // Copy follows the document's selection: live while the prose selected
    // lies in a text window and is not empty (windows.js reads it), so a
    // selection in a dialog's field or nowhere leaves ⌘C to the browser.
    const itemCopy = item(menuEdit, 'copy');
    const syncCopy = () => {
      itemCopy.disabled = texts.selectedText() === '';
    };
    on(document, 'selectionchange', syncCopy);
    on(desktop, 'vf-activate', syncCopy);
    syncCopy();

    // Arrange Windows ⌘J — the arrange alone here: greyed while the screen
    // IS the arrangement (windows.arranged), live the moment a text window
    // — or anything else on screen — sits off its placement. windows.onLayout
    // is the geometry signal; the stores cover the placement's inputs.
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
        /** Open a text file's window, or bring it forward — the Finder's
         *  icon layer's double-click, through the registry at the pick. */
        open: (id) => texts.open(id),
      },
      dispose() {
        for (const fn of teardown) fn();
        texts.dispose();
      },
    };
  },
};
