// The drop overlay, shown while files are dragged over the page. A depth
// counter keeps it steady while dragenter and dragleave bubble from
// descendants. body.app-drag shows it (style.css). The drop is the Finder's (a
// sprite sheet) and the backup's (a zip, apps/finder/backup.js).

import { html, render } from 'lit';
import { label } from './components/ui-bits.js';

const dragHasFiles = (e) =>
  !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

export function initDropOverlay() {
  const body = document.body;

  // Render once into a mount that is reused across HMR re-runs.
  let mount = document.getElementById('drop-overlay-mount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'drop-overlay-mount';
    body.append(mount);
  }
  render(
    html`<div class="drop-overlay">
      <div class="drop-overlay-msg">${label('Drop a sprite sheet or a backup')}</div>
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
  const onDragLeave = () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) body.classList.remove('app-drag');
  };
  // Capture, so the overlay goes even when a handler stops the drop.
  const onDrop = () => {
    dragDepth = 0;
    body.classList.remove('app-drag');
  };
  body.addEventListener('dragenter', onDragEnter);
  body.addEventListener('dragleave', onDragLeave);
  body.addEventListener('drop', onDrop, true);
  return () => {
    body.removeEventListener('dragenter', onDragEnter);
    body.removeEventListener('dragleave', onDragLeave);
    body.removeEventListener('drop', onDrop, true);
  };
}
