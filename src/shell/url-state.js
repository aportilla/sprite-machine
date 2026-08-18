// ---------------------------------------------------------------------------
// The URL ⇄ active-document mirror: the address bar's fragment names the
// ACTIVE SAVED document (#Cube — the same name the ?file=/#fragment boot
// accepts), so a plain browser reload restores what you were looking at
// (its window geometry + edited face ride desktop-state). Opening, saving
// (an untitled's first ⌘S mints its identity), renaming and window switches
// all land here through the one workspace subscription; an untitled active
// document or the bare desktop CLEARS the fragment — a reload then greets
// with the New Document dialog, the no-autosave contract.
//
// replaceState only — flipping between documents must not grow browser
// history. The fragment is the written canonical form: any ?file= search
// param is dropped on write, so a stale one can never shadow the fragment
// at the next boot (?file wins over the fragment in boot/params.js). The
// other search params (?sample and friends, the dev hooks) pass through
// untouched — an explicit ?sample outranks ?file/#fragment at boot anyway,
// which keeps drive.mjs's mid-run headless reloads on their test path.
// ---------------------------------------------------------------------------

import { workspace } from '../state/workspace.js';

/** Mirror the active saved document's name into location.hash. Returns the
 *  unsubscribe (the HMR teardown). */
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
  // No eager sync on an empty workspace: the boot's ?file= must survive in
  // the bar until its open lands (canonicalized then), and an unresolvable
  // request stays as typed — a reload retries it. The immediate sync is for
  // the HMR re-wire, where a document is already active.
  if (workspace.active()) sync();
  return off;
}
