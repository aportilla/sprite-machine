# Plan: the 3D Sprite Atlas view (and the live Export Sprite Atlas…)

**Status:** implemented 2026-08-29 as planned (§6 steps 1–9 and the §7 doc
ritual; the defaults in §9 all kept; `npm test` 324, `drive.mjs` 260, the
two `?ring` captures `cmp` byte-identical). **As built, where the code
departs from the text below:** (1) the default four-view width is **285**,
not 283 — the plan's arithmetic missed the frame's two borders
(`ringWidthFor`); (2) the controls strip is **two rows** (views / elev over
from / scale — §3G's own fallback: four labeled fields don't fit one 285 px
row), so `RING_STRIP` = 63, `RING_CHROME.h` = 92, `RING_HEIGHT` = 162, and
the measured floor `RING_MIN_WIDTH` = 266 (the drive pins it); (3) the
ring renderer sets `preserveDrawingBuffer: true` — an offscreen canvas is
never composited, so nothing is left to the browser's clear timing; (4) the
lights are scene children re-posed per yaw at fixed offsets in the camera's
frame rather than camera children — the same effect, without depending on
the camera's matrix update; (5) a show **brings the windoid to the front**
of the windoid band (`syncUtility`) — a freshly shown palette comes up on
top (this began as a bridge: the kit's raise re-inserted a non-topmost
windoid at gesture end, cancelling that press's click, so the close box
only worked first-click on the topmost windoid; vintage-frames 0.5.4 moved
the re-insert into a task after the click, and the front-on-show stays as
behavior);
(6) `ringMetaChunks` is a standalone export of `state/ring.js`, not an
instance method; (7) the probe keeps `windows` as the four always-open
windows and reports the toggleable one as `ringShown` (the boot section's
"all four windows are open" check reads `windows`); (8) the follower takes
the renderer FACTORY (`initRing(createRingRenderer)`) and makes the GL
context on the first render, so a strip never shown costs the boot nothing
— and the drive's readiness waits gained a post-navigation quiet window
(a same-URL `Page.navigate` lands as two main-frame navigations in
headless Chrome; the stamp guard alone still let a probe read the second
page mid-boot on the plain-reload greet check). The fixed-point
argument in §3F holds on every tested raster; on one shorter than the top
band + the strip (~430 px) the strip's top edge reads as a top strut too
and the near edge wins — noted in `layout.js`'s header, accepted. ·
**Planned:** 2026-08-29 on `9897f50` (dithered paper) · **Depends on:**
nothing outside this repo — no kit change (see §3F: the kit's utility
window already carries an optional close box).

A fourth utility windoid, **3D Sprite Atlas** — off by default, a checkmark
toggle in the **View** menu — showing a **horizontal strip of thumbnails**:
the active document's 3D model rendered **orthographically** from a **ring of
evenly stepped yaw angles** at one **elevation**, the way an engine consumes
a pre-rendered rotation set. Defaults: **4 views** (a 90° step), **45° above
the horizon**, first view **from the front**, **1 px per voxel**. The strip
carries its settings across its top; **File → Export Sprite Atlas…** (the
parked configurator) comes alive as a second control surface over the same
settings — its fields read whatever the view is set to, and **Export saves
exactly the pixels the strip shows** (the strip and the file are the same
rendered sheet). Export 3D Model… stays parked, untouched.

This document is written to be picked up cold: it names every file, seam,
signature and gate. Read it top to bottom once, then work §6 in order. Where
it references a line number that is "at the time of writing" — re-find by the
named method; the names are stable.

> **Naming, before anything else.** Three words are already taken: _atlas_
> is the 3×2 document sheet (`sm-atlas-view` IS the Full Sprite View,
> `ATLAS_GRID` its grid); _spin_ is the stage's auto-rotate
> (`stage.setSpinTarget`); and _sprite_ is the Full Sprite View windoid's id
> (`#win-sprite`). The code name for this feature is **`ring`** — the
> README's own phrase for the export ("a stepped ring of angles"):
> `#win-ring`, `<sm-ring-view>`, `state/ring.js`, `lib/ring.js`,
> `scene/ring-renderer.js`, `prefs.showRing`, `?ring=`, `kind="ring"`. The
> UI copy says **3D Sprite Atlas** (the menu item, the windoid heading) and
> the exported file is `«slug»-atlas.png`. Never `spin`, never `atlas`, in
> code.

---

## 1. Locked decisions

1. **A windoid, not a panel.** It floats on the utility tier with the other
   three (never takes the active state, hides with the application), but
   unlike them it is **toggleable**: View → 3D Sprite Atlas (checkmark) shows
   and hides it, and it **has a close box** (the kit's utility bar draws one
   unless `closable` is turned off — the three permanent windoids turn it
   off; this one keeps it), whose close unchecks the item. MacPaint's and
   System 7's palettes closed from their box and came back from the menu.
2. **Off every load.** `prefs.showRing` boots `false`, like `showGuides`
   (nothing in prefs persists). `?ring=…` shows it for captures.
