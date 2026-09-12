// Application registry: every app, and the default app whose menus show when
// no window is active. Each app is a directory under src/apps/.

import { FINDER } from '../state/shell.js';
import { finder } from './finder/index.js';
import { spriteEditor } from './sprite-editor/index.js';
import { textViewer } from './text-viewer/index.js';
import { desktopPatterns } from './desktop-patterns/index.js';

/** @typedef {import('../state/shell.js').AppId} AppId */

/**
 * One application. `id` is the value shell.frontApp takes, `name` is the menu
 * bar's accessible name while the app is front, and `menus` is its menus.html
 * fragment. `init` wires the parsed menu nodes, which may be detached from the
 * bar, and makes the app's windows. Other apps call its actions through
 * deps.apps.
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
