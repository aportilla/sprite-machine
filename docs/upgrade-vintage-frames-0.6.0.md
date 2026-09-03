# Upgrading to vintage-frames 0.6.0

**Status:** APPLIED 2026-09-03, as written, with three things the text
below did not foresee: (a) `tools/drive.mjs`'s composition check on the
atlas windoid pinned `flush === true` — with the property gone from
`vf-window` that read `false`, so the pin is dropped (the check keeps the
rail's axis, the grow box and the empty status slot), and the Desktop
Patterns section pins the new `vf-stack pad="12"` as the app's own
statement of the inset; (b) the server on 5173 was not a stale Sprite
Machine server but the **kit's docs site** — a capture from it is the
kit's page, not this app's, so check _what_ a port serves before using it
as a baseline; the fresh `npm run dev -- --port 5174 --strictPort`
re-optimized on the changed lockfile and was the run's server; (c) a kit
paperwork nit, noticed and not fixed here (kit work stays in the kit's
own context): `vf-stack`'s `pad` doc comment still says "leave it off
inside a `vf-window` body, which already carries its own 12px inset; a
stack that means to own that inset goes inside `<vf-window flush>`" — the
0.5.x contract, inverted by this release. Written 2026-09-03 against the
kit's `main` at the 0.6.0 commits.

0.6.0 ships the three scroll-rail asks in
[kit-asks-scroll-rail.md](kit-asks-scroll-rail.md) and one breaking
change: a `vf-window` body and a `vf-scroll-area` viewport carry **no
inset of their own** any more, and the `flush` attribute is gone from both.
Content starts at the content region's corner, where a placed child's
(0,0) always was; an inset is the content's, stated with a `vf-stack pad`.
Every Sprite Machine window but one already set `flush`, so the upgrade is
small.

## 1. Pin it

`^0.5.6` does not accept 0.6.0 — pre-1.0 caret ranges take patch bumps
only, which is the point of the minor.

```sh
npm install vintage-frames@^0.6.0
```

Restart the dev server afterwards. A server already up keeps serving its
pre-bundled copy of the old kit (the ring-size plan hit this on 0.5.4).

## 2. The one layout change: Desktop Patterns

`#tpl-patterns-window` is the only window without `flush`, and its 248 × 304
box was sized around the body's old 12px padding (the comment above the
template spells the sum out). Without the inset, `sm-desktop-patterns`
would sit against the frame with 24px to spare on the right and bottom.
Give the content the inset the body used to:

```html
<vf-window heading="Desktop Patterns" movable width="248" height="304">
  <vf-stack pad="12">
    <sm-desktop-patterns></sm-desktop-patterns>
  </vf-stack>
</vf-window>
```

The window stays 248 × 304; the stack paints nothing and takes no role.
Update the sizing comment: "plus the stack's 12px pad" in place of "plus
the 12px body padding".

## 3. Drop the inert `flush` attributes

Five places in `index.html`: Full Sprite View, 3D View, 3D Sprite Atlas,
Tools, and `#tpl-document-window`. A leftover `flush` is inert (an unknown
attribute), so this is tidiness, not a fix. The comments that explain
"`flush` runs the body to the frame" now describe the default — reword
them when convenient (`index.html`, `sm-tools-panel.js`, `sm-tool-strip.js`,
`sm-editor.js`, `sm-ring-view.js`, `style.css`).

## 4. Nothing else to change

- **The atlas windoid** (`#win-ring`) needs no bridge for #7 or #8, as the
  asks doc said. Its `sm-ring-view` may keep `width: max-content`: the kit's
  scrolled plane is now the sticky strip's containing block by itself, so
  the rule is redundant, not wrong.
- **No overscroll bridge was written**, so there is nothing to delete for
  #9. The kit's scrollers no longer rubber-band; on this non-scrolling
  desktop page that costs nothing.
- **New and available, not needed today:** `vf-scroll-area.measure()`
  re-measures overflow and re-syncs the rails for a scroll range that
  changes with no box changing (a placed child moved through `top`/`left`).
  The ring's row grows by adding cells, which the kit now tracks itself.

## 5. Verify

The gates as usual (`npm test`, `tools/drive.mjs`). Then the smoke-test
idiom, by eye, on the 3D Sprite Atlas:

1. View → 3D Sprite Atlas. The first open draws the rail's arrow cells,
   not a bare white channel.
2. With the row overflowing and scrolled, step `views` up: the thumb moves
   without a drag.
3. With the row fitting, step `views` until it overflows: the trough and
   thumb appear without a grow-box resize.
4. Wheel past the row's end: nothing moves, the controls strip included.

And the Desktop Patterns panel: the well, chooser and button sit 12px in,
as before.

## 6. Paperwork

- `kit-asks-scroll-rail.md`: **Status:** SHIPPED in vintage-frames 0.6.0
  (#7 as asked; #8 by sizing the scrolled plane to its content rather than
  observing slotted elements; #9 as asked, chaining restored per part on
  pages that scroll).
- `ring-size-plan.md`: add 0.6.0 to the as-built header, noting that
  `flush` no longer exists and the composition is the default.
