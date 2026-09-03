# Kit asks #7–#9: the scroll rail on a raised, horizontal, bouncing windoid

**Status:** SHIPPED in vintage-frames **0.6.0** — #7 as asked
(`ScrollRailController.hostConnected` re-wires and re-syncs on a
reconnect); #8 by sizing the scrolled plane to its content rather than
observing the slotted elements (and a public `vf-scroll-area.measure()`
for a scroll range that changes with no box changing); #9 as asked
(`.vf-scroll { overscroll-behavior: none }` in the rail recipe, chaining
restored per part on pages that scroll). Applied here 2026-09-03 —
[upgrade-vintage-frames-0.6.0.md](upgrade-vintage-frames-0.6.0.md); no
app change for any of the three, as the section at the end predicted. ·
Written 2026-09-02 against vintage-frames **0.5.6**
(the installed package and the kit repo at `~/MyProjects/vintage-frames`
match), from three behaviors the user saw in the **3D Sprite Atlas**
windoid (`#win-ring` — `vf-window variant="utility" movable resizable
scrollbars="horizontal" flush`, the body `<sm-ring-view>`; see
[the ring-size plan](ring-size-plan.md)). No app-side bridge was written:
every one of them is the kit's, and the app never bridges kit mechanics
(README § Windows — the utility-windoid bullet; the tests-cover-the-app
rule in `tools/drive.mjs`). The diagnosis is by reading the 0.5.6 source,
not by probing a browser; each ask names the file and lines it rests on
and the one place a DevTools glance confirms it. The atlas windoid is the
kit's first **horizontal-axis** scroll consumer and the first scroller
that gets **re-inserted by a raise**, which is why all three surfaced at
once. Kit asks #5 (icon selection vs. a chrome press) and #6 (the pattern
token leak) are the two still open before these.

The three, in one line each:

1. **#7 — the rail controller does not survive a reconnect.** The desktop's
   DOM-order sync re-inserts a raised windoid's node; `ScrollRailController`
   has no `hostConnected`, so it comes back with no scroll listener and no
   ResizeObserver, and the `data-degenerate="rail"` it wrote while the
   window was hidden stays on the rail. _Symptom:_ the first open shows a
   bare white rail, no arrows; a grow-box **shrink** revives it.
2. **#8 — the content ResizeObserver watches a block wrapper.** Both scroll
   controllers observe `.content`, whose inline-axis box is the viewport's
   whatever the slotted content's width; a row growing wider fires nothing.
   _Symptom:_ stepping `views` 12 → 13 while scrolled leaves the thumb
   where it was until a drag; the thumb then jumps and the pointer's grab
   offset is off by the stale amount. The same miss leaves
   `data-overflow-x` stale, so the idle → live flip is missed too.
3. **#9 — `.vf-scroll` wants `overscroll-behavior: none`.** A wheel past the
   row's end rubber-bands the scroller's whole content layer, the app's
   sticky controls strip included; System 7 never bounced, and the rail
   already clamps the thumb to the track.

---

## #7 — `ScrollRailController` dies on the desktop's re-insert

### What the user sees

Open the atlas (View → 3D Sprite Atlas). The bottom edge is a bare white
rail: no arrow cells, no trough, no thumb. Drag the grow box **inward** so
the row overflows and the whole rail appears at once. Dragging it
**outward** would not have.

### The chain, in the 0.5.6 source

1. **Hidden, the rail measures degenerate.** The windoid boots `hidden`
   (`shell/windows.js` `syncUtility`, `prefs.showRing` off every load).
   `ScrollRailController.sync()` (`src/scroll-rail.ts` 175–246) reads the
   track's `getBoundingClientRect()` — all zeros under `display: none` —
   and the decision table at 196–200 writes `data-degenerate="rail"` on
   the rail, which the recipe (`src/styles/recipes/scroll-rail.ts`
   273–276) answers by hiding the trough **and the arrow cells**. Correct
   for a hidden window; the next `sync()` would clear it.
2. **The show raises, and the raise moves the node.** `syncUtility` sets
   `hidden = false` and calls `desktop.bringToFront(ring)` in the same
   tick (`shell/windows.js` 382–391). `bringToFront` restacks and calls
   `_requestDomSync` (`src/components/vf-desktop.ts` 473–476, 520–527): a
   `setTimeout(…, 0)` task running `_syncDomOrder` (750–781), which
   `insertBefore`s any window that stacks above a DOM-later one. The ring
   is declared **before** the Tools palette in `index.html` (225 vs. 237)
   and before every document window the reconciler appends, and the raise
   just gave it the utility band's top z — so the **first show always
   moves it**. (The same task is the one 0.5.4 introduced for the click's
   sake — README § Windows.)
