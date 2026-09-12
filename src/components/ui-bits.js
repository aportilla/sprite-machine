// Small template helpers shared by the chrome components.

import { parsePattern } from 'vintage-frames';
import { html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

/**
 * Parses a component's `pattern` attribute with the kit's parsePattern: a
 * library name or sixteen hex digits. Returns null to paint nothing. An unknown
 * non-empty value warns once per host, tracked in `state`.
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

// A caption in the kit's faces: the display face by default, `face="body"`
// (Geneva 9) for fine print.
/** @param {string} text
 *  @param {{ face?: 'display'|'body', dim?: boolean, cls?: string }} [opts] */
export const label = (text, { face, dim = false, cls } = {}) =>
  html`<vf-label class=${ifDefined(cls)} face=${ifDefined(face)} ?dim=${dim}
    >${text}</vf-label
  >`;
