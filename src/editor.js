// ---------------------------------------------------------------------------
// The tools panel (LEFT half of the workspace): a pixel editor for one atlas
// face, drawn with the `vintage-frames` System 7 web component kit. Permanently
// docked — a face is always selected; the 3D view stays live + interactive on
// the right. Pure DOM; no imports from the voxel pipeline.
//
// The panel is a fixed flex column:
//   1. SETTINGS row (top, fixed): the TILE-SIZE number field (little-arrows
//      stepper) and the FACE PICKER — six cube-view icons (placeholder art; real
//      assets to come) over a vf-radio-group, replacing the old folder tabs.
//   2. A dotted separator.
//   3. MAIN area (grows): a left RAIL — the TOOL STRIP (pencil / rect / fill /
//      eyedropper as a 1-column vf-grid of cells; the selected tool inverts)
//      over the COLOR WELL group: the current-ink vf-swatch (a click opens the
//      256-color picker dialog), the LAST THREE USED colors below it, and a
//      transparent checker swatch (the empty / clear "color") — beside the
//      DRAW BOX: a bordered column of the per-tool OPTIONS bar (the pencil's
//      tip-size vf-slider; the rect's corner-radius vf-number-field; the fill's
//      two vf-checkboxes) over the dark artwork well holding the pixel canvas.
//
// The 256-color picker is a vf-dialog holding a 16×16 vf-grid of vf-swatch
// cells, built lazily on first open. The old "every color painted anywhere"
// tray is gone — the recency row below the current swatch replaces it.
//
// The brush selection is held in the caller-owned `brush` object so it survives
// a face swap (which destroys + re-mounts this editor). Every stroke is
// HARD-pixel (alpha 0 or 255) so downstream ingest (alpha>=128) and
// atlas.isBlank (alpha!==0) can never diverge.
//
// createTileEditor(container, { name, tile, tileW, tileH, palette, palette256,
//   mirrorBehind, guides, faces, brush, sizeMin, sizeMax, focusSize,
//   onLive, onSelectFace, onResizeTile, onReplaceAllTiles })
//   -> { destroy }
//   - mirrorBehind: {width,height,data} onion-skin of the opposite face drawn
//     faded UNDER the pixel canvas (display only — never written to `work`). null
//     when the opposite face has no art of its own. A mirror-derived face opens
//     with an EMPTY canvas and this faded mirror as its only reference.
//   - guides: from faceGuides() — extent of the orthogonal faces' pixels, drawn
//     as hairline rules over the canvas so you can align to the stricter carve.
//   - faces: the ordered list of all six atlas faces, shown in the face picker;
//     the edited `name` is the checked radio and picking another switches.
//   - palette256: the full 256-color editor palette ({ css, rgb }[]) shown in
//     the picker dialog as a 16x16 grid. It arrives already laid out along a
//     Hilbert curve (constants.js PALETTE_256), so iterating it row-major
//     clusters similar colors both across and down — this editor never reorders
//     it. `palette` (DB16) is no longer displayed; it still seeds the default
//     brush color and `B`.
//   - brush: shared { tool, color:{r,g,b}, erase, picking, size, cornerRadius,
//     fillReplace, fillAllTiles, recent } — persisted by the caller across face
//     swaps. `tool` is the drawing op ('pencil'|'rect'|'fill'; all live).
//     `erase` makes the stroke/rect/fill lay transparent; `picking` arms the
//     eyedropper for the next canvas click; `size` is the pencil's N×N tip
//     footprint (in texels); `cornerRadius` is the rect tool's corner radius
//     (in texels, 0 = sharp). `fillReplace` upgrades the fill from a contiguous
//     flood to a whole-tile recolor of every matching texel; `fillAllTiles`
//     (only meaningful when `fillReplace` is on) extends that recolor across
//     every tile in the atlas. `recent` is the MRU list of chosen inks
//     ({r,g,b}[], most recent first, current ink at [0]) — slots 1..3 render as
//     the "last three used colors" under the current swatch.
//   - sizeMin/sizeMax: inclusive integer bounds for the TILE-size field.
//   - focusSize: refocus the tile-size field after a resize re-mount (typed entry flow).
//   - openPaletteOnMount: dev hook (?palette=1) — open the color-picker dialog
//     immediately so headless screenshots (which can't click the swatch) can show it.
//   - previewCursor: dev hook (?cursor=N) — set the pencil size to N and draw its
//     footprint outline at the tile center on mount, so a headless shot (which has
//     no pointer to hover) can show the preview. Consumed once by the caller.
//   - previewRect: dev hook (?rect=x0,y0,x1,y1[,r[,sq]]) — select the rect tool and
//     draw its live drag preview for that box (radius r; sq=1 for the Shift square-
//     lock) on mount, so a headless shot (which can't drag) can show the tool
//     mid-drag. Consumed once by the caller.
//   - pickIndex: dev hook (?pick=N) — select palette256[N] as the ink on mount, as
//     if picked from the dialog, so a headless shot (which can't click a swatch) can
//     show it landing as the current-ink swatch. Consumed once.
//   - fillOnMount: dev hook (?fill=x,y[,r[,a]]) — select the fill tool, set its two
//     checkboxes (replace=r, all-tiles=a), and perform a fill at (x,y) on mount, so a
//     headless shot (which can't click) can show the tool + result. The mount fill is
//     always applied LOCALLY (to this tile only) even with a=1 — a single editor shot
//     shows only the current tile anyway, and a local fill avoids a re-mount mid-mount.
//     Consumed once by the caller.
//   - onLive(workingTile, dirty): fired on each actual pixel change.
//   - onSelectFace(name): the user picked another face.
//   - onResizeTile(size): the user changed the tile size. Tiles are locked SQUARE,
//     so the caller resizes the whole atlas to size×size (CENTERED — see resizeAtlas
//     anchor:'center') and re-mounts.
//   - onReplaceAllTiles(target, fill): the user committed a fill with BOTH the
//     "replace" and "all tiles" checkboxes on. `target`/`fill` are color keys
//     ({transparent:true} | {r,g,b}); the caller replaces every `target` texel with
//     `fill` across the whole atlas sheet and re-mounts this editor on the same face.
//     The single-tile fill modes (contiguous flood, or whole-tile replace) never call
//     this — they mutate the working tile directly and fire onLive like any stroke.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { icon } from './icons.js';
import { faceIcon } from './face-icons.js';
import { roundedRectRows, maxCornerRadius, squareEnd } from './lib/rect.js';
import { keyAt, floodFill, replaceColor } from './lib/fill.js';
import { rgbKey } from './lib/color.js';

