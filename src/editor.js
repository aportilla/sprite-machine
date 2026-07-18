// ---------------------------------------------------------------------------
// The tools panel (right half of the workspace): a pixel editor for one atlas
// face. Permanently docked — a face is always selected; the 3D view stays live +
// interactive on the left. Self-contained, pure DOM; no imports from the voxel
// pipeline.
//
// Top to bottom: the six face tabs capping the framed pixel canvas, then a TOOL
// STRIP of first-class tools (pencil; rect + fill are stubbed in but disabled)
// with the square tile-size stepper docked at its right, a per-tool OPTIONS row
// (the pencil's tip-SIZE stepper), and finally the PALETTE row — every color
// currently painted on ANY face, so you can match existing colors — led by a "+"
// that opens the full 256-color modal, then the eyedropper and the eraser. The
// eyedropper and eraser live with the colors, not the tools, because they choose
// the pencil's INK (a sampled color, or transparent "clear color") rather than a
// drawing tool. The brush selection is held in the caller-owned `brush` object so
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
//   - brush: shared { tool, color:{r,g,b}, swatchIndex, erase, picking, size } —
//     persisted by the caller across face swaps. `tool` is the drawing op
//     ('pencil'|'rect'|'fill'; only pencil is live). `erase` makes the pencil lay
//     transparent; `picking` arms the eyedropper for the next canvas click; `size`
//     is the pencil's N×N tip footprint (in texels).
//   - sizeMin/sizeMax: inclusive integer bounds for the TILE-size stepper.
//   - focusSize: the stepper's key ('Tile') to refocus after a resize re-mount (typed entry flow).
//   - openPaletteOnMount: dev hook (?palette=1) — open the "+" palette modal
//     immediately so headless screenshots (which can't click "+") can show it.
//   - previewCursor: dev hook (?cursor=N) — set the pencil size to N and draw its
//     footprint outline at the tile center on mount, so a headless shot (which has
//     no pointer to hover) can show the preview. Consumed once by the caller.
//   - onLive(workingTile, dirty): fired on each actual pixel change.
//   - onSelectFace(name): the user clicked another face tab.
//   - onResizeTile(size): the user changed the tile size. Tiles are locked SQUARE,
//     so the caller resizes the whole atlas to size×size and re-mounts — always the
//     alignment-preserving proportional case (see atlas.js resizeAtlas), so a voxel
//     keeps its lattice coords and nothing shears out of registration.
// ---------------------------------------------------------------------------

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