3. **Fixed-size, width follows the view count.** A picture frame like the
   Sprite View: no grow box; `RING_HEIGHT` is a constant, the width is
   `ringWidthFor(views)` — one 70px cell per view (`ATLAS_GRID.cell`, the
   Sprite View's own cell size) with the grid's 1px rules and the frame's
   borders — floored at the controls strip's content width. Changing the
   view count re-fits the windoid live (the `fitSprite` precedent). No
   scrolling (decision **A** in §9 if you want the kit's rail instead).
4. **Docked bottom, under the document.** The placement puts it left-aligned
   with the doc box, its bottom on the raster's bottom margin. While it is
   shown, the placement **shortens the doc box** so a fresh open or Arrange
   Windows lands the document clear of it; toggling it on never moves an
   existing window (System 7 didn't rearrange your windows when you showed
   a palette — Arrange does). Its edges make it a **fixed point of the
   nine-slice pin without touching `WINDOW_FRAME`** (§3F).
5. **The frame is the lattice's envelope, not the content's.** Every frame
   is a square of `F` px sized so the whole `nx×ny×nz` voxel box fits at
   every yaw and this elevation (the box's XZ bounding circle swept up its
   height — §3B). So the frame never changes size between angles, between
   strokes, or with the first-angle offset: a sprite can't jitter in an
   animation, and one setting change is one predictable re-layout. The
   model is centered on the lattice's center; the lattice floor's center
   projects to the **same row in every frame** — the engine anchor, written
   into the export's metadata.
6. **Orthographic, `scale` px per voxel, nearest-neighbor.** No
   antialiasing and no smoothing anywhere in the copy chain: a
   1-px-per-voxel sprite is pixel art at the source's own resolution.
   `scale` (1–8) is the one size control; the frame size is a readout
   derived from it.
7. **The lights ride with the camera.** In an engine the camera and the sun
   are fixed and the OBJECT turns, so the light's direction relative to the
   camera is constant across the ring. Rendering that with a camera that
   orbits means the rig orbits too: the stage's ambient + key + fill,
   expressed in the camera's frame (decision **E**). No ground plane, no
   shadow in the sprite (**F**): the ground is the 3D View's furniture.
8. **Settings are app-level and session-only**, in a `ring` slice
   (`views`, `elevation`, `offset`, `scale`; clamped setters; silent
   no-ops) — the prefs discipline. Per-document persistence in a PNG chunk
   is a follow-up (§8, decision **D**).
9. **The dialog edits live.** Its fields are bound two-way to the slice —
   a change in the dialog moves the strip behind the modal at once, and
   Cancel doesn't revert (the settings are non-destructive; the strip IS
   the preview). Not the Colors dialog's pending model (decision **H**).
10. **Export = the strip's sheet.** One renderer produces one **sheet
    canvas** (`views·F × F`); the strip's cells are `drawImage` slices of
    it, and Export encodes THAT canvas to PNG — plus `Title`, `Software` and
    a `sprite-machine:ring` text chunk carrying the settings, the frame,
    the yaw list and the anchor (§3H). Export is enabled whenever a model
    exists (the build slice has `dims`), whether or not the view is shown:
    the renderer renders on demand.
11. **Yaw runs front → right → back → left.** Yaw 0 puts the camera on `+z`
    (the FRONT face toward it); positive yaw walks the camera toward `+x`,
    so the second of four views shows the RIGHT face (decision **J**).
12. **The rebuilder stays the pipeline's only consumer.** The ring renderer
    consumes the **mesh** the rebuilder made (a shared-geometry clone), via
    one new `onMesh` callback — it never runs `buildVoxels`.

---

## 2. How it fits: the seams that already exist

| Need                                     | Exists as                                                                                                 | Where                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A View-menu checkmark toggle             | `guides` ↔ `prefs.showGuides`: the pick flips the slice, `syncView` mirrors the check, `DOC_SCOPED` gate | `index.html` L79–94; `shell/menus.js` `syncView`, `DOC_SCOPED` |
| Windoid visibility off a flag            | `syncUtility` (`hidden = !appActive`), `WINDOW_IDS`, `hiddenAtBoot`                                       | `shell/windows.js` ~L292–300; `state/shell.js` `WINDOW_IDS`    |
| A close box that means something         | `onClose` on the desktop (`vf-close`, `target instanceof VfWindow`)                                       | `shell/windows.js` ~L617–623                                   |
| A fixed-size windoid whose size derives  | `fitSprite` / `spriteHeightFor` / `SPRITE_WIDTH` / `SPRITE_CHROME`                                        | `shell/windows.js` ~L177–192; `shell/layout.js` L115–148       |
| Placement + the fixed-point contract     | `initialPlacement`, `pinOf`/`pinTo`, the anchor rule for fixed-size boxes                                 | `shell/layout.js`; `test/layout.test.mjs` L456                 |
| A windoid body with a controls strip     | `sm-stage-controls` (24px band, `live()` bindings → prefs)                                                | `src/components/sm-stage-controls.js`                          |
| A grid of live cell canvases on paper    | `sm-atlas-view`: `vf-grid frameless`, per-cell `PatternFillController`, native-res backing + CSS scale    | `src/components/sm-atlas-view.js`                              |
| A status line with a stats tooltip       | `sm-status-line kind="build"` (`title` = the probe surface)                                               | `src/components/sm-status-line.js`                             |
| The mesh, per rebuild                    | `initRebuilder`: `current` swapped into `stage.scene`, `stage.setSpinTarget(current)`                     | `src/scene/rebuilder.js` `rebuild()`                           |
| The stage's light rig + renderer setup   | ambient 0.85 / key 1.5 @ (4,8,3) / fill 0.35 @ (−5,3,−4); `alpha: true`, `SRGBColorSpace`                 | `src/scene/stage.js` L33–73                                    |
| Voxel → world scale                      | `s = DEFAULT_WORLD_SIZE / max(nx,ny,nz)`; X/Z centered, Y from 0 (`finishVoxelMesh`)                      | `lib/mesh.js` L26; `lib/mesh-util.js` L42; `lib/constants.js`  |
| The parked dialog                        | `#dlg-export-atlas` (views / elevation / first angle, all `disabled`), `export-atlas` menu case           | `index.html` L461–522; `shell/menus.js` L99, L492              |
| A dialog that mirrors a slice while open | `syncProps` (re-sync on store change while `dlg.open`)                                                    | `shell/menus.js` ~L372–403                                     |
| PNG bytes + text chunks + download       | `imageDataToBlob`, `downloadPngBytes`; `setTextChunks`; `docFilename`, `SOFTWARE`                         | `src/image-io.js`; `lib/png-chunks.js` L199; `state/files.js`  |
| A store with a live channel              | `doc.subscribe` (structural) + `doc.onLive` (hot, imperative subscribers)                                 | `src/state/doc.js` (the shape to copy, not the code)           |
| Boot params → seeds                      | `parseBootParams` → `main.js` seed block (`?guides=1` → `prefs.setShowGuides`)                            | `src/boot/params.js`; `src/main.js` L58–60                     |
| Trusted-input regression                 | `probe()` (`windows`, `menuChecks`, `menuEnabled`), `pickMenu`, `layoutSnap`, the layout oracle import    | `tools/drive.mjs` ~L329–483, L911, L2943; L57–68               |

Nothing in the voxel pipeline, the doc slice, the history, the workspace or
the files slice changes. The feature is: one pure math module, one state
slice, one renderer, one follower, one component, one windoid's markup, the
registration ritual (menu / windows / layout), and the dialog's wiring.

---

## 3. Design

### 3A. The picture

```
┌ 3D Sprite Atlas ──────────────────────── ▪ ┐   ← utility bar, WITH a close box
│ views [4] elev [45] from [0] scale [1]     │   ← controls strip (24px)
├───────┬───────┬───────┬───────┤            │
│  ▲    │   ▶   │   ▼   │   ◀   │            │   ← N cells, 70px, kit gray-25 paper
│ front │ right │ back  │ left  │            │      (the frame, CSS-scaled to the cell)
├───────┴───────┴───────┴───────┴────────────┤
│ 4 × 69 px                                   │   ← status line; tooltip carries the numbers
└─────────────────────────────────────────────┘
```

Placed at the doc box's left, docked to the bottom margin, under the
document window. Width = the N cells; the default strip is 283 system px
wide (§3F) and `RING_HEIGHT` tall.

### 3B. Pure math — `src/lib/ring.js` (new, Node-tested)

Voxel units throughout; the renderer multiplies by `s` (world units per
voxel) once. Angles in degrees at the API, radians inside.

```js
/** The N yaws of a ring: offset + i·(360/n), i = 0..n−1 (unwrapped). */
export function ringYaws(views, offset) → number[]

/** The lattice's projected envelope at an elevation: the nx×nz footprint's
 *  bounding CIRCLE (radius r = hypot(nx, nz) / 2 — the box turns inside it,
 *  so the envelope is the same at every yaw) swept up the height:
 *    width  = 2r
 *    height = ny·cos e + 2r·sin e
 *  (e = 0: the side elevation, ny tall; e = 90: the plan, 2r tall.) */
export function ringEnvelope(dims, elevation) → { width, height }

/** The frame: a SQUARE of F = ceil(max(width, height) · scale) px, and the
 *  orthographic half-extent that puts exactly `scale` px on a voxel:
 *  half = F / (2·scale) (voxel units — ≥ the envelope's half, so the box
 *  always fits, centered). */
export function ringFrame(dims, elevation, scale) → { px, half }

/** The sheet: views frames side by side, one row. */
export function ringSheet(views, framePx) → { width, height }

/** Unit camera direction (from the lattice center OUT to the camera):
 *  [sin yaw · cos e, sin e, cos yaw · cos e]. Yaw 0 → +z (FRONT faces the
 *  camera), yaw 90 → +x (RIGHT), elevation → up. */
export function ringCameraDir(yaw, elevation) → [x, y, z]

/** The camera's screen-up vector for that pose — the true one, so e = 90
 *  (straight down, where lookAt's default +y up degenerates) is well
 *  defined: [−sin e · sin yaw, cos e, −sin e · cos yaw]. Unit, ⟂ dir. */
export function ringCameraUp(yaw, elevation) → [x, y, z]

/** The lattice center the camera looks at and the frame centers on:
 *  [0, ny / 2, 0] (X/Z are centered by finishVoxelMesh, Y runs from 0). */
export function ringCenter(dims) → [x, y, z]

/** Where the lattice floor's center (0,0,0) lands in EVERY frame, in px
 *  from the frame's top-left: x = F/2, y = F/2 + (ny/2)·cos e·scale. The
 *  engine anchor (feet-row), yaw-independent by construction. */
export function ringAnchor(dims, elevation, scale, framePx) → { x, y }
```

Worked numbers (the Car, tile 40 ⇒ dims 40³, the drive's oracle): r = 28.28,
envelope at 45° = 56.57 × 68.28 ⇒ **F = 69** at scale 1, sheet **276 × 69**
for four views, anchor y = 34.5 + 14.14 = **48.6**. At scale 2, F = 137.

Why the circle and not the box's exact silhouette per yaw: the exact
silhouette changes with the angle (a cube is 1.41× wider at 45°), so the
frame would change between views and the sprite would appear to breathe;
the circle is the smallest envelope that is the same at every yaw. It is
loose at yaw 0 (the cube uses 40 of the 56.57 width) — accepted, the sprite
stays centered and the loose margin is transparent.

### 3C. State — `src/state/ring.js` (new, Node-tested) + `prefs.showRing`

```js
export const RING_DEFAULTS = { views: 4, elevation: 45, offset: 0, scale: 1 };
export const RING_MAX_VIEWS = 16;   // the dialog's own top — beyond it the strip is a wall
export const RING_MAX_SCALE = 8;

export function createRing() {
  const store = createStore({ ...RING_DEFAULTS });
  // The SHEET CHANNEL — the doc's onLive shape: hot, imperative, never
  // through the store (a render lands per rebuild frame during a stroke).
  let sheet = null;                      // { canvas, frame, views } | null
  const listeners = new Set();
  return {
    store, get, subscribe,
    setViews(n)      // int, clamped 1..RING_MAX_VIEWS; NaN → no-op
    setElevation(d)  // int, clamped 0..90
    setOffset(d)     // int, normalized into [0, 360)
    setScale(n)      // int, clamped 1..RING_MAX_SCALE
    publishSheet(s)  // stores by reference, calls every listener with it
    sheet()          // the last published, or null
    onSheet(fn)      // → unsubscribe
    // The export's metadata chunk (pure; the exporter passes what it knows):
    ringMetaChunks(name, settings, { frame, anchor, yaws })
      → { Title: `${name} atlas`, Software: SOFTWARE, 'sprite-machine:ring': JSON }
  };
}
export const ring = createRing();
```

Every setter is a silent no-op on an unchanged value (the `shell.js`
idiom). `SOFTWARE` comes from `state/files.js` (the schema marker). The
chunk's JSON: `{ views, elevation, offset, scale, frame, anchor: {x, y},
yaws: [...] }` — enough for an engine importer to slice and align the sheet.

`prefs.js`: `showRing: false` + `setShowRing(v)`; the header comment gains
the line ("the 3D Sprite Atlas windoid's toggle — View → 3D Sprite Atlas,
`?ring=…`").

### 3D. The renderer — `src/scene/ring-renderer.js` (new)

Its own THREE world on an **offscreen canvas that never enters the DOM**:

```js
export function createRingRenderer() {
  const gl = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: false, alpha: true });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;   // the stage's — colors agree
  const scene = new THREE.Scene();                    // background null
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  scene.add(camera);                                  // so the camera's children render
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);   // the stage's rig, in the
  const fill = new THREE.DirectionalLight(0xcfd6ff, 0.35); // CAMERA's frame (decision 7)
  camera.add(key, fill);   // positions set in camera-local space; targets in the scene
  scene.add(key.target, fill.target);
  const sheet = document.createElement('canvas');    // the 2D copy — the durable pixels
  let subject = null;                                 // { clone, dims } | null
  return {
    setSubject({ mesh, dims } | null),  // drop the old clone; mesh.clone() shares
                                        // geometry + material; castShadow/receiveShadow
                                        // off; rotation reset (the stage's auto-rotate
                                        // never leaks in)
    render(settings) → sheet,           // the whole strip, synchronously (below)
    dispose(),                          // renderer.dispose() + forceContextLoss()
  };
}
```

`render({ views, elevation, offset, scale })`:

1. `dims` from the subject (no subject → size the sheet, clear it, return
   it: the strip shows paper). `s = DEFAULT_WORLD_SIZE / max(nx, ny, nz)` —
   the exact expression `voxelMesh` / `wedgeMesh` use (if a `worldSize`
   option ever reaches them, thread it here too).
2. `{ px: F, half } = ringFrame(dims, elevation, scale)`; `{ width, height }
= ringSheet(views, F)`; `renderer.setSize(width, height, false)`.
3. `center = ringCenter(dims) · s`; `dist = 2 · hypot(nx, ny, nz) · s`
   (anything clear of the box — orthographic); camera `near = 0.1`, `far =
