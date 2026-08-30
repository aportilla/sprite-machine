// ---------------------------------------------------------------------------
// Tiny shared template helpers for the chrome components — captions in the
// kit's own faces, the warning row the stats overlay and errors use, and
// the `pattern` attribute's parse (the Sprite View's and the 3D Sprite
// Atlas's cells wear a kit pattern each, declared the same way).
// The warning row's styles live here with its template, as a css export any
// component that renders warnRow() composes into its own `static styles`.
// ---------------------------------------------------------------------------

import { parsePattern } from 'vintage-frames';
import { css, html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import '../icons.js'; // registers <sp-icon-alert> (used by warnRow)

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

// Compose next to warnRow(): `static styles = [baseStyles, warnStyles, css`…`]`.
export const warnStyles = css`
  .warn {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    --mod-icon-size: 14px;
  }
  .warn sp-icon-alert {
    flex: none;
    margin-top: 1px;
  }
`;

// A caption in the kit's own faces (so it scales with the components): the
// display face for chrome, `face="body"` (Geneva 9) for fine print.
/** @param {string} text
 *  @param {{ face?: 'display'|'body', dim?: boolean, cls?: string }} [opts] */
export const label = (text, { face, dim = false, cls } = {}) =>
  html`<vf-label class=${ifDefined(cls)} face=${ifDefined(face)} ?dim=${dim}
    >${text}</vf-label
  >`;

// A warning / error line for the stats overlay: an alert icon + the message.
export const warnRow = (msg) =>
  html`<div class="warn">
    <sp-icon-alert></sp-icon-alert>${label(msg, { face: 'body' })}
  </div>`;
