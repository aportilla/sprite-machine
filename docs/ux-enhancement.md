# UX enhancement — Photoshop-panel editor sidebar

> **SUPERSEDED.** Historical design doc, kept for reference (like
> `drawing-editor-plan.md`). The editor has since moved to the System 7
> `vintage-frames` layout, and the UI was decomposed into components — see
> `COMPONENT-DEVELOPMENT-PLAN.md` and README's Architecture section for the
> current structure.

A re-working of the right-half editor (`#editor-panel`) into a **classic
Photoshop tool-panel** layout: a fixed **tool/settings header**, a **draw
section** that expands to fill all available height, and a fixed **reserved
colors tray** pinned to the bottom.

This document is the implementation plan — the exact structural change, a
region-by-region design, a file-by-file change list, the order to build it in,
and how to verify it headlessly. No code is changed yet.

---

## 1. The target

```
┌───────────────────────────────────────────┐
│  [✎] [▭] [▨]                tile size [40px]│  ← REGION 1: settings header
│  ●────────────────────────────────── [3px] │     (FIXED height)
├───────────────────────────────────────────┤
│  ╱right ╲╱ left ╲╱ top ╲╱bottom╲╱front╲╱back│  ← angled folder tabs
│  ┌───────────────────────────────────────┐ │
│  │                                       │ │  ← REGION 2: draw section
│  │              (canvas)                 │ │     (GROWS — flex:1 — fills
│  │           fills all height            │ │      whatever height is left)
│  │                                       │ │
│  └───────────────────────────────────────┘ │
├───────────────────────────────────────────┤
│ ┌──┐  ┌──────────────────────────────────┐ │  ← REGION 3: colors tray
│ │▨ │  │ ◩ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ │ │     (FIXED height, reserved)
│ ├──┤  │   ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪ (scroll) │ │
│ │  │  │                                  │ │     ◩ = transparent swatch,
│ │██│  │                                  │ │         stays IN the box
│ │  │  └──────────────────────────────────┘ │
│ └──┘  ← selected-color preview → opens modal│
└───────────────────────────────────────────┘
```

- **Region 1 (fixed):** tool picker (pencil / rect / fill as square bordered
  icon buttons) on the left, `tile size [40px]` on the right; below it the
  active tool's contextual control — for the pencil, a **slider** with a boxed
  `Npx` readout.
- **Region 2 (grows):** angled folder tabs (`left right front back top bottom` —
  current order kept), then the pixel canvas, which **expands to fill every
  remaining pixel** of panel height.
- **Region 3 (fixed, reserved):** a left strip with **only** the **eyedropper**
  button and a **selected-color preview** box (click → the existing 256-color
  modal — this is the old `+` "add" action), beside a **scrollable "colors…"
  box** whose leading fixed swatch is **transparent**, followed by every color
  painted in the sprite.

**Eyedropper icon:** keep the Spectrum **`sampler`** glyph (it is the eyedropper
icon) — no new icon import needed.

---

## 2. Where we are today (baseline)

`#editor-panel` is `flex: 1 1 50%; overflow-y: auto` and the editor content
**flows** top-to-bottom, scrolling when it overflows. `createTileEditor()`
(`src/editor.js`) builds, in order:

1. `.editor-canvas-panel` → `.editor-tabs` (6 folder tabs) + `.editor-canvas-card`
   ( `.editor-canvas-wrap` [4-layer canvas stack] + `.editor-canvas-footer`
   [ `.editor-toolstrip` (tool icons + docked tile-size stepper) +
   `.editor-tool-opts` (per-tool controls) ] ).
2. `.editor-used-row` — below the card: `+` add, eyedropper, transparent swatch,
   then a **wrapping** row of used-color swatches.
3. `.palette-modal` on `<body>` — the 256-swatch grid, opened by `+`.

The single most important mechanic: **`layout()` pins the canvas container to
`CANVAS_FRACTION = 0.6` of the sidebar height** (`wrap.style.height`), then
integer-scales the square tile canvas centered inside it. A `ResizeObserver` on
`container` re-runs `layout()`.

**Constraints the redesign must respect (verified):**

- **No test asserts editor DOM/classes.** `test/*.mjs` only cover pure lib
  modules (`rect`, `fill`, `atlas`, `guides`, `color`, `palette`, carve, mesh…).
  A DOM/CSS redesign breaks **no** unit tests. Verification is headless
  screenshots + `typecheck` + `lint`.
