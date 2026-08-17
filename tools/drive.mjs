#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Interactive smoke test for the drawing editor, driven through headless Chrome
// over the DevTools Protocol.
//
// `tools/capture.sh` proves what the app LOOKS like; nothing there can click,
// drag, or type. This drives the running dev app with `Input.dispatchMouseEvent`
// / `Input.dispatchKeyEvent`, which produce *trusted* events — so pointer
// capture, focus delegation into `vf-*` shadow roots, the kit's menu press
// gesture and ⌘-key equivalents, and the composed-path guard that stops
// `B`/`R`/`G` from hijacking a focused text field all behave exactly as they
// do for a real user. Synthetic `dispatchEvent()` from page script would
// not: `setPointerCapture` throws on an inactive pointerId, and `isTrusted`
// checks and focus behaviour diverge.
//
// Usage:
//   npm run dev                 # in another shell
//   node tools/drive.mjs        # -> "N passed, 0 failed"; exit 1 on any failure
//   node tools/drive.mjs 5174   # non-default dev-server port
//
// Assumes the CAR sample at its shipped 40px tile: the texel coordinates below
// are picked off that art (a body pixel to eyedrop, an empty corner to rect into).
// The sm-* components render in SHADOW DOM, so every page-side probe goes
// through the shadow-piercing __q/__qa helpers (DEEP, below) instead of bare
// document.querySelector — the `.editor-*` class names and `vf-*` tags it
// asserts on live inside those roots.
//
// PROCESS HYGIENE, same concern as capture.sh: an agent harness may SIGKILL this
// script, and SIGKILL cannot be trapped, so `finally` is not enough. Three
// layers: the normal exit path reaps; SIGINT/SIGTERM reap; and a DETACHED
// watchdog reaps this run's Chrome + temp dir after a deadline even if this
// process dies uncatchably. The profile lives at `/tmp/cr-cap/run.drive.XXXXXX`,
// under capture.sh's own root and matching its `run.*` glob, so
// `tools/capture.sh clean` sweeps it up too.
//
// TWO TRAPS, learned the hard way — read before adding checks:
//   1. Headless Chrome intermittently RELOADS the page mid-run under synthesized
//      input (it does so on any build; it is not app behaviour). A reload wipes
//      tool / ink / recency, which reads as a pile of false failures. Every probe
//      re-checks a `window.__stamp` and reports the reload, and each section that
//      asserts carried state starts from a deliberate fresh load.
//   2. Erasing part of FRONT does NOT lower the voxel count — opposite views are
//      plane-UNIONed by the carve, so BACK still covers the silhouette. What moves
//      is the surface colouring and with it the triangle count, so the live-rebuild
//      check asserts on the whole stats readout, not on `voxels`.
//   3. Once a stroke has landed, every navigation trips the app's dirty-document
//      beforeunload guard — a confirm dialog headless Chrome parks on FOREVER
//      unless answered. The message handler auto-accepts Page.javascriptDialogOpening.
//      Relatedly: repeated chorded drags (Shift-locked rects, right-button drags)
//      can wedge the headless renderer outright — those semantics stay covered by
//      the Node suites and docs/SMOKE-TEST.md instead.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const APP_PORT = process.argv[2] || '5173';
const DBG_PORT = +(process.env.DRIVE_DEBUG_PORT || 9333);
const DEADLINE = +(process.env.DRIVE_DEADLINE || 240); // watchdog seconds
const CHROME =
  process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = '/tmp/cr-cap'; // shared with capture.sh so its `clean` reaps us too
const URL = `http://localhost:${APP_PORT}/?sample=car&edit=front&rotate=0`;

if (!existsSync(CHROME)) {
  console.error(`Chrome not found at: ${CHROME} (set $CHROME)`);
  process.exit(3);
}
mkdirSync(ROOT, { recursive: true });
const userDir = mkdtempSync(join(ROOT, 'run.drive.'));

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--hide-scrollbars',
    // Same viewport + scale as capture.sh, so the texel coordinates below land
    // on the same pixels a screenshot would show.
    '--window-size=1000,850',
    '--force-device-scale-factor=1',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${DBG_PORT}`,
    `--user-data-dir=${userDir}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

// Detached watchdog: survives a SIGKILL of this process and guarantees the run
// is reaped. Cancelled on the normal path.
const watchdog = spawn(
  'sh',
  ['-c', `sleep ${DEADLINE}; pkill -9 -f "${userDir}" 2>/dev/null; rm -rf "${userDir}"`],
  { detached: true, stdio: 'ignore' }
);
watchdog.unref();

let reaped = false;
function reap() {
  if (reaped) return;
  reaped = true;
  chrome.kill('SIGKILL');
  try {
    watchdog.kill();
  } catch {}
  try {
    rmSync(userDir, { recursive: true, force: true });
  } catch {}
}
process.on('SIGINT', () => {
  reap();
  process.exit(130);
});
process.on('SIGTERM', () => {
  reap();
  process.exit(143);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- CDP transport ----------------------------------------------------------
let ws;
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error('page threw: ' + (d.exception?.description || d.text));
  }
  return r.result.value;
}

// --- synthesized input ------------------------------------------------------
const NAMED_KEYS = {
  Escape: { key: 'Escape', code: 'Escape', vk: 27, text: '' },
  Shift: { key: 'Shift', code: 'ShiftLeft', vk: 16, text: '' },
  Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8, text: '' },
};

// A key descriptor: named keys from the table, or any single printable char.
// `text` is what makes it a typing key — CDP needs `keyDown` with text for those
// and `rawKeyDown` for the rest.
function keyDesc(name) {
  if (NAMED_KEYS[name]) return NAMED_KEYS[name];
  if (name.length !== 1) throw new Error(`unknown key: ${name}`);
  const upper = name.toUpperCase();
  const code = /[A-Z]/.test(upper)
    ? `Key${upper}`
    : /[0-9]/.test(name)
      ? `Digit${name}`
      : '';
  return { key: name, code, vk: upper.charCodeAt(0), text: name };
}

const keyEvent = (type, k, modifiers) =>
  send('Input.dispatchKeyEvent', {
    type,
    key: k.key,
    code: k.code,
    windowsVirtualKeyCode: k.vk,
    nativeVirtualKeyCode: k.vk,
    ...(type === 'keyUp' ? {} : { text: k.text }),
    modifiers,
  });

const keyDown = (name, modifiers = 0) => {
  const k = keyDesc(name);
  // A ⌘/⌃ chord is a shortcut, not typing — rawKeyDown, so the browser never
  // inserts the letter into a focused field.
  const typing = k.text && !(modifiers & (CTRL | META));
  return keyEvent(typing ? 'keyDown' : 'rawKeyDown', k, modifiers);
};
const keyUp = (name, modifiers = 0) => keyEvent('keyUp', keyDesc(name), modifiers);

async function keyPress(name, modifiers = 0) {
  await keyDown(name, modifiers);
  await keyUp(name, modifiers);
}

async function typeText(str) {
  for (const ch of str) await keyPress(ch);
}

// Modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8.
const ALT = 1;
const CTRL = 2;
const META = 4;
const SHIFT = 8;

async function mouse(type, x, y, { button = 'left', buttons = 1, modifiers = 0 } = {}) {
  await send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: type === 'mouseMoved' && buttons === 0 ? 'none' : button,
    buttons,
    clickCount: type === 'mouseMoved' ? 0 : 1,
    modifiers,
  });
}

