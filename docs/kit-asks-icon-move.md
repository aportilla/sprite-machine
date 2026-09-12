# Kit ask #16: a page can move an icon the way a drag moves it

**Status:** SHIPPED in vintage-frames **0.10.0**, the same day, in the
kit's own shape (§As shipped, below): the look is named by the **verb**,
not an option — `vf-icon.dragTo(left, top)` → `Promise<boolean>`,
`vf-icon-field.dragIcons(moves)` → `Promise<void>`, and beside them
`vf-icon.moveTo(left, top)`, the drop's write alone, synchronous. Applied
the same day (§After the bump). Written 2026-09-12 from Clean
Up (docs/clean-up-plan.md), on the user's ask: _"rather than snapping all
the icons all at once... i wonder whether we can do it one at a time with a
very short delay — emulating the classic expierience... as part of each
snap — could we do an animation using the icon border? showing the border
moving from the old position to the new position?"_ — and, on the shape:
_"if we need new kit features, let's detail them no hacks"_ and _"just
describe the shape of how we might declaratively command the transition and
we'll separately do a kit update to support it"_.

The Finder's Clean Up did not teleport a field of icons. It walked them,
one at a time, each icon's **dotted outline** travelling from where it sat
to its cell and the icon landing when the outline arrived — the drag's own
vocabulary, performed by the Finder instead of by the hand. Every piece of
that is already in this kit, and none of it is reachable from a page.

## What the kit has

