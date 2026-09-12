// Menu bar: the Sprite Machine menu, the front application's menus and the
// shared dialogs.
//
// - The Sprite Machine menu (index.html) stays on the bar in every application.
//   Key equivalents fire app-wide, so every menu handler checks modalOpen().
// - Each application's menus.html is parsed once with innerHTML in this
//   document, so its vf-menu elements upgrade at once. The nodes go to the
//   application's init, which binds to them whether or not they are on the bar.
// - On each shell.frontApp change, the outgoing application's menus are
//   removed and the incoming ones inserted before the clock. The same nodes
//   are reused, so item state persists. Menus must be detached, not hidden. An
//   item's key equivalent stays active while it is connected.
// - The first sync runs at wire-up, so the first paint shows the Finder's menus.
// - Cross-application calls go through deps.apps, read at pick time.

import { session } from '../state/session.js';
import { shell, DESKTOP_PATTERNS } from '../state/shell.js';

/**
 * The deps passed to each application's init.
 * @typedef {{
 *   desktop: import('vintage-frames').VfDesktop,
 *   windows: ReturnType<typeof import('./windows.js').initWindows>,
 *   ring: ReturnType<typeof import('../scene/ring.js').initRing>,
 *   model: ReturnType<typeof import('../scene/model-export.js').initModelExport>,
 *   iconPos(key: string): {left: number, top: number} | null,
 *   windowPin(key: string): import('./layout.js').Pin | null,
 *   showAbout(): void,
 *   showStorage(): void,
 *   modalOpen(): boolean,
 *   apps: Record<string, Record<string, (...args: any[]) => any>>,
 * }} AppDeps
 */

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {{apps: import('../apps/index.js').App[], defaultApp: import('../state/shell.js').AppId}} registry
 *   The applications in bar order, and the fallback when no application
 *   matches shell.frontApp.
 * @param {Omit<AppDeps, 'desktop'|'showAbout'|'showStorage'|'modalOpen'|'apps'>
 *   & {greet(): boolean, setGreet(on: boolean): void}} services
 *   Shared services for the applications. greet and setGreet are used only by
 *   the About box.
 */
export function initMenuBar(
  desktop,
  { apps, defaultApp },
  { greet, setGreet, ...services }
) {
  const $ = (sel) => {
    const el = desktop.querySelector(sel);
    if (!el) throw new Error(`shell/menu-bar: missing element ${sel}`);
    return /** @type {any} */ (el);
  };

  /** @type {(() => void)[]} */
  const teardown = [];
  const on = (el, type, fn) => {
    el.addEventListener(type, fn);
    teardown.push(() => el.removeEventListener(type, fn));
  };

  const bar = $('vf-menu-bar');
  const clock = $('#clock');

  // The Colors picker is in shadow DOM, so its open state comes from session.
  const modalOpen = () =>
    session.get().pickerOpen || !!desktop.querySelector('vf-dialog[open]');

  // Shared dialogs
  // About box: Sprite Machine → About… and the boot greeting. The version and
  // date come from vite.config.js `define`.
  const dlgAbout = $('#dlg-about');
  const dlgStorage = $('#dlg-storage');
  $('#about-version').textContent = `version ${__APP_VERSION__}`;
  $('#about-date').textContent = __APP_DATE__;
  // Show at startup saves on each toggle, because a click outside closes the box
  // without OK.
  const chkGreet = $('#about-greet');
  const showAbout = () => {
    chkGreet.checked = greet();
    dlgAbout.show();
  };
  on(chkGreet, 'vf-change', (e) =>
    setGreet(!!(/** @type {CustomEvent} */ (e).detail.checked))
  );
  // Storage-unavailable notice, shown when IndexedDB fails (a private window).
  const showStorage = () => dlgStorage.show();
  on($('#btn-about-ok'), 'click', () => dlgAbout.close());
  on($('#btn-storage-ok'), 'click', () => dlgStorage.close());

  // Sprite Machine menu
  on($('#menu-app'), 'vf-menu-select', (e) => {
    if (modalOpen()) return;
    switch (/** @type {CustomEvent} */ (e).detail.value) {
      case 'about':
        showAbout();
        break;
      case 'desktop-patterns':
        actionsById[DESKTOP_PATTERNS]?.open();
        break;
    }
  });

  // Applications
  /** Each application's actions by id, filled as its init returns. */
  /** @type {AppDeps['apps']} */
  const actionsById = {};
  /** @type {AppDeps} */
  const deps = {
    ...services,
    desktop,
    showAbout,
    showStorage,
    modalOpen,
    apps: actionsById,
  };
  /** Parses a menus fragment into detached vf-menu elements of this document. */
  const parseMenus = (html) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    const nodes = /** @type {HTMLElement[]} */ (
      [...host.children].filter((el) => el.localName === 'vf-menu')
    );
    for (const node of nodes) node.remove();
    return nodes;
  };
  const entries = apps.map((app) => ({ app, nodes: parseMenus(app.menus) }));
  const instances = entries.map(({ app, nodes }) => {
    const instance = app.init({ menus: nodes, deps });
    actionsById[app.id] = instance.actions;
    return instance;
  });

  // Menu swap
  /** @type {(typeof entries)[number] | null} the application on the bar */
  let slotted = null;
  const sync = () => {
    const id = shell.get().frontApp;
    const entry =
      entries.find((e) => e.app.id === id) ??
      entries.find((e) => e.app.id === defaultApp) ??
      entries[0];
    if (!entry || entry === slotted) return;
    if (slotted) for (const node of slotted.nodes) node.remove();
    clock.before(...entry.nodes);
    bar.label = entry.app.name;
    slotted = entry;
  };
  teardown.push(shell.subscribe(sync));
  sync();

  return {
    /** Shows the About box. main.js calls it as the boot greeting. */
    showAbout,
    /** Each application's actions by id. */
    apps: actionsById,
    dispose() {
      for (const instance of instances) instance.dispose();
      if (slotted) for (const node of slotted.nodes) node.remove();
      slotted = null;
      for (const fn of teardown) fn();
    },
  };
}
