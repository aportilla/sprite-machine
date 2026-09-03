# Kit ask #10: a child `fixed` against a scrolling window's viewport

**Status:** SHIPPED in vintage-frames **0.6.1**, the same day — `fixed`
as asked, on the placement mixin (every component that takes `top`/`left`
takes the bare attribute; the flag alone places at (0,0); the engine
underneath is `position: sticky` with the box's footprint erased, so a
fixed child comes before the flow content in its parent, paints over the
plane's placed children and never over the rails, and scrolling over it
still scrolls the content; where nothing scrolls it renders as placed) —
and, beside it, a **`vf-window` header slot**: a band between the title
bar and the body across the whole window, a white interior over a 1px
rule, no inset, a positioning anchor, `header-height` in whole system px
rule included, spanning the rail's column under `scrollbars`. The header
is what the atlas strip really is (the Finder window's header line), so
**the app took the header, not `fixed`**: `<sm-ring-controls
slot="header">` places the controls at the DITL's rectangles against the
header's corner, the body is the row alone, and the bridge below was
deleted — the ring-size plan's as-built note 6. Nothing in the app uses
`fixed` today; it is the right word for a tool strip over a document
body, which the app has none of. · Written 2026-09-03 against
vintage-frames **0.6.0**, from the **3D Sprite Atlas** windoid's controls
strip (`#win-ring` — `vf-window variant="utility" movable resizable
scrollbars="horizontal"`; see [the ring-size plan](ring-size-plan.md)).
Kit asks #5 (icon selection vs. a chrome press) and #6 (the pattern token
leak) are the two still open; #7–#9 shipped in 0.6.0. The rest of this
document is the record of the ask as written.

The ask in one line: **a child of a scrolling window can declare itself
`fixed` — placed against the viewport instead of the scrolled plane, so a
scroll leaves it where it is, and its `fill-width` is the viewport's.**

---

## What the app wants to write

The atlas body is a controls strip over a row of tiles that scrolls
sideways under the kit's rail. The controls hold at the window's left
while the row scrolls; the strip's paper and rule run the window's width.
The composition that says exactly that, and nothing else, is one
container and one grid:

```html
<vf-window
  heading="3D Sprite Atlas"
  variant="utility"
  movable
  resizable
  scrollbars="horizontal"
>
  <vf-container fixed fill-width height="63" rule="bottom">
    <vf-label left="8" top="8" width="40" dim>views</vf-label>
    <vf-number-field left="54" top="4" …></vf-number-field>
    <!-- … the other three pairs, at their DITL rectangles … -->
  </vf-container>
  <vf-grid
    top="63"
    left="0"
    columns="8"
    rows="1"
    cell-width="64"
    cell-height="64"
    frameless
  >
    <!-- one vf-container pattern="gray-25" width="64" height="64" per view -->
  </vf-grid>
</vf-window>
```

Every number is a whole system px the kit writes as a live `calc()`; the
app's stylesheet says nothing about layout. The strip is the window's
header — the status strip's mirror on the top edge — and the row is the
document, placed at (0, 63) on the plane and scrolling.

## What the app has to write today, and why