- **Dev hooks drive headless screenshots** (`tools/capture.sh`, window
  `1000×850` → panel ≈ **500 px** wide): `?edit=<face>`, `?tile=N`,
  `?palette=1` (opens the modal), `?cursor=N`, `?pick=N`,
  `?rect=x0,y0,x1,y1[,r[,sq]]`, `?fill=x,y[,r[,a]]`. All must still work.
- **`brush` is caller-owned and survives remounts** (`src/main.js`). Tabs, tile
  resize, and all-tiles replace **destroy + re-mount** the whole editor; state
  lives in `brush{tool,color,erase,picking,size,cornerRadius,fillReplace,
fillAllTiles,chosen}`.

---

## 3. The core structural change: a fixed 3-region flex column

Today the panel scrolls a flowing column and JS pins the canvas to 60%. The
redesign inverts that: **the panel is a fixed-height flex column**; the top and
bottom regions take their intrinsic/fixed height, and the **middle region grows
to consume the rest** (`flex: 1`). The canvas then fills the middle region — the
`0.6` fraction disappears entirely.

### 3.1 CSS shell

```css
/* was: overflow-y:auto flowing column */
#editor-panel {
  flex: 1 1 50%;
  min-width: 0;
  height: 100%;
  display: flex; /* NEW */
  flex-direction: column; /* NEW */
  overflow: hidden; /* NEW — no page scroll; regions own their overflow */
  background: var(--panel-bg);
  border-left: 1px solid rgba(255, 255, 255, 0.08);
}

.editor {
  /* the root createTileEditor() builds */
  flex: 1 1 auto;
  min-height: 0; /* critical: lets the middle region shrink + be measured */
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.editor-settings {
  flex: 0 0 auto;
} /* Region 1: intrinsic height */
.editor-draw {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.editor-colors {
  flex: 0 0 auto;
} /* Region 3: fixed height */
```

`min-height: 0` on `.editor` and `.editor-draw` is load-bearing — without it a
flex item refuses to shrink below its content's min-content height and the canvas
can't be measured/clamped.

### 3.2 New DOM skeleton in `editor.js`

`createTileEditor()` currently appends `.editor-canvas-panel` then
`.editor-used-row` straight onto `root` (`.editor`). Re-parent into three region
wrappers:

```
.editor
├── .editor-settings   (Region 1)   ← tool strip + tile size + contextual options
├── .editor-draw       (Region 2)   ← .editor-tabs + .editor-canvas-wrap (canvas stack)
└── .editor-colors     (Region 3)   ← left strip (eyedropper/transparent/preview) + palette box
```

The existing pieces move: the tool strip + `.editor-tool-opts` leave the canvas
**card footer** and go into `.editor-settings`; the tabs + canvas stack go into
`.editor-draw`; the used-color swatches become the scrollable box in
`.editor-colors`. The `.editor-canvas-card`/`.editor-canvas-footer` framing is
retired (the card was the "tabs + canvas + tools as one unit" concept, which the
new region split supersedes).

### 3.3 Height budget (why it fits at 1000×850)

Panel height ≈ `850 − 52 (topbar) = 798 px`, minus `2×12` panel padding ≈ 774 px
of content.

| Region                                         | Approx height                      |
| ---------------------------------------------- | ---------------------------------- |
| Settings (tool row ~34 + gap + slider row ~28) | ~78 px                             |
| Tabs                                           | ~30 px                             |
| **Canvas (grows)**                             | **~520 px** ← everything left over |
| Colors tray                                    | ~140 px                            |
| gaps (2×10)                                    | ~20 px                             |

At the default 40 px tile the canvas integer-scales to `floor(min(≈470/40,
≈510/40)) = 11×` → a 440 px crisp canvas, comfortably centered. Plenty of room.

### 3.4 Short-panel fallback

If the window is short enough that the middle region would starve the canvas,
give `.editor-draw` a **`min-height`** (≈ `180px`) and let `#editor-panel` fall
back to scrolling **only then**:

```css
.editor-draw {
  min-height: 180px;
}
/* fallback: if total content exceeds the panel, allow the panel to scroll */
#editor-panel {
  overflow-y: auto;
  scrollbar-gutter: stable;
}
```

Keep `scrollbar-gutter: stable` (already present) so a late scrollbar can't
shrink content width and oscillate the canvas `ResizeObserver`. In practice the
scrollbar never appears at normal sizes; it's a safety valve, not the norm.

---

## 4. Region-by-region design

### Region 1 — settings header (tools + tile size + slider)