// The pixel-canvas CONTAINER fills the draw box below the options bar (CSS
// flex:1), so the canvas grows to consume whatever height the fixed settings row
// (top) leaves. Its height is CSS-driven — no JS pin — so nothing shifts as the
// tile size (and thus the drawn canvas) changes. The square canvas is centered
// inside at the largest integer texel scale that fits.

// Hairline extent rules: translucent cyan so they read as guides distinct from
// the sprite art. MIRROR_ALPHA keeps the onion-skin a faint hint.
const GUIDE_COLOR = 'rgba(120, 200, 255, 0.6)';
const MIRROR_ALPHA = 0.22;

// How many "last used" colors show under the current swatch.
const RECENT_SLOTS = 3;

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

// A vf-label caption (display face by default; `dim` for the grayed fine print).
function caption(text, { dim = false, body = false } = {}) {
  const l = document.createElement('vf-label');
  if (dim) l.setAttribute('dim', '');
  if (body) l.setAttribute('face', 'body');
  l.textContent = text;
  return l;
}

const toHex2 = (n) => n.toString(16).padStart(2, '0');
const rgbHex = ({ r, g, b }) => `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;

export function createTileEditor(
  container,
  {
    name,
    tile,
    tileW,
    tileH,
    palette,
    palette256 = [],
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
  // and `picking` the ink/sample flags, `size` the pencil's N×N footprint,
  // `recent` the MRU ink list behind the "last used colors" row.
  if (!brush.color) brush.color = { ...palette[0].rgb };
  if (brush.tool == null) brush.tool = 'pencil';
  if (brush.erase == null) brush.erase = false;
  if (brush.picking == null) brush.picking = false;
  if (brush.size == null) brush.size = 1;
  if (brush.cornerRadius == null) brush.cornerRadius = 0;
  if (brush.fillReplace == null) brush.fillReplace = false;
  if (brush.fillAllTiles == null) brush.fillAllTiles = false;
  if (!Array.isArray(brush.recent)) brush.recent = [];

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

  // --- panel skeleton: settings row / dotted rule / main area ----------------
  const settings = el('div', 'editor-settings');
  const rule = document.createElement('vf-separator');
  rule.className = 'editor-sep';
  const main = el('div', 'editor-main');
  root.append(settings, rule, main);

  // --- settings row: tile-size field + face picker ---------------------------
  // Tile size: the classic "little arrows" number field. Tiles are locked
  // SQUARE, so a resize is always alignment-safe; a commit re-mounts the whole
  // editor at the new size (main.js resizeTiles).
  const tileField = /** @type {any} */ (document.createElement('vf-number-field'));
  tileField.className = 'editor-tile-size';
  tileField.setAttribute('value', String(tileW));
  tileField.setAttribute('min', String(sizeMin));
  tileField.setAttribute('max', String(sizeMax));
  tileField.setAttribute('step', '1');
  tileField.setAttribute('label', `tile size (${sizeMin}–${sizeMax})`);
  tileField.addEventListener('vf-change', (e) => {
    const n = /** @type {CustomEvent} */ (e).detail.valueAsNumber;
    if (Number.isFinite(n) && n !== tileW) onResizeTile?.(n);
  });
  const tileGroup = el('div', 'editor-tile-group');
  tileGroup.append(tileField, caption('tile size', { dim: true }));
  settings.appendChild(tileGroup);

  // Face picker: six cube-view icons (placeholder inline SVGs — see
  // face-icons.js) over a vf-radio-group, laid out as mirror pairs by `faces`.
  // Picking a face re-mounts the editor there (live edits are already
  // committed), exactly as the old folder tabs did.
  const facePicker = /** @type {any} */ (document.createElement('vf-radio-group'));
  facePicker.className = 'editor-face-picker';
  facePicker.setAttribute('label', 'edit face');
  facePicker.setAttribute('value', name);
  const faceRow = el('div', 'editor-face-row');
  for (const f of faces || [name]) {
    const cell = el('div', 'editor-face-cell');
    cell.title = f;
    cell.appendChild(faceIcon(f));
    const radio = document.createElement('vf-radio');
    radio.setAttribute('value', f);
    radio.setAttribute('aria-label', f);
    cell.appendChild(radio);
    // The cube icon is a click target too; the radio's own click already routes
    // through the group's vf-change, so skip it here to avoid a double switch.
    cell.addEventListener('click', (e) => {
      if (/** @type {Element} */ (e.target).closest?.('vf-radio')) return;
      if (f !== name) onSelectFace?.(f);
    });
    faceRow.appendChild(cell);
  }
  facePicker.appendChild(faceRow);
  facePicker.addEventListener('vf-change', (e) => {
    const f = /** @type {CustomEvent} */ (e).detail.value;
    if (f && f !== name) onSelectFace?.(f);
  });
  settings.appendChild(facePicker);

  // --- main area: left rail (tools + colors) beside the draw box -------------
  const rail = el('div', 'editor-rail');
  const drawbox = el('div', 'editor-drawbox');
  main.append(rail, drawbox);

  const rgbEq = (a, b) => a.r === b.r && a.g === b.g && a.b === b.b;

  // MRU ink recency: `brush.recent[0]` is the current ink; slots 1..RECENT_SLOTS
  // are the "last used colors" row. Updated on every actual pick (dialog,
  // eyedrop, recency swatch) — never by the untouched mount default.
  function touchRecent(c) {
    const key = rgbKey(c);
    brush.recent = [
      { r: c.r, g: c.g, b: c.b },
      ...brush.recent.filter((x) => rgbKey(x) !== key),
    ].slice(0, RECENT_SLOTS + 1);
  }

  // The single path every color pick funnels through (picker dialog, in-sprite
  // eyedrop, recency swatch): make `color` the ink, clear the erase/eyedropper
  // flags, and promote it to the top of the recency list.
  function selectColor(color) {
    brush.color = { r: color.r, g: color.g, b: color.b };
    brush.erase = false;
    brush.picking = false;
    touchRecent(brush.color);
    renderRecent();
    syncUI();
  }

  // --- tool strip: a 1-column System 7 cell grid ------------------------------
  // Pencil, rect, and fill are the drawing ops; the eyedropper arms a one-shot
  // sample (`I`, or hold Alt). The selected cell inverts.
  const toolstrip = document.createElement('vf-grid');
  toolstrip.className = 'editor-toolstrip';
  toolstrip.setAttribute('columns', '1');
  toolstrip.setAttribute('cell-width', '28');
  toolstrip.setAttribute('cell-height', '28');
  toolstrip.setAttribute('role', 'group');
  toolstrip.setAttribute('aria-label', 'tools');
  const toolBtn = (name_, iconName, title) => {
    const b = el('button', 'editor-tool');
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', name_);
    b.appendChild(icon(iconName));
    toolstrip.appendChild(b);
    return b;
  };
  const pencilBtn = toolBtn('pencil', 'draw', 'pencil — draw (B)');
  const rectBtn = toolBtn('rectangle', 'rectangle', 'rectangle — drag a box (R)');
  const fillBtn = toolBtn(
    'fill',
    'color-fill',
    'fill — flood a region, or replace a color (G)'
  );
  const eyeBtn = toolBtn(
    'eyedropper',
    'sampler',
    'eyedropper — click the sprite to sample (I, or hold Alt while drawing)'
  );
  rail.appendChild(toolstrip);

  // Shared body for the three drawing-tool cells: abandon any in-flight rect
  // (switching tool mid-drag discards the box, matching the B/R/G keys), select
  // the tool, return to painting (out of eraser / eyedropper), ensure an ink,
  // then refresh the options row + UI state + cursor overlay.
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
  pencilBtn.onclick = () => switchTool('pencil');
  rectBtn.onclick = () => switchTool('rect');
  fillBtn.onclick = () => switchTool('fill');
  eyeBtn.onclick = () => {
    brush.picking = true;
    syncUI();
    redrawCursorLayer(); // arming pick reshapes the hover footprint (picking → size 1)
  };

  // --- color wells: current ink, last-3-used, transparent --------------------
  // The current-ink swatch doubles as the picker opener (a click drops the
  // 256-color dialog). While the transparent ink is active it shows the kit's
  // no-color checker — the same "empty color" the canvas shows through
  // unpainted texels.
  const colorsBox = el('div', 'editor-colors');
  const selectedSw = /** @type {any} */ (document.createElement('vf-swatch'));
  selectedSw.className = 'editor-selected';
  selectedSw.setAttribute('width', '40');
  selectedSw.setAttribute('height', '28');
  selectedSw.setAttribute('label', 'selected color — open the color picker');
  selectedSw.title = 'selected color — open the color picker';
  selectedSw.addEventListener('click', () => openPicker());
  const recentBox = el('div', 'editor-recent');
  const transparentSw = /** @type {any} */ (document.createElement('vf-swatch'));
  transparentSw.className = 'editor-transparent';
  transparentSw.setAttribute('width', '16');
  transparentSw.setAttribute('height', '16');
  transparentSw.setAttribute('label', 'transparent (clear) color');
  transparentSw.title = 'transparent — paint the empty / clear color (E, or right-click)';
  transparentSw.addEventListener('click', () => {
    brush.erase = true;
    brush.picking = false;
    syncUI();
    redrawCursorLayer(); // erasing recolors the hover footprint outline red
  });
  colorsBox.append(selectedSw, recentBox, transparentSw);
  rail.appendChild(colorsBox);

  // The "last three used colors" under the current swatch: recency slots 1..3
  // (slot 0 is the current ink, already shown by the swatch above).
  function renderRecent() {
    recentBox.innerHTML = '';
    for (const c of brush.recent.slice(1, RECENT_SLOTS + 1)) {
      const hex = rgbHex(c);
      const sw = document.createElement('vf-swatch');
      sw.setAttribute('width', '16');
      sw.setAttribute('height', '16');
      sw.setAttribute('color', hex);
      sw.setAttribute('label', hex);
      sw.title = hex;
      sw.addEventListener('click', () => selectColor(c));
      recentBox.appendChild(sw);
    }
  }

  // --- draw box: per-tool options bar over the artwork well ------------------
  const toolOpts = el('div', 'editor-opts');
  drawbox.appendChild(toolOpts);

  function setPencilSize(n) {
    brush.size = clampBrush(n);
    drawCursor(hoverTexel); // reflect the new footprint immediately if hovering
  }
  function setCornerRadius(n) {
    brush.cornerRadius = clampRadius(n);
    if (rectDragging) drawRectPreview(); // re-round the in-flight box live
  }

  // Contextual options: the pencil's tip-size slider (with a live readout), the
  // rect's corner-radius field, or the fill's two checkboxes.
  function renderToolOptions() {
    toolOpts.innerHTML = '';
    if (brush.tool === 'pencil') {
      const slider = /** @type {any} */ (document.createElement('vf-slider'));
      slider.className = 'editor-size-slider';
      slider.setAttribute('min', '1');
      slider.setAttribute('max', String(brushMax));
      slider.setAttribute('step', '1');
      slider.setAttribute('value', String(brush.size));
      slider.setAttribute('label', `pencil size (1–${brushMax})`);
      const readout = caption(`${brush.size} px`, { dim: true });
      // vf-input fires on every drag move / key change, so the hover footprint
      // tracks the slider in real time.
      slider.addEventListener('vf-input', (e) => {
        setPencilSize(/** @type {CustomEvent} */ (e).detail.value);
        readout.textContent = `${brush.size} px`;
      });
      toolOpts.append(slider, readout);
    } else if (brush.tool === 'rect') {
      const field = /** @type {any} */ (document.createElement('vf-number-field'));
      field.setAttribute('min', '0');
      field.setAttribute('max', String(radiusMax));
      field.setAttribute('step', '1');
      field.setAttribute('value', String(brush.cornerRadius));
      field.setAttribute('label', `corner radius (0–${radiusMax})`);
      field.addEventListener('vf-change', (e) => {
        setCornerRadius(/** @type {CustomEvent} */ (e).detail.valueAsNumber);
      });
      toolOpts.append(caption('radius', { dim: true }), field);
    } else if (brush.tool === 'fill') {
      // "replace" upgrades the flood to a whole-tile recolor of every matching
      // texel; "all tiles" (only meaningful with replace on) extends that across
      // the atlas.
      const replaceCb = /** @type {any} */ (document.createElement('vf-checkbox'));
      replaceCb.textContent = 'replace';
      if (brush.fillReplace) replaceCb.setAttribute('checked', '');
      replaceCb.title =
        'recolor every matching texel on this tile (not just the contiguous region)';
      replaceCb.addEventListener('vf-change', (e) => {
        brush.fillReplace = !!(/** @type {CustomEvent} */ (e).detail.checked);
        renderToolOptions(); // re-render so "all tiles" enables/disables with it
      });
      const allCb = /** @type {any} */ (document.createElement('vf-checkbox'));
      allCb.textContent = 'all tiles';
      if (brush.fillAllTiles) allCb.setAttribute('checked', '');
      if (!brush.fillReplace) allCb.setAttribute('disabled', '');
      allCb.title = 'replace the clicked color across every tile in the atlas';
      allCb.addEventListener('vf-change', (e) => {
        brush.fillAllTiles = !!(/** @type {CustomEvent} */ (e).detail.checked);
      });
      toolOpts.append(replaceCb, allCb);
    }
  }
  renderToolOptions();

  // --- canvas: container filling the draw box + centered, maximal canvas ----
  // The CONTAINER (.editor-canvas-wrap) fills the draw box below the options bar
  // (CSS flex:1) — its height comes from the flex layout, not JS — so nothing
  // shifts when the tile size (and thus the drawn canvas) changes. Inside it, a
  // .editor-canvas-stack holds four aligned layers, centered and scaled by layout()
  // to the largest integer texel size that fits: a background (checkerboard via CSS +
  // faded opposite-face onion-skin), the transparent pixel canvas, a hairline guide
  // overlay, and a cursor overlay (the hover footprint). Only the pixel canvas takes
  // pointer events. The pixel + bg canvases keep a native tileW×tileH backing store
  // (CSS upscales them crisp); the overlay + cursor are SCREEN-res (backing tracks the
  // on-screen px) so their 1px lines stay crisp.
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
  drawbox.appendChild(wrap); // the canvas container fills the draw box below the options

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

  // Fit the largest integer-scaled tile rect inside the canvas container's content
  // box, size every layer to it, and redraw the screen-res overlays. The container's
  // height is CSS-driven (it fills the flex draw box), so layout() only MEASURES it —
  // it never sets a height. Called on mount and whenever the container resizes
  // (window resize → flex reflow); idempotent — a re-run at the same scale
  // early-returns. Reads `redrawCursorLayer`/`hoverTexel`, defined below, but is only
  // CALLED after they exist.
  function layout() {
    // Measure both axes from the client box (border-excluded), subtracting padding so
    // the 1px border isn't double-counted: an over-measure could round the integer
    // scale one step too big and the stack would clip under overflow:hidden.
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

  // --- the 256-color picker dialog (lazy) ------------------------------------
  // A System 7 movable modal holding the Hilbert-laid palette as a 16×16 grid of
  // swatch cells. Built on first open (256 elements — most mounts never open it)
  // and appended to <body> so it is never clipped by the panel.
  let picker = null;
  let pickerOpen = false;
  function ensurePicker() {
    if (picker) return picker;
    picker = /** @type {any} */ (document.createElement('vf-dialog'));
    picker.setAttribute('heading', 'Colors');
    picker.setAttribute('closable', '');
    picker.setAttribute('width', '244');
    picker.setAttribute('height', '266');
    const grid = document.createElement('vf-grid');
    grid.className = 'editor-picker-grid';
    grid.setAttribute('columns', '16');
    grid.setAttribute('cell-width', '12');
    grid.setAttribute('cell-height', '12');
    grid.setAttribute('collapse', '');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'color palette');
    for (const p of palette256) {
      const sw = document.createElement('vf-swatch');
      sw.setAttribute('width', '14');
      sw.setAttribute('height', '14');
      sw.setAttribute('color', p.css);
      sw.setAttribute('label', p.css);
      sw.title = p.css;
      sw.addEventListener('click', () => {
        selectColor(p.rgb);
        closePicker();
      });
      grid.appendChild(sw);
    }
    picker.appendChild(grid);
    // Fires on every close route: the close box, Escape (native dialog cancel),
    // and programmatic close().
    picker.addEventListener('vf-close', () => {
      pickerOpen = false;
    });
    document.body.appendChild(picker);
    return picker;
  }
  function openPicker() {
    ensurePicker().show();
    pickerOpen = true;
  }
  function closePicker() {
    if (pickerOpen) picker.close();
  }

  // --- brush + tool state reflection -----------------------------------------
  // Reflect the current ink onto the current-color swatch: the solid color, or
  // the kit's transparency checker while the clear ink is active.
  function syncPreview() {
    const clear = brush.erase && !brush.picking;
    if (clear || !brush.color) selectedSw.removeAttribute('color');
    else selectedSw.setAttribute('color', rgbHex(brush.color));
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
    syncPreview(); // keep the current-color swatch in step with the ink
  }

  // keyboard: B / R / G / I / E pick pencil / rect / fill / eyedropper /
  // transparent-ink; Esc aborts an in-flight rect drag (nothing committed). While
  // the picker dialog is open the native <dialog> owns the keys (Esc closes it),
  // so everything below is skipped. The rest are suppressed while a text/number
  // input is focused so typing there is never hijacked. Torn down in destroy().
  function onKeyDown(e) {
    if (pickerOpen) return;
    if (e.key === 'Escape' && rectDragging) {
      cancelRect(); // discard the box mid-drag — no pixels written
      e.preventDefault();
      return;
    }
    // Shift held mid-drag locks the box to a square, even with the pointer still —
    // re-derive the preview from the raw corner (keydown repeats, so guard churn).
    if (e.key === 'Shift' && rectDragging && !shiftLock) {
      shiftLock = true;
      drawRectPreview();
      return;
    }
    // The kit's fields host their <input> in shadow DOM, so check the composed
    // path's innermost target, not just the light-DOM tag.
    const target = e.composedPath ? e.composedPath()[0] : e.target;
    const tag = target && target.tagName;
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

  renderRecent();
  syncUI();
  // Dev hook (?pick=N): select palette256[N] as if picked from the dialog, so a
  // headless shot (which can't click a swatch) shows it landing as the current
  // ink. Runs before the ?palette=1 open so the dialog reflects it too.
  if (pickIndex != null && palette256[pickIndex]) {
    selectColor(palette256[pickIndex].rgb);
  }
  // Dev hook (?palette=1): open the picker right away so the capture tool — which
  // can't click the swatch — can screenshot it. Consumed once by the caller.
  if (openPaletteOnMount) openPicker();

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
      // ink (and joins the recency row) just like any pick.
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

  // Size everything now, and re-fit whenever the canvas container resizes — it fills
  // the flex draw box, so a window resize (or any change to the fixed regions above)
  // reflows its height and the centered canvas must re-scale. Observing `wrap`
  // directly is feedback-free: layout() never sets wrap's height (only the
  // stack/overlay/cursor INSIDE it), so resizing those never changes wrap's own box,
  // and a no-op re-run (same scale) early-returns.
  layout();
  let resizeObs = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObs = new ResizeObserver(() => layout());
    resizeObs.observe(wrap);
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
  // tile-size field the user was typing in. Restore it so Tab/Enter-driven sizing
  // keeps flowing (the field delegates focus to its inner input).
  if (focusSize) tileField.focus?.();

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
    // The picker dialog lives on <body>, outside `container`; removing an open
    // native dialog routes through the kit's close path.
    picker?.remove();
    container.innerHTML = ''; // removes the canvas + its pointer listeners with it
  }
  return { destroy };
}
