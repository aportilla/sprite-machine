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
// wears. A revision to a file already seeded reaches no existing profile
// (the seeding is a one-shot; a versioned re-seed is the follow-up).
// ---------------------------------------------------------------------------

import readMe from './read-me.txt?raw';

/** @typedef {{name: string, text: string}} TextSeed */

/** @type {TextSeed[]} */
export const TEXTS = [{ name: 'Read Me', text: readMe }];
