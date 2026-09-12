// Mirrors the active saved document's name into location.hash (#Cube), so a
// reload reopens it. An untitled document or the bare desktop clears the hash.
// replaceState keeps document switches out of history. A write drops ?file=,
// which boot/params.js would prefer over the hash.

import { workspace } from '../state/workspace.js';

/** Starts the mirror. Returns the unsubscribe. */
export function initUrlState() {
  const sync = () => {
    const ctx = workspace.active();
    const name = ctx?.fileId ? ctx.name : null;
    const url = new URL(location.href);
    url.searchParams.delete('file');
    url.hash = name ? encodeURIComponent(name) : '';
    if (url.href !== location.href) history.replaceState(null, '', url.href);
  };
  const off = workspace.subscribe(sync);
  // No initial sync on an empty workspace, so the boot's ?file= stays in the URL
  // until its document opens. A document is already active on an HMR re-run.
  if (workspace.active()) sync();
  return off;
}
