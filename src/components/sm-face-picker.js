// <sm-face-picker>: a vf-radio-group of cube icons, one per face in `faces`.
// A pick dispatches a bubbling `sm-select-face` event with {face}.
//
// The cube art uses the object's own left and right, not the viewer's: `left`
// is the cube's lower-right quad.
//
// The selected icon's dither overlay is placed with vf-img's top/left, which
// vf-img writes as inline style. The overlay toggles by class, not a bound
// style attribute, and stays in the DOM so the image does not re-mount.

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { baseStyles } from './base-styles.js';
import backUrl from '../assets/faces/back.png';
import bottomUrl from '../assets/faces/bottom.png';
import frontUrl from '../assets/faces/front.png';
import leftUrl from '../assets/faces/left.png';
import rightUrl from '../assets/faces/right.png';
import topUrl from '../assets/faces/top.png';
import selectedUrl from '../assets/faces/selected.png';

const FACE_ART = {
  left: leftUrl,
  right: rightUrl,
  front: frontUrl,
  back: backUrl,
  top: topUrl,
  bottom: bottomUrl,
};

// Native size of all seven images, in system px.
const ICON_W = 21;
const ICON_H = 26;

export class SmFacePicker extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      /* The positioning box for the overlay's top/left. */
      .editor-face-art {
        position: relative;
        display: block;
      }
      /* Visibility, not display, so vf-img's box rules are left alone. */
      .editor-face-selected {
        visibility: hidden;
      }
      .editor-face-selected.on {
        visibility: visible;
      }
    `,
  ];

  static properties = {
    faces: { attribute: false },
    selected: {},
  };

  constructor() {
    super();
    /** @type {string[]|null} */
    this.faces = null;
    this.selected = '';
  }

  #icon(face) {
    return html`
      <div class="editor-face-art">
        <vf-img class="editor-face-cube" width=${ICON_W} height=${ICON_H}>
          <img src=${FACE_ART[face] || FACE_ART.front} alt="" />
        </vf-img>
        <vf-img
          class=${classMap({
            'editor-face-selected': true,
            on: face === this.selected,
          })}
          width=${ICON_W}
          height=${ICON_H}
          top="0"
          left="0"
        >
          <img src=${selectedUrl} alt="" />
        </vf-img>
      </div>
    `;
  }

  render() {
    const faces = this.faces || [this.selected];
    return html`
      <vf-radio-group
        class="editor-face-picker"
        label="edit face"
        .value=${this.selected}
        @vf-change=${this.#onPick}
      >
        <vf-stack direction="row" gap="12">
          ${faces.map(
            (f) => html`
              <vf-stack
                class="editor-face-cell"
                direction="column"
                gap="0"
                place="center"
                title=${f}
                @click=${(e) => this.#onCellClick(e, f)}
              >
                ${this.#icon(f)}
                <vf-radio value=${f} aria-label=${f}></vf-radio>
              </vf-stack>
            `
          )}
        </vf-stack>
      </vf-radio-group>
    `;
  }

  #onPick = (e) => {
    const f = /** @type {CustomEvent} */ (e).detail.value;
    if (f && f !== this.selected) this.#emit(f);
  };

  // The icon is a click target too. A click on the radio itself goes through
  // the group's vf-change, so it is skipped here.
  #onCellClick(e, f) {
    if (/** @type {Element} */ (e.target).closest?.('vf-radio')) return;
    if (f !== this.selected) this.#emit(f);
  }

  #emit(face) {
    this.dispatchEvent(
      new CustomEvent('sm-select-face', { detail: { face }, bubbles: true })
    );
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-face-picker'))
  customElements.define('sm-face-picker', SmFacePicker);
