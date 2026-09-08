# Kit asks #13–#14: filing by drag — an icon drag over the desktop with a drop event, and a window re-measuring under a moved icon

**Status:** BOTH SHIPPED in vintage-frames **0.7.0** (2026-09-07, the day
they were written — published on npm; the app bumps in the folders plan's
step 0). Written from the folders plan ([folders-plan.md](folders-plan.md)):
documents filed into folders the Finder's way — an icon dragged onto a
folder's icon, into a folder's open window, out of a window onto the
desktop, window to window. As shipped (the kit's `docs/FINDER.md` and
`docs/ICONS.md`): a `movable` icon's drag is the dotted outline on the
desktop's own surface over everything, the icon staying put, reported as
`vf-drag-start` / `vf-drag` / a cancelable **`vf-drop`** / `vf-drag-cancel`
with `{clientX, clientY, left, top, x, y, icons}` — the uncancelled
default the move within the container, `preventDefault()` writing
nothing; a **`target`** attribute for the destination's inversion; the
selection travelling as a set (`icons`, the dragged one first, each
member's outline its own box); a **`vf-icon-field`** container (the
listbox, `size`, the rubber band); `placementAt(clientX, clientY)` on
`vf-desktop`, `vf-window` and `vf-scroll-area`; and (#14) a window with
`scrollbars` re-measuring its rails under any placed child's move. The
bridge below is therefore never built; the "after the bump" list is the
plan's §2.6. Kept for the record.

## What the kit has

- **`vf-icon`** is `movable`: `DragController` tracks the press and
  `PlacementController` writes the origin into `left`/`top` in system px.
  The icon **itself moves**, and `#keepWhole` clamps it **whole inside its
  positioning parent** — the box measured once at the press
  (`PlacementController.seed` → `#measureBounds`, the `offsetParent`'s
  client box). A `vf-icon` slotted into a `vf-window` body is therefore
  held inside that window for the whole gesture, and the body clips it
  besides.
- The drag fires **nothing** at the release: the target's `onDragEnd` is
  unused by `vf-icon`, and the only trace of a drop is the written
  position. A page can still watch the gesture (the captured `pointerup`
  composes up to the document) and hit-test where the pointer let go.
- `vf-desktop` stacks slotted windows by z-index; an icon layer slotted
  beside them (the documented `<div role="listbox">` recipe) paints below
  every window, so a desktop icon dragged over an open window slides
  **under** it.
- Selection inverts a 1-bit icon (`:host([selected]) .art { filter:
invert(1) }`), and the `icon` part is exported, so a page can restate that
  rule on a class of its own — a bridge, not a grammar.
- `vf-scroll-area.measure()` exists and is documented for _"a scroll range
  that changes with no box changing — a placed child moved through
  top/left"_; `vf-window[scrollbars]` renders its scroll area in its shadow
  and exposes no `measure()` of its own. The rails read
  `scrollWidth`/`scrollHeight` (scroll-state.ts, scroll-rail.ts), so a
  placed child inside the plane IS in the range — the measurement is what
  goes stale.

## Ask #13: the icon drag as the Finder's drag

System 7 dragged an icon as a **dotted outline** — the icon's silhouette
and its name plate, one-px dashes — drawn over everything on the screen,
the icon itself staying where it was until the drop; over a folder or disk
icon the destination **inverted**; the drop put the item where the outline
was, or filed it. The kit's icon should be able to drag that way, with the
page deciding what the drop means (the close box's position: the kit
reports, the consumer decides).

- **The outline drag.** On a `movable` icon's drag the kit draws the
  outline in a layer over the whole desktop — the page-drawn cursor's own
  top layer is the right place — at the pointer's offset from the press,
  **unclamped** by the icon's container; the icon does not move. The
  outline is the kit's raster: the art cell's silhouette and the plate's
  box in the kit's dashes, 1-bit, on the system-px lattice. Whether this is
  the default for every movable icon or an opt-in (`drag="outline"`) is
  the kit's call; the app wants it on every icon it has.
- **The events**, on the icon, composed and bubbling: `vf-drag-start`
  (detail `{}`); `vf-drag` per snapped step (detail `{clientX, clientY}`
  — the pointer, so a page can hit-test a destination and highlight it);
  **`vf-drop`** at the release, **cancelable**, detail `{clientX, clientY,
left, top}` — the pointer and the outline's origin in the icon's own
  container coordinates (system px), plus the same origin in viewport px
  (`x`, `y`) for a drop that lands in another container, which the page
  converts with `toSysExact` against that container's box. **The default
  action** of an uncancelled `vf-drop` is today's move: the origin written
  through `left`/`top`, clamped whole as now. `preventDefault()` writes
  nothing — the page re-parents the icon or files the item and places it
  itself. A `vf-drag-cancel` for Escape mid-drag (the outline vanishes, no
  drop) would round it out; the Finder had it.
- **The destination highlight**: a boolean **`target`** attribute on
  `vf-icon` that paints the selected treatment (`invert(1)`, or the
  `color` darkening) **without** selection semantics — no `vf-select`, no
  outside listener, no `aria-selected`. The page sets it on the folder
  under a `vf-drag` and clears it when the pointer leaves or the drop
  lands. It is the inverse of `selected`'s two halves: the look alone.
- **Optional, the selection travels**: a drag that starts on a selected
  icon outlines every selected icon in the same listbox (their relative
  offsets kept) and fires one `vf-drop` on the dragged one. The page files
  the selection either way (it reads its own selection at the drop); the
  outline showing all of them is the Finder's picture of it.

Sketched and rejected, for the record: a `drag-scope` attribute that
widens the clamp to the desktop — the body still clips the icon, and an
icon sliding under windows is what the outline exists to replace; the page
drawing its own outline from `pointermove` — the outline is 1-bit chrome,
and every aesthetic here is the kit's.

## Ask #14: a window re-measures under a moved icon

A folder window is `vf-window scrollbars="both"` with placed icons in its
body; a drag inside it moves an icon's `top`/`left` and changes the scroll
range with no box changing, exactly the case `measure()` documents — but
the page cannot reach the window's scroll area. Either the kit re-measures
on its own icon's drag end (a composed event the scroll area listens for,
so any placed kit child moving inside any scroll area re-measures — the
right grain), or `vf-window` forwards a `measure()`. The first is the ask;
the second is fine.

