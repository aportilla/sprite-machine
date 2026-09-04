// ---------------------------------------------------------------------------
// Tiny shared template helpers for the chrome components — captions in the
// kit's own faces, and the `pattern` attribute's parse (the Sprite View's
// and the 3D Sprite Atlas's cells wear a kit pattern each, declared the
// same way). (A warning row — an alert glyph beside a message — lived here
// too, for a stats overlay that no longer exists: no build error or
// warning takes a status line, and the glyph was the last of the Adobe
// Spectrum icons, so it went with the dependency.)
// ---------------------------------------------------------------------------

import { parsePattern } from 'vintage-frames';
import { html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

/**
 * A component's `pattern` attribute resolved through the kit's own grammar
 * (a library name — gray-25, dots, bricks, … — or sixteen hex digits): the
 * parsed pattern, or null to paint nothing. An unknown non-empty value warns
 * ONCE per host (the kit's posture: say it once, paint nothing) — `state` is
 * the host's own `{ warned }` flag.
 * @param {string} tag  the host's tag name, for the message
 * @param {string|null|undefined} value  the attribute, verbatim
 * @param {{warned: boolean}} state
 */
export function parsePatternAttr(tag, value, state) {
  const p = parsePattern(value);
  if (p === null && value?.trim() && !state.warned) {
    state.warned = true;
    console.warn(
      `${tag}: unknown pattern "${value}" — a vintage-frames library name ` +
        '(docs/PATTERNS.md) or sixteen hex digits. Painting nothing.'
    );
  }
  return p;
}

// A caption in the kit's own faces (so it scales with the components): the
// display face for chrome, `face="body"` (Geneva 9) for fine print.
/** @param {string} text
 *  @param {{ face?: 'display'|'body', dim?: boolean, cls?: string }} [opts] */
export const label = (text, { face, dim = false, cls } = {}) =>
  html`<vf-label class=${ifDefined(cls)} face=${ifDefined(face)} ?dim=${dim}
    >${text}</vf-label
  >`;
