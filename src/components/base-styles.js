// Styles every sm-* component composes first. The page's box-sizing reset does
// not reach into a shadow root, so each root sets border-box itself.

import { css } from 'lit';

export const baseStyles = css`
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
`;
