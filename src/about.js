// The About box: Sprite Machine → About Sprite Machine…, and the greeting a
// load shows when it reopens no window, unless Show at startup is off. Show
// at startup is saved with the session on each toggle, since a click outside
// closes the box without OK. The version and date come from vite.config.js
// `define`.

/** The session key that holds Show at startup. */
export const GREET = 'greet';

/**
 * @param {HTMLElement} desktop
 * @param {import('vintage-frames/shell').ShellState} state
 */
export function initAbout(desktop, state) {
  /** @type {(() => void)[]} */
  const teardown = [];
  const $ = (sel) => {
    const el = desktop.querySelector(sel);
    if (!el) throw new Error(`about: missing element ${sel}`);
    return /** @type {any} */ (el);
  };
  const on = (el, type, fn) => {
    el.addEventListener(type, fn);
    teardown.push(() => el.removeEventListener(type, fn));
  };

  const dialog = $('#dlg-about');
  const greet = $('#about-greet');
  $('#about-version').textContent = `version ${__APP_VERSION__}`;
  $('#about-date').textContent = __APP_DATE__;
  const greets = () => state.get(GREET) !== false;
  const show = () => {
    greet.checked = greets();
    dialog.show();
  };
  on($('#menu-app'), 'vf-menu-select', (e) => {
    if (/** @type {CustomEvent} */ (e).detail.value !== 'about') return;
    if (!document.querySelector('vf-dialog[open]')) show();
  });
  on(greet, 'vf-change', (e) =>
    state.set(GREET, !!(/** @type {CustomEvent} */ (e).detail.checked))
  );
  on($('#btn-about-ok'), 'click', () => dialog.close());

  return {
    show,
    /** Whether a load that reopens no window shows the box. */
    greets,
    dispose() {
      for (const fn of teardown.splice(0)) fn();
    },
  };
}
