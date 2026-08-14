// ---------------------------------------------------------------------------
// UI chrome around the editor, drawn with the `vintage-frames` System 7 web
// component kit: a full-width white header strip (brand + a standalone
// "pick atlas" vf-menu + a download vf-button) and, floating over the 3D stage,
// the render toggles (smooth-slopes / auto-rotate vf-checkboxes on a small
// panel) and a compact live-stats/warnings readout. The tools panel itself
// (LEFT half) is the <sm-editor> element, mounted by main.js into #editor-panel.
// The whole app window is a drop target for sprite sheets.
//
// Rendered with `lit-html` into the three containers index.html already ships
// (#topbar, #stage, #app): one `update()` re-renders the chrome for whatever the
// current state says, and lit diffs. The state it reads is the `prefs` slice
// (the render toggles, routed back through their actions) and the `build` slice
// (stats + errors, written by the rebuild pipeline) — this module subscribes to
// both, so a slice change re-renders with no push-in methods.
//
// LIGHT DOM throughout: no component of our own, no shadow root, so style.css's
// `.stage-*` / `.topbar-*` / `.drop-overlay` rules and `capture.sh dom` keep
// working unchanged.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { html, render } from 'lit';
import { live } from 'lit/directives/live.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { createRef, ref } from 'lit/directives/ref.js';
import { fileToImageData } from './image-io.js';
import { prefs } from './state/prefs.js';
import { build } from './state/build.js';
import './icons.js'; // registers <sp-icon-alert> (used by the warning rows below)

// A caption in the kit's own faces (so it scales with the components): the
// display face for chrome, `face="body"` (Geneva 9) for fine print.
/** @param {string} text
 *  @param {{ face?: 'display'|'body', dim?: boolean, cls?: string }} [opts] */
const label = (text, { face, dim = false, cls } = {}) =>
  html`<vf-label class=${ifDefined(cls)} face=${ifDefined(face)} ?dim=${dim}
    >${text}</vf-label
  >`;

// A warning / error line for the stats overlay: an alert icon + the message.
const warnRow = (msg) =>
  html`<div class="warn">
    <sp-icon-alert></sp-icon-alert>${label(msg, { face: 'body' })}
  </div>`;

const dragHasFiles = (e) =>
  !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

