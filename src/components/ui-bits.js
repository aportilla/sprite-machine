// ---------------------------------------------------------------------------
// Tiny shared template helpers for the chrome components — captions in the
// kit's own faces and the warning row the stats overlay and errors use.
// The warning row's styles live here with its template, as a css export any
// component that renders warnRow() composes into its own `static styles`.
// ---------------------------------------------------------------------------

import { css, html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import '../icons.js'; // registers <sp-icon-alert> (used by warnRow)

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
