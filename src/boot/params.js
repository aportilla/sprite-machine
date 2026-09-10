// ---------------------------------------------------------------------------
// URL-param parsing → one typed boot object. Pure (string in, object out), so
// it stays Node-testable. ?file (or a bare #fragment) is the one USER-FACING
// param — the saved document a load should open instead of greeting with the
// About box. The rest are dev hooks main.js applies: ?sample, ?edit and
// ?fresh put a known document on screen from a clean profile (what
// tools/capture.sh shoots), and ?flat / ?diag / ?cam are the mesh and camera
// debug flags.
// ---------------------------------------------------------------------------

import { VIEW_NAMES } from 'sprite-machine';

/**
 * @param {string} search  location.search (with or without the leading '?')
 * @param {{sampleNames?: string[], hash?: string}} [opts]  the sample names,
 *   injected — the sample module itself imports a PNG asset, which only Vite
 *   can load, and this parser must stay Node-runnable — plus location.hash
 *   (the `#Cube` shorthand for ?file=Cube).
 */
export function parseBootParams(search, { sampleNames = [], hash = '' } = {}) {
  const params = new URLSearchParams(search);

  // ?file=<name> — or a bare #<name> fragment — asks the boot to open that
  // SAVED document instead of greeting with the About box. This just
  // carries the requested name; main.js resolves it against the refreshed
  // library listing (case-insensitive) and falls back to the About box
  // when nothing matches. ?file wins when both forms are given.
  let file = (params.get('file') ?? '').trim();
  if (!file && hash) {
    const frag = hash.replace(/^#/, '');
    try {
      file = decodeURIComponent(frag).trim();
    } catch {
      file = frag.trim(); // a malformed %-escape reads literally
    }
  }

  // ?sample=<index|name>: a known name wins; else a clamped index; else 0.
  // `sampleExplicit` records whether the param was GIVEN — an explicit sample
  // is a dev path, opened in place of the About box greet.
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
    /** @type {string|null} camera preset name (main maps it to a direction) */
    cam: params.get('cam'),
    /** @type {string|null} validated face name */
    edit: editParam && VIEW_NAMES.includes(editParam) ? editParam : null,
    sampleIndex,
    sampleExplicit: q != null,
    /** @type {string|null} the ?file=/#fragment saved-doc name request */
    file: file || null,
    // ?fresh=1: boot with storage ignored — no desktop-state restore, no
    // saved-doc icons, no seeding, no state writes: a clean slate on a
    // machine with saved docs.
    fresh: params.get('fresh') === '1',
  };
}
