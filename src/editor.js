// ---------------------------------------------------------------------------
// The tools panel (right half of the workspace): a pixel editor for one atlas
// face. Permanently docked — a face is always selected; the 3D view stays live +
// interactive on the left. Self-contained, pure DOM; no imports from the voxel
// pipeline.
//
// The face tabs, the pixel canvas, and the tools are ONE framed card: the six
// tabs cap it, the canvas fills its body, and a FOOTER inside the same card holds
// the TOOL STRIP of first-class tools (pencil, rect, and fill are all live) with
// the square tile-size stepper docked at its right, above a per-tool OPTIONS row
// (the pencil's tip-SIZE stepper; the rect's corner-RADIUS stepper; the fill's two
// checkboxes). Only the PALETTE row lives
// BELOW the card — every color currently painted on ANY face, so you can match
// existing colors — led by a "+" that opens the full 256-color modal, then the
// eyedropper and a "transparent" swatch (a checkerboard tile = the empty / clear
// color). The eyedropper and the transparent swatch live with the colors, not the
// tools, because they choose the pencil's INK (a sampled color, or transparent
// "clear color") rather than a drawing tool. The brush selection is held in the caller-owned `brush` object so
// it survives a face swap (which destroys + re-mounts this editor). Every stroke
// is HARD-pixel (alpha 0 or 255) so downstream ingest (alpha>=128) and
// atlas.isBlank (alpha!==0) can never diverge.
//
// createTileEditor(container, { name, tile, tileW, tileH, palette, palette256,
//   usedColors, mirrorBehind, guides, faces, brush, sizeMin, sizeMax, focusSize,
//   onLive, onSelectFace, onResizeTile })
//   -> { destroy }
//   - mirrorBehind: {width,height,data} onion-skin of the opposite face drawn
//     faded UNDER the pixel canvas (display only — never written to `work`). null
//     when the opposite face has no art of its own. A mirror-derived face opens
//     with an EMPTY canvas and this faded mirror as its only reference.
//   - guides: from faceGuides() — extent of the orthogonal faces' pixels, drawn
//     as hairline rules over the canvas so you can align to the stricter carve.
//   - faces: the ordered list of all six atlas faces, shown as tabs across the
//     top; the edited `name` is the active tab and clicking another switches.
//   - palette256: the full 256-color editor palette ({ css }[]) shown in the
//     "+" modal as a 16x16 grid. It arrives already laid out along a Hilbert
//     curve (constants.js PALETTE_256), so iterating it row-major clusters
//     similar colors both across and down — this editor never reorders it.
//     `palette` (DB16) is no longer displayed; it still seeds the default brush
//     color and `B`.
//   - usedColors: [{r,g,b}] colors already painted on the OTHER faces; the editor
//     unions the current tile's live pixels on top for the dynamic palette row.
//   - brush: shared { tool, color:{r,g,b}, erase, picking, size,
//     cornerRadius, fillReplace, fillAllTiles, chosen } — persisted by the caller
//     across face swaps. `tool` is the drawing op ('pencil'|'rect'|'fill'; all live).
//     `erase` makes the stroke/rect/fill lay transparent; `picking` arms the
//     eyedropper for the next canvas click; `size` is the pencil's N×N tip footprint
//     (in texels); `cornerRadius` is the rect tool's corner radius (in texels, 0 =
//     sharp). `fillReplace` upgrades the fill from a contiguous flood to a whole-tile
//     recolor of every matching texel; `fillAllTiles` (only meaningful when
//     `fillReplace` is on) extends that recolor across every tile in the atlas.
//     `chosen` is set once
//     the user actively picks an ink (modal / eyedrop / used swatch): that ink then
//     shows as a SELECTED tile in the palette row even before it's painted — vs.
//     the untouched mount default, which stays hidden until something is drawn.
//   - sizeMin/sizeMax: inclusive integer bounds for the TILE-size stepper.
//   - focusSize: the stepper's key ('Tile') to refocus after a resize re-mount (typed entry flow).
//   - openPaletteOnMount: dev hook (?palette=1) — open the "+" palette modal
//     immediately so headless screenshots (which can't click "+") can show it.
//   - previewCursor: dev hook (?cursor=N) — set the pencil size to N and draw its
//     footprint outline at the tile center on mount, so a headless shot (which has
//     no pointer to hover) can show the preview. Consumed once by the caller.
//   - previewRect: dev hook (?rect=x0,y0,x1,y1[,r[,sq]]) — select the rect tool and
//     draw its live drag preview for that box (radius r; sq=1 for the Shift square-
//     lock) on mount, so a headless shot (which can't drag) can show the tool
//     mid-drag. Consumed once by the caller.
//   - pickIndex: dev hook (?pick=N) — select palette256[N] as the ink on mount, as
//     if picked from the "+" modal, so a headless shot (which can't click a swatch)
//     can show it landing as the selected palette-row tile. Consumed once.
//   - fillOnMount: dev hook (?fill=x,y[,r[,a]]) — select the fill tool, set its two
//     checkboxes (replace=r, all-tiles=a), and perform a fill at (x,y) on mount, so a
//     headless shot (which can't click) can show the tool + result. The mount fill is
//     always applied LOCALLY (to this tile only) even with a=1 — a single editor shot
//     shows only the current tile anyway, and a local fill avoids a re-mount mid-mount.
//     Consumed once by the caller.
//   - onLive(workingTile, dirty): fired on each actual pixel change.
//   - onSelectFace(name): the user clicked another face tab.
//   - onResizeTile(size): the user changed the tile size. Tiles are locked SQUARE,
//     so the caller resizes the whole atlas to size×size (CENTERED — see resizeAtlas
//     anchor:'center') and re-mounts. A square resize stays in registration (the solid
//     just translates to keep the art centered); it no longer pins y=0, so a
//     ground-rested sprite floats up as the tile grows.
//   - onReplaceAllTiles(target, fill): the user committed a fill with BOTH the
//     "replace" and "all tiles" checkboxes on. `target`/`fill` are color keys
//     ({transparent:true} | {r,g,b}); the caller replaces every `target` texel with
//     `fill` across the whole atlas sheet and re-mounts this editor on the same face.
//     The single-tile fill modes (contiguous flood, or whole-tile replace) never call
//     this — they mutate the working tile directly and fire onLive like any stroke.
// ---------------------------------------------------------------------------

import { icon } from './icons.js';
import { roundedRectRows, maxCornerRadius, squareEnd } from './lib/rect.js';
import { keyAt, floodFill, replaceColor } from './lib/fill.js';
import { distinctColors, rgbKey } from './lib/color.js';

// The pixel-canvas CONTAINER is a stable box: its height is pinned to a fixed
// fraction of the sidebar (panel) height, full-bleed below the tabs, so nothing
// below it shifts as the tile size — and thus the drawn canvas — changes. The
// square canvas is centered inside at the largest integer texel scale that fits.
const CANVAS_FRACTION = 0.6; // container height = 60% of the sidebar height