- **The outline itself** — `deriveDragOutline` (the silhouette from the
  art's alpha united with the plate's rectangle, inset by one pixel, the
  ring the inset removes), `dotOutline` (the 2×2 checker) and `penPhase`
  (the phase taken from where the outline lands on the _screen_, so the
  dots fall between the desktop dither's ink) — all in `src/open-art.ts`.
  **Not reachable**: `package.json`'s `exports` map exposes `.` and
  `./vf-*.js` only, and the package entry re-exports the components, the
  scale helpers and the tokens — not `open-art.js`.
- **`VfIcon.followDrag(surface)`** — seeds the origin, draws this icon's
  outline on the surface and hands back `{ origin, size, move(dx, dy),
drop(dx, dy), end() }`. That handle is precisely the mechanism this ask
  needs, and its own doc comment says **"Internal to the kit's group
  drag."** Calling it from a page is reaching into an internal, which is
  the thing this repository does not do (ask #15's _"we should not be
  hacking around that"_).
- **The drag surface** — the layer in the screen's shadow, over windows and
  the menu bar, clipped at the raster, reached by the
  `vf-drag-surface-request` handshake. Also an internal protocol: the
  icon dispatches it, the nearest `vf-desktop` fills `detail.surface`.
- **A standing rule this ask must respect** — SPEC §1: _"No gradients, no
  border-radius, no CSS transitions — interactions are instant. The single
  sanctioned animation is the classic menu-item blink and the indeterminate
  progress stripes — both suppressed under `prefers-reduced-motion:
reduce`."_ So a travelling outline is a **third** sanctioned animation,
  and it earns that only by being a thing the Finder actually did.

## The ask

Two calls, the second built on the first:

```js
// one icon: its outline travels, the icon lands at the end
await icon.moveTo(left, top, { as: 'drag' });

// a field of them: the Finder's walk, one at a time, in the array's order
await field.moveIcons(
  [
    { icon, left, top },
    /* … */
  ],
  { as: 'drag' }
);
```

- **`as: 'drag'` is the only knob, and it names a _look_, not a number.**
  "Move it the way a drag moves it": the kit's own outline, the kit's own
  cadence — the beat between one landing and the next included — the kit's
  own `prefers-reduced-motion` behavior. No `duration`, no `easing`, no
  `stagger`. The drag outline's own section in SPEC §5 ends _"One drag, no
  opt-in… the kit ships no taste knobs"_, and this should ship none either:
  a page that could pick 400ms and an ease-out curve would be writing
  something that was never on a Mac.
- **Omitted, it is today's write.** `moveTo(left, top)` with no options
  places instantly, exactly as `icon.left = …; icon.top = …` does now — so
  the addition is additive and the name stays honest.
- **The landing is the placement the drop writes**: through
  `PlacementController`, whole system px on the placement lattice, clamped
  whole against the container the way a drop's default action clamps, and
  announced as one `vf-placement-change` per icon — so a `vf-scroll-area`
  re-measures and a page that persists positions reads them off the
  properties as it always did.
- **Completion is a promise.** A walk is a sequence, and `await` is what a
  sequence reads like. (An event would do — `vf-move-end` — but the page
  that asked for the move is the page that wants to know, so the promise is
  the smaller surface.) The field-level call resolves when the last icon
  lands.
- **Interruption is the kit's, not a parameter.** A press in the field, or
  Escape, **finishes** the outstanding walk at once: every remaining icon
  placed at its target, outlines down, promises resolved — the Finder never
  made you wait for it. A second call finishes the first the same way. An
  icon disconnected mid-walk is skipped, not thrown for.
- **Reduced motion** places every icon at once with no outline and resolves
  — the blink's own posture.
- **Order is the page's, cadence is the kit's.** `moveIcons` walks the
  array in the order given, because which icon goes first is a statement
  about the page's lattice (this app's desktop fills a column down the
  right edge, a window fills rows) and the kit ships no lattice. How long a
  beat separates them is a statement about System 7, which is the kit's.

### Is declarative the right way for this? — no, and partly yes

The user asked directly. The split worth making is **what** versus **how**:

- **How** should be declarative, and is: `as: 'drag'` is the whole of it.
  The page never names a duration, a curve, a pen or a phase — the same
  trade as `origin="bottom right"` or `fixed`, where the page declares
  intent and the kit owns pixels.
- **What** should not be a declaration on the element. An attribute —
  `<vf-icon animate-moves>` — would make travelling a property of the
  _icon_, and that claim is false most of the time. In this app alone the
  same icon must jump instantly for the boot placement, for the nine-slice
  re-pin on every browser resize, for a filing's landing, for a paste's
  arrival and for a restored session, and must travel for exactly one
  command. The kit would be animating four writes that must not animate,
  and the page would be toggling the attribute around each of them — a
  declaration whose value is `true` only for the duration of a call is an
  imperative call wearing a costume.
- The kit has already drawn this line once, one component over.
  `setSelected()` exists because _"a `selected` write from code is silent…
  this is the route for a gesture a container runs on the icon's behalf"_.
  Clean Up is a gesture the page runs on the icon's behalf. It belongs
  where that already goes: a method, on the icon, with the look declared in
  the call.
- And a sequence needs a completion signal. An attribute has none; adding
  `vf-move-end` to carry it lands back at a method call with extra steps.

So: **a method whose argument is a declaration.** Imperative about the act,
declarative about the look.

### If the kit wants a smaller shape

`vf-icon.moveTo` alone is enough to build on — the page can `await` one
icon at a time itself. The cost is that the **beat** then lives in the app
as a number someone chose, which is the kind of taste knob the kit
otherwise keeps; hence `vf-icon-field.moveIcons` as the ask proper. If only
one of the two ships, ship the field's.

## In the app meanwhile (until 0.10.0)

**Nothing, and deliberately.** Clean Up (Special → Clean Up Window / Clean
Up Desktop) landed every icon at once, through the icon layer's own
`place()`. The app did not:

- reach for `followDrag` or the surface handshake — internals, and the
  standing call on that is ask #15's;
- draw its own dotted outline on a canvas — that is the kit's art
  (`open-art.ts`), and an app-side copy would be a plain rectangle with a
  hand-rolled XOR pen that drifts from the kit's the first time either
  changes;
- ship its own `setTimeout` walk without the outline. Half the effect with
  none of the reason for it, and the beat would be an app number the kit is
  about to own. The instant snap is a smaller thing to replace.

No test, in either direction: the motion is the kit's mechanic and the look
is verified by eye (`docs/TESTING.md`).

## As shipped (0.10.0)

Everything the ask argued for, with the one knob folded into the name:

- **`vf-icon-field.dragIcons(moves)`** → `Promise<void>` — the walk, the
  `{ icon, left, top }` moves in the page's order, each through the icon's
  `dragTo`, `WALK_BEAT_MS` (50) after every landing that showed. A landing
  that showed nothing (already there, reduced motion, gone from the DOM)
  takes no beat, so a tidy field resolves at once. One walk per field: a
  second call finishes the first — **synchronously**, every icon still to go
  landed through `moveTo` before the new walk starts. A document
  `pointerdown` or Escape finishes it; so does the field leaving the DOM.
  The icons are the page's list, not checked against the field's own.
- **`vf-icon.dragTo(left, top)`** → `Promise<boolean>` — the landing
  resolved first (the pair `moveTo` would write, clamped and snapped), so the
  outline goes where the icon will land; the outline built as a drag's is,
  on the desktop's surface; stepped by `runOutlineTravel` in whole steps of
  `WALK_STEP_PX` (16) every `WALK_STEP_MS` (25) — a constant _speed_ rather
  than a frame count, so a one-pixel correction doesn't crawl, and a timer
  chain rather than `requestAnimationFrame`, so 120 Hz doesn't double it —
  then the outline down and the icon written. Resolves to whether the
  outline travelled. No drag event (the page is the mover), and not gated on
  `movable`.
- **`vf-icon.moveTo(left, top)`** — the drop's write alone: clamped whole in
  the container measured now, snapped, one `vf-placement-change`. A
  `left`/`top` property write stays the authored, unclamped pair — the
  `selected` / `setSelected()` line the ask pointed at.
- **The rule of the kit changed with it**: SPEC §1 now names the walk as the
  third sanctioned animation, suppressed under `prefers-reduced-motion`
  with the other two. The three cadence numbers are exported
  (`WALK_STEP_PX`, `WALK_STEP_MS`, `WALK_BEAT_MS`) and "set by eye against
  the Finder and asserted nowhere".

Where it differs from the ask: `as: 'drag'` became the verb — `dragTo`
beside `moveTo`, `dragIcons` for `moveIcons` — so the look is still named
and still never a number, just by the method rather than an option. And
the ask's "smaller shape" note is moot: both shipped.

Also in 0.10.0, not asked for here: a drop's default action in a box that
**scrolls** now holds only the origin (an icon may be dropped below a
window's fold). It does not reach this app's folder windows: the kit's walk
from the icon stops at its positioning parent, and a folder window's field
is a placed box between the icon and the scroll area, so its icons keep the
whole clamp.

## After the bump

`apps/finder/icons.js`'s `cleanUp(folder)` lost its `place()` loop for one
call — the assignment unchanged, only the write:

```js
const grid = gridFor(folder);
const cells = cleanUpOnto(grid, icons.map(posOf));
const moves = icons
  .map((icon, i) => ({ icon, ...cells[i] }))
  .sort((a, b) => fillOrder(grid, a, b)); // the container's own fill order
await root.dragIcons(moves);
if (folder != null) folders.fit(folder);
```

- **The cells go over as they are.** The kit resolves each landing as a
  drop's — clamped whole in the container, snapped — before the outline
  sets off, so the app does neither. (A first cut ran the targets through
  the icon layer's own clamp-and-snap first; the user caught it as a
  replica of the kit's — _"i don't want to replicate kit built ins"_ — and
  it went.) The one rule the kit cannot know, never above the menu bar, is
  the lattice's by construction: its first row starts below the bar.
- **What stays the page's is which cell.** `cleanUp(grid, positions)`
  (`apps/finder/layout.js`) is the nearest-free-cell assignment on this
  app's lattice; the kit ships no lattice and takes the targets it is
  handed, so that arithmetic is the half it leaves to the page, not a copy
  of anything in it.
- **No filter for icons already in place**: the kit gives them no beat.
- **`fillOrder`** is the one new pure export (`apps/finder/layout.js`):
  down the desktop's right-edge column and on leftward, across a window's
  rows.
- **A browser resize finishes the walk first**: `repinIcons` calls
  `desktopField.dragIcons([])` — the documented "a second call finishes the
  first", which lands the rest synchronously — so the nine-slice pins are
  read from where the icons are, not from a walk half done.
- **The snapshot is told when the walk lands.** The desktop state wrote on
  the menu pick's `pointerup`, debounced 400ms — mid-walk — and nothing
  moved it again until the next gesture or exit. The icon layer's `onMoved`
  fires when the walk resolves, through the Finder's actions to
  `desktop-state.start({ onMoved })`, which schedules one more write.
