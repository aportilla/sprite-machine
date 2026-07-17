// ---------------------------------------------------------------------------
// Inline (docked) tile editor: a pixel canvas for one atlas face, rendered into
// a container in the sidebar — NOT a modal. The 3D view stays live + interactive
// beside it. Self-contained, pure DOM; no imports from the voxel pipeline.
//
// Tools live in a single 6x3 grid: 16 DB16 colors + an eyedropper + a transparent
// (eraser) tile — no separate pencil/eraser toggle. The brush selection is held
// in the caller-owned `brush` object so it survives a mirror-partner face swap.
// Every stroke is HARD-pixel (alpha 0 or 255) so downstream ingest (alpha>=128)
// and atlas.isBlank (alpha!==0) can never diverge.
//
// createTileEditor(container, { name, tile, tileW, tileH, palette,
//   mirrorBehind, guides, faces, brush, onLive, onSelectFace, onClose })
//   -> { destroy }
//   - mirrorBehind: {width,height,data} onion-skin of the opposite face drawn
//     faded UNDER the pixel canvas (display only — never written to `work`). null
//     when the opposite face has no art of its own. A mirror-derived face opens
//     with an EMPTY canvas and this faded mirror as its only reference.
//   - guides: from faceGuides() — extent of the orthogonal faces' pixels, drawn
//     as hairline rules over the canvas so you can align to the stricter carve.
//   - faces: the ordered list of all six atlas faces, shown as tabs across the
//     top; the edited `name` is the active tab and clicking another switches.
//   - brush: shared { mode, color:{r,g,b}, swatchIndex } — persisted by the caller
//     across face swaps.
//   - onLive(workingTile, dirty): fired on each actual pixel change.
//   - onSelectFace(name): the user clicked the other face tab.
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

export function createTileEditor(
  container,
  {
    name,
    tile,
    tileW,
    tileH,
    palette,
    mirrorBehind,
    guides,
    faces,
    brush,
    onLive,
    onSelectFace,
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

  // --- header: done (left, primary exit) + a muted size readout (right) -----
  const header = el('div', 'editor-header');
  const doneBtn = el('button', 'editor-btn-done');
  doneBtn.append(el('span', 'editor-done-mark', '✓'), el('span', null, 'Done Editing'));
  doneBtn.onclick = () => onClose?.();
  header.append(doneBtn, el('div', 'editor-title', `${tileW} × ${tileH}`));
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

  // --- tool grid: 16 colors + eyedropper + transparent (6x3) ----------------
  const grid = el('div', 'editor-swatches');
  const swatchEls = palette.map((p, i) => {
    const s = el('button', 'editor-swatch');
    s.style.background = p.css;
    s.title = p.css;
    s.onclick = () => {
      brush.mode = 'pencil';
      brush.color = hexToRgb(p.css);
      brush.swatchIndex = i;
      syncTiles();
    };
    grid.appendChild(s);
    return s;
  });
  const eyeTile = el('button', 'editor-swatch editor-tile-icon');
  eyeTile.innerHTML = EYEDROPPER_SVG;
  eyeTile.title = 'eyedropper — click the sprite to sample a color';
  eyeTile.onclick = () => {
    brush.mode = 'eyedropper';
    syncTiles();
  };
  const transTile = el('button', 'editor-swatch editor-tile-transparent');
  transTile.title = 'transparent — erase';
  transTile.onclick = () => {
    brush.mode = 'eraser';
    brush.swatchIndex = -1;
    syncTiles();
  };
  grid.append(eyeTile, transTile);
  root.appendChild(grid);

  // Active-brush indicator (also surfaces a custom eyedropped color).
  const brushChip = el('div', 'editor-brush');
  root.appendChild(brushChip);

  function syncTiles() {
    swatchEls.forEach((e, i) =>
      e.classList.toggle('active', brush.mode === 'pencil' && brush.swatchIndex === i)
    );
    eyeTile.classList.toggle('active', brush.mode === 'eyedropper');
    transTile.classList.toggle('active', brush.mode === 'eraser');
    brushChip.innerHTML = '';
    const sw = el('span', 'editor-brush-sw');
    if (brush.mode === 'eraser') {
      sw.classList.add('is-transparent');
      brushChip.append(sw, el('span', 'tiny', 'erase'));
    } else if (brush.mode === 'eyedropper') {
      brushChip.append(el('span', 'tiny', 'click the sprite to sample a color'));
    } else {
      sw.style.background = `rgb(${brush.color.r},${brush.color.g},${brush.color.b})`;
      brushChip.append(sw, el('span', 'tiny', rgbHex(brush.color)));
    }
  }
  syncTiles();

  // --- drawing --------------------------------------------------------------
  let drawing = false;
  let prev = null; // last painted texel this stroke, for line interpolation

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
    const paint = brush.mode !== 'eraser';
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
      onLive?.(workingTile, dirty);
    }
  }

  function sampleAt(px, py) {
    const i = (py * tileW + px) * 4;
    if (work[i + 3] === 0) {
      brush.mode = 'eraser';
      brush.swatchIndex = -1;
    } else {
      const c = { r: work[i], g: work[i + 1], b: work[i + 2] };
      brush.mode = 'pencil';
      brush.color = c;
      brush.swatchIndex = palette.findIndex((p) => {
        const pc = hexToRgb(p.css);
        return pc.r === c.r && pc.g === c.g && pc.b === c.b;
      });
    }
    syncTiles();
  }

  function onPointerDown(e) {
    const t = toTexel(e);
    if (!t) return;
    e.preventDefault();
    if (brush.mode === 'eyedropper') {
      sampleAt(t.px, t.py);
      return;
    }
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
    canvas.releasePointerCapture?.(e.pointerId);
  }
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  // --- teardown -------------------------------------------------------------
  let destroyed = false;
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    container.innerHTML = ''; // removes the canvas + its pointer listeners with it
  }
  return { destroy };
}
