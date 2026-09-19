// A palette cell's pick: on the press for a mouse or pen, on the release for a
// finger. The press is the MacPaint feel and the mouse keeps it, but the Color
// Palette and the Full Sprite View sit in a scroller, where a pan that starts
// on a cell would pick whatever it started on. The release picks only when the
// finger stayed inside the tap slop and the pan did not cancel the press.

import { TAP_PAIR_SLOP_PX } from 'vintage-frames';

/**
 * Run `pick` for a cell's `pointerdown`, now or on its release.
 * @param {PointerEvent} e  the press, its currentTarget the cell
 * @param {() => void} pick
 */
export function pressPick(e, pick) {
  if (e.button !== 0) return;
  if (e.pointerType !== 'touch') {
    pick();
    return;
  }
  // Touch has implicit pointer capture, so the release lands on the cell
  // whatever the finger travelled over.
  const cell = /** @type {EventTarget} */ (e.currentTarget);
  const { pointerId, clientX, clientY } = e;
  const off = () => {
    cell.removeEventListener('pointerup', onUp);
    cell.removeEventListener('pointercancel', onOff);
  };
  const onUp = (/** @type {Event} */ ev) => {
    const up = /** @type {PointerEvent} */ (ev);
    if (up.pointerId !== pointerId) return;
    off();
    if (Math.hypot(up.clientX - clientX, up.clientY - clientY) <= TAP_PAIR_SLOP_PX)
      pick();
  };
  const onOff = (/** @type {Event} */ ev) => {
    if (/** @type {PointerEvent} */ (ev).pointerId !== pointerId) return;
    off();
  };
  cell.addEventListener('pointerup', onUp);
  cell.addEventListener('pointercancel', onOff);
}