export function createUI({ samples, onSample, onAtlas, onDownload }) {
  const app = document.getElementById('app');
  const topbar = document.getElementById('topbar');
  const stage = document.getElementById('stage');
  const editorDock = document.getElementById('editor-panel');

  // The hidden <input type=file> the "select from disk…" menu item clicks.
  const fileInput = /** @type {import('lit/directives/ref.js').Ref<HTMLInputElement>} */ (
    createRef()
  );

  // --- header strip: brand (left) + atlas actions (right) --------------------
  // "pick atlas" is a standalone vf-menu (the classic menu-button pattern): its
  // dropped panel lists the load actions (samples / blank / from disk). The
  // whole app is also a drop target.
  const header = () => html`
    ${label('Sprite Machine', { cls: 'brand' })}
    <div class="topbar-actions">
      <vf-menu label="pick atlas" class="atlas-menu" @vf-menu-select=${onMenuSelect}>
        ${samples.map(
          (s, i) =>
            html`<vf-menu-item value="sample:${i}">${s.name.toLowerCase()}</vf-menu-item>`
        )}
        <vf-menu-item value="blank">blank</vf-menu-item>
        <vf-separator></vf-separator>
        <vf-menu-item value="disk">select from disk…</vf-menu-item>
      </vf-menu>
      <vf-button @click=${() => onDownload?.()}>download</vf-button>
    </div>
    <input
      type="file"
      accept="image/*"
      style="display: none"
      ${ref(fileInput)}
      @change=${onFilePicked}
    />
  `;

  // --- stage overlays: render toggles (bottom-right) + live stats (corner) ----
  // The toggles are System 7 checkboxes on a small floating white panel; they
  // are CONTROLLED — bound down from the prefs slice, routed back up through its
  // actions on vf-change. `live()` diffs against the checkbox's own current
  // state, not the last rendered value, so a re-render can never skip a needed
  // re-sync.
  const stageOverlays = () => html`
    <div class="stage-controls">
      <vf-checkbox
        .checked=${live(!!prefs.get().lowpoly)}
        @vf-change=${(e) => prefs.setLowpoly(e.detail.checked)}
        >smooth slopes</vf-checkbox
      >
      <vf-checkbox
        .checked=${live(!!prefs.get().autoRotate)}
        @vf-change=${(e) => prefs.setAutoRotate(e.detail.checked)}
        >auto rotate</vf-checkbox
      >
    </div>
    <div class="stage-stats">${statsRows()}</div>
  `;

  const statLine = (k, v) => html`
    <div class="stat">
      ${label(k, { face: 'body', dim: true, cls: 'k' })}
      ${label(String(v), { face: 'body', cls: 'v' })}
    </div>
  `;

  // The readout body, off the build slice. An error stands alone; otherwise the
  // measured lines over any build warnings. Empty (the no-views case) leaves the
  // panel with nothing but lit's comment markers, which `.stage-stats:empty`
  // still counts as empty.
  function statsRows() {
    const b = build.get();
    if (b.error) return warnRow(b.error);
    const rows = [];
    // Tiles are locked square, so a well-formed sheet carves to an N³ grid — show the
    // single edge in px. A non-square (warned) load still reports its full nx×ny×nz.
    if (b.dims) {
      const { nx, ny, nz } = b.dims;
      rows.push(
        statLine('grid', nx === ny && ny === nz ? `${nx}px` : `${nx}×${ny}×${nz}`)
      );
    }
    if (b.voxels) rows.push(statLine('voxels', b.voxels));
    if (b.triangles) rows.push(statLine('tris', b.triangles));
    for (const w of b.warnings || []) rows.push(warnRow(w));
    return rows;
  }

  // Re-render the chrome from current state. Both containers already hold
  // content from index.html (#topbar is empty, #stage owns the viewport canvas);
  // lit only manages the part it appends, so the canvas is untouched.
  function update() {
    render(header(), topbar);
    render(stageOverlays(), stage);
  }

  // The whole-app drop overlay never changes — render it once, after #workspace.
  render(
    html`<div class="drop-overlay">
      <div class="drop-overlay-msg">${label('Drop a sprite sheet to load')}</div>
    </div>`,
    app
  );
  update();

  // A slice change re-renders the chrome; unsubscribed via dispose() on HMR.
  const unsubs = [prefs.subscribe(update), build.subscribe(update)];

  // --- event plumbing --------------------------------------------------------
  // A fresh 3x2 sheet of empty (transparent) square 40×40 tiles to draw from
  // scratch — every face reads empty until you paint it.
  const loadBlank = () => onAtlas(new ImageData(120, 80));

  function onMenuSelect(e) {
    const v = /** @type {CustomEvent} */ (e).detail.value;
    if (v.startsWith('sample:')) selectSample(+v.slice('sample:'.length));
    else if (v === 'blank') loadBlank();
    else if (v === 'disk') fileInput.value?.click();
  }

  async function onFilePicked() {
    const input = /** @type {HTMLInputElement} */ (fileInput.value);
    const f = input.files[0];
    input.value = '';
    if (f) await loadFile(f);
  }

  // Decode a dropped/picked file, surfacing failures instead of swallowing them
  // as an unhandled promise rejection (bad/corrupt images just no-op otherwise).
  async function loadFile(f) {
    try {
      onAtlas(await fileToImageData(f));
    } catch (err) {
      build.setError(`Couldn't read "${f.name}" as an image: ${err.message}`);
    }
  }

  // Whole-app drag & drop. A depth counter keeps the overlay stable as the drag
  // crosses child elements (dragenter/leave bubble from every descendant). The
  // overlay's visibility is a CSS rule off `#app.app-drag`, so this stays a
  // classList toggle on a container we don't own.
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

  // --- methods --------------------------------------------------------------
  function selectSample(i) {
    onSample(samples[i]);
  }

  return {
    selectSample,
    editorDock,
    // HMR teardown: drop this instance's slice subscriptions so a re-executed
    // main.js doesn't leave the old chrome re-rendering forever.
    dispose() {
      for (const u of unsubs) u();
    },
  };
}
