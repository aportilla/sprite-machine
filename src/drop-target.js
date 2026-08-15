// ---------------------------------------------------------------------------
// Whole-app drag & drop for sprite sheets, plus the drop overlay. A plain
// module (there is nothing componenty here — the listeners live on #app, a
// container we don't own). A depth counter keeps the overlay stable as the
// drag crosses child elements (dragenter/leave bubble from every descendant);
// the overlay's visibility is a CSS rule off `#app.app-drag`, so this stays a
// classList toggle. The overlay renders into the PAGE's light DOM, so its
// styles live with the page's share in style.css. Dropped files route to the
// loaders.
// ---------------------------------------------------------------------------

import { html, render } from 'lit';
import { loadFile } from './loaders.js';
import { label } from './components/ui-bits.js';

const dragHasFiles = (e) =>
  !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

export function initDropTarget() {
  const app = document.getElementById('app');

  // The overlay never changes — render it once, after #workspace.
  render(
    html`<div class="drop-overlay">
      <div class="drop-overlay-msg">${label('Drop a sprite sheet to load')}</div>
    </div>`,
    app
  );

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
}