3. **The move disconnects the scroll area's controllers, and only one
   re-wires.** Moving `vf-window` disconnects and reconnects its shadow
   tree, `vf-scroll-area` included. `ScrollStateController` re-wires in
   `hostConnected` (`src/scroll-state.ts` 106–116 → `wire()` 134–149).
   `ScrollRailController` has **no `hostConnected`**: it wires in
   `hostUpdated` alone (`src/scroll-rail.ts` 133–136) and `unwire()`s in
   `hostDisconnected` (138–142, 160–165). And Lit schedules **no update on
   a reconnect** — `ReactiveElement.connectedCallback` calls
   `enableUpdating(true)`, a no-op after the first update
   (`@lit/reactive-element` `reactive-element.js` 575–588). So the rail
   controller comes back with no `scroll` listener and no ResizeObserver,
   and `data-degenerate="rail"` stays.
4. **It revives only on an overflow flip.** The one thing that re-renders
   `vf-scroll-area` is its `_scrollable` state
   (`src/components/vf-scroll-area.ts` 91–98, 107), written by
   `ScrollStateController`'s `onOverflowChange` **only when the measured
   overflow changes**. The re-wired state controller's `observe()` fires an
   initial entry on the shown box and `measure()`s — but at the placement's
   seeded width the four default cells **fit** (`ringWidthFor(4, 64)`;
   the drive pins `scrollW <= clientW` right after the show), so
   `data-overflow-x` stays `"false"`, nothing changes, no update, no
   re-wire. A grow-box shrink makes the row overflow → `_scrollable` flips
   → `hostUpdated` → `wire()` + `sync()` → the rail is whole. A grow leaves
   it dead.

The one assumption: the 0 ms task lands **before** the next frame delivers
the show's ResizeObserver entries. The other order would draw the arrows
and then lose wheel tracking (the controller still dies at the move) —
not what was seen.

### Confirm in DevTools

Right after the first show:

```
#win-ring → shadow → vf-scroll-area → shadow → .vf-rail--horizontal[data-degenerate="rail"]
```

Then a raise of any other windoid over it, and a click back: still
present — nothing re-syncs until the overflow flips.

### The ask

`ScrollRailController` gets the `hostConnected` its sibling has:

```ts
hostConnected(): void {
  this.wire()
  this.sync()
}
```

`wire()` already compares against `this.scroller` (null after `unwire()`),
so a reconnect re-attaches; `observe()`'s initial delivery then re-syncs
on the shown box and clears the degenerate state by itself (the `sync()`
at connect covers a node moved while visible). Worth a kit test: a
scroll area inside a `vf-window` that the desktop moves — `bringToFront`
on a background window, the task flushed — keeps its thumb following
`scrollLeft` writes and its degenerate state tracking `hidden`.

---

## #8 — the content ResizeObserver misses horizontal growth

### What the user sees

Twelve tiles, the row overflowing, scrolled halfway. Step `views` to 13.
A tile is added off the right edge, the true scroll fraction drops, and
the thumb does not move. Press the thumb and drag: it jumps to the true
position, and the pointer is no longer where it grabbed it.

### The chain

1. **Three signals repaint the thumb** (`src/scroll-rail.ts` 145–167): the
   scroller's `scroll` event, a ResizeObserver on the scroller, and the
   same observer on `getContent()`. `vf-scroll-area` passes its `.content`
   div for both controllers (`src/components/vf-scroll-area.ts` 91–104,
   rendered at 231).
2. **`.content` is a block wrapper** (`position: relative`, 202–204). A
   block's used width is its containing block's — the viewport's — no
   matter how wide the slotted row is; its height is one row. Adding a
   13th cell changes neither box. `scrollLeft` is unchanged, so no scroll
   event either. Nothing fires; the thumb keeps the old fraction.
3. **The drag exposes it.** `onPointerDown` records the true `scrollLeft`
   as `startScroll` (280–292); the first `onPointerMove` writes
   `startScroll + delta` (354–358); the scroll event's `sync()` repaints
   the thumb at the true position; the grab offset is now wrong by the
   stale amount. The misalignment is a consequence, not a second bug.
