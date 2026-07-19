// ---------------------------------------------------------------------------
// Real UI icons — Adobe Spectrum "workflow" icon set (open source, via
// @spectrum-web-components/icons-workflow). Each import below is a side effect
// that registers one <sp-icon-*> custom element; icon() then instantiates one.
//
// The elements render their SVG in shadow DOM with `fill: currentColor`, so an
// icon paints in its host button's text color for free — active / disabled /
// hover states all follow automatically (no per-icon color wiring). We ship no
// <sp-theme>, so the icons have no intrinsic size: the theme-independent hook
// their host honors is `--mod-icon-size`, set per context in style.css.
//
// Icons are DECORATIVE by default (no `label` ⇒ the host sets aria-hidden); the
// button they sit in carries the accessible name (aria-label / title / text).
// ---------------------------------------------------------------------------
import '@spectrum-web-components/icons-workflow/icons/sp-icon-draw.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-rectangle.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-color-fill.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-sampler.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-download.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-close.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-chevron-down.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-alert.js';

/**
 * Create a Spectrum workflow icon element.
 * @param {'draw'|'rectangle'|'color-fill'|'sampler'|'download'|'close'|'chevron-down'|'alert'} name
 *   the icon (matches the registered <sp-icon-NAME> element).
 * @param {string} [label] accessible label; omit for a decorative icon (the host
 *   then marks itself aria-hidden and the surrounding button names the action).
 * @returns {HTMLElement} an <sp-icon-*> element, colored by `currentColor` and
 *   sized by the ambient `--mod-icon-size`.
 */
export function icon(name, label) {
  const n = document.createElement(`sp-icon-${name}`);
  if (label) n.setAttribute('label', label);
  return n;
}
