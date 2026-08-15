#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Interactive smoke test for the drawing editor, driven through headless Chrome
// over the DevTools Protocol.
//
// `tools/capture.sh` proves what the app LOOKS like; nothing there can click,
// drag, or type. This drives the running dev app with `Input.dispatchMouseEvent`
// / `Input.dispatchKeyEvent`, which produce *trusted* events — so pointer
// capture, focus delegation into `vf-*` shadow roots, and the composed-path
// guard that stops `B`/`R`/`G` from hijacking the tile field all behave exactly
// as they do for a real user. Synthetic `dispatchEvent()` from page script would
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
  return keyEvent(k.text ? 'keyDown' : 'rawKeyDown', k, modifiers);
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
  const canvas = __q('.editor-canvas');
  const r = canvas.getBoundingClientRect();
  const checked = __q('vf-radio[checked]');
  const stats = {};
  for (const row of __qa('.stage-stats .stat')) {
    stats[row.children[0].textContent.trim()] = row.children[1].textContent.trim();
  }
  return {
    // All five tools are mutually exclusive sticky modes — exactly one cell is
    // lit. The eyedropper is listed LAST so a drawing-tool cell wrongly left
    // active alongside it would win the find and fail the tool checks.
    drawTool:
      ['pencil', 'rectangle', 'fill', 'eraser', 'eyedropper'].find((t) => tools[t]) ||
      null,
    inkColor: sw ? sw.getAttribute('color') : null,
    recent: __qa('.editor-recent vf-swatch').map((s) => s.getAttribute('color')),
    // The options bar IS <sm-tool-options>; its shadow root holds the bare controls.
    opts: [...__q('sm-tool-options').shadowRoot.children].map((c) =>
      c.tagName.toLowerCase()
    ),
    // The bar's trailing readout ("N px" for the size sliders) — how the checks
    // see a slider's value without reaching into the kit's internals.
    optsReadout: (() => {
      const ls = __q('sm-tool-options').shadowRoot.querySelectorAll('vf-label');
      return ls.length ? ls[ls.length - 1].textContent.trim() : null;
    })(),
    face: __q('.editor-face-picker').value,
    checkedRadio: checked ? checked.getAttribute('value') : null,
    tileField: __q('.editor-tile-size').value,
    dialogOpen: !!(__q('vf-dialog') && __q('vf-dialog').open),
    cursorStyle: getComputedStyle(canvas).cursor,
    rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    tileW: canvas.width,
    stats,
    voxels: +(stats.voxels || 0),
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

// One texel of the editor's live pixel canvas, as [r,g,b,a].
const texelAt = (px, py) =>
  evaluate(`(() => {${DEEP}
    const c = __q('.editor-canvas');
    const d = c.getContext('2d').getImageData(${px}, ${py}, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  })()`);

// True when every texel of a layer is fully transparent.
const layerIsEmpty = (sel) =>
  evaluate(`(() => {${DEEP}
    const c = __q('${sel}');
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
  return !!(__q('.editor-canvas') &&
    __q('.stage-stats').textContent.includes('voxels'));
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

  section(`boot — face=${s.face} tile=${TILE}px`);
  check('boots with the pencil active', s.drawTool === 'pencil', s.drawTool);
  check('pencil keeps the OS crosshair over the canvas', s.cursorStyle === 'crosshair');
  check('options bar shows the pencil slider', s.opts.join(',') === 'vf-slider,vf-label');
  check('face picker reflects ?edit=front', s.face === 'front', s.face);
  check('the checked radio follows the face', s.checkedRadio === 'front');
  check('tile field shows the tile size', s.tileField === String(TILE));
  check('stats read out a build', s.voxels > 0, JSON.stringify(s.stats));

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
  check('the rect tool keeps the OS crosshair', s.cursorStyle === 'crosshair');

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
  check('the eyedropper keeps the OS crosshair too', s.cursorStyle === 'crosshair');
  check('the eyedropper has an empty options bar', s.opts.length === 0, s.opts.join(','));

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

  // The kit hosts its <input> in shadow DOM, so the guard has to read the
  // composed path — a retargeted document-level check would let this through.
  await evaluate(
    `(() => {${DEEP} __q('.editor-tile-size').shadowRoot.querySelector('input').focus(); })()`
  );
  await keyPress('r');
  s = await probe();
  check(
    'a letter typed in the tile field does not switch tools',
    s.drawTool === 'pencil'
  );
  // Blur the INNERMOST focused element — document.activeElement is only the
  // outermost shadow host.
  await evaluate(`(() => { let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    if (a) a.blur(); })()`);

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

  // --- rect: Esc cancel, Shift square-lock ----------------------------------
  section('rect');
  await keyPress('r');
  await drag(at(30, 4), at(34, 8), { beforeRelease: () => keyPress('Escape') });
  await sleep(150);
  const escaped = await texelAt(32, 6);
  check('Esc mid-drag writes nothing', escaped[3] === 0, `texel=${escaped}`);

  // Drag a 9x5 box, then hold Shift: the shorter extent wins, so only the 5x5
  // square anchored at the start corner commits.
  await mouse('mousePressed', at(30, 4).x, at(30, 4).y);
  await mouse('mouseMoved', at(38, 8).x, at(38, 8).y, { buttons: 1 });
  await keyDown('Shift', SHIFT);
  await mouse('mouseMoved', at(38, 8).x, at(38, 8).y, { buttons: 1, modifiers: SHIFT });
  await mouse('mouseReleased', at(38, 8).x, at(38, 8).y, {
    buttons: 0,
    modifiers: SHIFT,
  });
  await keyUp('Shift');
  await sleep(200);
  const inSquare = await texelAt(34, 8);
  const outsideSquare = await texelAt(37, 6); // inside the wide box, outside the square
  check(
    'Shift locks the committed rect to a square',
    inSquare[3] === 255 && outsideSquare[3] === 0,
    `in=${inSquare} out=${outsideSquare}`
  );

  // Rect-ERASE is the right-button drag (the eraser tool itself strokes like a
  // pencil): right-drag a box over the square just committed and it clears.
  await drag(at(30, 4), at(38, 8), { button: 'right', buttons: 2 });
  await sleep(200);
  const rectErased = await texelAt(34, 8);
  check(
    'a right-drag rect erases the boxed texels',
    rectErased[3] === 0,
    `${rectErased}`
  );

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

  // --- tile resize by the stepper -------------------------------------------
  section('tile resize');
  const stepper = await evaluate(
    `(() => {${DEEP} const st = __q('.editor-tile-size')
        .shadowRoot.querySelector('[part="stepper"]').getBoundingClientRect();
      return { x: st.left + st.width / 2, y: st.top + st.height * 0.25 }; })()`
  );
  await click(stepper.x, stepper.y);
  await sleep(600);
  s = await probe();
  // Press-and-hold autorepeat can land more than one step, so assert the
  // direction and that the field agrees with the canvas, not an exact delta.
  check(
    'the stepper resizes the tile',
    s.tileW > TILE && s.tileField === String(s.tileW),
    `tileW=${s.tileW} field=${s.tileField}`
  );
  check('the editor stays on the same face after a resize', s.face === 'top', s.face);
  check('the tool survives the resize', s.drawTool === 'fill', s.drawTool);
  check('the canvas re-fits to the new tile size', s.rect.width > 0 && s.rect.height > 0);

  // --- typed tile entry keeps focus -----------------------------------------
  // The persistent element's payoff: the number field is never unmounted, so
  // focus survives a resize with no refocus code behind it.
  section('typed tile entry');
  await freshPage();
  await evaluate(
    `(() => {${DEEP} __q('.editor-tile-size').shadowRoot.querySelector('input').focus(); })()`
  );
  // Clear with real keystrokes — an out-of-band `input.value = ''` races with
  // live() re-asserting the bound value on the next render.
  await keyPress('Backspace');
  await keyPress('Backspace');
  await typeText('42');
  await keyPress('Enter');
  await sleep(700);
  s = await probe();
  check('typing a tile size commits it', s.tileW === 42, `tileW=${s.tileW}`);
  // Walk the whole delegated-focus chain (sm-editor → vf-number-field → input)
  // and report the innermost host/leaf pair.
  const focusAfter = await evaluate(
    `(() => { const chain = []; let a = document.activeElement;
      while (a) { chain.push(a.tagName.toLowerCase()); a = a.shadowRoot && a.shadowRoot.activeElement; }
      return chain.length ? chain.slice(-2).join('/') : null; })()`
  );
  check(
    'keyboard focus stays in the tile field across the resize',
    focusAfter === 'vf-number-field/input',
    focusAfter
  );
  await keyPress('Backspace');
  await keyPress('Backspace');
  await typeText('24');
  await keyPress('Enter');
  await sleep(700);
  s = await probe();
  check(
    'a second typed size commits without a refocus',
    s.tileW === 24,
    `tileW=${s.tileW}`
  );

  // --- one element, one dialog, ever ----------------------------------------
  section('persistent element');
  await freshPage();
  const inkSwatch = await centreOf('.editor-selected');
  await click(inkSwatch.x, inkSwatch.y);
  await sleep(400);
  await evaluate(`(() => {${DEEP} __q('vf-dialog').close(); })()`);
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
        dialogs: __qa('vf-dialog').length,
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
  // LAST on purpose: a synthesized mouse-up after a native modal closes is one of
  // the states that provokes the headless reload described in the header.
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
  check('clicking the ink swatch opens the Colors dialog', s.dialogOpen === true);
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
  check('picking a swatch closes the dialog', s.dialogOpen === false);
  check('picking a swatch becomes the ink', s.inkColor === cell.color, `${s.inkColor}`);
  check(
    'the previous ink drops into the last-used row',
    s.recent[0] === inkBeforePalette,
    `${JSON.stringify(s.recent)} vs ${inkBeforePalette}`
  );

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