**Tool picker.** Reuse the three `icon('draw'|'rectangle'|'color-fill')` buttons.
Restyle `.editor-tool-icon` into a **square bordered box** matching the mock:

```css
.editor-tool-icon {
  width: 34px;
  height: 34px; /* square */
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  --mod-icon-size: 18px;
}
.editor-tool-icon.active {
  /* accent fill for the active tool */
  color: #fff;
  border-color: var(--accent);
  background: rgba(199, 125, 214, 0.18);
}
```

Lay the tool group left, the tile-size right:

```css
.editor-toolstrip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
```

**Tile size.** Keep the `sizeStepper()` **logic** (it drives `onResizeTile`,
clamps to `TILE_MIN..TILE_MAX`, and — critically — carries `data-axis="Tile"` so
`focusSize` restores focus to it after the resize remount). Only **relabel and
restyle**: caption `tile size` (was `tile`), and give the boxed value the mock's
single-box look. The `−/＋` buttons can stay (they're the interaction) but the
box should read as `tile size [40px]`. _(Do not replace the stepper with a bare
number input — that would drop the remount focus-restore contract that keyboard
tile-sizing depends on.)_

**Pencil-size slider.** Today pencil size is a `sizeStepper` in
`.editor-tool-opts`. Add a `rangeSlider()` helper (sibling to `sizeStepper()`)
and render it for the pencil case of `renderToolOptions()`:

```js
// editor.js — new helper, mirrors sizeStepper's clamp/commit contract
function rangeSlider({ key, label, value, min, max, unit, onCommit }) {
  const field = el('div', 'editor-field editor-slider-field');
  field.append(el('span', 'editor-field-cap', `${label}:`));
  const input = el('input', 'editor-slider');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.dataset.axis = key; // keep the focus-restore hook
  const readout = el('span', 'editor-slider-val');
  const clamp = (n) => Math.max(min, Math.min(max, Math.round(Number(n) || 0)));
  let cur = clamp(value);
  const sync = () => {
    input.value = String(cur);
    readout.textContent = `${cur}${unit || ''}`;
  };
  input.oninput = () => {
    const v = clamp(input.value);
    if (v !== cur) {
      cur = v;
      sync();
      onCommit(v);
    }
  };
  sync();
  field.append(input, readout);
  return field;
}
```

`oninput` (fires continuously) is what we want here — it makes the hover
footprint update live as you drag the slider (calls `setPencilSize(n)` →
`clampBrush` + `drawCursor(hoverTexel)`), matching the mock's live `3px` readout.

**Contextual options stay contextual.** `renderToolOptions()` keeps its
tool-switch: **pencil → the slider**, **rect → the corner-radius control**,
**fill → the two checkboxes**. Only the pencil branch changes (stepper → slider).
Keep a stable `min-height` on the options row so the settings header height
doesn't jump when switching tools (rect/fill rows differ in height). `B/R/G/I/E`
shortcuts and `renderToolOptions()` are unchanged; after a remount the slider
reads `brush.size` (clamped), same as the stepper does today.

> Rect radius / fill checkboxes could optionally also become sliders/segmented
> controls later for consistency, but that's out of scope — keep their current
> widgets to minimize risk.

### Region 2 — draw section (angled tabs + expanding canvas)

**Angled folder tabs.** Give `.editor-tab` a slanted-parallelogram silhouette
with **`clip-path`** (crisper and easier to fill per-state than `skewX`, which
needs a counter-skewed inner label):

```css
.editor-tabs {
  display: flex;
  gap: 0;
  position: relative;
  z-index: 1;
  padding-left: 6px;
}
.editor-tab {
  flex: 1 1 0;
  min-width: 0;
  margin-right: -8px; /* overlap like real PS tabs */
  padding: 7px 10px 7px 14px;
  clip-path: polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%); /* parallelogram */
  background: rgba(255, 255, 255, 0.04);
  border: none; /* clip-path eats borders; use bg + inset shadow */
  color: #9a9aa6;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: -1px; /* overlap the draw surface top edge */
}
.editor-tab.active {
  background: var(--widget-bg); /* merge into the canvas surface below */
  color: #f0f0f4;
  font-weight: 700;
  z-index: 2; /* the active tab rides over its neighbours */
}
.editor-tab:hover:not(.active) {
  background: rgba(255, 255, 255, 0.08);
  color: #d8d8de;
}
```

Notes:

- **`clip-path` clips the focus ring.** Keyboard focus-visible must stay
  visible: don't rely on `outline` (it gets clipped). Use a `box-shadow` inset
  ring on `:focus-visible`, or wrap the clipped shape in an unclipped
  focus wrapper. Spell this out in the build.
- 6 tabs at ~500 px with `-8px` overlap keep the 9 px uppercase labels legible;
  the overlap is the classic Photoshop stacked-tab read.
- Tab click behavior is unchanged: each tab is a `<button>` whose `onclick`
  calls `onSelectFace(f)` → `enterDrawing` remounts the editor on that face.
- **Optional tab order:** `main.js` `TAB_ORDER` is
  `[left,right,front,back,top,bottom]`; the mock shows
  `right left top bottom front back`. Both are mirror-paired. Reordering is a
  one-line `TAB_ORDER` change if you want to match the mock exactly — flagged as
  a decision to confirm (§9).

**Expanding canvas — the `layout()` rewrite.** The canvas container fills the
draw region below the tabs; JS no longer sets its height.

```css
.editor-canvas-wrap {
  flex: 1 1 auto;
  min-height: 0; /* fill the draw region below the tabs */
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  overflow: hidden;
  background: var(--widget-bg);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
}
```

```js
// editor.js — layout() loses the 0.6 pin; the box height is now CSS-driven.
const CANVAS_FRACTION = 0.6; // DELETE this const
function layout() {
  // wrap.style.height is NO LONGER set — flex sizes it. Just measure + integer-scale.
  const cs = getComputedStyle(wrap);
  const availW = Math.max(
    1,
    wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
  );
  const availH = Math.max(
    1,
    wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
  );
  const s = Math.max(1, Math.floor(Math.min(availW / tileW, availH / tileH)) || 1);
  if (laidOut && s === scale) return;
  laidOut = true;
  scale = s;
  cssW = tileW * s;
  cssH = tileH * s;
  stack.style.width = `${cssW}px`;
  stack.style.height = `${cssH}px`;
  overlay.width = cssW;
  overlay.height = cssH;
  cursor.width = cssW;
  cursor.height = cssH;
  drawGuides(overlayCtx, guides, scale, cssW, cssH);
  redrawCursorLayer();
}
```

Everything from the `s = …` line down is **unchanged** — the border-excluded
`getComputedStyle` measurement (which already prevents the 1 px double-count),
the 4-layer stack (bg/pixel native-res; overlay/cursor screen-res), and the
guide + hover-footprint redraw at the new scale all carry over verbatim. The
dev-hook overlay previews (`?cursor`, `?rect`, `?fill`) still render because they
draw **after** `layout()` on mount.

**ResizeObserver target.** Switch the observer from `container` (the panel) to
**`wrap`** (the canvas container). Since JS no longer writes `wrap.style.height`,
observing `wrap` is now feedback-free and strictly more precise: it fires exactly
when the available canvas box changes (window resize → flex reflow), and layers
we resize are `wrap`'s children (they never change `wrap`'s own box). Keep the
same no-op guard (`s === scale` early-return).

