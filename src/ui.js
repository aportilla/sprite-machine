// ---------------------------------------------------------------------------
// UI panel: sample picker, a single atlas dropzone (with editable tile size),
// a read-only preview of the sliced faces, and mode/mirror/alpha/mesh controls
// plus a live stats readout. Pure DOM; talks to main.js via callbacks.
// ---------------------------------------------------------------------------

import { fileToImageData } from './image-io.js';
import { VIEW_DISPLAY_ORDER as SLOT_ORDER } from './lib/views.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function drawPixels(canvas, img, boxW, boxH) {
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (!img) return;
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
  g.imageSmoothingEnabled = false;
  g.drawImage(tmp, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}

export function createUI({ samples, state, onSample, onAtlas, onTileSize, onOptionChange }) {
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

  // --- atlas dropzone -------------------------------------------------------
  panel.appendChild(el('div', 'label', 'atlas (3×2 sheet: RIGHT FRONT TOP / LEFT BACK BOTTOM)'));
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

  // tile size (auto-derived, editable)
  const tileRow = el('div', 'row tile-row');
  tileRow.append(el('span', 'tiny', 'tile'));
  const tileW = el('input', 'tile-in');
  const tileH = el('input', 'tile-in');
  for (const t of [tileW, tileH]) {
    t.type = 'number';
    t.min = 1;
    t.onchange = () => onTileSize(+tileW.value || 1, +tileH.value || 1);
  }
  tileRow.append(tileW, el('span', 'tiny', '×'), tileH, el('span', 'tiny', 'px'));
  const foundLine = el('span', 'tiny found', '');
  tileRow.appendChild(foundLine);
  panel.appendChild(tileRow);

  // --- read-only sliced-face preview ---------------------------------------
  panel.appendChild(el('div', 'label', 'faces'));
  const slotGrid = el('div', 'slots');
  const slotEls = {};
  for (const name of SLOT_ORDER) {
    const slot = el('div', 'slot ro');
    const cv = el('canvas', 'thumb');
    cv.width = cv.height = 40;
    slot.append(cv, el('div', 'slot-cap', name));
    slotGrid.appendChild(slot);
    slotEls[name] = { slot, cv };
  }
  panel.appendChild(slotGrid);

  // --- options --------------------------------------------------------------
  panel.appendChild(el('div', 'label', 'mode'));
  const modeRow = el('div', 'row');
  const voxelBtn = el('button', 'chip', 'voxel (3D)');
  const boxBtn = el('button', 'chip', 'box (fast)');
  voxelBtn.onclick = () => setMode('voxel');
  boxBtn.onclick = () => setMode('box');
  modeRow.append(voxelBtn, boxBtn);
  panel.appendChild(modeRow);

  panel.appendChild(el('div', 'label', 'mirror missing faces'));
  const mirrorRow = el('div', 'row');
  const mirrorBoxes = {};
  for (const ax of ['x', 'y', 'z']) {
    const lab = el('label', 'check');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.onchange = () => {
      state.mirror[ax] = cb.checked;
      onOptionChange();
    };
    lab.append(cb, document.createTextNode(` ${ax.toUpperCase()}`));
    mirrorRow.appendChild(lab);
    mirrorBoxes[ax] = cb;
  }
  panel.appendChild(mirrorRow);

  panel.appendChild(el('div', 'label', 'alpha threshold'));
  const alphaRow = el('div', 'row');
  const alpha = el('input');
  alpha.type = 'range';
  alpha.min = 1;
  alpha.max = 255;
  alpha.oninput = () => {
    state.alphaThreshold = +alpha.value;
    alphaVal.textContent = alpha.value;
    onOptionChange();
  };
  const alphaVal = el('span', 'val', '128');
  alphaRow.append(alpha, alphaVal);
  panel.appendChild(alphaRow);

  const toggleRow = el('div', 'row');
  const lowpolyLab = el('label', 'check');
  const lowpoly = el('input');
  lowpoly.type = 'checkbox';
  lowpoly.onchange = () => {
    state.lowpoly = lowpoly.checked;
    onOptionChange();
  };
  lowpolyLab.append(lowpoly, document.createTextNode(' low-poly'));
  const greedyLab = el('label', 'check');
  const greedy = el('input');
  greedy.type = 'checkbox';
  greedy.onchange = () => {
    state.greedy = greedy.checked;
    onOptionChange();
  };
  greedyLab.append(greedy, document.createTextNode(' greedy mesh'));
  const rotLab = el('label', 'check');
  const rot = el('input');
  rot.type = 'checkbox';
  rot.onchange = () => (state.autoRotate = rot.checked);
  rotLab.append(rot, document.createTextNode(' auto-rotate'));
  toggleRow.append(lowpolyLab, greedyLab, rotLab);
  panel.appendChild(toggleRow);

  // --- stats ----------------------------------------------------------------
  const stats = el('div', 'stats');
  panel.appendChild(stats);

  // --- methods --------------------------------------------------------------
  function setMode(m) {
    state.mode = m;
    voxelBtn.classList.toggle('active', m === 'voxel');
    boxBtn.classList.toggle('active', m === 'box');
    onOptionChange();
  }

  function selectSample(i) {
    sampleBtns.forEach((b, j) => b.classList.toggle('active', j === i));
    onSample(samples[i]);
  }

  function syncControls() {
    for (const ax of ['x', 'y', 'z']) mirrorBoxes[ax].checked = state.mirror[ax];
    alpha.value = state.alphaThreshold;
    alphaVal.textContent = state.alphaThreshold;
    greedy.checked = state.greedy;
    lowpoly.checked = state.lowpoly;
    rot.checked = state.autoRotate;
    voxelBtn.classList.toggle('active', state.mode === 'voxel');
    boxBtn.classList.toggle('active', state.mode === 'box');
  }

  function setAtlasPreview(img) {
    drawPixels(dropCanvas, img, dropCanvas.width - 8, dropCanvas.height - 8);
    dropHint.style.display = img ? 'none' : 'block';
  }

  function setAtlasInfo({ tileW: tw, tileH: th, views }) {
    tileW.value = tw;
    tileH.value = th;
    const found = SLOT_ORDER.filter((n) => views && views[n]);
    foundLine.textContent = found.length ? found.join(' ') : 'none';
  }

  function setThumbnails(views) {
    for (const name of SLOT_ORDER) {
      const { slot, cv } = slotEls[name];
      const img = views && views[name];
      slot.classList.toggle('filled', !!img);
      drawPixels(cv, img, 40, 40);
    }
  }

  function setStats({ provided, dims, voxels, triangles, warnings }) {
    stats.innerHTML = '';
    const line = (k, v) => {
      const r = el('div', 'stat');
      r.append(el('span', 'k', k), el('span', 'v', String(v)));
      stats.appendChild(r);
    };
    line('views', provided && provided.length ? provided.join(', ') : '—');
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
    setMode,
    setAtlasPreview,
    setAtlasInfo,
  };
}
