# Kit ask #6, revised: a bare `vf-container` paints white paper

**Status:** OPEN on vintage-frames **0.6.1**. Written 2026-09-03 after the
leak bit a second time — the Full Sprite View's face-picker box, a bare
placed `vf-container` in the new window header, painted the desktop's
dither behind the cubes and radios (the first hit was the draw canvas's
layer stack, 2026-08-28). Both are bridged app-side the same way,
`pattern="white"` on the box, to be deleted the day the kit paints paper.
The user's position, stated on seeing the second hit: **a bare
`vf-container` should always have a white background.**

## What the kit's history says

Read from the kit repo at `~/MyProjects/vintage-frames`, not from memory:

1. **`e29e2e9` (2026-08-10) — "vf-container: a box that is nothing but its
   declared size."** The component was born transparent, on purpose: _"It
   paints nothing and means nothing. No border, background, role, keyboard
   behavior or selection — what it holds decides what it is."_ A bare
   container has never been white; that is a design decision to make, not
   a regression to find.
2. **`ab6a4f1` (2026-08-22) — "Pattern fills: the 38 MacPaint patterns and a
   pattern attribute on vf-container."** This is where the leak came in.
   The container's shadow box took the `vf-pattern-fill` class
   unconditionally, and the recipe reads `background-image:
var(--_vf-pattern-image, none)` on every such box — while
   `vf-desktop` paints its own pattern by writing that same token inline on
   `.screen`, the element that slots every window. Custom properties
   inherit through slots and shadow roots alike, so every unpatterned
   container on the desktop resolves the desktop's raster and paints its
   ink (no paper — `background-color` rides `.vf-patterned` alone, so the
   leak is pure black ink over whatever is behind). The commit's own
   comment promises the opposite: _"an unpatterned box paints exactly
   nothing and inherits nothing new."_ The desktop breaks that promise.
3. **`6e8ae0c` (2026-08-23), `rule`,** and everything since (0.5.x, 0.6.0,
   0.6.1) left both facts as they are: `src/pattern-fill.ts` 194–212 is the
   recipe; `src/components/vf-desktop.ts` 379–381 is the desktop's controller
   on `.screen`.

So: **the transparency is original; the leak snuck in with the pattern
attribute.**

## The ask

Two halves, either order:

- **Close the leak (the original #6):** the private token must not
  inherit. The box's own default before the inline write —
  `.vf-pattern-fill { --_vf-pattern-image: none; --_vf-pattern-size: auto }`
  — makes every kit pattern box start from nothing, and the controller's
  inline write still wins on the box it paints. (Resetting the token on the
  desktop's slot would do too, but the recipe-level default also covers a
  pattern box nested inside a patterned container.)
- **Paper by default (the revision):** a bare `vf-container` paints
  `--vf-white`, the way every kit surface that holds content does — a
  window body, a scroll viewport, the header. `pattern` then means "this
  paper, with this ink", and the blank pattern (`white`) becomes the
  default rather than a thing a consumer has to know to ask for. If the
  kit wants a transparent box back for some composition, that is the
  opt-in to name (`pattern="none"`, say), not the default.

`vf-stack` is a different question — it is a layout box that deliberately
paints nothing, and the kit's docs say so — and this ask does not touch
it.

## In the app meanwhile

Every `vf-container` in sprite-machine that holds content over paper
declares a pattern: the options strip (`white`), the draw canvas's layer
stack (`white`), the Sprite View's picker box (`white`), the 3D View's
well and the atlas cells (`gray-25`), the Desktop Patterns well and cells
(their own). `tools/drive.mjs` pins the picker box's attribute and that
its raster is written on its own inline style rather than inherited; a
SMOKE-TEST eye item pins the canvas paper.

## After the bump

- Nothing to change for correctness: `pattern="white"` on the three
  bridged boxes becomes a restatement of the default, and can come out or
  stay as documentation.
- Retire the drive's own-raster pin (the leak has no mechanism to pin),
  keep the attribute pin only if the attribute stays.
- Pin the release in `package.json` and note it in the ring-size plan's
  as-built header.
