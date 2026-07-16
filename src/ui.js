// ---------------------------------------------------------------------------
// UI panel: sample picker, a single atlas dropzone, a read-only preview of the
// faces we actually render (laid out like the sheet — provided tiles plus the
// mirror-derived ones, with the object's front edge marked beside each), and
// low-poly / auto-rotate toggles plus a live stats readout. Pure DOM; talks to
// main.js via callbacks.
// ---------------------------------------------------------------------------

import { fileToImageData } from './image-io.js';
import {
  VIEW_DISPLAY_ORDER as SLOT_ORDER,
  VIEW_FRONT_EDGE,
  VIEW_OPPOSITE,
  VIEW_MIRROR_AXIS,
} from './lib/views.js';

// Accent for the front-edge orientation marker on face thumbnails.
const FRONT_EDGE_COLOR = '#7ee787';
// Thumbnail canvas size and the box the sprite is fit into — the gap between
// them guarantees margin for the front-edge line to sit beside (not over) art.
const THUMB = 48;
const THUMB_FIT = 40;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// Draw a pixel-art tile centered in the canvas, fit within a boxW×boxH area.
// Returns the drawn rectangle {ox, oy, w, h} so callers can place a marker
// beside the sprite (or null when there's nothing to draw).
function drawPixels(canvas, img, boxW, boxH) {
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (!img) return null;
  const id =
    img instanceof ImageData
      ? img
      : new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  const tmp = document.createElement('canvas');
  tmp.width = img.width;
  tmp.height = img.height;
  tmp.getContext('2d').putImageData(id, 0, 0);
  const scale = Math.max(1, Math.floor(Math.min(boxW / img.width, boxH / img.height)));
  const w = img.width * scale;
  const h = img.height * scale;
  const ox = Math.floor((canvas.width - w) / 2);
  const oy = Math.floor((canvas.height - h) / 2);
  g.imageSmoothingEnabled = false;
  g.drawImage(tmp, ox, oy, w, h);
  return { ox, oy, w, h };
}

// Mirror a tile for display (an axis-flip in image space), so a mirror-derived
// face shows the way we actually render it. `axis` is 'x' (horizontal) or 'y'.
function mirrorImage(img, axis) {
  const { width: W, height: H, data } = img;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = axis === 'x' ? W - 1 - x : x;
      const sy = axis === 'y' ? H - 1 - y : y;
      const s = (sy * W + sx) * 4;
      const d = (y * W + x) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
      out[d + 3] = data[s + 3];
    }
  }
  return { width: W, height: H, data: out };
}

// Draw a thin line just OUTSIDE the sprite's drawn rect, on the edge the
// object's front (+z) points toward — so the tile orientation is unambiguous
// without painting over the art. `edge` is left/right/top/bottom (null =
// front/back, which face the camera and have no in-plane front edge).
function drawFrontEdge(canvas, edge, rect) {
  if (!edge || !rect) return;
  const g = canvas.getContext('2d');
  const { ox, oy, w, h } = rect;
  const W = canvas.width;
  const H = canvas.height;
  const T = 2; // line thickness (px)
  const GAP = 1; // clearance between line and sprite
  g.fillStyle = FRONT_EDGE_COLOR;
  if (edge === 'left') g.fillRect(Math.max(0, ox - GAP - T), oy, T, h);
  else if (edge === 'right') g.fillRect(Math.min(W - T, ox + w + GAP), oy, T, h);
  else if (edge === 'top') g.fillRect(ox, Math.max(0, oy - GAP - T), w, T);
  else if (edge === 'bottom') g.fillRect(ox, Math.min(H - T, oy + h + GAP), w, T);
}

