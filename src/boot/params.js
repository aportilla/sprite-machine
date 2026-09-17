// Parses URL params into the boot options. Pure (no DOM).
// ?file=<name> opens a saved document over the restored desktop. ?sample, ?edit
// and ?fresh put a known document on screen from a clean profile
// (tools/capture.sh). ?flat, ?diag and ?cam are mesh and camera debug flags.

import { VIEW_NAMES } from 'sprite-machine';

/**
 * @param {string} search  location.search (with or without the leading '?')
 * @param {{sampleNames?: string[]}} [opts]  sampleNames is injected because the
 *   samples module imports a PNG only Vite can load.
 */
export function parseBootParams(search, { sampleNames = [] } = {}) {
  const params = new URLSearchParams(search);
  const file = (params.get('file') ?? '').trim();

  // ?sample=<index|name>: a matching name, else a clamped index, else 0.
  let sampleIndex = 0;
  const q = params.get('sample');
  if (q != null && sampleNames.length) {
    const byName = sampleNames.findIndex((n) => n.toLowerCase() === q.toLowerCase());
    sampleIndex =
      byName >= 0 ? byName : Math.min(sampleNames.length - 1, Math.max(0, +q || 0));
  }

  const editParam = params.get('edit');

  return {
    flat: params.get('flat') === '1',
    diag: params.get('diag') === '1',
    /** @type {string|null} camera preset name */
    cam: params.get('cam'),
    /** @type {string|null} validated face name */
    edit: editParam && VIEW_NAMES.includes(editParam) ? editParam : null,
    sampleIndex,
    sampleExplicit: q != null,
    /** @type {string|null} requested saved document name */
    file: file || null,
    // ?fresh=1 ignores storage: no restore, no writes, no seeding.
    fresh: params.get('fresh') === '1',
  };
}