4. **The same observer drives `data-overflow-x`.** `ScrollStateController`
   (`src/scroll-state.ts` 134–149, 201–215) `measure()`s on the same two
   boxes, so a row that outgrows the window through the stepper — the
   drive's own scenario at `tools/drive.mjs` 2739–2758, which reads the
   viewport's `scrollWidth` against `clientWidth` and deliberately not the
   rail — leaves the attribute `"false"`: the wheel scrolls the row, but
   the trough and thumb stay hidden and the arrows stay inert (the press
   guard at `src/scroll-rail.ts` 262–264) until some other measure runs.
   The vertical axis never showed either half: taller content changes the
   wrapper's **height**.

### Confirm in DevTools

With the row overflowing and the rail live, step `views` up: the
viewport's `scrollWidth` grows, `.vf-rail-thumb`'s `translate` does not.
With the row fitting, step until it overflows: `data-overflow-x` on
`[part="viewport"]` stays `"false"` while `scrollWidth > clientWidth`.

### The ask

Observe the **slotted content**, not the wrapper: on `slotchange`, observe
each of the slot's `assignedElements({ flatten: true })` with the same
ResizeObserver, in both `ScrollStateController` and `ScrollRailController`
(a shared helper, or `getContent` returning the list). A consumer's host
sized to its content — `<sm-ring-view>` is `width: max-content` — then
reports every width change. Not `width: max-content` on `.content` itself:
that unwraps every paragraph in every scroll area. Optionally, a public
`sync()` / `measure()` on `vf-scroll-area`, forwarded by `vf-window`, for
content that changes `scrollWidth` with no box change anywhere (the
`<textarea>` case the controllers already handle internally). Document
the contract: the scroll area tracks its slotted elements' boxes.

---

## #9 — `.vf-scroll { overscroll-behavior: none }`

### What the user sees

Wheel to the row's end. The content rubber-bands — and the controls strip
(views / elev / from / size) moves with the tiles instead of holding at
the left.

### The chain

`vf-window[scrollbars]` renders the **whole default slot** inside the
built-in scroll area (`src/components/vf-window.ts` 827–839), so the
strip is scroller content by construction. The app pins its field group
with `position: sticky; left: 0` (`src/components/sm-ring-view.js`
106–108), which holds it at the viewport's left only for scroll positions
at or past zero and inside its containing block. A bounce is the engine
translating the scroller's content layer **past** its bounds, and a
sticky child rides along; no app-side layout keeps anything inside that
scroller still during a bounce.

### The ask

The `vfScrollRail` recipe (`src/styles/recipes/scroll-rail.ts` 84–89,
where the native bar is already hidden) adds:

```css
.vf-scroll {
  overscroll-behavior: none;
}
```

`none`, not `contain`: `contain` stops scroll chaining but keeps the
bounce. The case for the kit owning it: System 7 never rubber-banded, and
the rail's thumb is already clamped to its track (`src/scroll-rail.ts`
208–217), so a bounce moves content the rail cannot express. The trade:
it also cuts scroll chaining out of every kit scroller, which on a desktop
that does not scroll costs nothing. The other way out — the tiles bounce
and the strip does not — needs a **non-scrolling header slot** on
`vf-window`, the status strip's mirror on the top edge; a real feature,
not asked for here. (It shipped in **0.6.1** all the same, beside kit ask
#10's `fixed` — [kit-asks-fixed-child.md](kit-asks-fixed-child.md) — and
the atlas strip lives in it now.)

**The app-side bridge, if wanted before the release** (the viewport part
is exported through `vf-window`, 835): one rule in `src/style.css`,

```css
vf-window#win-ring::part(viewport) {
  overscroll-behavior-x: none;
}
```

— to be deleted the day the recipe carries it.

---

## After the bump

- **Nothing to change in the app** for #7 and #8, and no bridge worth
  writing meanwhile: reaching the scroll area means dispatching synthetic
  events through the window's shadow root.
- **Nothing to change in the checks**: the drive's atlas section reads the
  viewport's `scrollWidth` / `clientWidth` — the app's overflow, not the
  kit's rail state — by the tests-cover-the-app rule, and stays that way.
- **Verify by eye** (the smoke-test idiom): the first show of the atlas
  draws the arrow cells; a `views` step while scrolled moves the thumb and
  a step that makes the row overflow brings the trough and thumb up
  without a resize; the wheel at the row's end moves nothing.
- Pin the release in `package.json` and note it in the ring-size plan's
  as-built header, the way 0.5.5 and 0.5.6 are.
