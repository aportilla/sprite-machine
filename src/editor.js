// ---------------------------------------------------------------------------
// Inline (docked) tile editor: a pixel canvas for one atlas face, rendered into
// a container in the sidebar — NOT a modal. The 3D view stays live + interactive
// beside it. Self-contained, pure DOM; no imports from the voxel pipeline.
//
// Tools (pencil / eyedropper / eraser) live in a persistent strip so they are
// first-class, distinct from the colors; the pencil button's icon is a live
// swatch of the color it would paint. Below them, in-flow (no overlay): a dynamic
// "in sprite" row (every color currently painted on ANY face) and then the full
// 256-color wedge-safe palette as a 16x16 grid. The brush selection is held in the
// caller-owned `brush` object so it survives a mirror-partner face swap (which
// destroys + re-mounts this editor). Every stroke is HARD-pixel (alpha 0 or 255)
// so downstream ingest (alpha>=128) and atlas.isBlank (alpha!==0) can never
// diverge.
//
// createTileEditor(container, { name, tile, tileW, tileH, palette, palette256,
//   mirrorBehind, guides, faces, brush, sizeMin, sizeMax,
//   onLive, onSelectFace, onResizeTile, onClose })
//   -> { destroy }
//   - mirrorBehind: {width,height,data} onion-skin of the opposite face drawn
//     faded UNDER the pixel canvas (display only — never written to `work`). null
//     when the opposite face has no art of its own. A mirror-derived face opens
//     with an EMPTY canvas and this faded mirror as its only reference.
//   - guides: from faceGuides() — extent of the orthogonal faces' pixels, drawn
//     as hairline rules over the canvas so you can align to the stricter carve.
//   - faces: the ordered list of all six atlas faces, shown as tabs across the
//     top; the edited `name` is the active tab and clicking another switches.
//   - palette256: the full 256-color wedge-safe palette ({ css }[]) shown
//     persistently as a 16x16 grid. `palette` (DB16) is no longer displayed; it
//     still seeds the default brush color and the `B` shortcut.
//   - usedColors: [{r,g,b}] colors already painted on the OTHER faces; the editor
//     unions the current tile's live pixels on top for the dynamic "in sprite" row.
//   - brush: shared { mode, color:{r,g,b}, swatchIndex } — persisted by the
//     caller across face swaps.
//   - sizeMin/sizeMax: inclusive integer bounds for the W/H steppers.
//   - onLive(workingTile, dirty): fired on each actual pixel change.
//   - onSelectFace(name): the user clicked the other face tab.
//   - onResizeTile(newW, newH, axis): the user changed a tile dimension ('W' or
//     'H'). The caller resizes the whole atlas and re-mounts. A PROPORTIONAL
//     (square) change is alignment-preserving; an asymmetric W≠H change is allowed
//     but falls out of registration and warns (see atlas.js resizeAtlas).
//   - onClose(): the user clicked "done".
// ---------------------------------------------------------------------------

const EDIT_MAX = 384; // max on-screen size of the drawing canvas, px

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

// Simple pipette glyph for the eyedropper tile (strokes `currentColor`).
const EYEDROPPER_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M2 22l1.2-4L14 7.2l2.8 2.8L6 20.8 2 22z"/><path d="M14 7l3 3"/>' +
  '<path d="M17.5 3.5l3 3-2.3 2.3-3-3 2.3-2.3z"/></svg>';

// Eraser glyph for the persistent tool strip (strokes `currentColor`). The
// pencil button uses a live color swatch as its icon instead of a glyph.
const ERASER_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M20 20H8.5L3 14.5a2 2 0 0 1 0-3L12 3l9 9-8 8"/><path d="M7 12l5 5"/></svg>';

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

