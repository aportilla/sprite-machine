// ---------------------------------------------------------------------------
// UI chrome around the editor, drawn with the `vintage-frames` System 7 web
// component kit: a full-width white header strip (brand + a standalone
// "pick atlas" vf-menu + a download vf-button) and, floating over the 3D stage,
// the render toggles (smooth-slopes / auto-rotate vf-checkboxes on a small
// panel) and a compact live-stats/warnings readout. The tools panel itself
// (LEFT half) is the inline tile editor, mounted by main.js into #editor-panel.
// The whole app window is a drop target for sprite sheets. Pure DOM; talks to
// main.js via callbacks.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { fileToImageData } from './image-io.js';
import { flip } from './lib/ingest.js';
import { icon } from './icons.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// A caption in the kit's own faces (so it scales with the components): the
// display face for chrome, `face="body"` (Geneva 9) for fine print.
function label(text, opts = {}) {
  const l = document.createElement('vf-label');
  if (opts.face) l.setAttribute('face', opts.face);
  if (opts.dim) l.setAttribute('dim', '');
  l.textContent = text;
  return l;
}

// A warning / error line for the stats overlay: an alert icon + the message.
function warnRow(msg) {
  const r = el('div', 'warn');
  r.append(icon('alert'), label(msg, { face: 'body' }));
  return r;
}

// Mirror a tile for display (an axis-flip in image space), so a mirror-derived
// face shows the way we actually render it. `axis` is 'x' (horizontal) or 'y'.
// Exported so main.js can seed the tile editor's canvas with the same mirrored
// image the onion-skin shows. A thin wrapper over the pipeline's `flip` blit so
// there is one mirror implementation. (In practice MIRROR_AXIS is always 'x'.)
export function mirrorImage(img, axis) {
  return flip(img, axis === 'x', axis === 'y');
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
  const dropCard = el('div', 'drop-overlay-msg');
  dropCard.appendChild(label('Drop a sprite sheet to load'));
  dropOverlay.appendChild(dropCard);
  app.appendChild(dropOverlay);

  // --- header strip: brand (left) + atlas actions (right) --------------------
  const brand = label('Sprite Machine');
  brand.className = 'brand';
  topbar.appendChild(brand);
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

  // "pick atlas" — a standalone vf-menu (the classic menu-button pattern): its
  // dropped panel lists the load actions (samples / blank / from disk). The
  // whole app is also a drop target.
  const picker = document.createElement('vf-menu');
  picker.setAttribute('label', 'pick atlas');
  picker.className = 'atlas-menu';
  const menuItem = (value, text) => {
    const it = document.createElement('vf-menu-item');
    it.setAttribute('value', value);
    it.textContent = text;
    picker.appendChild(it);
  };
  samples.forEach((s, i) => menuItem(`sample:${i}`, s.name.toLowerCase()));
  menuItem('blank', 'blank');
  const sep = document.createElement('vf-separator');
  picker.appendChild(sep);
  menuItem('disk', 'select from disk…');
  picker.addEventListener('vf-menu-select', (e) => {
    const v = /** @type {CustomEvent} */ (e).detail.value;
    if (v.startsWith('sample:')) selectSample(+v.slice('sample:'.length));
    else if (v === 'blank') loadBlank();
    else if (v === 'disk') fileInput.click();
  });

  const dlBtn = document.createElement('vf-button');
  dlBtn.textContent = 'download';
  dlBtn.addEventListener('click', () => onDownload?.());
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

  // --- stage overlays: render toggles (bottom-right) + live stats (corner) ----
  // The toggles are System 7 checkboxes on a small floating white panel.
  const controls = el('div', 'stage-controls');
  const toggle = (text, initial, onToggle) => {
    const cb = document.createElement('vf-checkbox');
    cb.textContent = text;
    /** @type {any} */ (cb).checked = !!initial;
    cb.addEventListener('vf-change', (e) => {
      onToggle(!!(/** @type {CustomEvent} */ (e).detail.checked));
    });
    return cb;
  };
  const lowpolyCb = toggle('smooth slopes', state.lowpoly, (on) => {
    state.lowpoly = on;
    onOptionChange();
  });
  const rotCb = toggle('auto rotate', state.autoRotate, (on) => {
    state.autoRotate = on;
  });
  controls.append(lowpolyCb, rotCb);
  stage.appendChild(controls);

  const stats = el('div', 'stage-stats');
  stage.appendChild(stats);

  // --- methods --------------------------------------------------------------
  function selectSample(i) {
    onSample(samples[i]);
  }

  function syncControls() {
    /** @type {any} */ (lowpolyCb).checked = !!state.lowpoly;
    /** @type {any} */ (rotCb).checked = !!state.autoRotate;
  }

  function setStats({ dims, voxels, triangles, warnings }) {
    stats.innerHTML = '';
    const line = (k, v) => {
      const r = el('div', 'stat');
      const key = label(k, { face: 'body', dim: true });
      key.className = 'k';
      const val = label(String(v), { face: 'body' });
      val.className = 'v';
      r.append(key, val);
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