3·dist`; `left/right = ∓half·s`, `top/bottom = ±half·s`;
   `updateProjectionMatrix()` once (the frustum is the same for every yaw).
4. Light rig in camera space: the key above-right-behind the camera, the
   fill below-left — start from the stage's world positions rotated into
   the default framing's camera frame and **tune by eye** so the front view
   at 45° reads like the 3D View's default framing; both targets at
   `center`.
5. Per yaw `θ` of `ringYaws(views, offset)`, index `i`: `camera.up.set(
...ringCameraUp(θ, elevation))`; `camera.position.copy(center)
.addScaledVector(dir(θ), dist)`; `camera.lookAt(center)`;
   `renderer.setViewport(i·F, 0, F, F)`; `renderer.setScissor(same)`;
   `renderer.setScissorTest(true)`; `renderer.render(scene, camera)`.
6. `sheet.width = width; sheet.height = height;` then
   `sheet.getContext('2d').drawImage(gl, 0, 0)` — **in the same task as the
   renders**, which is what makes `preserveDrawingBuffer: false` safe (the
   drawing buffer survives until the next compositor frame). Return `sheet`.

The same renderer serves the strip and the export: the sheet IS the file.
Two GL contexts on the page (the stage's and this one) — fine; both upload
their own copy of the shared geometry and the rebuilder's `dispose()` on a
rebuild releases each renderer's copy through THREE's `dispose` event.
Headless Chrome's SwiftShader path already renders the 3D View
byte-identically across capture runs, so the sheet is capture-stable too.

### 3E. The follower — `src/scene/ring.js` (new): cadence, gating, publishing

```js
export function initRing(renderer) {
  let subject = null, dirty = true, raf = 0;
  const schedule = () => {
    dirty = true;
    if (!prefs.get().showRing) return;          // hidden: remember, don't render
    if (!raf) raf = requestAnimationFrame(flush);
  };
  const flush = () => {                         // ONE render per frame, at most
    raf = 0;
    if (!dirty) return;
    dirty = false;
    const settings = ring.get();
    const canvas = renderer.render(settings);
    ring.publishSheet({ canvas, frame: …, views: settings.views });
  };
  return {
    setSubject(sub) { subject = sub; renderer.setSubject(sub); schedule(); },  // the rebuilder's onMesh
    renderSheet() { … render now regardless of showRing, publish, return canvas },  // Export
    dispose() { cancelAnimationFrame(raf); unsubs…; renderer.dispose(); },
  };
  // subscriptions: ring.subscribe(schedule) — any setting;
  //   prefs.subscribe: showRing false → true with dirty ⇒ schedule() (a show renders at once).
}
```

Why not render on every rebuild unconditionally: the rebuilder runs at the
live channel's rAF rate during a stroke; rendering N frames + a canvas copy
per stroke frame while the windoid is hidden would be pure waste. Shown, one
render per frame is the same cost class as the Sprite View's per-frame blit.

**The rebuilder's one change** (`scene/rebuilder.js`): `initRebuilder(stage,
{ flat, diag, onMesh })`. `removeMesh()` calls `onMesh?.(null)` BEFORE
disposing (the clone must be out of the ring scene when its geometry dies);
`rebuild()` calls `onMesh?.({ mesh: current, dims: result.dims })` right
after `stage.scene.add(current)`. The empty-build paths already go through
`removeMesh()`. `main.js`:

```js
const ringR = createRingRenderer();
const ringFollow = initRing(ringR);
const rebuilder = initRebuilder(stage, { flat, diag, onMesh: ringFollow.setSubject });
```

and `ringFollow` is handed to `initMenus` (§3H) and disposed under HMR with
the rest.

### 3F. The windoid: markup, visibility, close box, placement, the pin

**Markup** (`index.html`, after `#win-stage`, with a comment in the file's
voice — the arithmetic below restated there):

