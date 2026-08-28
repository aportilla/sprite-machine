# Plan: the Selection tool (MacPaint's selection rectangle)

**Status:** implemented 2026-08-27 as planned (§6 steps 1–5 and the §7 doc
ritual; the defaults in §9 all kept; `npm test` 303, `drive.mjs` 225, the two
`?select` captures `cmp` byte-identical) · **Date:** 2026-08-27 (reviewed
against the code the same day; corrections folded in — the Esc guards, the
empty-float short-circuit, the cursor-claim mechanism, per-window Esc) ·
**Depends on:** nothing outside this repo (no kit change — see §3D)

A sixth sticky tool, **Selection** (`S`): drag a box out on the pixel canvas and
it takes MacPaint's **marching-ants** border; drag _inside_ that box and the
selected pixels **move** with the pointer, leaving transparency behind. Click
outside, press Esc, or pick another tool and the selection **drops** where it
sits. **Transparent texels inside the selection are not "pixels" and never
move** — a moved selection overwrites the destination only where the selection
is painted, so art under the selection's empty texels shows through untouched.
Every move is one undo step.

This document is written to be picked up cold: it names every file, seam,
signature and gate. Read it top to bottom once, then work §6 in order. Where it
references a line number that is "at the time of writing" — re-find by the
named method; the names are stable.