async function click(x, y, opts = {}) {
  await mouse('mousePressed', x, y, opts);
  await mouse('mouseReleased', x, y, { ...opts, buttons: 0 });
}

// A real double-click: the second press/release pair carries clickCount 2, so
// the browser synthesizes dblclick (what vf-icon's open gesture listens for).
async function dblclick(x, y) {
  await mouse('mousePressed', x, y, {});
  await mouse('mouseReleased', x, y, { buttons: 0 });
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 2,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 2,
  });
}

// Press, drag, release — the gesture the rect tool and a pencil stroke need.
// button/buttons override for the right-button drag (the rect-erase gesture).
async function drag(
  a,
  b,
  { modifiers = 0, beforeRelease, button = 'left', buttons = 1 } = {}
) {
  await mouse('mousePressed', a.x, a.y, { modifiers, button, buttons });
  await mouse('mouseMoved', b.x, b.y, { buttons, modifiers, button });
  if (beforeRelease) await beforeRelease();
  await mouse('mouseReleased', b.x, b.y, { buttons: 0, modifiers, button });
}

// --- assertions -------------------------------------------------------------
let passed = 0;
const failures = [];
function check(name, ok, extra = '') {
  const detail = extra ? ` — ${extra}` : '';
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name + detail);
    console.log(`  FAIL ${name}${detail}`);
  }
}
const section = (title) => console.log(`\n[${title}]`);

// --- shadow-piercing queries -------------------------------------------------
// The sm-* components render in shadow DOM, so document.querySelector can't
// see the editor's internals. Every page-side expression inlines these
// helpers: __qa runs the selector inside the document AND inside every open
// shadow root (both ends of a descendant selector must share one root — true
// for every probe below); __q takes the first hit. Inlined per-expression, so
// the headless mid-run reload can never wipe an installed helper.
const DEEP = `
  const __qa = (sel, root = document) => {
    const out = [];
    const walk = (r) => {
      for (const el of r.querySelectorAll(sel)) out.push(el);
      for (const el of r.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(root);
    return out;
  };
  const __q = (sel, root = document) => __qa(sel, root)[0] || null;
  // The document window under test: the ACTIVE one, else the last-created
  // (document windows are dynamic now — one per open document, id
  // win-doc-<key>). __qd scopes an editor-internals query to it, so a probe
  // in a two-document session reads the right canvas.
  const __doc = () => {
    const wins = [...document.querySelectorAll('vf-window')].filter((w) =>
      w.id.startsWith('win-doc-'));
    return wins.find((w) => w.hasAttribute('active')) || wins[wins.length - 1] || null;
  };
  const __qd = (sel) => { const d = __doc(); return d ? __q(sel, d) : null; };
`;

// --- page probes ------------------------------------------------------------
// One round trip that reads everything the checks below assert on, so a probe is
// a consistent snapshot rather than a series of racing reads.
const PROBE = `(() => {${DEEP}
  const tools = {};
  for (const b of __qa('.editor-tool')) {
    tools[b.getAttribute('aria-label')] = b.classList.contains('active');
  }
  const sw = __q('.editor-selected');
  // Null-safe: with every document closed (the quit cascade's end state)
  // there is no editor at all — the canvas-derived fields read empty.
  const canvas = __qd('.editor-canvas');
  const r = canvas
    ? canvas.getBoundingClientRect()
    : { left: 0, top: 0, width: 0, height: 0 };
  const checked = __q('vf-radio[checked]');
  // The 3D View's status line: "grid 40px · voxels 4950 · tris 1784" (or a
  // ⚠-prefixed error/warning) — parsed back into a stats map.
  const buildLine = (() => {
    const el = __q('sm-status-line[kind="build"]');
    return el && el.shadowRoot ? el.shadowRoot.textContent.trim() : '';
  })();
  const stats = {};
  for (const m of buildLine.matchAll(/(grid|voxels|tris) ([^·]+)/g)) {
    stats[m[1]] = m[2].trim();
  }
  // The Colors dialog lives in <sm-color-picker>'s shadow root — the desktop's
  // own dialogs (About, Open, …) are separate light-DOM vf-dialogs.
  const picker = __q('sm-color-picker');
  const colorsDialog =
    picker && picker.shadowRoot ? picker.shadowRoot.querySelector('vf-dialog') : null;
  return {
    // All five tools are mutually exclusive sticky modes — exactly one cell is
    // lit. The eyedropper is listed LAST so a drawing-tool cell wrongly left
    // active alongside it would win the find and fail the tool checks.
    drawTool:
      ['pencil', 'rectangle', 'fill', 'eraser', 'eyedropper'].find((t) => tools[t]) ||
      null,
    inkColor: sw ? sw.getAttribute('color') : null,
    recent: __qa('.editor-recent vf-swatch').map((s) => s.getAttribute('color')),
    // The options strip IS <sm-tool-options>; its shadow root holds the bare
    // controls. Null-safe: the strip renders EMPTY while the app is
    // deactivated (desktop focus), so the element may not exist at probe time.
    opts: (() => {
      const o = __q('sm-tool-options');
      return o ? [...o.shadowRoot.children].map((c) => c.tagName.toLowerCase()) : null;
    })(),
    // The strip's trailing readout ("N px" for the size sliders) — how the checks
    // see a slider's value without reaching into the kit's internals.
    optsReadout: (() => {
      const o = __q('sm-tool-options');
      if (!o) return null;
      const ls = o.shadowRoot.querySelectorAll('vf-label');
      return ls.length ? ls[ls.length - 1].textContent.trim() : null;
    })(),
    face: __qd('.editor-face-picker')?.value ?? null,
    checkedRadio: checked ? checked.getAttribute('value') : null,
    heading: __doc() ? __doc().heading : '',
    tileStatus: (() => {
      const el = __qd('sm-status-line[kind="tile"]');
      return el && el.shadowRoot ? el.shadowRoot.textContent.trim() : '';
    })(),
    colorsOpen: !!(colorsDialog && colorsDialog.open),
    anyModalOpen: !!__q('vf-dialog[open]') || !!(colorsDialog && colorsDialog.open),
    // The kit's page-drawn cursor claims the crosshair over the pixel canvas.
    cursorClaim: canvas ? canvas.getAttribute('data-vf-cursor') : null,
    rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    tileW: canvas ? canvas.width : 0,
    buildLine,
    stats,
    voxels: +(stats.voxels || 0),
    docIcons: __qa('vf-icon').filter((i) => (i.dataset.key || '').startsWith('doc:'))
      .length,
    windows: {
      document: !!__doc() && !__doc().hidden,
      tools: !__q('#win-tools').hidden,
      sprite: !__q('#win-sprite').hidden,
      stage: !__q('#win-stage').hidden,
    },
    // How many document windows are open (one per open document).
    docWindows: [...document.querySelectorAll('vf-window')].filter((w) =>
      w.id.startsWith('win-doc-')).length,
    // The focus model: whether a document window holds the active state
    // (appActive's visible half), and whether the options strip is showing
    // its blank deactivated face.
    docActive: !!__doc() && __doc().hasAttribute('active'),
    optionsBlank: !__q('sm-tool-options'),
    // Enabled states for the focus-gated menu grammar (the Finder role).
    menuEnabled: {
      newDoc: !__q('vf-menu-item[value="new"]').disabled,
      open: !__q('vf-menu-item[value="open"]').disabled,
      save: !__q('vf-menu-item[value="save"]').disabled,
      close: !__q('vf-menu-item[value="close"]').disabled,
      pickColor: !__q('vf-menu-item[value="pick-color"]').disabled,
      grid: !__q('vf-menu-item[value="show-grid"]').disabled,
      toolPencil: !__q('vf-menu-item[value="tool-pencil"]').disabled,
      viewSprite: !__q('vf-menu-item[value="view-sprite"]').disabled,
    },
    menuChecks: {
      sprite: __q('vf-menu-item[value="view-sprite"]').checked,
      stage: __q('vf-menu-item[value="view-stage"]').checked,
      tools: __q('vf-menu-item[value="view-tools"]').checked,
      grid: __q('vf-menu-item[value="show-grid"]').checked,
      // The Tools menu's checked tool item, sans its 'tool-' prefix. Exactly
      // one must be checked (the sticky mode) — any other count reads '!N',
      // so a stuck double-check fails the tool checks instead of hiding.
      tool: (() => {
        const on = __qa('vf-menu-item').filter(
          (i) => i.checked && (i.getAttribute('value') || '').startsWith('tool-')
        );
        return on.length === 1
          ? on[0].getAttribute('value').slice('tool-'.length)
          : '!' + on.length;
      })(),
      undoEnabled: !__q('vf-menu-item[value="undo"]').disabled,
      redoEnabled: !__q('vf-menu-item[value="redo"]').disabled,
    },
    stamp: window.__stamp || 'RELOADED',
  };
})()`;

