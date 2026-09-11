// ---------------------------------------------------------------------------
// The menu bar's owner (docs/apps-plan.md §3.3): ONE bar, the FRONT
// APPLICATION's. System 7's bar belonged to the front application — the
// Apple menu at the left in every application, the application's own menus
// beside it, and a switch of application replacing them wholesale. Here:
//
//   THE SPRITE MACHINE MENU is the Apple menu's seat and role — authored in
//   index.html at the bar's left, live in every application: About Sprite
//   Machine… (also the boot greeting) and Desktop Patterns, the machine's
//   things rather than an application's. Its handler and the shared dialogs
//   live here: the About box (its version and date lines filled from the
//   build facts), the storage-unavailable notice, and the `modalOpen()`
//   guard every handler in every application keeps (a key equivalent fires
//   app-wide, and must not act under an open modal).
//
//   THE APPLICATIONS' MENUS come and go. Each application (src/apps/<id>,
//   the registry in src/apps/index.js) authors its menus as a fragment of
//   vf-menu elements (menus.html, imported whole), which this controller
//   parses ONCE at wire-up — into the main document, so the elements
//   upgrade at once (a detached element's innerHTML; not a <template>,
//   whose inert document is why the window templates need importNode +
//   upgrade) — and hands to the application's `init` with the shell's
//   services (`deps`). The application binds its behavior to those nodes
//   whether or not they are on the bar: a vf-menu-select listener on each
//   menu (the item's event bubbles to its menu in a detached tree too), its
//   item syncs (`disabled`, `checked`, a tail) — ordinary Lit property
//   writes that hold and render on the next connect.
//
//   THE SWAP: the front application's menus sit between the Sprite Machine
//   menu and the clock (the clock is a slotted vf-label style.css keeps at
//   the right end), and on every change of shell.frontApp — the desktop's
//   activation wire's reading of the active window (shell/windows.js): a
//   document window the Sprite Editor, a text window the Text Viewer, a
//   folder window, the control panel or nothing the Finder — the outgoing
//   application's menus are REMOVED and the incoming one's INSERTED. Nodes
//   moved, never rebuilt, so an item's state survives the trip and a menu
//   reads on its return exactly as it was left. The kit takes menus coming
//   and going (vf-menu-bar re-reads its slot on every access and re-syncs
//   on slotchange; a menu open at the instant its application leaves
//   closes; an item blinking at that instant cancels), and A DETACHED MENU
//   CLAIMS NO KEY: an item's key-equivalent ear is a document listener
//   added on connect and removed on disconnect. So the Sprite Editor's ⌘S,
//   off the bar, is inert in the Finder with no `disabled` written anywhere
//   — the Finder's own ⌘S doing nothing — which is what retired the old
//   role gating (the sixteen DOC_SCOPED items, the Finder-role clauses).
//   Detach, never hide: a hidden menu's items would stay connected and keep
//   claiming. The bar's `label` follows — Finder, Sprite Editor, Text
//   Viewer — so the menubar announces whose it is.
//
//   THE BOOT: nothing is active at wire-up, shell.frontApp reads the
//   Finder, and the first sync slots the Finder's menus — synchronous, at
//   main.js's top level, so the first paint already shows the right bar and
//   the About box greets over it.
//
//   CROSS-APPLICATION CALLS go through `deps.apps` — the registry's
//   actions by id, filled as each `init` returns, read at pick time (never
//   at wire-up, so the order of initialization cannot bite): the Finder's
//   New… calls the Sprite Editor's newDocument(); main.js's icon layer
//   calls its openDoc(id) through the same record (returned as `apps`).
// ---------------------------------------------------------------------------

import { session } from '../state/session.js';
import { shell } from '../state/shell.js';