### Region 3 — colors tray (eyedropper + preview strip · scrollable palette)

Only the **eyedropper** and the **selected-color preview** break out into the
left strip. The **transparent swatch stays inside the "colors…" box** as its
leading fixed swatch (with the used colors).

```
.editor-colors (fixed height, flex row)
├── .editor-ink-strip (column: eyedropper button, selected-color preview)
└── .editor-palette-box (flex:1, scrollable: transparent swatch + used-color swatches)
```

```css
.editor-colors {
  display: flex;
  gap: 8px;
  align-items: stretch;
  height: 140px;
}
.editor-ink-strip {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 0 0 auto;
  width: 40px;
}
.editor-ink-strip .editor-pal-tool {
  width: 40px;
  height: 34px;
} /* eyedropper */
.editor-selected-preview {
  flex: 1 1 auto;
  width: 40px;
  min-height: 0;
} /* big color preview, fills the strip */
.editor-palette-box {
  flex: 1 1 auto;
  min-width: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 5px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
}
.editor-palette-box.is-empty::after {
  /* hint shown when no colors are painted yet */
  content: 'colors…';
  color: #7a7a86;
  font-size: 11px;
  align-self: center;
}
```

**Eyedropper** moves to the strip as a dedicated `.editor-pal-tool` button with
`icon('sampler')` (behavior unchanged: sets `brush.picking`). **Transparent**
stays in the palette box (behavior unchanged: sets `brush.erase`).