let reloads = 0;
async function probe() {
  let s;
  for (let attempt = 0; ; attempt++) {
    try {
      s = await evaluate(PROBE);
      break;
    } catch (err) {
      // The headless reload can land DURING a probe: the page is mid-navigation,
      // `.editor-canvas` is null, and the probe throws. That is the same artifact
      // the __stamp check reports, just caught earlier — wait the app back in and
      // retry instead of crashing the run. (waitForApp re-stamps, so count it here.)
      if (attempt >= 3) throw err;
      reloads++;
      console.log('  !!   page reloaded mid-probe (headless artifact) — waiting');
      await waitForApp();
    }
  }
  if (s.stamp === 'RELOADED') {
    reloads++;
    console.log('  !!   page reloaded (headless artifact) — re-stamping');
    await evaluate(`window.__stamp = 'S'`);
  }
  return s;
}

// One texel of the ACTIVE document's live pixel canvas, as [r,g,b,a].
const texelAt = (px, py) =>
  evaluate(`(() => {${DEEP}
    const c = __qd('.editor-canvas');
    const d = c.getContext('2d').getImageData(${px}, ${py}, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  })()`);

// True when every texel of a layer (in the active document's editor) is
// fully transparent.
const layerIsEmpty = (sel) =>
  evaluate(`(() => {${DEEP}
    const c = __qd('${sel}');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
    return true;
  })()`);

