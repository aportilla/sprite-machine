# Report: scroll area content sits one device pixel inside the frame

**Status:** open, for vintage-frames. Found 2026-09-13 in sprite-machine's
Color Palette windoid. vintage-frames 0.10.0, Chrome 152.0.7977.65 on macOS.
The app does not bridge it.

## Summary

Above 1×, content in a `vf-scroll-area`, and so in a `vf-window scrollbars`,
starts one device pixel right of and below the content region's corner. This
holds for flow content and for a child placed at `top="0" left="0"`. The
viewport pads by `mod(var(--vf-scale, 1) * 1px, 1px)` to give back the part of
the frame border that Chromium floored to a whole CSS px. Chrome 152 keeps
that part, so the fraction is counted twice. Grid snapping cancels only
fractional device pixels, so a whole one passes through.

## What it looks like

The Color Palette is a `vf-window variant="utility" resizable
scrollbars="vertical"` whose body holds a `vf-grid frameless collapse` of
`vf-swatch` cells at the content origin. The outer swatch borders should land
on the frame lines. On a 2× display, 3 device px to the system px, the grid
starts one device px inside the frame on both axes, and a white seam one
device px wide shows between each frame line and the first row or column of
borders.

## Measurement

Three windows, 120 × 100 system px, `variant="utility"`. Two are `resizable
scrollbars="vertical"` and hold a 40 × 40 `vf-container`, one in flow and one
placed at `top="0" left="0"`. The third has no scrollbars and holds the same
container in flow, as the control. Offsets are the child's box from the
window's top-left, in device px, across then down. The expected offset is one
system px across, the frame border, and 13 down, the border and the utility
title bar.

| dpr | device px per system px | `--vf-scale` | computed border | viewport padding | expected | flow      | placed    | no scrollbars |
| --- | ----------------------- | ------------ | --------------- | ---------------- | -------- | --------- | --------- | ------------- |
| 1   | 1                       | 1            | 1px             | 0px              | 1, 13    | 1, 13     | 1, 13     | 1, 13         |
| 1.5 | 2                       | 4/3          | 1.33333px       | 0.333333px       | 2, 26    | 2.5, 26.5 | 2.5, 26.5 | 2, 26         |
| 2   | 3                       | 1.5          | 1.5px           | 0.5px            | 3, 39    | 4, 40     | 4, 40     | 3, 39         |
| 3   | 4                       | 4/3          | 1.33333px       | 0.333333px       | 4, 52    | 5, 53     | 5, 53     | 4, 52         |

At 1.5 the child's box lands on a half device px. Its grid snap writes
`--vf-snap-dx` and `--vf-snap-dy` of `0.328125px`, which carries the paint to
3, 27: one device px late, as at 2 and 3.

The painted border agrees with the computed one. A 2× capture of the
sprite-machine desktop in the same Chrome shows a window title bar's
1-system-px rule at 3 device px, the full system pixel.

## Cause

`src/components/vf-scroll-area.ts:221`:

```css
padding: mod(var(--vf-scale, 1) * 1px, 1px);
```

The comment above it and `docs/THREE-X-DISPLAYS.md:53-60` rest on Chromium
flooring `border-width` to a whole CSS px, so that `calc(var(--vf-scale) * 1px)`
computes to `1px` at every fractional scale. The padding adds the floored
fraction back, and border plus padding makes one system px.

Chrome 152 computes the border at its fractional value, 1.5px at scale 1.5 and
1.33333px at 4/3. Each is a whole number of device px on the density ladder,
and it paints at that width. Border plus padding is then one system px plus
`mod(scale, 1)` CSS px: one device px at 2× and 3×, and half of one at 1.5×,
which grid snapping rounds up to one.

## Where else it reaches

Not measured, but they carry the same term:

- `src/components/vf-list.ts:89`, the inset of the list's rows.
- `src/components/vf-text-area.ts:110-112`, the text inset.

The verify scripts and docs that assume the floor:

- `scripts/verify-scrollbars.mjs:394` fixes `bd = 2`, "the floored
  1-system-px border at dpr 2". Its tolerances, at lines 122-130 and 199-204,
  are built on the floor. Chrome 152 gives 3. Not run here.
- `scripts/verify-position.mjs:402-410` reads the plane's origin from the
  viewport's padding edge, so the placement checks agree with the padding
  rather than with the frame.
- `docs/THREE-X-DISPLAYS.md:53-60`, the border table.

The scripts run under Playwright's bundled Chromium, not Chrome. Which
Chromium builds still floor has not been checked here.

In sprite-machine every scroll area shows it: the Color Palette, the 3D Sprite
Atlas strip and the Text Viewer's windows.

## Why nothing corrects it

- Grid snapping (`src/grid-snap.ts`) cancels the fractional remainder of a
  component's position in device px. A whole device px has none.
- Placement anchors to the scroll plane, `.content`, which is
  `position: relative` inside the viewport's padding. A child placed at
  `top="0" left="0"` lands where flow content does.

## Reproduce

```html
<vf-window
  variant="utility"
  heading="flow"
  width="120"
  height="100"
  left="20"
  top="20"
  resizable
  scrollbars="vertical"
>
  <vf-container id="flow" width="40" height="40"></vf-container>
</vf-window>
<vf-window variant="utility" heading="plain" width="120" height="100" left="160" top="20">
  <vf-container id="plain" width="40" height="40"></vf-container>
</vf-window>
```

```js
const dx = (id) => {
  const child = document.getElementById(id);
  const win = child.closest('vf-window');
  return (
    (child.getBoundingClientRect().left - win.getBoundingClientRect().left) *
    devicePixelRatio
  );
};
```

On a 2× display, or Chrome with `--force-device-scale-factor=2`, `dx('flow')`
is 4 and `dx('plain')` is 3.

## Fix directions

The kit's call. The options seen from here:

1. **Drop the `mod()` term** where the engine keeps the fractional border. The
   simplest fix, and the frame lines already paint at full thickness. It holds
   only if Firefox and WebKit keep the fraction too, which needs measuring at
   1.5×, 2× and 3×.
2. **Measure the used border width once** at runtime and pad by its shortfall
   from one system px, through a custom property. Correct whichever way an
   engine rounds, at the cost of a measurement.
3. **Pin the floor in CSS**, `border-width: round(down, var(--vf-scale, 1) * 1px, 1px)`,
   so the padding's premise holds in every engine. Consistent, but it keeps
   the thin hairlines the THREE-X-DISPLAYS table records.
4. **Draw the frame line without `border-width`**, the inset `box-shadow` over
   matching padding that THREE-X-DISPLAYS.md measured at true thickness at
   every density, so the padding is exactly one system px. Its known costs,
   forced colors and the stepped-corner clip paths, stand.

Recommended: measure Firefox and WebKit first. If both keep the fraction, 1 is
the fix. If not, 2.