## In the app meanwhile (the bridge)

- Filing **onto a desktop folder icon** and **into an open folder window**
  from the desktop: a `pointerdown` on the icon root records the pressed
  icon and its origin; the document's `pointerup` reads the icon's written
  position, and if it moved, `dropTargetAt(clientX, clientY, dragged)`
  (`document.elementsFromPoint`, the dragged icon skipped — it is under the
  pointer) names the folder icon, the folder window, or the desktop, and
  the page files the selection. The icon slides under a window on the way
  (the kit's stacking); it lands inside it at the release.
- **Out of a folder window** and **window to window**: no gesture until
  #13 — the plan ships filing one way first.
- **The highlight**: a class on the folder icon under the drag, styled
  through the exported part in `style.css` — `vf-icon.sm-drop-target::part(icon)
{ filter: invert(1) }` — the kit's own selected rule restated for a 1-bit
  icon. Retired with `target`.
- **Stale rails** after an in-window drag: accepted; native scrolling still
  reaches the icon.

## After the bump

- `shell/icons.js`: the release listener goes; `dropTargetAt` and the
  filing run from `vf-drop` (with `preventDefault()` on a drop that filed
  elsewhere), the highlight from `vf-drag` onto `target`; the position of
  a drop into a window read off the event's viewport origin.
- `style.css`: the part rule out.
- `docs/SMOKE-TEST.md`: out-of-a-window and window-to-window join the
  drag items; the "slides under a window" sentence goes.
- `tools/drive.mjs`: the filing journey's un-filing half.
- Pin the release in `package.json`; the folders plan's §2.6 and §4 get
  their as-built note.