```html
<vf-window id="win-ring" variant="utility" heading="3D Sprite Atlas" movable flush>
  <sm-ring-view pattern="gray-25"></sm-ring-view>
  <sm-status-line kind="ring" slot="status"></sm-status-line>
</vf-window>
```

Not `resizable`; `closable` left at its default (true). No authored size —
`shell/windows.js` derives it (below). `syncUtility` hides it at wire-up
like the other three, so no `hidden` in the markup is needed.

**`state/shell.js`**: `WINDOW_IDS = ['tools', 'sprite', 'stage', 'ring']` —
every loop in `windows.js` (placement, re-pin, `?hide=`, visibility) then
covers it. The header comment's "three permanent windoids — no flags" gains
the exception.

**`shell/layout.js`** (pure, tested):

```js
// The 3D Sprite Atlas windoid — a fixed-size picture frame like the Sprite
// View: width chrome = the 2 side borders; height chrome = 12 dot bar + 2
// borders + 24 controls strip + 15 status = 53, over one row of cells.
export const RING_CHROME = { w: 2, h: 53 };
export const RING_HEIGHT = RING_CHROME.h + ATLAS_GRID.cell;      // 123
// The controls strip's content width (measure at implementation — the
// STAGE_MIN_WIDTH ritual): the floor under a short strip.
export const RING_MIN_WIDTH = /* measured */;
/** n cells of ATLAS_GRID.cell with the grid's n−1 rules and the borders. */
export function ringWidthFor(views) {
  return Math.max(RING_MIN_WIDTH, views * ATLAS_GRID.cell + (views - 1) + RING_CHROME.w);
}
```

`initialPlacement(desktopW, desktopH, tools, { ringViews = 4, ringShown =
false } = {})` gains a fourth, optional argument and a `ring` box in its
result:

```js
const ring = {
  left: x0, // the doc box's left — the document's footer
  top: desktopH - GAP - RING_HEIGHT, // docked on the bottom margin
  width: ringWidthFor(ringViews),
  height: RING_HEIGHT,
};
// While shown, the strip takes its band + a GAP out of the vacancy's height
// BEFORE the cascade room is subtracted, so every cascade slot still lands
// above it (a sixth window that wraps is the existing rule).
const vacantH = Math.max(0, desktopH - GAP - top - (ringShown ? RING_HEIGHT + GAP : 0));
```