// A compact [cap] [−] [value] [+] integer stepper for a tile dimension. Commits
// on the buttons and on the field's `change` (blur/Enter) — never per keystroke,
// so the caller's re-mount can't fight the user mid-type. The value is clamped
// and the field normalized on every commit, and a commit that resolves to the
// current value is a no-op (so tapping + at the max, or retyping the same number,
// doesn't churn a rebuild). `value` is the dimension at mount time.
function sizeStepper(cap, value, min, max, onCommit) {
  const clamp = (n) => Math.max(min, Math.min(max, Math.round(Number(n) || 0)));
  const wrap = el('div', 'editor-stepper');
  const dec = el('button', 'editor-step', '−');
  const inc = el('button', 'editor-step', '+');
  const input = el('input', 'editor-step-val');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.value = String(value);
  input.dataset.axis = cap; // so the caller can restore focus here after a re-mount
  input.setAttribute('aria-label', `tile ${cap} (${min}–${max})`);
  dec.type = inc.type = 'button';
  dec.disabled = value <= min;
  inc.disabled = value >= max;
  const commit = (n) => {
    const v = clamp(n);
    input.value = String(v); // normalize even when the caller no-ops the resize
    if (v !== value) onCommit(v);
  };
  dec.onclick = () => commit(value - 1);
  inc.onclick = () => commit(value + 1);
  input.onchange = () => commit(input.value);
  wrap.append(el('span', 'editor-step-cap', cap), dec, input, inc);
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
    sizeMax = 256,
    focusSize,
    onLive,
    onSelectFace,
    onResizeTile,
    onClose,
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

  // Brush defaults (first mount of a session).
  if (!brush.color) brush.color = hexToRgb(palette[0].css);
  if (brush.mode == null) brush.mode = 'pencil';
  if (brush.swatchIndex == null) brush.swatchIndex = 0;

  container.innerHTML = '';
  const root = el('div', 'editor');
  container.appendChild(root);

  // --- header: done (left) + editable W/H tile size (right) ------------------
  // Each stepper resizes the WHOLE atlas (all six tiles); the caller re-mounts
  // this editor at the new size. A PROPORTIONAL (square) change stays
  // alignment-preserving; an asymmetric W≠H change is allowed but falls out of
  // registration and warns — a 3×2 atlas can't hold three independent lattice axes
  // in two tile dimensions (its depth is the side width AND the top height).
  const header = el('div', 'editor-header');
  const doneBtn = el('button', 'editor-btn-done');
  doneBtn.append(el('span', 'editor-done-mark', '✓'), el('span', null, 'Done Editing'));
  doneBtn.onclick = () => onClose?.();
  const sizeCtl = el('div', 'editor-size');
  sizeCtl.append(
    sizeStepper('W', tileW, sizeMin, sizeMax, (w) => onResizeTile?.(w, tileH, 'W')),
    sizeStepper('H', tileH, sizeMin, sizeMax, (h) => onResizeTile?.(tileW, h, 'H'))
  );
  header.append(doneBtn, sizeCtl);
  root.appendChild(header);

  // --- canvas widget: tabs + framed canvas as one self-contained unit --------
  // A bordered card that groups the face tabs on top of the canvas box. The tabs
  // scope ONLY the canvas — the header above and the palette below are separate.
  // The active tab merges into the box below it.
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

  // --- canvas (backing store at native tile resolution, CSS-upscaled crisp) --
  // Three stacked layers in the wrap: a background (checkerboard via CSS + faded
  // opposite-face onion-skin), the transparent pixel canvas, and a hairline
  // overlay. Only the pixel canvas takes pointer events.
  const scale = Math.max(1, Math.floor(Math.min(EDIT_MAX / tileW, EDIT_MAX / tileH)));
  const cssW = tileW * scale;
  const cssH = tileH * scale;
  const wrap = el('div', 'editor-canvas-wrap');

  const bg = el('canvas', 'editor-canvas-bg');
  bg.width = tileW;
  bg.height = tileH;
  bg.style.width = `${cssW}px`;
  bg.style.height = `${cssH}px`;
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
  wrap.appendChild(bg);

  const canvas = el('canvas', 'editor-canvas');
  canvas.width = tileW;
  canvas.height = tileH;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  wrap.appendChild(canvas);

  const overlay = el('canvas', 'editor-canvas-overlay');
  overlay.width = cssW; // screen-res so hairlines stay 1px crisp
  overlay.height = cssH;
  overlay.style.width = `${cssW}px`;
  overlay.style.height = `${cssH}px`;
  wrap.appendChild(overlay);
  drawGuides(overlay.getContext('2d'), guides, scale, cssW, cssH);

  widget.appendChild(wrap);

  const ctx = canvas.getContext('2d');
  const imgData = new ImageData(work, tileW, tileH); // shares `work` by reference
  const repaint = () => ctx.putImageData(imgData, 0, 0);
  repaint();

  // --- color + tool bar (below the canvas) ----------------------------------
  // Everything under the canvas: the tool strip, the dynamic "in sprite" row, and
  // the full palette — all in-flow (the #editor-panel scrolls if it overflows).
  const colorbar = el('div', 'editor-colorbar');
  root.appendChild(colorbar);

  const rgbEq = (a, b) => a.r === b.r && a.g === b.g && a.b === b.b;
  const matchPaletteIndex = (color) =>
    palette.findIndex((p) => rgbEq(hexToRgb(p.css), color));
  const rkey = (c) => (c.r << 16) | (c.g << 8) | c.b;

  // The single path every color pick funnels through (palette, in-sprite,
  // eyedrop): become a pencil of `color` and refresh the UI.
  function selectColor(color, swatchIndex) {
    brush.mode = 'pencil';
    brush.color = { r: color.r, g: color.g, b: color.b };
    brush.swatchIndex = swatchIndex;
    syncUI();
  }

  // tool strip: pencil / eyedropper / eraser — persistent, first-class ---------
  const tools = el('div', 'editor-tools');
  const pencilBtn = el('button', 'editor-tool');
  pencilBtn.type = 'button';
  const pencilSw = el('span', 'editor-tool-sw'); // tiny live current-color preview
  pencilBtn.append(pencilSw, el('span', null, 'Pencil'));
  pencilBtn.title = 'pencil — draw (B)';
  const eyeBtn = el('button', 'editor-tool');
  eyeBtn.type = 'button';
  eyeBtn.innerHTML = EYEDROPPER_SVG + '<span>Eyedrop</span>';
  eyeBtn.title = 'eyedropper — click the sprite to sample (I, or hold Alt while drawing)';
  const eraseBtn = el('button', 'editor-tool');
  eraseBtn.type = 'button';
  eraseBtn.innerHTML = ERASER_SVG + '<span>Eraser</span>';
  eraseBtn.title = 'eraser — erase to transparent (E, or right-click)';
  tools.append(pencilBtn, eyeBtn, eraseBtn);
  colorbar.appendChild(tools);
  pencilBtn.onclick = () => {
    brush.mode = 'pencil';
    if (!brush.color) brush.color = hexToRgb(palette[0].css);
    syncUI();
  };
  eyeBtn.onclick = () => {
    brush.mode = 'eyedropper';
    syncUI();
  };
  eraseBtn.onclick = () => {
    brush.mode = 'eraser';
    brush.swatchIndex = -1;
    syncUI();
  };

  // "In sprite" — a DYNAMIC palette of every color currently painted anywhere in
  // the sprite (all faces). `usedColors` carries the OTHER faces' colors (passed
  // at mount); this editor unions the CURRENT tile's live pixels on top, so the
  // row reflects the whole sprite and updates as you draw or erase.
  colorbar.appendChild(el('div', 'editor-pal-label', 'In sprite'));
  const usedRow = el('div', 'editor-used-row');
  colorbar.appendChild(usedRow);
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
  function renderUsed() {
    const map = new Map();
    for (const c of usedColors) map.set(rkey(c), c);
    for (const c of distinctWorkColors()) map.set(rkey(c), c);
    const list = [...map.values()].sort((a, b) => rkey(a) - rkey(b));
    const sig = list.map(rkey).join(',');
    if (sig === lastUsedSig) return; // set unchanged → skip DOM churn mid-stroke
    lastUsedSig = sig;
    usedRow.innerHTML = '';
    if (!list.length) {
      usedRow.appendChild(el('span', 'tiny', 'nothing drawn yet'));
      return;
    }
    for (const c of list) {
      const s = el('button', 'editor-swatch editor-used-sw');
      s.type = 'button';
      s.style.background = rgbHex(c);
      s.title = rgbHex(c);
      s.onclick = () => selectColor(c, matchPaletteIndex(c));
      usedRow.appendChild(s);
    }
  }

  // --- palette (persistent, in-flow below the tools) ------------------------
  // The full 256-color wedge-safe palette lives right here in the sidebar — no
  // overlay — as a 16x16 grid. The panel scrolls if the viewport is short.
  const pal = el('div', 'editor-palette');
  pal.appendChild(el('div', 'editor-pal-label', `Palette (${palette256.length})`));
  const cubeWrap = el('div', 'editor-cube');
  const cubeEls = [];
  for (const p of palette256) {
    const rgb = hexToRgb(p.css);
    const s = el('button', 'editor-swatch');
    s.type = 'button';
    s.style.background = p.css;
    s.title = p.css;
    s.onclick = () => selectColor(rgb, matchPaletteIndex(rgb));
    cubeWrap.appendChild(s);
    cubeEls.push({ el: s, rgb });
  }
  pal.appendChild(cubeWrap);

  colorbar.appendChild(pal);

  // active-brush + tool state --------------------------------------------------
  function syncUI() {
    pencilBtn.classList.toggle('active', brush.mode === 'pencil');
    eyeBtn.classList.toggle('active', brush.mode === 'eyedropper');
    eraseBtn.classList.toggle('active', brush.mode === 'eraser');
    // the pencil button's swatch always shows the color it would paint
    const c = brush.color || { r: 0, g: 0, b: 0 };
    pencilSw.style.background = rgbHex(c);
    pencilSw.title = rgbHex(c);
    const pencilColor = brush.mode === 'pencil' ? brush.color : null;
    cubeEls.forEach(({ el: e, rgb }) =>
      e.classList.toggle('active', !!pencilColor && rgbEq(rgb, pencilColor))
    );
  }

  // keyboard: B / I / E select pencil / eyedropper / eraser. Suppressed while a
  // text/number input (the W/H steppers) is focused so typing there is never
  // hijacked; torn down in destroy().
  function onKeyDown(e) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'b') {
      brush.mode = 'pencil';
      if (!brush.color) brush.color = hexToRgb(palette[0].css);
      syncUI();
    } else if (k === 'i') {
      brush.mode = 'eyedropper';
      syncUI();
    } else if (k === 'e') {
      brush.mode = 'eraser';
      brush.swatchIndex = -1;
      syncUI();
    } else {
      return;
    }
    e.preventDefault();
  }
  document.addEventListener('keydown', onKeyDown);

  renderUsed();
  syncUI();

  // --- drawing --------------------------------------------------------------
  let drawing = false;
  let prev = null; // last painted texel this stroke, for line interpolation
  let forceErase = false; // right-click erases regardless of the active tool

  function toTexel(e) {
    const rect = canvas.getBoundingClientRect();
    const px = Math.floor(((e.clientX - rect.left) / rect.width) * tileW);
    const py = Math.floor(((e.clientY - rect.top) / rect.height) * tileH);
    if (px < 0 || py < 0 || px >= tileW || py >= tileH) return null;
    return { px, py };
  }

  // Write one texel; returns true only if the bytes actually changed. Any two
  // fully-transparent texels are treated as equal regardless of stray RGB left
  // under alpha 0, so erasing an already-invisible texel is a true no-op and
  // never dirties a mirror-derived face into real art.
  function writeTexel(px, py) {
    const i = (py * tileW + px) * 4;
    const paint = !forceErase && brush.mode !== 'eraser';
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

  // Bresenham so a fast drag lays down a continuous stroke, not dotted samples.
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
        if (writeTexel(x0, y0)) changed = true;
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
    } else if (writeTexel(px, py)) {
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

  function sampleAt(px, py) {
    const i = (py * tileW + px) * 4;
    if (work[i + 3] === 0) {
      brush.mode = 'eraser';
      brush.swatchIndex = -1;
      syncUI();
    } else {
      // Route through selectColor so an off-palette (imported) sample becomes the
      // pencil color (and shows up in the "in sprite" row) just like any pick.
      const c = { r: work[i], g: work[i + 1], b: work[i + 2] };
      selectColor(c, matchPaletteIndex(c));
    }
  }

  function onPointerDown(e) {
    const t = toTexel(e);
    if (!t) return;
    e.preventDefault();
    // Alt-hold = momentary eyedropper (sample without switching to the tool);
    // a right-click still erases even with Alt down.
    if (e.button !== 2 && (e.altKey || brush.mode === 'eyedropper')) {
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
    if (!drawing) return;
    const t = toTexel(e);
    if (!t) return;
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
  canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // right-click = erase

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
    container.innerHTML = ''; // removes the canvas + its pointer listeners with it
  }
  return { destroy };
}