// Hairline extent rules: translucent cyan so they read as guides distinct from
// the sprite art. MIRROR_ALPHA keeps the onion-skin a faint hint.
const GUIDE_COLOR = 'rgba(120, 200, 255, 0.6)';
const MIRROR_ALPHA = 0.22;

// Draw the four "furthest extent" hairlines into an OVERLAY context sized to the
// on-screen canvas (screen-res so the 1px lines stay crisp regardless of scale).
// The lines box the region where a painted pixel can survive the carve: verticals
// at the outer edges of the supported columns, horizontals at the supported rows.
function drawGuides(g, guides, scale, cssW, cssH) {
  g.clearRect(0, 0, cssW, cssH);
  if (!guides) return;
  const { uMin, uMax, vMin, vMax } = guides.extent;
  g.fillStyle = GUIDE_COLOR;
  const T = 1; // hairline thickness (screen px)
  if (uMin != null) g.fillRect(uMin * scale, 0, T, cssH); // left extent
  if (uMax != null) g.fillRect((uMax + 1) * scale - T, 0, T, cssH); // right extent
  if (vMin != null) g.fillRect(0, vMin * scale, cssW, T); // top extent
  if (vMax != null) g.fillRect(0, (vMax + 1) * scale - T, cssW, T); // bottom extent
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const toHex2 = (n) => n.toString(16).padStart(2, '0');
const rgbHex = ({ r, g, b }) => `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;

// A compact [−] [value] [+] integer stepper with an external "label:" caption and
// an optional unit suffix ("px"). Commits on the buttons and on the field's
// `change` (blur/Enter) — never per keystroke, so a caller re-mount can't fight the
// user mid-type. The value is clamped + normalized on every commit, and a commit
// that resolves to the current value is a no-op (so tapping + at the max, or
// retyping the same number, doesn't churn). `key` tags the input (data-axis) so the
// caller can restore focus here after a re-mount; `value` is the amount at mount.
//
// The live value is tracked LOCALLY (`cur`) so the stepper keeps working whether or
// not the caller re-mounts on commit. The tile stepper re-mounts the whole editor on
// each change (a fresh instance every time), but the pencil-size stepper stays put —
// so without this it would freeze after the first click (its captured `value` never
// advancing, ± always deltaing off the mount value).
/**
 * @param {{key:string, label:string, value:number, min:number, max:number,
 *   unit?:string, onCommit:(v:number)=>void}} opts
 */
function sizeStepper({ key, label, value, min, max, unit, onCommit }) {
  const clamp = (n) => Math.max(min, Math.min(max, Math.round(Number(n) || 0)));
  const field = el('div', 'editor-field');
  field.append(el('span', 'editor-field-cap', `${label}:`));
  const box = el('div', 'editor-stepper');
  const dec = el('button', 'editor-step', '−');
  const inc = el('button', 'editor-step', '+');
  const input = el('input', 'editor-step-val');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.dataset.axis = key; // so the caller can restore focus here after a re-mount
  input.setAttribute('aria-label', `${label} (${min}–${max})`);
  dec.type = inc.type = 'button';
  let cur = clamp(value);
  const sync = () => {
    input.value = String(cur);
    dec.disabled = cur <= min;
    inc.disabled = cur >= max;
  };
  const commit = (n) => {
    const v = clamp(n);
    if (v === cur) {
      input.value = String(cur); // normalize a same-value / out-of-range entry
      return;
    }
    cur = v;
    sync(); // advance our own value + ±-disabled state, even if the caller doesn't re-mount
    onCommit(v);
  };
  dec.onclick = () => commit(cur - 1);
  inc.onclick = () => commit(cur + 1);
  input.onchange = () => commit(input.value);
  sync();
  box.append(dec, input);
  if (unit) box.append(el('span', 'editor-step-unit', unit));
  box.append(inc);
  field.append(box);
  return field;
}

// A labeled checkbox for the per-tool options row (the fill tool's two toggles). A
// disabled box greys out and ignores clicks but keeps showing its checked state, so
// "all tiles" can stay remembered while "replace" (its gate) is off. Fires onToggle
// with the new boolean on each change.
/**
 * @param {{label:string, checked:boolean, disabled?:boolean, title?:string,
 *   onToggle:(v:boolean)=>void}} opts
 */
function checkbox({ label, checked, disabled, title, onToggle }) {
  const wrap = el('label', 'editor-check' + (disabled ? ' disabled' : ''));
  if (title) wrap.title = title;
  const input = el('input');
  input.type = 'checkbox';
  input.checked = !!checked;
  input.disabled = !!disabled;
  input.onchange = () => onToggle(input.checked);
  wrap.append(input, el('span', 'editor-check-cap', label));
  return wrap;
}

export function createTileEditor(
  container,
  {
    name,
    tile,
    tileW,
    tileH,
    palette,
    palette256 = [],
    usedColors = [],
    mirrorBehind,
    guides,
    faces,
    brush,
    sizeMin = 1,
    sizeMax = 64,
    focusSize,
    openPaletteOnMount = false,
    previewCursor = null,
    previewRect = null,
    pickIndex = null,
    fillOnMount = null,
    onLive,
    onSelectFace,
    onResizeTile,
    onReplaceAllTiles,
  }
) {
  // Working copy of the tile's pixels — starts from the face's own art, or empty
  // for a face with none. A mirror-derived face opens EMPTY (the faded onion-skin
  // behind the canvas is the reference); it becomes real art only once the user
  // actually changes a pixel (tracked by `dirty`).
  const work = new Uint8ClampedArray(tileW * tileH * 4);
  work.set(tile.data);
  const workingTile = { width: tileW, height: tileH, data: work };
  let dirty = false;

  // Brush defaults (first mount of a session). `tool` is the drawing op, `erase`
  // and `picking` the ink/sample flags, `size` the pencil's N×N footprint.
  if (!brush.color) brush.color = { ...palette[0].rgb };
  if (brush.tool == null) brush.tool = 'pencil';
  if (brush.erase == null) brush.erase = false;
  if (brush.picking == null) brush.picking = false;
  if (brush.size == null) brush.size = 1;
  if (brush.cornerRadius == null) brush.cornerRadius = 0;
  if (brush.fillReplace == null) brush.fillReplace = false;
  if (brush.fillAllTiles == null) brush.fillAllTiles = false;
  if (brush.chosen == null) brush.chosen = false;

  // The pencil tip is capped at the tile edge (a single stamp can't exceed the
  // canvas). `previewCursor` (?cursor=N) sets the size up front; either way we
  // clamp a persisted size down after a shrink to a smaller tile.
  const brushMax = Math.max(1, Math.min(tileW, tileH));
  const clampBrush = (n) => Math.max(1, Math.min(brushMax, Math.round(Number(n) || 1)));
  if (previewCursor) brush.size = clampBrush(previewCursor);
  brush.size = clampBrush(brush.size);

  // The rect's corner radius can't exceed half the shorter tile side (the biggest a
  // full-tile rect could use); a per-rect clamp in roundedRectRows handles smaller
  // rects. Clamp a persisted radius down after a shrink to a smaller tile.
  const radiusMax = maxCornerRadius(tileW, tileH);
  const clampRadius = (n) => Math.max(0, Math.min(radiusMax, Math.round(Number(n) || 0)));
  brush.cornerRadius = clampRadius(brush.cornerRadius);

  container.innerHTML = '';
  const root = el('div', 'editor');
  container.appendChild(root);

  // --- canvas widget: tabs + framed card (canvas + tool footer) as one unit --
  const widget = el('div', 'editor-canvas-panel');
  root.appendChild(widget);

  // Six face tabs across the top of the box (one per atlas tile). The edited face
  // is the active tab; clicking any other switches to it (the caller re-mounts
  // the editor there — live edits are already committed).
  const tabs = el('div', 'editor-tabs');
  for (const f of faces || [name]) {
    const t = el('button', 'editor-tab' + (f === name ? ' active' : ''), f);
    if (f !== name) t.onclick = () => onSelectFace?.(f);
    tabs.appendChild(t);
  }
  widget.appendChild(tabs);

  // --- canvas: stable-size container + centered, maximal pixel canvas ---------
  // The CONTAINER (.editor-canvas-wrap) is a fixed box — layout() pins its height to
  // CANVAS_FRACTION of the sidebar height and it spans the full panel width below the
  // tabs — so nothing below it shifts when the tile size (and thus the drawn canvas)
  // changes. Inside it, a .editor-canvas-stack holds four aligned layers, centered
  // and scaled by layout() to the largest integer texel size that fits: a background
  // (checkerboard via CSS + faded opposite-face onion-skin), the transparent pixel
  // canvas, a hairline guide overlay, and a cursor overlay (the hover footprint).
  // Only the pixel canvas takes pointer events. The pixel + bg canvases keep a native
  // tileW×tileH backing store (CSS upscales them crisp); the overlay + cursor are
  // SCREEN-res (backing tracks the on-screen px) so their 1px lines stay crisp.
  const wrap = el('div', 'editor-canvas-wrap');
  const stack = el('div', 'editor-canvas-stack'); // the centered square; JS-sized

  const bg = el('canvas', 'editor-canvas-bg');
  bg.width = tileW;
  bg.height = tileH;
  if (mirrorBehind) {
    const tmp = document.createElement('canvas');
    tmp.width = tileW;
    tmp.height = tileH;
    tmp
      .getContext('2d')
      .putImageData(
        new ImageData(new Uint8ClampedArray(mirrorBehind.data), tileW, tileH),
        0,
        0
      );
    const bgx = bg.getContext('2d');
    bgx.imageSmoothingEnabled = false;
    bgx.globalAlpha = MIRROR_ALPHA; // putImageData ignores alpha; drawImage honors it
    bgx.drawImage(tmp, 0, 0);
  }
  stack.appendChild(bg);

  const canvas = el('canvas', 'editor-canvas');
  canvas.width = tileW;
  canvas.height = tileH;
  stack.appendChild(canvas);

  const overlay = el('canvas', 'editor-canvas-overlay');
  stack.appendChild(overlay);
  const overlayCtx = overlay.getContext('2d');

  const cursor = el('canvas', 'editor-canvas-cursor');
  stack.appendChild(cursor);
  const cursorCtx = cursor.getContext('2d');

  wrap.appendChild(stack);

  // The bordered CARD frames the canvas container AND the tool footer together, so
  // the tools read as part of the same unit the tabs cap (the footer supplies the
  // card's rounded bottom edge). The tabs overlap this card's top border; the
  // footer is filled with the tool strip + per-tool options further down.
  const canvasCard = el('div', 'editor-canvas-card');
  canvasCard.appendChild(wrap);
  const footer = el('div', 'editor-canvas-footer');
  canvasCard.appendChild(footer);
  widget.appendChild(canvasCard);

  const ctx = canvas.getContext('2d');
  const imgData = new ImageData(work, tileW, tileH); // shares `work` by reference
  const repaint = () => ctx.putImageData(imgData, 0, 0);
  repaint();

  // Live on-screen geometry, re-derived by layout(): `scale` is the integer texel
  // size, `cssW`/`cssH` the pixel canvas's on-screen px. The guide + cursor overlays
  // draw in this screen space, so they read these.
  let scale = 1;
  let cssW = tileW;
  let cssH = tileH;
  let laidOut = false;

  // Pin the container to CANVAS_FRACTION of the sidebar height, then fit the largest
  // integer-scaled tile rect inside its content box, size every layer to it, and
  // redraw the screen-res overlays. Called on mount and whenever the panel resizes;
  // idempotent — a re-run at the same scale only re-pins the (stable) height. Reads
  // `redrawCursorLayer`/`hoverTexel`, defined below, but is only CALLED after they exist.
  function layout() {
    const boxH = Math.max(0, Math.round((container.clientHeight || 0) * CANVAS_FRACTION));
    wrap.style.height = `${boxH}px`;
    // Measure BOTH axes from the post-reflow client box (border-excluded), so the
    // 1px border isn't double-counted on one axis: availH from the raw border-box
    // `boxH` would overstate the content height by the border and could round the
    // integer scale one step too big (the stack would then clip under overflow:hidden).
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
    if (laidOut && s === scale) return; // scale unchanged → layers already correct
    laidOut = true;
    scale = s;
    cssW = tileW * s;
    cssH = tileH * s;
    stack.style.width = `${cssW}px`;
    stack.style.height = `${cssH}px`;
    overlay.width = cssW; // screen-res backing so hairlines stay 1px crisp
    overlay.height = cssH;
    cursor.width = cssW;
    cursor.height = cssH;
    drawGuides(overlayCtx, guides, scale, cssW, cssH);
    redrawCursorLayer(); // re-stroke the footprint / rect preview at the new scale
  }

  const rgbEq = (a, b) => a.r === b.r && a.g === b.g && a.b === b.b;
  const rkey = rgbKey;

  // The single path every color pick funnels through (palette modal, in-sprite,
  // eyedrop): make `color` the pencil's ink and clear the erase/eyedropper flags.
  function selectColor(color) {
    brush.color = { r: color.r, g: color.g, b: color.b };
    brush.erase = false;
    brush.picking = false;
    brush.chosen = true; // pin as the selected palette tile even if not painted yet
    renderUsed(); // surface the pick in the palette row now, not only once drawn
    syncUI();
  }

  // --- tool strip: first-class tools + docked tile-size stepper --------------
  // Lives in the card FOOTER (below the canvas). Pencil, rect, and fill are all live
  // tools. The square tile-size stepper docks at the right (tiles are locked SQUARE,
  // so a resize is always alignment-safe).
  const toolstrip = el('div', 'editor-toolstrip');
  const toolGroup = el('div', 'editor-toolgroup');
  // Icon-only tool buttons (Spectrum workflow glyphs). The icon is decorative;
  // each button carries its own aria-label + title so the tool stays named.
  const pencilBtn = el('button', 'editor-tool editor-tool-icon');
  pencilBtn.type = 'button';
  pencilBtn.title = 'pencil — draw (B)';
  pencilBtn.setAttribute('aria-label', 'pencil');
  pencilBtn.appendChild(icon('draw'));
  const rectBtn = el('button', 'editor-tool editor-tool-icon');
  rectBtn.type = 'button';
  rectBtn.title = 'rectangle — drag a box (R)';
  rectBtn.setAttribute('aria-label', 'rectangle');
  rectBtn.appendChild(icon('rectangle'));
  const fillBtn = el('button', 'editor-tool editor-tool-icon');
  fillBtn.type = 'button';
  fillBtn.title = 'fill — flood a region, or replace a color (G)';
  fillBtn.setAttribute('aria-label', 'fill');
  fillBtn.appendChild(icon('color-fill'));
  toolGroup.append(pencilBtn, rectBtn, fillBtn);
  toolstrip.append(
    toolGroup,
    sizeStepper({
      key: 'Tile',
      label: 'tile',
      value: tileW,
      min: sizeMin,
      max: sizeMax,
      onCommit: (n) => onResizeTile?.(n),
    })
  );
  footer.appendChild(toolstrip);
  // Shared body for the three tool buttons: abandon any in-flight rect (switching
  // tool mid-drag discards the box, matching the B/R/G keys), select the tool,
  // return to painting (out of eraser / eyedropper), ensure an ink, then refresh
  // the options row + UI state + cursor overlay. The last call is what the button
  // path previously lacked: without it a pencil hover footprint drawn on the cursor
  // layer lingers after clicking rect/fill (the keyboard path already redraws it).
  function switchTool(tool) {
    cancelRect();
    brush.tool = tool;
    brush.erase = false;
    brush.picking = false;
    if (!brush.color) brush.color = { ...palette[0].rgb };
    renderToolOptions();
    syncUI();
    redrawCursorLayer();
  }
  // Pencil: draw with the current color. Rect: drag a filled (optionally rounded)
  // box — a rectangular ERASE stays available via right-drag or the eraser ink.
  // Fill: flood a contiguous region (or, with "replace", recolor every matching
  // texel — optionally across all tiles); a right-click / eraser ink fills to clear.
  pencilBtn.onclick = () => switchTool('pencil');
  rectBtn.onclick = () => switchTool('rect');
  fillBtn.onclick = () => switchTool('fill');

  // --- per-tool options row (contextual) ------------------------------------
  // Different tools expose different settings here. The pencil gets a tip-SIZE
  // stepper: N means an N×N square footprint, stamped along the stroke and
  // previewed as a hairline outline under the cursor.
  const toolOpts = el('div', 'editor-tool-opts');
  footer.appendChild(toolOpts);
  function setPencilSize(n) {
    brush.size = clampBrush(n);
    drawCursor(hoverTexel); // reflect the new footprint immediately if hovering
  }
  function setCornerRadius(n) {
    brush.cornerRadius = clampRadius(n);
    if (rectDragging) drawRectPreview(); // re-round the in-flight box live
  }
  function renderToolOptions() {
    toolOpts.innerHTML = '';
    if (brush.tool === 'pencil') {
      toolOpts.appendChild(
        sizeStepper({
          key: 'Size',
          label: 'size',
          value: brush.size,
          min: 1,
          max: brushMax,
          unit: 'px',
          onCommit: setPencilSize,
        })
      );
    } else if (brush.tool === 'rect') {
      toolOpts.appendChild(
        sizeStepper({
          key: 'Radius',
          label: 'radius',
          value: brush.cornerRadius,
          min: 0,
          max: radiusMax,
          unit: 'px',
          onCommit: setCornerRadius,
        })
      );
    } else if (brush.tool === 'fill') {
      // "replace" upgrades the flood to a whole-tile recolor of every matching texel;
      // "all tiles" (only meaningful with replace on) extends that across the atlas.
      toolOpts.append(
        checkbox({
          label: 'replace',
          checked: brush.fillReplace,
          title:
            'recolor every matching texel on this tile (not just the contiguous region)',
          onToggle: (v) => {
            brush.fillReplace = v;
            renderToolOptions(); // re-render so "all tiles" enables/disables with it
          },
        }),
        checkbox({
          label: 'all tiles',
          checked: brush.fillAllTiles,
          disabled: !brush.fillReplace,
          title: 'replace the clicked color across every tile in the atlas',
          onToggle: (v) => {
            brush.fillAllTiles = v;
          },
        })
      );
    }
  }
  renderToolOptions();

  // --- palette row: ink pickers ---------------------------------------------
  // The only row BELOW the canvas card: every color painted anywhere in the sprite,
  // so you can match existing colors.
  // The eyedropper and the transparent swatch sit here (not in the tool strip)
  // because they pick the pencil's INK — a sampled color, or transparent ("clear
  // color") — rather than a drawing tool. A leading "+" opens the full 256-color
  // palette modal.
  const usedRow = el('div', 'editor-used-row');
  const addBtn = el('button', 'editor-add');
  addBtn.type = 'button';
  addBtn.title = 'add a color from the 256 palette';
  addBtn.setAttribute('aria-label', 'add a color from the 256 palette');
  addBtn.appendChild(icon('add'));
  addBtn.onclick = () => openPalette();
  const eyeBtn = el('button', 'editor-pal-tool');
  eyeBtn.type = 'button';
  eyeBtn.appendChild(icon('sampler'));
  eyeBtn.title = 'eyedropper — click the sprite to sample (I, or hold Alt while drawing)';
  eyeBtn.setAttribute('aria-label', 'eyedropper');
  eyeBtn.onclick = () => {
    brush.picking = true;
    syncUI();
    redrawCursorLayer(); // arming pick reshapes the hover footprint (picking → size 1)
  };
  // The "transparent" swatch: a checkerboard tile that reads as a first-class
  // COLOR (empty / clear), not an eraser tool. Selecting it makes the pencil / rect
  // / fill lay transparent — `brush.erase` is still the underlying flag, but the UI
  // frames it as painting the empty color, matching the checker the canvas shows
  // through unpainted texels. Also reachable by `E` or a right-click.
  const transparentSw = el(
    'button',
    'editor-swatch editor-used-sw editor-transparent-sw'
  );
  transparentSw.type = 'button';
  transparentSw.title = 'transparent — paint the empty / clear color (E, or right-click)';
  transparentSw.setAttribute('aria-label', 'transparent (clear) color');
  transparentSw.onclick = () => {
    brush.erase = true;
    brush.picking = false;
    syncUI();
    redrawCursorLayer(); // erasing recolors the hover footprint outline red
  };
  usedRow.append(addBtn, eyeBtn, transparentSw);
  const FIXED_LEAD = usedRow.children.length; // fixed controls kept ahead of the swatches
  root.appendChild(usedRow);

  let lastUsedSig = null;
  let lastPaintedSig = null;
  const distinctWorkColors = () => distinctColors(work);
  let usedEls = []; // { el, rgb } for active-color highlighting
  function renderUsed() {
    // Colors actually painted somewhere: the other faces (usedColors) unioned with
    // this tile's own live pixels. This set alone drives the modal's "in sprite" rings.
    const painted = new Map();
    for (const c of usedColors) painted.set(rkey(c), c);
    for (const c of distinctWorkColors()) painted.set(rkey(c), c);
    // The "in sprite" rings track the PAINTED set only, so refresh them whenever it
    // changes — even when the swatch-row signature below is unchanged. (Erasing the
    // last pixel of a color that is STILL the selected ink drops it from `painted`
    // but not from the pinned-ink union, so the row sig wouldn't move and the ring
    // would wrongly stay lit if this were folded into the sig gate.)
    const paintedSig = [...painted.keys()].sort((a, b) => a - b).join(',');
    if (paintedSig !== lastPaintedSig) {
      lastPaintedSig = paintedSig;
      markInSprite(new Set(painted.keys()));
    }
    // The row ALSO carries the actively-chosen ink even before it's painted, so a
    // color picked from the "+" modal (or eyedropped) shows immediately as the
    // selected tile. `brush.chosen` gates out the untouched mount default.
    const map = new Map(painted);
    if (brush.chosen && brush.color) map.set(rkey(brush.color), { ...brush.color });
    const list = [...map.values()].sort((a, b) => rkey(a) - rkey(b));
    const sig = list.map(rkey).join(',');
    if (sig === lastUsedSig) return; // swatch set unchanged → skip DOM churn mid-stroke
    lastUsedSig = sig;
    // Rebuild the swatches but keep the leading fixed controls (+ / eyedrop / erase).
    while (usedRow.children.length > FIXED_LEAD) usedRow.removeChild(usedRow.lastChild);
    usedEls = [];
    for (const c of list) {
      const s = el('button', 'editor-swatch editor-used-sw');
      s.type = 'button';
      s.style.background = rgbHex(c);
      s.title = rgbHex(c);
      s.onclick = () => selectColor(c);
      usedRow.appendChild(s);
      usedEls.push({ el: s, rgb: c });
    }
    syncActiveSwatch();
  }

  // Ring the palette-modal swatches whose color is already painted in the sprite,
  // so the picker shows at a glance what's in use. An OUTLINE only — never dim the
  // rest; every one of the 256 must stay clearly visible. Recomputed by renderUsed
  // whenever the in-sprite set changes (a stroke can add or drop a color).
  function markInSprite(keySet) {
    for (const { el: e, rgb } of cubeEls) {
      e.classList.toggle('in-sprite', keySet.has(rkey(rgb)));
    }
  }

  // --- full-palette modal (opened by "+") -----------------------------------
  // The 256-color palette lives in a modal overlay (appended to <body> so it is
  // never clipped by the scrolling panel) as a 16x16 grid. The array is pre-laid
  // along a Hilbert curve (constants.js PALETTE_256), so a plain row-major fill
  // clusters similar colors both across and down.
  const modal = el('div', 'palette-modal');
  const backdrop = el('div', 'palette-modal-backdrop');
  backdrop.onclick = () => closePalette();
  const card = el('div', 'palette-modal-card');
  const head = el('div', 'palette-modal-head');
  head.append(el('span', null, `Palette · ${palette256.length}`));
  const closeX = el('button', 'palette-modal-close');
  closeX.type = 'button';
  closeX.title = 'close (Esc)';
  closeX.setAttribute('aria-label', 'close');
  closeX.appendChild(icon('close'));
  closeX.onclick = () => closePalette();
  head.appendChild(closeX);
  const cubeWrap = el('div', 'editor-cube');
  const cubeEls = [];
  for (const p of palette256) {
    const rgb = p.rgb;
    const s = el('button', 'editor-swatch');
    s.type = 'button';
    s.style.background = p.css;
    s.title = p.css;
    s.onclick = () => {
      selectColor(rgb);
      closePalette();
    };
    cubeWrap.appendChild(s);
    cubeEls.push({ el: s, rgb });
  }
  card.append(head, cubeWrap);
  modal.append(backdrop, card);
  document.body.appendChild(modal);

  let modalOpen = false;
  function openPalette() {
    modalOpen = true;
    modal.classList.add('open');
    syncActiveSwatch();
  }
  function closePalette() {
    modalOpen = false;
    modal.classList.remove('open');
  }

  // active-brush + tool state --------------------------------------------------
  // A swatch reads "active" only while the pencil is actually painting that color
  // (not while erasing or eyedropping), so the ink highlight can't lie.
  function syncActiveSwatch() {
    const painting = !brush.erase && !brush.picking;
    const pencilColor = painting ? brush.color : null;
    cubeEls.forEach(({ el: e, rgb }) =>
      e.classList.toggle('active', !!pencilColor && rgbEq(rgb, pencilColor))
    );
    usedEls.forEach(({ el: e, rgb }) =>
      e.classList.toggle('active', !!pencilColor && rgbEq(rgb, pencilColor))
    );
  }
  function syncUI() {
    pencilBtn.classList.toggle('active', brush.tool === 'pencil');
    rectBtn.classList.toggle('active', brush.tool === 'rect');
    fillBtn.classList.toggle('active', brush.tool === 'fill');
    eyeBtn.classList.toggle('active', brush.picking);
    transparentSw.classList.toggle('active', brush.erase && !brush.picking);
    // With the pencil (its eraser/eyedropper ink modes included) the hover
    // footprint outline stands in for the pointer, so hide the OS cursor over the
    // canvas — CSS `.pencil-active { cursor: none }` leaves only the outline. The
    // rect tool keeps the default crosshair (its drag preview stands apart).
    canvas.classList.toggle('pencil-active', brush.tool === 'pencil');
    syncActiveSwatch();
  }

  // keyboard: B / R / I / E pick pencil / rect / eyedropper / transparent-ink; Esc
  // closes the palette modal, or aborts an in-flight rect drag (nothing committed).
  // Escape is handled before the input guard so it fires even from a focused
  // stepper; the rest are suppressed while a text/number input (a stepper) is
  // focused so typing there is never hijacked. Torn down in destroy().
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (modalOpen) {
        closePalette();
        e.preventDefault();
        return;
      }
      if (rectDragging) {
        cancelRect(); // discard the box mid-drag — no pixels written
        e.preventDefault();
        return;
      }
    }
    // Shift held mid-drag locks the box to a square, even with the pointer still —
    // re-derive the preview from the raw corner (keydown repeats, so guard churn).
    if (e.key === 'Shift' && rectDragging && !shiftLock) {
      shiftLock = true;
      drawRectPreview();
      return;
    }
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    // Switching tools mid rect-drag abandons the box (nothing committed) — same as
    // ESC, so B/R/G can't leave a half-dragged rect wired to the old pointer.
    if (rectDragging && (k === 'b' || k === 'r' || k === 'g')) cancelRect();
    if (k === 'b') {
      brush.tool = 'pencil';
      brush.erase = false;
      brush.picking = false;
      if (!brush.color) brush.color = { ...palette[0].rgb };
    } else if (k === 'r') {
      brush.tool = 'rect';
      brush.erase = false;
      brush.picking = false;
      if (!brush.color) brush.color = { ...palette[0].rgb };
    } else if (k === 'g') {
      brush.tool = 'fill';
      brush.erase = false;
      brush.picking = false;
      if (!brush.color) brush.color = { ...palette[0].rgb };
    } else if (k === 'i') {
      brush.picking = true;
    } else if (k === 'e') {
      brush.erase = true;
      brush.picking = false;
    } else {
      return;
    }
    renderToolOptions(); // swap the per-tool options row to match the new tool
    syncUI();
    redrawCursorLayer(); // erasing recolors the footprint; a tool swap clears/redraws it
    e.preventDefault();
  }
  // Releasing Shift mid-drag drops the square-lock and re-derives the free box.
  function onKeyUp(e) {
    if (e.key === 'Shift' && rectDragging && shiftLock) {
      shiftLock = false;
      drawRectPreview();
    }
  }
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  renderUsed();
  syncUI();
  // Dev hook (?pick=N): select palette256[N] as if picked from the modal, so a
  // headless shot (which can't click a swatch) shows it landing as the selected
  // palette-row tile. Runs before the ?palette=1 open so the modal reflects it too.
  if (pickIndex != null && palette256[pickIndex]) {
    const rgb = palette256[pickIndex].rgb;
    selectColor(rgb);
  }
  // Dev hook (?palette=1): open the picker right away so the capture tool — which
  // can't click the "+" — can screenshot it. Consumed once by the caller.
  if (openPaletteOnMount) openPalette();

  // --- drawing --------------------------------------------------------------
  let drawing = false; // a pencil stroke is in progress
  let prev = null; // last painted texel this stroke, for line interpolation
  let forceErase = false; // right-click erases regardless of the active ink
  let hoverTexel = null; // last hovered texel, for the footprint preview
  // Rect-tool drag state: the anchor + moving corner, and the pointer we captured
  // (kept so ESC / pointercancel can release it). rectStart != null ⟺ dragging.
  let rectDragging = false;
  let rectStart = null; // anchor corner texel {px,py}
  let rectEnd = null; // raw moving corner texel {px,py} (pre square-lock)
  let rectPointer = null; // captured pointerId, for release on cancel
  let shiftLock = false; // Shift held → constrain the drag to a square

  function toTexel(e) {
    const rect = canvas.getBoundingClientRect();
    const px = Math.floor(((e.clientX - rect.left) / rect.width) * tileW);
    const py = Math.floor(((e.clientY - rect.top) / rect.height) * tileH);
    if (px < 0 || py < 0 || px >= tileW || py >= tileH) return null;
    return { px, py };
  }

  // Like toTexel but clamps to the tile instead of rejecting out-of-bounds, so a
  // rect drag that runs past the canvas edge (with the pointer captured) extends to
  // the edge rather than freezing.
  function toTexelClamped(e) {
    const rect = canvas.getBoundingClientRect();
    const px = Math.floor(((e.clientX - rect.left) / rect.width) * tileW);
    const py = Math.floor(((e.clientY - rect.top) / rect.height) * tileH);
    return {
      px: Math.max(0, Math.min(tileW - 1, px)),
      py: Math.max(0, Math.min(tileH - 1, py)),
    };
  }

  // Brush footprint: an N×N square anchored so the hovered texel stays inside and
  // odd sizes center exactly (even sizes bias up-left). Shared by the stamp and the
  // hover preview so what you see is what you paint. Returned bounds are unclamped.
  const brushBounds = (cx, cy, size) => {
    const o = Math.floor((size - 1) / 2);
    return { x0: cx - o, y0: cy - o, x1: cx - o + size - 1, y1: cy - o + size - 1 };
  };

  // Write one texel; returns true only if the bytes actually changed. Any two
  // fully-transparent texels are treated as equal regardless of stray RGB left
  // under alpha 0, so erasing an already-invisible texel is a true no-op and
  // never dirties a mirror-derived face into real art.
  function writeTexel(px, py) {
    const i = (py * tileW + px) * 4;
    const paint = !forceErase && !brush.erase;
    const r = paint ? brush.color.r : 0;
    const g = paint ? brush.color.g : 0;
    const b = paint ? brush.color.b : 0;
    const a = paint ? 255 : 0;
    if (a === 0 && work[i + 3] === 0) return false;
    if (work[i] === r && work[i + 1] === g && work[i + 2] === b && work[i + 3] === a) {
      return false;
    }
    work[i] = r;
    work[i + 1] = g;
    work[i + 2] = b;
    work[i + 3] = a;
    return true;
  }

  // Stamp the whole pencil footprint centered on (cx,cy), clipped to the tile;
  // returns true if any texel changed.
  function stampBrush(cx, cy) {
    const b = brushBounds(cx, cy, brush.size);
    const x1 = Math.min(tileW - 1, b.x1);
    const y1 = Math.min(tileH - 1, b.y1);
    let changed = false;
    for (let py = Math.max(0, b.y0); py <= y1; py++) {
      for (let px = Math.max(0, b.x0); px <= x1; px++) {
        if (writeTexel(px, py)) changed = true;
      }
    }
    return changed;
  }

  // Bresenham so a fast drag lays down a continuous stroke, not dotted samples —
  // stamping the full footprint at each step along the line.
  function stroke(px, py) {
    let changed = false;
    if (prev) {
      let x0 = prev.px;
      let y0 = prev.py;
      const dx = Math.abs(px - x0);
      const dy = -Math.abs(py - y0);
      const sx = x0 < px ? 1 : -1;
      const sy = y0 < py ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        if (stampBrush(x0, y0)) changed = true;
        if (x0 === px && y0 === py) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          x0 += sx;
        }
        if (e2 <= dx) {
          err += dx;
          y0 += sy;
        }
      }
    } else if (stampBrush(px, py)) {
      changed = true;
    }
    prev = { px, py };
    if (changed) {
      dirty = true;
      repaint();
      renderUsed(); // a stroke can add / remove a color from the sprite
      onLive?.(workingTile, dirty);
    }
  }

  // Hairline outline of the footprint the pencil would stamp, drawn on the topmost
  // overlay under the cursor (a haloed white rect; red while erasing). The
  // eyedropper previews a single cell (its sample target). Cleared with t == null
  // when the pointer leaves the canvas. Only the PENCIL has a hover footprint — the
  // rect tool relies on the OS crosshair when idle and its own drag preview when
  // dragging — so for any other tool this just clears the overlay.
  function drawCursor(t) {
    hoverTexel = t;
    cursorCtx.clearRect(0, 0, cssW, cssH);
    if (!t || brush.tool !== 'pencil') return;
    const size = brush.picking ? 1 : brush.size;
    const b = brushBounds(t.px, t.py, size);
    const x0 = Math.max(0, b.x0);
    const y0 = Math.max(0, b.y0);
    const x1 = Math.min(tileW - 1, b.x1);
    const y1 = Math.min(tileH - 1, b.y1);
    if (x1 < x0 || y1 < y0) return;
    const rx = x0 * scale + 0.5;
    const ry = y0 * scale + 0.5;
    const rw = (x1 - x0 + 1) * scale - 1;
    const rh = (y1 - y0 + 1) * scale - 1;
    cursorCtx.lineWidth = 3; // dark halo so the outline reads on any art color
    cursorCtx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    cursorCtx.strokeRect(rx, ry, rw, rh);
    cursorCtx.lineWidth = 1;
    cursorCtx.strokeStyle =
      brush.erase && !brush.picking
        ? 'rgba(255, 120, 120, 0.95)'
        : 'rgba(255, 255, 255, 0.95)';
    cursorCtx.strokeRect(rx, ry, rw, rh);
  }

  // The moving corner after any Shift square-lock (raw corner when unlocked).
  function effectiveEnd() {
    if (shiftLock && rectStart && rectEnd) return squareEnd(rectStart, rectEnd);
    return rectEnd;
  }

  // The current rect bounds (anchor + effective end normalized to top-left →
  // bottom-right), or null when not dragging. Preview + commit both read this, so
  // the Shift square-lock applies identically to what you see and what you paint.
  function rectBounds() {
    const end = effectiveEnd();
    if (!rectStart || !end) return null;
    return {
      x0: Math.min(rectStart.px, end.px),
      y0: Math.min(rectStart.py, end.py),
      x1: Math.max(rectStart.px, end.px),
      y1: Math.max(rectStart.py, end.py),
    };
  }

  // Live preview of the rect on the cursor overlay: the exact texels a commit will
  // fill (via the shared roundedRectRows — so rounded corners show precisely),
  // tinted by the active ink (red while erasing), under a haloed hairline of the
  // drag bounding box so the extent reads on any art even before the fill is
  // obvious. Nothing is written to `work` until commitRect() on pointer-up.
  function drawRectPreview() {
    cursorCtx.clearRect(0, 0, cssW, cssH);
    const b = rectBounds();
    if (!b) return;
    const erasing = forceErase || brush.erase;
    cursorCtx.fillStyle = erasing
      ? 'rgba(255, 120, 120, 0.35)'
      : `rgba(${brush.color.r}, ${brush.color.g}, ${brush.color.b}, 0.5)`;
    roundedRectRows(b.x0, b.y0, b.x1, b.y1, brush.cornerRadius, (y, xl, xr) => {
      if (xr < xl) return; // empty row at an extreme radius
      cursorCtx.fillRect(xl * scale, y * scale, (xr - xl + 1) * scale, scale);
    });
    const rx = b.x0 * scale + 0.5;
    const ry = b.y0 * scale + 0.5;
    const rw = (b.x1 - b.x0 + 1) * scale - 1;
    const rh = (b.y1 - b.y0 + 1) * scale - 1;
    cursorCtx.lineWidth = 3; // dark halo so the box reads on any art color
    cursorCtx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    cursorCtx.strokeRect(rx, ry, rw, rh);
    cursorCtx.lineWidth = 1;
    cursorCtx.strokeStyle = erasing
      ? 'rgba(255, 120, 120, 0.95)'
      : 'rgba(255, 255, 255, 0.95)';
    cursorCtx.strokeRect(rx, ry, rw, rh);
  }

  // Rasterize the finished rect into `work` (same roundedRectRows the preview used,
  // so what you saw is what you get), then repaint + notify if anything changed.
  function commitRect() {
    const b = rectBounds();
    if (!b) return;
    let changed = false;
    roundedRectRows(b.x0, b.y0, b.x1, b.y1, brush.cornerRadius, (y, xl, xr) => {
      for (let x = xl; x <= xr; x++) if (writeTexel(x, y)) changed = true;
    });
    if (changed) {
      dirty = true;
      repaint();
      renderUsed(); // a rect can add / remove a color from the sprite
      onLive?.(workingTile, dirty);
    }
  }

  // Abort an in-flight rect drag: drop the state, clear the preview, release the
  // captured pointer. Nothing is written to `work` — ESC / pointercancel land here.
  function cancelRect() {
    if (!rectDragging) return;
    rectDragging = false;
    rectStart = rectEnd = null;
    forceErase = false;
    shiftLock = false;
    cursorCtx.clearRect(0, 0, cssW, cssH);
    if (rectPointer != null) {
      canvas.releasePointerCapture?.(rectPointer);
      rectPointer = null;
    }
  }

  // Redraw the top (cursor) overlay for the current state: the rect drag preview
  // while dragging, else the pencil hover footprint (a no-op clear for the idle
  // rect tool). Used by layout() and the keyboard tool-switch so a re-fit or a
  // B/R/E press repaints the right thing.
  function redrawCursorLayer() {
    if (rectDragging) drawRectPreview();
    else drawCursor(hoverTexel);
  }

  function sampleAt(px, py) {
    const i = (py * tileW + px) * 4;
    if (work[i + 3] === 0) {
      // Sampling empty space picks the transparent ink (clear color).
      brush.erase = true;
      brush.picking = false;
      syncUI();
    } else {
      // Route through selectColor so an off-palette (imported) sample becomes the
      // pencil color (and shows up in the palette row) just like any pick.
      const c = { r: work[i], g: work[i + 1], b: work[i + 2] };
      selectColor(c);
    }
    drawCursor(hoverTexel); // sampling ends eyedrop mode → footprint returns to size
  }

  // The ink a fill lays down: the active color, or transparent when erasing (a
  // right-click, or the eraser ink) — mirrors the pencil / rect erase rule.
  const fillInk = (rightClick) =>
    rightClick || brush.erase
      ? { transparent: true }
      : { r: brush.color.r, g: brush.color.g, b: brush.color.b };

  // Apply a fill to THIS tile's working buffer: a contiguous flood from (t), or —
  // with "replace" on — a whole-tile recolor of every texel matching the clicked
  // color. Repaints + notifies like any stroke if anything changed. This is the
  // whole op for the single-tile modes; the all-tiles mode delegates instead (below).
  function applyLocalFill(t, rightClick) {
    const fill = fillInk(rightClick);
    const i0 = (t.py * tileW + t.px) * 4;
    const changed = brush.fillReplace
      ? replaceColor(work, keyAt(work, i0), fill)
      : floodFill(work, tileW, tileH, t.px, t.py, fill);
    if (changed) {
      dirty = true;
      repaint();
      renderUsed(); // a fill can add / remove a color from the sprite
      onLive?.(workingTile, dirty);
    }
  }

  // Route a fill click. "replace" + "all tiles" hands the whole op to the caller
  // (it recolors the clicked color across every tile and re-mounts this editor);
  // the target color is read from the clicked texel here so the caller doesn't have
  // to. Every other mode fills this tile in place.
  function doFill(t, rightClick) {
    if (brush.fillReplace && brush.fillAllTiles) {
      const target = keyAt(work, (t.py * tileW + t.px) * 4);
      onReplaceAllTiles?.(target, fillInk(rightClick));
      return;
    }
    applyLocalFill(t, rightClick);
  }

  function onPointerDown(e) {
    const t = toTexel(e);
    if (!t) return;
    e.preventDefault();
    drawCursor(t);
    // Alt-hold = momentary eyedropper (sample without switching ink first);
    // a right-click still erases even with Alt down. Works with any tool.
    if (e.button !== 2 && (e.altKey || brush.picking)) {
      sampleAt(t.px, t.py);
      return;
    }
    if (brush.tool === 'fill') {
      doFill(t, e.button === 2); // single click — no drag, no pointer capture
      return;
    }
    if (brush.tool === 'rect') {
      // A real drag owns exactly one pointer; a second concurrent pointer (a stray
      // finger on a touch screen) must not hijack it. The ?rect dev-hook leaves a
      // phantom drag with no owner (rectPointer null), which a real down may take over.
      if (rectDragging && rectPointer != null) return;
      forceErase = e.button === 2;
      shiftLock = e.shiftKey; // Shift held at press → start square-locked
      rectDragging = true;
      rectStart = t;
      rectEnd = t;
      rectPointer = e.pointerId;
      canvas.setPointerCapture?.(e.pointerId);
      drawRectPreview();
      return;
    }
    forceErase = e.button === 2;
    drawing = true;
    prev = null;
    canvas.setPointerCapture?.(e.pointerId);
    stroke(t.px, t.py);
  }
  function onPointerMove(e) {
    if (rectDragging) {
      // Only the drag-owning pointer rubber-bands the box; a non-owner move (or a
      // bare hover over the ownerless dev-hook phantom) leaves the preview pinned.
      if (e.pointerId !== rectPointer) return;
      shiftLock = e.shiftKey; // track Shift held during the drag
      rectEnd = toTexelClamped(e); // clamp so a past-the-edge drag pins to the edge
      drawRectPreview();
      return;
    }
    const t = toTexel(e);
    drawCursor(t); // keep the footprint preview under the cursor (hover + drag)
    if (!drawing || !t) return;
    stroke(t.px, t.py);
  }
  function onPointerUp(e) {
    if (rectDragging) {
      if (e.pointerId !== rectPointer) return; // ignore a stray second pointer's up
      rectEnd = toTexelClamped(e);
      commitRect();
      rectDragging = false;
      rectStart = rectEnd = null;
      forceErase = false;
      shiftLock = false;
      canvas.releasePointerCapture?.(rectPointer); // release the owner, not e.pointerId
      rectPointer = null;
      cursorCtx.clearRect(0, 0, cssW, cssH); // drop the preview; commit is on `work`
      return;
    }
    drawing = false;
    prev = null;
    forceErase = false;
    canvas.releasePointerCapture?.(e.pointerId);
  }
  // pointercancel (gesture interrupted) discards an in-flight rect rather than
  // committing a box the user didn't finish; a pencil stroke is already committed.
  function onPointerCancel(e) {
    if (rectDragging) {
      if (e.pointerId !== rectPointer) return; // a non-owner cancel can't abort the drag
      cancelRect();
      return;
    }
    drawing = false;
    prev = null;
    forceErase = false;
    canvas.releasePointerCapture?.(e.pointerId);
  }
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  // Clear the pencil hover footprint when the pointer leaves — but not mid rect
  // drag (capture keeps the events coming; the preview must survive an edge cross).
  canvas.addEventListener('pointerleave', () => {
    if (!rectDragging) drawCursor(null);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // right-click = erase

  // Size everything now, and re-fit whenever the sidebar (this panel) resizes — the
  // container is a fixed fraction of the panel height, so a window resize changes it
  // and the centered canvas must re-scale. Observing the panel is safe from feedback:
  // the layers we resize live inside it and never change ITS box, and a no-op re-run
  // (same scale) early-returns.
  layout();
  let resizeObs = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObs = new ResizeObserver(() => layout());
    resizeObs.observe(container);
  }

  // Dev hook (?cursor=N): draw the footprint at the tile center on mount so a
  // headless shot — which has no pointer to hover — can show the preview.
  if (previewCursor) drawCursor({ px: tileW >> 1, py: tileH >> 1 });

  // Dev hook (?rect=x0,y0,x1,y1[,r[,sq]]): select the rect tool, set the radius, and
  // draw the live drag preview for that box so a headless shot (which can't drag)
  // shows the tool mid-drag (sq=1 shows the Shift square-lock). Modeled as an active
  // drag with no captured pointer, so the preview survives a re-layout and pressing
  // ESC still demonstrates cancel.
  if (previewRect) {
    brush.tool = 'rect';
    if (previewRect.r != null) brush.cornerRadius = clampRadius(previewRect.r);
    renderToolOptions();
    syncUI();
    const clampX = (v) => Math.max(0, Math.min(tileW - 1, v | 0));
    const clampY = (v) => Math.max(0, Math.min(tileH - 1, v | 0));
    rectStart = { px: clampX(previewRect.x0), py: clampY(previewRect.y0) };
    rectEnd = { px: clampX(previewRect.x1), py: clampY(previewRect.y1) };
    shiftLock = !!previewRect.square; // ?rect=...,sq demos the Shift square-lock
    rectDragging = true;
    drawRectPreview();
  }

  // Dev hook (?fill=x,y[,r[,a]]): select the fill tool, set its checkboxes (replace=r,
  // all-tiles=a), and fill at (x,y) so a headless shot (which can't click) shows the
  // tool + result. Runs AFTER ?pick so ?pick=N&fill=x,y fills with palette color N.
  // The mount fill is always LOCAL (never the all-tiles delegation) — a single editor
  // shot only shows the current tile, and a local fill avoids a re-mount mid-mount.
  if (fillOnMount) {
    brush.tool = 'fill';
    brush.erase = false; // match every tool-select handler: a fill paints, not erases
    brush.picking = false;
    brush.fillReplace = !!fillOnMount.replace;
    brush.fillAllTiles = !!fillOnMount.all;
    renderToolOptions();
    syncUI();
    const fx = Math.max(0, Math.min(tileW - 1, fillOnMount.x | 0));
    const fy = Math.max(0, Math.min(tileH - 1, fillOnMount.y | 0));
    applyLocalFill({ px: fx, py: fy }, false);
  }

  // A resize re-mounts the whole editor, which would drop keyboard focus off the
  // stepper the user was typing in. Restore it to the matching new field (and
  // select its text) so Tab/Enter-driven sizing keeps flowing.
  if (focusSize) {
    const inp = root.querySelector(`.editor-step-val[data-axis="${focusSize}"]`);
    if (inp) {
      inp.focus();
      inp.select?.();
    }
  }

  // --- teardown -------------------------------------------------------------
  let destroyed = false;
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    // The keydown listener isn't on `container`, so drop it explicitly — a face
    // swap / resize re-mounts this editor often, and it would otherwise leak.
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    resizeObs?.disconnect(); // stop observing the panel (we observe it, not a child)
    modal.remove(); // the modal lives on <body>, outside `container`
    container.innerHTML = ''; // removes the canvas + its pointer listeners with it
  }
  return { destroy };
}