/**
 * What the controller hands every application's `init`: the shell's
 * services, the shared dialogs, and the registry's actions by id.
 * @typedef {{
 *   desktop: import('vintage-frames').VfDesktop,
 *   windows: ReturnType<typeof import('./windows.js').initWindows>,
 *   patterns: ReturnType<typeof import('./patterns.js').initPatterns>,
 *   ring: ReturnType<typeof import('../scene/ring.js').initRing>,
 *   model: ReturnType<typeof import('../scene/model-export.js').initModelExport>,
 *   folders: ReturnType<typeof import('./folders.js').initFolders>,
 *   texts: ReturnType<typeof import('./texts.js').initTexts>,
 *   icons: ReturnType<typeof import('./icons.js').initIcons>,
 *   showAbout(): void,
 *   showStorage(): void,
 *   modalOpen(): boolean,
 *   apps: Record<string, Record<string, (...args: any[]) => any>>,
 * }} AppDeps
 */

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {{apps: import('../apps/index.js').App[], defaultApp: import('../state/shell.js').AppId}} registry
 *   The applications in the bar's order, and the one whose menus the bar
 *   holds for an id no application claims.
 * @param {Omit<AppDeps, 'desktop'|'showAbout'|'showStorage'|'modalOpen'|'apps'>} services
 *   The shell's services the applications wire to: the window layer, the
 *   panel owners (the Desktop Patterns control panel, the folder windows,
 *   the text windows), the 3D Sprite Atlas's renderer follower (Export
 *   Sprite Atlas… renders through it), the 3D model export's subject
 *   (Export 3D Model… writes its glb through it), and the icon layer (New
 *   Folder's rename box, Copy's selection).
 */
export function initMenuBar(desktop, { apps, defaultApp }, services) {
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

  // A shortcut-triggered action must not fire under an open modal (the
  // Colors picker lives in shadow DOM, so it's checked via its session flag).
  const modalOpen = () =>
    session.get().pickerOpen || !!desktop.querySelector('vf-dialog[open]');

  // --- the shared dialogs -------------------------------------------------------
  // The About box — Sprite Machine → About…, and the BOOT GREETING (main.js
  // parks a load with no document to open on it: the classic launch splash;
  // OK, Escape, or a click anywhere outside the box leaves the bare desktop,
  // nothing activates). The click-away is the kit's own `light-dismiss` —
  // the markup's attribute on this one dialog, so nothing here listens for
  // it (its vf-close arrives with reason 'outside', should a click-away ever
  // need telling from OK; the box holds no pending state). The copy is
  // the markup's; the version and date lines are BUILD facts (vite.config.js
  // `define`: package.json's version, HEAD's commit date), written once here
  // so the markup never carries a stale number.
  const dlgAbout = $('#dlg-about');
  const dlgStorage = $('#dlg-storage');
  $('#about-version').textContent = `version ${__APP_VERSION__}`;
  $('#about-date').textContent = __APP_DATE__;
  const showAbout = () => dlgAbout.show();
  // The storage-unavailable notice: what Save, Duplicate, New Folder and a
  // paste raise where IndexedDB is broken (a private window).
  const showStorage = () => dlgStorage.show();
  on($('#btn-about-ok'), 'click', () => dlgAbout.close());
  on($('#btn-storage-ok'), 'click', () => dlgStorage.close());

  // --- the Sprite Machine menu ----------------------------------------------------
  on($('#menu-app'), 'vf-menu-select', (e) => {
    if (modalOpen()) return;
    switch (/** @type {CustomEvent} */ (e).detail.value) {
      case 'about':
        showAbout();
        break;
      case 'desktop-patterns':
        // The Desktop Patterns control panel (shell/patterns.js): a window,
        // machine-level like About — live in every application. Opening it
        // brings the Finder forward: it's the Finder's window.
        services.patterns.open();
        break;
    }
  });

  // --- the applications -----------------------------------------------------------
  /** The registry's actions by id, filled as each init returns. */
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
  /** The fragment's vf-menu elements as live nodes of THIS document (the
   *  header's parse): upgraded at once, attached to nothing yet. */
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

  // --- the swap ---------------------------------------------------------------------
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
    /** The boot greeting (main.js): a load with no ?file=<name> to open
     *  parks at the About box. */
    showAbout,
    /** Every application's public verbs by id — the Sprite Editor's
     *  openDoc for the icon layer's double-click (main.js, late-bound). */
    apps: actionsById,
    dispose() {
      for (const instance of instances) instance.dispose();
      if (slotted) for (const node of slotted.nodes) node.remove();
      slotted = null;
      for (const fn of teardown) fn();
    },
  };
}
