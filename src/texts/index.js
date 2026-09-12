// ---------------------------------------------------------------------------
// The built-in TEXT FILES — the how-to documentation that ships on the
// desktop: plain-text read-me documents, one `.txt` beside this index, each
// imported whole through Vite's `?raw` (the file's bytes as a string, no
// fetch). They serve one role, SEEDS: a profile that carries no record of
// having seeded them (shell/desktop-state.js `seededTexts`) stores each as
// an ordinary text file at boot (loaders.js seedDefaultTexts) — a real file
// from then on, renamed, filed or trashed like any other, and never
// re-seeded. The order is the seeding order — the icon lattice's.
//
// To add one: drop a `.txt` here and list it below with the name its icon
// wears. The seeding stays a one-shot, so a profile that has already booted
// does NOT take a new entry here at its next boot — the Finder's Special →
// Restore Default Files stores whatever the library is missing, which is
// that profile's route to it (loaders.js restoreDefaultFiles). A REVISION to
// a file already seeded still reaches no existing profile: the restore is by
// name and never overwrites a file that is there (a versioned re-seed is
// still the follow-up).
// ---------------------------------------------------------------------------

import readMe from './read-me.txt?raw';
import keyboardShortcuts from './keyboard-shortcuts.txt?raw';

/** @typedef {{name: string, text: string}} TextSeed */

/** @type {TextSeed[]} */
export const TEXTS = [
  { name: 'Read Me', text: readMe },
  { name: 'Keyboard Shortcuts', text: keyboardShortcuts },
];
