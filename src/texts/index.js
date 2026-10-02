// Built-in text files, imported whole with Vite's ?raw. A seeded text file
// stores the key alone, so every one opens the text shipped here. A key never
// changes once shipped; a file whose key is gone can't be opened.
//
// To add one, put the .txt here and list it below with a new key and its
// desktop name. An existing profile gets it from Special → Restore Default
// Files.

import readMe from './read-me.txt?raw';
import keyboardShortcuts from './keyboard-shortcuts.txt?raw';
import { textData } from '../state/kinds.js';

/** @typedef {{key: string, name: string, text: string}} TextSeed */

/** @type {TextSeed[]} */
export const TEXTS = [
  { key: 'read-me', name: 'Read Me', text: readMe },
  { key: 'keyboard-shortcuts', name: 'Keyboard Shortcuts', text: keyboardShortcuts },
];

/** A built-in's text by key, or null. @param {string} key */
export const builtinText = (key) => TEXTS.find((t) => t.key === key)?.text ?? null;

/** A text file's words: its built-in's, or its own. Null for a built-in the
 *  app no longer ships. @param {{data?: unknown}} item */
export function textOf(item) {
  const { builtin, text } = textData(item);
  return builtin != null ? builtinText(builtin) : text;
}
