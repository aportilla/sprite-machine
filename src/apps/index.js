// ---------------------------------------------------------------------------
// The application registry (docs/apps-plan.md §3.2): the applications in
// one order — the Finder (the desktop's), the Sprite Editor (the
// document's), the Text Viewer (the read-me's), Desktop Patterns (the
// control panel's, a desk accessory's seat) — and the default, the one
// whose menus the bar holds when nothing is active. Each application is
// one directory under src/apps/ holding its menus as markup (menus.html,
// imported whole), its windows (windows.html, windows.js, layout.js — its
// init makes them; docs/app-windows-plan.md) and one module on one shape —
// `{ id, name, menus, init({ menus, deps }) }` — that shell/menu-bar.js
// parses, initializes and swaps in and out of the bar as shell.frontApp
// turns. Another application
// is another directory and one entry here.
// ---------------------------------------------------------------------------

import { FINDER } from '../state/shell.js';
import { finder } from './finder/index.js';
import { spriteEditor } from './sprite-editor/index.js';
import { textViewer } from './text-viewer/index.js';
import { desktopPatterns } from './desktop-patterns/index.js';

/** @typedef {import('../state/shell.js').AppId} AppId */

/**
 * One application: its id (a state/shell.js constant — the value
 * shell.frontApp takes), its name (the bar's accessible name while it is
 * front), its menus (the fragment: the vf-menu elements it owns), and the
 * wire. `init` binds behavior to the live nodes it is handed, attached to
 * the bar or not, makes the application's windows, and returns its public
 * verbs — what the shell and the other applications may call, through
 * `deps.apps` at pick time — and its teardown (which releases and removes
 * those windows).
 * @typedef {{
 *   id: AppId,
 *   name: string,
 *   menus: string,
 *   init(args: {menus: HTMLElement[], deps: import('../shell/menu-bar.js').AppDeps}):
 *     {actions: Record<string, (...args: any[]) => any>, dispose(): void},
 * }} App
 */

/** @type {App[]} */
export const APPS = [finder, spriteEditor, textViewer, desktopPatterns];

/** @type {AppId} */
export const DEFAULT_APP = FINDER;