`zoomedBox(desktopW, desktopH, pos, { ringShown = false } = {})` subtracts
the same band from its bottom edge, so a zoom never runs under a shown
strip (decision **B** if you'd rather it did).

**The pin, unchanged.** Placed on a 980×830 raster with four views: left
edge 58 (in the 100px left band → near strut), right edge 341 (a spring),
top 699 → 131 from the bottom (outside the 100px bottom band → a spring),
bottom 8 from the bottom (far strut). For a FIXED-size box the anchor rule
resolves each axis by its lone strut: the left edge holds, the bottom edge
holds — so a resize lands the strip exactly where `initialPlacement` puts it
on the new raster, **with `WINDOW_FRAME` untouched**, at any view count (a
wide strip's right edge in the right band is a second strut of the opposite
kind, and "opposite struts keep the near edge"). `test/layout.test.mjs`'s
fixed-point loop gains the ring at `{ size: { width: ringWidthFor(4),
height: RING_HEIGHT } }` and again at 16 views. **Never make this windoid
`resizable`** without redoing this argument: a resizable box's top edge
would spring.

**`shell/windows.js`**:

- The `closable = false` loop excludes `'ring'` (a `PERMANENT` set, or `if
(id !== 'ring')`); the header comment's UTILITY WINDOIDS paragraph gains
  the exception.
- `smartLayout()` passes `{ ringViews: ring.get().views, ringShown:
prefs.get().showRing }`; `onZoom` passes `{ ringShown }` to `zoomedBox`.
- `fitRing()`: `byId.ring.width = ringWidthFor(ring.get().views);
byId.ring.height = RING_HEIGHT;` — called by `placeWindoid('ring')` (the
  `fitSprite` slot) and from a `ring.subscribe` guarded on the computed
  width changing (the `refit` idiom). A width write on a non-resizable
  window is no "touch" for the pin cache (it compares position only), so
  the left edge holds through a view-count change.
- `syncUtility`: `byId.ring.hidden = !appActive || !prefs.get().showRing ||
hiddenAtBoot.has('ring')`; subscribe to `prefs` as well as `shell`.
- `onClose`: before the document-key path, `if (t === byId.ring) {
prefs.setShowRing(false); return; }` — the close box is the menu's
  uncheck, one truth.

### 3G. The body — `<sm-ring-view>` (new) and `sm-status-line kind="ring"`

`src/components/sm-ring-view.js`, a CONNECTED chrome component in the
`sm-atlas-view` shape:

- **Controllers:** `StoreController(this, ring.store)` (settings → the
  template: N cells, the fields' `live()` values) and `StoreController(this,
build.store)` (dims → the cells' backing size). The PIXELS never go
  through the store: `connectedCallback` subscribes `ring.onSheet(sheet =>
this.#paint(sheet))`, `disconnectedCallback` unsubscribes (the desktop
  re-inserts a windoid's node to raise it — the same reconnect the atlas
  view survives), `firstUpdated` paints `ring.sheet()` (the sheet it
  missed).
- **Template:** a `.controls-strip` (the `sm-stage-controls` band: 24px,
  white over a 1px rule, `--vf-scale` metrics) holding four compact
  `vf-number-field`s with dim captions (`sm-tool-options`'s `radius`
  idiom): `views` 1–16, `elev` 0–90, `from` 0–359, `scale` 1–8 — each
  `.value=${live(String(v))}` and `@vf-change` → the setter
  (`e.detail.valueAsNumber`, NaN-guarded). Shrink the inputs with the kit's
  own token (`--vf-number-field-width`, default `4em` — 3em holds three
  digits). Aim for a content width ≤ 283 (four cells) so the default strip
  has no slack; **measure it, and that number is `RING_MIN_WIDTH`**. If it
  can't be met, the grid centers in the body with white slack either side
  (the Sprite View's picker block has a pixel of slack each side — same
  posture), or go two rows (`RING_CHROME.h` += 24).
- Below it, `.ring-box` (flex 1, centered) holding `<vf-grid columns=${n}
rows="1" cell-width=${ATLAS_GRID.cell} cell-height=${ATLAS_GRID.cell}
frameless>` with N `<div class="ring-cell vf-pattern-fill">` cells (a
  `title` naming the yaw, `role="img"` + `aria-label`), each holding a
  `<canvas>`. A cell's backing store is the frame's native `F × F` px, CSS
  scales it to the 70px cell with `image-rendering: pixelated` — the atlas
  view's "native-resolution backing, crisp CSS scale" rule, so a thumbnail
  is the true pixels, never a resample.
- **Paper:** one `PatternFillController` per cell, from a fixed pool of
  `RING_MAX_VIEWS` refs created in the constructor (`getBox` returns the
  ref's value — null for an unrendered cell, which the controller must
  paint nothing for; verify, else gate the pool on `n`), `getSize` the
  declared cell. `pattern` attribute parsing = the atlas view's `willUpdate`
  (lift `parsePattern` + the once-warning into a shared `patternAttr()`
  helper in `ui-bits.js` and use it from both).
- **`#paint(sheet)`:** for each cell `i`: size the backing to `F` if it
  changed, `clearRect`, `drawImage(sheet.canvas, i·F, 0, F, F, 0, 0, F, F)`
  with `imageSmoothingEnabled = false`; a null sheet clears every cell.
- **Cursor:** the cells take no claim (nothing to press); the number fields
  are kit controls and claim their own.

`sm-status-line`: a `kind="ring"` branch. Text `${views} × ${F} px` (with
no model — `build.dims` null — `${views} views`); the `title` tooltip
carries the full readout the probe parses: `frame F×F px · sheet W×H px ·
E° · from O° · S×`. It reads `ring.store` (add the `StoreController` — one
more subscription per status line, trivial) and `build.store` (already
there), computing `F` through `ringFrame(build.get().dims, …)`.

### 3H. The menu item, the dialog, the export

**View menu** (`index.html` L79–94): `<vf-menu-item value="ring">3D Sprite
Atlas</vf-menu-item>` right after Guides, with a comment in the Guides
comment's voice (a checkmark toggle over `prefs.showRing`; off every load;
document-scoped; the windoid's close box unchecks it). `menus.js`:
`case 'ring': prefs.setShowRing(!prefs.get().showRing)`; `syncView` sets
`itemRing.checked = prefs.get().showRing`; `'ring'` in `DOC_SCOPED`.

**The dialog** (`#dlg-export-atlas`, L461–522) goes live:

- `#atlas-views` becomes a `vf-number-field` 1–16 (decision **I**; the
  select's five presets don't cover "regular angle steps" — any `n` is a
  360/n step); `#atlas-elevation` default 45 (**L**); `#atlas-offset` as
  is; a new **Scale** row (`#atlas-scale`, 1–8, "px per voxel"); and a
  **readout row** (`#atlas-dims`, a `vf-label`: `frame 69 × 69 px · sheet
276 × 69 px`, `—` with no model). Every `disabled` comes off the fields.
  The Export button's `disabled` is menus.js's to manage. Re-derive the
  height (five rows now; state the arithmetic in the markup comment as the
  About box does; ~300) and the heading comment (no longer PARKED — the
  model dialog's comment keeps that word for itself alone).
- `menus.js`: `showRingDialog()` seeds the four fields from `ring.get()` and
  shows; `syncRingDialog()` — while `dlgExportAtlas.open` — re-seeds the
  fields (so a strip edit behind the modal shows up), recomputes the readout
  from `build.get().dims`, and sets `btnExportAtlasOk.disabled =
!build.get().dims`; subscribed to `ring`, `build` and `shell`. Each
  field's `vf-change` → the matching setter (live, decision 9). Cancel and
  the close box just close. `case 'export-atlas': showRingDialog()`.
- **Export** (`#btn-export-atlas-ok` click):

  ```js
  const ctx = workspace.active();
  if (!ctx) return;
  const canvas = ringFollow.renderSheet(); // the strip's exact pixels
  const dims = build.get().dims;
  const st = ring.get();
  const { px: F } = ringFrame(dims, st.elevation, st.scale);
  const bytes = setTextChunks(
    await canvasToPngBytes(canvas),
    ring.ringMetaChunks(ctx.name, st, {
      frame: F,
      anchor: ringAnchor(dims, st.elevation, st.scale, F),
      yaws: ringYaws(st.views, st.offset),
    })
  );
  downloadPngBytes(bytes, ringFilename(ctx.name));
  dlgExportAtlas.close();
  ```

  `canvasToPngBytes(canvas)` is new in `image-io.js` beside
  `imageDataToBlob` (a `toBlob('image/png')` → bytes); `ringFilename(name)`
  sits beside `docFilename` in `state/files.js` — the same slug with
  `-atlas` before `.png` (`car-atlas.png`, decision **K**). `initMenus`
  takes `{ patterns, ring: ringFollow }`. Failures land on
  `build.setError(...)` like Download's.

The parked **Export 3D Model…** dialog and its Cancel-only wiring are
untouched; the shared "PARKED" comments in `index.html` and the `menus.js`
header now describe it alone.

### 3I. The capture hook — `?ring=<views>[,<elevation>[,<offset>[,<scale>]]]`

The capture tool can't pull a menu; a shot of the strip needs a hook, like
`?guides=1`:

- `params.js`: `ring: { views, elevation, offset, scale } | null` — present
  (with a valid first integer ≥ 1) means "show the windoid"; each missing or
  invalid trailing field keeps its default (the slice's own clamps apply at
  seed). `?ring=4` is the default set; `?ring=8,30,0,2` an eight-view sheet
  at 30° and 2 px/voxel. The header comment's hook list and the returned
  object gain it.
- `main.js` (the seed block, after `?guides`): `if (boot.ring) {
prefs.setShowRing(true); ring.setViews(…); ring.setElevation(…);
ring.setOffset(…); ring.setScale(…); }`.
- `?hide=ring` works through `WINDOW_IDS` for free; README's `?hide=` list
  gains it.

Shots: `tools/capture.sh shot
'http://localhost:5173/?fresh=1&sample=car&edit=front&rotate=0&now=2026-08-24T19:27&ring=4'
/tmp/ring-a.png` and `…&ring=8,30,45,2` (eight views, a low elevation, an
offset, 2×). Two runs of each must `cmp` byte-identical (the ring renderer
is one more SwiftShader pass — the 3D View already proves that path
stable).

---

## 4. File-by-file changes

**New**

- `src/lib/ring.js` — §3B; header in the `guides.js` / `select.js` voice
  (the envelope argument, the yaw convention, the anchor).
- `src/state/ring.js` — §3C (settings + the sheet channel + the meta chunk).
- `src/scene/ring-renderer.js` — §3D.
- `src/scene/ring.js` — §3E.
- `src/components/sm-ring-view.js` — §3G.
- `test/ring.test.mjs`, `test/ring-state.test.mjs` — §5A.

**Modified**

- `src/state/prefs.js` — `showRing` + `setShowRing`; header.
- `src/state/shell.js` — `WINDOW_IDS` + `'ring'`; header.
- `src/state/files.js` — `ringFilename`.
- `src/shell/layout.js` — `RING_CHROME`, `RING_HEIGHT`, `RING_MIN_WIDTH`,
  `ringWidthFor`; `initialPlacement`'s opts + `ring` box + the shortened
  vacancy; `zoomedBox`'s opts; header.
- `src/shell/windows.js` — the closable exemption, `fitRing`, the prefs
  subscription in `syncUtility`, the close-box case in `onClose`,
  `smartLayout`'s opts, `onZoom`'s opts; header.
- `src/shell/menus.js` — the View case + checkmark + `DOC_SCOPED`; the
  live dialog (seed / sync / setters / Export); `initMenus`'s third arg;
  imports (`ring`, `ringFrame`, `ringAnchor`, `ringYaws`, `setTextChunks`,
  `canvasToPngBytes`, `ringFilename`); header.
- `src/scene/rebuilder.js` — `onMesh`; header.
- `src/components/sm-status-line.js` — `kind="ring"`; header.
- `src/components/sm-atlas-view.js`, `src/components/ui-bits.js` — the
  shared `patternAttr()` helper (a lift, no behavior change).
- `src/image-io.js` — `canvasToPngBytes`.
- `src/main.js` — the `?ring` seed, the renderer + follower + `onMesh`
  wiring, `initMenus`'s `ring`, the component import, HMR dispose.
- `src/boot/params.js` — `?ring`.
- `index.html` — the View item, the windoid, the live dialog markup, the
  three comments (View menu, windoids, export dialogs).
- `test/layout.test.mjs` — §5A; `test/params.test.mjs` — the `?ring`
  cases + the all-params snapshot (`ring: null`).
- `tools/drive.mjs` — §5B (the probe's `windows.ring` / `menuChecks.ring`
  / `menuEnabled.exportAtlas`, a new section, two positive counterparts in
  the view-menu section).
- `README.md`, `docs/SMOKE-TEST.md` — §7.

---

## 5. Verification

### 5A. Node (`npm test`)

`test/ring.test.mjs` (pure, the `guides.test.mjs` shape):

- `ringYaws`: n = 4 / offset 0 → `[0, 90, 180, 270]`; offset 45 → each +45;
  n = 1 → `[offset]`; the step is 360/n for n = 3 and 7 (non-integers).
- `ringEnvelope`: e = 0 → `{ 2r, ny }`; e = 90 → `{ 2r, 2r }`; the height is
  monotone in e for a box taller than it is wide and the reverse for a flat
  one; dims 40³ at 45° ≈ `{ 56.57, 68.28 }`.
- `ringFrame`: `px === ceil(max(w, h)·scale)`; `2·half·scale === px`; both
  envelope halves ≤ `half`; dims 40³ / 45° / 1 → 69, / 2 → 137; the frame is
  the same for every offset (the API takes none — assert the arity, a
  guard against a future "tight per-yaw" regression).
- `ringCameraDir` / `ringCameraUp`: unit length; dir(0, 0) = `[0,0,1]`,
  dir(90, 0) = `[1,0,0]`, dir(θ, 90) = `[0,1,0]`; dir · up = 0 for a grid
  of (θ, e) including e = 90; up(θ, 0) = `[0,1,0]`.
- `ringAnchor`: e = 0 → `{ F/2, F/2 + (ny/2)·scale }`; e = 90 → `{ F/2,
F/2 }`; yaw-independent by arity.
- `ringSheet`: `{ n·F, F }`.

`test/ring-state.test.mjs` (the `shell.test.mjs` shape): the defaults;
each setter's clamp / int / NaN no-op / silent-on-unchanged (`fired`
counts); `setOffset(370)` → 10, `(-10)` → 350; the sheet channel — a
`publishSheet` reaches every listener with the same reference, `sheet()`
returns it, an unsubscribed listener stops; `ringMetaChunks` emits the
three keywords with `Title` = `«name» atlas`, `Software` = `SOFTWARE`, and
a JSON that round-trips the settings + frame + anchor + yaws.

`test/layout.test.mjs`: `ringWidthFor(4)` = `max(RING_MIN_WIDTH, 283)`,
`ringWidthFor(1)` = the floor; the placement's `ring` box (left = doc left,
bottom = H − 8, height `RING_HEIGHT`); with `{ ringShown: true }` the doc
box bottom + the cascade room = the strip's top − 8, and every cascade slot
still lands above it; `{ ringShown: false }` leaves the doc box exactly as
today (the existing assertions are the regression guard); `zoomedBox` with
`ringShown` stops above the band; the **fixed-point loop** gains the ring
at 4 and 16 views; the degenerate-raster test gets a ring line (`Math.max`
floors keep it sane).