> **Before you start:** run `git status`. At the time of writing the working
> tree carries an unrelated uncommitted About-box tweak (`index.html`,
> `package.json`'s kit bump to vintage-frames 0.5.2). Don't fold it into this
> feature's commit; commit or stash it first. It is not doc-neutral either:
> it changes the box's `height` (238 → 198) and sets the blurb in the body
> face, both of which the README's About-box section (`464×238`, "the same
> Chicago") and the markup's arithmetic comment record — committing it means
> its own README + comment follow-up, not just a stash.

---

## 1. Locked decisions

1. **Rectangle only.** MacPaint's lasso (auto-shrink to the shape) is a
   follow-up (§8). The transparency rule below already gives the rectangle the
   lasso's most useful property.
2. **Transparency never moves.** The selection's transparent texels leave the
   destination's own art visible; its opaque texels overwrite. Moving a
   selection off its origin leaves the origin **transparent** (the sprite's
   "white" is transparency — there is no paper color).
3. **One move gesture = one undo step**, through the canvas's existing
   `sm-commit {before, after}` bracket. A marquee drag is not an undo step
   (it writes nothing).
4. **The selection is canvas state and dies with the working buffer.** Any
   structural change to the face — undo/redo, a face switch, a tile resize, an
   all-faces replace, a document load — drops it (the pixels it moved are
   already in the document; nothing is lost). MacPaint kept a selection
   through Undo; we deliberately don't (§3F says why).
5. **A click is not a selection.** Pointer down and up on the same texel with
   no drag makes no selection — that is also what "click outside to deselect"
   means. The smallest selection is therefore 1×2 / 2×1.
6. **Primary button only.** A right-click does nothing with this tool (no
   momentary erase — there is nothing to erase _with_). Alt-click still
   samples (the momentary eyedropper works with every tool, unchanged) —
   which includes its existing rule that **sampling empty space selects the
   eraser** (`sm-editor.js`'s `sm-pick-transparent` → `setTool('eraser')`):
   that is a tool change, so an Alt-click on emptiness DROPS the selection.
   A painted sample leaves Selection selected and the selection up.
7. **Shift while moving constrains to one axis** (MacPaint's rule): the
   dominant axis of the drag wins, the other zeroes; toggleable mid-drag.
   Shift during the marquee-out does nothing.
8. **Dragging off the tile clips.** The float can be pushed partly off the
   canvas (the pointer's grab texel is clamped to the tile, so it can never
   leave entirely); what's off-tile at drop time is gone, exactly as
   MacPaint lost what you dragged off the page. Undo brings it back (the
   gesture's `before` had it).
9. **Where it goes:** first cell of the Tools palette's strip and first item
   of the Tools menu — MacPaint's palette led with the selection tools.
   (Decision **A** in §9 if you'd rather append it.)
10. **A selection belongs to its window.** Every document window's canvas can
    hold one; switching windows leaves it up (ants and all). The tool is
    app-level, so a tool switch drops EVERY window's selection — but the
    no-drag Esc acts on the ACTIVE window's only (§3C keys: `sm-editor`
    tells its canvas whether it's active). Without that, every open window's
    `document`-level key handler would answer one Esc.

---

## 2. How it fits: the seams that already exist

| Need                                       | Exists as                                                                                                       | Where                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| The sticky tool mode                       | `session.tool` (`setTool`), the one truth the strip / menu / keys write                                         | `src/state/session.js`                                                 |
| A palette cell that picks on the press     | `cell(name, glyph, title, active, tool)` in the strip                                                           | `src/components/sm-tool-strip.js`                                      |
| The Tools menu item + checkmark + gating   | `#menu-tools` markup; `toolItems` sync + `DOC_SCOPED` gate                                                      | `index.html` L70–76; `src/shell/menus.js` ~L570–622                    |
| The bare-letter key                        | the `{ b, r, g, e, i }` map                                                                                     | `src/shortcuts.js`                                                     |
| The options strip (nothing to show)        | `sm-tool-options.render()` returns `nothing` for an unknown tool                                                | `src/components/sm-tool-options.js`                                    |
| The pixel buffer + gesture plumbing        | `#work` / `#imgData` (by reference), `#beginGesture` / `#endGesture`, `#commitPixels`, `#toTexelClamped`        | `src/components/sm-draw-canvas.js`                                     |
| Pointer capture + cancel idiom             | the rect tool's `#rectDragging` / `#rectPointer` / `#cancelRect`                                                | `sm-draw-canvas.js` ~L916–931, ~L815–830                               |
| The gesture-scoped keys (Esc, Shift, B/R…) | `#onKeyDown` / `#onKeyUp` on `document`                                                                         | `sm-draw-canvas.js` ~L619–652                                          |
| Undo per gesture                           | `sm-commit` → `ctx.history.pushTile(face, before, after)`                                                       | `src/components/sm-editor.js` `#onCommit`; `src/state/history.js`      |
| Live pixels → sheet → mesh + Sprite View   | `sm-live` → `doc.applyTileEdit(face, tile)` (rAF-coalesced blit)                                                | `sm-editor.js` `#onLive`; `src/state/doc.js`                           |
| System-px overlay painters                 | `draw-overlays.js` (`haloBox` alignment, `OverlayView`)                                                         | `src/components/draw-overlays.js`                                      |
| Hard-pixel write primitives                | `writeTexel` (a=0 or 255), `keyAt` / `writeKey`                                                                 | `src/lib/brush.js`, `src/lib/fill.js`                                  |
| The kit's page-drawn cursor kinds          | `data-vf-cursor` claims — `arrow` / `text` / `crosshair` / `wait` — resolved by hit-test per pointer move (§3E) | `vintage-frames/src/cursor.ts` header                                  |
| Reduced-motion query                       | `prefersReducedMotion()` (exported from `vintage-frames`)                                                       | `vintage-frames/src/motion.ts`                                         |
| Capture dev hooks                          | `parseBootParams` → `bootHooks` → `ctx.hooks` → one-shot canvas props                                           | `src/boot/params.js`, `src/main.js`, `sm-editor.js`, `#applyDrawHooks` |
| Trusted-input regression                   | `tools/drive.mjs` (`drag`, `texelAt`, `layerIsEmpty`, `probe()`)                                                | `tools/drive.mjs` ~L228–540                                            |

Nothing in the voxel pipeline, the doc slice, the history slice, the workspace
or the shell changes. The feature is a new pure module, a new overlay painter,
a new gesture branch in the canvas, and the registration ritual every tool
went through.

---

## 3. Design

### 3A. The selection model (why "base + float", not "move the bytes")

A floating selection is three things, all private fields of `<sm-draw-canvas>`:

```
#sel        {x0,y0,x1,y1} | null   the marquee in TILE texels, inclusive — the LIFT
                                   ORIGIN; never translated in place
#selFloat   {width,height,data,    the selected texels, lifted out ONCE (a copy),
             opaque} | null        with their OPAQUE count; null until the first move press
#selBase    Uint8ClampedArray      #work with the selection's rect cleared to
            | null                 transparent — "the hole"; null until the lift
#selOffset  {dx,dy}                the float's displacement from #sel (0,0 at rest)
```

The working buffer is **derived** whenever the offset changes:

```
#work ← #selBase, then every OPAQUE texel of #selFloat stamped at
        (#sel.x0 + dx, #sel.y0 + dy), clipped to the tile
```

`#work` is written **in place** (`#work.set(base)` then the stamp), so its
identity — which `doc.applyTileEdit` stores by reference into `views[face]` and
`#imgData` views — never changes. This is the whole reason the design works
with the two-speed state system untouched.

Why not just shift the bytes inside `#work` on each pointer move? Because the
second move would re-lift from a buffer that already contains the float
stamped over other art, and dragging a selection across the sprite and back
would smear whatever it crossed. Keeping `#selBase` pristine for the
selection's whole lifetime makes every offset a pure function of
(base, float, offset): drag anywhere, come back, and the art under the path is
exactly what it was. It also makes the transparency rule (decision 2) a
one-line `if (a === 0) continue` in the stamp.

Costs: two extra buffers the size of the tile (≤16 KB each at tile 64), one
`set` + one stamp per pointer move. Nothing.

The **current** selection rectangle (what the ants draw and what "inside"
hit-tests against) is `#sel` translated by `#selOffset`; it may hang off the
tile — the overlay canvas clips it.

### 3B. Pure primitives — `src/lib/select.js` (new, Node-tested)

Same discipline as `rect.js` / `fill.js`: integer geometry over bare RGBA
buffers, no DOM, so the canvas and the tests share one source of truth.

```js
/** Two texel corners → inclusive bounds, top-left → bottom-right. */
export function normalizeBounds(a, b) → {x0,y0,x1,y1}

/** Whether texel (px,py) lies inside inclusive bounds. */
export function boundsContain(b, px, py) → boolean

/** Bounds shifted by (dx,dy) — may leave the tile; nobody clamps this. */
export function translateBounds(b, dx, dy) → {x0,y0,x1,y1}

/** Shift's axis lock for a move delta: the dominant axis keeps its value, the
 *  other zeroes. A tie (|dx| === |dy|) keeps dx (horizontal wins). */
export function constrainAxis(dx, dy) → {dx,dy}

/** Copy the rect out of a w×h RGBA buffer as its own tile, counting its
 *  OPAQUE texels (alpha ≠ 0): `opaque` 0 means the float is nothing but
 *  transparency and no move can ever change a byte — §3C's short-circuit.
 *  Bounds MUST lie inside the tile (the marquee is clamped at drag time). */
export function liftRect(data, w, b) → {width,height,data,opaque}

/** Write transparency over the rect, in place (hard pixel: all four bytes 0,
 *  via fill.js writeKey / the transparent key). Returns whether any byte
 *  changed — an already-transparent rect reports false. */
export function clearRect(data, w, b) → boolean

/** Composite: out ← base, then every OPAQUE (alpha ≠ 0) texel of `float`
 *  lands at (ox + x, oy + y) when that lies inside the w×h tile; transparent
 *  float texels are SKIPPED (the rule — the base shows through), off-tile
 *  texels are dropped (clipped per texel, never wrapped to the next row).
 *  `out` and `base` may be the same buffer only if you don't need base
 *  afterward — the canvas always passes #work / #selBase, distinct. */
export function compositeFloat(out, base, w, h, float, ox, oy) → void
```

`(ox, oy)` is `(sel.x0 + offset.dx, sel.y0 + offset.dy)`. Keep `w`/`h` as
explicit parameters (not derived from `data.length`) — `liftRect` and
`clearRect` need only `w` for indexing, `compositeFloat` needs both to clip.

### 3C. The gesture state machine (inside `<sm-draw-canvas>`)

Five states, all in private fields; every transition below is exhaustive.

```
idle        tool=select, #sel null
marquee     dragging the box out       (#selDrag === 'marquee', pointer captured)
selected    #sel set, #selFloat null   (never moved)
floating    #sel set, #selFloat set    (moved at least once; offset may be 0,0)
moving      dragging the float         (#selDrag === 'move', pointer captured)
```

Additional drag fields:

```
#selDrag          null | 'marquee' | 'move'
#selAnchor        marquee: the anchor texel · move: the grab texel
#selOffsetAtGrab  move: #selOffset when the press landed (Esc / cancel revert to it)
#selLast          move: the last pointer texel (Shift pressed with the pointer still
                  re-derives the offset from it — the rect tool's #rectEnd idiom)
#selPointer       the captured pointerId (release on every exit path)
```

**Pointer down** (`#onPointerDown`, after the eyedropper / Alt branch, before
the fill branch):

- `e.button !== 0` → return (decision 6).
- `#selDrag` already set → return (one pointer owns a drag; the rect's rule).
- `#sel && boundsContain(currentRect, t)` → **start move**: if `#selFloat` is
  null, **lift**: `#selFloat = liftRect(#work, tileW, #sel)`,
  `#selBase = #work.slice()`, `clearRect(#selBase, tileW, #sel)`. Then
  `#beginGesture()` (the undo `before` = `#work` as it is now — the composite
  at the current offset, or the untouched art), `#selAnchor = t`,
  `#selOffsetAtGrab = {...#selOffset}`, `#selLast = t`, capture the pointer,
  `#selDrag = 'move'`, cursor claim → `arrow`.
- otherwise → `#dropSelection()` (a silent forget — see below), then **start
  marquee**: `#selAnchor = t`, `#sel = {x0:t.px, y0:t.py, x1:t.px, y1:t.py}`,
  `#selOffset = {0,0}`, `#selDrag = 'marquee'`, capture the pointer, start the
  ants (§3D). `#drawAnts()` draws NOTHING while a marquee is still the anchor
  texel alone (`#selDrag === 'marquee'` and the box is 1×1), so a plain click
  never flashes a one-texel box (decision 5); the ants appear the moment the
  moving corner leaves the anchor.

**Pointer move** (`#onPointerMove`, checked before the rect / hover paths):

- `#selDrag === 'marquee'` and `e.pointerId === #selPointer`:
  `#sel = normalizeBounds(#selAnchor, #toTexelClamped(e))`; `#drawAnts()`.
- `#selDrag === 'move'` and the owner: `t = #toTexelClamped(e)`;
  `#selLast = t`; `#applyMove(t, e.shiftKey)`:

  ```
  let d = { dx: t.px - anchor.px, dy: t.py - anchor.py }
  if (shift) d = constrainAxis(d.dx, d.dy)
  const next = { dx: grab.dx + d.dx, dy: grab.dy + d.dy }
  if (next equals #selOffset) return              // no churn on a same-texel move
  #selOffset = next
  if (#selFloat.opaque > 0) {                      // an empty float moves only its marquee
    compositeFloat(#work, #selBase, tileW, tileH, #selFloat, sel.x0 + next.dx, sel.y0 + next.dy)
    #commitPixels()                                // dirty + changed + repaint + sm-live
  }
  #drawAnts()
  ```

  The `opaque` guard is what makes §3G true: an all-transparent float (a
  derived face, a marquee over empty space) can never change a byte, so it
  must not composite, dirty the buffer, fire `sm-live` or trigger a rebuild
  per pointer move — without the guard every move of an empty float would
  blit and carve for nothing, and on a derived face flip `dirty` for a buffer
  that never changed.

- no drag, `tool === 'select'`: update the **cursor claim** (§3E) from
  `boundsContain(currentRect, t)`; fall through to `#drawCursor(t)` as today
  (for this tool it just clears the cursor layer — the ants live on their own
  layer, so this is harmless).

**Pointer up** (owner only):

- marquee: `end = #toTexelClamped(e)`. If `end` is the anchor texel (decision
  5): `#sel = null`, stop the ants, clear the ants layer → **idle**. Else
  `#sel = normalizeBounds(anchor, end)` → **selected** (ants keep marching).
  Release the capture, `#selDrag = null`.
- move: `#endGesture()` (emits `sm-commit` iff a byte changed — a drag that
  returned exactly to its start emits nothing, and `history.pushTile` drops
  an identical pair anyway), release the capture, `#selDrag = null` →
  **floating**. The selection stays up; a second drag inside starts from the
  new offset with the same `#selBase` / `#selFloat`.

**Pointer cancel** (owner only) and **Esc mid-drag**:

- marquee → `#cancelMarquee()`: as the click case (no selection), release.
- move → `#cancelMove()`: `#selOffset = #selOffsetAtGrab`; if the float has
  opaque texels, re-composite and `#repaint(); #notifyLive();` (the live
  channel must see the bytes go back — but NOT through `#commitPixels`, which
  would mark the gesture changed); then
  `#gestureBefore = null; #gestureChanged = false;` (no undo entry, the
  `#cancelRect` idiom), release the capture, `#drawAnts()`. The selection
  stays **floating** at its pre-drag offset.

**Esc with no drag in flight** and `#sel` set → `#dropSelection()` — under
the selection-up guards in **Keys** below (active window, no modal, not in
a field), and without `preventDefault`.

**`#dropSelection()`** — the one exit: cancel any in-flight drag first (the
two cancels above), then `#sel = #selFloat = #selBase = null`,
`#selOffset = {0,0}`, stop the ants, clear the ants layer, cursor claim →
`crosshair`. It writes nothing: `#work` already holds the composite (the last
move gesture committed it), so "drop" is purely forgetting. Called from: a
press outside the selection, Esc, `willUpdate`'s tool-change branch, and
`#resetWorking` (which nulls the fields and stops the ticker directly — no
layer to clear yet on the first reset).

**Keys** (`#onKeyDown` / `#onKeyUp`): today both early-return unless
`#rectDragging` — so the canvas's `preventDefault` can never fire outside a
gesture. A selection is different: it lives for minutes, across dialogs and
menus, so its no-drag keys need guards a gesture never did. Restructure the
top of `#onKeyDown` as:

```
if (this.#selDrag) { …mid-drag cases… return; }
if (this.tool === 'select' && this.#sel) { …selection-up cases… return; }
if (!this.#rectDragging) return;   // the rect cases, unchanged
```

**Mid-drag cases** (a pointer is captured, so nothing modal can be open):
Esc → `#cancelMarquee()` / `#cancelMove()` (`preventDefault`, the rect's
rule); Shift down while moving → `#applyMove(#selLast, true)` (guard the
repeat with a `#selShift` flag, the `#shiftLock` idiom); the tool letters
`b/r/g/e/i/s` (same INPUT/TEXTAREA + modifier guards as today) → cancel the
in-flight drag (the tool switch that follows drops the selection through
`willUpdate`; `s` with the select tool live is a silent no-op patch and
switches nothing — listed anyway so the key set mirrors the rect's rule).
`#onKeyUp`: Shift up while moving → `#applyMove(#selLast, false)`.

**Selection-up cases** (no drag): only Esc → `#dropSelection()`, and ONLY
when all three hold — otherwise return without touching the event:

- `this.active` — this window is the desktop's active document window
  (decision 10). `sm-editor` passes `.active=${this.#isActive}` (it already
  re-renders on every workspace change; a low-rate reactive prop, fine on
  the reactive path). Every open document window's canvas has its own
  `document`-level handler, so without this one Esc would drop every
  window's selection.
- no modal is open: `!document.querySelector('vf-dialog[open]')` — the same
  test `shell/menus.js` uses for its own key gating (the Colors dialog
  renders in light DOM, so it's found too). The kit's modal dialog is a
  native `showModal()` whose Esc path is the native `cancel` event
  (`vintage-frames/src/modal-dialog.ts`), and a `preventDefault` on that
  keydown suppresses it — with a selection up, ⌘K then Esc must close the
  Colors dialog and leave the selection alone. (The canvas is a leaf that
  reads no store; one DOM query for a modal is the pragmatic exception, the
  same one `sm-color-picker` makes for the cursor.)
- the composed target is not an INPUT/TEXTAREA (the shortcuts.js guard).

And **never `preventDefault` here**: dropping a selection has no default
action to suppress, and the kit's `vf-menu` / `vf-menu-bar` keydown handlers
bail on `event.defaultPrevented` — a prevented Esc would strand a dropped
menu open. (A dropped menu's Esc still drops the selection too; accepted.)

**`willUpdate`** (`changed.has('tool')` branch): add `this.#dropSelection()`
before the existing rect cancel. **`#resetWorking`**: null every `#sel*` field,
`#selDrag = null`, `#selPointer = null`, stop the ants ticker.

**Lifecycle**: `connectedCallback` → `if (this.#sel) this.#startAnts()`;
`disconnectedCallback` → `this.#stopAnts()`. The desktop re-inserts a document
window's node to raise it, which disconnects and reconnects this element
mid-session; the selection fields survive (same element instance), the timer
must not leak or die.

### 3D. The marching ants — a fifth canvas layer

The existing cursor layer is cleared and redrawn by every hover / rect
painter at pointer-move rate (`drawPencilPreview` starts with `clearRect`), so
ants drawn there would be wiped by the next move. Give them their own layer:

- **Template:** a fifth `<canvas class="editor-canvas-select" ${ref(this.#antsLayer)}>`
  after the cursor canvas in `render()`; CSS
  `.editor-canvas-select { z-index: 4; pointer-events: none; }` (topmost —
  nothing may cover the boundary). System-res backing like the overlay and
  cursor layers: size it in `#layout()` beside them
  (`this.#antsLayer.value.width = this.#sysW` …) and redraw
  (`this.#drawAnts()`) — a backing resize clears a canvas. `firstUpdated`
  grabs its context (`#antsCtx`). Add the class to the header comment's
  layer list ("the 4-layer stack" → five).
- **Painter** (`draw-overlays.js`, stateless, system-px space like the rest):

  ```js
  export const ANTS_DASH = 4; // system px on / off — an 8px period
  /** @param {CanvasRenderingContext2D} g @param {OverlayView} v
   *  @param {{x0,y0,x1,y1}|null} bounds  the CURRENT (translated) selection
   *  @param {number} phase  0..7, advanced by the ticker */
  export function drawMarchingAnts(g, v, bounds, phase) {
    g.clearRect(0, 0, v.sysW, v.sysH);
    if (!bounds) return;
    const s = v.scale;
    const x = bounds.x0 * s + 0.5,
      y = bounds.y0 * s + 0.5; // the haloBox
    const w = (bounds.x1 - bounds.x0 + 1) * s - 1; // alignment:
    const h = (bounds.y1 - bounds.y0 + 1) * s - 1; // 1px, just
    g.lineWidth = 1; // inside the
    g.setLineDash([]); // rect's edge
    g.strokeStyle = '#fff';
    g.strokeRect(x, y, w, h); // the white half of the 1-bit ants
    g.setLineDash([ANTS_DASH, ANTS_DASH]);
    g.lineDashOffset = -phase; // a growing offset marches the dashes
    g.strokeStyle = '#000';
    g.strokeRect(x, y, w, h); // the black half over it
    g.setLineDash([]);
  }
  ```

  Black-and-white alternating dashes, one system px thick, on the selection's
  outermost texel rows/columns — the 1-bit ants of the original, readable on
  any art. The dash walks the perimeter continuously (`strokeRect` is one
  path), with the classic seam at the start corner. Bounds off the tile clip
  at the canvas edge.

- **Ticker:** `#antsPhase` (0–7), `#antsTimer` (`setInterval`, `ANTS_MS = 100`
  — tune by eye; MacPaint's were brisk). `#startAnts()`: no-op if running, or
  if `prefersReducedMotion()` (import from `'vintage-frames'`) or the
  `#antsStatic` hook flag is set — then the ants draw once at phase 0 and stay.
  Each tick: `#antsPhase = (#antsPhase + 1) & 7; #drawAnts()`. `#stopAnts()`
  clears the interval and zeroes the phase. `#drawAnts()` =
  `drawMarchingAnts(#antsCtx, #overlayView, currentRect, #antsPhase)`.
  Runs only while `#sel` is set (idle costs nothing).
- **Determinism:** a marching border would make every capture with a
  selection in frame differ by the tick. The `?select` hook (§3I) sets
  `#antsStatic = true` — phase 0, no timer — the `?now` discipline for the
  clock. README's determinism note gains the sentence.
- **No kit change.** The kit ships no ants primitive and none is needed: this
  is one canvas painter on a layer the app already owns. (Memory rule: never
  edit vintage-frames from this repo; nothing here would want to.)

### 3E. The cursor: crosshair outside, arrow inside

MacPaint showed the arrow over a selection (you're about to grab it) and the
crosshair elsewhere. The canvas flips its own claim: `#setCursorClaim(kind)`
sets `data-vf-cursor` on the pixel canvas to `'arrow'` or `'crosshair'` only
when it differs (a `setAttribute` per move would be churn). Called from the
select tool's hover path (inside/outside), at move start (`arrow`), and
reset to `crosshair` by `#dropSelection`, `#onPointerLeave` (guarded on no
drag in flight — the rect's `!#rectDragging` rule, extended to `!#selDrag`:
with the pointer captured a mid-move leave fires only on a release outside)
and the tool-change branch.

**How the kit picks it up — and the one-move lag.** `applyCursor` resolves
the kind by HIT-TEST from its cached pointer position (`resolveKind` walks
`composedChain(deepElementAt(x, y))` for the nearest claim), on every
`pointermove` / `pointerdown` — at the CAPTURE phase on `window`, i.e.
before this canvas's own handler runs. Its `MutationObserver` watches
`document.body`'s subtree, and a MutationObserver never crosses a shadow
boundary, so the canvas's attribute (inside `<sm-draw-canvas>`'s shadow
root) is invisible to it — the README already records this for the Colors
dialog. Net: a claim set from the move handler is drawn on the NEXT move (a
frame later — invisible), and a claim reset with the pointer still (Esc →
crosshair) shows when the pointer next moves. Accepted; nothing to engineer
around. `drive.mjs`'s `cursorClaim` reads the attribute, not the drawn art,
so the checks are exact.

Do this imperatively, not with a bound attribute in the template: a binding
would put a pointer-move-rate value on the reactive path (the state split the
header comment guards). The template's static `data-vf-cursor="crosshair"` is
cloned once and never re-applied by Lit, so a manual `setAttribute` is never
reverted. The shadow rule `cursor: var(--vf-cursor, crosshair)` stays — the
kit token carries the arrow; the native fallback only matters before
`applyCursor` takes over.

### 3F. Undo

Nothing new in `history.js`. A move gesture brackets `#beginGesture()` /
`#endGesture()` exactly like a stroke: `before` is the composite at the grab
(or the untouched art), `after` the composite at release; `sm-editor`'s
`#onCommit` pushes a `tile` entry. Undo → `doc.restoreTile` → structural →
the canvas's `tile` identity changes → `#resetWorking` → the selection drops
(decision 4). The restored pixels are the composite one gesture back, with no
selection up — the user re-marquees if they want to keep going.

Why not keep the selection through Undo as MacPaint did: the float and base
are bytes of a working buffer that a structural change replaces wholesale;
resurrecting them means re-deriving a selection from the restored tile (the
`before` snapshot has no idea where the float was) or stashing float/base/
offset in the history entry. Both are real machinery for a small win; §8
lists it as a follow-up if it's missed in use.

### 3G. The live channel, derived faces, the Sprite View, the mesh

`#commitPixels()` already does everything: `#dirty = true`,
`#gestureChanged = true`, repaint, `sm-live { tile: #workingTile, dirty }` →
`applyTileEdit` (rAF blit into the sheet → the rebuilder and the Full Sprite
View, both live subscribers). The float composite writes `#work` in place,
so `#workingTile` stays the same object — the by-reference contract holds.

- **A derived (empty) face** — or any marquee over empty texels: the float
  lifts with `opaque === 0`, so `#applyMove` never composites and never
  calls `#commitPixels` (§3C's guard): `#dirty` stays false, no `sm-live`
  fires, no rebuild runs, the face stays derived. The guard IS the special
  case — an unconditional `#commitPixels` would blit and carve per pointer
  move for nothing.
- **A float dragged wholly off the tile** leaves `#work` = the hole; if that
  is blank, `applyTileEdit` stores `views[face] = null` silently (the face
  reads as derived on the next structural pass) — existing semantics,
  reversible by dragging back or Undo.

### 3H. Registering the tool (the ritual every tool went through)

| Surface       | Change                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session.js`  | The `tool` union comment + `setTool`'s JSDoc gain `'select'`. `pickColor` is untouched: only the eraser flips to the pencil, so a color pick leaves Selection selected (sticky, like the eyedropper).                                                                                                                                                                                                                   |
| `icons.js`    | `import '@spectrum-web-components/icons-workflow/icons/sp-icon-rect-select.js';` — Spectrum's marquee glyph (dashed box). Alternates in the set if it reads wrong at 18px: `sp-icon-select-rectangle`, `sp-icon-selection`, `sp-icon-select-box`. Pick by eye.                                                                                                                                                          |
| Tool strip    | A sixth `cell('selection', ICON_SELECT, 'selection — drag a box, then drag inside it to move (S)', this.tool === 'select', 'select')` as the FIRST cell (decision 9). `aria-label="selection"` is what `drive.mjs`'s probe keys on. Header comment: "all five cells" → six.                                                                                                                                             |
| Tools palette | `index.html` `#win-tools`: `height="158"` → `height="187"` (6×28 + 5 rules = 173, + 14 chrome) and its comment's arithmetic. `test/layout.test.mjs` L31 `TOOLS = { width: 30, height: 158 }` → 187, and the literal `box(14, TOP_RESERVE, 30, 158)` near L300. The icon lattice is unaffected: `ICON_ROW_Y0 = 340` in `layout.js` is a constant, and the palette's new bottom edge is 56 + 8 + 187 = 251 — clear of it. |
| Tools menu    | `index.html` L70–76: `<vf-menu-item value="tool-select" shortcut="S">Selection</vf-menu-item>` first; the comment at L67–69 ("B/R/G/E/I") gains S. `menus.js`: `'tool-select'` in `DOC_SCOPED` (so it greys with the Finder role) and `'select'` in the `toolItems` list (the checkmark).                                                                                                                               |
| Key           | `shortcuts.js`: `s: 'select'` in the map; the header comment. (The kit never matches an unmodified letter, so the menu's `shortcut="S"` is display-only, as for the others.)                                                                                                                                                                                                                                            |
| Options strip | Nothing: `sm-tool-options` renders `nothing` for `'select'`; the ink swatch shows (only the eraser hides it). `sm-options-bar`'s header list of tools can name it.                                                                                                                                                                                                                                                      |
| `?edit` etc.  | Untouched.                                                                                                                                                                                                                                                                                                                                                                                                              |

### 3I. The capture hook — `?select=x0,y0,x1,y1[,dx,dy]`

The capture tool can't drag, so a shot of the tool needs a hook, like
`?rect` / `?fill`:

- `params.js`: parse four required ints + two optional (`dx`, `dy`, default 0)
  → `select: {x0,y0,x1,y1,dx,dy} | null` (fewer than four → `null`); add it to
  the returned object and the header comment's hook list.
- `main.js`: in the boot-seed block, after `?fill`: `if (boot.select)
session.setTool('select');` and `bootHooks` gains `selectOnMount: boot.select`
  (extend the `boot.cursor != null || boot.rect || boot.fill` condition).
- `sm-editor.js`: `.selectOnMount=${hooks?.selectOnMount ?? null}`.
- `sm-draw-canvas.js`: a plain `selectOnMount` field (constructor: `null`);
  `#applyDrawHooks` clamps the four corners to the tile (the existing
  `clampX`/`clampY`), `#sel = normalizeBounds(…)`, `#antsStatic = true`, and
  if `dx || dy`: lift (as the move press does), `#selOffset = {dx,dy}`,
  composite, `#commitPixels()` (the pixels reach the doc like `fillOnMount`'s
  — no gesture bracket, no undo entry, the same as the fill hook). Then
  `#drawAnts()` once (phase 0). The header comment's dev-hook list gains it.
- README: the dev-hook paragraph and the determinism note.

Shots: `tools/capture.sh shot 'http://localhost:5173/?fresh=1&sample=car&edit=front&rotate=0&now=2026-08-24T19:27&select=10,10,20,20' /tmp/sel-a.png`
and the same with `select=10,10,20,20,6,0` (a moved float over the car's art —
the transparency rule is visible: art shows through the float's empty
texels). Two runs of each must `cmp` byte-identical.

---

## 4. File-by-file changes

**New**

- `src/lib/select.js` — §3B, header comment in the `rect.js` / `fill.js`
  voice (what a bounds is, the transparency rule, the no-wrap clip).
- `test/select.test.mjs` — §5A.

**Modified**

- `src/components/sm-draw-canvas.js`
  - header: the tool list, the fifth layer, `selectOnMount` in the hook list,
    the selection's state-split note (base/float/offset are hot-path fields).
  - imports: `liftRect, clearRect, compositeFloat, normalizeBounds,
boundsContain, translateBounds, constrainAxis` from `../lib/select.js`;
    `drawMarchingAnts` from `./draw-overlays.js`; `prefersReducedMotion` from
    `'vintage-frames'` (beside `effectiveScale, onScaleChange`).
  - styles: `.editor-canvas-select`.
  - fields: everything in §3A/§3C, `#antsLayer = createRef()`, `#antsCtx`,
    `#antsPhase`, `#antsTimer`, `#antsStatic`, `#selShift`, `selectOnMount`;
    a new reactive `active: { type: Boolean }` (constructor `false`) — the
    selection-up Esc gate (§3C keys), nothing else reads it.
  - `connectedCallback` / `disconnectedCallback`: the ticker (§3C lifecycle).
  - `willUpdate`: `#dropSelection()` in the tool-change branch.
  - `firstUpdated`: `#antsCtx`.
  - `#resetWorking`: the `#sel*` reset + `#stopAnts()`.
  - `#layout()`: size the ants backing, `#drawAnts()`.
  - `#applyDrawHooks`: the `selectOnMount` branch.
  - `render()`: the fifth canvas.
  - `#onKeyDown` / `#onKeyUp`: the selection cases (§3C keys).
  - new methods: `get #selRect()` (translated bounds or null), `#startMarquee`,
    `#endMarquee`, `#cancelMarquee`, `#startMove`, `#applyMove`, `#endMove`,
    `#cancelMove`, `#dropSelection`, `#drawAnts`, `#startAnts`, `#stopAnts`,
    `#setCursorClaim`.
  - `#onPointerDown` / `#onPointerMove` / `#onPointerUp` /
    `#onPointerCancel` / `#onPointerLeave`: the branches in §3C, placed
    before the rect / pencil paths and after the eyedropper / Alt branch.
- `src/components/draw-overlays.js` — `ANTS_DASH`, `drawMarchingAnts`; the
  header's painter list.
- `src/components/sm-tool-strip.js` — `ICON_SELECT`, the sixth cell (first),
  header.
- `src/icons.js` — the import.
- `src/components/sm-editor.js` — the `.selectOnMount` prop, and
  `.active=${this.#isActive}` (decision 10).
- `src/state/session.js` — the union/JSDoc.
- `src/shortcuts.js` — `s`.
- `src/shell/menus.js` — `DOC_SCOPED`, `toolItems`.
- `src/boot/params.js` — `?select`.
- `src/main.js` — the seed + `bootHooks`.
- `index.html` — the menu item, the comment, `#win-tools` height + comment.
- `test/layout.test.mjs` — `TOOLS.height`, the literal.
- `test/session.test.mjs`, `test/params.test.mjs` — §5A.
- `tools/drive.mjs` — §5B (the probe's tool list + a new section).
- `README.md`, `docs/SMOKE-TEST.md` — §7.

---

## 5. Verification

### 5A. Node (`npm test`)

`test/select.test.mjs` (pure, `node --test`, the `rect.test.mjs` shape —
small hand-built buffers, texel keys as `"x,y"` sets):

- `normalizeBounds` orders any corner pair; `boundsContain` is inclusive on
  all four edges; `translateBounds` is a pure shift.
- `constrainAxis`: wider wins (`{5,2}` → `{5,0}`), taller wins, a tie keeps
  `dx`, `{0,0}` stays.
- `liftRect` copies exactly the rect (bytes equal, nothing outside touched)
  and counts its opaque texels: `opaque` is 0 over empty space, N over N
  painted texels, and a texel with alpha 0 under stray RGB counts as empty;
  `clearRect` zeroes all four bytes of the rect and reports `true`; clearing
  an already-transparent rect reports `false`.
- **Identity:** lift → clear → `compositeFloat(out, base, …, sel.x0, sel.y0)`
  reproduces the original buffer byte-for-byte.
- **The rule:** a float with a transparent texel composited over painted base
  art keeps that art under the hole; an opaque float texel overwrites.
- **Clipping, no wrap:** an offset pushing the float past the right edge
  writes nothing at the next row's start (the linear-index wrap bug's exact
  signature); past the bottom writes nothing past `h`; a negative offset
  clips the left/top.
- **Reversible:** partially off-tile then back on-tile reproduces the full
  float — the float buffer is never clipped, only the composite is.

`test/session.test.mjs`: `setTool('select')` is sticky — `pickColor` leaves it
selected (mirror the eyedropper test at ~L28). `test/params.test.mjs`:
`?select=3,3,20,14` → `{3,3,20,14,0,0}`; `?select=3,3,20,14,5,-2` → dx 5,
dy −2; `?select=3,3` → `null`; the all-params snapshot near the top of the file
(the object listing `cursor, rect, fill`) gains `select`. `test/layout.test.mjs`
follows the palette height.

### 5B. `tools/drive.mjs` (real trusted input; mechanisms, never copy)

Probe (~L378): insert `'selection'` in the `drawTool` list BEFORE
`'eyedropper'` (the comment says why the eyedropper stays last). Everything
else the section needs already exists: `keyPress`, `drag`, `click`, `mouse`,
`at(px,py)`, `texelAt`, `layerIsEmpty(sel)`, `hex`, `probe()`'s
`drawTool` / `menuChecks.tool` / `opts` / `inkSwatchShown` / `cursorClaim` /
`menuChecks.undoEnabled`, `META`. The boot URL is
`?sample=car&edit=front&rotate=0`, tile 40; `(32,6)` is pinned empty on the
front face by the rect section, so reuse that corner. A new `section('selection')`
after the rect section, opening with `await freshPage()` (known state, no
selection, Undo disabled):

```
S                       → drawTool === 'selection'; menuChecks.tool === 'select';
                          opts.length === 0; inkSwatchShown === true
drag (30,4)→(34,8)      → !layerIsEmpty('.editor-canvas-select')   (the ants are up)
                          texelAt(32,6)[3] === 0 (unchanged); undoEnabled still false
                          (a marquee is no undo step)
mouseMoved to (32,6)    → cursorClaim === 'arrow'        (inside)
mouseMoved to (10,30)   → cursorClaim === 'crosshair'    (outside)
Escape                  → layerIsEmpty('.editor-canvas-select')
B; click (32,6); click (30,16)
                        → paints A and B with the boot ink (read texelAt of each)
S; drag (30,4)→(34,8)   → the marquee holds A; texelAt(30,6)[3] === 0 (the float
                          texel that will land on B is transparent — the one
                          read the transparency assertion below rests on; the
                          rect section pins only (32,6) empty, not the corner)
⌘K (keyPress('k', META)); Escape
                        → colorsOpen === false AND ants layer non-empty (Esc
                          closed the dialog and left the selection — the modal
                          guard; a prevented Esc would have stranded the dialog)
drag (32,6)→(32,16)     → the move, +10 rows:
                          texelAt(32,16) === A, alpha 255      (the painted texel moved)
                          texelAt(32,6)[3] === 0               (the hole)
                          texelAt(30,16) === B                  (a TRANSPARENT texel of the
                                                                 selection landed on B and
                                                                 left it — the rule)
                          ants layer non-empty                  (the ants followed the float)
                          undoEnabled === true                  (a move is one undo step)
⌘Z (keyPress('z', META))→ texelAt(32,6)[3] === 255; texelAt(32,16)[3] === 0;
                          ants layer empty                      (a structural change drops it)
S; drag (30,4)→(34,8); B→ ants layer empty                      (a tool switch drops it)
```

About 17 checks. Update the count in `docs/SMOKE-TEST.md`'s opening paragraph
(205 → the new total) and the README line that quotes it if any. Headless
Chrome wedges on repeated synthesized chord-drags, so the **Shift axis-lock
stays a manual item**, like the rect's Shift square-lock.

### 5C. `docs/SMOKE-TEST.md` — the eye

New items under "Drawing gestures (document window)":

- **Marching ants**: S, drag a box — a 1px black/white dashed border marches
  around it (briskly, continuously, one seam at the start corner); it stays
  up while you hover, moves with the float, and clips at the canvas edge
  when the float is pushed off. Shrink the document window: the ants re-fit
  with the texel size.
- **The cursor flips**: the kit's crosshair outside the selection, the arrow
  inside it and throughout a move; the crosshair returns on drop.
- **Shift constrains a move**: drag the float diagonally, press Shift — it
  snaps to the dominant axis; release Shift — it follows freely again.
- **Transparency doesn't travel**: marquee a region with empty texels around
  a shape, drag it over other art — the other art shows through the empty
  texels; only the shape overwrites. Drop; ⌘Z puts everything back.
- **Reduced motion**: with the OS "reduce motion" on, the ants stand still
  (phase 0); the tool otherwise behaves the same.
- **A click is no selection**: click (no drag) on the canvas — nothing
  appears (not even a one-texel flash during the press); click outside an
  existing selection — it drops; drag from outside — the old drops and a new
  marquee starts in the same gesture.
- **Esc respects a dialog**: with a selection up, ⌘K (or the swatch) then
  Esc — the Colors dialog closes, the ants stay; a second Esc on the canvas
  drops them. Drop a menu and press Esc — the menu closes (the selection
  drops too; accepted).
- **Per-window**: two documents open, a selection in each — switching
  windows leaves both up, ants marching in the inactive one; Esc drops only
  the active window's; picking another tool drops both.
- **Alt-click samples**: Alt-click a painted texel — the ink changes, the
  selection stays and the tool stays Selection; Alt-click empty space — the
  eraser is selected and the selection drops (the existing empty-sample
  rule, decision 6).

### 5D. Captures

`?select=` shots as in §3I, `cmp` between runs. A moved float over the car's
front face is the shot that shows the transparency rule.

### 5E. The standing gates

`npm test` · `npm run typecheck` · `npm run lint` (`npm run format` to fix) ·
`npm run build` · `node tools/drive.mjs` (against `npm run dev`) — all green
before the commit. No one-off scripts (memory rule): the gates above and an
eye on the dev server are the verification.

---

## 6. Implementation order (the app runs at every step)

1. **`src/lib/select.js` + `test/select.test.mjs`.** Pure; pass before any
   UI exists. `npm test`.
2. **Register the tool without behavior:** session union, icon import, strip
   cell, palette height (+ layout tests), menu item + `DOC_SCOPED` +
   `toolItems`, `shortcuts.js`. Press S: the cell inverts, the menu checks,
   the strip is empty, the canvas does nothing yet. `npm test`, typecheck,
   drive's existing sections still green.
3. **The ants layer + painter:** template, CSS, backing in `#layout()`,
   `drawMarchingAnts`, the ticker with lifecycle. Temporarily set `#sel` from
   the `?select` hook (step 5 wires it properly — do the hook's static-bounds
   half now, it's three lines) to see ants on a fresh load.
4. **The gestures:** marquee → selected; move (lift/composite/commit, the
   `opaque` short-circuit); drop; Esc (mid-drag vs. selection-up — the
   active / modal / field guards, no `preventDefault` on the latter);
   cancel; keys; cursor claim; the `active` prop; `willUpdate` /
   `#resetWorking` hooks. Verify by hand against §3C and §5C, then write
   the drive section (§5B).
5. **The `?select` hook end to end** (params → main → editor → canvas),
   params tests, two `cmp`-identical captures.
6. **Docs** (§7), the drive count, prettier, the full gate list, commit.

---

## 7. The doc ritual (this repo documents as it ships)

- **README** — the Drawing-editor **Tools** bullet: six tools, `S` first,
  the cell's icon (`rect-select`); a **Selection** paragraph in the tool
  run-down (the marquee, the ants, drag-inside-to-move, the transparency
  rule, click-outside/Esc/tool-switch drop, Shift's axis lock, one undo step
  per move, structural changes drop it, off-tile clipping); the **Menu bar →
  Tools** line ("the five sticky tool modes" → six, the letters); the
  **shortcuts** sentence (B/R/G/E/I → S/B/R/G/E/I — two places: the Menu-bar
  section and the `shortcuts.js` listing line); the **dev-hook** paragraph
  (`?select=…`) and the **determinism** note at the top (the ants stand
  still under the hook); the **Architecture** test list (`test/select.test.mjs`);
  the **listings** (`lib/select.js`, `draw-overlays.js`'s painters,
  `sm-draw-canvas.js`'s gesture list, `sm-tool-strip.js`'s cell count).
- **SMOKE-TEST** — §5C's items; the drive count in the opening paragraph.
- **Header comments** — every file in §4 that carries one describing what it
  holds (this codebase's comments are load-bearing; a fresh reader trusts
  them).
- **Commit message** — the repo's long-form style: what shipped, why each
  decision, what the gates said (`npm test N/N (+k)`, typecheck + prettier +
  build, `drive.mjs N/N (+k)`, the captures cmp'd).

---

## 8. Follow-ups (explicitly out of scope here; the model is ready for them)

- **The registered move — "on all faces" (DECIDED: we will do this).** The
  step that makes the selection a 3D tool. A single-face move breaks the
  carve's registration (a roof shifted on FRONT no longer lines up with
  TOP, and the voxels the two agreed on vanish). A marquee on one face is a
  SLAB of voxels: a FRONT rect (columns x0..x1, rows y0..y1) is those
  columns across the whole depth on TOP/BOTTOM, those rows across the whole
  depth on LEFT/RIGHT, and its mirror on BACK. So a +dx on FRONT shifts
  TOP's and BOTTOM's columns x0..x1 (every row) by dx and BACK's mirrored
  columns by −dx, the sides untouched (x is their depth axis); a +dy shifts
  LEFT's, RIGHT's and BACK's rows y0..y1 (every column) by dy, TOP/BOTTOM
  untouched. Per-face bounds + deltas from `lib/views.js`'s
  `VIEW_IMAGE_AXES` (the alignment guides' own table); the per-face edit is
  `select.js`'s lift / clear / composite over each face's slice; the undo
  ONE whole-atlas snapshot (`history.withAtlasSnapshot`); the drag preview
  stays this face's, the other faces landing at release as a structural
  whole-sheet write (the all-faces fill's shape). A session checkbox
  (`moveAllFaces`) in the strip beside the readout — the fill tool's idiom.
  The single-face `#applyMove` is written so nothing about it changes shape
  for this; the comment beside it carries this design.
- **Edit → Cut ⌘X / Copy ⌘C / Paste ⌘V / Clear (Backspace) / Select All ⌘A.**
  MacPaint's whole reason for selections. The float IS the clipboard datum
  (`liftRect`'s tile). The gating plumbing NOW EXISTS (added with the
  strip's readout, 2026-08-28): the canvas emits `sm-selection
{bounds|null}` on every real outline change (deduped, never per ants
  tick), `sm-editor` mirrors it through `workspace.setSelection` onto the
  context's OWN `selection` store (never the workspace store — it moves at
  pointer rate), and `ActiveDocController`'s opt-in `selection: true`
  follows the active one. menus.js gates the items the way Undo gates on
  `canUndo` (a disabled item's key never fires — that is how ⌘A/⌘X stay
  native inside a text field) by following the same store. Paste lands a
  float centered on the canvas, floating, ants up.
- **The lasso** (`sp-icon-lasso-select` exists): a freehand outline
  rasterized to a mask; the float carries the mask, `compositeFloat` skips
  masked-out texels — the same skip the transparency rule already does.
- **Undo keeps the selection** (§3F): stash float/base/offset on the history
  entry and re-arm on restore.
- **Double-click the tool cell = Select All** (MacPaint) once Select All
  exists.
- **A right-click inside the selection clears it** (erase the float) — cheap
  once Clear exists.

---

## 9. Decisions to confirm (defaults chosen; change only if you disagree)

- **A. Cell/menu position:** first (MacPaint order). Appending after the
  eyedropper is a one-line change in the strip and the markup.
- **B. Ants speed:** 100 ms per 1px step on a 4/4 dash. Tune by eye.
- **C. Undo drops the selection** (decision 4) rather than keeping it.
- **D. No Shift on the marquee-out** (a square marquee was not a MacPaint
  thing); Shift is the move's axis lock.
- **E. Esc is the active window's** (decision 10): an `active` prop from
  `sm-editor` gates the selection-up Esc. Dropping it makes Esc drop every
  open window's selection — one line less, one surprise more with two
  documents open.
- **F. No ants on a 1×1 marquee**: a click never flashes a one-texel box.
  MacPaint drew nothing until you moved; if the flash reads better as
  feedback, drop the guard in `#drawAnts()`.

---

## 10. Risks and gotchas

- **The identity contract.** Never assign `#work = …` while a selection is
  up; always `#work.set(base)` + stamp. `applyTileEdit` stored `#work` by
  reference into `views[face]`; a fresh buffer would silently detach the doc
  from what's on screen.
- **`#commitPixels` in the cancel path.** `#cancelMove` re-composites and must
  call `#repaint()` + `#notifyLive()` directly — `#commitPixels` sets
  `#gestureChanged`, and `#endGesture` would then record an undo entry for a
  gesture that ended where it began.
- **The clearRect on the cursor layer.** `#drawCursor` clears the cursor
  layer on every move; the ants must never share it (hence the fifth layer).
- **The selection-up Esc is a document-wide key for as long as a selection
  lives.** The rect's Esc only ever fired inside a captured drag; this one
  fires with dialogs and menus open and other windows active. The three
  guards in §3C keys (active, no `vf-dialog[open]`, not in a field) and the
  no-`preventDefault` rule are load-bearing — a bare `preventDefault` on Esc
  suppresses the native dialog `cancel` and makes the kit's menus ignore the
  key. The drive's ⌘K → Esc check pins it.
- **An empty float must not commit.** `#applyMove` composites and calls
  `#commitPixels` only when `#selFloat.opaque > 0`; an unconditional commit
  blits + carves per pointer move for a move that changes nothing, and marks
  a derived face dirty. `#cancelMove` skips the re-composite the same way.
- **The cursor claim lands one move late.** The kit hit-tests at capture
  phase and its observer can't see into a shadow root (§3E). Don't chase a
  "stale arrow" after Esc with the pointer still — it's the next move's.
- **Ticker leaks across the desktop's re-insert.** The raise re-inserts the
  window's node → `disconnectedCallback` → `connectedCallback`. Stop the
  interval on disconnect, restart on connect iff `#sel`. A leaked interval
  keeps drawing into a context whose element is gone.
- **Row wrap in the composite.** Clip per texel on `x` AND `y` before
  computing the linear index; a bounds-only check on the float's rect lets a
  right-edge overflow land at the next row's left. The test in §5A is there
  for this.
- **Pointer capture on the phantom.** If the `?select` hook produces a float,
  it has no owning pointer (like `?rect`'s phantom drag); a real press inside
  it must take over normally — `#selDrag` is null in the hook, so it does.
- **The probe's tool list order.** `'selection'` goes before `'eyedropper'`
  in `drawTool`'s find list or a stuck double-active would hide.
- **Typecheck.** `setTool`'s JSDoc union and `shortcuts.js`'s map must agree;
  `menus.js` casts through `any`. Keep `npm run typecheck` green at step 2.
- **Prettier** reflows the long strip template; run `npm run format` before
  the gates, not after.
