// ---------------------------------------------------------------------------
// Whole-app drag & drop for sprite sheets, plus the drop overlay. A plain
// module (there is nothing componenty here — the listeners live on <body>, so
// a drop lands anywhere on the desktop). A depth counter keeps the overlay
// stable as the drag crosses child elements (dragenter/leave bubble from
// every descendant); the overlay's visibility is a CSS rule off
// `body.app-drag`, so this stays a classList toggle. The overlay renders into
// the PAGE's light DOM, so its styles live with the page's share in
// style.css. Dropped files route to the loaders — and a dropped PNG that IS
// an exported document restores its name and transforms from its chunks
// (loaders.loadFile).
// ---------------------------------------------------------------------------

import { html, render } from 'lit';
import { loadFile } from './loaders.js';
import { label } from './components/ui-bits.js';

const dragHasFiles = (e) =>
  !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

export function initDropTarget() {
  const body = document.body;

  // The overlay never changes — render it once into a stable mount (reused
  // across HMR re-executions rather than stacked).
  let mount = document.getElementById('drop-overlay-mount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'drop-overlay-mount';
    body.append(mount);
  }
  render(
    html`<div class="drop-overlay">
      <div class="drop-overlay-msg">${label('Drop a sprite sheet to load')}</div>
    </div>`,
    mount
  );

  let dragDepth = 0;
  const onDragEnter = (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    body.classList.add('app-drag');
  };
  const onDragOver = (e) => {
    if (dragHasFiles(e)) e.preventDefault();
  };
  const onDragLeave = () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) body.classList.remove('app-drag');
  };
  const onDrop = async (e) => {
    e.preventDefault();
    dragDepth = 0;
    body.classList.remove('app-drag');
    const f = e.dataTransfer?.files?.[0];
    if (f) await loadFile(f);
  };
  body.addEventListener('dragenter', onDragEnter);
  body.addEventListener('dragover', onDragOver);
  body.addEventListener('dragleave', onDragLeave);
  body.addEventListener('drop', onDrop);
  return () => {
    body.removeEventListener('dragenter', onDragEnter);
    body.removeEventListener('dragover', onDragOver);
    body.removeEventListener('dragleave', onDragLeave);
    body.removeEventListener('drop', onDrop);
  };
}