// The viewport rect of an element, and its centre — how a click finds a control.
const centreOf = (sel) =>
  evaluate(`(() => {${DEEP}
    const r = __q('${sel}').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);

// Texel -> viewport px (the centre of that texel).
const texelPos = (rect, tile, px, py) => ({
  x: rect.left + ((px + 0.5) * rect.width) / tile,
  y: rect.top + ((py + 0.5) * rect.height) / tile,
});

const hex = ([r, g, b]) =>
  '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');

const APP_READY = `(() => {${DEEP}
  const build = __q('sm-status-line[kind="build"]');
  return !!(__q('.editor-canvas') && build && build.shadowRoot &&
    build.shadowRoot.textContent.includes('voxels'));
})()`;

async function waitForApp() {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(APP_READY).catch(() => false)) break;
    await sleep(200);
  }
  await sleep(400);
  await evaluate(`window.__stamp = 'S'`);
}

async function freshPage() {
  await send('Page.navigate', { url: URL });
  await waitForApp();
}

// --- the run ----------------------------------------------------------------
async function main() {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`http://127.0.0.1:${DBG_PORT}/json/list`);
      break;
    } catch {
      await sleep(200);
    }
  }
  const target = await fetch(
    `http://127.0.0.1:${DBG_PORT}/json/new?${encodeURIComponent(URL)}`,
    { method: 'PUT' }
  ).then((r) => r.json());

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  // A dropped connection (Chrome crash, watchdog kill) would otherwise leave
  // every pending send() unresolved and the run exiting silently mid-section.
  ws.addEventListener('close', () => {
    const err = new Error('CDP connection closed (Chrome went away mid-run)');
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Page.frameNavigated' && !msg.params.frame.parentId) {
      console.log('  ..   [navigated]', msg.params.frame.url);
    }
    if (msg.method === 'Page.javascriptDialogOpening') {
      // The app's dirty-document beforeunload guard raises a confirm on every
      // freshPage once a stroke has landed; unanswered it wedges navigation
      // forever in headless. Accept and move on.
      send('Page.handleJavaScriptDialog', { accept: true });
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      console.log(
        '  !!   [page error]',
        (d.exception?.description || d.text).slice(0, 300)
      );
    }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await waitForApp();

  let s = await probe();
  const TILE = s.tileW;
  const at = (px, py) => texelPos(s.rect, TILE, px, py);

  // Pick one item from a menu-bar menu with real pointer input: a quick tap
  // on the menu's bar title opens the panel and leaves it open (the kit's
  // press gesture), then a click on the item runs its ~250ms blink before
  // vf-menu-select fires — hence the generous settle.
  async function pickMenu(menuSel, itemValue) {
    const m = await centreOf(menuSel);
    await click(m.x, m.y);
    await sleep(250);
    const it = await centreOf(`vf-menu-item[value="${itemValue}"]`);
    await click(it.x, it.y);
    await sleep(650);
  }

  section(`boot — face=${s.face} tile=${TILE}px`);
  check('boots with the pencil active', s.drawTool === 'pencil', s.drawTool);
  check(
    'the pixel canvas claims the kit crosshair cursor',
    s.cursorClaim === 'crosshair',
    s.cursorClaim
  );
  check(
    'the options strip shows the pencil slider',
    s.opts.join(',') === 'vf-slider,vf-label'
  );
  check('face picker reflects ?edit=front', s.face === 'front', s.face);
  check('the checked radio follows the face', s.checkedRadio === 'front');
  check('the document window is titled for the sample', s.heading === 'Car', s.heading);
  check(
    'the document status bar reads the tile size',
    s.tileStatus === `${TILE}px x ${TILE}px`,
    s.tileStatus
  );
  check(
    'all four desktop windows are open',
    Object.values(s.windows).every(Boolean),
    JSON.stringify(s.windows)
  );
  check('stats read out a build', s.voxels > 0, s.buildLine);

  // --- keyboard tool switching ----------------------------------------------
  section('keys');
  await keyPress('r');
  s = await probe();
  check('R selects the rect tool', s.drawTool === 'rectangle', s.drawTool);
  check(
    'rect options are the radius field',
    s.opts.join(',') === 'vf-label,vf-number-field',
    s.opts.join(',')
  );

  // The kit hosts its <input> in shadow DOM, so the tool-shortcut guard has to
  // read the composed path — a retargeted document-level check would let this
  // through. The radius field is the strip's always-mounted text input.
  await evaluate(
    `(() => {${DEEP} __q('sm-tool-options').shadowRoot
        .querySelector('vf-number-field').shadowRoot.querySelector('input').focus(); })()`
  );
  await keyPress('g');
  s = await probe();
  check(
    'a letter typed in the radius field does not switch tools',
    s.drawTool === 'rectangle',
    s.drawTool
  );
  await evaluate(`(() => { let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    if (a) a.blur(); })()`);

  await keyPress('g');
  s = await probe();
  check('G selects the fill tool', s.drawTool === 'fill', s.drawTool);
  check(
    'fill options are the two checkboxes',
    s.opts.join(',') === 'vf-checkbox,vf-checkbox',
    s.opts.join(',')
  );

  await keyPress('i');
  s = await probe();
  check('I selects the eyedropper tool', s.drawTool === 'eyedropper', s.drawTool);
  check(
    'the eyedropper has an empty options strip',
    s.opts.length === 0,
    s.opts.join(',')
  );

  await keyPress('e');
  s = await probe();
  check('E selects the eraser tool', s.drawTool === 'eraser', s.drawTool);
  check(
    'eraser options are its own size slider',
    s.opts.join(',') === 'vf-slider,vf-label',
    s.opts.join(',')
  );
  check(
    'the eraser leaves the ink swatch solid',
    /^#[0-9a-f]{6}$/.test(s.inkColor || ''),
    s.inkColor
  );

  // The eraser's tip size is its OWN persisted setting: click mid-track to
  // drive its slider, flip back to the pencil, and the pencil's size must be
  // untouched (both boot at 1 px).
  const eraserSlider = await centreOf('.editor-size-slider');
  await click(eraserSlider.x, eraserSlider.y);
  await sleep(150);
  s = await probe();
  check(
    "the eraser slider drives the eraser's size",
    /^\d+ px$/.test(s.optsReadout || '') && s.optsReadout !== '1 px',
    s.optsReadout
  );

  await keyPress('b');
  s = await probe();
  check('B returns to the pencil', s.drawTool === 'pencil', s.drawTool);
  check(
    "…whose own size the eraser's slider did not touch",
    s.optsReadout === '1 px',
    s.optsReadout
  );

  // --- pencil ---------------------------------------------------------------
  section('pencil');
  await drag(at(2, 2), at(6, 2));
  await sleep(200);
  const strokeStart = await texelAt(2, 2);
  const strokeEnd = await texelAt(6, 2);
  check(
    'a drag paints the whole Bresenham run',
    strokeStart[3] === 255 && strokeEnd[3] === 255,
    `start=${strokeStart} end=${strokeEnd}`
  );

  // --- eyedropper + recency -------------------------------------------------
  section('eyedropper');
  const inkAtBoot = (await probe()).inkColor;
  await click(at(20, 26).x, at(20, 26).y, { modifiers: ALT });
  await sleep(150);
  s = await probe();
  check(
    'Alt-click samples the sprite into the ink',
    s.inkColor !== inkAtBoot && /^#[0-9a-f]{6}$/.test(s.inkColor || ''),
    `${inkAtBoot} → ${s.inkColor}`
  );
  // Recency slot 0 IS the current ink (the big swatch shows it), so the
  // "last used" row only fills from the second pick on.
  const firstInk = s.inkColor;
  check('one pick leaves the last-used row empty', s.recent.length === 0);

  let secondInk = null;
  for (const [px, py] of [
    [20, 20],
    [16, 30],
    [12, 24],
    [24, 18],
  ]) {
    const t = await texelAt(px, py);
    if (t[3] === 255 && hex(t) !== firstInk) {
      await click(at(px, py).x, at(px, py).y, { modifiers: ALT });
      await sleep(150);
      secondInk = hex(t);
      break;
    }
  }
  s = await probe();
  check(
    'a second pick pushes the first into the last-used row',
    s.inkColor === secondInk && s.recent.length === 1 && s.recent[0] === firstInk,
    `ink=${s.inkColor}/${secondInk} row=${JSON.stringify(s.recent)}`
  );

  // The eyedropper TOOL (vs the momentary Alt-hold above) is sticky: a plain
  // click samples, and the tool stays selected for the next sample.
  await keyPress('i');
  await click(at(20, 26).x, at(20, 26).y);
  await sleep(150);
  s = await probe();
  check(
    'a click with the eyedropper tool samples the ink',
    s.inkColor === firstInk,
    `${s.inkColor} vs ${firstInk}`
  );
  check(
    'the eyedropper stays selected after the sample',
    s.drawTool === 'eyedropper',
    s.drawTool
  );

  // --- rect: drag commit + Esc cancel ---------------------------------------
  // Kept to the two gesture-shaped checks headless Chrome runs reliably under
  // the desktop shell; the Shift square-lock and right-drag-erase SEMANTICS
  // are pinned in Node (test/rect.test.mjs, test/brush.test.mjs) and in the
  // manual guide (docs/SMOKE-TEST.md) — repeated synthesized chord-drags here
  // wedge the headless renderer.
  section('rect');
  await keyPress('r');
  await drag(at(30, 4), at(34, 8), { beforeRelease: () => keyPress('Escape') });
  await sleep(150);
  const escaped = await texelAt(32, 6);
  check('Esc mid-drag writes nothing', escaped[3] === 0, `texel=${escaped}`);

  await drag(at(30, 4), at(34, 8));
  await sleep(200);
  const committed = await texelAt(32, 6);
  check('a plain drag commits the box', committed[3] === 255, `texel=${committed}`);

  // --- an edit must reach the voxel pipeline --------------------------------
  // Fresh load first: the headless reload artifact reliably strikes right after
  // the preceding Shift-drag, and this section carries tool + ink state across
  // several inputs — the same reason the face-swap section starts fresh.
  section('live rebuild');
  await freshPage();
  s = await probe();
  const statsBefore = JSON.stringify(s.stats);
  await keyPress('e'); // eraser tool
  await drag(at(8, 14), at(32, 34));
  await sleep(500);
  s = await probe();
  // (20,24) sits exactly on the Bresenham run from (8,14) to (32,34).
  const erased = await texelAt(20, 24);
  check('an eraser drag clears the stroked texels', erased[3] === 0, `${erased}`);
  check(
    'the erase reaches the voxel pipeline (mesh rebuilt)',
    JSON.stringify(s.stats) !== statsBefore,
    `${statsBefore} → ${JSON.stringify(s.stats)}`
  );

  // --- a face swap carries the whole brush ----------------------------------
  section('face swap');
  await freshPage();
  s = await probe();
  await click(at(20, 26).x, at(20, 26).y, { modifiers: ALT });
  await sleep(150);
  await click(at(20, 20).x, at(20, 20).y, { modifiers: ALT });
  await sleep(150);
  await keyPress('g'); // fill tool, so we can watch it survive
  s = await probe();
  const rowBeforeSwap = s.recent.length;
  const inkBeforeSwap = s.inkColor;
  const topRadio = await centreOf('vf-radio[value="top"]');
  await click(topRadio.x, topRadio.y);
  await sleep(500);
  s = await probe();
  check('clicking a face radio switches the edited face', s.face === 'top', s.face);
  check('the selected-face dither follows', s.checkedRadio === 'top', s.checkedRadio);
  check('the tool survives the face swap', s.drawTool === 'fill', s.drawTool);
  check('the ink survives the face swap', s.inkColor === inkBeforeSwap);
  check(
    'the last-used row survives the face swap',
    rowBeforeSwap >= 1 && s.recent.length === rowBeforeSwap,
    `${rowBeforeSwap} → ${s.recent.length}`
  );

  // --- Properties: the relocated tile stepper --------------------------------
  // The tile-size field lives in File → Properties now; the whole flow runs
  // on real menu + dialog input.
  section('properties');
  await freshPage();
  await pickMenu('#menu-file', 'properties');
  const props = await evaluate(`(() => {${DEEP} return {
    open: __q('#dlg-props').open,
    name: __q('#props-name').textContent.trim(),
    dims: __q('#props-dims').textContent.trim(),
    tile: __q('#props-tile').value,
  }; })()`);
  check('File → Properties opens the dialog', props.open === true);
  check('…showing the document name', props.name === 'Car', props.name);
  check('…and the atlas dimensions', props.dims.includes('120px'), props.dims);
  check('…and the tile size', props.tile === String(TILE), props.tile);
  // Click the stepper's up arrow: a centered, registration-preserving resize
  // applied live behind the modal. Autorepeat can land more than one step, so
  // assert direction, not delta.
  const stepper = await evaluate(
    `(() => {${DEEP} const st = __q('#props-tile')
        .shadowRoot.querySelector('[part="stepper"]').getBoundingClientRect();
      return { x: st.left + st.width / 2, y: st.top + st.height * 0.25 }; })()`
  );
  await click(stepper.x, stepper.y);
  await sleep(700);
  s = await probe();
  const steppedTile = s.tileW;
  check('the stepper resizes the tile', steppedTile > TILE, `tileW=${steppedTile}`);
  check(
    'the document status bar follows',
    s.tileStatus === `${steppedTile}px x ${steppedTile}px`,
    s.tileStatus
  );
  check('the editor stays on its face', s.face === 'front', s.face);
  // Typed entry commits too (real keystrokes — a programmatic value write
  // races the field's own bindings).
  await evaluate(
    `(() => {${DEEP} __q('#props-tile').shadowRoot.querySelector('input').focus(); })()`
  );
  await keyPress('Backspace');
  await keyPress('Backspace');
  await typeText('24');
  await keyPress('Enter');
  await sleep(700);
  s = await probe();
  check('typing a tile size commits it', s.tileW === 24, `tileW=${s.tileW}`);
  const propsOk = await centreOf('#btn-props-ok');
  await click(propsOk.x, propsOk.y);
  await sleep(300);
  // Both resizes recorded whole-atlas undo entries: ⌘Z returns to the
  // stepped size (the typed 24 rolls back).
  await keyPress('z', META);
  await sleep(700);
  s = await probe();
  check(
    '⌘Z undoes the typed resize back to the stepped size',
    s.tileW === steppedTile,
    `tileW=${s.tileW} vs ${steppedTile}`
  );

  // --- one element, one dialog, ever ----------------------------------------
  section('persistent element');
  await freshPage();
  const inkSwatch = await centreOf('.editor-selected');
  await click(inkSwatch.x, inkSwatch.y);
  await sleep(400);
  await evaluate(
    `(() => {${DEEP} __q('sm-color-picker').shadowRoot.querySelector('vf-dialog').close(); })()`
  );
  await sleep(300);
  for (const face of ['top', 'back', 'left']) {
    const p = await centreOf(`vf-radio[value="${face}"]`);
    await click(p.x, p.y);
    await sleep(400);
  }
  s = await probe();
  const counts = await evaluate(
    `(() => {${DEEP}
      return { editors: __qa('sm-editor').length,
        dialogs: __q('sm-color-picker').shadowRoot.querySelectorAll('vf-dialog').length,
        cells: __qa('.editor-picker-grid vf-swatch').length,
        canvases: __qa('.editor-canvas').length }; })()`
  );
  check('three face swaps reuse ONE element', counts.editors === 1, `${counts.editors}`);
  check(
    'the picker dialog is built once, ever',
    counts.dialogs === 1,
    `${counts.dialogs}`
  );
  check('the picker keeps its 256 cells', counts.cells === 256, `${counts.cells}`);
  check(
    'one pixel canvas, not one per swap',
    counts.canvases === 1,
    `${counts.canvases}`
  );
  check('the face swaps landed', s.face === 'left', s.face);

  // --- mirror-derived face lifecycle ----------------------------------------
  // The car sample draws every face but RIGHT, so `right` opens derived: an empty
  // canvas over the faded mirror of LEFT.
  section('derived face');
  await freshPage();
  const gotoFace = async (face) => {
    const p = await centreOf(`vf-radio[value="${face}"]`);
    await click(p.x, p.y);
    await sleep(450);
    return probe();
  };
  const canvasEmpty = () => layerIsEmpty('.editor-canvas');
  const onionSkinShowing = async () => !(await layerIsEmpty('.editor-canvas-bg'));

  s = await gotoFace('right');
  check('a mirror-derived face opens with an empty canvas', await canvasEmpty());
  check('…over the faded onion-skin of its opposite', await onionSkinShowing());

  await gotoFace('front');
  s = await gotoFace('right');
  check('leaving an untouched derived face keeps it derived', await canvasEmpty());

  await keyPress('b');
  await click(at(12, 12).x, at(12, 12).y);
  await sleep(300);
  check('painting a derived face writes a texel', (await texelAt(12, 12))[3] === 255);
  await gotoFace('front');
  s = await gotoFace('right');
  check(
    'the painted face keeps its own art across swaps',
    (await texelAt(12, 12))[3] === 255,
    `${await texelAt(12, 12)}`
  );

  await keyPress('e'); // eraser tool
  await click(at(12, 12).x, at(12, 12).y);
  await sleep(300);
  check('erasing the last texel blanks the face', await canvasEmpty());
  await gotoFace('front');
  await gotoFace('right');
  check(
    'a fully-erased face reverts to derived (empty over the onion-skin)',
    (await canvasEmpty()) && (await onionSkinShowing())
  );

  // --- the 256-colour dialog ------------------------------------------------
  // A synthesized mouse-up after a native modal closes is one of the states
  // that provokes the headless reload described in the header — every section
  // after this one starts from a deliberate fresh load.
  section('palette');
  await freshPage();
  s = await probe();
  // Eyedrop first, so the dialog pick has a predecessor to demote into the row.
  await click(at(20, 26).x, at(20, 26).y, { modifiers: ALT });
  await sleep(200);
  const inkBeforePalette = (await probe()).inkColor;
  const swatch = await centreOf('.editor-selected');
  await click(swatch.x, swatch.y);
  await sleep(400);
  s = await probe();
  check('clicking the ink swatch opens the Colors dialog', s.colorsOpen === true);
  const cell = await evaluate(
    `(() => {${DEEP} const cells = __qa('.editor-picker-grid vf-swatch');
      const c = cells[70]; const r = c.getBoundingClientRect();
      return { count: cells.length, x: r.left + r.width / 2, y: r.top + r.height / 2,
               color: c.getAttribute('color') }; })()`
  );
  check(
    'the dialog holds the full 256-colour palette',
    cell.count === 256,
    `${cell.count}`
  );
  await click(cell.x, cell.y);
  await sleep(400);
  s = await probe();
  check('picking a swatch closes the dialog', s.colorsOpen === false);
  check('picking a swatch becomes the ink', s.inkColor === cell.color, `${s.inkColor}`);
  check(
    'the previous ink drops into the last-used row',
    s.recent[0] === inkBeforePalette,
    `${JSON.stringify(s.recent)} vs ${inkBeforePalette}`
  );

  // --- desktop: the View menu ------------------------------------------------
  section('view menu');
  await freshPage();
  await pickMenu('#menu-view', 'view-sprite');
  s = await probe();
  check(
    'View → Sprite View hides the window and unchecks the item',
    s.windows.sprite === false && s.menuChecks.sprite === false,
    JSON.stringify({ win: s.windows.sprite, check: s.menuChecks.sprite })
  );
  await pickMenu('#menu-view', 'view-sprite');
  s = await probe();
  check(
    '…and a second pick brings it back',
    s.windows.sprite === true && s.menuChecks.sprite === true
  );
  await pickMenu('#menu-view', 'show-grid');
  s = await probe();
  check('View → Show Grid checks its item', s.menuChecks.grid === true);

  // --- desktop: the Tools menu ------------------------------------------------
  section('tools menu');
  await freshPage();
  s = await probe();
  check(
    'the Tools menu boots on the pencil',
    s.menuChecks.tool === 'pencil',
    s.menuChecks.tool
  );
  await pickMenu('#menu-tools', 'tool-eraser');
  s = await probe();
  check(
    'Tools → Eraser selects the tool and moves the checkmark',
    s.drawTool === 'eraser' && s.menuChecks.tool === 'eraser',
    JSON.stringify({ strip: s.drawTool, menu: s.menuChecks.tool })
  );
  await keyPress('r');
  s = await probe();
  check(
    'the R key moves the menu checkmark too',
    s.menuChecks.tool === 'rect',
    s.menuChecks.tool
  );
  await pickMenu('#menu-tools', 'view-tools');
  s = await probe();
  check(
    'Tools → Tools Palette hides the windoid and unchecks the item',
    s.windows.tools === false && s.menuChecks.tools === false,
    JSON.stringify({ win: s.windows.tools, check: s.menuChecks.tools })
  );
  await pickMenu('#menu-tools', 'view-tools');
  s = await probe();
  check(
    '…and a second pick brings it back',
    s.windows.tools === true && s.menuChecks.tools === true
  );

  // --- desktop: undo / redo ---------------------------------------------------
  section('undo / redo');
  await freshPage();
  s = await probe();
  check('Undo boots disabled', s.menuChecks.undoEnabled === false);
  await keyPress('b');
  await click(at(2, 2).x, at(2, 2).y);
  await sleep(400);
  check('the stroke landed', (await texelAt(2, 2))[3] === 255);
  s = await probe();
  check('a committed gesture enables Undo', s.menuChecks.undoEnabled === true);
  await keyPress('z', META);
  await sleep(700);
  check('⌘Z undoes the stroke', (await texelAt(2, 2))[3] === 0, `${await texelAt(2, 2)}`);
  await keyPress('z', META | SHIFT);
  await sleep(700);
  check('⇧⌘Z redoes it', (await texelAt(2, 2))[3] === 255, `${await texelAt(2, 2)}`);
  s = await probe();
  check(
    'menu enablement follows the stacks',
    s.menuChecks.undoEnabled === true && s.menuChecks.redoEnabled === false,
    JSON.stringify(s.menuChecks)
  );

  // --- desktop: window drag + grow box ---------------------------------------
  section('windows');
  await freshPage();
  const posBefore = await evaluate(
    `(() => {${DEEP} const w = __doc(); return { top: w.top, left: w.left }; })()`
  );
  const bar = await evaluate(
    `(() => {${DEEP} const r = __doc().getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 9 }; })()`
  );
  await mouse('mousePressed', bar.x, bar.y);
  await mouse('mouseMoved', bar.x + 20, bar.y + 12, { buttons: 1 });
  await mouse('mouseMoved', bar.x + 40, bar.y + 24, { buttons: 1 });
  await mouse('mouseReleased', bar.x + 40, bar.y + 24, { buttons: 0 });
  await sleep(300);
  const posAfter = await evaluate(
    `(() => {${DEEP} const w = __doc(); return { top: w.top, left: w.left }; })()`
  );
  check(
    'dragging the title bar moves the window',
    posAfter.left === posBefore.left + 40 && posAfter.top === posBefore.top + 24,
    JSON.stringify({ posBefore, posAfter })
  );

  const growPos = await evaluate(
    `(() => {${DEEP} const g = __q('#win-stage').shadowRoot
        .querySelector('[part="grow-box"]').getBoundingClientRect();
      return { x: g.left + g.width / 2, y: g.top + g.height / 2 }; })()`
  );
  const sizeBefore = await evaluate(
    `(() => {${DEEP} const w = __q('#win-stage');
      return { w: w.width, h: w.height, cw: __q('#viewport').clientWidth }; })()`
  );
  await mouse('mousePressed', growPos.x, growPos.y);
  await mouse('mouseMoved', growPos.x + 15, growPos.y + 10, { buttons: 1 });
  await mouse('mouseMoved', growPos.x + 30, growPos.y + 20, { buttons: 1 });
  await mouse('mouseReleased', growPos.x + 30, growPos.y + 20, { buttons: 0 });
  await sleep(400);
  const sizeAfter = await evaluate(
    `(() => {${DEEP} const w = __q('#win-stage');
      return { w: w.width, h: w.height, cw: __q('#viewport').clientWidth }; })()`
  );
  check(
    'the grow box resizes the 3D View window',
    sizeAfter.w === sizeBefore.w + 30 && sizeAfter.h === sizeBefore.h + 20,
    JSON.stringify({ sizeBefore, sizeAfter })
  );
  check(
    'the THREE canvas follows the resize',
    sizeAfter.cw > sizeBefore.cw,
    `${sizeBefore.cw} → ${sizeAfter.cw}`
  );

  // A raise makes vf-desktop re-order the slotted windows in the light DOM
  // (DOM order is kept in step with z-order), which disconnects + reconnects
  // every element inside the moved window. The canvases tear their
  // ResizeObservers down on disconnect, so they must rebuild them on
  // reconnect — the regression left the canvases blind to the grow box after
  // any raise. With the view windows on the UTILITY tier, raises re-order
  // within the windoid band: the sprite windoid boots below the tools
  // palette (slot order), so raising it moves its node. The single document
  // window's node never moves in this tier model — its grow check below is
  // the plain re-fit contract.
  const raise = async (id) => {
    const t = await evaluate(
      `(() => {${DEEP} const r = __q('${id}').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + 6 }; })()`
    );
    await click(t.x, t.y);
    await sleep(200);
  };
  // `grow('DOC', …)` targets the active document window (dynamic id).
  const grow = async (id, dx, dy) => {
    const g = await evaluate(
      `(() => {${DEEP} const w = '${id}' === 'DOC' ? __doc() : __q('${id}');
        const b = w.shadowRoot
          .querySelector('[part="grow-box"]').getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`
    );
    await mouse('mousePressed', g.x, g.y);
    await mouse('mouseMoved', g.x + Math.round(dx / 2), g.y + Math.round(dy / 2), {
      buttons: 1,
    });
    await mouse('mouseMoved', g.x + dx, g.y + dy, { buttons: 1 });
    await mouse('mouseReleased', g.x + dx, g.y + dy, { buttons: 0 });
    await sleep(300);
  };
  const atlasWidth = () =>
    evaluate(
      `(() => {${DEEP} return __q('sm-atlas-view').shadowRoot
          .querySelector('canvas').getBoundingClientRect().width; })()`
    );
  const drawWidth = () =>
    evaluate(
      `(() => {${DEEP} return __qd('.editor-canvas').getBoundingClientRect().width; })()`
    );
  const spriteMoved = await evaluate(
    `(() => {${DEEP}
      const before = [...document.querySelectorAll('vf-window')].map((w) => w.id);
      return before.indexOf('win-sprite') < before.indexOf('win-tools');
    })()`
  );
  await raise('#win-sprite');
  check(
    'raising the sprite windoid re-orders the windoid band in the DOM',
    spriteMoved &&
      (await evaluate(
        `(() => {${DEEP}
          const ids = [...document.querySelectorAll('vf-window')].map((w) => w.id);
          return ids.indexOf('win-sprite') > ids.indexOf('win-tools');
        })()`
      )),
    'sprite did not cross tools in the light DOM'
  );
  const atlasBefore = await atlasWidth();
  await grow('#win-sprite', 40, 60);
  const atlasAfter = await atlasWidth();
  check(
    'the sprite view re-fits after a raise re-orders the DOM',
    atlasAfter > atlasBefore,
    `${atlasBefore} → ${atlasAfter}`
  );
  // The document window was dragged +40/+24 above, which tucks its grow box
  // under the stage windoid (the utility tier floats over the document
  // tier). Pull it left first so the grow press lands on the box, not the
  // windoid above it.
  const docBar = await evaluate(
    `(() => {${DEEP} const r = __doc().getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 9 }; })()`
  );
  await mouse('mousePressed', docBar.x, docBar.y);
  await mouse('mouseMoved', docBar.x - 80, docBar.y, { buttons: 1 });
  await mouse('mouseReleased', docBar.x - 80, docBar.y, { buttons: 0 });
  await sleep(300);
  const drawBefore = await drawWidth();
  await grow('DOC', 96, 96);
  const drawAfter = await drawWidth();
  check(
    'the draw canvas re-fits when the grow box grows the document window',
    drawAfter > drawBefore,
    `${drawBefore} → ${drawAfter}`
  );

  // --- desktop: focus / deactivation ------------------------------------------
  // The two-role model: clicking the desktop's own surface is "clicking the
  // Finder" — the document window drops its active state, the utility
  // windoids hide (their View-menu intent preserved), the options strip
  // blanks, the bare-letter tool keys go inert, and the menus fall to the
  // Finder grammar (New always; Open only with an icon selected, acting on
  // it). Clicking back into the document window — or opening from an icon —
  // undoes all of it.
  section('focus / deactivation');
  await freshPage();
  s = await probe();
  check(
    'the app boots active: windoids up, document window active',
    s.docActive && s.windows.tools && s.windows.sprite && s.windows.stage,
    JSON.stringify({ docActive: s.docActive, windows: s.windows })
  );
  // A bare-desktop point, computed against the LIVE layout: earlier sections'
  // window drags persist through desktop-state, so no hardcoded point is safe.
  const bareSpot = () =>
    evaluate(`(() => {${DEEP}
      const boxes = [...document.querySelectorAll('vf-window, vf-icon')]
        .filter((el) => !el.hidden)
        .map((el) => el.getBoundingClientRect());
      for (let y = innerHeight - 40; y > 80; y -= 37) {
        for (let x = 40; x < innerWidth - 40; x += 37) {
          if (!boxes.some((b) =>
            x >= b.left - 6 && x <= b.right + 6 && y >= b.top - 6 && y <= b.bottom + 6
          )) return { x, y };
        }
      }
      return null;
    })()`);
  const BARE = await bareSpot();
  check('found a bare patch of desktop to click', !!BARE, JSON.stringify(BARE));
  await click(BARE.x, BARE.y);
  await sleep(300);
  s = await probe();
  check('a desktop click deactivates the document window', s.docActive === false);
  check(
    '…the utility windoids hide with the application',
    !s.windows.tools && !s.windows.sprite && !s.windows.stage && s.windows.document,
    JSON.stringify(s.windows)
  );
  check('…the options strip blanks', s.optionsBlank === true);
  check(
    '…the View-menu checkmarks keep the intent (wanted flags survive)',
    s.menuChecks.sprite && s.menuChecks.stage && s.menuChecks.tools,
    JSON.stringify(s.menuChecks)
  );
  check(
    '…the Finder menu grammar lands: New stays, the rest grey out',
    s.menuEnabled.newDoc === true &&
      s.menuEnabled.open === false &&
      s.menuEnabled.save === false &&
      s.menuEnabled.close === false &&
      s.menuEnabled.pickColor === false &&
      s.menuEnabled.grid === false &&
      s.menuEnabled.toolPencil === false &&
      s.menuEnabled.viewSprite === false,
    JSON.stringify(s.menuEnabled)
  );
  await keyPress('r');
  s = await probe();
  check('…the bare-letter tool keys are inert', s.drawTool === 'pencil', s.drawTool);
  // Selecting a desktop icon is still working in the Finder: Open comes
  // alive, aimed at the selection.
  const carIcon = await centreOf('vf-icon[data-key="sample:Car"]');
  await click(carIcon.x, carIcon.y);
  await sleep(300);
  s = await probe();
  check(
    'selecting an icon enables Open (the Finder grammar)',
    s.menuEnabled.open === true && s.docActive === false,
    JSON.stringify({ open: s.menuEnabled.open, docActive: s.docActive })
  );
  // ⌘O, not a menu-bar pick: the kit's vf-icon deselects on ANY outside
  // press, menu bar included — System 7's Finder kept the selection while a
  // menu was pulled, so that's an open kit ask (APP-IA-PLAN.md §3.1). The
  // key equivalent presses nothing, so the selection survives to be opened.
  await keyPress('o', META);
  await sleep(900);
  s = await probe();
  check(
    '⌘O opens the selection and reactivates the application',
    s.docActive === true && s.windows.tools && s.windows.sprite && s.windows.stage,
    JSON.stringify({ docActive: s.docActive, windows: s.windows })
  );
  // And the pointer path back in: deactivate again, then click the document
  // window — stripes and windoids return where they were.
  await click(BARE.x, BARE.y);
  await sleep(300);
  const docBarBack = await evaluate(
    `(() => {${DEEP} const r = __doc().getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 9 }; })()`
  );
  await click(docBarBack.x, docBarBack.y);
  await sleep(300);
  s = await probe();
  check(
    'clicking the document window reactivates: stripes and windoids return',
    s.docActive === true && s.windows.tools && s.windows.sprite && s.windows.stage,
    JSON.stringify({ docActive: s.docActive, windows: s.windows })
  );

  // --- desktop: multiple documents ---------------------------------------------
  // One document = one window: File → New opens a second window (staggered,
  // active); each document carries its own undo history and drives the
  // utility windows only while active; Close and Quit walk the dirty checks
  // per document (the System 7 cascade).
  section('multiple documents');
  await freshPage(); // the Car sample, one window
  s = await probe();
  check(
    'one document window at boot',
    s.docWindows === 1 && s.heading === 'Car',
    `${s.docWindows} windows, "${s.heading}"`
  );
  await pickMenu('#menu-file', 'new');
  s = await probe();
  check(
    'File → New opens a SECOND window, active and untitled',
    s.docWindows === 2 && s.docActive && s.heading === 'untitled',
    `${s.docWindows} windows, "${s.heading}"`
  );
  check('…the 3D view empties for the blank untitled', s.voxels === 0, s.buildLine);
  // Draw one texel in the untitled — ITS history, not Car's.
  const at2 = (px, py) => texelPos(s.rect, s.tileW, px, py);
  await keyPress('b');
  await click(at2(3, 3).x, at2(3, 3).y);
  await sleep(500);
  check('a stroke lands in the untitled document', (await texelAt(3, 3))[3] === 255);
  s = await probe();
  check(
    '…enables Undo for THIS document and rebuilds the stage from it',
    // A single face on a blank sheet builds ONE voxel with an
    // unconstrained-axis warning — and the warning replaces the stats in
    // the readout, so the ⚠ line IS the proof this doc reached the stage.
    s.menuChecks.undoEnabled === true && s.buildLine.includes('unconstrained'),
    JSON.stringify({ undo: s.menuChecks.undoEnabled, buildLine: s.buildLine })
  );
  // Switch back to Car by clicking its (still-exposed) title bar.
  const carBar = await evaluate(
    `(() => {${DEEP}
      const win = [...document.querySelectorAll('vf-window')]
        .find((w) => w.id.startsWith('win-doc-') && w.heading === 'Car');
      const r = win.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 9 }; })()`
  );
  await click(carBar.x, carBar.y);
  await sleep(400);
  s = await probe();
  check(
    'clicking the Car window activates it: title and undo enablement follow',
    s.heading === 'Car' && s.docWindows === 2 && s.menuChecks.undoEnabled === false,
    JSON.stringify({ heading: s.heading, undo: s.menuChecks.undoEnabled })
  );
  check(
    '…and the 3D View rebuilds the car (the stage follows the active document)',
    s.voxels > 100,
    s.buildLine
  );
  // Close the dirty untitled: activate it, File → Close, Don't Save. The
  // staggered untitled sits mostly UNDER the just-raised Car window, and the
  // utility windoids float over every document — so scan its whole box for
  // a point the browser confirms belongs to this window (elementFromPoint
  // retargets shadow parts to the host; a stray body click on a document
  // about to be discarded is harmless) and click there to activate it.
  const untitledBar = await evaluate(
    `(() => {${DEEP}
      const win = [...document.querySelectorAll('vf-window')]
        .find((w) => w.id.startsWith('win-doc-') && w.heading === 'untitled');
      const r = win.getBoundingClientRect();
      for (let y = r.top + 9; y < r.bottom - 6; y += 24) {
        for (let x = r.right - 8; x > r.left + 6; x -= 16) {
          const el = document.elementFromPoint(x, y);
          if (el === win || win.contains(el)) return { x, y };
        }
      }
      return null; })()`
  );
  check('found a visible patch of the untitled window', !!untitledBar);
  await click(untitledBar.x, untitledBar.y);
  await sleep(300);
  await pickMenu('#menu-file', 'close');
  await sleep(300);
  s = await probe();
  check(
    'closing the dirty untitled raises the unsaved-changes alert',
    s.anyModalOpen === true
  );
  const dont = await centreOf('#btn-unsaved-dont');
  await click(dont.x, dont.y);
  await sleep(500);
  s = await probe();
  check(
    "Don't Save closes the window; Car remains and takes the active state",
    s.docWindows === 1 && s.heading === 'Car' && s.docActive === true,
    JSON.stringify({ docWindows: s.docWindows, heading: s.heading })
  );
  // The quit cascade: a fresh dirty untitled, then Quit — Cancel aborts the
  // whole walk; a second Quit with Don't Save closes everything (the clean
  // Car goes silently) and leaves the bare desktop focused.
  await pickMenu('#menu-file', 'new');
  s = await probe();
  const at3 = (px, py) => texelPos(s.rect, s.tileW, px, py);
  await keyPress('b');
  await click(at3(2, 2).x, at3(2, 2).y);
  await sleep(400);
  await pickMenu('#menu-app', 'quit');
  await sleep(300);
  s = await probe();
  check('Quit walks into the dirty untitled: the alert is up', s.anyModalOpen === true);
  const cancelBtn = await centreOf('#btn-unsaved-cancel');
  await click(cancelBtn.x, cancelBtn.y);
  await sleep(300);
  s = await probe();
  check(
    'Cancel aborts the quit — both windows stay',
    s.docWindows === 2 && s.anyModalOpen === false,
    `${s.docWindows} windows`
  );
  await pickMenu('#menu-app', 'quit');
  await sleep(300);
  const dont2 = await centreOf('#btn-unsaved-dont');
  await click(dont2.x, dont2.y);
  await sleep(600);
  s = await probe();
  check(
    'Quit completes: every window closes and the desktop takes focus',
    s.docWindows === 0 &&
      s.docActive === false &&
      !s.windows.tools &&
      !s.windows.sprite &&
      !s.windows.stage,
    JSON.stringify({ docWindows: s.docWindows, windows: s.windows })
  );

  // --- desktop: save / open round-trip ---------------------------------------
  // The full persistence loop on real input: draw → ⌘S → name it → File → New
  // → double-click the saved doc's icon → the pixels come back. (IndexedDB is
  // fully available to headless Chrome; each run's profile starts empty.)
  section('save / open round-trip');
  await freshPage();
  s = await probe();
  check('a fresh profile has no saved-doc icons', s.docIcons === 0, `${s.docIcons}`);
  await keyPress('b');
  await click(at(1, 1).x, at(1, 1).y);
  await sleep(400);
  await keyPress('s', META);
  await sleep(800); // the menu blink, then the save prompt
  const nameOpen = await evaluate(`(() => {${DEEP} return __q('#dlg-name').open; })()`);
  check('⌘S raises the save-name prompt for an untitled doc', nameOpen === true);
  // Clear the prefilled name, then type the new one with real keystrokes.
  await evaluate(
    `(() => {${DEEP} const f = __q('#name-field'); f.value = '';
      f.shadowRoot.querySelector('input').focus(); })()`
  );
  await typeText('Test Doc');
  await keyPress('Enter');
  await sleep(900);
  s = await probe();
  check('the save titles the document window', s.heading === 'Test Doc', s.heading);
  check('a desktop icon appears for the saved doc', s.docIcons === 1, `${s.docIcons}`);
  await pickMenu('#menu-file', 'new');
  s = await probe();
  check('File → New opens a blank untitled', s.heading === 'untitled', s.heading);
  const blankTexel = await texelAt(1, 1);
  check('…with an empty canvas', blankTexel[3] === 0, `${blankTexel}`);
  const iconPos = await evaluate(
    `(() => {${DEEP}
      const i = __qa('vf-icon').find((el) => (el.dataset.key || '').startsWith('doc:'));
      const r = i.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 20 }; })()`
  );
  await dblclick(iconPos.x, iconPos.y);
  await sleep(1000);
  s = await probe();
  check(
    'double-clicking its icon re-opens the saved doc',
    s.heading === 'Test Doc',
    s.heading
  );
  const restored = await texelAt(1, 1);
  check('…with its pixels restored from storage', restored[3] === 255, `${restored}`);

  console.log(
    `\n${passed} passed, ${failures.length} failed` +
      (reloads ? `, ${reloads} headless page reload(s)` : '')
  );
  if (failures.length) {
    console.log('failures:');
    for (const f of failures) console.log('  - ' + f);
  }
  return failures.length;
}

let failed = 1;
try {
  failed = await main();
} catch (err) {
  console.error(`driver error: ${err.message}`);
  console.error(`(is the dev server up on :${APP_PORT}?  npm run dev)`);
} finally {
  reap();
}
process.exit(failed ? 1 : 0);
