// ---------------------------------------------------------------------------
// The desktop icon layer: a read-only cluster of SAMPLE icons (Car, Cube, …)
// plus one renameable icon per SAVED document, reconciled from the files
// slice. Icon art is generated from the document itself — the FRONT tile
// drawn into 32×32 (image-io.js) — so every icon declares the kit's `color`
// treatment (selection darkens instead of inverting). Double-click opens
// (dirty-checked through the shell actions); the open document's icon wears
// the kit's `open` ghost.
//
// Positions are `left`/`top` properties in system px — never CSS — so a drag
// writes back through the same declaration and desktop-state.js can persist
// them. Defaults stack a column at the left edge below the Tools palette;
// a saved position (from a previous session's drag) wins.
// ---------------------------------------------------------------------------

import { SAMPLES } from '../lib/sprite-data.js';
import { sliceAtlas } from '../lib/atlas.js';
import { urlToImageData, tileToIconDataUri, genericDocIconDataUri } from '../image-io.js';
import { files } from '../state/files.js';

// The default icon lattice: one column at the left edge, below the palette.
const COL_X = 16;
const ROW_Y0 = 340;
const ROW_PITCH = 72;
const defaultPos = (slot) => ({ left: COL_X, top: ROW_Y0 + slot * ROW_PITCH });

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {{ actions: {openSample(i: number): void, openDoc(id: string): void},
 *           savedPos?: (key: string) => {left:number, top:number}|null,
 *           fresh?: boolean }} opts
 */
export function initIcons(desktop, { actions, savedPos = () => null, fresh = false }) {
  const root = desktop.querySelector('#desktop-icons');
  /** @type {(() => void)[]} */
  const teardown = [];

  function makeIcon(key, label, slot, { editable = false } = {}) {
    const icon = /** @type {any} */ (document.createElement('vf-icon'));
    icon.dataset.key = key;
    icon.label = label;
    icon.width = 64;
    icon.selectable = true;
    icon.movable = true;
    icon.editable = editable;
    icon.color = true; // generated color art: selection darkens, not inverts
    const pos = savedPos(key) ?? defaultPos(slot);
    icon.left = pos.left;
    icon.top = pos.top;
    root.append(icon);
    return icon;
  }

  // Swap (or install) an icon's 32×32 art. The vf-img wrapper is created
  // once; later syncs only touch the img src when it actually changed.
  function setIconArt(icon, dataUri) {
    let img = icon.querySelector('vf-img > img');
    if (!img) {
      const wrap = document.createElement('vf-img');
      wrap.slot = 'large';
      wrap.width = 32;
      wrap.height = 32;
      img = document.createElement('img');
      img.alt = '';
      wrap.append(img);
      icon.append(wrap);
    }
    if (img.getAttribute('src') !== dataUri) img.src = dataUri;
  }

  // --- the sample cluster -----------------------------------------------------
  SAMPLES.forEach((sample, i) => {
    const icon = makeIcon(`sample:${sample.name}`, sample.name, i);
    icon.addEventListener('vf-open', () => actions.openSample(i));
    setIconArt(icon, genericDocIconDataUri());
    // Real art arrives async (the Car sample decodes its PNG); the generic
    // glyph stands in until then.
    (async () => {
      try {
        const image = sample.atlas.image ?? (await urlToImageData(sample.atlas.url));
        const art = tileToIconDataUri(sliceAtlas(image).views.front);
        if (art && icon.isConnected) setIconArt(icon, art);
      } catch {
        // keep the generic glyph
      }
    })();
  });

  // --- saved-document icons ---------------------------------------------------
  // Reconciled from the files listing; skipped entirely under ?fresh=1 so a
  // capture on a machine with saved docs stays deterministic.
  function syncDocIcons() {
    const state = files.get();
    const wanted = new Set(state.list.map((r) => `doc:${r.id}`));
    for (const el of root.querySelectorAll('vf-icon[data-key^="doc:"]')) {
      if (!wanted.has(/** @type {HTMLElement} */ (el).dataset.key)) el.remove();
    }
    state.list.forEach((r, i) => {
      const key = `doc:${r.id}`;
      let icon = /** @type {any} */ (
        root.querySelector(`vf-icon[data-key="${CSS.escape(key)}"]`)
      );
      if (!icon) {
        icon = makeIcon(key, r.name, SAMPLES.length + i, { editable: true });
        icon.addEventListener('vf-open', () => actions.openDoc(r.id));
        // In-place rename commits through the same store action the File
        // menu's Rename uses — the two paths converge.
        icon.addEventListener('vf-change', (e) => {
          const detail = /** @type {CustomEvent} */ (e).detail;
          files.renameById(r.id, detail.label).catch(() => {
            icon.label = detail.previous; // storage refused — restore
          });
        });
      }
      if (icon.label !== r.name) icon.label = r.name;
      setIconArt(icon, r.icon ?? genericDocIconDataUri());
      icon.open = state.currentId === r.id;
    });
  }
  if (!fresh) {
    teardown.push(files.subscribe(syncDocIcons));
    syncDocIcons();
  }

  return {
    dispose() {
      for (const fn of teardown) fn();
      // Remove the rendered icons so an HMR re-init rebuilds them with fresh
      // listeners instead of stacking stale ones.
      root.replaceChildren();
    },
  };
}
