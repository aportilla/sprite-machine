#!/usr/bin/env node
// ---------------------------------------------------------------------------
// The integration smoke test: user journeys through the desktop and the
// editor, driven through headless Chrome over the DevTools Protocol.
//
// `tools/capture.sh` proves what the app LOOKS like (and `tools/goldens.sh`
// holds the look as a regression gate); nothing there can click, drag, or
// type. This drives the running dev app with `Input.dispatchMouseEvent` /
// `Input.dispatchKeyEvent`, which produce *trusted* events — so pointer
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
// WHAT A CHECK IS HERE (docs/test-trim-plan.md §1): a scenario is a user
// journey, and a check names an outcome of the app's own — a store value
// read through a control, a texel, a stored record, a window opened, a
// handler having run — that crosses a boundary no Node test can (IndexedDB,
// trusted input, the real canvas, the menu wiring, a reload). Nothing here
// asserts the kit's behavior (a part's rect, an element count, a drag's
// delta, DOM order after a raise), re-derives arithmetic the Node suites pin
// (this file imports nothing from src/ but the PNG chunk reader), pins UI
// copy, or records a precondition as a check (a helper that cannot find its
// target throws). The look — strips, rules, ink, headers — is goldens.sh's.
//
// Assumes the CAR sample at its shipped 40px tile: the texel coordinates below
// are picked off that art (a body pixel to eyedrop, an empty corner to rect
// into). The sm-* components render in SHADOW DOM, so every page-side probe
// goes through the shadow-piercing __q/__qa helpers (DEEP, below).
//
// PROCESS HYGIENE, same concern as capture.sh: an agent harness may SIGKILL
// this script, and SIGKILL cannot be trapped, so `finally` is not enough.
// Three layers: the normal exit path reaps; SIGINT/SIGTERM reap; and a
// DETACHED watchdog reaps this run's Chrome + temp dir after a deadline even
// if this process dies uncatchably. The profile lives at
// `/tmp/cr-cap/run.drive.XXXXXX`, under capture.sh's own root and matching
// its `run.*` glob, so `tools/capture.sh clean` sweeps it up too.
//
// THE READINESS CONTRACT: every wait here is on the app's own boot-complete
// signal — `data-sm-boot="ready"` on the root element, which main.js sets
// once the whole boot chain has landed — plus whatever state the section
// then needs, and every wait after an input is on the outcome the next
// check reads (`settle` / `until`), never a guess about timing. The fixed
// sleeps that remain are the kit's own menu and popup blinks, which have no
// observable end.
//
// TRAPS, learned the hard way — read before adding a scenario:
//   1. Headless Chrome reloads the FIRST page a launch loads exactly once, on
//      its own (absorbPhantomReload gives it a throwaway page to hit). Should
//      one land on the app anyway, the boot is idempotent under it and every
//      probe re-checks `window.__stamp`, waiting for the new boot rather than
//      reading a page mid-boot.
//   2. Erasing part of FRONT does NOT lower the voxel count — opposite views
//      are plane-UNIONed by the carve, so BACK still covers the silhouette.
//      What moves is the surface colouring and with it the triangle count,
//      so the live-rebuild check asserts on the whole stats readout.
//   3. Once a stroke has landed, every navigation trips the app's dirty-
//      document beforeunload guard — a confirm dialog headless Chrome parks
//      on FOREVER unless answered. The message handler auto-accepts it.
//      Relatedly: repeated chorded drags (Shift-locked rects, right-button
//      drags) can wedge the headless renderer outright — those semantics
//      stay covered by the Node suites and docs/SMOKE-TEST.md instead.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
// The one import from src/: the document format's chunk reader, to read the
// exported atlas file back (an app outcome no unit can reach: the download).
import { readTextChunks } from '../src/lib/png-chunks.js';

const APP_PORT = process.argv[2] || '5173';
const DBG_PORT = +(process.env.DRIVE_DEBUG_PORT || 9333);
const DEADLINE = +(process.env.DRIVE_DEADLINE || 240); // watchdog seconds
// A directory to keep the files the run downloads (the atlas export) under
// their suggested names — for an eye on the exported pixels; the run's own
// copies die with its temp dir.
const KEEP_DOWNLOADS = process.env.DRIVE_KEEP_DOWNLOADS || '';
const CHROME =
  process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = '/tmp/cr-cap'; // shared with capture.sh so its `clean` reaps us too
// The deterministic test path: the Car sample as an untitled, no seeding, no
// greet. (Auto-rotate is off every load; the wedge pass is always on.)
const URL = `http://localhost:${APP_PORT}/?sample=car&edit=front`;
// The PLAIN app url — no ?sample, so the real boot path runs. On this run's
// brand-new profile the first load is the one TRULY VIRGIN boot: it seeds the
// built-in defaults (Car, Cube) into IndexedDB as ordinary stored documents
// and parks at the About box.
const SEED_URL = `http://localhost:${APP_PORT}/`;

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
// Downloads the page starts (Browser.setDownloadBehavior with events on):
// guid -> { name, state } — the atlas export scenario waits on a completed
// one and reads the file back out of the run's temp dir.
const downloads = new Map();
// When the main frame last navigated: the readiness waits below hold until
// the page has been quiet for a moment past its predicate (see them).
let lastNavAt = 0;
let navCount = 0; // main-frame commits seen since the session attached

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
  Space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  Home: { key: 'Home', code: 'Home', vk: 36, text: '' },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39, text: '' },
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

// NO nativeVirtualKeyCode — ever. With one, headless Chrome on macOS builds a
// native NSEvent behind the DOM event, and a keydown the page leaves
// UNHANDLED (no preventDefault — the app's Esc over a selection, by design)
// is re-injected through that native path endlessly: ~7000 trusted keydowns
// a second, timeStamp 0, until the tab dies, starving every timer on the
// page. The Windows vk alone gives the DOM its keyCode, and with no native
// code there is no OS event to re-dispatch.
const keyEvent = (type, k, modifiers) =>
  send('Input.dispatchKeyEvent', {
    type,
    key: k.key,
    code: k.code,
    windowsVirtualKeyCode: k.vk,
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
async function drag(a, b, { modifiers = 0, beforeRelease } = {}) {
  await mouse('mousePressed', a.x, a.y, { modifiers });
  await mouse('mouseMoved', b.x, b.y, { buttons: 1, modifiers });
  if (beforeRelease) await beforeRelease();
  await mouse('mouseReleased', b.x, b.y, { buttons: 0, modifiers });
}

// A window's title / dot bar dragged by (dx, dy) — the kit's gesture, never
// checked on its own; a scenario reads what the app does with the result.
async function dragWindow(expr, dx, dy, barDy) {
  const b = await evaluate(
    `(() => {${DEEP} const r = (${expr}).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + ${barDy} }; })()`
  );
  await mouse('mousePressed', b.x, b.y);
  await mouse('mouseMoved', b.x + Math.round(dx / 2), b.y + Math.round(dy / 2), {
    buttons: 1,
  });
  await mouse('mouseMoved', b.x + dx, b.y + dy, { buttons: 1 });
  await mouse('mouseReleased', b.x + dx, b.y + dy, { buttons: 0 });
  await sleep(200);
}

// A window's grow box dragged by (dx, dy). `expr` names the window
// (`__doc()` for the active document window).
async function growWindow(expr, dx, dy) {
  const g = await evaluate(
    `(() => {${DEEP} const b = (${expr}).shadowRoot
        .querySelector('[part="grow-box"]').getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`
  );
  await mouse('mousePressed', g.x, g.y);
  await mouse('mouseMoved', g.x + Math.round(dx / 2), g.y + Math.round(dy / 2), {
    buttons: 1,
  });
  await mouse('mouseMoved', g.x + dx, g.y + dy, { buttons: 1 });
  await mouse('mouseReleased', g.x + dx, g.y + dy, { buttons: 0 });
  await sleep(200);
}

// The strip readout's numbers alone, joined — a value-shape read of a probe
// ("5 × 5" → "5,5"), never its copy.
const readoutNums = (s) => ((s.optsReadout || '').match(/\d+/g) || []).join(',');

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
// shadow root; __q takes the first hit. Inlined per-expression, so a reload
// can never wipe an installed helper.
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
  // (one per open document, id win-doc-<key>). __qd scopes an editor-internals
  // query to it, so a probe in a two-document session reads the right canvas.
  const __doc = () => {
    const wins = [...document.querySelectorAll('vf-window')].filter((w) =>
      w.id.startsWith('win-doc-'));
    return wins.find((w) => w.hasAttribute('active')) || wins[wins.length - 1] || null;
  };
  const __qd = (sel) => { const d = __doc(); return d ? __q(sel, d) : null; };
`;

// --- page probes ------------------------------------------------------------
// One round trip that reads everything the checks assert on, so a probe is a
// consistent snapshot rather than a series of racing reads. Every field is
// an app value: a tool, an ink, a readout, a face, a window's presence, a
// menu item's enablement — never a kit part's geometry.
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
  const checked = __q('sm-face-picker')?.shadowRoot?.querySelector('vf-radio[checked]');
  // The 3D View's build stats ride its status label's tooltip
  // ("grid 40px · voxels 4950 · tris 1784") — parsed into a map.
  const buildStats = (() => {
    const el = __q('sm-status-line[kind="build"]');
    const lb = el && el.shadowRoot ? el.shadowRoot.querySelector('vf-label') : null;
    return (lb && lb.getAttribute('title')) || '';
  })();
  const stats = {};
  for (const m of buildStats.matchAll(/(grid|voxels|tris) ([^·]+)/g)) {
    stats[m[1]] = m[2].trim();
  }
  const picker = __q('sm-color-picker');
  const colorsDialog = picker ? picker.querySelector('vf-dialog') : null;
  const opts = __q('sm-tool-options');
  return {
    // All six tools are mutually exclusive sticky modes — exactly one cell is
    // lit. The eyedropper is listed LAST so a drawing-tool cell wrongly left
    // active alongside it would win the find and fail the tool checks.
    drawTool:
      ['selection', 'pencil', 'rectangle', 'fill', 'eraser', 'eyedropper'].find(
        (t) => tools[t]
      ) || null,
    inkSwatchShown: !!sw,
    inkColor: sw ? sw.getAttribute('color') : null,
    // The strip's trailing readout ("N px" for the size sliders, "W × H" for
    // the rect drag and the selection) — how the checks see a slider's value
    // without reaching into the kit's internals.
    optsReadout: (() => {
      if (!opts) return null;
      const ls = opts.shadowRoot.querySelectorAll('vf-label');
      return ls.length ? ls[ls.length - 1].textContent.trim() : null;
    })(),
    // The tip-shape popup's value (the pencil's or the eraser's session
    // setting, read through the strip's control); null with no popup up.
    tipShape: (() => {
      const sel = opts ? opts.shadowRoot.querySelector('vf-select') : null;
      return sel ? sel.value : null;
    })(),
    face: __q('.editor-face-picker')?.value ?? null,
    checkedRadio: checked ? checked.getAttribute('value') : null,
    heading: __doc() ? __doc().heading : '',
    colorsOpen: !!(colorsDialog && colorsDialog.open),
    anyModalOpen: !!__q('vf-dialog[open]') || !!(colorsDialog && colorsDialog.open),
    rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    tileW: canvas ? canvas.width : 0,
    buildStats,
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
    // The toggleable windoid (it boots hidden — View → 3D Sprite Atlas shows it).
    ringShown: !__q('#win-ring').hidden,
    docWindows: [...document.querySelectorAll('vf-window')].filter((w) =>
      w.id.startsWith('win-doc-')).length,
    // The focus model: whether a document window holds the active state, and
    // whether the options strip's band is on screen (it hides with the
    // application, like the windoids).
    docActive: !!__doc() && __doc().hasAttribute('active'),
    optionsStrip: !!__q('sm-options-bar')?.shadowRoot?.querySelector('.strip'),
    // Enabled states for the focus-gated menu grammar (the Finder role).
    menuEnabled: {
      newDoc: !__q('vf-menu-item[value="new"]').disabled,
      open: !__q('vf-menu-item[value="open"]').disabled,
      save: !__q('vf-menu-item[value="save"]').disabled,
      close: !__q('vf-menu-item[value="close"]').disabled,
      pickColor: !__q('vf-menu-item[value="pick-color"]').disabled,
      // The ⌘J item — Arrange Windows (value \`arrange\`) with anything on
      // screen off its placement, Zoom Window (value \`zoom\`) once
      // everything is arranged: the value is the state's readout.
      arrange: !__q('#item-arrange').disabled,
      arrangeValue: __q('#item-arrange').getAttribute('value'),
      ring: !__q('vf-menu-item[value="ring"]').disabled,
    },
    menuChecks: {
      ring: !!__q('vf-menu-item[value="ring"]').checked,
      // The Tools menu's checked tool item, sans its 'tool-' prefix. Exactly
      // one must be checked (the sticky mode) — any other count reads '!N'.
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
    // The View menu's open-windows section (menus.js syncWindows): one item
    // per open document window after a separator, at the menu's tail — the
    // value \`window:<key>\`, the label the document's name, the checkmark
    // the active window's — read beside the document windows themselves.
    viewWindows: (() => {
      const isWin = (el) => (el.getAttribute('value') || '').startsWith('window:');
      const kids = [...__q('#menu-view').children];
      const first = kids.findIndex(isWin);
      return {
        items: kids.filter(isWin).map((i) => ({
          value: i.getAttribute('value'),
          label: i.textContent.trim(),
          checked: !!i.checked,
          enabled: !i.disabled,
        })),
        separator: first > 0 && kids[first - 1].tagName === 'VF-SEPARATOR',
        atEnd: first < 0 || kids.slice(first).every(isWin),
        trailingSeparator: kids.length > 0 && kids[kids.length - 1].tagName === 'VF-SEPARATOR',
        windows: [...document.querySelectorAll('vf-window')]
          .filter((w) => w.id.startsWith('win-doc-'))
          .map((w) => ({
            key: w.id.slice('win-doc-'.length),
            heading: w.heading,
            active: w.hasAttribute('active'),
          })),
      };
    })(),
    stamp: window.__stamp || 'RELOADED',
  };
})()`;

let reloads = 0;
async function probe() {
  for (let attempt = 0; ; attempt++) {
    let s;
    try {
      s = await evaluate(PROBE);
    } catch (err) {
      // A reload can land DURING a probe: the page is mid-navigation and the
      // probe throws — wait the new boot in and probe again.
      if (attempt >= 3) throw err;
      reloads++;
      console.log(
        '  !!   page reloaded mid-probe (headless artifact) — waiting for the new boot'
      );
      await waitForBoot();
      continue;
    }
    if (s.stamp !== 'RELOADED') return s;
    // The document under us was replaced since the last wait (no stamp): a
    // snapshot of it may be mid-boot — never hand that to the checks.
    if (attempt >= 3) return s;
    reloads++;
    console.log('  !!   page reloaded (headless artifact) — waiting for the new boot');
    await waitForBoot();
  }
}

// Poll a probe until `pred` holds (or the budget runs out) and hand the last
// probe back: the outcome the next check reads IS the settle. A predicate
// that never holds leaves the check to fail on that same probe, with its
// detail.
async function settle(pred, ms = 6000) {
  const t = Date.now();
  let s = await probe();
  while (!pred(s) && Date.now() - t < ms) {
    await sleep(100);
    s = await probe();
  }
  return s;
}

// Poll a Node-side async predicate until it holds; true if it did in time.
async function until(fn, ms = 6000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await fn()) return true;
    await sleep(80);
  }
  return false;
}

