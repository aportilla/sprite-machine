// ---------------------------------------------------------------------------
// UI chrome around the editor: a full-width header strip (brand + atlas action
// menu + download) and, floating over the 3D stage, the render toggles
// (smooth-slopes / auto-rotate) and a compact live-stats/warnings readout. The
// tools panel itself (right half) is the inline tile editor, mounted by main.js
// into #editor-panel. The whole app window is a drop target for sprite sheets.
// Pure DOM; talks to main.js via callbacks.
// ---------------------------------------------------------------------------

import { fileToImageData } from './image-io.js';
import { icon } from './icons.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// A warning / error line for the stats overlay: an alert icon + the message.
// The icon inherits the row's warn color via currentColor.
function warnRow(msg) {
  const r = el('div', 'warn');
  r.append(icon('alert'), el('span', null, msg));
  return r;
}

// Reflect an on/off state onto a pill toggle button (class + a11y state).
function setToggle(btn, on) {
  btn.classList.toggle('on', !!on);
  btn.setAttribute('aria-pressed', String(!!on));
}

// A pill toggle button: clicking flips it and reports the new state.
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

// Mirror a tile for display (an axis-flip in image space), so a mirror-derived
// face shows the way we actually render it. `axis` is 'x' (horizontal) or 'y'.
// Exported so main.js can seed the tile editor's canvas with the same mirrored
// image the onion-skin shows.
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
  onDownload,
}) {
  const app = document.getElementById('app');
  const topbar = document.getElementById('topbar');
  const stage = document.getElementById('stage');
  const editorDock = document.getElementById('editor-panel');

  // Whole-app drop overlay (shown while a file is dragged anywhere over the app).
  const dropOverlay = el('div', 'drop-overlay');
  dropOverlay.appendChild(el('div', 'drop-overlay-msg', 'drop a sprite sheet to load'));
  app.appendChild(dropOverlay);

  // --- header strip: brand (left) + atlas actions (right) --------------------
  topbar.appendChild(el('div', 'brand', 'SPRITE MACHINE'));
  const actions = el('div', 'topbar-actions');
  topbar.appendChild(actions);

  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (f) await loadFile(f);
  };
  topbar.appendChild(fileInput);

  // A fresh 3x2 sheet of empty (transparent) square 40×40 tiles to draw from
  // scratch — every face reads empty until you paint it.
  const loadBlank = () => onAtlas(new ImageData(120, 80));

  // "pick atlas ▾" — a trigger that opens a menu of load actions (samples /
  // blank / from disk). Its label never changes. The whole app is also a drop
  // target.
  const picker = el('div', 'picker');
  const pickBtn = el('button', 'chip picker-trigger');
  const caret = icon('chevron-down');
  caret.classList.add('picker-caret');
  pickBtn.append(el('span', null, 'pick atlas'), caret);
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

  const dlBtn = el('button', 'chip');
  dlBtn.append(icon('download'), el('span', null, 'download'));
  dlBtn.onclick = () => onDownload?.();
  actions.append(picker, dlBtn);

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

  // --- stage overlays: render toggles (bottom-left) + live stats (corner) -----
  const controls = el('div', 'stage-controls');
  const lowpolyBtn = toggleBtn('smooth slopes', state.lowpoly, (on) => {
    state.lowpoly = on;
    onOptionChange();
  });
  const rotBtn = toggleBtn('auto rotate', state.autoRotate, (on) => {
    state.autoRotate = on;
  });
  controls.append(lowpolyBtn, rotBtn);
  stage.appendChild(controls);

  const stats = el('div', 'stage-stats');
  stage.appendChild(stats);

  // --- methods --------------------------------------------------------------
  function selectSample(i) {
    onSample(samples[i]);
  }

  function syncControls() {
    setToggle(lowpolyBtn, state.lowpoly);
    setToggle(rotBtn, state.autoRotate);
  }

  function setStats({ dims, voxels, triangles, warnings }) {
    stats.innerHTML = '';
    const line = (k, v) => {
      const r = el('div', 'stat');
      r.append(el('span', 'k', k), el('span', 'v', String(v)));
      stats.appendChild(r);
    };
    // Tiles are locked square, so a well-formed sheet carves to an N³ grid — show the
    // single edge in px. A non-square (warned) load still reports its full nx×ny×nz.
    if (dims) {
      const { nx, ny, nz } = dims;
      line('grid', nx === ny && ny === nz ? `${nx}px` : `${nx}×${ny}×${nz}`);
    }
    if (voxels) line('voxels', voxels);
    if (triangles) line('tris', triangles);
    for (const w of warnings || []) stats.appendChild(warnRow(w));
  }

  // Show a one-off error (e.g. a failed image decode) in the stats overlay; it
  // persists until the next successful build overwrites it.
  function setError(msg) {
    stats.innerHTML = '';
    stats.appendChild(warnRow(msg));
  }

  return {
    selectSample,
    syncControls,
    setStats,
    setError,
    editorDock,
  };
}
