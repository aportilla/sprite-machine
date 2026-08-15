// ---------------------------------------------------------------------------
// The one style block every sm-* component composes first:
// `static styles = [baseStyles, css`…`]`. The page's `* { box-sizing:
// border-box }` reset does not reach into a shadow root (only inherited
// properties cross the boundary), so each root re-establishes the border-box
// model itself — without it, padded+bordered boxes with explicit sizes (the
// stage panels, the draw box) would measure content-box and drift.
// ---------------------------------------------------------------------------

import { css } from 'lit';

export const baseStyles = css`
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
`;