`test/params.test.mjs`: `?ring=4` → `{4, 45, 0, 1}`; `?ring=8,30,45,2`;
`?ring=8,x` → elevation default; `?ring=0` and `?ring=` → `null`; the
snapshot gains `ring: null`.

### 5B. `tools/drive.mjs` (real trusted input; mechanisms, never copy)

Imports: `RING_HEIGHT, ringWidthFor` from `layout.js`, `ringFrame,
ringSheet` from `../src/lib/ring.js` (pure ESM — the oracle idiom). Probe:
`windows.ring: !__q('#win-ring').hidden`, `menuChecks.ring`,
`menuEnabled.ring` / `exportAtlas`, and `ringStatus` (the `kind="ring"`
label's `title`, parsed like `buildStats`). In the **view menu** section,
two positive counterparts beside the existing negatives: `#win-ring`
renders a close box; `vf-menu-item[value="ring"]` exists. Then a new
`section('3D sprite atlas')` after **windows** (it needs the doc window's
placed geometry), opening with `freshPage()`:

```
probe                    → windows.ring === false; menuChecks.ring === false
pickMenu view/ring       → windows.ring === true; menuChecks.ring === true
                           the windoid's box === { left: doc.left, top: dh − 8 − RING_HEIGHT,
                           width: ringWidthFor(4), height: RING_HEIGHT }
                           __qa('.ring-cell').length === 4
settle 400ms             → every cell canvas is F×F (F = ringFrame(40³, 45, 1).px = 69)
                           and holds opaque px (the Car from four sides)
                           ringStatus parses frame 69×69 and sheet 276×69
the views stepper ▲      → 5 cells; the windoid width === ringWidthFor(5); left unchanged
                           (the properties section's stepper recipe)
pickMenu file/export-atlas
                         → #atlas-views value === '5' (the dialog reads the view)
                           menuEnabled.exportAtlas / the OK button enabled (a model exists)
type 8 + Enter in #atlas-views
                         → 8 cells behind the modal (live, not pending); the readout
                           reads sheet 552×69
Cancel                   → the setting stays 8 (probe the strip's field value)
click #win-ring's [part="close-box"]
                         → windows.ring === false; menuChecks.ring === false
pickMenu view/ring       → back, 8 cells, the same left/top
click the desktop dither → windows.ring === false (hides with the application)
click the document       → windows.ring === true
pickMenu view/arrange    → the doc window's bottom + 96 === the strip's top − 8 (the oracle
                           with ringShown: true); the strip where initialPlacement puts it
metrics(780, 640); settle; metrics(1000, 850)
                         → after each: the strip's left === the doc's slot-0 left and its
                           bottom === dh − 8 (a bottom-docked fixed-size box round-trips)
Export (optional, see below)
Page.navigate ?ring=6,30,45,2 → 6 cells; ringStatus parses 30°, from 45°, 2×, and
                           F = ringFrame(40³, 30, 2).px
```

**Export bytes — attempt it:** `Browser.setDownloadBehavior { behavior:
'allow', downloadPath: userDir, eventsEnabled: true }`, click Export, wait
for `Browser.downloadProgress` `state === 'completed'`, read the file, and
assert IHDR width/height = `ringSheet(8, F)` and `readTextChunks(bytes)`
(`lib/png-chunks.js`, pure) carries `sprite-machine:ring` with `views: 8`.
The headless download path is new to this harness; if it proves flaky,
keep the enablement + close checks and leave the bytes to the eye item.

About 22 checks. The **browser resize** section is untouched: its
`windoids(...).length === 3` reads only visible windows and the ring boots
hidden (the section opens with `freshPage`). Update the count in
`docs/SMOKE-TEST.md`'s opening paragraph (234 → the new total).

### 5C. `docs/SMOKE-TEST.md` — the eye

- **The strip, by eye**: View → 3D Sprite Atlas — a windoid lands under the
  document window, left-aligned with it, on the bottom margin: four cells
  on the gray-25 paper, the Car from the front, its right, the back, its
  left, all at the same size and centered; the front view's shading reads
  like the 3D View's default framing, and **every angle is lit the same
  way** (the light rides with the camera). The dot bar carries a close box;
  its close unchecks the menu item; the item re-shows it where it was.
- **Settings are live, both ways**: step `views` to 8 — the windoid widens
  to the right (its left edge holds), eight cells at a 45° step; set `elev`
  to 0 — pure side views; 90 — plan views; `from` 45 — the ring rotates;
  `scale` 2 — the frames double (the status reads `8 × 137 px`), the
  thumbnails stay the cell size. Draw a stroke — every cell follows at
  frame rate. File → Export Sprite Atlas… reads the same numbers; change
  one there — the strip follows behind the modal; Cancel keeps it.
- **The frame never breathes**: with a cube open, step `from` 0 → 45 → 90 —
  the cube's silhouette changes, the cells don't; step `views` — same.
- **Arrange makes room**: with the strip shown, View → Arrange Windows
  shortens the document window to clear it (a gap between); hide the strip
  and Arrange again — the document takes the height back. The zoom box
  stops above a shown strip.
- **A resize keeps it docked**: shrink the browser — the strip stays on the
  bottom margin at the document's left; grow it back — exactly home.
- **The export file**: Export saves `«name»-atlas.png`, `views·F × F` px,
  transparent outside the sprite; open it — the strip's pixels exactly;
  its `sprite-machine:ring` text chunk names the settings (any PNG chunk
  inspector). Export is live with the strip hidden too (the Finder role
  greys it with the rest).
- **Export 3D Model… is still parked** (fields disabled, Export inert).
- The existing **"Windoids are non-closeable"** item becomes "the three
  permanent windoids…; the 3D Sprite Atlas is the one exception".
- The existing **"Parked export dialogs"** item shrinks to the model dialog.

### 5D. Captures

The two `?ring=` shots of §3I, `cmp` between runs. Optionally
`?ring=4&hide=document,tools,sprite,stage` for the strip alone.

### 5E. The standing gates

`npm test` · `npm run typecheck` · `npm run lint` (`npm run format` to fix)
· `npm run build` · `node tools/drive.mjs` (against `npm run dev`) — all
green before the commit. No one-off scripts (memory rule): the gates above
and an eye on the dev server are the verification.

---

## 6. Implementation order (the app runs at every step)

1. **`src/lib/ring.js` + `test/ring.test.mjs`.** Pure; pass before any UI
   exists. `npm test`.
2. **`src/state/ring.js` + its test; `prefs.showRing`.** Still nothing
   visible.
3. **`shell/layout.js`** — the constants, `ringWidthFor`, the placement's
   opts and box, `zoomedBox`'s opts — **+ `test/layout.test.mjs`**
   (placement, the shortened doc box, the fixed point at 4 and 16). Set
   `RING_MIN_WIDTH` to a guess (283) for now; step 5 measures it.
4. **The windoid without a body:** `index.html` (the item + the window),
   `shell.js`'s `WINDOW_IDS`, `windows.js` (closable exemption, `fitRing`,
   visibility, close box, the opts), `menus.js` (the View case, checkmark,
   `DOC_SCOPED`). View → 3D Sprite Atlas shows an empty windoid docked
   under the document; its close box hides it; Arrange shortens the doc
   box. `npm test`, typecheck, `drive.mjs`'s existing sections still green
   (the two windoid negatives in **view menu** still pass — they name the
   three permanent ids).