export function createUI({ samples, state, onSample, onAtlas, onOptionChange }) {
  const app = document.getElementById('app');
  const panel = el('div', 'panel');
  app.appendChild(panel);

  panel.appendChild(el('div', 'panel-title', 'sprite machine'));
  panel.appendChild(el('div', 'panel-sub', 'pixel atlas → 3D voxel object'));

  // --- samples --------------------------------------------------------------
  panel.appendChild(el('div', 'label', 'sample'));
  const sampleRow = el('div', 'row samples');
  const sampleBtns = [];
  samples.forEach((s, i) => {
    const b = el('button', 'chip', s.name);
    b.onclick = () => selectSample(i);
    sampleRow.appendChild(b);
    sampleBtns.push(b);
  });
  panel.appendChild(sampleRow);

  // --- atlas dropzone (section label carries the derived tile size) ---------
  const atlasLabel = el('div', 'label label-row');
  atlasLabel.appendChild(el('span', null, 'atlas dropzone'));
  const tileText = el('span', 'tile-val', '—');
  atlasLabel.appendChild(tileText);
  panel.appendChild(atlasLabel);

  const drop = el('div', 'dropzone');
  const dropCanvas = el('canvas', 'atlas-preview');
  dropCanvas.width = 204;
  dropCanvas.height = 96;
  const dropHint = el('div', 'drop-hint', 'drag a sprite sheet here, or click');
  drop.append(dropCanvas, dropHint);

  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (f) await loadFile(f);
  };
  drop.appendChild(fileInput);
  drop.onclick = () => fileInput.click();
  drop.ondragover = (e) => {
    e.preventDefault();
    drop.classList.add('drag');
  };
  drop.ondragleave = () => drop.classList.remove('drag');
  drop.ondrop = async (e) => {
    e.preventDefault();
    drop.classList.remove('drag');
    const f = e.dataTransfer.files[0];
    if (f) await loadFile(f);
  };

  // Decode a dropped/picked file, surfacing failures instead of swallowing them
  // as an unhandled promise rejection (bad/corrupt images just no-op otherwise).
  async function loadFile(f) {
    try {
      onAtlas(await fileToImageData(f));
    } catch (err) {
      setError(`Couldn't read "${f.name}" as an image: ${err.message}`);
    }
  }
  panel.appendChild(drop);

  // --- read-only face preview (laid out like the sheet) --------------------
  panel.appendChild(el('div', 'label', 'faces'));
  const slotGrid = el('div', 'slots');
  const slotEls = {};
  for (const name of SLOT_ORDER) {
    const slot = el('div', 'slot ro');
    const cv = el('canvas', 'thumb');
    cv.width = cv.height = THUMB;
    slot.append(cv, el('div', 'slot-cap', name));
    slotGrid.appendChild(slot);
    slotEls[name] = { slot, cv };
  }
  panel.appendChild(slotGrid);
  const legendRow = (swatchCls, text) => {
    const l = el('div', 'legend');
    l.append(el('span', swatchCls), el('span', 'tiny', text));
    return l;
  };
  panel.appendChild(legendRow('legend-swatch', 'front-facing edge'));
  panel.appendChild(legendRow('legend-derived', 'mirror-derived face'));

  // --- options --------------------------------------------------------------
  panel.appendChild(el('div', 'label', 'options'));
  const toggleRow = el('div', 'row');
  const lowpolyLab = el('label', 'check');
  const lowpoly = el('input');
  lowpoly.type = 'checkbox';
  lowpoly.onchange = () => {
    state.lowpoly = lowpoly.checked;
    onOptionChange();
  };
  lowpolyLab.append(lowpoly, document.createTextNode(' low-poly'));
  const rotLab = el('label', 'check');
  const rot = el('input');
  rot.type = 'checkbox';
  rot.onchange = () => (state.autoRotate = rot.checked);
  rotLab.append(rot, document.createTextNode(' auto-rotate'));
  toggleRow.append(lowpolyLab, rotLab);
  panel.appendChild(toggleRow);

  // --- stats ----------------------------------------------------------------
  const stats = el('div', 'stats');
  panel.appendChild(stats);

  // --- methods --------------------------------------------------------------
  function selectSample(i) {
    sampleBtns.forEach((b, j) => b.classList.toggle('active', j === i));
    onSample(samples[i]);
  }

  function syncControls() {
    lowpoly.checked = state.lowpoly;
    rot.checked = state.autoRotate;
  }

  function setAtlasPreview(img) {
    drawPixels(dropCanvas, img, dropCanvas.width - 8, dropCanvas.height - 8);
    dropHint.style.display = img ? 'none' : 'block';
  }

  function setAtlasInfo({ tileW: tw, tileH: th }) {
    tileText.textContent = `${tw} × ${th} px`;
  }

  function setThumbnails(views) {
    for (const name of SLOT_ORDER) {
      const { slot, cv } = slotEls[name];
      let img = views && views[name];
      let derived = false;
      // No art of its own? Show the mirror-derived face we actually render, so
      // the preview matches the rendered object rather than leaving a gap.
      if (!img) {
        const opp = views && views[VIEW_OPPOSITE[name]];
        if (opp) {
          img = mirrorImage(opp, VIEW_MIRROR_AXIS[name]);
          derived = true;
        }
      }
      slot.classList.toggle('filled', !!img && !derived);
      slot.classList.toggle('derived', derived);
      const rect = drawPixels(cv, img, THUMB_FIT, THUMB_FIT);
      drawFrontEdge(cv, VIEW_FRONT_EDGE[name], rect);
    }
  }

  function setStats({ dims, voxels, triangles, warnings }) {
    stats.innerHTML = '';
    const line = (k, v) => {
      const r = el('div', 'stat');
      r.append(el('span', 'k', k), el('span', 'v', String(v)));
      stats.appendChild(r);
    };
    if (dims) line('grid', `${dims.nx}×${dims.ny}×${dims.nz}`);
    if (voxels) line('voxels', voxels);
    if (triangles) line('tris', triangles);
    for (const w of warnings || []) stats.appendChild(el('div', 'warn', '⚠ ' + w));
  }

  // Show a one-off error (e.g. a failed image decode) in the stats panel; it
  // persists until the next successful build overwrites the panel.
  function setError(msg) {
    stats.innerHTML = '';
    stats.appendChild(el('div', 'warn', '⚠ ' + msg));
  }

  return {
    selectSample,
    syncControls,
    setThumbnails,
    setStats,
    setError,
    setAtlasPreview,
    setAtlasInfo,
  };
}
