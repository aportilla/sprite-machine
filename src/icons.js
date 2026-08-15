// ---------------------------------------------------------------------------
// Real UI icons — Adobe Spectrum "workflow" icon set (open source, via
// @spectrum-web-components/icons-workflow). Each import below is a side effect
// that registers one <sp-icon-*> custom element; importing this module is what
// makes those tags usable in the chrome / `sm-editor.js` templates, where they are
// written literally (`<sp-icon-draw></sp-icon-draw>`) so lit can diff them.
//
// The elements render their SVG in shadow DOM with `fill: currentColor`, so an
// icon paints in its host button's text color for free — active / disabled /
// hover states all follow automatically (no per-icon color wiring). We ship no
// <sp-theme>, so the icons have no intrinsic size: the theme-independent hook
// their host honors is `--mod-icon-size`, set per context by the styles of the
// component that places them (the tool strip, the warning row).
//
// Icons are DECORATIVE (no `label` ⇒ the host sets aria-hidden); the button they
// sit in carries the accessible name (aria-label / title / text).
// ---------------------------------------------------------------------------
import '@spectrum-web-components/icons-workflow/icons/sp-icon-draw.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-rectangle.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-color-fill.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-erase.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-sampler.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-alert.js';