`vf-window[scrollbars]` renders the **whole default slot** inside its
built-in scroll area (`src/components/vf-window.ts` 814–828: the
`vf-scroll-area` in the body template, the default `<slot>` inside it),
and every placed child anchors to that area's **scrolled plane**
(`src/components/vf-scroll-area.ts` 203–224, `.content`; `src/position.ts`
50–57, the anchor list; docs/LAYOUT.md "(0,0) is … a scroll area's
scrolled plane"). So everything in the body scrolls, by construction. Two
consequences the grammar cannot get around:

1. **Nothing can be told to stay.** The one CSS mechanism that holds a
   box against a scroll, `position: sticky`, needs an **in-flow** box
   **narrower than the scroll range** inside a containing block **as
   wide as the range**. A placed child is out of flow, so the controls
   cannot be sticky themselves; a box holding them can — but then that
   box must sit inside another box as wide as the row.
2. **`fill-width` is the plane's width, never the viewport's.** The plane
   (`vf-scroll-area`'s `.content`: `width: fit-content; min-width: 100%`)
   is as wide as the row once the row overflows, so a band that fills it
   spans the whole scroll range, not the window — and when the row is
   narrower than the window, only in-flow content makes the plane wider
   than the row at all.

Hence the bridge (`src/components/sm-ring-view.js`, the header's "WHY
TWO BOXES AND NOT ONE"): a `vf-container rule="bottom"` **band** in flow
that declares the row's width as its own (so the kit's plane takes it)
and carries `min-width: 100%` (so it never falls short of the viewport),
holding a second `vf-container` — the **field group** at its declared
258 × 62, `position: sticky; left: 0` — in which the controls are placed.
Two boxes and three lines of CSS to say "the controls stay". The grid is
placed at (0, 63) on the plane, as it would be with the ask.

## The ask

A `fixed` declaration on a placeable child — the placement mixin's third
word beside `top`/`left`, or `vf-container`'s alone if the kit would
rather keep it to the one box made for placing things:

- **`fixed`** (a bare attribute): the child is placed against the
  **nearest scroll viewport** — `vf-scroll-area`'s, and so a
  `vf-window[scrollbars]` body's — instead of the scrolled plane. A
  scroll leaves it where it is. `top`/`left` are viewport coordinates
  (unset, 0 — the viewport's corner, one system px inside the frame like
  the plane's origin). `fill-width` / `fill-height` resolve against the
  viewport, so a `fixed fill-width` band is the window's width at any
  grow-box size, with no measurement anywhere.
- **It paints over the plane.** A fixed child covers the scrolled content
  under it — the header's band over the tiles' top rows if the document
  starts at 0 — and the scrolled content under it is unreachable by the
  pointer there. That is the composition's own business: the app places
  its row at the band's height.
- **The scroll range is the plane's**, as now: a fixed child adds
  nothing to it (it is not plane content), and a placed child's overflow
  still counts (0.6.0's `scrollWidth` measure and `measure()` cover it).
- **Outside a scroll area** the word is inert — the nearest positioned
  ancestor is the anchor as ever — so a page can move a fixed child
  between a window that scrolls and one that does not without editing it.

One way to draw it, for the kit's own judgment: `vf-scroll-area` keeps a
second layer coinciding with the viewport's box — `position: absolute`
over the viewport, outside `.content`, the rails' grid cell and not the
plane — and assigns `[fixed]` children to it (a `slot name="fixed"` the
window forwards, or manual slot assignment on the attribute; the
attribute reads better beside `top`/`left`/`fill-width` and keeps
`slot=` for the window's own parts). The layer takes no pointer events
itself; its children do. `fill-width` on a child of that layer is
`width: 100%` of the viewport for free, and `top`/`left` on it are
already the viewport's coordinates by CSS — the layer is the positioned
ancestor. A `slotchange` on the fixed layer needs no re-measure: it
changes no scroll range.

Worth a kit test: a `vf-window[scrollbars="horizontal"]` with a `fixed
fill-width` container over a placed row wider than the window — a
`scrollLeft` write moves the row and not the container; the container's
box equals the viewport's width before and after a grow-box drag; the
row's overflow still drives the rail.

## After the bump

- **`sm-ring-view.js`:** the band's declared width, the field group, and
  the stylesheet's `min-width: 100%` and `position: sticky` go; the strip
  becomes `<vf-container class="strip" fixed fill-width
height=${RING_STRIP} rule="bottom">` holding the eight placed items
  directly. `RING_FIELDS` and the row are untouched. The captions'
  `text-align: right` stays (a caption's alignment in its column is the
  app's).
- **`shell/layout.js`:** nothing — the DITL, `RING_STRIP` and
  `RING_MIN_WIDTH` are the same numbers.
- **`tools/drive.mjs`:** the atlas section's DITL check reads `fixed` on
  the strip and drops the band's declared-width and `min-width` pins (the
  band's live width equals the viewport's, before and after a grow); the
  fit check measures the items against the strip instead of the group.
- **Docs:** README § Windows (the atlas bullet's "two boxes, not one"),
  the ring-size plan's note 6, SMOKE-TEST's DITL item, `index.html`'s
  window comment — the bridge's sentences come out.
- Pin the release in `package.json` and note it in the ring-size plan's
  as-built header, the way 0.5.5, 0.5.6 and 0.6.0 are.
