# Kit ask #11: a window body's paper as a kit pattern

**Status:** OPEN on vintage-frames **0.6.1**. Written 2026-09-03 from the 3D
Sprite Atlas windoid's row, on the user's calls: _"remove the grid rules…
just none is ok"_, _"remove the pattern bg from each independent item and
just give the grid the 'dots' pattern bg"_ — and, told that `vf-grid` takes
no `pattern` and asked why a container was needed, _"i'd like the dots to
go all the way across."_ So what is wanted is the **body's** paper: the
windoid's whole scroll plane dotted and the tiles sitting on it, the way
`vf-desktop`'s `pattern` is the screen's paper under every window. No kit
grammar says that today, so the app bridges it (below), to be deleted the
day a window can name its own paper.

## What the kit has

- **`vf-desktop`** takes `pattern`: the screen's paper, under everything.
- **`vf-container`** takes `pattern` (a library name or sixteen hex digits)
  and paints it as its box's own background through `PatternFillController`
  and the `vfPatternFill` recipe — the raster sized from the declared
  axes, and **measured** on an undeclared one (`TrackWidthController`, a
  `ResizeObserver` on the box), so a `fill-width` container re-rasters as
  its parent resizes.
- **`vf-window[scrollbars]`** renders a `vf-scroll-area` whose plane — the
  wrapper the slot renders into — is `width: fit-content; min-width: 100%`
  over a white viewport; a body or viewport carries no inset of its own.
- **`vf-grid`** paints its surface as `background: var(--vf-surface,
var(--vf-white, #fff))` on its shadow `.grid` box and documents
  `--vf-surface` as _"the surface behind the cells (default white)"_.
  `rules="none"` closes the gap and the cells butt.
- **`vf-stack`** paints nothing, by contract.

## The ask

**`pattern` on `vf-window` — and on `vf-scroll-area`, which IS the body of
a `scrollbars` window:** a library name or sixteen hex digits, painted as
the body's paper — the scrolled plane's own background, in place of the
white — at the plane's raster (measured, as the container's undeclared
axis is today: the plane is content-sized), its phase anchored at the
plane's origin, the content's (0,0). A row wider than the viewport then
scrolls over continuous paper, a row narrower sits on paper that runs to
the frame, and a non-scrolling window's body reads the same. Unset paints
white as now; an unknown value paints white and warns once, the
container's rule. A `vf-grid` on that paper clears its own surface with
the knob it already has (`--vf-surface: transparent`) — worth a sentence
in the grid's docs, no new grammar.

The one-sentence version: _the desktop can name its paper; a window's body
should be able to name its own the same way._

## In the app meanwhile (the bridge)

`src/components/sm-ring-view.js`: the body's one in-flow child is
`<vf-container class="ring-paper" fill-width height=… pattern=…>` — no
declared width: `fill-width` is the kit's own fill, 100% of the plane, and
a filled box contributes its content's width to the plane's `fit-content`,
so the plane still sizes to the `vf-grid rules="none"` inside it (the row
stays the scroll range) while the paper covers all of it, the viewport's
width or the row's, whichever is wider. The grid's surface token is cleared
— `.ring-grid { --vf-surface: transparent }`, the kit's documented knob —
so the paper shows through between and under the tiles. Each cell is a
`vf-stack` at the tile's declared size holding the frame canvas
(`fill-width fill-height`): a bare `vf-container` cell would paint the
desktop's ink (kit ask #6, [kit-asks-pattern-paper.md](kit-asks-pattern-paper.md)),
and a cell here must paint nothing. **Revised 2026-09-03 (later the same
day):** the paper is a SETTING now — the ring slice's `paper`, white /
black / gray, `RING_PAPERS` in `src/state/ring.js` naming the kit pattern
each paints (`white`, `black`, `dots`), white the default and, today,
white always (a radio column for it was built and retired the same day;
the user's intent is an automatic pick from the sheet's content one day —
[ring-size-plan.md](ring-size-plan.md) note 8; the `?ring=` hook seeds it
for a capture) — so the container's `pattern` is written from the ring
slice and `<sm-ring-view>` carries no attribute of its own (the
`pattern="dots"` in `index.html` is gone). Every value is a declared
pattern, white included — #6's bridge, still — so the body never shows the
desktop's dither through a bare box. `tools/drive.mjs` pins the paper's
`fill-width`, that it declares no width, its declared height, its live
width against `max(clientW, ringRowWidth)`, its pattern as a `RING_PAPERS`
value (white at boot, `dots` under `?ring=…,gray`), the grid's `rules`,
and that a cell names no pattern.

## After the bump

- `shell/windows.js` (or the view): write `RING_PAPERS[ring.get().paper]`
  onto `#win-ring`'s `pattern` (or its scroll area's) from a ring-slice
  subscription — the setting is the slice's, so the window's attribute is
  derived, never authored in `index.html`.
- `sm-ring-view.js`: the paper container goes and the grid is the body's
  in-flow content again. The `--vf-surface` line STAYS — it is the grid's
  own knob, not a bridge. The cells stay stacks (they paint nothing either
  way — and if #6 ships paper-by-default, a container cell would need the
  transparent opt-in, so the stack is the right box regardless).
- `tools/drive.mjs`: the paper pins move onto the window's attribute; the
  row-width oracle (`ringRowWidth`), the scroll-range pin and the paper
  checks (a `RING_PAPERS` value; `dots` under the hook) are unchanged in
  substance.
- `index.html`'s comment, the README's ring passage, the ring-size plan's
  as-built notes 7 and 8 and SMOKE-TEST's atlas items: the bridge sentence
  out.
- Pin the release in `package.json`.
