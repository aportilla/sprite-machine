// ---------------------------------------------------------------------------
// <sm-topbar> — the System 7 header strip: brand (left), the standalone
// "pick atlas" vf-menu + download vf-button (right), and the hidden file input
// the "select from disk…" item clicks. A CONNECTED chrome component: menu picks
// route to the loaders, download drains the doc and snapshots the canonical
// sheet. Static content — it renders once (samples are a build-time constant).
//
// LIGHT DOM + a `display: contents` host rule, so the box tree inside #topbar
// is exactly the brand/actions row style.css already lays out.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { LitElement, html } from 'lit';
import { createRef, ref } from 'lit/directives/ref.js';
import { SAMPLES } from '../lib/sprite-data.js';
import { loadSample, loadFile, loadBlank } from '../loaders.js';
import { doc } from '../state/doc.js';
import { build } from '../state/build.js';
import { imageDataToBlob, downloadBlob } from '../image-io.js';
import { label } from './ui-bits.js';

export class SmTopbar extends LitElement {
  /** @type {import('lit/directives/ref.js').Ref<HTMLInputElement>} */
  #fileInput = createRef();

  createRenderRoot() {
    return this; // light DOM — style.css + `capture.sh dom` keep working
  }

  render() {
    return html`
      ${label('Sprite Machine', { cls: 'brand' })}
      <div class="topbar-actions">
        <vf-menu
          label="pick atlas"
          class="atlas-menu"
          @vf-menu-select=${this.#onMenuSelect}
        >
          ${SAMPLES.map(
            (s, i) =>
              html`<vf-menu-item value="sample:${i}"
                >${s.name.toLowerCase()}</vf-menu-item
              >`
          )}
          <vf-menu-item value="blank">blank</vf-menu-item>
          <vf-separator></vf-separator>
          <vf-menu-item value="disk">select from disk…</vf-menu-item>
        </vf-menu>
        <vf-button @click=${this.#onDownload}>download</vf-button>
      </div>
      <input
        type="file"
        accept="image/*"
        style="display: none"
        ${ref(this.#fileInput)}
        @change=${this.#onFilePicked}
      />
    `;
  }

  #onMenuSelect = (e) => {
    const v = /** @type {CustomEvent} */ (e).detail.value;
    if (v.startsWith('sample:')) loadSample(SAMPLES[+v.slice('sample:'.length)]);
    else if (v === 'blank') loadBlank();
    else if (v === 'disk') this.#fileInput.value?.click();
  };

  #onFilePicked = async () => {
    const input = /** @type {HTMLInputElement} */ (this.#fileInput.value);
    const f = input.files[0];
    input.value = '';
    if (f) await loadFile(f);
  };

  #onDownload = () => {
    if (!doc.get().atlasImage) return;
    // Fold any un-flushed live stroke into the canonical sheet BEFORE
    // snapshotting it — applyTileEdit only schedules the blit via rAF (paused
    // in a backgrounded tab), so without this drain the last stroke could be
    // dropped from atlas.png.
    doc.drain();
    imageDataToBlob(doc.get().atlasImage)
      .then((b) => downloadBlob(b, 'atlas.png'))
      .catch((err) => build.setError(`Download failed: ${err.message}`));
  };
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-topbar')) customElements.define('sm-topbar', SmTopbar);
