// ---------------------------------------------------------------------------
// UI: the left sidebar panel (sample picker, atlas pick button, an editable face
// preview laid out like the sheet, low-poly / auto-rotate toggles, live stats)
// plus a docked slot below it for the inline tile editor. The whole app window is
// a drop target for sprite sheets. Pure DOM; talks to main.js via callbacks.
// ---------------------------------------------------------------------------

import { fileToImageData } from './image-io.js';
import { VIEW_DISPLAY_ORDER as SLOT_ORDER } from './lib/views.js';

// Thumbnail canvas size and the box the sprite is fit into — the gap leaves a
// little breathing room so the art doesn't sit flush against the tile border.
const THUMB = 48;
const THUMB_FIT = 40;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// Reflect an on/off state onto a pill toggle button (class + a11y state).
function setToggle(btn, on) {
  btn.classList.toggle('on', !!on);
  btn.setAttribute('aria-pressed', String(!!on));
}

// A pill toggle button: clicking flips it and reports the new state. Nicer than
// a bare checkbox and matches the sample/atlas chips.
function toggleBtn(label, initial, onToggle) {
  const b = el('button', 'toggle', label);
  b.type = 'button';
  setToggle(b, initial);
  b.onclick = () => {
    const on = !b.classList.contains('on');
    setToggle(b, on);
    onToggle(on);
  };
  return b;
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
// Exported so main.js can seed the tile editor's canvas with the same mirrored
// image the thumbnail shows.
export function mirrorImage(img, axis) {
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

const dragHasFiles = (e) =>
  !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

export function createUI({
  samples,
  state,
  onSample,
  onAtlas,
  onOptionChange,
  onTileEdit,
  onDownload,
}) {
  const app = document.getElementById('app');
  const sidebar = document.getElementById('sidebar');
  const panel = el('div', 'panel');
  sidebar.appendChild(panel);

  // Whole-app drop overlay (shown while a file is dragged anywhere over the app).
  const dropOverlay = el('div', 'drop-overlay');
  dropOverlay.appendChild(el('div', 'drop-overlay-msg', 'drop a sprite sheet to load'));
  app.appendChild(dropOverlay);

  panel.appendChild(el('div', 'panel-title', 'sprite machine'));
  panel.appendChild(el('div', 'panel-sub', 'pixel atlas → 3D voxel object'));

  // --- atlas: an action menu (samples / blank / from disk) + download --------
  // The "pick atlas…" trigger opens a menu of actions; its label never changes.
  // The whole app is also a drop target.
  const atlasLabel = el('div', 'label label-row');
  atlasLabel.appendChild(el('span', null, 'atlas'));
  const tileText = el('span', 'tile-val', '—');
  atlasLabel.appendChild(tileText);
  panel.appendChild(atlasLabel);

  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (f) await loadFile(f);
  };

  // A fresh 3x2 sheet of empty (transparent) square 40×40 tiles to draw from
  // scratch — every face reads empty until you paint it.
  const loadBlank = () => onAtlas(new ImageData(120, 80));

  const picker = el('div', 'picker');
  const pickBtn = el('button', 'chip picker-trigger', 'pick atlas…');
  const menu = el('div', 'picker-menu');
  picker.append(pickBtn, menu);

  let menuOpen = false;
  const closeMenu = () => {
    menuOpen = false;
    picker.classList.remove('open');
  };
  const menuItem = (label, action) => {
    const it = el('button', 'picker-item', label);
    it.onclick = () => {
      closeMenu();
      action();
    };
    menu.appendChild(it);
  };
  samples.forEach((s, i) => menuItem(s.name.toLowerCase(), () => selectSample(i)));
  menuItem('blank', loadBlank);
  menuItem('select from disk…', () => fileInput.click());

  pickBtn.onclick = (e) => {
    e.stopPropagation(); // don't let the outside-click closer see this same click
    menuOpen = !menuOpen;
    picker.classList.toggle('open', menuOpen);
  };
  document.addEventListener('click', () => menuOpen && closeMenu());

  const dlBtn = el('button', 'chip', 'download');
  dlBtn.onclick = () => onDownload?.();
  const atlasRow = el('div', 'row');
  atlasRow.append(picker, dlBtn);
  panel.append(fileInput, atlasRow);
  panel.appendChild(el('div', 'tiny hint', 'or drop a sprite sheet anywhere'));

  // Decode a dropped/picked file, surfacing failures instead of swallowing them
  // as an unhandled promise rejection (bad/corrupt images just no-op otherwise).
  async function loadFile(f) {
    try {
      onAtlas(await fileToImageData(f));
    } catch (err) {
      setError(`Couldn't read "${f.name}" as an image: ${err.message}`);
    }
  }

  // Whole-app drag & drop. A depth counter keeps the overlay stable as the drag
  // crosses child elements (dragenter/leave bubble from every descendant).
  let dragDepth = 0;
  app.addEventListener('dragenter', (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    app.classList.add('app-drag');
  });
  app.addEventListener('dragover', (e) => {
    if (dragHasFiles(e)) e.preventDefault();
  });
  app.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) app.classList.remove('app-drag');
  });
  app.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    app.classList.remove('app-drag');
    const f = e.dataTransfer?.files?.[0];
    if (f) await loadFile(f);
  });

  // --- editable face preview (laid out like the sheet; click a tile to edit) -
  panel.appendChild(el('div', 'label', 'faces'));
  const slotGrid = el('div', 'slots');
  const slotEls = {};
  for (const name of SLOT_ORDER) {
    const slot = el('div', 'slot');
    const cv = el('canvas', 'thumb');
    cv.width = cv.height = THUMB;
    slot.append(cv, el('div', 'slot-cap', name));
    slot.title = `edit ${name}`;
    slot.onclick = () => onTileEdit?.(name);
    slotGrid.appendChild(slot);
    slotEls[name] = { slot, cv };
  }
  panel.appendChild(slotGrid);

  // --- options (pill toggle buttons) ----------------------------------------
  panel.appendChild(el('div', 'label', 'options'));
  const toggleRow = el('div', 'row');
  const lowpolyBtn = toggleBtn('smooth slopes', state.lowpoly, (on) => {
    state.lowpoly = on;
    onOptionChange();
  });
  const rotBtn = toggleBtn('auto-rotate', state.autoRotate, (on) => {
    state.autoRotate = on;
  });
  toggleRow.append(lowpolyBtn, rotBtn);
  panel.appendChild(toggleRow);

  // --- stats ----------------------------------------------------------------
  const stats = el('div', 'stats');
  panel.appendChild(stats);

  // --- editor panel (the right-side sidebar; populated by main.js on edit) ----
  const editorDock = document.getElementById('editor-panel');

  // --- methods --------------------------------------------------------------
  function selectSample(i) {
    onSample(samples[i]);
  }

  function syncControls() {
    setToggle(lowpolyBtn, state.lowpoly);
    setToggle(rotBtn, state.autoRotate);
  }

  function setAtlasInfo({ tileW: tw, tileH: th }) {
    tileText.textContent = `${tw} × ${th} px`;
  }

  function setThumbnails(views) {
    for (const name of SLOT_ORDER) {
      const { slot, cv } = slotEls[name];
      // Show ONLY the face's actual atlas pixels — a face with no art of its own
      // reads as empty (an honest view of state; it's still mirror-filled when the
      // model renders, but the sheet genuinely has nothing there yet).
      const img = (views && views[name]) || null;
      slot.classList.toggle('filled', !!img);
      drawPixels(cv, img, THUMB_FIT, THUMB_FIT);
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

  // Enter/leave drawing mode: slide the right-side editor panel open/closed (the
  // 3D viewport flexes to make room).
  function setDrawingMode(on) {
    editorDock.classList.toggle('open', !!on);
  }

  // Highlight the face currently open in the editor (null clears it).
  function setActiveFace(name) {
    for (const n of SLOT_ORDER) slotEls[n].slot.classList.toggle('editing', n === name);
  }

  return {
    selectSample,
    syncControls,
    setThumbnails,
    setStats,
    setError,
    setAtlasInfo,
    editorDock,
    setDrawingMode,
    setActiveFace,
  };
}
