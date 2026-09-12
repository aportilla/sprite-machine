// Built-in text files, imported whole with Vite's ?raw. Each is stored as an
// ordinary text file once per profile at boot, in this order
// (loaders.js seedDefaultTexts, tracked by desktop-state.js seededTexts).
// Special → Restore Default Files adds any that are missing by name. A revised
// file does not reach a profile that already has it.
//
// To add one, put the .txt here and list it below with its desktop name.

import readMe from './read-me.txt?raw';
import keyboardShortcuts from './keyboard-shortcuts.txt?raw';

/** @typedef {{name: string, text: string}} TextSeed */

/** @type {TextSeed[]} */
export const TEXTS = [
  { name: 'Read Me', text: readMe },
  { name: 'Keyboard Shortcuts', text: keyboardShortcuts },
];