**Selected-color preview → modal (replaces `+`).** A `<button>` swatch showing
the current ink:

```js
const selectedPreview = el('button', 'editor-swatch editor-selected-preview');
selectedPreview.type = 'button';
selectedPreview.setAttribute('aria-label', 'selected color — open the 256-color palette');
selectedPreview.title = 'selected color — open palette';
selectedPreview.onclick = () => openPalette(); // the SAME modal the "+" used to open
function syncPreview() {
  if (brush.erase) {
    selectedPreview.classList.add('editor-transparent-sw');
    selectedPreview.style.background = '';
  } else {
    selectedPreview.classList.remove('editor-transparent-sw');
    selectedPreview.style.background = rgbHex(brush.color);
  }
}
```

- **Remove the `+` `.editor-add` button** — the preview box is the new modal
  opener. The `.palette-modal` itself (`openPalette`/`closePalette`, the
  `cubeEls`, `markInSprite` in-sprite rings) is **completely unchanged**.
- Call `syncPreview()` from `selectColor()` and `syncUI()` so the box tracks the
  ink live (a pick from the modal, an eyedrop, or selecting transparent all
  reflect immediately).

**The scrollable "colors…" box = today's `renderUsed()`, keeping the transparent
lead.** `renderUsed()` keeps its logic verbatim (the painted-set union, the
`brush.chosen` pinned-ink tile, the signature dedup that skips DOM churn
mid-stroke, `syncActiveSwatch`, `markInSprite`). The change: the `+` and
eyedropper leave the row (→ removed / moved to `.editor-ink-strip`), while the
**transparent swatch stays** as the row's one fixed lead. So:

- `FIXED_LEAD` becomes `1` (the transparent swatch alone); the existing rebuild
  loop `while (row.children.length > FIXED_LEAD) removeChild(last)` and the
  `transparentSw` prepend both carry over, now against `.editor-palette-box`.
- Toggle `.is-empty` on the box when the used-color list is empty (only the
  transparent lead present) so the `colors…` hint shows.

**Dev hooks:** `?palette=1` still calls `openPalette()` (unchanged path).
`?pick=N` calls `selectColor()` → now also lights the preview box via
`syncPreview()`. Both keep working headlessly.

---

## 5. File-by-file change list

**`src/style.css`**

- `#editor-panel`: `display:flex; flex-direction:column; overflow:hidden` (+
  `overflow-y:auto` short-panel fallback).
- `.editor`: `flex:1 1 auto; min-height:0`.
- Add `.editor-settings`, `.editor-draw` (`flex:1;min-height:0`),
  `.editor-colors`, `.editor-ink-strip`, `.editor-palette-box`,
  `.editor-selected-preview`, `.editor-slider*`.
- `.editor-tab*`: angled `clip-path`, overlap, `:focus-visible` inset ring.
- `.editor-canvas-wrap`: `flex:1;min-height:0` + its own border/bg (absorbs the
  retired card frame).
- `.editor-tool-icon`: square bordered box.
- Retire `.editor-canvas-card` / `.editor-canvas-footer` / `.editor-canvas-panel`
  rules (or repurpose). Remove `.editor-add` if the `+` is dropped.

**`src/editor.js`**

- Build `.editor-settings` / `.editor-draw` / `.editor-colors` wrappers; re-parent
  the tool strip, tabs+canvas, and colors into them.
- Delete `CANVAS_FRACTION`; rewrite `layout()` to not set `wrap.style.height`.
- `ResizeObserver` observes `wrap` instead of `container`.
- Add `rangeSlider()`; render it in the pencil branch of `renderToolOptions()`.
- Relabel the tile stepper to `tile size`.
- Add `selectedPreview` + `syncPreview()`; wire into `selectColor`/`syncUI`;
  point `.onclick` at `openPalette()`. Drop the `+`/`addBtn`.
- Move the eyedropper button into `.editor-ink-strip`; keep the transparent
  swatch in the palette box.
- `renderUsed()`: `FIXED_LEAD = 1` (transparent lead kept); render into
  `.editor-palette-box`; toggle `.is-empty` when no used colors.

**`src/main.js`**

- No structural change required (it talks to the editor via callbacks/`brush`).
- _Optional:_ reorder `TAB_ORDER` to match the mock (§9).

**`src/icons.js`**

- No new icon needed (eyedropper stays `sampler`). If the `+` is removed and
  `add` becomes unused, optionally drop its import.

**`README.md`**