5. **`<sm-ring-view>` + `kind="ring"`:** the controls strip, the cells on
   paper, the status readout — no pixels yet (the cells show paper).
   **Measure the strip's content width → `RING_MIN_WIDTH`** (re-run the
   layout tests). Changing `views` re-fits the windoid.
6. **The renderer + the follower + `onMesh`:** `ring-renderer.js`,
   `scene/ring.js`, the rebuilder's callback, `main.js`'s wiring. Pixels
   appear. **Tune by eye against the 3D View**: yaw 0 shows the front, the
   ring runs to the right, the 45° front view's shading matches the stage's
   default framing (adjust the camera-space rig), no shadow, transparent
   paper, the frame stable across `from` and `views`.
7. **The dialog goes live + Export:** the markup, `menus.js`'s seed / sync
   / setters / Export, `canvasToPngBytes`, `ringFilename`. Export a sheet;
   open the file; check the chunk.
8. **`?ring`** end to end (params → main), params tests, two
   `cmp`-identical captures.
9. **`drive.mjs`** (§5B), then **docs** (§7), the drive count, prettier,
   the full gate list, commit.

---

## 7. The doc ritual (this repo documents as it ships)

- **README** — the top: "three floating utility windoids" → three permanent
  ones plus the **3D Sprite Atlas** (View-toggled; its own paragraph under
  **Windows**: what it shows, the settings strip, the close box, the
  fixed-size-follows-N rule, the bottom dock and the shortened doc box, the
  fixed point); **Menu bar → View** (the new item; the sentence "The windoids
  need no toggles: they're permanent" gains its exception) and **→ File**
  (Export Sprite Atlas… is live: the four settings, the readout, what the
  file is — `«slug»-atlas.png`, the chunk, the anchor; Export 3D Model…
  alone is parked); the **dev-hook** paragraph (`?ring=…`, `?hide=ring`);
  the **Architecture** test list (`test/ring.test.mjs`,
  `test/ring-state.test.mjs`, the layout additions) and the **listings**
  (`lib/ring.js`, `state/ring.js`, `state/prefs.js`'s line, `scene/ring.js`
  - `scene/ring-renderer.js`, `scene/rebuilder.js`'s `onMesh`,
    `shell/layout.js`'s `ring` box, `components/sm-ring-view.js`,
    `sm-status-line`'s third kind); **Known limitations → Export**: the
    sprite-atlas exporter exists now (the paragraph shrinks to the model
    exporter, and the technique paragraph — the envelope, the anchor, the
    camera-relative light — goes with the Windows paragraph).
- **SMOKE-TEST** — §5C; the drive count.
- **Header comments** — every file in §4 that carries one (this codebase's
  comments are load-bearing).
- **Commit message** — the repo's long-form style: what shipped, why each
  decision (the envelope, the camera-relative light, the fixed point without
  a frame change, live dialog edits), what the gates said (`npm test N/N
(+k)`, typecheck + prettier + build, `drive.mjs N/N (+k)`, the captures
  cmp'd).

---

## 8. Follow-ups (out of scope here; the model is ready for them)

- **Per-document settings** in a `sprite-machine:ring` chunk on the
  DOCUMENT (the transforms chunk's idiom): the slice becomes per-context
  (a `ring` store on `DocContext`, `followActive` for the strip), a change
  dirties the document, save/load round-trip it. The export chunk already
  has the JSON shape.
- **A drop shadow in the sprite:** a `ShadowMaterial` ground at y = 0,
  `shadowMap` on for the ring renderer, a `shadow` checkbox in the strip
  and the dialog. The camera-relative key light makes it consistent across
  the ring.
- **Elevation presets** for isometric engines (30 / 35.264 / 45 / 60) as a
  `vf-select` beside the field.
- **A scrolling strip** (`vf-window scrollbars="horizontal"`, the kit's
  always-a-rail TeachText composition) at a fixed width, if wide rings on
  small rasters prove annoying (decision **A**).
- **Per-frame padding / power-of-two frames** for engines that want them.
- **Export 3D Model…** — the other parked dialog; `GLTFExporter` over the
  same `onMesh` seam this feature adds (the mesh reaches a consumer outside
  the stage now).

---

## 9. Decisions to confirm (defaults chosen; change only if you disagree)

- **A. Width follows N; no scrolling.** The alternative: a fixed width
  (eight cells) with the kit's horizontal rail. Wide rings on a small
  raster hang under the rail; a drag reaches them; the export is complete
  regardless.
- **B. Bottom dock, left-aligned with the doc box; the doc box shortens
  only while the strip is shown.** The alternative: never shorten (the
  strip overlaps the window's bottom until you drag). And `zoomedBox`
  respects a shown strip.
- **C. A close box on the windoid.** Dropping it makes the menu the only
  way out — one line less (`closable = false` for all four).
- **D. App-level, session-only settings** (the prefs discipline). Per-doc
  persistence is §8's first item.
- **E. Lights ride with the camera** (engine-correct for a rotation set).
  World-fixed lights would shade each facing differently.
- **F. No ground shadow** in the sprite.
- **G. Square frames from the lattice's circle envelope** (stable across
  yaw and edits, loose at yaw 0). A tight per-frame bound would jitter.
- **H. The dialog edits live**; Cancel doesn't revert.
- **I. A number field for views (1–16)** in both the strip and the dialog,
  replacing the parked select's five presets.
- **J. Yaw front → right → back → left** (camera toward `+x` first). A
  sign flip in `ringCameraDir` reverses it.
- **K. `«slug»-atlas.png`**; the `Title` chunk `«name» atlas`.
- **L. Default elevation 45°** (the request), over the parked dialog's 30.

---

## 10. Risks and gotchas

- **The clone and the dispose.** The rebuilder disposes geometry + material
  on every rebuild; the ring scene's clone shares both. `onMesh(null)` MUST
  run inside `removeMesh()` before the dispose, and `setSubject` must remove
  the old clone before adopting the next — a clone left in the scene with
  disposed geometry renders nothing or throws on the next pass.
- **`drawImage` from the GL canvas.** Copy in the same task as the renders
  (`preserveDrawingBuffer: false`). If a blank sheet ever shows up, flip
  `preserveDrawingBuffer: true` — the cost is nothing at this size.
- **Never render while hidden.** The follower's `schedule()` gates on
  `prefs.showRing`; the rebuilder fires per stroke frame. Export's
  `renderSheet()` is the one deliberate exception.
- **`scene.add(camera)`.** Lights parented to the camera render only when
  the camera is in the scene graph; and the directional lights' `target`s
  must be in the scene (at `center`) or their matrices never update.
- **Elevation 90.** `lookAt` with `up = +y` degenerates looking straight
  down; `ringCameraUp` supplies the true up vector — set `camera.up` before
  every `lookAt`.
- **Colors must agree with the 3D View.** `outputColorSpace =
SRGBColorSpace` on the ring renderer too, or the sprites come out darker
  than the stage.
- **The fixed point rests on "fixed-size".** The windoid is not
  `resizable`; its width is a derivation windows.js re-applies (`fitRing`),
  never a user size. A `vf-resize` path would need the stage's floor
  ritual AND a new pin argument.
- **`closable` exemption.** The `closable = false` loop over `WINDOW_IDS`
  must skip `'ring'`, or the close box silently vanishes and the drive's
  positive check fails.
- **The pattern pool.** `PatternFillController`s over refs whose cell isn't
  rendered (N < 16): confirm the kit's controller tolerates a null box; if
  not, create/destroy controllers per N or gate `getPattern` on the index.
- **`vf-number-field` empties.** `valueAsNumber` is NaN mid-edit; every
  setter treats NaN as a no-op and the `live()` binding re-syncs the field
  on the next render.
- **The strip's fields and the tool keys.** `shortcuts.js` guards on the
  composed target being an input — a windoid field is one, so typing `4`
  never picks a tool. (Verify once by eye; it's the existing guard.)
- **The drive's windoid counts.** `windoids(...).length === 3` in the
  resize section and `windows: { tools, sprite, stage }` in the probe read
  visible / named windows; the ring boots hidden, so nothing there changes
  — but any future section that shows the ring before the resize section
  must hide it again.
- **Headless downloads** (`Browser.setDownloadBehavior`) are new to the
  harness; treat the bytes check as best-effort (§5B).
- **Prettier** reflows the strip template and the dialog markup; run
  `npm run format` before the gates, not after.
