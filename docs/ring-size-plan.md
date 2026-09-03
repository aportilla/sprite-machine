# Plan: the 3D Sprite Atlas at a chosen tile size, in a scrolling strip

**Status:** implemented 2026-09-02 as planned (`npm test` 332, `drive.mjs`
264, typecheck + prettier + build clean, the `?ring` captures eyeballed).
**As built, where the code departs from the text below:** (1) the strip's
field group measures **258** with the shorter `size` caption, so
`RING_MIN_WIDTH` is **260** — four 64-px cells (261) clear it by a pixel;
(2) a tile-size change holds the windoid's **top-left** and moves its
bottom edge alone — one writer, `fitRing` in `shell/windows.js`, for the
placement and the size change alike (revised 2026-09-03: the first day's
build held the **bottom** edge instead, the strip being bottom-docked, so a
bigger tile grew the window up rather than off the raster, the top floored
at the reserve — a second writer, `refitRingHeight`; the user's call is
that a size change never moves the bar, so a strip left on the bottom
margin grows past the raster at a big tile, and a drag or Arrange brings
it back); (3) the drive reads the row's overflow through the
kit's exported `viewport` part, the app's content overflow rather than the
kit's rail state. **A gotcha for the next reader:** a dev server that was
already up on 5173 keeps serving its pre-bundled 0.5.4 kit after the
`npm install` (Vite re-optimizes on start, not live), and the drive and
capture default to 5173 — every check downstream of `flush` (an 8px
viewport inset, no corner cell) read as kit bugs until the run was pointed
at a fresh server (`node tools/drive.mjs 5174`). **(4) The axis lock is
DECLARED, not corrected** — vintage-frames **0.5.6** shipped the grow
box's size rect the same day (`min-width`/`max-width`,
`min-height`/`max-height`, a min equal to its max locking the axis — the
kit's Patterns-strip idiom), so decision 5 below is superseded: the app
pins `^0.5.6`, `shell/windows.js` declares `min-width` = `RING_MIN_WIDTH`
and `min-height` = `max-height` = `ringHeightFor(size)` (re-declared on
every size change, since the bound moves — which is why it is stated from
the shell and not authored in the markup), the `vf-resize` re-assertion
is gone, and the 3D View's floor is declared the same way in place of its
own correction handler. The drive pins the declaration. **(5)
vintage-frames 0.6.0** (applied 2026-09-03 —
[upgrade-vintage-frames-0.6.0.md](upgrade-vintage-frames-0.6.0.md)):
`flush` no longer exists — a window body and a scroll-area viewport carry
no inset of their own, so the composition decision 8 asked for is the
default; the markup drops the attribute, the drive's composition check
drops the pin on it, nothing else moves. The same release shipped kit asks
#7–#9 ([kit-asks-scroll-rail.md](kit-asks-scroll-rail.md)): the rail
survives the desktop's raise re-insert, tracks the row's width as cells
come and go, and never rubber-bands. **(6) The controls strip is the
window's HEADER, and a DITL** (2026-09-03, vintage-frames **0.6.1**): the
strip no longer lays itself out with flex and scaled `calc()`. It is
`<sm-ring-controls slot="header">` — the kit's new header slot, a white
band over a 1px rule between the title bar and the body, across the
whole window and outside the scroll area, so the controls hold while the
row scrolls under them by construction — placing the four captions
(`vf-label`, declared column widths, right-aligned) and fields at the
`top`/`left` a new `RING_FIELDS` DITL in `shell/layout.js` states,
against the header's own corner (rows at 4 and 33, a caption 4 below its
row — where the baselines meet — an 8 inset, 40 and 36 caption columns,
6 gaps, the kit's 74 × 25 number field: 3.5em of the 16px display em +
the 3px gap + the 15px stepper). `header-height="63"` is authored on the
window in `index.html`, the kit's grammar (a first cut stated it from
`shell/windows.js`; the user wants the markup to say it, as the kit's
docs do) — the same 63 as `RING_STRIP` (the DITL's 62 over the rule) the
chrome arithmetic always counted, so `ringHeightFor` is untouched and
the drive pins the attribute to the constant. The body is
the row alone: `<sm-ring-view>`'s `vf-grid` in flow at the plane's origin
(the kit sizes its scrolled plane to it, so the row IS the scroll range
and the viewport is exactly the tile tall), each cell a `vf-container
pattern` at the tile's declared size (the app's per-cell
`PatternFillController` pool is gone — the kit's element paints it). The
DITL's arithmetic reproduces note 1's measured 258 exactly, so
`RING_STRIP` and `RING_MIN_WIDTH` (258 + the borders) are derivations
now, not measurements — and the captions land on whole px (8 and 37
below the header's top, where the flex centering had put them at 8.5).
Neither component styles layout: the captions' `text-align: right` and
the number field's own em token are the whole stylesheet share. Built
earlier the same day on 0.6.0 as a body-only DITL — a `vf-container`
band declaring the row's width with `min-width: 100%`, a sticky
`vf-container` field group inside it, the grid placed at (0, 63) — the
app-side bridge for **kit ask #10**
([kit-asks-fixed-child.md](kit-asks-fixed-child.md), a `fixed` child):
0.6.1 shipped `fixed` as asked and the header slot beside it, and the
header is what the strip really is, so the app took the header and no
bridge remains. The drive reads the slot and the header height back,
checks the DITL against the live glyphs inside the header, and grows a
window past its row to see the header span it; the layout suite pins the
arithmetic. ·
**Planned:** 2026-09-02 on `e37ea05` (the 1-bit ants). **Depends on:**
vintage-frames **0.5.5** — `flush` passing through `vf-window[scrollbars]`
to the built-in scroll area's viewport, and the corner cell reserved on a
single-axis rail of a `resizable` window (both shipped in the kit's
`4b07587`) — and, as built, **0.5.6** for the size rect and **0.6.1** for
the header slot (note 6). Read
[the atlas plan](sprite-atlas-plan.md) first — this is a revision of §1's
decisions 3 and 6 and §9's decision A, not a new feature.

The ask, in three parts:

1. **`scale` becomes `size`** — the tile's edge in px, an integer from 2 to 255. The model's lattice envelope is fit to that edge, so px-per-voxel
   is a derived fraction, not a setting. The frame IS the tile.
2. **The windoid is resizable on the horizontal axis only.** Its height is
   the chrome plus `size`, re-derived on every size change; its width is
   the user's, through the grow box, floored at the controls strip.
3. **The status strip goes; a horizontal scroll rail takes its place.** The
   cells show at 1:1 — `size` system px each — in a row that scrolls under
   the kit's rail when it outgrows the window.

---

## 1. Locked decisions

1. **`size` fits the envelope to the tile.** `ringFrame(dims, elevation,
size)` returns the frame as `size` px, the orthographic half-extent as
   the envelope's larger half (voxel units), and the derived px-per-voxel
   (`size / max(envelope.width, envelope.height)`). The circle envelope,
   the yaw convention and the anchor are unchanged (the atlas plan §3B);
   only the frame's derivation flips — the size drives the scale instead of
   the scale driving the size. The anchor takes `size` and derives the
   scale itself.
2. **Range 2–255, default 64.** `RING_MIN_SIZE = 2`, `RING_MAX_SIZE = 255`
   (the ask: greater than 1, less than 256), `RING_DEFAULTS.size = 64` —
   the engine-friendly power of two and the editor's own tile ceiling. The
   sheet tops out at 16 × 255 = 4080 px wide, inside every GPU's limit.
3. **The cells are the frame at 1:1.** A cell is `size` system px square
   with a `size × size` backing store — one image px per system px, the
   kit's raster contract (whole device px at any density), no CSS scaling.
   `ATLAS_GRID.cell` stays the Sprite View's; the ring no longer reads it.
4. **The windoid's height is a derivation, its width is the user's.**
   `ringHeightFor(size)` = `RING_CHROME.h + size`, where the chrome's
   bottom 15 is now the rail's inside-the-frame height rather than the
   status strip's (both 15 — the kit's grow-box height — so `RING_CHROME`
   is unchanged at `{ w: 2, h: 92 }`). The width starts at the placement's
   and changes only by the grow box (and Arrange, which re-runs the
   placement — the 3D View's own posture).
5. **The axis lock is the app's.** _(As planned:)_ the kit's grow box
   writes both axes from the gesture origin on every move (no axis
   option), so a `vf-resize` handler re-asserts the derived height and
   floors the width — the 3D View's floor idiom exactly: the kit fires
   after the box is applied, the correction lands in the same task before
   the next paint, and the drag simply doesn't move the bottom edge.
   _(As built — see the status note:)_ 0.5.6's size rect made the lock a
   declaration, `min-height` = `max-height`, and the handler went.
6. **The initial width is the natural row, capped at the vacancy, floored
   at the strip.** `ringWidthFor(views, size)` = `n · size + (n − 1) + 2`
   floored at `RING_MIN_WIDTH`; the placement caps it at the vacant
   middle's width so a fresh strip never runs under the rail. With more
   views than fit, the rail goes live.
7. **The width springs, the height holds.** In the nine-slice pin the ring
   is now mixed: the y axis resolves as a fixed size (the bottom edge a far
   strut, the top follows — the same anchor rule as before), the x axis as
   a resizable box floored at the strip (its right edge springs with the
   middle, like the document window's it sits under). The fixed-point
   property therefore covers the ring's left, top and height; its width is
   content. A grow-box drag is a "touch" (the pin re-derives); a height
   refit is not.
8. **`scrollbars="horizontal" flush resizable`, no status line.** The kit
   renders the classic composition: the rail on the frame's bottom edge,
   the corner cell reserved (0.5.5: a resizable window with an empty
   status slot), the grow box in it, the viewport flush to the frame.
   Dropping the `sm-status-line kind="ring"` is what makes the corner
   appear — the kit puts the grow box in a populated status strip instead.
9. **The controls strip sticks.** The whole body is the scroll area's
   content, so the strip's field group is `position: sticky; left: 0`
   inside a strip that spans the full scrollable width (the host is
   `width: max-content; min-width: 100%`): the paper and its rule scroll
   as one wide band, the fields hold at the viewport's left.
10. **The views cap stays 16.** Scrolling would permit more, but a 255
    tile at 32 views is 8160 px of sheet — near a texture limit for no ask.
11. **The chunk gains the derived scale.** `sprite-machine:ring` carries
    `{ views, elevation, offset, size, frame, scale, anchor, yaws }` —
    `frame` equals `size` (an importer reading `frame` keeps working),
    `scale` is px per voxel (a float now), the way an engine relates the
    sprite's px to the lattice's units.
12. **Settings stay app-level and session-only**; the dialog still edits
    live (the atlas plan's 8 and 9).

---

## 2. Design

### 2A. `lib/ring.js`

```js
ringFrame(dims, elevation, size) → { px: size, half, scale }
  // half  = max(env.width, env.height) / 2   (voxel units; the box fits, centered)
  // scale = size / max(env.width, env.height) (px per voxel, derived)
ringAnchor(dims, elevation, size) → { x: size / 2, y: size / 2 + (ny / 2)·cos e·scale }
```

`ringEnvelope`, `ringYaws`, `ringSheet`, the camera pose and `ringCenter`
are untouched. The header's "scale px per voxel" paragraph becomes "the
frame is the tile".

### 2B. `state/ring.js`

`RING_DEFAULTS = { views: 4, elevation: 45, offset: 0, size: 64 }`,
`RING_MIN_SIZE`, `RING_MAX_SIZE`, `setSize(n)` (int, clamped, NaN a no-op,
silent when unchanged). `ringMetaChunks(name, settings, { frame, scale,
anchor, yaws })`. The sheet channel is unchanged.

### 2C. `scene/ring-renderer.js`

`render({ views, elevation, offset, size })`: `ringFrame(dims, elevation,
size)` gives `F` and `half`; nothing else changes — the camera's
half-extent was already `half · s`.

### 2D. `shell/layout.js`

```js
export const RING_CHROME = { w: 2, h: 12 + 2 + RING_STRIP + 15 }; // 15 = the rail
export function ringHeightFor(size)         // RING_CHROME.h + size
export function ringWidthFor(views, size)   // max(RING_MIN_WIDTH, n·size + (n−1) + 2)
initialPlacement(w, h, tools, { ringViews = 4, ringSize = 64, ringShown = false })
  // ring: left x0, height ringHeightFor(size), top docked on the bottom margin,
  //       width max(RING_MIN_WIDTH, min(ringWidthFor(views, size), vacantW));
  //       the doc box gives up ringHeightFor(size) + GAP while shown
zoomedBox(w, h, pos, { ringShown = false, ringSize = 64 })
```

`RING_HEIGHT` goes (every reader takes the derivation). `pinTo`'s policy
is per axis already (`size?.height`, `min?.width` resolve independently);
the typedef says so.

### 2E. `shell/windows.js`

- `smartLayout` passes `ringSize`; `onZoom` too.
- `fitRing`: height = `ringHeightFor(size)`, width floored at
  `RING_MIN_WIDTH`. Called by `placeWindoid('ring')` (after the placement
  wrote the resizable box) and by the `ring.subscribe` guard — now on the
  computed HEIGHT (a views change writes nothing).
- `onRingResize` on `vf-resize`: the axis lock + the width floor.
- `floorOf(ring)` = `{ width: RING_MIN_WIDTH, height: ringHeightFor(size) }`;
  the re-pin policy for the ring is `{ min: { width }, size: { height } }`,
  and its "touched" test compares width but not height.

### 2F. `<sm-ring-view>`

The strip's four fields move into a sticky `.fields` group; the `size`
field (2–255) replaces `scale`; the grid's `cell-width`/`cell-height` are
`size`; the pattern controllers' `getSize` reads it; `#paint` sizes each
backing store to the sheet's frame as before (now equal to the cell). The
`.ring-box` centering goes — the row sits top-left, the viewport's white
to its right.

### 2G. The markup, the dialog, the hook

- `index.html`: `<vf-window id="win-ring" … movable resizable
scrollbars="horizontal" flush>` with the status line removed; the
  dialog's Scale row becomes **Size** (`#atlas-size`, 2–255, "px tile"),
  the readout row reads the sheet.
- `menus.js`: `atlasSize`, the setter, the export's chunk geometry.
- `?ring=<views>[,<elevation>[,<offset>[,<size>]]]` — the fourth field is
  the size (`?ring=8,30,45,128`).
- `sm-status-line`: the `ring` kind is removed.

---

## 3. Verification

- **`npm test`:** `ring.test.mjs` (the frame is the size, the envelope's
  larger half fills it, the derived scale, the anchor by size);
  `ring-state.test.mjs` (the default 64, `setSize`'s clamps, the chunk's
  fields); `params.test.mjs` (the fourth field); `layout.test.mjs`
  (`ringHeightFor`, `ringWidthFor(views, size)`, the placement's ring box
  — capped at the vacancy, floored at the strip, the doc box shortened by
  the size-derived height — `zoomedBox`, the fixed-point loop asserting
  the ring's left/top/height at two sizes, the degenerate raster).
- **`drive.mjs`** (the atlas section, mechanisms not copy): the box
  geometry (`ringHeightFor(64)` tall, the natural width for four cells);
  the cells `64 × 64` backing AND box; the strip floor pinned against the
  live `.fields` box; the views stepper adds cells, the width holds, the
  viewport overflows (the rail live); the size field typed to 128 moves
  the window's height and the cells; a grow-box drag of +30/+20 lands
  +30/0; a drag under the floor stops at `RING_MIN_WIDTH`; the dialog's
  Size field mirrors; the export's IHDR is `views·size × size`; the chunk
  carries `size`; a browser resize keeps the strip docked (left, bottom,
  height); `?ring=6,30,45,128`.
- **SMOKE-TEST:** the strip by eye (the rail, the corner cell, the grow
  box moving only the right edge, cells at native size, the fields holding
  while the row scrolls under them).
- **The standing gates** before the commit: `npm test`, typecheck,
  prettier, build, `drive.mjs`.

---

## 4. Order

1. `npm install vintage-frames@^0.5.5`; the gates green as-is.
2. `lib/ring.js` + its test.
3. `state/ring.js` + its test; `params.js` + `main.js`.
4. `scene/ring-renderer.js`.
5. `shell/layout.js` + its test.
6. `shell/windows.js`.
7. `<sm-ring-view>`, the markup, the status line.
8. The dialog (`index.html`, `menus.js`).
9. `drive.mjs`, then the docs (README, SMOKE-TEST, the atlas plan's
   as-built note, this file's status) and the gates.