- Update the "Drawing editor" section: the panel is now a fixed 3-region column
  (settings / draw / colors), the canvas fills the draw region (drop the "60% of
  the sidebar height" wording and the `CANVAS_FRACTION` reference), the modal is
  opened by the **selected-color preview** (not `+`), and the pencil size is a
  slider. Update the `?palette=1` note ("opens the modal" — now via the preview).

---

## 6. Dev-hook & screenshot preservation (must stay green)

| Hook           | Still works because                                          |
| -------------- | ------------------------------------------------------------ |
| `?edit=<face>` | tabs/remount unchanged                                       |
| `?tile=N`      | tile stepper logic + `onResizeTile` unchanged                |
| `?palette=1`   | still calls `openPalette()` (modal unchanged)                |
| `?cursor=N`    | `drawCursor()` runs after `layout()`; cursor layer unchanged |
| `?pick=N`      | `selectColor()` unchanged; now also lights the preview       |
| `?rect=…`      | rect preview draws on the cursor layer after `layout()`      |
| `?fill=…`      | `applyLocalFill()` unchanged                                 |

The canvas is now taller (draw region vs. old 60%), so **golden screenshots will
shift** — expected; re-capture references after the change.

---

## 7. Accessibility

- Every control stays a `<button>`/`<input>` with `aria-label`/`title` (tools,
  tabs, eyedropper, transparent, preview, slider, steppers) — carried over.
- **`clip-path` clips `outline`** — give tabs a `:focus-visible` **inset
  box-shadow** ring instead so keyboard focus is visible.
- The pencil slider is a native `<input type=range>` (keyboard + AT friendly);
  give it an `aria-label` (`pencil size, 1 to N px`).
- Selected-color preview: `aria-label="selected color — open the 256-color palette"`.

---

## 8. Implementation order (app runnable at every step)

1. **Shell + regions.** Add the flex CSS to `#editor-panel`/`.editor`; introduce
   the three region wrappers in `editor.js` and re-parent existing blocks (no
   behavior change yet). Verify nothing scrolls and everything still renders.
2. **Canvas fill.** Delete `CANVAS_FRACTION`, rewrite `layout()`, restyle
   `.editor-canvas-wrap` to `flex:1`, re-point the `ResizeObserver` to `wrap`.
   Verify the canvas grows to fill the draw region and stays crisp/centered on
   resize.
3. **Angled tabs.** Restyle `.editor-tab*` (clip-path, overlap, focus ring).
4. **Settings header.** Square tool-icon boxes; relabel tile size; add
   `rangeSlider()` + pencil branch.
5. **Colors tray.** Left ink strip (eyedropper/transparent/preview); scrollable
   `.editor-palette-box`; `renderUsed()` `FIXED_LEAD=0`; wire `syncPreview()`;
   drop `+`.
6. **Docs + re-capture.** Update `README.md`; refresh reference screenshots;
   `typecheck` + `lint` + `test`.

Each step leaves a working app, so you can screenshot after each.

---

## 9. Decisions (confirmed)

1. **Bottom-left strip.** Only the **eyedropper** and the **selected-color
   preview** break out (top → bottom). The **transparent** swatch stays in the
   "colors…" box. The selected-color preview is the modal opener (old `+`).
2. **Tab order.** Keep the current code order (`left right front back top
bottom`) — no `TAB_ORDER` change.
3. **Rect/fill contextual controls.** Keep the current corner-radius stepper and
   fill checkboxes as-is for now; refine later.
4. **Colors tray height.** `140px`.

---

## 10. Risks & mitigations

- **Flex `min-height:0` omissions** → the canvas can't shrink and the panel
  overflows. Mitigation: set `min-height:0` on `.editor` and `.editor-draw`;
  covered above.
- **`clip-path` focus ring loss** → keyboard users lose the tab focus indicator.
  Mitigation: `:focus-visible` inset shadow (§7).
- **ResizeObserver feedback** → avoided by observing `wrap` (never JS-resized)
  and the `s === scale` early-return.
- **Short windows** → `.editor-draw` `min-height` + panel `overflow-y:auto`
  fallback keeps the canvas usable instead of collapsing.
- **Golden screenshots drift** (taller canvas) → re-capture references; not a bug.
- **`renderUsed()` FIXED_LEAD regression** → the row now keeps exactly one fixed
  lead (the transparent swatch); `FIXED_LEAD` must become `1` (not `3`, not `0`)
  or either the transparent lead is wiped or stale swatches are orphaned.

```

```
