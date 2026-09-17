// Whole-page drag and drop for sprite sheets and backups, plus the drop
// overlay. A depth counter keeps the overlay steady while dragenter and
// dragleave bubble from descendants. body.app-drag shows the overlay
// (style.css).

import { html, render } from 'lit';
import { loadFile } from './loaders.js';
import { label } from './components/ui-bits.js';

const dragHasFiles = (e) =>
  !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

/** A backup archive, by name or type. @param {File} f */
const isArchive = (f) => /\.zip$/i.test(f.name) || f.type === 'application/zip';

/**
 * @param {{onLoaded?: (ctx: object) => void, onArchive?: (file: File) => void}} [opts]
 *   onLoaded receives the context a dropped sheet opened; onArchive a dropped
 *   backup, which the Finder answers for.
 */
export function initDropTarget({ onLoaded, onArchive } = {}) {
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
    if (!f) return;
    if (isArchive(f)) {
      onArchive?.(f);
      return;
    }
    const ctx = await loadFile(f);
    if (ctx) onLoaded?.(ctx);
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