// One texel of the ACTIVE document's live pixel canvas, as [r,g,b,a].
const texelAt = (px, py) =>
  evaluate(`(() => {${DEEP}
    const c = __qd('.editor-canvas');
    const d = c.getContext('2d').getImageData(${px}, ${py}, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  })()`);
const painted = (px, py) => until(async () => (await texelAt(px, py))[3] === 255);
const cleared = (px, py) => until(async () => (await texelAt(px, py))[3] === 0);

// True when every texel of a layer (in the active document's editor) is
// fully transparent.
const layerIsEmpty = (sel) =>
  evaluate(`(() => {${DEEP}
    const c = __qd('${sel}');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
    return true;
  })()`);

// A layer as ONE paint: how many px are painted, how many distinct colors
// they carry, how many are translucent, and — with exactly one color — that
// color as hex.
const layerSolid = (sel) =>
  evaluate(`(() => {${DEEP}
    const c = __qd('${sel}');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    let painted = 0, translucent = 0;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a === 0) continue;
      painted++;
      if (a !== 255) translucent++;
      seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    }
    const one = seen.size === 1 ? [...seen][0] : null;
    return { painted, distinct: seen.size, translucent,
      color: one == null ? null : '#' + one.toString(16).padStart(6, '0') };
  })()`);

// The centre of an element — how a click finds a control. Throws when the
// control is not there: a missing target is a broken run, not a check.
const centreOf = async (sel) => {
  const p = await evaluate(`(() => {${DEEP}
    const el = __q('${sel}');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!p) throw new Error(`no element for ${sel}`);
  return p;
};

// Texel -> viewport px (the centre of that texel), read off the ACTIVE
// document's canvas as it is now — so a window that moved or grew is fine.
async function at(px, py) {
  const r = await evaluate(`(() => {${DEEP}
    const c = __qd('.editor-canvas');
    const b = c.getBoundingClientRect();
    return { left: b.left, top: b.top, width: b.width, height: b.height, tile: c.width };
  })()`);
  return {
    x: r.left + ((px + 0.5) * r.width) / r.tile,
    y: r.top + ((py + 0.5) * r.height) / r.tile,
  };
}

const hex = ([r, g, b]) =>
  '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');

// --- readiness --------------------------------------------------------------
// Both readiness predicates ALSO require the page to be unstamped: every
// wait ends by stamping the document (`window.__stamp = 'S'`), so a stamp
// means "the document we already waited for". Page.navigate resolves while
// the OLD document is still up, and that document satisfies the predicate
// on its own — without this, a wait after a same-URL navigation could return
// on the old page. AND both waits hold for a QUIET window past the predicate
// — the main frame must not have navigated for NAV_QUIET ms.
const NAV_QUIET = 700;
const quiet = () => Date.now() - lastNavAt >= NAV_QUIET;

// THE READINESS PREDICATES: the app's own boot-complete mark on an UNSTAMPED
// document, then what the scenario needs of that boot.
const BOOT_READY = `(!window.__stamp && document.documentElement.dataset.smBoot === 'ready')`;
// A document boot: the editor canvas up and the 3D View's first build in
// its stats (the rebuilder lands a frame after the open).
const APP_READY = `(() => {${DEEP}
  if (!${BOOT_READY}) return false;
  const build = __q('sm-status-line[kind="build"]');
  const lb = build && build.shadowRoot && build.shadowRoot.querySelector('vf-label');
  return !!(__q('.editor-canvas') && lb &&
    (lb.getAttribute('title') || '').includes('voxels'));
})()`;
// The plain boot (no ?sample, no ?file) opens NO document — it parks at the
// About box. GREET_UP is the plain "is the About box open?" test (asked of a
// page already waited for, so no stamp guard); GREET_READY the wait's.
const GREET_UP = `(() => {${DEEP}
  const d = __q('#dlg-about');
  return !!(d && d.open);
})()`;
const GREET_READY = `(() => {${DEEP}
  if (!${BOOT_READY}) return false;
  const d = __q('#dlg-about');
  return !!(d && d.open);
})()`;

// A wait that runs out is a FAILURE with a diagnosis of the page it found.
async function reportStuck(what) {
  const state = await evaluate(
    `(() => {${DEEP}
      const d = __q('#dlg-about');
      return JSON.stringify({
        url: location.href, ready: document.readyState,
        boot: document.documentElement.dataset.smBoot || null,
        about: !!(d && d.open),
        canvas: !!__q('.editor-canvas'), stamp: window.__stamp || null,
      });
    })()`
  ).catch((e) => 'unreadable: ' + e.message);
  check(`the page came up within 20 s (${what})`, false, String(state));
}

// One wait for every boot kind: poll the predicate on a navigation-quiet
// page until it holds (20 s at most, then a failing check), then stamp the
// document so the next wait and every probe can tell it from its successor.
async function waitFor(predicate, what) {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (quiet() && (await evaluate(predicate).catch(() => false))) {
      ready = true;
      break;
    }
    await sleep(200);
  }
  if (!ready) await reportStuck(what);
  await evaluate(`window.__stamp = 'S'`);
}
const waitForApp = () =>
  waitFor(APP_READY, 'an editor canvas with build stats, boot ready');
const waitForGreet = () => waitFor(GREET_READY, 'the About box, boot ready');
const waitForBoot = () => waitFor(`(() => ${BOOT_READY})()`, 'boot ready after a reload');

// CHROME'S PHANTOM RELOAD. Headless Chrome (--headless=new on a fresh
// profile) reloads the FIRST page a launch loads exactly once — browser-
// initiated, 0.6–1.2 s after that page finishes loading on an idle machine,
// later under load (measured Sep 5 2026 with a CDP timeline). So the run
// loads a THROWAWAY page first and waits for its second commit. Belt and
// braces, not the fix: a reload that slips past meets an app whose first
// boot is idempotent under a reload and probes that wait for the new boot.
async function absorbPhantomReload() {
  const before = navCount;
  await send('Page.navigate', { url: 'data:text/html,<title>drive</title>' });
  const t = Date.now();
  while (navCount < before + 2 && Date.now() - t < 10000) await sleep(50);
  console.log(
    navCount >= before + 2
      ? `  ..   [phantom reload absorbed on the throwaway page, ${Date.now() - t} ms in]`
      : '  ..   [no phantom reload within 10 s — proceeding; the boot is idempotent under one]'
  );
  await sleep(200);
}

// The deterministic ?sample boot, fresh: the Car as an untitled, front face.
async function freshPage() {
  await send('Page.navigate', { url: URL });
  await waitForApp();
  return probe();
}

// --- shared gestures --------------------------------------------------------
// Pick one item from a menu-bar menu with real pointer input: a quick tap on
// the menu's bar title opens the panel and leaves it open (the kit's press
// gesture), then a click on the item runs its ~250ms blink before
// vf-menu-select fires — the blinks are the kit's, with no observable end.
async function pickMenu(menuSel, itemValue) {
  const m = await centreOf(menuSel);
  await click(m.x, m.y);
  await sleep(250);
  const it = await centreOf(`vf-menu-item[value="${itemValue}"]`);
  await click(it.x, it.y);
  await sleep(650);
}

// File → New… then Create at its default (Empty Document, 40px tiles).
async function newBlankDoc() {
  const before = (await probe()).docWindows;
  await pickMenu('#menu-file', 'new');
  const ok = await centreOf('#btn-new-ok');
  await click(ok.x, ok.y);
  await settle((s) => s.docWindows === before + 1 && s.anyModalOpen === false);
}

// OK the About box if it is up (a plain boot's greet).
async function dismissGreet() {
  if (!(await evaluate(GREET_UP).catch(() => false))) return;
  const ok = await centreOf('#btn-about-ok');
  await click(ok.x, ok.y);
  await until(async () => !(await evaluate(GREET_UP)));
}

// The tip-shape popup (the kit's vf-select) driven through its control: a
// quick click drops the list, a second click picks; the kit's selection
// blink has no observable end.
async function pickShape(shape) {
  const pill = await centreOf('.editor-tip-shape');
  await click(pill.x, pill.y);
  await sleep(250);
  const opt = await centreOf(`vf-option[value="${shape}"]`);
  await click(opt.x, opt.y);
  await settle((s) => s.tipShape === shape);
  await sleep(300);
}

// A bare-desktop point, computed against the LIVE layout. Throws when there
// is none: a precondition, not a check.
async function bareSpot() {
  const p = await evaluate(`(() => {${DEEP}
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
  if (!p) throw new Error('no bare patch of desktop to click');
  return p;
}

const docBarPoint = () =>
  evaluate(
    `(() => {${DEEP} const r = __doc().getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 9 }; })()`
  );
const docBox = () =>
  evaluate(
    `(() => {${DEEP} const w = __doc();
      return { left: w.left, top: w.top, w: w.width, h: w.height }; })()`
  );
const selectedIcons = () =>
  evaluate(`(() => {${DEEP}
    return __qa('vf-icon[data-key]').filter((i) => i.selected).map((i) => i.label);
  })()`);
const urlMirror = () => evaluate(`({ hash: location.hash, search: location.search })`);
const antsUp = async () => !(await layerIsEmpty('.editor-canvas-select'));

// A vf-number-field's stepper ▲ (its upper half).
const stepperUp = (sel) =>
  evaluate(
    `(() => {${DEEP} const st = __q('${sel}')
        .shadowRoot.querySelector('[part="stepper"]').getBoundingClientRect();
      return { x: st.left + st.width / 2, y: st.top + st.height * 0.25 }; })()`
  );
// Focus a vf-number-field's input and replace its text with real keystrokes.
async function typeInto(sel, text) {
  await evaluate(
    `(() => {${DEEP} const i = __q('${sel}').shadowRoot.querySelector('input');
      i.focus(); i.select(); })()`
  );
  await keyPress('Backspace');
  await typeText(text);
  await keyPress('Enter');
}

// --- the plain boot: seeding, the About box, ?file, geometry -----------------
const seededFlag = () =>
  evaluate(
    `(() => { try { return JSON.parse(localStorage.getItem('sprite-machine:desktop')).seeded; } catch { return null; } })()`
  );
const seedProbe = () =>
  evaluate(`(() => {${DEEP}
    const icons = __qa('vf-icon[data-key]').map((i) => ({
      key: i.dataset.key, label: i.label, open: !!i.open,
    }));
    const d = __doc();
    return {
      icons,
      labels: icons.map((i) => i.label).sort().join(','),
      heading: d ? d.heading : '',
      docWindows: [...document.querySelectorAll('vf-window')].filter((w) =>
        w.id.startsWith('win-doc-')).length,
      aboutOpen: !!__q('#dlg-about').open,
      newDialogOpen: !!__q('#dlg-new').open,
    };
  })()`);

async function s1_virginBoot() {
  section('S1 the virgin boot seeds the defaults');
  const seed = await seedProbe();
  const recorded = await seededFlag();
  check(
    'the first-ever boot seeds Car and Cube as saved-doc icons and records it (seeded: true)',
    seed.icons.length === 2 &&
      seed.icons.every((i) => i.key.startsWith('doc:')) &&
      seed.labels === 'Car,Cube' &&
      recorded === true,
    JSON.stringify({ icons: seed.icons, seeded: recorded })
  );
  const greet = await probe();
  check(
    '…and parks at the About box in the Finder role: no document window, no New Document dialog, windoids hidden, strip blank',
    seed.aboutOpen === true &&
      seed.newDialogOpen === false &&
      seed.docWindows === 0 &&
      !greet.windows.tools &&
      !greet.windows.sprite &&
      !greet.windows.stage &&
      greet.optionsStrip === false,
    JSON.stringify({ seed, windows: greet.windows, strip: greet.optionsStrip })
  );
}

async function s2_seedingRecord() {
  section('S2 the seeding record');
  await send('Page.navigate', { url: SEED_URL });
  await waitForGreet();
  let seed = await seedProbe();
  check(
    'a plain reload does not re-seed and greets with the About box again',
    seed.icons.length === 2 && seed.aboutOpen === true && seed.docWindows === 0,
    JSON.stringify(seed)
  );
  // THE INTERRUPTED FIRST BOOT, staged: a blob whose record reads FALSE is
  // what a reload mid-seeding leaves behind. The next boot must seed again —
  // skipping the built-ins already stored by name, so nothing doubles — and
  // set the record.
  await evaluate(
    `(() => { const k = 'sprite-machine:desktop'; const b = JSON.parse(localStorage.getItem(k));
      b.seeded = false; localStorage.setItem(k, JSON.stringify(b)); return b.seeded; })()`
  );
  await send('Page.navigate', { url: SEED_URL });
  await waitForGreet();
  seed = await seedProbe();
  const flag = await seededFlag();
  check(
    'a boot finding the record FALSE seeds again without doubling — Car and Cube once — and records it',
    seed.icons.length === 2 &&
      seed.labels === 'Car,Cube' &&
      seed.aboutOpen &&
      flag === true,
    JSON.stringify({ labels: seed.labels, seeded: flag })
  );
}

async function s3_aboutBox() {
  section('S3 the About box');
  await dismissGreet();
  let seed = await seedProbe();
  const bare = await probe();
  const okClosed =
    seed.aboutOpen === false &&
    seed.docWindows === 0 &&
    !bare.windows.tools &&
    !bare.windows.sprite &&
    !bare.windows.stage &&
    bare.optionsStrip === false &&
    bare.menuEnabled.newDoc === true &&
    bare.menuEnabled.save === false;
  await pickMenu('#menu-app', 'about');
  seed = await seedProbe();
  check(
    'OK closes the About box onto the bare desktop (nothing opens, nothing activates); Sprite Machine → About… raises it again',
    okClosed && seed.aboutOpen === true && seed.docWindows === 0,
    JSON.stringify({ okClosed, bare: bare.windows, reopened: seed.aboutOpen })
  );
  await dismissGreet();
}

async function s4_firstWindowActivates() {
  section('S4 the first document window');
  // A headless artifact reload can land mid-gesture and boot back to the
  // greet, dropping the untitled window (they never survive a reload — by
  // design), so the gesture retries, re-dismissing the greet.
  let created = null;
  for (let attempt = 0; attempt < 3 && created?.docWindows !== 1; attempt++) {
    await dismissGreet();
    await newBlankDoc();
    created = await probe();
  }
  check(
    'File → New… → Create opens the first window and ACTIVATES the application: windoids and strip up',
    created.docWindows === 1 &&
      created.docActive === true &&
      created.windows.tools &&
      created.windows.sprite &&
      created.windows.stage &&
      created.optionsStrip === true,
    JSON.stringify({
      docWindows: created.docWindows,
      docActive: created.docActive,
      windows: created.windows,
      strip: created.optionsStrip,
    })
  );
}

async function s5_fileParam() {
  section('S5 ?file opens a stored document');
  await send('Page.navigate', { url: `${SEED_URL}?file=cube` });
  await waitForApp();
  const seed = await seedProbe();
  const um = await urlMirror();
  check(
    '?file=cube opens the stored Cube (case-insensitive) with no greet, and the address bar canonicalizes to #Cube',
    seed.heading === 'Cube' &&
      seed.docWindows === 1 &&
      seed.aboutOpen === false &&
      seed.newDialogOpen === false &&
      seed.icons.find((i) => i.label === 'Cube')?.open === true &&
      um.hash === '#Cube' &&
      !/[?&]file=/.test(um.search),
    JSON.stringify({ seed, url: um })
  );
}

async function s6_geometryNeverPersists() {
  section('S6 window geometry never persists');
  const windowGeom = () =>
    evaluate(`(() => {${DEEP}
      const pick = (w) => ({ left: w.left, top: w.top, width: w.width, height: w.height });
      return { tools: pick(__q('#win-tools')), stage: pick(__q('#win-stage')),
               doc: pick(__doc()) };
    })()`);
  const placed = await windowGeom();
  await dragWindow(`__doc()`, 60, 40, 9);
  await dragWindow(`__q('#win-tools')`, 60, 40, 6);
  await growWindow(`__q('#win-stage')`, -30, -20);
  const left = await windowGeom();
  if (
    left.doc.left === placed.doc.left ||
    left.tools.left === placed.tools.left ||
    left.stage.width === placed.stage.width
  )
    throw new Error(
      'the drags did not move the windows: ' + JSON.stringify({ placed, left })
    );
  await send('Page.navigate', { url: `${SEED_URL}?file=cube` });
  await waitForApp();
  const again = await windowGeom();
  check(
    'a reload places every window fresh — nothing about a window persists',
    JSON.stringify(again) === JSON.stringify(placed),
    JSON.stringify({ placed, left, again })
  );
}

// --- the editor: tools, gestures, dialogs ----------------------------------
async function s7_sampleBoot() {
  section('S7 the sample boot');
  const s = await freshPage();
  check(
    'the ?sample=car&edit=front boot: pencil active, Car titled, four windows up, face front, a build with stats',
    s.drawTool === 'pencil' &&
      s.heading === 'Car' &&
      Object.values(s.windows).every(Boolean) &&
      s.face === 'front' &&
      s.checkedRadio === 'front' &&
      s.voxels > 0,
    JSON.stringify({
      tool: s.drawTool,
      heading: s.heading,
      windows: s.windows,
      face: s.face,
      stats: s.buildStats,
    })
  );
}

async function s8_toolKeys() {
  section('S8 the tool keys');
  const seen = {};
  for (const [key, tool, menu] of [
    ['s', 'selection', 'select'],
    ['r', 'rectangle', 'rect'],
    ['g', 'fill', 'fill'],
    ['i', 'eyedropper', 'eyedropper'],
    ['e', 'eraser', 'eraser'],
    ['b', 'pencil', 'pencil'],
  ]) {
    await keyPress(key);
    const s = await settle((p) => p.drawTool === tool && p.menuChecks.tool === menu);
    seen[key] = { strip: s.drawTool, menu: s.menuChecks.tool };
  }
  check(
    'S / R / G / I / E / B each select their tool, the strip and the Tools menu agreeing',
    Object.entries(seen).every(
      ([, v]) => v.strip && v.menu === v.menu && !v.menu.startsWith('!')
    ) &&
      seen.s.strip === 'selection' &&
      seen.r.strip === 'rectangle' &&
      seen.g.strip === 'fill' &&
      seen.i.strip === 'eyedropper' &&
      seen.e.strip === 'eraser' &&
      seen.b.strip === 'pencil',
    JSON.stringify(seen)
  );
  // The kit hosts its <input> in shadow DOM, so the tool-shortcut guard has
  // to read the composed path. The radius field is the rect strip's
  // always-mounted text input.
  await keyPress('r');
  await settle((p) => p.drawTool === 'rectangle');
  await evaluate(
    `(() => {${DEEP} __q('sm-tool-options').shadowRoot
        .querySelector('vf-number-field').shadowRoot.querySelector('input').focus(); })()`
  );
  await keyPress('g');
  await sleep(150);
  const s = await probe();
  check(
    'a letter typed into the radius field does not switch tools',
    s.drawTool === 'rectangle',
    s.drawTool
  );
  await evaluate(`(() => { let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    if (a) a.blur(); })()`);
  await keyPress('b');
  await settle((p) => p.drawTool === 'pencil');
}

async function s9_pencil() {
  section('S9 the pencil');
  await freshPage();
  await drag(await at(2, 2), await at(6, 2));
  const run = (await painted(2, 2)) && (await painted(6, 2));
  check(
    'a drag paints the whole Bresenham run',
    run,
    JSON.stringify({ start: await texelAt(2, 2), end: await texelAt(6, 2) })
  );
  // The tip-shape popup switches the pencil between the disc inscribed in
  // the N×N box (circle, the boot shape) and the box itself; the hover
  // preview paints the exact texels a stamp would cover, in the ink. A
  // mid-track click on the slider sets a tip big enough for the two to
  // differ (a 1 or 2 px tip IS its box under either shape).
  const slider = await centreOf('.editor-size-slider');
  await click(slider.x, slider.y);
  const sized = await settle((p) => Number(readoutNums(p)) > 2);
  if (!(Number(readoutNums(sized)) > 2))
    throw new Error('the slider click did not set a tip past 2 px: ' + sized.optsReadout);
  const hover = await at(20, 20);
  await mouse('mouseMoved', hover.x, hover.y, { buttons: 0 });
  await sleep(100);
  const circle = await layerSolid('.editor-canvas-cursor');
  await pickShape('square');
  await mouse('mouseMoved', hover.x, hover.y, { buttons: 0 });
  await sleep(100);
  const square = await layerSolid('.editor-canvas-cursor');
  check(
    'the tip-shape popup changes what the canvas previews: the square covers more texels than the circle at the same size, both in one opaque ink',
    circle.painted > 0 &&
      square.painted > circle.painted &&
      circle.distinct === 1 &&
      square.distinct === 1 &&
      circle.translucent === 0 &&
      square.translucent === 0,
    JSON.stringify({ size: sized.optsReadout, circle, square })
  );
  // Leave the pencil as it booted: circle, 1 px (Home on the focused slider).
  await pickShape('circle');
  await click(slider.x, slider.y);
  await keyPress('Home');
  await settle((p) => readoutNums(p) === '1');
}

async function s10_eraser() {
  section('S10 the eraser');
  await keyPress('e');
  await settle((p) => p.drawTool === 'eraser');
  // The eraser's tip size and shape are ITS OWN settings: set both, flip to
  // the pencil (untouched), flip back (held).
  const slider = await centreOf('.editor-size-slider');
  await click(slider.x, slider.y);
  const sized = await settle((p) => Number(readoutNums(p)) > 1);
  await pickShape('square');
  await keyPress('b');
  const pencil = await settle((p) => p.drawTool === 'pencil');
  await keyPress('e');
  const eraser = await settle((p) => p.drawTool === 'eraser');
  check(
    "the eraser's size and shape are its own: set past 1 px and square on E, B returns a 1 px circle pencil, E again finds the eraser's settings held",
    Number(readoutNums(sized)) > 1 &&
      pencil.optsReadout === '1 px' &&
      pencil.tipShape === 'circle' &&
      eraser.tipShape === 'square' &&
      Number(readoutNums(eraser)) > 1,
    JSON.stringify({
      eraserSet: sized.optsReadout,
      pencil: { size: pencil.optsReadout, shape: pencil.tipShape },
      eraserHeld: { size: eraser.optsReadout, shape: eraser.tipShape },
    })
  );
  // Back to a 1 px circle for the stroke, then an erase drag across the
  // body: (20,24) sits exactly on the Bresenham run from (8,14) to (32,34).
  await pickShape('circle');
  await click(slider.x, slider.y);
  await keyPress('Home');
  await settle((p) => readoutNums(p) === '1');
  const statsBefore = JSON.stringify((await probe()).stats);
  await drag(await at(8, 14), await at(32, 34));
  check(
    'an eraser drag clears the stroked texels',
    await cleared(20, 24),
    JSON.stringify(await texelAt(20, 24))
  );
  const s = await settle((p) => JSON.stringify(p.stats) !== statsBefore);
  check(
    'the erase reaches the voxel pipeline: the mesh rebuilds (the tri count moves; voxels do not — trap 2)',
    JSON.stringify(s.stats) !== statsBefore,
    `${statsBefore} → ${JSON.stringify(s.stats)}`
  );
}

async function s11_eyedropper() {
  section('S11 the eyedropper');
  const boot = await freshPage();
  const p1 = await at(20, 26);
  await click(p1.x, p1.y, { modifiers: ALT });
  let s = await settle((p) => p.inkColor !== boot.inkColor);
  check(
    'Alt-click samples the sprite into the ink',
    s.inkColor !== boot.inkColor && /^#[0-9a-f]{6}$/.test(s.inkColor || ''),
    `${boot.inkColor} → ${s.inkColor}`
  );
  const firstInk = s.inkColor;
  // A second sample of a DIFFERENT color, so the sticky-tool check has a
  // real ink change to observe when it re-samples the first texel.
  for (const [px, py] of [
    [20, 20],
    [16, 30],
    [12, 24],
    [24, 18],
  ]) {
    const t = await texelAt(px, py);
    if (t[3] === 255 && hex(t) !== firstInk) {
      const p = await at(px, py);
      await click(p.x, p.y, { modifiers: ALT });
      await settle((q) => q.inkColor === hex(t));
      break;
    }
  }
  await keyPress('i');
  await settle((p) => p.drawTool === 'eyedropper');
  await click(p1.x, p1.y);
  s = await settle((p) => p.inkColor === firstInk);
  check(
    'the eyedropper tool samples on a click and stays selected',
    s.inkColor === firstInk && s.drawTool === 'eyedropper',
    JSON.stringify({ ink: s.inkColor, want: firstInk, tool: s.drawTool })
  );
}

async function s12_rect() {
  section('S12 the rect tool');
  await keyPress('r');
  await settle((p) => p.drawTool === 'rectangle');
  let rectMid = null;
  await drag(await at(30, 4), await at(34, 8), {
    beforeRelease: async () => {
      rectMid = await settle((p) => readoutNums(p) === '5,5', 3000);
      await keyPress('Escape');
    },
  });
  const s = await settle((p) => readoutNums(p) === '0,0');
  const escaped = await texelAt(32, 6);
  check(
    'Esc mid-drag writes nothing, the readout back to 0 × 0',
    escaped[3] === 0 && readoutNums(s) === '0,0',
    JSON.stringify({ texel: escaped, readout: s.optsReadout })
  );
  await drag(await at(30, 4), await at(34, 8));
  const committed = await painted(32, 6);
  check(
    'a drag reads its box as width × height mid-flight and commits it on release',
    !!rectMid && readoutNums(rectMid) === '5,5' && committed,
    JSON.stringify({ mid: rectMid?.optsReadout, texel: await texelAt(32, 6) })
  );
}

async function s13_selection() {
  section('S13 the selection tool');
  await freshPage();
  await keyPress('s');
  await settle((p) => p.drawTool === 'selection');
  await drag(await at(30, 4), await at(34, 8));
  await until(antsUp);
  let s = await settle((p) => readoutNums(p) === '5,5');
  check(
    'a marquee drag puts the ants up, reads its size, and writes nothing (no undo step)',
    (await antsUp()) &&
      readoutNums(s) === '5,5' &&
      (await texelAt(32, 6))[3] === 0 &&
      s.menuChecks.undoEnabled === false,
    JSON.stringify({ readout: s.optsReadout, undo: s.menuChecks.undoEnabled })
  );
  await keyPress('Escape');
  await until(async () => !(await antsUp()));
  const c = await at(20, 20);
  await click(c.x, c.y);
  await sleep(150);
  const noneAfterClick = !(await antsUp());
  const texelPx = s.rect.width / s.tileW;
  const wiggle = Math.min(5, Math.floor(texelPx / 2) - 1);
  await drag(c, { x: c.x + wiggle, y: c.y + wiggle });
  await until(antsUp);
  s = await settle((p) => readoutNums(p) === '1,1');
  check(
    'a click with no drag selects nothing; a wiggle inside one texel selects that texel (1 × 1 the smallest)',
    noneAfterClick && (await antsUp()) && readoutNums(s) === '1,1',
    JSON.stringify({ noneAfterClick, readout: s.optsReadout, wiggle, texelPx })
  );
  await keyPress('Escape');
  await until(async () => !(await antsUp()));
  // Two pencil dots: A inside the marquee-to-be, B where a TRANSPARENT texel
  // of the float will land after the move.
  await keyPress('b');
  await settle((p) => p.drawTool === 'pencil');
  const pa = await at(32, 6);
  const pb = await at(30, 16);
  await click(pa.x, pa.y);
  await click(pb.x, pb.y);
  await painted(32, 6);
  await painted(30, 16);
  const inkA = hex(await texelAt(32, 6));
  const inkB = hex(await texelAt(30, 16));
  await keyPress('s');
  await settle((p) => p.drawTool === 'selection');
  await drag(await at(30, 4), await at(34, 8));
  await until(antsUp);
  // The move: grab A's texel, drag it ten rows down.
  await drag(await at(32, 6), await at(32, 16));
  await painted(32, 16);
  s = await probe();
  const movedA = await texelAt(32, 16);
  const hole = await texelAt(32, 6);
  const keptB = await texelAt(30, 16);
  check(
    'dragging inside the marquee moves the painted texel, leaves transparency behind, keeps the art under a transparent float texel, and is one undo step',
    hex(movedA) === inkA &&
      movedA[3] === 255 &&
      hole[3] === 0 &&
      hex(keptB) === inkB &&
      keptB[3] === 255 &&
      (await antsUp()) &&
      s.menuChecks.undoEnabled === true,
    JSON.stringify({ movedA, hole, keptB, undo: s.menuChecks.undoEnabled })
  );
  await keyPress('z', META);
  await painted(32, 6);
  check(
    '⌘Z puts the texel back, and the structural change drops the selection',
    (await texelAt(32, 6))[3] === 255 &&
      (await texelAt(32, 16))[3] === 0 &&
      !(await antsUp()),
    JSON.stringify({ origin: await texelAt(32, 6), moved: await texelAt(32, 16) })
  );
  await keyPress('s');
  await settle((p) => p.drawTool === 'selection');
  await drag(await at(30, 4), await at(34, 8));
  await until(antsUp);
  await keyPress('Escape');
  const escDropped = await until(async () => !(await antsUp()));
  await drag(await at(30, 4), await at(34, 8));
  await until(antsUp);
  await keyPress('b');
  const switchDropped = await until(async () => !(await antsUp()));
  check(
    'Esc drops the selection, and so does a tool switch',
    escDropped && switchDropped,
    JSON.stringify({ escDropped, switchDropped })
  );
}

async function s15_faceSwap() {
  section('S15 a face swap');
  await freshPage();
  const p = await at(20, 26);
  await click(p.x, p.y, { modifiers: ALT });
  await keyPress('g'); // the fill tool, so a survivor is visible
  const before = await settle((q) => q.drawTool === 'fill');
  const radio = await centreOf('vf-radio[value="top"]');
  await click(radio.x, radio.y);
  const s = await settle((q) => q.face === 'top');
  check(
    'clicking a face radio switches the edited face; the tool and the ink survive the swap',
    s.face === 'top' &&
      s.checkedRadio === 'top' &&
      s.drawTool === 'fill' &&
      s.inkColor === before.inkColor,
    JSON.stringify({
      face: s.face,
      radio: s.checkedRadio,
      tool: s.drawTool,
      ink: [before.inkColor, s.inkColor],
    })
  );
}

async function s16_properties() {
  section('S16 Properties');
  const boot = await freshPage();
  const TILE = boot.tileW;
  await pickMenu('#menu-file', 'properties');
  const open = await evaluate(`(() => {${DEEP} return !!__q('#dlg-props').open; })()`);
  const up = await stepperUp('#props-tile');
  await click(up.x, up.y);
  const stepped = (await settle((p) => p.tileW > TILE)).tileW;
  await typeInto('#props-tile', '24');
  const typed = await settle((p) => p.tileW === 24);
  check(
    'Properties: the stepper and a typed value retile the document, the editor staying on its face',
    open && stepped > TILE && typed.tileW === 24 && typed.face === 'front',
    JSON.stringify({ open, boot: TILE, stepped, typed: typed.tileW, face: typed.face })
  );
  const ok = await centreOf('#btn-props-ok');
  await click(ok.x, ok.y);
  await settle((p) => p.anyModalOpen === false);
  await keyPress('z', META);
  const s = await settle((p) => p.tileW === stepped);
  check(
    '⌘Z undoes the typed resize back to the stepped size',
    s.tileW === stepped,
    `tileW=${s.tileW} vs ${stepped}`
  );
}

async function s17_derivedFace() {
  section('S17 a mirror-derived face');
  await freshPage();
  const gotoFace = async (face) => {
    const p = await centreOf(`vf-radio[value="${face}"]`);
    await click(p.x, p.y);
    return settle((q) => q.face === face);
  };
  const canvasEmpty = () => layerIsEmpty('.editor-canvas');
  // The onion-skin is the background layer's only painter, so "showing" is
  // a texel with a partial alpha — MIRROR_ALPHA's tint of the opposite face.
  const onionSkinShowing = () =>
    evaluate(`(() => {${DEEP}
      const c = __qd('.editor-canvas-bg');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0 && d[i] < 255) return true;
      return false;
    })()`);
  // The car sample draws every face but RIGHT, so `right` opens derived.
  await gotoFace('right');
  await until(onionSkinShowing);
  const opensEmpty = (await canvasEmpty()) && (await onionSkinShowing());
  await gotoFace('front');
  await gotoFace('right');
  check(
    'a mirror-derived face opens with an empty canvas over the faded onion-skin of its opposite, and stays derived while untouched',
    opensEmpty && (await canvasEmpty()),
    JSON.stringify({ opensEmpty, stillEmpty: await canvasEmpty() })
  );
  await keyPress('b');
  await settle((p) => p.drawTool === 'pencil');
  const p = await at(12, 12);
  await click(p.x, p.y);
  await painted(12, 12);
  await gotoFace('front');
  await gotoFace('right');
  check(
    'painting a derived face writes a texel that keeps across swaps (its own art now)',
    (await texelAt(12, 12))[3] === 255,
    JSON.stringify(await texelAt(12, 12))
  );
  await keyPress('e');
  await settle((q) => q.drawTool === 'eraser');
  await click(p.x, p.y);
  await cleared(12, 12);
  const blank = await canvasEmpty();
  await gotoFace('front');
  await gotoFace('right');
  await until(onionSkinShowing);
  check(
    'erasing the last texel blanks the face, and it reverts to derived (empty over the onion-skin)',
    blank && (await canvasEmpty()) && (await onionSkinShowing()),
    JSON.stringify({ blank, empty: await canvasEmpty(), onion: await onionSkinShowing() })
  );
}

async function s18_colorsDialog() {
  section('S18 the Colors dialog');
  const boot = await freshPage();
  const inkBefore = boot.inkColor;
  const pickerForm = () =>
    evaluate(
      `(() => { const p = document.querySelector('sm-color-picker');
        return { hex: p.querySelector('.picker-hex').value,
                 preview: p.querySelector('.picker-preview').getAttribute('color'),
                 okDisabled: p.querySelector('.picker-ok').disabled }; })()`
    );
  const selectHexField = () =>
    evaluate(
      `(() => { const input = document.querySelector('sm-color-picker .picker-hex')
        .shadowRoot.querySelector('input');
        input.focus(); input.select(); })()`
    );
  const swatch = await centreOf('.editor-selected');
  await click(swatch.x, swatch.y);
  let s = await settle((p) => p.colorsOpen);
  let form = await pickerForm();
  check(
    'the ink swatch opens the Colors dialog seeded from the current ink',
    s.colorsOpen === true && form.hex === inkBefore && form.preview === inkBefore,
    JSON.stringify({ open: s.colorsOpen, form, ink: inkBefore })
  );
  // A cell whose color differs from the ink, so a change is observable.
  const cell = await evaluate(
    `(() => {${DEEP} const cells = __qa('.editor-picker-grid vf-swatch');
      const c = cells.find((x) => x.getAttribute('color') !== '${inkBefore}');
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2,
               color: c.getAttribute('color') }; })()`
  );
  await click(cell.x, cell.y);
  await until(async () => (await pickerForm()).hex === cell.color);
  s = await probe();
  form = await pickerForm();
  check(
    'a swatch click selects but does not commit: the dialog stays open with the pick in its form, the ink untouched',
    s.colorsOpen === true &&
      s.inkColor === inkBefore &&
      form.hex === cell.color &&
      form.preview === cell.color,
    JSON.stringify({ open: s.colorsOpen, ink: s.inkColor, form, cell: cell.color })
  );
  const okBtn = await centreOf('.picker-ok');
  await click(okBtn.x, okBtn.y);
  s = await settle((p) => !p.colorsOpen);
  check(
    'OK closes the dialog and commits the selection as the ink',
    s.colorsOpen === false && s.inkColor === cell.color,
    JSON.stringify({ open: s.colorsOpen, ink: s.inkColor, cell: cell.color })
  );
  // Manual hex entry: an invalid string disables OK; a valid one (any color,
  // not just the 168) re-enables it and Enter is OK. The entries are typed
  // HASH-LESS (a form the field accepts) because '#' is untypeable here:
  // keyDesc's virtual-key code for '#' is 35 — VK_END.
  await keyPress('k', META);
  await settle((p) => p.colorsOpen);
  await selectHexField();
  await typeText('12z');
  await until(async () => (await pickerForm()).okDisabled === true);
  const invalid = await pickerForm();
  await selectHexField();
  await typeText('123abc');
  await until(async () => (await pickerForm()).okDisabled === false);
  await keyPress('Enter');
  s = await settle((p) => !p.colorsOpen);
  check(
    'an invalid hex entry disables OK; a valid one typed and entered commits the ink',
    invalid.okDisabled === true && s.colorsOpen === false && s.inkColor === '#123abc',
    JSON.stringify({ invalid, open: s.colorsOpen, ink: s.inkColor })
  );
  await keyPress('k', META);
  await settle((p) => p.colorsOpen);
  const other = await evaluate(
    `(() => {${DEEP} const c = __qa('.editor-picker-grid vf-swatch')
        .find((x) => x.getAttribute('color') !== '#123abc');
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
  );
  await click(other.x, other.y);
  await until(async () => (await pickerForm()).hex !== '#123abc');
  const cancel = await centreOf('.picker-cancel');
  await click(cancel.x, cancel.y);
  s = await settle((p) => !p.colorsOpen);
  check(
    'Cancel discards the pending selection (the ink keeps)',
    s.colorsOpen === false && s.inkColor === '#123abc',
    JSON.stringify({ open: s.colorsOpen, ink: s.inkColor })
  );
}

async function s19_undoRedo() {
  section('S19 undo / redo');
  const boot = await freshPage();
  const bootDisabled = boot.menuChecks.undoEnabled === false;
  await keyPress('b');
  const p = await at(2, 2);
  await click(p.x, p.y);
  await painted(2, 2);
  let s = await settle((q) => q.menuChecks.undoEnabled);
  check(
    'Undo boots disabled and a committed gesture enables it',
    bootDisabled && s.menuChecks.undoEnabled === true,
    JSON.stringify({ bootDisabled, after: s.menuChecks })
  );
  await keyPress('z', META);
  const undone = await cleared(2, 2);
  await keyPress('z', META | SHIFT);
  const redone = await painted(2, 2);
  s = await settle((q) => q.menuChecks.undoEnabled && !q.menuChecks.redoEnabled);
  check(
    '⌘Z undoes the stroke and ⇧⌘Z redoes it, the menu enablement following the stacks',
    undone &&
      redone &&
      s.menuChecks.undoEnabled === true &&
      s.menuChecks.redoEnabled === false,
    JSON.stringify({ undone, redone, menu: s.menuChecks })
  );
}

async function s20_toolsMenu() {
  section('S20 the Tools menu');
  await freshPage();
  await pickMenu('#menu-tools', 'tool-eraser');
  const s = await settle((p) => p.drawTool === 'eraser');
  check(
    'a Tools menu pick selects the tool and moves the checkmark',
    s.drawTool === 'eraser' && s.menuChecks.tool === 'eraser',
    JSON.stringify({ strip: s.drawTool, menu: s.menuChecks.tool })
  );
}

// --- the desktop: windows, roles, windoids ---------------------------------
async function s21_windows() {
  section('S21 windows: Arrange, ⌘J, the zoom box, re-fits, press picks');
  await freshPage();
  const stageSize = () =>
    evaluate(
      `(() => {${DEEP} const w = __q('#win-stage');
        return { w: w.width, h: w.height, cw: __q('#viewport').clientWidth }; })()`
    );
  const drawWidth = () =>
    evaluate(
      `(() => {${DEEP} return __qd('.editor-canvas').getBoundingClientRect().width; })()`
    );
  const posBefore = await docBox();
  const sizeBefore = await stageSize();
  await dragWindow(`__doc()`, 40, 24, 9);
  await growWindow(`__q('#win-stage')`, 30, 20);
  const posAfter = await docBox();
  const sizeAfter = await stageSize();
  if (posAfter.left === posBefore.left || sizeAfter.w === sizeBefore.w)
    throw new Error(
      'the drag / grow did not move the windows: ' +
        JSON.stringify({ posAfter, sizeAfter })
    );
  await pickMenu('#menu-view', 'arrange');
  const arranged = { doc: await docBox(), stage: await stageSize() };
  check(
    'View → Arrange Windows puts the dragged document window and the grown 3D View back on their placement',
    arranged.doc.left === posBefore.left &&
      arranged.doc.top === posBefore.top &&
      arranged.stage.w === sizeBefore.w &&
      arranged.stage.h === sizeBefore.h,
    JSON.stringify({ posBefore, posAfter, sizeBefore, sizeAfter, arranged })
  );
  check(
    'the THREE canvas re-fits when the grow box grows the 3D View',
    sizeAfter.cw > sizeBefore.cw,
    JSON.stringify({ before: sizeBefore, after: sizeAfter })
  );
  // ⌘J is a STATE rule: Arrange Windows while anything is off its placement
  // (the chord lands the arrangement), Zoom Window once everything is
  // arranged (the chord zooms the active window right and down with its
  // top-left held; a window zoomed from its slot still reads arranged, so
  // the next chord restores it).
  await dragWindow(`__doc()`, 40, 24, 9);
  const off = await probe();
  await keyPress('j', META);
  const keyArranged = await until(async () => {
    const b = await docBox();
    return b.left === posBefore.left && b.top === posBefore.top;
  });
  const on = await probe();
  check(
    '⌘J reads Arrange Windows while a window is off its placement, and the chord puts it back; arranged, the item turns to Zoom Window',
    off.menuEnabled.arrangeValue === 'arrange' &&
      keyArranged &&
      on.menuEnabled.arrange === true &&
      on.menuEnabled.arrangeValue === 'zoom',
    JSON.stringify({ off: off.menuEnabled, keyArranged, on: on.menuEnabled })
  );
  const arrangedDoc = await docBox();
  await keyPress('j', META);
  await until(async () => (await docBox()).w !== arrangedDoc.w);
  const zoomed = await docBox();
  const mid = await probe();
  await keyPress('j', META);
  await until(async () => (await docBox()).w === arrangedDoc.w);
  const restored = await docBox();
  const after = await probe();
  check(
    'arranged, ⌘J zooms the active window right and down with its top-left held, and the next ⌘J restores it — the item staying Zoom Window',
    zoomed.left === arrangedDoc.left &&
      zoomed.top === arrangedDoc.top &&
      zoomed.w > arrangedDoc.w &&
      zoomed.h > arrangedDoc.h &&
      mid.menuEnabled.arrangeValue === 'zoom' &&
      JSON.stringify(restored) === JSON.stringify(arrangedDoc) &&
      after.menuEnabled.arrangeValue === 'zoom',
    JSON.stringify({ arrangedDoc, zoomed, restored })
  );
  // The zoom box remembers the size it grew FROM: probed right after a
  // grow-box shrink, so the restore provably returns the remembered size
  // and not the placement default.
  const zoomClick = async () => {
    const b = await evaluate(
      `(() => {${DEEP} const z = __doc().shadowRoot
          .querySelector('[part="zoom-box"]').getBoundingClientRect();
        return { x: z.left + z.width / 2, y: z.top + z.height / 2 }; })()`
    );
    await click(b.x, b.y);
  };
  await growWindow(`__doc()`, -40, -28);
  const preZoom = await docBox();
  if (preZoom.w === arrangedDoc.w)
    throw new Error(
      'the grow-box shrink did not change the size: ' + JSON.stringify(preZoom)
    );
  await zoomClick();
  await until(async () => (await docBox()).w !== preZoom.w);
  await zoomClick();
  await until(async () => (await docBox()).w === preZoom.w);
  const unzoomed = await docBox();
  check(
    'the zoom box returns the REMEMBERED pre-zoom size (a grow-box size, not the placement), top-left held',
    JSON.stringify(unzoomed) === JSON.stringify(preZoom),
    JSON.stringify({ preZoom, unzoomed })
  );
  await pickMenu('#menu-view', 'arrange');
  // The draw canvas re-fits when its window grows. The document window is
  // pulled left first so its grow box is clear of the windoid rail above it.
  await dragWindow(`__doc()`, -80, 0, 9);
  const drawBefore = await drawWidth();
  await growWindow(`__doc()`, 96, 96);
  const refit = await until(async () => (await drawWidth()) > drawBefore);
  check(
    'the draw canvas re-fits when the grow box grows the document window',
    refit,
    `${drawBefore} → ${await drawWidth()}`
  );
  // Press picks: the Tools palette's cells and the Sprite View's face tiles
  // act on mouse-down (System 7's palettes), probed BETWEEN the press and
  // the release, so the switch is provably the press's; the release's click
  // must be a no-op.
  let s = await probe();
  const gridTarget = s.face === 'back' ? 'front' : 'back';
  const gridCell = await centreOf(`.atlas-cell[data-face="${gridTarget}"]`);
  await mouse('mousePressed', gridCell.x, gridCell.y);
  const pressed = await settle((p) => p.face === gridTarget, 2000);
  await mouse('mouseReleased', gridCell.x, gridCell.y, { buttons: 0 });
  await sleep(200);
  s = await probe();
  check(
    'an atlas grid tile picks its face on the PRESS (the palette feel), the release a no-op, the picker radios following',
    pressed.face === gridTarget && s.face === gridTarget && s.checkedRadio === gridTarget,
    JSON.stringify({ onPress: pressed.face, after: s.face, radio: s.checkedRadio })
  );
  const pressTool = s.drawTool === 'fill' ? 'pencil' : 'fill';
  const toolCell = await centreOf(`.editor-tool[aria-label="${pressTool}"]`);
  await mouse('mousePressed', toolCell.x, toolCell.y);
  const toolPressed = await settle((p) => p.drawTool === pressTool, 2000);
  await mouse('mouseReleased', toolCell.x, toolCell.y, { buttons: 0 });
  await sleep(200);
  s = await probe();
  check(
    'a tool cell picks on the PRESS (the palette feel), the release a no-op, the Tools menu following',
    toolPressed.drawTool === pressTool &&
      s.drawTool === pressTool &&
      s.menuChecks.tool === pressTool,
    JSON.stringify({
      onPress: toolPressed.drawTool,
      after: s.drawTool,
      menu: s.menuChecks.tool,
    })
  );
}

async function s22_twoRoles() {
  section('S22 the two roles: desktop focus and the application');
  await freshPage();
  const BARE = await bareSpot();
  await click(BARE.x, BARE.y);
  let s = await settle((p) => p.docActive === false);
  const deactivated = { ...s };
  await keyPress('r');
  await sleep(150);
  s = await probe();
  check(
    'a desktop click deactivates the application: the windoids and the strip hide, the Finder grammar lands, the tool keys go inert',
    deactivated.docActive === false &&
      deactivated.windows.document &&
      !deactivated.windows.tools &&
      !deactivated.windows.sprite &&
      !deactivated.windows.stage &&
      deactivated.optionsStrip === false &&
      deactivated.menuEnabled.newDoc === true &&
      deactivated.menuEnabled.open === true &&
      deactivated.menuEnabled.save === false &&
      deactivated.menuEnabled.close === false &&
      deactivated.menuEnabled.pickColor === false &&
      deactivated.menuEnabled.arrange === false &&
      s.drawTool === 'pencil',
    JSON.stringify({
      docActive: deactivated.docActive,
      windows: deactivated.windows,
      strip: deactivated.optionsStrip,
      menus: deactivated.menuEnabled,
      toolAfterR: s.drawTool,
    })
  );
  // Selecting a desktop icon is working in the Finder: File → Open acts on
  // the selection (a bare Open, no dialog), opens it, and the activation
  // clears the selection. (The seeded Car's key is a random id — by label.)
  const carIcon = await evaluate(`(() => {${DEEP}
    const i = __qa('vf-icon[data-key]').find((el) => el.label === 'Car');
    const r = i.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await click(carIcon.x, carIcon.y);
  await until(async () => (await selectedIcons()).join(',') === 'Car');
  await pickMenu('#menu-file', 'open');
  s = await settle((p) => p.docActive && p.docWindows === 2);
  const selected = await selectedIcons();
  check(
    'selecting a desktop icon aims File → Open at it: the pick opens it, reactivates the application, and clears the selection',
    s.docActive === true &&
      s.docWindows === 2 &&
      s.windows.tools &&
      s.windows.sprite &&
      s.windows.stage &&
      s.optionsStrip &&
      selected.length === 0,
    JSON.stringify({ docActive: s.docActive, docWindows: s.docWindows, selected })
  );
  // With the desktop focused and NOTHING selected, Open… is the Finder's
  // browse: the listing dialog; Cancel leaves the desktop focused.
  await click(BARE.x, BARE.y);
  await settle((p) => p.docActive === false);
  await pickMenu('#menu-file', 'open');
  const openDlgUp = () => evaluate(`document.querySelector('#dlg-open').open`);
  const listingUp = await until(openDlgUp);
  const cancel = await centreOf('#btn-open-cancel');
  await click(cancel.x, cancel.y);
  await until(async () => !(await openDlgUp()));
  s = await probe();
  check(
    'with nothing selected, File → Open… from the Finder raises the listing dialog; Cancel leaves the desktop focused',
    listingUp &&
      (await openDlgUp()) === false &&
      s.docActive === false &&
      s.docWindows === 2,
    JSON.stringify({ listingUp, docActive: s.docActive, docs: s.docWindows })
  );
  const bar = await docBarPoint();
  await click(bar.x, bar.y);
  s = await settle((p) => p.docActive === true);
  check(
    'clicking the document window reactivates: windoids and strip return',
    s.docActive === true &&
      s.windows.tools &&
      s.windows.sprite &&
      s.windows.stage &&
      s.optionsStrip,
    JSON.stringify({ docActive: s.docActive, windows: s.windows, strip: s.optionsStrip })
  );
  // Off its placement, the ⌘J item is Arrange Windows in BOTH roles: the
  // pick from the Finder lands the arrangement without activating anything.
  await dragWindow(`__doc()`, 40, 24, 9);
  const BARE_OFF = await bareSpot();
  await click(BARE_OFF.x, BARE_OFF.y);
  const finder = await settle((p) => p.docActive === false);
  await pickMenu('#menu-view', 'arrange');
  s = await settle((p) => p.menuEnabled.arrangeValue === 'zoom');
  check(
    'off its placement the ⌘J item is live in the Finder role too, and the pick arranges without activating anything',
    finder.menuEnabled.arrange === true &&
      finder.menuEnabled.arrangeValue === 'arrange' &&
      s.docActive === false &&
      s.menuEnabled.arrangeValue === 'zoom' &&
      s.menuEnabled.arrange === false,
    JSON.stringify({
      finder: finder.menuEnabled,
      after: s.menuEnabled,
      docActive: s.docActive,
    })
  );
}

async function s23_spriteAtlas() {
  section('S23 the 3D Sprite Atlas');
  const boot = await freshPage();
  const ringBox = () =>
    evaluate(
      `(() => {${DEEP} const w = __q('#win-ring'); const d = __q('#desktop'); const doc = __doc();
        const num = (sel) => { const f = __q(sel); return f ? +f.value : null; };
        const cell = __q('.ring-cell');
        const paper = __q('sm-ring-view')?.shadowRoot?.querySelector('.ring-paper');
        return { left: w.left, top: w.top, w: w.width, h: w.height, dw: d.width, dh: d.height,
          docLeft: doc ? doc.left : null,
          cells: __qa('.ring-cell').length,
          views: num('.ring-views'), elev: num('.ring-elev'), offset: num('.ring-offset'),
          size: num('.ring-size'),
          cell: cell ? Math.round(cell.getBoundingClientRect().width) : null,
          paper: paper ? paper.getAttribute('pattern') : null }; })()`
    );
  const cellPixels = () =>
    evaluate(
      `(() => {${DEEP} return __qa('.ring-cell canvas').map((c) => {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0; let hash = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] === 255) n++;
          hash = (hash * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11) >>> 0;
        }
        return { w: c.width, h: c.height, opaque: n, hash }; }); })()`
    );
  const rendered = (n, size) =>
    until(async () => {
      const cells = await cellPixels();
      return (
        cells.length === n &&
        cells.every((c) => c.w === size && c.h === size && c.opaque > 0)
      );
    });
  const bootHidden = boot.ringShown === false && boot.menuChecks.ring === false;
  await pickMenu('#menu-view', 'ring');
  let s = await settle((p) => p.ringShown);
  let rb = await ringBox();
  const S0 = rb.size;
  await rendered(4, S0);
  let cells = await cellPixels();
  check(
    "View → 3D Sprite Atlas shows the windoid (it boots hidden, the item unchecked) docked at the document's left on the bottom margin, and checks the item",
    bootHidden &&
      s.ringShown === true &&
      s.menuChecks.ring === true &&
      rb.left === rb.docLeft &&
      rb.top + rb.h === rb.dh - 8 &&
      rb.cells === 4 &&
      rb.views === 4,
    JSON.stringify({ bootHidden, shown: s.ringShown, checked: s.menuChecks.ring, rb })
  );
  check(
    'every cell holds a rendered frame of the model at the tile size, each facing its own',
    cells.length === 4 &&
      cells.every((c) => c.w === S0 && c.h === S0 && c.opaque > 0) &&
      new Set(cells.map((c) => c.hash)).size === 4 &&
      rb.cell === S0,
    JSON.stringify({ S0, cell: rb.cell, cells })
  );
  const h0 = rb.h;
  const top0 = rb.top;
  const left0 = rb.left;
  const w0 = rb.w;
  // The strip's views stepper adds cells (autorepeat can land more than one
  // step, so assert direction).
  const up = await stepperUp('.ring-views');
  await click(up.x, up.y);
  await until(async () => (await ringBox()).cells > 4);
  rb = await ringBox();
  await rendered(rb.cells, S0);
  cells = await cellPixels();
  check(
    'the views stepper adds cells and every new cell renders',
    rb.cells > 4 &&
      rb.cells === rb.views &&
      cells.length === rb.cells &&
      cells.every((c) => c.w === S0 && c.opaque > 0),
    JSON.stringify({ cells: rb.cells, views: rb.views })
  );
  // The size field: typed to 128, the windoid's HEIGHT follows by exactly
  // the tile's growth (the chrome over one row of size-px cells) with its
  // top-left held and its width holding, and every cell is 128.
  await typeInto('.ring-size', '128');
  await until(async () => (await ringBox()).size === 128);
  rb = await ringBox();
  await rendered(rb.cells, 128);
  cells = await cellPixels();
  check(
    "a tile size typed in the strip re-derives the windoid's height by the tile's growth (the top-left held, the width holding) and re-sizes every cell 1:1",
    rb.size === 128 &&
      rb.h - h0 === 128 - S0 &&
      rb.top === top0 &&
      rb.left === left0 &&
      rb.w === w0 &&
      rb.cell === 128 &&
      cells.length === rb.cells &&
      cells.every((c) => c.w === 128 && c.h === 128 && c.opaque > 0),
    JSON.stringify({ rb, h0, S0, cells: cells.length })
  );
  // File → Export Sprite Atlas…: the dialog reads the strip's settings and
  // edits them LIVE behind the modal.
  const ringDialog = () =>
    evaluate(
      `(() => {${DEEP} return {
          open: __q('#dlg-export-atlas').open,
          views: __q('#atlas-views').value, elevation: __q('#atlas-elevation').value,
          offset: __q('#atlas-offset').value, size: __q('#atlas-size').value,
          exportEnabled: !__q('#btn-export-atlas-ok').disabled }; })()`
    );
  await pickMenu('#menu-file', 'export-atlas');
  await until(async () => (await ringDialog()).open);
  const seededDlg = await ringDialog();
  await typeInto('#atlas-views', '8');
  await until(async () => (await ringBox()).cells === 8);
  rb = await ringBox();
  const live = await ringDialog();
  check(
    'File → Export Sprite Atlas… opens seeded from the strip with Export enabled; a view count typed there moves the strip behind the modal at once',
    seededDlg.open === true &&
      seededDlg.views === String(rb.views === 8 ? seededDlg.views : rb.views) &&
      seededDlg.elevation === String(rb.elev) &&
      seededDlg.offset === String(rb.offset) &&
      seededDlg.size === '128' &&
      seededDlg.exportEnabled === true &&
      rb.cells === 8 &&
      live.views === '8',
    JSON.stringify({ seeded: seededDlg, live, rb })
  );
  // Export = the strip's sheet: the download lands in the run's temp dir,
  // and the file's IHDR and text chunks are read back.
  await send('Browser.setDownloadBehavior', {
    behavior: 'allowAndName',
    downloadPath: userDir,
    eventsEnabled: true,
  });
  downloads.clear();
  const exportBtn = await centreOf('#btn-export-atlas-ok');
  await click(exportBtn.x, exportBtn.y);
  await until(async () => [...downloads.values()].some((d) => d.state === 'completed'));
  const exported = [...downloads.values()].find((d) => d.state === 'completed') || null;
  let verdict = false;
  let detail = JSON.stringify([...downloads.values()]);
  if (exported) {
    const file = join(userDir, exported.guid);
    const bytes = new Uint8Array(readFileSync(file));
    const u32 = (o) =>
      ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>>
      0;
    const ihdr = { w: u32(16), h: u32(20) };
    const meta = readTextChunks(bytes);
    let ringMeta = null;
    try {
      ringMeta = JSON.parse(meta['sprite-machine:ring'] || 'null');
    } catch {}
    verdict =
      ihdr.w === 8 * 128 &&
      ihdr.h === 128 &&
      /-atlas\.png$/.test(exported.name) &&
      !!ringMeta &&
      ringMeta.views === 8 &&
      ringMeta.elevation === rb.elev &&
      ringMeta.size === 128 &&
      ringMeta.frame === 128 &&
      typeof ringMeta.scale === 'number' &&
      ringMeta.scale > 0 &&
      ringMeta.yaws.length === 8 &&
      ringMeta.yaws[1] === 45 &&
      typeof ringMeta.anchor?.y === 'number' &&
      typeof meta.Title === 'string' &&
      typeof meta.Software === 'string';
    detail = JSON.stringify({ ihdr, name: exported.name, ringMeta, Title: meta.Title });
    if (KEEP_DOWNLOADS) {
      mkdirSync(KEEP_DOWNLOADS, { recursive: true });
      copyFileSync(file, join(KEEP_DOWNLOADS, exported.name));
    }
  }
  check(
    'Export writes the sheet as «slug»-atlas.png at views·size × size with the sprite-machine:ring chunk beside Title and Software',
    verdict,
    detail
  );
  await settle((p) => p.anyModalOpen === false);
  // The close box — the kit's, kept on this one windoid — is the View
  // item's uncheck; the item brings it back where it was, cells intact.
  const closeBox = await evaluate(
    `(() => {${DEEP} const r = __q('#win-ring').shadowRoot
        .querySelector('[part="close-box"]').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
  );
  const pos = { left: rb.left, top: rb.top };
  await click(closeBox.x, closeBox.y);
  const closed = await settle((p) => p.ringShown === false);
  await pickMenu('#menu-view', 'ring');
  s = await settle((p) => p.ringShown);
  rb = await ringBox();
  check(
    'the close box hides the windoid and unchecks the View item; the item brings it back where it was, cells intact',
    closed.ringShown === false &&
      closed.menuChecks.ring === false &&
      s.ringShown === true &&
      rb.cells === 8 &&
      rb.left === pos.left &&
      rb.top === pos.top,
    JSON.stringify({ closed: closed.menuChecks.ring, rb, pos })
  );
  // The capture hook seeds every setting, the paper included (the one
  // writer of the paper today; the slice's gray is a kit dither, so the
  // paper reads as something other than the default white).
  await send('Page.navigate', { url: `${URL}&ring=6,30,45,100,gray` });
  await waitForApp();
  s = await settle((p) => p.ringShown);
  await rendered(6, 100);
  rb = await ringBox();
  cells = await cellPixels();
  check(
    '?ring=6,30,45,100,gray boots the windoid shown with those settings: six 100 px cells at 30° from 45° on a non-default paper',
    s.ringShown === true &&
      s.menuChecks.ring === true &&
      rb.cells === 6 &&
      rb.elev === 30 &&
      rb.offset === 45 &&
      rb.size === 100 &&
      rb.paper !== null &&
      rb.paper !== 'white' &&
      rb.cell === 100 &&
      cells.length === 6 &&
      cells.every((c) => c.w === 100 && c.h === 100 && c.opaque > 0),
    JSON.stringify({ shown: s.ringShown, rb, cells: cells.length })
  );
}

async function s24_desktopPatterns() {
  section('S24 Desktop Patterns');
  await freshPage();
  const patternsProbe = () =>
    evaluate(`(() => {${DEEP}
      const d = document.querySelector('#desktop');
      const w = document.querySelector('#win-patterns');
      const body = w ? w.querySelector('sm-desktop-patterns') : null;
      const root = body && body.shadowRoot;
      const well = root ? root.querySelector('.well') : null;
      const cells = root ? [...root.querySelectorAll('.cell')] : [];
      return {
        desktop: d.pattern,
        open: !!w,
        active: !!w && w.hasAttribute('active'),
        well: well ? well.getAttribute('pattern') : null,
        ringed: cells.filter((c) => c.querySelector('.ring.on')).map((c) => c.title),
      };
    })()`);
  const cellCentre = (name) => centreOf(`.cell[title="${name}"]`);
  const closeBox = async () => {
    const p = await evaluate(`(() => {${DEEP}
      const w = document.querySelector('#win-patterns');
      const r = w.shadowRoot.querySelector('[part="close-box"]').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await click(p.x, p.y);
    await until(async () => !(await patternsProbe()).open);
  };
  const openPanel = async () => {
    await pickMenu('#menu-app', 'desktop-patterns');
    await until(async () => (await patternsProbe()).open);
    return patternsProbe();
  };
  const desktop0 = (await patternsProbe()).desktop;
  let pp = await openPanel();
  let s = await probe();
  check(
    "Sprite Machine → Desktop Patterns opens the panel as the Finder's window: the application deactivates (windoids and strip hide)",
    pp.open &&
      pp.active &&
      s.docActive === false &&
      !s.windows.tools &&
      !s.windows.sprite &&
      !s.windows.stage &&
      s.optionsStrip === false,
    JSON.stringify({ panel: pp, docActive: s.docActive, windows: s.windows })
  );
  const bricks = await cellCentre('bricks');
  await click(bricks.x, bricks.y);
  await until(async () => (await patternsProbe()).well === 'bricks');
  pp = await patternsProbe();
  check(
    'a cell click previews it in the well and rings it — the desktop untouched until Set',
    pp.well === 'bricks' &&
      JSON.stringify(pp.ringed) === '["bricks"]' &&
      pp.desktop === desktop0,
    JSON.stringify(pp)
  );
  const setBtn = await centreOf('.set');
  await click(setBtn.x, setBtn.y);
  await until(async () => (await patternsProbe()).desktop === 'bricks');
  const set = await patternsProbe();
  await closeBox();
  // A pick left unset is discarded by the close box; the next open seeds
  // from the desktop's current pattern, not the discarded pick.
  await openPanel();
  const waves = await cellCentre('waves');
  await click(waves.x, waves.y);
  await until(async () => (await patternsProbe()).well === 'waves');
  await closeBox();
  const discarded = await patternsProbe();
  const reopened = await openPanel();
  check(
    'Set Desktop Pattern writes the pending pattern onto the desktop; a pick without Set is discarded by the close box, and the next open seeds from the desktop',
    set.desktop === 'bricks' &&
      set.open &&
      discarded.desktop === 'bricks' &&
      reopened.well === 'bricks' &&
      JSON.stringify(reopened.ringed) === '["bricks"]',
    JSON.stringify({ set, discarded, reopened })
  );
  await closeBox();
  s = await settle((p) => p.docActive);
  pp = await patternsProbe();
  await freshPage();
  const afterReload = await patternsProbe();
  check(
    'the close box returns the application (document active, windoids up); the set pattern stays and a reload restores it',
    s.docActive &&
      s.windows.tools &&
      s.windows.sprite &&
      s.windows.stage &&
      pp.desktop === 'bricks' &&
      afterReload.desktop === 'bricks' &&
      !afterReload.open,
    JSON.stringify({ docActive: s.docActive, windows: s.windows, pp, afterReload })
  );
  // Back to the boot pattern through the panel, so the profile's later
  // scenarios boot on the default.
  await openPanel();
  const back = await cellCentre(desktop0);
  await click(back.x, back.y);
  await until(async () => (await patternsProbe()).well === desktop0);
  const setAgain = await centreOf('.set');
  await click(setAgain.x, setAgain.y);
  await until(async () => (await patternsProbe()).desktop === desktop0);
  await closeBox();
}

// The View menu's open-windows section against the document windows on
// screen: one item per window in CREATION order, the ACTIVE window's item
// checked and no other's, every item live; a separator before the first,
// nothing after the last, and with none open no dangling rule.
const windowListTrue = (vw) => {
  const wins = new Map(vw.windows.map((w) => [w.key, w]));
  const keys = vw.items.map((i) => String(i.value).slice('window:'.length));
  return (
    vw.items.length === vw.windows.length &&
    new Set(keys).size === keys.length &&
    keys.every((k) => wins.has(k)) &&
    keys.every((k, i) => i === 0 || +keys[i - 1].slice(1) < +k.slice(1)) &&
    vw.items.every(
      (it, i) =>
        it.enabled &&
        it.label === wins.get(keys[i]).heading &&
        it.checked === wins.get(keys[i]).active
    ) &&
    vw.atEnd &&
    (vw.items.length > 0 ? vw.separator : !vw.trailingSeparator)
  );
};
const windowItemOf = (vw, heading) =>
  vw.items.find((i) => i.label === heading)?.value ?? null;

async function s25_multipleDocuments() {
  section('S25 multiple documents');
  await freshPage(); // the Car sample, one window
  await newBlankDoc();
  let s = await settle((p) => p.docWindows === 2 && p.docActive);
  check(
    'File → New… opens a second window, active and untitled, the View menu listing both in creation order with the newcomer checked',
    s.docWindows === 2 &&
      s.docActive &&
      s.heading === 'untitled' &&
      windowListTrue(s.viewWindows) &&
      s.viewWindows.items.length === 2 &&
      s.viewWindows.items[1].checked === true &&
      s.viewWindows.items[0].checked === false,
    JSON.stringify({ docWindows: s.docWindows, heading: s.heading, list: s.viewWindows })
  );
  // Draw one texel in the untitled — ITS history, and the stage follows it:
  // the blank untitled read 0 voxels; a single face on a blank sheet builds
  // a voxel, so a nonzero count IS the proof this doc reached the stage.
  await keyPress('b');
  const p = await at(3, 3);
  await click(p.x, p.y);
  await painted(3, 3);
  s = await settle((q) => q.menuChecks.undoEnabled && q.voxels > 0);
  check(
    'a stroke in the untitled enables ITS undo and rebuilds the stage from it',
    s.menuChecks.undoEnabled === true && s.voxels > 0,
    JSON.stringify({ undo: s.menuChecks.undoEnabled, voxels: s.voxels })
  );
  const barOf = (heading) =>
    evaluate(
      `(() => {${DEEP}
        const win = [...document.querySelectorAll('vf-window')]
          .find((w) => w.id.startsWith('win-doc-') && w.heading === '${heading}');
        const r = win.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + 9 }; })()`
    );
  const carBar = await barOf('Car');
  await click(carBar.x, carBar.y);
  s = await settle((q) => q.heading === 'Car' && q.voxels > 100);
  check(
    'clicking the Car window activates it: title, undo enablement, the stage and the View menu check follow',
    s.heading === 'Car' &&
      s.docWindows === 2 &&
      s.menuChecks.undoEnabled === false &&
      s.voxels > 100 &&
      windowListTrue(s.viewWindows) &&
      s.viewWindows.items[0].checked === true,
    JSON.stringify({
      heading: s.heading,
      undo: s.menuChecks.undoEnabled,
      voxels: s.voxels,
    })
  );
  // Two windows on the cascade, the upper-left one (Car, on the first slot)
  // just RAISED: a permutation of the slots is still the arrangement, so
  // ⌘J zooms Car from its slot (the untitled untouched) and again restores
  // it — the reported case, where the chord SWAPPED the two windows.
  const docBoxes = () =>
    evaluate(
      `(() => {${DEEP}
        const out = {};
        for (const w of document.querySelectorAll('vf-window')) {
          if (w.id.startsWith('win-doc-'))
            out[w.heading] = { left: w.left, top: w.top, w: w.width, h: w.height };
        }
        return out; })()`
    );
  const twoUp = await docBoxes();
  const item = (await probe()).menuEnabled;
  await keyPress('j', META);
  await until(async () => (await docBoxes()).Car.w !== twoUp.Car.w);
  const carZoomed = await docBoxes();
  await keyPress('j', META);
  await until(async () => (await docBoxes()).Car.w === twoUp.Car.w);
  const carBack = await docBoxes();
  check(
    'with two windows on the cascade ⌘J reads Zoom Window and zooms the raised Car alone (the untitled untouched); ⌘J again restores it',
    item.arrangeValue === 'zoom' &&
      carZoomed.Car.left === twoUp.Car.left &&
      carZoomed.Car.top === twoUp.Car.top &&
      carZoomed.Car.w > twoUp.Car.w &&
      carZoomed.Car.h > twoUp.Car.h &&
      JSON.stringify(carZoomed.untitled) === JSON.stringify(twoUp.untitled) &&
      JSON.stringify(carBack) === JSON.stringify(twoUp),
    JSON.stringify({ item, twoUp, carZoomed, carBack })
  );
  // View → Arrange Windows cascades in STACKING order: Car, just raised,
  // takes the second slot and the untitled the first. The item offers
  // Arrange only once something is off its placement, so Car is nudged
  // off its slot first — the slots read before the nudge.
  const slotsBefore = await docBoxes();
  await dragWindow(`__doc()`, 20, 12, 9);
  await pickMenu('#menu-view', 'arrange');
  const slotsAfter = await docBoxes();
  s = await probe();
  check(
    'Arrange Windows cascades in stacking order (the raised Car tops the cascade) without moving focus',
    slotsAfter.Car.left === slotsBefore.untitled.left &&
      slotsAfter.Car.top === slotsBefore.untitled.top &&
      slotsAfter.untitled.left === slotsBefore.Car.left &&
      slotsAfter.untitled.top === slotsBefore.Car.top &&
      s.heading === 'Car' &&
      s.docActive === true,
    JSON.stringify({ slotsBefore, slotsAfter, heading: s.heading })
  );
  // A pick from the View menu's section brings that window forward; from
  // the Finder role the section stays live with no item checked, and a
  // pick brings the application back with that window.
  const untitledItem = windowItemOf(s.viewWindows, 'untitled');
  const carItem = windowItemOf(s.viewWindows, 'Car');
  await pickMenu('#menu-view', untitledItem);
  const picked = await settle((q) => q.heading === 'untitled');
  const pickOk =
    picked.heading === 'untitled' &&
    picked.docActive === true &&
    windowListTrue(picked.viewWindows) &&
    picked.viewWindows.items.find((i) => i.value === untitledItem)?.checked === true;
  await pickMenu('#menu-view', carItem);
  await settle((q) => q.heading === 'Car');
  const bare = await bareSpot();
  await click(bare.x, bare.y);
  const finder = await settle((q) => q.docActive === false);
  const finderList =
    windowListTrue(finder.viewWindows) &&
    finder.viewWindows.items.length === 2 &&
    finder.viewWindows.items.every((i) => i.enabled && !i.checked);
  await pickMenu('#menu-view', carItem);
  s = await settle((q) => q.docActive && q.heading === 'Car');
  check(
    'a View-menu pick activates that window (its item checked); from the Finder role the list stays live and unchecked, and a pick reactivates the application on it',
    pickOk &&
      finderList &&
      s.heading === 'Car' &&
      s.docActive === true &&
      s.windows.tools &&
      s.windows.sprite &&
      s.windows.stage &&
      windowListTrue(s.viewWindows) &&
      s.viewWindows.items.find((i) => i.value === carItem)?.checked === true,
    JSON.stringify({ pickOk, finderList, heading: s.heading, list: s.viewWindows })
  );
  // Close the dirty untitled: activate it (a point the browser confirms
  // belongs to its window — it sits mostly under the raised Car and the
  // windoids float over every document), File → Close, No.
  const untitledSpot = await evaluate(
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
  if (!untitledSpot) throw new Error('no visible patch of the untitled window to click');
  await click(untitledSpot.x, untitledSpot.y);
  await settle((q) => q.heading === 'untitled');
  await pickMenu('#menu-file', 'close');
  const alert = await settle((q) => q.anyModalOpen);
  const dont = await centreOf('#btn-unsaved-dont');
  await click(dont.x, dont.y);
  s = await settle((q) => q.docWindows === 1);
  check(
    'closing the dirty untitled raises the unsaved-changes alert; No closes it, Car takes the active state and the View menu drops its item',
    alert.anyModalOpen === true &&
      s.docWindows === 1 &&
      s.heading === 'Car' &&
      s.docActive === true &&
      windowListTrue(s.viewWindows) &&
      s.viewWindows.items.length === 1 &&
      s.viewWindows.items[0].value === carItem,
    JSON.stringify({
      alert: alert.anyModalOpen,
      docWindows: s.docWindows,
      list: s.viewWindows,
    })
  );
  // The quit cascade: a fresh dirty untitled, then Quit — Cancel aborts the
  // whole walk; a second Quit answered No closes everything (the clean Car
  // goes silently) and leaves the bare desktop focused.
  await newBlankDoc();
  await keyPress('b');
  const q2 = await at(2, 2);
  await click(q2.x, q2.y);
  await painted(2, 2);
  await pickMenu('#menu-app', 'quit');
  const alert1 = await settle((q) => q.anyModalOpen);
  const cancelBtn = await centreOf('#btn-unsaved-cancel');
  await click(cancelBtn.x, cancelBtn.y);
  s = await settle((q) => !q.anyModalOpen);
  check(
    'Quit walks into the dirty untitled: the alert is up, and Cancel aborts the quit with both windows staying',
    alert1.anyModalOpen === true && s.docWindows === 2 && s.anyModalOpen === false,
    JSON.stringify({ alert: alert1.anyModalOpen, docWindows: s.docWindows })
  );
  await pickMenu('#menu-app', 'quit');
  await settle((q) => q.anyModalOpen);
  const dont2 = await centreOf('#btn-unsaved-dont');
  await click(dont2.x, dont2.y);
  s = await settle((q) => q.docWindows === 0);
  check(
    "a completed Quit closes every window, the desktop takes focus, and the View menu's window section is gone (separator included)",
    s.docWindows === 0 &&
      s.docActive === false &&
      !s.windows.tools &&
      !s.windows.sprite &&
      !s.windows.stage &&
      windowListTrue(s.viewWindows) &&
      s.viewWindows.items.length === 0 &&
      s.viewWindows.trailingSeparator === false,
    JSON.stringify({ docWindows: s.docWindows, windows: s.windows, list: s.viewWindows })
  );
}

async function s26_newDocumentDialog() {
  section('S26 the New Document dialog');
  await freshPage();
  await pickMenu('#menu-file', 'new');
  const newForm = () =>
    evaluate(`(() => {${DEEP}
      return {
        open: !!__q('#dlg-new').open,
        tile: String(__q('#new-tile').value),
        tileDisabled: !!__q('#new-tile').disabled,
      };
    })()`);
  // Rows are found by TEXT: vf-list-item's `value` is a property (only
  // `selected` reflects), so an attribute selector can't reach it.
  const newRowCentre = (text) =>
    evaluate(`(() => {${DEEP}
      const i = [...__q('#new-list').querySelectorAll('vf-list-item')]
        .find((r) => r.textContent.trim() === '${text}');
      const r = i.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
  await until(async () => (await newForm()).open);
  const empty0 = await newForm();
  const cubeRow = await newRowCentre('Cube');
  await click(cubeRow.x, cubeRow.y);
  await until(async () => (await newForm()).tileDisabled);
  const cube = await newForm();
  const emptyRow = await newRowCentre('Empty Document');
  await click(emptyRow.x, emptyRow.y);
  await until(async () => !(await newForm()).tileDisabled);
  const empty = await newForm();
  check(
    "a template row locks the tile field at the template's native size; Empty Document re-enables it",
    empty0.open &&
      !empty0.tileDisabled &&
      cube.tileDisabled &&
      cube.tile !== empty0.tile &&
      !empty.tileDisabled,
    JSON.stringify({ empty0, cube, empty })
  );
  // Type a custom size, then Create: clicking the button blurs the field,
  // which commits the typed value before the click lands.
  await evaluate(
    `(() => {${DEEP} const f = __q('#new-tile'); f.value = '';
      f.shadowRoot.querySelector('input').focus(); })()`
  );
  await typeText('12');
  const createBtn = await centreOf('#btn-new-ok');
  await click(createBtn.x, createBtn.y);
  let s = await settle((p) => p.docWindows === 2 && p.tileW === 12);
  check(
    'Create opens a fresh untitled at the typed tile size',
    s.heading === 'untitled' &&
      s.docWindows === 2 &&
      s.tileW === 12 &&
      s.anyModalOpen === false,
    JSON.stringify({ heading: s.heading, docWindows: s.docWindows, tileW: s.tileW })
  );
  await pickMenu('#menu-file', 'new');
  await until(async () => (await newForm()).open);
  const carRow = await newRowCentre('Car');
  await dblclick(carRow.x, carRow.y);
  s = await settle((p) => p.docWindows === 3 && p.voxels > 100);
  check(
    'double-clicking a template opens a fresh untitled copy of it',
    s.heading === 'Car' && s.docWindows === 3 && s.voxels > 100,
    JSON.stringify({ heading: s.heading, docWindows: s.docWindows, voxels: s.voxels })
  );
}

async function s27_saveOpenRoundTrip() {
  section('S27 the save / open round-trip');
  const boot = await freshPage();
  await keyPress('b');
  const p = await at(1, 1);
  await click(p.x, p.y);
  await painted(1, 1);
  await keyPress('s', META);
  const nameOpen = await until(() =>
    evaluate(`(() => {${DEEP} return !!__q('#dlg-name').open; })()`)
  );
  await evaluate(
    `(() => {${DEEP} const f = __q('#name-field'); f.value = '';
      f.shadowRoot.querySelector('input').focus(); })()`
  );
  await typeText('Test Doc');
  await keyPress('Enter');
  let s = await settle(
    (q) => q.heading === 'Test Doc' && q.docIcons === boot.docIcons + 1
  );
  let um = await urlMirror();
  check(
    '⌘S prompts for a name; the save titles the window (its View item with it), an icon appears, and the address bar mirrors the name',
    nameOpen &&
      s.heading === 'Test Doc' &&
      s.docIcons === boot.docIcons + 1 &&
      um.hash === '#Test%20Doc' &&
      windowListTrue(s.viewWindows) &&
      s.viewWindows.items[0].label === s.heading,
    JSON.stringify({ nameOpen, heading: s.heading, icons: s.docIcons, url: um })
  );
  await newBlankDoc();
  await settle((q) => q.heading === 'untitled');
  const um2 = await urlMirror();
  const iconPos = await evaluate(
    `(() => {${DEEP}
      const i = __qa('vf-icon').find((el) => el.label === 'Test Doc');
      const r = i.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 20 }; })()`
  );
  await dblclick(iconPos.x, iconPos.y);
  s = await settle((q) => q.heading === 'Test Doc');
  const restored = await painted(1, 1);
  um = await urlMirror();
  check(
    'a new untitled clears the fragment; double-clicking the icon reopens the saved doc with its pixels restored and the address bar following',
    um2.hash === '' && s.heading === 'Test Doc' && restored && um.hash === '#Test%20Doc',
    JSON.stringify({ untitledUrl: um2, heading: s.heading, restored, url: um })
  );
}

async function s28_browserResize() {
  section('S28 a browser resize');
  // Emulation.setDeviceMetricsOverride changes the layout viewport and fires
  // a real `resize` — the same path a user's window drag takes.
  const layoutSnap = () =>
    evaluate(`(() => {
      const d = document.querySelector('#desktop');
      const wins = [...document.querySelectorAll('vf-window')]
        .filter((w) => !w.hidden)
        .map((w) => ({ id: w.id, left: w.left, top: w.top, w: w.width, h: w.height }));
      const icons = [...document.querySelectorAll('#desktop-icons vf-icon')].map(
        (i) => ({ id: i.dataset.key, left: i.left, top: i.top })
      );
      return { dw: d.width, dh: d.height, wins, icons };
    })()`);
  const metrics = async (width, height) => {
    const before = await layoutSnap();
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await until(async () => {
      const now = await layoutSnap();
      return now.dw !== before.dw || now.dh !== before.dh;
    }, 3000);
    await sleep(200);
  };
  // The ⌘J item is Arrange Windows only while something is off its
  // placement; already arranged, there is nothing to pick.
  const arrangeIfNeeded = async () => {
    const v = await evaluate(
      `document.querySelector('#item-arrange').getAttribute('value')`
    );
    if (v === 'arrange') await pickMenu('#menu-view', 'arrange');
  };
  await freshPage();
  // The wide state through the SAME override the round trip ends on: the
  // native headless client height is smaller than --window-size.
  await metrics(1000, 850);
  await arrangeIfNeeded();
  await metrics(780, 640);
  const placedNarrow = await layoutSnap();
  await arrangeIfNeeded();
  const arrangedNarrow = await layoutSnap();
  const windoids = (snap) => snap.wins.filter((w) => !w.id.startsWith('win-doc-'));
  check(
    'a resize lands the windoids where Arrange would (the placement is a fixed point of the resize rule)',
    windoids(placedNarrow).length === 3 &&
      JSON.stringify(windoids(placedNarrow)) === JSON.stringify(windoids(arrangedNarrow)),
    JSON.stringify({
      resized: windoids(placedNarrow),
      arranged: windoids(arrangedNarrow),
    })
  );
  // Drag every window a step off its placement: from here `home` is this
  // dragged arrangement, and the rule must round-trip boxes that sit
  // anywhere at all. (The stage BEFORE the sprite: dragged down-right first,
  // the sprite windoid would sit over the stage's dot bar.)
  await dragWindow(`__doc()`, 60, 40, 9);
  await dragWindow(`__q('#win-tools')`, 60, 40, 6);
  await dragWindow(`__q('#win-stage')`, 60, 40, 6);
  await dragWindow(`__q('#win-sprite')`, 60, 40, 6);
  const home = await layoutSnap();
  const draggedOff = home.wins.every((w) => {
    const o = placedNarrow.wins.find((x) => x.id === w.id);
    return o && (w.left !== o.left || w.top !== o.top);
  });
  if (!draggedOff)
    throw new Error(
      'the drags left a window on its placement: ' + JSON.stringify(home.wins)
    );
  // A shrink to 520×360 (two different zoom-ladder rungs on the two axes,
  // so the kit's zoom tracker rebases rather than reading page zoom), a
  // height wiggle, then home: the pin cache maps the same pin every event,
  // so home must be EXACT — position AND size, windows and icons.
  await metrics(520, 360);
  for (const h of [700, 560, 760, 620, 800]) await metrics(780, h);
  await metrics(780, 640);
  const back = await layoutSnap();
  check(
    'a shrink-then-grow wiggle round-trips every window and icon exactly home (position and size)',
    back.wins.every((w) => {
      const o = home.wins.find((x) => x.id === w.id);
      return o && w.left === o.left && w.top === o.top && w.w === o.w && w.h === o.h;
    }) &&
      back.icons.length > 0 &&
      back.icons.every((i) => {
        const o = home.icons.find((x) => x.id === i.id);
        return o && i.left === o.left && i.top === o.top;
      }),
    JSON.stringify({ home, back })
  );
  // The reported case: the browser is resized WHILE the About box is up,
  // then OK, File → New…, Create. The hidden windoids were re-placed by the
  // resize; the new window places on the live raster — everything lands
  // where Arrange would (the ⌘J item reads the zoom state).
  await send('Page.navigate', { url: SEED_URL });
  await waitForGreet();
  await metrics(780, 500);
  let made = null;
  for (let attempt = 0; attempt < 3 && made?.docWindows !== 1; attempt++) {
    await dismissGreet();
    await newBlankDoc();
    made = await probe();
  }
  const afterCreate = await layoutSnap();
  const s = await settle((p) => p.menuEnabled.arrangeValue === 'zoom', 2000);
  check(
    'a resize behind the About box: Create lands every window where Arrange would (the ⌘J item reads the zoom state)',
    made?.docWindows === 1 &&
      afterCreate.wins.length === 4 &&
      s.menuEnabled.arrange === true &&
      s.menuEnabled.arrangeValue === 'zoom',
    JSON.stringify({ created: afterCreate.wins, item: s.menuEnabled })
  );
  await send('Emulation.clearDeviceMetricsOverride');
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
  // The target opens at about:blank and is ATTACHED before anything real
  // loads, so every navigation of the run is seen and waited for.
  const target = await fetch(`http://127.0.0.1:${DBG_PORT}/json/new?about:blank`, {
    method: 'PUT',
  }).then((r) => r.json());

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  // A dropped connection (Chrome crash, watchdog kill) would otherwise leave
  // every pending send() unresolved and the run exiting silently mid-run.
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
      lastNavAt = Date.now();
      navCount++;
      console.log('  ..   [navigated]', msg.params.frame.url);
    }
    if (msg.method === 'Page.javascriptDialogOpening') {
      // The app's dirty-document beforeunload guard (trap 3): accept and move on.
      send('Page.handleJavaScriptDialog', { accept: true });
    }
    if (msg.method === 'Browser.downloadWillBegin') {
      downloads.set(msg.params.guid, {
        guid: msg.params.guid,
        name: msg.params.suggestedFilename,
        state: 'begun',
      });
    }
    if (msg.method === 'Browser.downloadProgress') {
      const d = downloads.get(msg.params.guid);
      if (d) d.state = msg.params.state;
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
  await absorbPhantomReload();
  await send('Page.navigate', { url: SEED_URL });
  await waitForGreet();

  const scenarios = [
    s1_virginBoot,
    s2_seedingRecord,
    s3_aboutBox,
    s4_firstWindowActivates,
    s5_fileParam,
    s6_geometryNeverPersists,
    s7_sampleBoot,
    s8_toolKeys,
    s9_pencil,
    s10_eraser,
    s11_eyedropper,
    s12_rect,
    s13_selection,
    s15_faceSwap,
    s16_properties,
    s17_derivedFace,
    s18_colorsDialog,
    s19_undoRedo,
    s20_toolsMenu,
    s21_windows,
    s22_twoRoles,
    s23_spriteAtlas,
    s24_desktopPatterns,
    s25_multipleDocuments,
    s26_newDocumentDialog,
    s27_saveOpenRoundTrip,
    s28_browserResize,
  ];
  for (const run of scenarios) await run();

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
