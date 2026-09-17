// Built-in text files, imported whole with Vite's ?raw. A seeded record stores
// the key alone, so every file opens the text shipped here (files.js
// builtinText). A key never changes once shipped; a record whose key is gone
// leaves the desktop.
//
// To add one, put the .txt here and list it below with a new key and its
// desktop name. An existing profile gets it from Special → Restore Default
// Files.

import readMe from './read-me.txt?raw';
import keyboardShortcuts from './keyboard-shortcuts.txt?raw';

/** @typedef {{key: string, name: string, text: string}} TextSeed */

/** @type {TextSeed[]} */
export const TEXTS = [
  { key: 'read-me', name: 'Read Me', text: readMe },
  { key: 'keyboard-shortcuts', name: 'Keyboard Shortcuts', text: keyboardShortcuts },
];

/** A built-in's text by key, or null. @param {string} key */
export const builtinText = (key) => TEXTS.find((t) => t.key === key)?.text ?? null;