// Simple pipette glyph for the eyedropper button (strokes `currentColor`).
const EYEDROPPER_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M2 22l1.2-4L14 7.2l2.8 2.8L6 20.8 2 22z"/><path d="M14 7l3 3"/>' +
  '<path d="M17.5 3.5l3 3-2.3 2.3-3-3 2.3-2.3z"/></svg>';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function hexToRgb(css) {
  return {
    r: parseInt(css.slice(1, 3), 16),
    g: parseInt(css.slice(3, 5), 16),
    b: parseInt(css.slice(5, 7), 16),
  };
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
    sizeMax = 256,
    focusSize,
    openPaletteOnMount = false,
    previewCursor = null,
    onLive,
    onSelectFace,
    onResizeTile,
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
  if (!brush.color) brush.color = hexToRgb(palette[0].css);
  if (brush.tool == null) brush.tool = 'pencil';
  if (brush.erase == null) brush.erase = false;
  if (brush.picking == null) brush.picking = false;
  if (brush.swatchIndex == null) brush.swatchIndex = 0;
  if (brush.size == null) brush.size = 1;

  // The pencil tip is capped at the tile edge (a single stamp can't exceed the
  // canvas). `previewCursor` (?cursor=N) sets the size up front; either way we
  // clamp a persisted size down after a shrink to a smaller tile.
  const brushMax = Math.max(1, Math.min(tileW, tileH));
  const clampBrush = (n) => Math.max(1, Math.min(brushMax, Math.round(Number(n) || 1)));
  if (previewCursor) brush.size = clampBrush(previewCursor);
  brush.size = clampBrush(brush.size);

  container.innerHTML = '';
  const root = el('div', 'editor');
  container.appendChild(root);

  // --- canvas widget: tabs + framed canvas as one self-contained unit --------
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
  widget.appendChild(wrap);

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
  // `drawCursor`/`hoverTexel`, defined below, but is only CALLED after they exist.
  function layout() {
    const boxH = Math.max(0, Math.round((container.clientHeight || 0) * CANVAS_FRACTION));
    wrap.style.height = `${boxH}px`;
    // Measure BOTH axes from the post-reflow client box (border-excluded), so the
    // 1px border isn't double-counted on one axis: availH from the raw border-box
    // `boxH` would overstate the content height by the border and could round the
    // integer scale one step too big (the stack would then clip under overflow:hidden).
    const cs = getComputedStyle(wrap);
    const availW = Math.max(1, wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    const availH = Math.max(1, wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
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
    drawCursor(hoverTexel); // re-stroke the footprint at the new scale (or clear it)
  }

  const rgbEq = (a, b) => a.r === b.r && a.g === b.g && a.b === b.b;
  const matchPaletteIndex = (color) =>
    palette.findIndex((p) => rgbEq(hexToRgb(p.css), color));
  const rkey = (c) => (c.r << 16) | (c.g << 8) | c.b;

  // The single path every color pick funnels through (palette modal, in-sprite,
  // eyedrop): make `color` the pencil's ink and clear the erase/eyedropper flags.
  function selectColor(color, swatchIndex) {
    brush.color = { r: color.r, g: color.g, b: color.b };
    brush.swatchIndex = swatchIndex;
    brush.erase = false;
    brush.picking = false;
    syncUI();
  }

  // --- tool strip: first-class tools + docked tile-size stepper --------------
  // The pencil is the only live tool; rect + fill are stubbed in but disabled so
  // the strip already shows where they'll live. The square tile-size stepper docks
  // at the right (tiles are locked SQUARE, so a resize is always alignment-safe).
  const toolstrip = el('div', 'editor-toolstrip');
  const toolGroup = el('div', 'editor-toolgroup');
  const pencilBtn = el('button', 'editor-tool', 'pencil');
  pencilBtn.type = 'button';
  pencilBtn.title = 'pencil — draw (B)';
  const rectBtn = el('button', 'editor-tool', 'rect');
  rectBtn.type = 'button';
  rectBtn.disabled = true;
  rectBtn.title = 'rectangle — coming soon';
  const fillBtn = el('button', 'editor-tool', 'fill');
  fillBtn.type = 'button';
  fillBtn.disabled = true;
  fillBtn.title = 'fill — coming soon';
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
  root.appendChild(toolstrip);
  // Selecting the pencil returns you to drawing with the current color (out of the
  // eraser / eyedropper), matching the classic B behavior.
  pencilBtn.onclick = () => {
    brush.tool = 'pencil';
    brush.erase = false;
    brush.picking = false;
    if (!brush.color) brush.color = hexToRgb(palette[0].css);
    renderToolOptions();
    syncUI();
  };

  // --- per-tool options row (contextual) ------------------------------------
  // Different tools expose different settings here. The pencil gets a tip-SIZE
  // stepper: N means an N×N square footprint, stamped along the stroke and
  // previewed as a hairline outline under the cursor.
  const toolOpts = el('div', 'editor-tool-opts');
  root.appendChild(toolOpts);
  function setPencilSize(n) {
    brush.size = clampBrush(n);
    drawCursor(hoverTexel); // reflect the new footprint immediately if hovering
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
    }
  }
  renderToolOptions();

  // --- palette row: ink pickers ---------------------------------------------
  // Every color painted anywhere in the sprite, so you can match existing colors.
  // The eyedropper and eraser sit here (not in the tool strip) because they pick
  // the pencil's INK — a sampled color, or transparent ("clear color") — rather
  // than a drawing tool. A leading "+" opens the full 256-color palette modal.
  const usedRow = el('div', 'editor-used-row');
  const addBtn = el('button', 'editor-add', '+');
  addBtn.type = 'button';
  addBtn.title = 'add a color from the 256 palette';
  addBtn.onclick = () => openPalette();
  const eyeBtn = el('button', 'editor-pal-tool');
  eyeBtn.type = 'button';
  eyeBtn.innerHTML = EYEDROPPER_SVG;
  eyeBtn.title = 'eyedropper — click the sprite to sample (I, or hold Alt while drawing)';
  eyeBtn.onclick = () => {
    brush.picking = true;
    syncUI();
  };
  const eraserSw = el('button', 'editor-swatch editor-used-sw editor-erase-sw');
  eraserSw.type = 'button';
  eraserSw.title = 'eraser — clear color / erase to transparent (E, or right-click)';
  eraserSw.onclick = () => {
    brush.erase = true;
    brush.picking = false;
    brush.swatchIndex = -1;
    syncUI();
  };
  usedRow.append(addBtn, eyeBtn, eraserSw);
  const FIXED_LEAD = usedRow.children.length; // fixed controls kept ahead of the swatches
  root.appendChild(usedRow);

  let lastUsedSig = null;
  function distinctWorkColors() {
    const seen = new Set();
    const out = [];
    for (let i = 0; i < work.length; i += 4) {
      if (work[i + 3] === 0) continue;
      const c = { r: work[i], g: work[i + 1], b: work[i + 2] };
      const k = rkey(c);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
    return out;
  }
  let usedEls = []; // { el, rgb } for active-color highlighting
  function renderUsed() {
    const map = new Map();
    for (const c of usedColors) map.set(rkey(c), c);
    for (const c of distinctWorkColors()) map.set(rkey(c), c);
    const list = [...map.values()].sort((a, b) => rkey(a) - rkey(b));
    const sig = list.map(rkey).join(',');
    if (sig === lastUsedSig) return; // set unchanged → skip DOM churn mid-stroke
    lastUsedSig = sig;
    // Rebuild the swatches but keep the leading fixed controls (+ / eyedrop / erase).
    while (usedRow.children.length > FIXED_LEAD) usedRow.removeChild(usedRow.lastChild);
    usedEls = [];
    for (const c of list) {
      const s = el('button', 'editor-swatch editor-used-sw');
      s.type = 'button';
      s.style.background = rgbHex(c);
      s.title = rgbHex(c);
      s.onclick = () => selectColor(c, matchPaletteIndex(c));
      usedRow.appendChild(s);
      usedEls.push({ el: s, rgb: c });
    }
    syncActiveSwatch();
    markInSprite(new Set(list.map(rkey)));
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
  const closeX = el('button', 'palette-modal-close', '✕');
  closeX.type = 'button';
  closeX.title = 'close (Esc)';
  closeX.onclick = () => closePalette();
  head.appendChild(closeX);
  const cubeWrap = el('div', 'editor-cube');
  const cubeEls = [];
  for (const p of palette256) {
    const rgb = hexToRgb(p.css);
    const s = el('button', 'editor-swatch');
    s.type = 'button';
    s.style.background = p.css;
    s.title = p.css;
    s.onclick = () => {
      selectColor(rgb, matchPaletteIndex(rgb));
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
    eyeBtn.classList.toggle('active', brush.picking);
    eraserSw.classList.toggle('active', brush.erase && !brush.picking);
    syncActiveSwatch();
  }

  // keyboard: B / I / E pick pencil / eyedropper / eraser-ink; Esc closes the
  // palette modal. Suppressed while a text/number input (a stepper) is focused so
  // typing there is never hijacked; torn down in destroy().
  function onKeyDown(e) {
    if (e.key === 'Escape' && modalOpen) {
      closePalette();
      e.preventDefault();
      return;
    }
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'b') {
      brush.tool = 'pencil';
      brush.erase = false;
      brush.picking = false;
      if (!brush.color) brush.color = hexToRgb(palette[0].css);
    } else if (k === 'i') {
      brush.picking = true;
    } else if (k === 'e') {
      brush.erase = true;
      brush.picking = false;
      brush.swatchIndex = -1;
    } else {
      return;
    }
    syncUI();
    drawCursor(hoverTexel); // erasing recolors the footprint outline; eyedrop shrinks it
    e.preventDefault();
  }
  document.addEventListener('keydown', onKeyDown);

  renderUsed();
  syncUI();
  // Dev hook (?palette=1): open the picker right away so the capture tool — which
  // can't click the "+" — can screenshot it. Consumed once by the caller.
  if (openPaletteOnMount) openPalette();

  // --- drawing --------------------------------------------------------------
  let drawing = false;
  let prev = null; // last painted texel this stroke, for line interpolation
  let forceErase = false; // right-click erases regardless of the active ink
  let hoverTexel = null; // last hovered texel, for the footprint preview

  function toTexel(e) {
    const rect = canvas.getBoundingClientRect();
    const px = Math.floor(((e.clientX - rect.left) / rect.width) * tileW);
    const py = Math.floor(((e.clientY - rect.top) / rect.height) * tileH);
    if (px < 0 || py < 0 || px >= tileW || py >= tileH) return null;
    return { px, py };
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
  // when the pointer leaves the canvas.
  function drawCursor(t) {
    hoverTexel = t;
    cursorCtx.clearRect(0, 0, cssW, cssH);
    if (!t) return;
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

  function sampleAt(px, py) {
    const i = (py * tileW + px) * 4;
    if (work[i + 3] === 0) {
      // Sampling empty space picks the eraser ink (clear color).
      brush.erase = true;
      brush.picking = false;
      brush.swatchIndex = -1;
      syncUI();
    } else {
      // Route through selectColor so an off-palette (imported) sample becomes the
      // pencil color (and shows up in the palette row) just like any pick.
      const c = { r: work[i], g: work[i + 1], b: work[i + 2] };
      selectColor(c, matchPaletteIndex(c));
    }
    drawCursor(hoverTexel); // sampling ends eyedrop mode → footprint returns to size
  }

  function onPointerDown(e) {
    const t = toTexel(e);
    if (!t) return;
    e.preventDefault();
    drawCursor(t);
    // Alt-hold = momentary eyedropper (sample without switching ink first);
    // a right-click still erases even with Alt down.
    if (e.button !== 2 && (e.altKey || brush.picking)) {
      sampleAt(t.px, t.py);
      return;
    }
    forceErase = e.button === 2;
    drawing = true;
    prev = null;
    canvas.setPointerCapture?.(e.pointerId);
    stroke(t.px, t.py);
  }
  function onPointerMove(e) {
    const t = toTexel(e);
    drawCursor(t); // keep the footprint preview under the cursor (hover + drag)
    if (!drawing || !t) return;
    stroke(t.px, t.py);
  }
  function onPointerUp(e) {
    drawing = false;
    prev = null;
    forceErase = false;
    canvas.releasePointerCapture?.(e.pointerId);
  }
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', () => drawCursor(null)); // clear the preview
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
    resizeObs?.disconnect(); // stop observing the panel (we observe it, not a child)
    modal.remove(); // the modal lives on <body>, outside `container`
    container.innerHTML = ''; // removes the canvas + its pointer listeners with it
  }
  return { destroy };
}
