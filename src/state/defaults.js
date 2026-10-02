// The files a desktop comes with: the sample documents (lib/sprite-data.js)
// and the built-in text files (src/texts/). They are the catalog's seed on a
// profile with no library to convert, and Special → Restore Default Files
// stores the ones missing since. Pure: storing a sample's pixels is the
// caller's.

import { SPRITE, TEXT, textData } from './kinds.js';

/**
 * The samples no document is named for, and the built-in texts whose keys no
 * text file carries. A trashed one counts as present, so a restore never
 * duplicates one.
 * @template {{name: string}} S
 * @template {{key: string, name: string}} T
 * @param {{items: readonly {kind: string, name: string, data?: unknown}[]}} state
 * @param {S[]} samples
 * @param {T[]} texts
 * @returns {{docs: S[], texts: T[]}}
 */
export function missingDefaults(state, samples, texts) {
  const names = new Set(state.items.filter((i) => i.kind === SPRITE).map((i) => i.name));
  const keys = new Set(
    state.items.filter((i) => i.kind === TEXT).map((i) => textData(i).builtin)
  );
  return {
    docs: samples.filter((s) => !names.has(s.name)),
    texts: texts.filter((t) => !keys.has(t.key)),
  };
}

/**
 * Store the missing defaults on the desktop: each sample through
 * `storeSample`, then each text by its key. The times step by a millisecond,
 * so the listing keeps the order given. A sample that fails is skipped.
 * @template {{name: string}} S
 * @param {{get(): {items: readonly any[]}, create(input: object): Promise<unknown>}} catalog
 * @param {S[]} samples
 * @param {{key: string, name: string}[]} texts
 * @param {{storeSample(sample: S, at: number): Promise<unknown>, now?: () => number}} io
 */
export async function restoreDefaults(
  catalog,
  samples,
  texts,
  { storeSample, now = Date.now }
) {
  const missing = missingDefaults(catalog.get(), samples, texts);
  let at = now();
  for (const sample of missing.docs) {
    try {
      await storeSample(sample, at++);
    } catch {
      // The rest still go in.
    }
  }
  for (const t of missing.texts) {
    await catalog.create({
      kind: TEXT,
      name: t.name,
      data: { builtin: t.key },
      at: at++,
    });
  }
}
