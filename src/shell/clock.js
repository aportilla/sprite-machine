// ---------------------------------------------------------------------------
// The menu bar clock — System 7.5's Date & Time clock at the bar's right end:
// the time ("7:27 PM") in the bar's own Chicago, ticking on the minute, and a
// PRESS (pointerdown — the bar's own titles act on the press, and so does
// every windoid control) flips it to the date ("8/24/26") for a moment
// before the time returns; a second press while the date shows returns early.
//
// The readout is a kit `vf-label` slotted at the END of the vf-menu-bar
// (index.html): the bar's slot is unfiltered and its row is a flex row, so a
// `margin-inline-start: auto` (style.css) lands the label at the right end,
// and the bar's own press controller hit-tests titles and rows by COORDINATE
// and ignores everything else — so the clock's pointerdown is its own, and
// the page's existing chrome rules already say the right things about it: a
// press inside the bar keeps the Finder selection (shell/icons.js's CHROME
// test) and never deactivates the application (shell/windows.js's press test
// is `target === desktop`). The label's line box is pinned to the bar's 20px
// (style.css) so its em sits on the same rows as the menu titles.
//
// `now` is injectable (the files slice's `d.now` discipline): the ?now=<when>
// boot param freezes it so tools/capture.sh shots with the bar in frame stay
// byte-deterministic. This module reads no store.
// ---------------------------------------------------------------------------

/** How long a press holds the date before the time returns. */
export const DATE_HOLD_MS = 3000;

/** @param {number} n */
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * "7:27 PM" — 12-hour, no leading zero on the hour, local time.
 * @param {Date} d
 */
export function formatTime(d) {
  const h = d.getHours();
  return `${h % 12 || 12}:${pad2(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * "8/24/26" — M/D/YY, local time: System 7.5's own short date, month and day
 * unpadded, the year its last two digits (padded — "1/24/05").
 * @param {Date} d
 */
export function formatDate(d) {
  return `${d.getMonth() + 1}/${d.getDate()}/${pad2(d.getFullYear() % 100)}`;
}

/**
 * Wires the clock onto its label. Renders at once (the label boots empty —
 * markup never carries a stale time), then once per minute boundary.
 *
 * @param {HTMLElement} label  the vf-label the clock writes into
 * @param {{now?: () => number, holdMs?: number}} [opts]  `now` — epoch ms,
 *   injectable (frozen by ?now); `holdMs` — the date's dwell after a press
 * @returns {{ dispose: () => void }}
 */
export function initClock(label, { now = Date.now, holdMs = DATE_HOLD_MS } = {}) {
  let showingDate = false;
  let holdTimer = 0;
  let tickTimer = 0;

  const render = () => {
    const d = new Date(now());
    label.textContent = showingDate ? formatDate(d) : formatTime(d);
  };

  // One timer per minute, aligned to the boundary — the classic clock ticked
  // ON the minute, not every N seconds from whenever the app booted. (Minute
  // boundaries are the same in every whole-minute UTC offset, so the epoch
  // remainder is the local one too.)
  const scheduleTick = () => {
    const delay = 60_000 - (now() % 60_000) + 20;
    tickTimer = setTimeout(() => {
      render();
      scheduleTick();
    }, delay);
  };

  const showTime = () => {
    clearTimeout(holdTimer);
    holdTimer = 0;
    showingDate = false;
    render();
  };

  /** @param {PointerEvent} e */
  const onPress = (e) => {
    // The primary button only, like the tool strip's cells: a right press is
    // no flip.
    if (e.button !== 0) return;
    // The bar's own title presses preventDefault too: no text-range
    // selection from a drag across the bar, and focus stays where it was —
    // the clock never took it.
    e.preventDefault();
    if (showingDate) {
      showTime();
      return;
    }
    showingDate = true;
    render();
    holdTimer = setTimeout(showTime, holdMs);
  };

  // A background tab throttles timers, so the pending tick can land late;
  // on return, catch the readout up at once rather than a minute behind.
  const onVisibility = () => {
    if (!document.hidden) render();
  };

  render();
  scheduleTick();
  label.addEventListener('pointerdown', onPress);
  document.addEventListener('visibilitychange', onVisibility);

  return {
    dispose() {
      clearTimeout(tickTimer);
      clearTimeout(holdTimer);
      label.removeEventListener('pointerdown', onPress);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
