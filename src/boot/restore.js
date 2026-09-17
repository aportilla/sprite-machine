// Reopens the windows the last session left open (shell/desktop-state.js
// openWindows), deepest first, so the stacking comes back with them. Each
// window's box is its owner's business: the application reads the saved pin as
// it adopts. A document that has been deleted or moved to the Trash is skipped.

import { files, isTrashed } from '../state/files.js';
import { workspace } from '../state/workspace.js';

/** Splits a desktop-state key ("doc:<id>") into its kind and id, or null. */
function parseKey(key) {
  const at = typeof key === 'string' ? key.indexOf(':') : -1;
  if (at <= 0) return null;
  return { kind: key.slice(0, at), id: key.slice(at + 1) };
}

/** Opens a stored document on its remembered face and layer. Resolves its
 *  context key, or null. */
async function openDocument(id, docState) {
  const st = files.get();
  const rec = st.list.find((r) => r.id === id);
  if (!rec || isTrashed(st, rec.folder)) return null;
  const res = await workspace.openStored(id).catch(() => null);
  if (!res) return null;
  const was = docState(id);
  if (was?.face) workspace.setFace(res.ctx.key, was.face);
  if (Number.isInteger(was?.layer)) workspace.setLayer(res.ctx.key, was.layer);
  return res.ctx.key;
}

/**
 * @param {{key: string}[]} open  the saved windows, deepest first
 * @param {string|null} active  the window to bring forward last
 * @param {{
 *   docState: (fileId: string) => {face: string|null, layer: number|null}|null,
 *   showDocument: (ctxKey: string) => void,
 *   openFolder: (id: string) => unknown,
 *   openText: (id: string) => Promise<unknown>,
 * }} deps
 * @returns {Promise<boolean>} whether any window opened
 */
export async function restoreSession(open, active, deps) {
  /** @type {Map<string, string>} saved key -> the context key it opened */
  const docs = new Map();
  let opened = false;
  for (const { key } of open) {
    const it = parseKey(key);
    if (!it) continue;
    if (it.kind === 'doc') {
      const ctxKey = await openDocument(it.id, deps.docState);
      if (ctxKey == null) continue;
      docs.set(key, ctxKey);
    } else if (it.kind === 'folder') {
      if (!deps.openFolder(it.id)) continue;
    } else if (it.kind === 'text') {
      if (!(await deps.openText(it.id))) continue;
    } else {
      continue;
    }
    opened = true;
  }
  // Every open raises its own window, so the saved active one is raised last.
  const it = active ? parseKey(active) : null;
  if (it?.kind === 'doc' && docs.has(active)) deps.showDocument(docs.get(active));
  else if (it?.kind === 'folder') deps.openFolder(it.id);
  else if (it?.kind === 'text') await deps.openText(it.id);
  return opened;
}
