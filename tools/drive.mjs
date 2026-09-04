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
//      tool / ink state, which reads as a pile of false failures. Every probe
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
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
// The desktop's pure resize arithmetic — dependency-free ESM, so the browser
// resize section computes its exact expectations from the same function the
// shell applies (shell/layout.js is Node-tested; here it is the oracle).
import {
  pinOf,
  pinTo,
  WINDOW_FRAME,
  ICON_FRAME,
  ICON_CELL,
  TOOL_CELL,
  TOOLS_BOX,
  zoomedBox,
  centeredBox,
  initialPlacement,
  ringWidthFor,
  ringRowWidth,
  ringHeightFor,
  RING_MIN_WIDTH,
  RING_STRIP,
  RING_FIELD,
  RING_FIELDS,
  SPRITE_STRIP,
  SPRITE_PICKER,
  SPRITE_PICKER_AT,
  STAGE_STRIP,
  CASCADE_STEP,
  CASCADE_SLOTS,
} from '../src/shell/layout.js';
// The 3D Sprite Atlas's geometry, its slice's defaults and the document
// format's chunk reader — pure ESM too, the oracles for the atlas section's
// frame sizes and its exported file.
import { ringFrame, ringSheet } from '../src/lib/ring.js';
import { RING_DEFAULTS, RING_PAPERS } from '../src/state/ring.js';
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
const URL = `http://localhost:${APP_PORT}/?sample=car&edit=front&rotate=0`;
// The PLAIN app url — no ?sample, so the real boot path runs. On this run's
// brand-new profile the first load is the one TRULY VIRGIN boot: it seeds the
// built-in defaults (Car, Cube) into IndexedDB as ordinary stored documents
// and parks at the About box (no ?file=<name> in the url, so no document
// opens). Every ?sample boot after it skips the seeding (the deterministic
// test path), so the rest of the run sees exactly the two seeded docs plus
// whatever it saves itself.
const SEED_URL = `http://localhost:${APP_PORT}/?rotate=0`;

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
// guid -> { name, state } — the atlas export section waits on a completed
// one and reads the file back out of the run's temp dir.
const downloads = new Map();
// When the main frame last navigated: the readiness waits below hold until
// the page has been quiet for a moment past its predicate (see them).
let lastNavAt = 0;

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
// page (the kit's menu-shortcut blink among them, which is what took ⌘K and
// the five checks after it down for two days as an "environment issue" —
// 83cfcec). The Windows vk alone gives the DOM its keyCode, and with no
// native code there is no OS event to re-dispatch. (The storm's events read
// key "Unidentified", code "Minus": vk 27 is Escape on Windows but the
// Minus key's native code on a Mac — the tell that led here.)
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
  // The face picker's checked radio (scoped: the 3D Sprite Atlas strip
  // carries radios of its own — the paper choice).
  const checked = __q('sm-face-picker')?.shadowRoot?.querySelector('vf-radio[checked]');
  // The 3D View's status line: the fixed "3D Model View" label (a static
  // readout — no error or warning ever takes the line); the build stats
  // ("grid 40px · voxels 4950 · tris 1784") ride the label's title tooltip —
  // parsed back into a stats map from there.
  const buildLine = (() => {
    const el = __q('sm-status-line[kind="build"]');
    return el && el.shadowRoot ? el.shadowRoot.textContent.trim() : '';
  })();
  const buildStats = (() => {
    const el = __q('sm-status-line[kind="build"]');
    const lb = el && el.shadowRoot ? el.shadowRoot.querySelector('vf-label') : null;
    return (lb && lb.getAttribute('title')) || '';
  })();
  const stats = {};
  for (const m of buildStats.matchAll(/(grid|voxels|tris) ([^·]+)/g)) {
    stats[m[1]] = m[2].trim();
  }
  // The sprite windoid carries NO status line — its status slot is empty, so
  // the kit draws no bottom bar (.status.empty): null when the strip is
  // absent or empty, its text if one ever comes back.
  const atlasStatus = (() => {
    const w = __q('#win-sprite');
    const bar =
      w && w.shadowRoot ? w.shadowRoot.querySelector('[part="status-bar"]') : null;
    if (!bar || bar.classList.contains('empty')) return null;
    return bar.textContent.trim();
  })();
  // The Colors dialog is light-DOM chrome like the desktop's own dialogs
  // (About, Open, …): the kit's cursor observer must see its \`open\` flip
  // to keep the page-drawn cursor above the modal.
  const picker = __q('sm-color-picker');
  const colorsDialog = picker ? picker.querySelector('vf-dialog') : null;
  return {
    // All six tools are mutually exclusive sticky modes — exactly one cell is
    // lit. The eyedropper is listed LAST so a drawing-tool cell wrongly left
    // active alongside it would win the find and fail the tool checks.
    drawTool:
      ['selection', 'pencil', 'rectangle', 'fill', 'eraser', 'eyedropper'].find(
        (t) => tools[t]
      ) || null,
    // The current-ink swatch lives in the options strip and hides for the
    // eraser (the one tool that paints no color) — inkColor reads null then.
    inkSwatchShown: !!sw,
    inkColor: sw ? sw.getAttribute('color') : null,
    // The options strip IS <sm-tool-options>; its shadow root holds the bare
    // controls. Null-safe: the whole strip hides while the app is
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
    // The face picker is app-level chrome now: the strip across the Full
    // Sprite View windoid, serving the ACTIVE document (one picker, so the
    // global deep query is exact).
    face: __q('.editor-face-picker')?.value ?? null,
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
    // Computed cursors: applyCursor's takeover reaches into the shadow roots
    // only via the --vf-cursor token, so a bare shadow \`cursor:\` declaration
    // would put a native cursor back alongside the kit's drawn one.
    nativeCursor: canvas ? getComputedStyle(canvas).cursor : null,
    toolCursor: (() => {
      const cell = __q('.editor-tool');
      return cell ? getComputedStyle(cell).cursor : null;
    })(),
    // The tool strip: the grid's declared cell, each cell's art at its
    // natural size (the icon IS the cell — shell/layout.js's TOOL_CELL) and
    // the Tools windoid's authored box (TOOLS_BOX, the strip's arithmetic).
    toolStrip: (() => {
      const grid = __q('.editor-toolstrip');
      const win = __q('#win-tools');
      return {
        cell: grid
          ? { width: +grid.getAttribute('cell-width'), height: +grid.getAttribute('cell-height') }
          : null,
        art: __qa('.editor-tool img').map((i) => ({
          width: i.naturalWidth,
          height: i.naturalHeight,
          loaded: i.complete && i.naturalWidth > 0,
        })),
        win: win ? { width: win.width, height: win.height } : null,
      };
    })(),
    colorsDialogLightDom: !!(colorsDialog && colorsDialog.getRootNode() === document),
    rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    tileW: canvas ? canvas.width : 0,
    buildLine,
    buildStats,
    atlasStatus,
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
    // The toggleable windoid, apart from the four always-open windows above
    // (it boots hidden — View → 3D Sprite Atlas shows it).
    ringShown: !__q('#win-ring').hidden,
    // The 3D View's two render toggles, read as the strip's own checked
    // bindings (live() off prefs — the app's statement of the slice).
    stageToggles: {
      rotate: !!__q('#stage-rotate')?.checked,
      smooth: !!__q('#stage-smooth')?.checked,
    },
    // How many document windows are open (one per open document).
    docWindows: [...document.querySelectorAll('vf-window')].filter((w) =>
      w.id.startsWith('win-doc-')).length,
    // The focus model: whether a document window holds the active state
    // (appActive's visible half), and whether the options strip's band is on
    // screen (it hides with the application, like the windoids — the probe
    // reads the band element itself, not just its controls).
    docActive: !!__doc() && __doc().hasAttribute('active'),
    optionsStrip: !!__q('sm-options-bar')?.shadowRoot?.querySelector('.strip'),
    // Enabled states for the focus-gated menu grammar (the Finder role).
    menuEnabled: {
      newDoc: !__q('vf-menu-item[value="new"]').disabled,
      open: !__q('vf-menu-item[value="open"]').disabled,
      // Open's label IS its grammar: "Open" acts on the Finder selection,
      // "Open…" raises the listing dialog.
      openLabel: __q('vf-menu-item[value="open"]').textContent.trim(),
      save: !__q('vf-menu-item[value="save"]').disabled,
      close: !__q('vf-menu-item[value="close"]').disabled,
      pickColor: !__q('vf-menu-item[value="pick-color"]').disabled,
      // The ⌘J item — Arrange Windows (value \`arrange\`) with anything on
      // screen off its placement, Zoom Window (value \`zoom\`) once
      // everything is arranged: the value is the state's readout, the
      // label follows it. Greyed with nothing open, and arranged in the
      // Finder role (nothing to arrange, no active window to zoom).
      arrange: !__q('#item-arrange').disabled,
      arrangeValue: __q('#item-arrange').getAttribute('value'),
      arrangeLabel: __q('#item-arrange').textContent.trim(),
      toolPencil: !__q('vf-menu-item[value="tool-pencil"]').disabled,
      ring: !__q('vf-menu-item[value="ring"]').disabled,
      exportAtlas: !__q('vf-menu-item[value="export-atlas"]').disabled,
    },
    menuChecks: {
      // View → 3D Sprite Atlas: the windoid's toggle, checkmark off prefs.
      ring: !!__q('vf-menu-item[value="ring"]').checked,
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
    // The View menu's open-windows section (menus.js syncWindows): one item
    // per open document window after a separator, at the menu's tail — the
    // value \`window:<key>\`, the label the document's name, the checkmark
    // the active window's — read beside the document windows themselves
    // (key, heading, active) so a check can hold the two against each other.
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
        // A separator leads the section…
        separator: first > 0 && kids[first - 1].tagName === 'VF-SEPARATOR',
        // …nothing but window items follow its first…
        atEnd: first < 0 || kids.slice(first).every(isWin),
        // …and with no items there is no dangling rule.
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

// The inks on a layer: how many of its painted px are pure black, pure white
// (both at full alpha), or anything else — a 1-bit layer's "other" is zero.
const layerInks = (sel) =>
  evaluate(`(() => {${DEEP}
    const c = __qd('${sel}');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const n = { black: 0, white: 0, other: 0 };
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a === 0) continue;
      const v = d[i] + d[i + 1] + d[i + 2];
      if (a === 255 && v === 0) n.black++;
      else if (a === 255 && v === 765) n.white++;
      else n.other++;
    }
    return n;
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

// Both readiness predicates ALSO require the page to be unstamped: every
// wait ends by stamping the document (`window.__stamp = 'S'`), so a stamp
// means "the document we already waited for". Page.navigate resolves while
// the OLD document is still up, and that document satisfies the predicate
// on its own (its canvas / its open About box) — without this, a wait after
// a same-URL navigation could return on the old page and the next probe
// land on the new one mid-boot (icons 0, no greet: a flake seen 3 runs in
// 5 on the plain-reload greet check). A fresh document carries no stamp.
// AND both waits hold for a QUIET window past the predicate: a same-URL
// Page.navigate lands as TWO main-frame navigations in headless Chrome,
// the second a beat after the first, and a predicate that came true on the
// first page — stamped, probed — reads a mid-boot second page (the same
// flake, seen again once the plain boot got faster). The wait ends only
// when the predicate holds AND the main frame has not navigated for
// NAV_QUIET ms, so the second navigation is always the one waited for.
const NAV_QUIET = 700;
const quiet = () => Date.now() - lastNavAt >= NAV_QUIET;
const APP_READY = `(() => {${DEEP}
  if (window.__stamp) return false;
  const build = __q('sm-status-line[kind="build"]');
  const lb = build && build.shadowRoot && build.shadowRoot.querySelector('vf-label');
  return !!(__q('.editor-canvas') && lb &&
    (lb.getAttribute('title') || '').includes('voxels'));
})()`;

async function waitForApp() {
  for (let i = 0; i < 100; i++) {
    if (quiet() && (await evaluate(APP_READY).catch(() => false))) break;
    await sleep(200);
  }
  await sleep(400);
  await evaluate(`window.__stamp = 'S'`);
}

// The plain boot (no ?sample, no ?file) opens NO document — it parks at the
// About box (the launch splash), so APP_READY (an editor canvas + build
// stats) never comes true there. This is that boot's readiness signal.
// GREET_UP is the plain "is the About box open?" test (dismissGreet asks it
// of a page already waited for — stamped — so it must NOT carry the stamp
// guard); GREET_READY is the wait's predicate, which does.
const GREET_UP = `(() => {${DEEP}
  const d = __q('#dlg-about');
  return !!(d && d.open);
})()`;
const GREET_READY = `(() => {${DEEP}
  if (window.__stamp) return false;
  const d = __q('#dlg-about');
  return !!(d && d.open);
})()`;
async function waitForGreet() {
  for (let i = 0; i < 100; i++) {
    if (quiet() && (await evaluate(GREET_READY).catch(() => false))) break;
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
    `http://127.0.0.1:${DBG_PORT}/json/new?${encodeURIComponent(SEED_URL)}`,
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
      lastNavAt = Date.now();
      console.log('  ..   [navigated]', msg.params.frame.url);
    }
    if (msg.method === 'Page.javascriptDialogOpening') {
      // The app's dirty-document beforeunload guard raises a confirm on every
      // freshPage once a stroke has landed; unanswered it wedges navigation
      // forever in headless. Accept and move on.
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
  await waitForGreet();

  // --- virgin boot: the defaults seed, the About box greets -------------------
  // The run's first load is the PLAIN url on a brand-new profile — the one
  // boot allowed to seed: Car and Cube land in the library as normal stored
  // documents (real PNGs, generated icons, `doc:` keys like any save), and
  // with no ?file=<name> in the url the boot parks at the About box (the
  // launch splash — the same dialog as Sprite Machine → About…), no document
  // window open and no New Document dialog. A reload then finds persisted
  // state and must NOT seed again — and greets with the About box again (a
  // prior session's open windows deliberately don't reopen; the URL says
  // what a load shows). ?file=<name> is that URL: it opens the named stored
  // doc, case-insensitively.
  section('virgin boot seeds the defaults');
  const seedProbe = () =>
    evaluate(`(() => {${DEEP}
      const icons = __qa('vf-icon[data-key]').map((i) => ({
        key: i.dataset.key, label: i.label, open: !!i.open,
      }));
      const d = __doc();
      return {
        icons,
        heading: d ? d.heading : '',
        docWindows: [...document.querySelectorAll('vf-window')].filter((w) =>
          w.id.startsWith('win-doc-')).length,
        aboutOpen: !!__q('#dlg-about').open,
        newDialogOpen: !!__q('#dlg-new').open,
        // The About box's build-fact lines (menus.js writes them at wire-up
        // from vite.config.js's define — package.json's version, HEAD's
        // commit date in System 7's short form).
        aboutVersion: __q('#about-version').textContent.trim(),
        aboutDate: __q('#about-date').textContent.trim(),
      };
    })()`);
  let seed = await seedProbe();
  check(
    'the first-ever boot seeds Car and Cube as saved-doc icons',
    seed.icons.length === 2 &&
      seed.icons.every((i) => i.key.startsWith('doc:')) &&
      seed.icons
        .map((i) => i.label)
        .sort()
        .join(',') === 'Car,Cube',
    JSON.stringify(seed.icons)
  );
  check(
    'the boot parks at the About box — no document window, no New Document dialog',
    seed.aboutOpen === true && seed.newDialogOpen === false && seed.docWindows === 0,
    JSON.stringify({
      about: seed.aboutOpen,
      newDialog: seed.newDialogOpen,
      docWindows: seed.docWindows,
    })
  );
  check(
    'the About box reads the build facts: "version <package.json>" and a "Mon D, YYYY" date',
    /^version \d+\.\d+\.\d+/.test(seed.aboutVersion) &&
      /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(seed.aboutDate),
    JSON.stringify({ version: seed.aboutVersion, date: seed.aboutDate })
  );
  // The dialog greet is DESKTOP-FOCUSED: no document window has opened, so
  // the application never activated (the mirror reads the desktop's own
  // boot truth — nothing active yet). The windoids stay hidden, the options
  // strip stays blank, and the menus greet in the Finder grammar — the same
  // state closing the last window leaves; the dialog just floats over it.
  const greet = await probe();
  check(
    'the dialog greet is desktop-focused: windoids hidden, options strip blank',
    !greet.windows.tools &&
      !greet.windows.sprite &&
      !greet.windows.stage &&
      greet.optionsStrip === false,
    JSON.stringify({ windows: greet.windows, strip: greet.optionsStrip })
  );
  check(
    '…and the Finder menu grammar greets: New and Open… stay, the rest grey out (Arrange too: nothing open)',
    greet.menuEnabled.newDoc === true &&
      greet.menuEnabled.open === true &&
      greet.menuEnabled.openLabel === 'Open…' &&
      greet.menuEnabled.save === false &&
      greet.menuEnabled.close === false &&
      greet.menuEnabled.pickColor === false &&
      greet.menuEnabled.arrange === false &&
      greet.menuEnabled.toolPencil === false,
    JSON.stringify(greet.menuEnabled)
  );
  await sleep(600); // let the desktop-state debounce land before navigating
  await send('Page.navigate', { url: SEED_URL });
  await waitForGreet();
  seed = await seedProbe();
  check(
    'a plain reload does not re-seed and greets with the About box again',
    seed.icons.length === 2 && seed.aboutOpen === true && seed.docWindows === 0,
    JSON.stringify({
      icons: seed.icons.length,
      about: seed.aboutOpen,
      docWindows: seed.docWindows,
    })
  );
  // The reload finds persisted state (the icons) — a different boot path
  // from the virgin greet — and must land desktop-focused all the same.
  const greet2 = await probe();
  check(
    'the persisted-state greet is desktop-focused too: windoids stay hidden',
    !greet2.windows.tools && !greet2.windows.sprite && !greet2.windows.stage,
    JSON.stringify(greet2.windows)
  );
  // OK dismisses the greet onto the BARE desktop: nothing opens and nothing
  // activates — the splash is a splash. (`dismissGreet` is reused wherever a
  // plain boot has to be got past: it OKs the box only if it is up, so a
  // retry after a headless reload lands on either state.)
  const dismissGreet = async () => {
    if (!(await evaluate(GREET_UP).catch(() => false))) return;
    const ok = await centreOf('#btn-about-ok');
    await click(ok.x, ok.y);
    await sleep(400);
  };
  await dismissGreet();
  seed = await seedProbe();
  const bare = await probe();
  check(
    'OK closes the About box onto the bare desktop: nothing opens, nothing activates',
    seed.aboutOpen === false &&
      seed.docWindows === 0 &&
      !bare.windows.tools &&
      !bare.windows.sprite &&
      !bare.windows.stage &&
      bare.optionsStrip === false &&
      bare.menuEnabled.newDoc === true &&
      bare.menuEnabled.save === false,
    JSON.stringify({
      about: seed.aboutOpen,
      docWindows: seed.docWindows,
      windows: bare.windows,
      strip: bare.optionsStrip,
    })
  );
  // Sprite Machine → About… raises the same box over the bare desktop, and
  // a click anywhere OUTSIDE it dismisses it: the markup opts this one
  // dialog into the kit's `light-dismiss` (the mechanics — the backdrop
  // consuming both halves of the click — are the kit's own contract, pinned
  // in its suite, not here). The app-level outcome is the OK check's: the
  // click lands on the Car icon on purpose, and the bare desktop is what's
  // left — nothing opens, nothing activates, no icon selected.
  await pickMenu('#menu-app', 'about');
  seed = await seedProbe();
  check(
    'Sprite Machine → About… raises the box again over the bare desktop',
    seed.aboutOpen === true && seed.docWindows === 0,
    JSON.stringify({ about: seed.aboutOpen, docWindows: seed.docWindows })
  );
  // The Car icon sits in the Finder's left column, clear of the centered
  // box (the box's rect is the kit's native <dialog> — the host is
  // display: contents — read only to prove the click point is outside it).
  const geom = await evaluate(`(() => {${DEEP}
    const r = __q('#dlg-about').shadowRoot.querySelector('dialog').getBoundingClientRect();
    const i = __qa('vf-icon[data-key]').find((el) => el.label === 'Car');
    const ir = i.getBoundingClientRect();
    return {
      box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      car: { x: ir.left + ir.width / 2, y: ir.top + ir.height / 2 },
    };
  })()`);
  const carOutside =
    geom.car.x < geom.box.left ||
    geom.car.x > geom.box.right ||
    geom.car.y < geom.box.top ||
    geom.car.y > geom.box.bottom;
  await click(geom.car.x, geom.car.y);
  await sleep(400);
  seed = await seedProbe();
  const away = await probe();
  const awaySelected = await evaluate(`(() => {${DEEP}
    return __qa('vf-icon[data-key]').filter((i) => i.selected).map((i) => i.label);
  })()`);
  check(
    'a click outside the box (on the Car icon) dismisses it onto the bare desktop: nothing opens, nothing activates, no icon selected',
    carOutside &&
      seed.aboutOpen === false &&
      seed.docWindows === 0 &&
      awaySelected.length === 0 &&
      !away.windows.tools &&
      away.optionsStrip === false,
    JSON.stringify({
      carOutside,
      about: seed.aboutOpen,
      docWindows: seed.docWindows,
      selected: awaySelected,
      windows: away.windows,
      strip: away.optionsStrip,
    })
  );
  // File → New… → Create opens the FIRST document window, and that is what
  // activates the application: the windoids and the options strip appear
  // BECAUSE a document window opened, never before. (A fresh Empty Document
  // is born clean — the load's sheet bump marks it — so navigating away
  // below can't trip the beforeunload guard.) A headless artifact reload can
  // land mid-gesture and boot back to the greet, dropping the untitled
  // window (they never survive a reload — by design), so the gesture
  // retries, re-dismissing the greet: the run's standing tolerance for that
  // artifact.
  let created = null;
  for (let attempt = 0; attempt < 3 && created?.docWindows !== 1; attempt++) {
    await dismissGreet();
    await newBlankDoc();
    created = await probe();
  }
  check(
    'File → New… → Create opens a window and ACTIVATES: windoids + strip up',
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
  await send('Page.navigate', { url: `${SEED_URL}&file=cube` });
  await waitForApp();
  seed = await seedProbe();
  check(
    '?file=cube opens the stored Cube (case-insensitive), no greet',
    seed.heading === 'Cube' &&
      seed.docWindows === 1 &&
      seed.aboutOpen === false &&
      seed.newDialogOpen === false &&
      seed.icons.find((i) => i.label === 'Cube')?.open === true,
    JSON.stringify(seed)
  );
  // The url mirror: the open canonicalizes the address bar to the fragment
  // form — #Cube written (replaceState), the ?file= search param dropped —
  // so a plain reload of whatever is on screen restores it.
  const urlMirror = () => evaluate(`({ hash: location.hash, search: location.search })`);
  let um = await urlMirror();
  check(
    'the address bar canonicalizes to #Cube (?file dropped)',
    um.hash === '#Cube' && !/[?&]file=/.test(um.search),
    JSON.stringify(um)
  );

  // Window geometry is NEVER persisted (shell/desktop-state.js): a browser
  // is resized and reopened on another monitor all the time, so a prior
  // session's top/left is no truth worth re-asserting. Drag the Tools
  // palette and the Cube window off their placed positions, grow the 3D
  // View, let the desktop-state debounce land, reload the same URL — and
  // every window is back at the placement derived from the live raster,
  // not where it was left. (The icons DO restore — the Finder's furniture.)
  const windowGeom = () =>
    evaluate(`(() => {${DEEP}
      const pick = (w) => ({ left: w.left, top: w.top, width: w.width, height: w.height });
      return { tools: pick(__q('#win-tools')), stage: pick(__q('#win-stage')),
               doc: pick(__doc()) };
    })()`);
  const dragBar = async (expr, dy) => {
    const b = await evaluate(
      `(() => {${DEEP} const r = (${expr}).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + ${dy} }; })()`
    );
    await mouse('mousePressed', b.x, b.y);
    await mouse('mouseMoved', b.x + 30, b.y + 20, { buttons: 1 });
    await mouse('mouseMoved', b.x + 60, b.y + 40, { buttons: 1 });
    await mouse('mouseReleased', b.x + 60, b.y + 40, { buttons: 0 });
    await sleep(300);
  };
  const placed = await windowGeom();
  await dragBar(`__doc()`, 9); // the document window's title bar
  await dragBar(`__q('#win-tools')`, 6); // the windoid's slim dot bar
  const stageGrow = await evaluate(
    `(() => {${DEEP} const g = __q('#win-stage').shadowRoot
        .querySelector('[part="grow-box"]').getBoundingClientRect();
      return { x: g.left + g.width / 2, y: g.top + g.height / 2 }; })()`
  );
  await mouse('mousePressed', stageGrow.x, stageGrow.y);
  await mouse('mouseMoved', stageGrow.x - 15, stageGrow.y - 10, { buttons: 1 });
  await mouse('mouseMoved', stageGrow.x - 30, stageGrow.y - 20, { buttons: 1 });
  await mouse('mouseReleased', stageGrow.x - 30, stageGrow.y - 20, { buttons: 0 });
  await sleep(300);
  const left = await windowGeom();
  // The drags and the grow are the kit's gestures — no check of their own;
  // that they moved things is the precondition folded into the reload check
  // (a reload that "places fresh" over an unmoved arrangement proves nothing).
  const moved =
    left.doc.left !== placed.doc.left &&
    left.tools.left !== placed.tools.left &&
    left.stage.width !== placed.stage.width;
  await sleep(600); // let the desktop-state debounce land before navigating
  await send('Page.navigate', { url: `${SEED_URL}&file=cube` });
  await waitForApp();
  const again = await windowGeom();
  check(
    'a reload places every window fresh — nothing about a window persists',
    moved && JSON.stringify(again) === JSON.stringify(placed),
    JSON.stringify({ moved, placed, left, again })
  );

  // The rest of the run drives the deterministic ?sample boot.
  await freshPage();

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

  // File → New… raises the New Document dialog now; OK it at its default
  // (Empty Document, 40px tiles) for the sections that just need a blank.
  async function newBlankDoc() {
    await pickMenu('#menu-file', 'new');
    const ok = await centreOf('#btn-new-ok');
    await click(ok.x, ok.y);
    await sleep(650);
  }

  // The kit's drawn cursor takes over asynchronously (after its art decodes);
  // wait for the takeover so the computed-cursor checks below can't race it.
  for (let i = 0; i < 20 && s.nativeCursor !== 'none'; i++) {
    await sleep(100);
    s = await probe();
  }

  section(`boot — face=${s.face} tile=${TILE}px`);
  check('boots with the pencil active', s.drawTool === 'pencil', s.drawTool);
  check(
    'the pixel canvas claims the kit crosshair cursor',
    s.cursorClaim === 'crosshair',
    s.cursorClaim
  );
  check(
    'the native cursor is hidden over the canvas (kit crosshair only)',
    s.nativeCursor === 'none',
    s.nativeCursor
  );
  check(
    'the native cursor is hidden over the tool cells',
    s.toolCursor === 'none',
    s.toolCursor
  );
  // The tool cells ARE their icons: the art's natural size, the grid's
  // declared cell and the windoid's authored box all read layout.js's
  // numbers — the markup pinned against the arithmetic, the headers' idiom.
  for (let i = 0; i < 20 && !s.toolStrip.art.every((a) => a.loaded); i++) {
    await sleep(100);
    s = await probe();
  }
  const ts = s.toolStrip;
  const atCell = (b) =>
    !!b && b.width === TOOL_CELL.width && b.height === TOOL_CELL.height;
  check(
    "the tool cells are the icons' own size (TOOL_CELL), the windoid the strip's box (TOOLS_BOX)",
    atCell(ts.cell) &&
      ts.art.length === 6 &&
      ts.art.every((a) => a.loaded && atCell(a)) &&
      !!ts.win &&
      ts.win.width === TOOLS_BOX.width &&
      ts.win.height === TOOLS_BOX.height,
    JSON.stringify(ts)
  );
  check(
    'the options strip shows the pencil slider',
    s.opts.join(',') === 'vf-slider,vf-label'
  );
  check('face picker reflects ?edit=front', s.face === 'front', s.face);
  check('the checked radio follows the face', s.checkedRadio === 'front');
  check('the document window is titled for the sample', s.heading === 'Car', s.heading);
  check(
    'the document status bar names the edited face',
    s.tileStatus === 'Front Face',
    s.tileStatus
  );
  check(
    'the 3D View status bar reads its fixed name',
    s.buildLine === '3D Model View',
    s.buildLine
  );
  check(
    'the sprite windoid draws no status strip (empty status slot)',
    s.atlasStatus === null,
    String(s.atlasStatus)
  );
  check(
    'all four desktop windows are open',
    Object.values(s.windows).every(Boolean),
    JSON.stringify(s.windows)
  );
  check('the status tooltip reads out a build', s.voxels > 0, s.buildStats);

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
  check(
    'the eyedropper still shows the ink swatch',
    s.inkSwatchShown && /^#[0-9a-f]{6}$/.test(s.inkColor || ''),
    s.inkColor
  );

  await keyPress('e');
  s = await probe();
  check('E selects the eraser tool', s.drawTool === 'eraser', s.drawTool);
  check(
    'eraser options are its own size slider',
    s.opts.join(',') === 'vf-slider,vf-label',
    s.opts.join(',')
  );
  check('the eraser hides the ink swatch', s.inkSwatchShown === false, s.inkColor);

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

  // --- eyedropper -----------------------------------------------------------
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
  const firstInk = s.inkColor;

  // A second sample of a DIFFERENT color, so the sticky-tool check below has
  // a real ink change to observe when it re-samples the first texel.
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
    'a second pick replaces the ink',
    s.inkColor === secondInk,
    `ink=${s.inkColor}/${secondInk}`
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

  // --- the selection tool: marquee, ants, move, the transparency rule -------
  // Fresh load: the section carries a selection + undo state across many
  // inputs. Mechanisms only — the ants layer's emptiness, texel bytes, the
  // cursor claim attribute, the menu enablement — never copy. The Shift axis
  // lock stays a manual item (chorded drags wedge headless Chrome).
  section('selection');
  await freshPage();
  s = await probe();
  const antsUp = async () => !(await layerIsEmpty('.editor-canvas-select'));
  await keyPress('s');
  s = await probe();
  check(
    'S selects the selection tool (strip + menu agree)',
    s.drawTool === 'selection' && s.menuChecks.tool === 'select',
    JSON.stringify({ strip: s.drawTool, menu: s.menuChecks.tool })
  );
  // The strip: no ink swatch (the tool lays no color) and a lone readout
  // label (a mechanism check: one label, no digits while nothing is up).
  check(
    'the selection tool hides the ink swatch and shows only its readout',
    s.inkSwatchShown === false &&
      s.opts.join(',') === 'vf-label' &&
      !/\d/.test(s.optsReadout || ''),
    JSON.stringify({ opts: s.opts, swatch: s.inkSwatchShown, readout: s.optsReadout })
  );
  await drag(at(30, 4), at(34, 8));
  await sleep(150);
  s = await probe();
  check('a marquee drag puts the ants up', await antsUp());
  // The ants are 1-bit BY CONSTRUCTION (src/lib/ants.js fills whole-px runs;
  // the stroked dashes they replaced grayed every dash end): every painted px
  // of the layer is pure black or pure white at full alpha, both inks present
  // — read mid-march, whatever phase the ticker is at.
  const antsInks = await layerInks('.editor-canvas-select');
  check(
    'the ants are 1-bit: every painted px pure black or pure white',
    antsInks.other === 0 && antsInks.black > 0 && antsInks.white > 0,
    JSON.stringify(antsInks)
  );
  // The readout carries the marquee's numbers in order: left 30, top 4, then
  // 5 × 5 (a value-shape check, not copy).
  check(
    'the readout states the marquee (left, top, then width × height)',
    /\b30\b.*\b4\b.*\b5\b.*\b5\b/.test(s.optsReadout || ''),
    s.optsReadout
  );
  check(
    'a marquee writes nothing and is no undo step',
    (await texelAt(32, 6))[3] === 0 && s.menuChecks.undoEnabled === false,
    JSON.stringify({ texel: await texelAt(32, 6), undo: s.menuChecks.undoEnabled })
  );
  await mouse('mouseMoved', at(32, 6).x, at(32, 6).y, { buttons: 0 });
  await sleep(100);
  s = await probe();
  check(
    'inside the selection the canvas claims the arrow',
    s.cursorClaim === 'arrow',
    s.cursorClaim
  );
  await mouse('mouseMoved', at(10, 30).x, at(10, 30).y, { buttons: 0 });
  await sleep(100);
  s = await probe();
  check('outside it the crosshair returns', s.cursorClaim === 'crosshair', s.cursorClaim);
  await keyPress('Escape');
  await sleep(100);
  s = await probe();
  check('Esc drops the selection (ants gone)', !(await antsUp()));
  check(
    '…and the readout empties with it',
    !/\d/.test(s.optsReadout || ''),
    s.optsReadout
  );

  // Two pencil dots: A inside the marquee-to-be, B where a TRANSPARENT texel
  // of the float will land after the move.
  await keyPress('b');
  await click(at(32, 6).x, at(32, 6).y);
  await sleep(100);
  await click(at(30, 16).x, at(30, 16).y);
  await sleep(150);
  s = await probe();
  const inkA = hex(await texelAt(32, 6));
  const inkB = hex(await texelAt(30, 16));
  check(
    'two pencil clicks land A and B in the boot ink',
    inkA === s.inkColor && inkB === s.inkColor,
    JSON.stringify({ A: inkA, B: inkB, ink: s.inkColor })
  );
  await keyPress('s');
  await drag(at(30, 4), at(34, 8));
  await sleep(150);
  check(
    'the marquee holds A, and its (30,6) texel is empty',
    (await antsUp()) &&
      (await texelAt(32, 6))[3] === 255 &&
      (await texelAt(30, 6))[3] === 0,
    JSON.stringify({ A: await texelAt(32, 6), hole: await texelAt(30, 6) })
  );
  // The modal guard: ⌘K then Esc closes the Colors dialog and leaves the
  // selection alone (a prevented Esc would strand the dialog open).
  await keyPress('k', META);
  await sleep(300);
  s = await probe();
  check('⌘K opens the Colors dialog over a selection', s.colorsOpen === true);
  await keyPress('Escape');
  await sleep(300);
  s = await probe();
  check(
    'Esc closes the dialog and the selection stays up',
    s.colorsOpen === false && (await antsUp()),
    JSON.stringify({ colorsOpen: s.colorsOpen, ants: await antsUp() })
  );
  // The move: grab A's texel, drag it ten rows down.
  await drag(at(32, 6), at(32, 16));
  await sleep(300);
  s = await probe();
  const movedA = await texelAt(32, 16);
  const hole = await texelAt(32, 6);
  const keptB = await texelAt(30, 16);
  check(
    'dragging inside moves the painted texel',
    hex(movedA) === inkA && movedA[3] === 255,
    `${movedA}`
  );
  check('…and leaves transparency behind', hole[3] === 0, `${hole}`);
  check(
    'a transparent texel of the float leaves the art under it (the rule)',
    hex(keptB) === inkB && keptB[3] === 255,
    `${keptB}`
  );
  check('the ants follow the float', await antsUp());
  // The float moved +10 rows: the readout's top is 14 now, its size unchanged.
  check(
    'the readout follows the float (top 4 → 14, size held)',
    /\b30\b.*\b14\b.*\b5\b.*\b5\b/.test(s.optsReadout || ''),
    s.optsReadout
  );
  check('a move is one undo step', s.menuChecks.undoEnabled === true);
  await keyPress('z', META);
  await sleep(300);
  check(
    '⌘Z puts the texel back',
    (await texelAt(32, 6))[3] === 255 && (await texelAt(32, 16))[3] === 0,
    JSON.stringify({ origin: await texelAt(32, 6), moved: await texelAt(32, 16) })
  );
  check('…and a structural change drops the selection', !(await antsUp()));
  await keyPress('s');
  await drag(at(30, 4), at(34, 8));
  await sleep(150);
  check('a fresh marquee comes up', await antsUp());
  await keyPress('b');
  await sleep(100);
  check('a tool switch drops it', !(await antsUp()));

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
  const inkBeforeSwap = s.inkColor;
  const topRadio = await centreOf('vf-radio[value="top"]');
  await click(topRadio.x, topRadio.y);
  await sleep(500);
  s = await probe();
  check('clicking a face radio switches the edited face', s.face === 'top', s.face);
  check('the selected-face dither follows', s.checkedRadio === 'top', s.checkedRadio);
  check('the status bar names the new face', s.tileStatus === 'Top Face', s.tileStatus);
  check('the tool survives the face swap', s.drawTool === 'fill', s.drawTool);
  check('the ink survives the face swap', s.inkColor === inkBeforeSwap);

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
    'the status bar still names the face (it never reads the tile size)',
    s.tileStatus === 'Front Face',
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
    `(() => {${DEEP} __q('sm-color-picker').querySelector('vf-dialog').close(); })()`
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
        dialogs: __q('sm-color-picker').querySelectorAll('vf-dialog').length,
        cells: __qa('.editor-picker-grid vf-swatch').length,
        canvases: __qa('.editor-canvas').length }; })()`
  );
  check('three face swaps reuse ONE element', counts.editors === 1, `${counts.editors}`);
  check(
    'the picker dialog is built once, ever',
    counts.dialogs === 1,
    `${counts.dialogs}`
  );
  check('the picker keeps its 168 cells', counts.cells === 168, `${counts.cells}`);
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
  // The onion-skin is the background layer's only painter (its ground is
  // transparent), so "showing" is a texel with a partial alpha —
  // MIRROR_ALPHA's tint of the opposite face.
  const onionSkinShowing = () =>
    evaluate(`(() => {${DEEP}
      const c = __qd('.editor-canvas-bg');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0 && d[i] < 255) return true;
      return false;
    })()`);

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

  // --- the 168-colour dialog ------------------------------------------------
  // A synthesized mouse-up after a native modal closes is one of the states
  // that provokes the headless reload described in the header — every section
  // after this one starts from a deliberate fresh load.
  section('palette');
  await freshPage();
  s = await probe();
  const inkBefore = s.inkColor;
  const swatch = await centreOf('.editor-selected');
  await click(swatch.x, swatch.y);
  await sleep(400);
  s = await probe();
  check('clicking the ink swatch opens the Colors dialog', s.colorsOpen === true);
  check(
    'the Colors dialog lives in the light DOM (the kit cursor stacks above it)',
    s.colorsDialogLightDom === true
  );
  // The dialog's form: the pending-selection preview swatch, the hex field,
  // and the Cancel / OK row (all light DOM — plain queries reach them).
  const pickerForm = () =>
    evaluate(
      `(() => { const p = document.querySelector('sm-color-picker');
        return { hex: p.querySelector('.picker-hex').value,
                 preview: p.querySelector('.picker-preview').getAttribute('color'),
                 okDisabled: p.querySelector('.picker-ok').disabled }; })()`
    );
  let form = await pickerForm();
  check(
    'the form seeds from the current ink (hex field + preview swatch)',
    form.hex === inkBefore && form.preview === inkBefore,
    `${form.hex} / ${form.preview} vs ${inkBefore}`
  );
  // Pick a cell whose color differs from the current ink, so the select and
  // commit checks below observe a real change.
  const cell = await evaluate(
    `(() => {${DEEP} const cells = __qa('.editor-picker-grid vf-swatch');
      const c = cells.find((x) => x.getAttribute('color') !== '${inkBefore}');
      const r = c.getBoundingClientRect();
      return { count: cells.length,
               x: r.left + r.width / 2, y: r.top + r.height / 2,
               color: c.getAttribute('color'), name: c.getAttribute('label') }; })()`
  );
  check(
    'the dialog holds the full 168-colour palette',
    cell.count === 168,
    `${cell.count}`
  );
  // Hover the cell (a real trusted mouse move, no buttons): the readout line
  // under the grid must name the hovered color — chip aside, name and hex.
  const pickerReadout = () =>
    evaluate(
      `(() => { const p = document.querySelector('sm-color-picker');
        return { name: p.querySelector('.picker-readout-name').textContent.trim(),
                 hex: p.querySelector('.picker-readout-hex').textContent.trim() }; })()`
    );
  await mouse('mouseMoved', cell.x, cell.y, { buttons: 0 });
  await sleep(300);
  let readout = await pickerReadout();
  check(
    'hovering a palette cell shows its color name and hex in the readout',
    readout.name === cell.name && readout.hex === cell.color,
    `${readout.name} / ${readout.hex} vs ${cell.name} / ${cell.color}`
  );
  await click(cell.x, cell.y);
  await sleep(400);
  s = await probe();
  form = await pickerForm();
  check(
    'clicking a swatch selects, not commits: the dialog stays open',
    s.colorsOpen === true
  );
  check('…the ink is untouched until OK', s.inkColor === inkBefore, `${s.inkColor}`);
  check(
    'the selection lands in the hex field and the preview swatch',
    form.hex === cell.color && form.preview === cell.color,
    `${form.hex} / ${form.preview} vs ${cell.color}`
  );
  const okBtn = await centreOf('.picker-ok');
  await click(okBtn.x, okBtn.y);
  await sleep(400);
  s = await probe();
  check('OK closes the dialog', s.colorsOpen === false);
  check(
    '…and commits the selection as the ink',
    s.inkColor === cell.color,
    `${s.inkColor}`
  );
  // Reopen via the menu key equivalent for the manual-entry flow below.
  await keyPress('k', META);
  await sleep(400);
  s = await probe();
  check('⌘K reopens the Colors dialog', s.colorsOpen === true);
  // Manual hex entry, on the still-open dialog: an invalid string disables OK
  // (the preview holds the last valid color); a valid one re-enables it and
  // retints the preview — any color, not just the 168 — and Enter is OK.
  // Real keystrokes into the field; select() so each entry replaces the text.
  // The entries are typed HASH-LESS (a form the field accepts) because '#' is
  // untypeable here: keyDesc's derived virtual-key code for '#' is 35 — VK_END
  // — so headless Chrome treats the keystroke as the End key, collapsing the
  // selection, after which every insert is blocked by the field's maxlength.
  const selectHexField = () =>
    evaluate(
      `(() => { const input = document.querySelector('sm-color-picker .picker-hex')
        .shadowRoot.querySelector('input');
        input.focus(); input.select(); })()`
    );
  await selectHexField();
  await typeText('12z');
  await sleep(300);
  form = await pickerForm();
  check('an invalid hex entry disables OK', form.okDisabled === true, form.hex);
  check(
    '…while the preview holds the last valid color',
    form.preview === cell.color,
    `${form.preview}`
  );
  await selectHexField();
  await typeText('123abc');
  await sleep(300);
  form = await pickerForm();
  check(
    'a valid hex entry re-enables OK and retints the preview (normalized to #rrggbb)',
    form.okDisabled === false && form.preview === '#123abc',
    `${form.hex} / ${form.preview}`
  );
  // Nothing hovered, so the readout rests on the pending selection — a typed
  // color no palette swatch holds reads as "Custom".
  readout = await pickerReadout();
  check(
    'the readout names a typed off-palette pending color "Custom"',
    readout.name === 'Custom' && readout.hex === '#123abc',
    `${readout.name} / ${readout.hex}`
  );
  await keyPress('Enter');
  await sleep(400);
  s = await probe();
  check(
    'Enter in the field commits the typed color as the ink',
    s.colorsOpen === false && s.inkColor === '#123abc',
    `${s.inkColor}`
  );
  // Cancel discards: reopen, select a different cell, Cancel — the ink keeps.
  await keyPress('k', META);
  await sleep(400);
  const other = await evaluate(
    `(() => {${DEEP} const c = __qa('.editor-picker-grid vf-swatch')
        .find((x) => x.getAttribute('color') !== '#123abc');
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
  );
  await click(other.x, other.y);
  await sleep(300);
  const pickerCancel = await centreOf('.picker-cancel');
  await click(pickerCancel.x, pickerCancel.y);
  await sleep(400);
  s = await probe();
  check(
    'Cancel discards the pending selection (the ink keeps)',
    s.colorsOpen === false && s.inkColor === '#123abc',
    `${s.inkColor}`
  );

  // --- desktop: the View menu + the permanent windoids -------------------------
  section('view menu');
  await freshPage();
  // The windoids are non-closeable chrome: shell/windows.js states
  // `closable = false` on each (the kit's default is true and markup can't
  // say false), and no menu item can hide them (visibility is appActive's).
  // The property is the app's statement; what the kit draws for it is the
  // kit's own contract.
  const windoidClosable = await evaluate(
    `(() => {${DEEP} return ['#win-sprite', '#win-stage', '#win-tools'].map((sel) =>
        __q(sel).closable); })()`
  );
  check(
    'the utility windoids are non-closeable (closable stated false on each)',
    windoidClosable.every((b) => b === false),
    JSON.stringify(windoidClosable)
  );
  const windoidMenuItems = await evaluate(
    `(() => {${DEEP} return ['view-sprite', 'view-stage', 'view-tools']
        .filter((v) => __q('vf-menu-item[value="' + v + '"]')); })()`
  );
  check(
    'no menu item toggles a windoid',
    windoidMenuItems.length === 0,
    JSON.stringify(windoidMenuItems)
  );
  // …the 3D Sprite Atlas being the one exception on both counts: it stays
  // closable (the kit's close box), and View → 3D Sprite Atlas toggles it
  // (the atlas section drives both).
  const ringExceptions = await evaluate(
    `(() => {${DEEP} return {
        closable: __q('#win-ring').closable,
        item: !!__q('vf-menu-item[value="ring"]') }; })()`
  );
  check(
    'the 3D Sprite Atlas windoid is the exception: closable, with a View item',
    ringExceptions.closable === true && ringExceptions.item === true,
    JSON.stringify(ringExceptions)
  );
  s = await probe();
  check(
    'the ⌘J item is live with a document open — and, fresh from the placement, reads the zoom state',
    s.menuEnabled.arrange === true && s.menuEnabled.arrangeValue === 'zoom',
    JSON.stringify(s.menuEnabled)
  );
  // The paper under the art is the canvas stack container's OWN kit
  // pattern — permanently the 50% dither (`gray-50`), the transparency
  // indicator. No toggle: no menu item touches it, and the background layer
  // carries no dot grid — its only painter left is the onion-skin, whose
  // MIRROR_ALPHA tint never reaches full opacity (a dot was alpha 255).
  const paper = () =>
    evaluate(`(() => {${DEEP} return __qd('.editor-canvas-stack').pattern; })()`);
  check(
    "the paper is permanently the kit's 50% dither (the stack container's pattern)",
    (await paper()) === 'gray-50',
    `${await paper()}`
  );
  const bgOpaquePx = await evaluate(`(() => {${DEEP}
    const c = __qd('.editor-canvas-bg');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] === 255) n++;
    return n;
  })()`);
  check(
    'no dot grid: nothing opaque on the background layer (the onion-skin tint at most)',
    bgOpaquePx === 0,
    `${bgOpaquePx} opaque px`
  );
  const ditherItem = await evaluate(
    `(() => {${DEEP} return !!__q('vf-menu-item[value="dither"]'); })()`
  );
  check('no menu item toggles the paper', ditherItem === false);

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
  // The title-bar drag and the grow box are the kit's gestures — no checks
  // of their own; that they landed is folded into the checks on what the
  // app does with the result (the canvas re-fit, Arrange).
  const dragged =
    posAfter.left === posBefore.left + 40 && posAfter.top === posBefore.top + 24;

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
  const grown = sizeAfter.w === sizeBefore.w + 30 && sizeAfter.h === sizeBefore.h + 20;
  check(
    'the THREE canvas follows a grow-box resize of the 3D View',
    grown && sizeAfter.cw > sizeBefore.cw,
    JSON.stringify({ grown, sizeBefore, sizeAfter })
  );
  // View → Arrange Windows: the boot placement re-run on the current raster
  // — the dragged document window and the grown 3D View both land back
  // exactly where the boot put them (same raster, same arithmetic).
  await pickMenu('#menu-view', 'arrange');
  const arranged = await evaluate(
    `(() => {${DEEP} const d = __doc(); const st = __q('#win-stage');
      return { doc: { top: d.top, left: d.left }, stage: { w: st.width, h: st.height } }; })()`
  );
  check(
    'View → Arrange Windows puts the dragged window and the grown 3D View back',
    dragged &&
      grown &&
      arranged.doc.left === posBefore.left &&
      arranged.doc.top === posBefore.top &&
      arranged.stage.w === sizeBefore.w &&
      arranged.stage.h === sizeBefore.h,
    JSON.stringify({ dragged, grown, posBefore, posAfter, sizeBefore, arranged })
  );
  // ⌘J is Arrange's key equivalent (`shortcut` on the item; the kit's
  // document-level ear claims the chord and activates the item, menu
  // closed). Drag the document window off its placed position again — the
  // bar is back where the first drag found it, Arrange having put it there
  // — and the chord lands it back: the same arithmetic as the pick.
  await mouse('mousePressed', bar.x, bar.y);
  await mouse('mouseMoved', bar.x + 20, bar.y + 12, { buttons: 1 });
  await mouse('mouseMoved', bar.x + 40, bar.y + 24, { buttons: 1 });
  await mouse('mouseReleased', bar.x + 40, bar.y + 24, { buttons: 0 });
  await sleep(300);
  const draggedAgain = await evaluate(
    `(() => {${DEEP} const w = __doc(); return { top: w.top, left: w.left }; })()`
  );
  s = await probe();
  const offPlacement = { ...s.menuEnabled };
  await keyPress('j', META);
  await sleep(600);
  const keyArranged = await evaluate(
    `(() => {${DEEP} const w = __doc(); return { top: w.top, left: w.left }; })()`
  );
  check(
    '⌘J is Arrange Windows while something is off its placement: the chord puts the dragged window back',
    offPlacement.arrangeValue === 'arrange' &&
      draggedAgain.left === posBefore.left + 40 &&
      draggedAgain.top === posBefore.top + 24 &&
      keyArranged.left === posBefore.left &&
      keyArranged.top === posBefore.top,
    JSON.stringify({ posBefore, draggedAgain, keyArranged, item: offPlacement })
  );
  // A STATE rule, not a sequence: everything now where the placement puts
  // it, the same item turns to its other command — value `zoom`, the label
  // its readout — and the chord zooms the ACTIVE document window through
  // the zoom box's own toggle (layout.js zoomedBox the oracle: the
  // vacancy's edges, top-left held); a window zoomed from its slot still
  // reads arranged — the zoom IS the zoom box's toggle — so the item stays
  // Zoom Window and the next chord restores that one window: repeats
  // toggle it, nothing else moving.
  const docBoxNow = () =>
    evaluate(
      `(() => {${DEEP} const w = __doc(); const d = __q('#desktop');
        return { left: w.left, top: w.top, w: w.width, h: w.height,
          deskW: d.width, deskH: d.height }; })()`
    );
  s = await probe();
  const arrangedDoc = await docBoxNow();
  check(
    'arranged, the ⌘J item turns to the zoom state: value `zoom`, its label a different readout, still live',
    s.menuEnabled.arrange === true &&
      s.menuEnabled.arrangeValue === 'zoom' &&
      s.menuEnabled.arrangeLabel !== offPlacement.arrangeLabel,
    JSON.stringify({ off: offPlacement, arranged: s.menuEnabled })
  );
  await keyPress('j', META);
  await sleep(600);
  const zoomedDoc = await docBoxNow();
  const zoomedWant = zoomedBox(arrangedDoc.deskW, arrangedDoc.deskH, arrangedDoc);
  s = await probe();
  check(
    "⌘J again zooms the active document window (the zoom box's own toggle, top-left held) — and the item stays Zoom Window: the zoom is part of the arranged reading",
    zoomedDoc.left === arrangedDoc.left &&
      zoomedDoc.top === arrangedDoc.top &&
      zoomedDoc.w === zoomedWant.width &&
      zoomedDoc.h === zoomedWant.height &&
      s.menuEnabled.arrangeValue === 'zoom',
    JSON.stringify({ arrangedDoc, zoomedDoc, zoomedWant, item: s.menuEnabled })
  );
  await keyPress('j', META);
  await sleep(600);
  const toggledBack = await docBoxNow();
  s = await probe();
  check(
    "⌘J a third time restores it — the toggle's other half: the document back on its doc box, the item still Zoom Window",
    toggledBack.left === arrangedDoc.left &&
      toggledBack.top === arrangedDoc.top &&
      toggledBack.w === arrangedDoc.w &&
      toggledBack.h === arrangedDoc.h &&
      s.menuEnabled.arrangeValue === 'zoom',
    JSON.stringify({ arrangedDoc, toggledBack, item: s.menuEnabled })
  );

  // --- the zoom box: fill the vacancy / back to the doc box -------------------
  // The document window's title bar carries the kit's zoom box (`zoomable`
  // on the template). One click grows the window right and down — top-left
  // HELD — to the vacant middle's own edges (layout.js zoomedBox is the
  // oracle: the rail's inset gutter at the right, the bottom margin below),
  // filling the open area without running under the windoid rail — and
  // records the size it grew FROM; a second click on a window still AT the
  // zoomed state returns exactly that remembered size (the doc box is only
  // the no-memory fallback), top-left still held. Probed right after
  // Arrange FROM A GROW-BOX-SHRUNK SIZE, so the restore provably returns
  // the REMEMBERED size and not the placement default; a final Arrange
  // hands the sections below the state they assume.
  const zoomClick = async () => {
    const b = await evaluate(
      `(() => {${DEEP} const z = __doc().shadowRoot
          .querySelector('[part="zoom-box"]').getBoundingClientRect();
        return { x: z.left + z.width / 2, y: z.top + z.height / 2 }; })()`
    );
    await click(b.x, b.y);
    await sleep(300);
  };
  const docBox = () =>
    evaluate(
      `(() => {${DEEP} const w = __doc(); const d = __q('#desktop');
        return { left: w.left, top: w.top, w: w.width, h: w.height,
          deskW: d.width, deskH: d.height }; })()`
    );
  const growDoc = async (dx, dy) => {
    const g = await evaluate(
      `(() => {${DEEP} const b = __doc().shadowRoot
          .querySelector('[part="grow-box"]').getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`
    );
    await mouse('mousePressed', g.x, g.y);
    await mouse('mouseMoved', g.x + dx, g.y + dy, { buttons: 1 });
    await mouse('mouseReleased', g.x + dx, g.y + dy, { buttons: 0 });
    await sleep(300);
  };
  const preZoom = await docBox();
  await growDoc(-40, -28);
  const zoomBefore = await docBox();
  // The grow-box shrink is the kit's gesture; that it set a size DISTINCT
  // from the placement default is the precondition folded into the restore
  // check below (the remembered size is only provable against one).
  const distinctPreZoom =
    zoomBefore.w === preZoom.w - 40 && zoomBefore.h === preZoom.h - 28;
  await zoomClick();
  const zoomedNow = await docBox();
  const zoomWant = zoomedBox(zoomBefore.deskW, zoomBefore.deskH, zoomBefore);
  check(
    'the zoom box fills the vacancy right and down, top-left held',
    zoomedNow.left === zoomBefore.left &&
      zoomedNow.top === zoomBefore.top &&
      zoomedNow.w === zoomWant.width &&
      zoomedNow.h === zoomWant.height,
    JSON.stringify({ zoomBefore, zoomedNow, zoomWant })
  );
  await zoomClick();
  const unzoomed = await docBox();
  check(
    'a second click returns the REMEMBERED pre-zoom size (a grow-box size, not the placement), top-left held',
    distinctPreZoom &&
      unzoomed.left === zoomBefore.left &&
      unzoomed.top === zoomBefore.top &&
      unzoomed.w === zoomBefore.w &&
      unzoomed.h === zoomBefore.h,
    JSON.stringify({ distinctPreZoom, preZoom, zoomBefore, unzoomed })
  );
  // Leave the window as Arrange did — the sections below assume that state.
  await pickMenu('#menu-view', 'arrange');

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
  // The grid against the window's BODY part (the header holds the picker
  // now — vintage-frames 0.6.1 — so the body is the grid's box exactly).
  const atlasFill = () =>
    evaluate(
      `(() => {${DEEP} const sr = __q('sm-atlas-view').shadowRoot;
        const g = sr.querySelector('vf-grid').getBoundingClientRect();
        const b = __q('#win-sprite').shadowRoot.querySelector('[part="body"]').getBoundingClientRect();
        return { cw: g.width, ch: g.height, bw: b.width, bh: b.height }; })()`
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
  // The raise re-inserts the windoid's node at the end of the band (the
  // kit's own z-order discipline — its contract, not pinned here); that it
  // happened is the precondition the tool-cell click below folds in, since
  // that click only proves anything with the palette BEHIND.
  const spriteRaised =
    spriteMoved &&
    (await evaluate(
      `(() => {${DEEP}
        const ids = [...document.querySelectorAll('vf-window')].map((w) => w.id);
        return ids.indexOf('win-sprite') > ids.indexOf('win-tools');
      })()`
    ));
  // The sprite windoid is FIXED-size — not `resizable` (the template's
  // statement; the grow box it does or doesn't draw is the kit's), its width
  // is the atlas grid block's (SPRITE_WIDTH = 214), and the 3×2 face-tile
  // grid fills the body below the picker strip exactly (the height is
  // derived from the tile's own ratio, so the exact fill IS the sizing
  // contract) — checked after the raise, so a reconnect that lost the
  // view's layout would show here.
  const spriteFixed = await evaluate(
    `(() => {${DEEP} const w = __q('#win-sprite');
      return { resizable: w.hasAttribute('resizable'), width: w.width }; })()`
  );
  check(
    'the sprite windoid is fixed-size (not resizable, atlas-grid width)',
    spriteFixed.resizable === false && spriteFixed.width === 214,
    JSON.stringify(spriteFixed)
  );
  const fill = await atlasFill();
  check(
    'the atlas grid exactly fills the sprite windoid body below the header',
    Math.abs(fill.cw - fill.bw) < 1 && Math.abs(fill.ch - fill.bh) < 1,
    JSON.stringify(fill)
  );
  // The two permanent windoids' controls strips are the windows' HEADERS
  // (vintage-frames 0.6.1, `slot="header"`), their heights authored in the
  // markup as `header-height` and pinned here to layout.js's numbers so
  // the markup and the chrome arithmetic can't drift — the app's
  // composition, read back as the kit's properties: the Sprite View's face picker in a placed
  // container at the DITL's rectangle (SPRITE_PICKER_AT / SPRITE_PICKER,
  // its live box the same), the 3D View's checkbox row in its header, the
  // pattern well filling the body under it.
  const headers = await evaluate(
    `(() => {${DEEP}
      const ws = __q('#win-sprite'); const wst = __q('#win-stage');
      const rect = (el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
      const rel = (el, base) => { const a = el.getBoundingClientRect(); const b = base.getBoundingClientRect();
        return { left: Math.round(a.left - b.left), top: Math.round(a.top - b.top), w: Math.round(a.width), h: Math.round(a.height) }; };
      const sh = ws.shadowRoot.querySelector('[part="header"]');
      const picker = __q('sm-atlas-controls').shadowRoot.querySelector('.picker');
      // The box's own paper (kit ask #6's bridge — a bare container paints
      // the desktop's raster): the blank pattern declared, and the raster
      // it paints written on ITS box, not inherited from the desktop.
      const pickerBox = picker.shadowRoot.querySelector('.box');
      const ownRaster = !!pickerBox && pickerBox.style.getPropertyValue('--_vf-pattern-image') !== '';
      const th = wst.shadowRoot.querySelector('[part="header"]');
      const body = wst.shadowRoot.querySelector('[part="body"]');
      const well = __q('#stage-well');
      return {
        sprite: { slot: __q('sm-atlas-controls').getAttribute('slot'), headerH: ws.headerHeight,
          header: rect(sh), picker: { left: picker.left, top: picker.top, w: picker.width, h: picker.height,
            pattern: picker.getAttribute('pattern'), ownRaster },
          pickerLive: rel(picker, sh),
          radios: __q('sm-face-picker').shadowRoot.querySelectorAll('vf-radio').length },
        stage: { slot: __q('sm-stage-controls').getAttribute('slot'), headerH: wst.headerHeight,
          header: rect(th), checks: [...__q('sm-stage-controls').shadowRoot.querySelectorAll('vf-checkbox')]
            .map((c) => rel(c, th)), well: rect(well), body: rect(body) },
      }; })()`
  );
  check(
    "the Sprite View's face picker is the window's header: slotted there at SPRITE_STRIP, the picker block placed at the DITL's rectangle on its own white paper (kit ask #6's bridge), its live box the same",
    headers.sprite.slot === 'header' &&
      headers.sprite.picker.pattern === 'white' &&
      headers.sprite.picker.ownRaster === true &&
      headers.sprite.headerH === SPRITE_STRIP &&
      headers.sprite.header.h === SPRITE_STRIP &&
      headers.sprite.header.w === spriteFixed.width - 2 &&
      headers.sprite.picker.left === SPRITE_PICKER_AT.left &&
      headers.sprite.picker.top === SPRITE_PICKER_AT.top &&
      headers.sprite.picker.w === SPRITE_PICKER.width &&
      headers.sprite.picker.h === SPRITE_PICKER.height &&
      headers.sprite.pickerLive.left === SPRITE_PICKER_AT.left &&
      headers.sprite.pickerLive.top === SPRITE_PICKER_AT.top &&
      headers.sprite.pickerLive.w === SPRITE_PICKER.width &&
      headers.sprite.pickerLive.h === SPRITE_PICKER.height &&
      headers.sprite.radios === 6,
    JSON.stringify(headers.sprite)
  );
  check(
    "the 3D View's checkbox row is the window's header: slotted there at STAGE_STRIP, both boxes inside it, the pattern well filling the body",
    headers.stage.slot === 'header' &&
      headers.stage.headerH === STAGE_STRIP &&
      headers.stage.header.h === STAGE_STRIP &&
      headers.stage.checks.length === 2 &&
      headers.stage.checks.every(
        (c) => c.top >= 0 && c.top + c.h <= STAGE_STRIP - 1 && c.left >= 0
      ) &&
      headers.stage.well.w === headers.stage.body.w &&
      headers.stage.well.h === headers.stage.body.h,
    JSON.stringify(headers.stage)
  );
  // The atlas grid is a picking surface too: pressing a face tile selects
  // that face — on the PRESS, the Tools palette's mouse-down feel (probed
  // between the press and the release, so the switch is provably the
  // press's; the release's click, landing under the kit's 0.5.4 timing,
  // must be a no-op) — and the selection ring strokes exactly the picked
  // tile.
  s = await probe();
  const gridTarget = s.face === 'back' ? 'front' : 'back';
  const gridCell = await centreOf(`.atlas-cell[data-face="${gridTarget}"]`);
  await mouse('mousePressed', gridCell.x, gridCell.y);
  await sleep(200);
  s = await probe();
  check(
    'an atlas grid tile picks on the PRESS (the palette feel)',
    s.face === gridTarget,
    s.face
  );
  await mouse('mouseReleased', gridCell.x, gridCell.y, { buttons: 0 });
  await sleep(200);
  s = await probe();
  check(
    '…and the release (its click a no-op) leaves that face selected',
    s.face === gridTarget,
    s.face
  );
  check(
    'the picker radios follow the atlas pick',
    s.checkedRadio === gridTarget,
    s.checkedRadio
  );
  const ringOn = await evaluate(
    `(() => {${DEEP}
      return __qa('.atlas-cell')
        .filter((c) =>
          getComputedStyle(c.querySelector('.atlas-ring')).visibility === 'visible')
        .map((c) => c.dataset.face)
        .join(',');
    })()`
  );
  check(
    'the selection ring strokes exactly the picked tile',
    ringOn === gridTarget,
    ringOn
  );
  // The ring is INK — black, the 1-bit face art's own (its red went with
  // the red-tinted cubes) — read as the computed border color.
  const ringInk = await evaluate(
    `(() => {${DEEP}
      const ring = __q('.atlas-cell[data-face="${gridTarget}"] .atlas-ring');
      return ring ? getComputedStyle(ring).borderTopColor : null;
    })()`
  );
  check('the selection ring is black ink', ringInk === 'rgb(0, 0, 0)', ringInk);
  // A windoid control acts on the ordinary CLICK — no press-driven bridge
  // anywhere in the app since vintage-frames 0.5.4 syncs the light-DOM
  // order in a task AFTER a press's click has landed (the kit used to
  // re-insert a raised window's node at pointerup, between the release and
  // its click, and Chrome drops a click whose mousedown node left the
  // tree — so the first click in a windoid behind another windoid was
  // swallowed). The sprite windoid was just raised over the palette, so
  // this ONE click is that case: it raises the palette, and the pick must
  // land anyway. The DOM order after is folded in (the sync lands within
  // the sleep), so the run proves it exercised the raise and not a palette
  // already frontmost — without pinning the raise itself (the kit's).
  // The Tools palette's cells are the one exception, by design: a cell
  // picks on the PRESS — System 7's palettes act on mouse-down, the feel
  // the user wants — so this is probed BETWEEN the press and the release
  // (the switch is provably the press's), and again after the release,
  // when the click lands (the kit's 0.5.4 re-insert runs after it) and
  // must be a no-op — nothing toggling, the tool still selected.
  s = await probe();
  const pressTool = s.drawTool === 'fill' ? 'pencil' : 'fill';
  const toolCell = await centreOf(`.editor-tool[aria-label="${pressTool}"]`);
  await mouse('mousePressed', toolCell.x, toolCell.y);
  await sleep(100);
  s = await probe();
  check(
    'a tool cell picks on the PRESS (the palette feel), the palette not frontmost',
    spriteRaised && s.drawTool === pressTool && s.menuChecks.tool === pressTool,
    JSON.stringify({ spriteRaised, strip: s.drawTool, menu: s.menuChecks.tool })
  );
  await mouse('mouseReleased', toolCell.x, toolCell.y, { buttons: 0 });
  await sleep(200);
  s = await probe();
  const toolsRaised = await evaluate(
    `(() => {${DEEP}
      const ids = [...document.querySelectorAll('vf-window')].map((w) => w.id);
      return ids.indexOf('win-tools') > ids.indexOf('win-sprite');
    })()`
  );
  check(
    '…and the release (its click a no-op) leaves it selected, the palette raised',
    toolsRaised === true && s.drawTool === pressTool,
    JSON.stringify({ toolsRaised, tool: s.drawTool })
  );
  // The 3D View's checkboxes (sm-stage-controls) are the kit's own
  // click-driven toggles, and the bug this pins was theirs: a checkbox in a
  // windoid needed a SECOND click whenever another windoid had been raised
  // over the 3D View — after boot the common case (the Tools palette boots
  // topmost). The palette was just raised, so the 3D View is behind it:
  // this ONE click is exactly that case, and it must flip the box — the
  // model's tri count the app-level witness that the pref reached the
  // pipeline (smooth is the wedge pass over the car's slopes), the DOM
  // order after folded in (the raise happened; the click survived it).
  // Then a second click, the 3D View frontmost, flips it back — once — and
  // Space on the focused box toggles it through the keyboard path. The
  // pref ends where it began.
  s = await probe();
  const smoothBefore = s.stageToggles.smooth;
  const trisBefore = s.stats.tris;
  const smoothBox = await centreOf('#stage-smooth');
  await click(smoothBox.x, smoothBox.y);
  await sleep(400);
  s = await probe();
  const stageRaised = await evaluate(
    `(() => {${DEEP}
      const ids = [...document.querySelectorAll('vf-window')].map((w) => w.id);
      return ids.indexOf('win-stage') > ids.indexOf('win-tools');
    })()`
  );
  check(
    'one click on a 3D View checkbox flips it, the 3D View not frontmost (re-meshed, the windoid raised)',
    stageRaised === true &&
      s.stageToggles.smooth === !smoothBefore &&
      s.stats.tris !== trisBefore,
    JSON.stringify({
      stageRaised,
      before: smoothBefore,
      smooth: s.stageToggles.smooth,
      tris: [trisBefore, s.stats.tris],
    })
  );
  await click(smoothBox.x, smoothBox.y);
  await sleep(400);
  s = await probe();
  check(
    'a second click, the 3D View frontmost, flips it back — once, never twice',
    s.stageToggles.smooth === smoothBefore && s.stats.tris === trisBefore,
    JSON.stringify({ smooth: s.stageToggles.smooth, tris: [trisBefore, s.stats.tris] })
  );
  await keyPress('Space');
  await sleep(400);
  s = await probe();
  check(
    'Space on the focused checkbox toggles it (the keyboard path)',
    s.stageToggles.smooth === !smoothBefore && s.stats.tris !== trisBefore,
    JSON.stringify({ smooth: s.stageToggles.smooth, tris: [trisBefore, s.stats.tris] })
  );
  await keyPress('Space');
  await sleep(400);
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
  // The canvas renders on the kit's virtual system-pixel grid (README's
  // Canvas layout bullet): the layers ride a placed vf-container sized at a
  // whole number of SYSTEM px per texel (so a texel is whole device px by
  // the kit's scale contract), its centered top/left stated in whole system
  // px — on the lattice by construction — probed after the grow, so the
  // re-fit path is what's pinned, not just the boot layout.
  const stackGrid = await evaluate(
    `(() => {${DEEP} const stack = __qd('.editor-canvas-stack');
      const canvas = __qd('.editor-canvas');
      const r = stack.getBoundingClientRect();
      const scale =
        parseFloat(getComputedStyle(stack).getPropertyValue('--vf-scale')) || 1;
      const err = (v) =>
        Math.abs(v * devicePixelRatio - Math.round(v * devicePixelRatio));
      return { left: err(r.left), top: err(r.top),
        texel: r.width / scale / canvas.width }; })()`
  );
  check(
    'the canvas stack sits on the device grid at a whole-system-px texel size',
    stackGrid.left < 0.06 &&
      stackGrid.top < 0.06 &&
      stackGrid.texel >= 1 &&
      Math.abs(stackGrid.texel - Math.round(stackGrid.texel)) < 0.01,
    JSON.stringify(stackGrid)
  );
  // …and placement must not RATCHET across resizes. History: the first grid
  // implementation flex-centered the stack and canceled the fractional
  // origin with an accumulating measured snap — each pass landed within half
  // a px of the PREVIOUS offset, and the .5 residuals centering mints on
  // odd-sized wells always round UP (Math.round ties), so a resize stream
  // walked the canvas steadily down-right (failed here at {dx:4,dy:5}).
  // Placement is DECLARED in whole system px on a vf-container now, so there
  // is nothing to accumulate — this pin holds the door shut on any future
  // mechanism. The steps are ODD deliberately: an even resize preserves the
  // parity of (well − canvas) and never re-mints the .5 that engaged the old
  // ratchet (±64 passed against the accumulating code). Eight odd
  // round-trips, then the canvas must still sit centered in the well.
  for (let i = 0; i < 4; i++) {
    await grow('DOC', -63, -63);
    await grow('DOC', 63, 63);
  }
  const centered = await evaluate(
    `(() => {${DEEP} const wrap = __qd('.editor-canvas-wrap');
      const stack = __qd('.editor-canvas-stack');
      const w = wrap.getBoundingClientRect();
      const s = stack.getBoundingClientRect();
      return { dx: s.left + s.width / 2 - (w.left + w.width / 2),
        dy: s.top + s.height / 2 - (w.top + w.height / 2) }; })()`
  );
  check(
    'eight grow round-trips leave the canvas centered (the snap cannot ratchet)',
    Math.abs(centered.dx) <= 1.5 && Math.abs(centered.dy) <= 1.5,
    JSON.stringify(centered)
  );

  // --- desktop: focus / deactivation ------------------------------------------
  // The two-role model: clicking the desktop's own surface is "clicking the
  // Finder" — the document window drops its active state, the utility
  // windoids hide (they return with the application), the options strip
  // hides with them, the bare-letter tool keys go inert, and the menus fall to the
  // Finder grammar (New always; Open only with an icon selected, acting on
  // it). Clicking back into the document window — or opening from an icon —
  // undoes all of it.
  section('focus / deactivation');
  await freshPage();
  s = await probe();
  check(
    'the app boots active: windoids up, options strip up, document window active',
    s.docActive &&
      s.windows.tools &&
      s.windows.sprite &&
      s.windows.stage &&
      s.optionsStrip,
    JSON.stringify({ docActive: s.docActive, windows: s.windows, strip: s.optionsStrip })
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
  check('…the options strip hides with the application', s.optionsStrip === false);
  check(
    '…the Finder menu grammar lands: New and Open… stay, the rest grey out (the ⌘J item too: everything arranged, nothing to arrange and no active window to zoom)',
    s.menuEnabled.newDoc === true &&
      s.menuEnabled.open === true &&
      s.menuEnabled.openLabel === 'Open…' &&
      s.menuEnabled.save === false &&
      s.menuEnabled.close === false &&
      s.menuEnabled.pickColor === false &&
      s.menuEnabled.arrange === false &&
      s.menuEnabled.arrangeValue === 'zoom' &&
      s.menuEnabled.toolPencil === false,
    JSON.stringify(s.menuEnabled)
  );
  await keyPress('r');
  s = await probe();
  check('…the bare-letter tool keys are inert', s.drawTool === 'pencil', s.drawTool);
  // Selecting a desktop icon is still working in the Finder: the item
  // relabels to a bare "Open" (no ellipsis — no dialog), aimed at the
  // selection. (Every icon is a saved doc now — the seeded Car's key is a
  // random id, so find it by label.)
  const carIcon = await evaluate(`(() => {${DEEP}
    const i = __qa('vf-icon[data-key]').find((el) => el.label === 'Car');
    const r = i.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await click(carIcon.x, carIcon.y);
  await sleep(300);
  s = await probe();
  check(
    'selecting an icon relabels Open… to "Open" (the Finder grammar)',
    s.menuEnabled.open === true &&
      s.menuEnabled.openLabel === 'Open' &&
      s.docActive === false,
    JSON.stringify({ open: s.menuEnabled, docActive: s.docActive })
  );
  // The pointer path: pulling the File menu is a press on the application's
  // chrome, and the selection survives it (the kit's vf-icon deselects on
  // ANY outside press — kit ask #5, APP-IA-PLAN.md §3.1 — so shell/icons.js
  // re-selects across the press), leaving Open… enabled in the dropped
  // panel, aimed at the selection. A tap on the title leaves the panel
  // open (the kit's press gesture), which is the moment to probe.
  const selectedIcons = () =>
    evaluate(`(() => {${DEEP}
      return __qa('vf-icon[data-key]').filter((i) => i.selected).map((i) => i.label);
    })()`);
  const fileTitle = await centreOf('#menu-file');
  await click(fileTitle.x, fileTitle.y);
  await sleep(250);
  s = await probe();
  check(
    'pulling the File menu keeps the icon selected and the item reading "Open"',
    (await selectedIcons()).join(',') === 'Car' && s.menuEnabled.openLabel === 'Open',
    JSON.stringify({ selected: await selectedIcons(), open: s.menuEnabled })
  );
  const openItem = await centreOf('vf-menu-item[value="open"]');
  await click(openItem.x, openItem.y);
  await sleep(900);
  s = await probe();
  check(
    'File → Open opens the selected icon and reactivates the application',
    s.docActive === true &&
      s.docWindows === 2 &&
      s.windows.tools &&
      s.windows.sprite &&
      s.windows.stage &&
      s.optionsStrip,
    JSON.stringify({
      docActive: s.docActive,
      docWindows: s.docWindows,
      windows: s.windows,
      strip: s.optionsStrip,
    })
  );
  check(
    '…and the activation clears the Finder selection',
    (await selectedIcons()).length === 0,
    JSON.stringify(await selectedIcons())
  );
  // The key path: select again from the Finder, then ⌘O — the already-open
  // Car activates its existing window (one window per document).
  await click(BARE.x, BARE.y);
  await sleep(300);
  await click(carIcon.x, carIcon.y);
  await sleep(300);
  await keyPress('o', META);
  await sleep(900);
  s = await probe();
  check(
    '⌘O opens the selection and reactivates the application',
    s.docActive === true &&
      s.docWindows === 2 &&
      s.windows.tools &&
      s.windows.sprite &&
      s.windows.stage &&
      s.optionsStrip,
    JSON.stringify({ docActive: s.docActive, windows: s.windows, strip: s.optionsStrip })
  );
  // With the desktop focused and NOTHING selected, Open… is the Finder's
  // browse: the same listing dialog the application's Open… raises.
  await click(BARE.x, BARE.y);
  await sleep(300);
  s = await probe();
  check(
    'a bare-desktop click clears the selection: the item reads "Open…" again',
    (await selectedIcons()).length === 0 && s.menuEnabled.openLabel === 'Open…',
    JSON.stringify({ selected: await selectedIcons(), open: s.menuEnabled })
  );
  await pickMenu('#menu-file', 'open');
  const openDlgUp = () => evaluate(`document.querySelector('#dlg-open').open`);
  check(
    'File → Open… from the Finder raises the listing dialog',
    (await openDlgUp()) === true
  );
  const openCancel = await centreOf('#btn-open-cancel');
  await click(openCancel.x, openCancel.y);
  await sleep(300);
  s = await probe();
  check(
    'Cancel leaves the desktop focused (nothing opened)',
    (await openDlgUp()) === false && s.docActive === false && s.docWindows === 2,
    JSON.stringify({
      dialog: await openDlgUp(),
      docActive: s.docActive,
      docs: s.docWindows,
    })
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
    'clicking the document window reactivates: stripes, windoids and strip return',
    s.docActive === true &&
      s.windows.tools &&
      s.windows.sprite &&
      s.windows.stage &&
      s.optionsStrip,
    JSON.stringify({ docActive: s.docActive, windows: s.windows, strip: s.optionsStrip })
  );
  // Off its placement, the ⌘J item is Arrange Windows in BOTH roles: drag
  // the document window, click the Finder — the item is live, reading the
  // arrange state — and the pick from the Finder role lands the
  // arrangement (the hidden windoids re-railed with it) without activating
  // anything: positions only, the item back to its greyed zoom state.
  const barOff = await evaluate(
    `(() => {${DEEP} const r = __doc().getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 9 }; })()`
  );
  await mouse('mousePressed', barOff.x, barOff.y);
  await mouse('mouseMoved', barOff.x + 20, barOff.y + 12, { buttons: 1 });
  await mouse('mouseMoved', barOff.x + 40, barOff.y + 24, { buttons: 1 });
  await mouse('mouseReleased', barOff.x + 40, barOff.y + 24, { buttons: 0 });
  await sleep(300);
  const BARE_OFF = await bareSpot();
  check(
    'found a bare patch of desktop beside the dragged window',
    !!BARE_OFF,
    JSON.stringify(BARE_OFF)
  );
  if (BARE_OFF) await click(BARE_OFF.x, BARE_OFF.y);
  await sleep(300);
  s = await probe();
  check(
    'a document window dragged off its placement makes the ⌘J item Arrange Windows in the Finder role too: live, value `arrange`',
    s.docActive === false &&
      s.menuEnabled.arrange === true &&
      s.menuEnabled.arrangeValue === 'arrange',
    JSON.stringify({ docActive: s.docActive, item: s.menuEnabled })
  );
  await pickMenu('#menu-view', 'arrange');
  s = await probe();
  check(
    '…and the pick from the Finder lands the arrangement: the item back to its greyed zoom state, nothing activated',
    s.docActive === false &&
      s.menuEnabled.arrangeValue === 'zoom' &&
      s.menuEnabled.arrange === false,
    JSON.stringify({ docActive: s.docActive, item: s.menuEnabled })
  );

  // --- desktop: multiple documents ---------------------------------------------
  // One document = one window: File → New opens a second window (staggered,
  // active); each document carries its own undo history and drives the
  // utility windows only while active; Close and Quit walk the dirty checks
  // per document (the System 7 cascade).
  // --- desktop: the Desktop Patterns control panel ------------------------------
  // Sprite Machine → Desktop Patterns opens a document-tier window — the
  // Finder's: the application deactivates while it's front. A cell click
  // previews (the well + the ring), Set Desktop Pattern commits onto the
  // desktop, the close box removes the window and the application returns;
  // the pattern rides desktop-state across a reload. The section ends back
  // on the dither, so the profile's later sections boot on the default.
  // --- the 3D Sprite Atlas -------------------------------------------------------
  // The toggleable windoid: View → 3D Sprite Atlas shows it (it boots
  // hidden, the item unchecked) and its close box hides it; the placement
  // docks it on the bottom margin at the document's left (shell/layout.js
  // is the oracle: ringHeightFor(size) tall — the chrome over one row of
  // tile-size cells — seeded ringWidthFor(views, size) wide, capped at the
  // vacant middle); the cells are the tile at 1:1; the view count no longer
  // touches the window (a longer row overflows into the kit's horizontal
  // rail), the tile size moves its HEIGHT, and the grow box moves its WIDTH
  // alone (the app re-asserts the height on every vf-resize and floors the
  // width at the strip); File → Export Sprite Atlas… edits the same settings
  // behind the modal; the export is the strip's exact sheet with the ring's
  // metadata chunk; it hides with the application and a resize keeps it
  // docked, its width springing with the middle. The frame sizes come from
  // lib/ring.js over the Car's 40³ lattice. The desktop-click spot is the
  // focus section's bareSpot.
  section('3D sprite atlas');
  await freshPage();
  s = await probe();
  check(
    'the 3D Sprite Atlas boots hidden: the View item unchecked (and live), no windoid',
    s.ringShown === false && s.menuChecks.ring === false && s.menuEnabled.ring === true,
    JSON.stringify({
      shown: s.ringShown,
      checked: s.menuChecks.ring,
      live: s.menuEnabled.ring,
    })
  );
  const ringBox = () =>
    evaluate(
      `(() => {${DEEP} const w = __q('#win-ring'); const d = __q('#desktop'); const doc = __doc();
        const t = __q('#win-tools');
        const num = (sel) => { const f = __q(sel); return f ? +f.value : null; };
        const cell = __q('.ring-cell');
        // The kit's built-in scroll area's viewport (its exported part, in
        // the window's own shadow): the row's overflow is what puts the rail
        // to work.
        const vp = __q('[part="viewport"]', w.shadowRoot);
        // The windoid's DITL — the app's own statements, read back as the
        // kit's properties in system px: the controls strip in the window's
        // HEADER slot (vintage-frames 0.6.1; sm-ring-controls) at the
        // markup's header-height (pinned to layout.js's RING_STRIP so the
        // two can't drift), the header part's live box, the body's PAPER in
        // flow (no top/left — sm-ring-view: a vf-container pattern FILLING
        // the body's width, no declared width of its own, the tile tall —
        // its live width read back, its pattern the strip's paper radios'
        // choice), the grid inside it and its rules, a cell's declared box
        // and that it names no pattern of its own. (A comment inside the
        // evaluate string: no backticks.)
        const hdr = w.shadowRoot.querySelector('[part="header"]');
        const hr = hdr ? hdr.getBoundingClientRect() : null;
        const view = __q('sm-ring-view');
        const paper = view.shadowRoot.querySelector('.ring-paper');
        const grid = view.shadowRoot.querySelector('.ring-grid');
        const ditl = {
          controls: __q('sm-ring-controls').getAttribute('slot'),
          headerH: w.headerHeight,
          header: hr ? { w: Math.round(hr.width), h: Math.round(hr.height) } : null,
          paper: paper ? { top: paper.top ?? null, left: paper.left ?? null,
            fill: paper.hasAttribute('fill-width'), w: paper.width ?? null, h: paper.height,
            live: Math.round(paper.getBoundingClientRect().width),
            pattern: paper.getAttribute('pattern') } : null,
          grid: { top: grid.top ?? null, left: grid.left ?? null, rules: grid.rules },
          cell: cell ? { w: cell.width, h: cell.height, pattern: cell.getAttribute('pattern') } : null,
        };
        return { left: w.left, top: w.top, w: w.width, h: w.height, dw: d.width, dh: d.height,
          docLeft: doc.left, docTop: doc.top, docH: doc.height,
          toolsW: t.width, toolsH: t.height,
          cells: __qa('.ring-cell').length,
          views: num('.ring-views'), elev: num('.ring-elev'), offset: num('.ring-offset'),
          size: num('.ring-size'),
          cell: cell ? Math.round(cell.getBoundingClientRect().width) : null,
          ditl,
          scrollH: vp ? vp.scrollHeight : null, clientH: vp ? vp.clientHeight : null,
          scrollW: vp ? vp.scrollWidth : null, clientW: vp ? vp.clientWidth : null,
          // The windoid's composition — the app's own statement, not the
          // kit's rendering: the rail's axis, the grow box, no status, and
          // the grow box's declared size rect (the kit's min/max per axis).
          // (No flush attribute: vintage-frames 0.6.0 retired it — a body
          // runs to the frame by default.)
          scrollbars: w.getAttribute('scrollbars'), resizable: !!w.resizable,
          status: !!w.querySelector('[slot="status"]'),
          minW: w.minWidth, maxW: w.maxWidth, minH: w.minHeight, maxH: w.maxHeight }; })()`
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
  const DIMS = { nx: TILE, ny: TILE, nz: TILE };
  const S0 = RING_DEFAULTS.size;
  // The frame IS the tile: lib/ring.js hands the size back as the frame.
  const F0 = ringFrame(DIMS, 45, S0).px;
  await pickMenu('#menu-view', 'ring');
  s = await probe();
  let rb = await ringBox();
  check(
    'View → 3D Sprite Atlas shows the windoid and checks the item',
    s.ringShown === true && s.menuChecks.ring === true,
    JSON.stringify({ shown: s.ringShown, checked: s.menuChecks.ring })
  );
  check(
    "…docked on the bottom margin, left-aligned with the document — the tile's height, the seeded row's width (floored at the strip) — four cells at the default size",
    rb.left === rb.docLeft &&
      rb.top === rb.dh - 8 - ringHeightFor(S0) &&
      rb.w === ringWidthFor(4, S0) &&
      rb.h === ringHeightFor(S0) &&
      rb.cells === 4 &&
      rb.views === 4 &&
      rb.size === S0,
    JSON.stringify({
      rb,
      want: {
        top: rb.dh - 8 - ringHeightFor(S0),
        w: ringWidthFor(4, S0),
        h: ringHeightFor(S0),
      },
    })
  );
  check(
    "the windoid is the scrolling document window turned windoid: a horizontal rail, a grow box, no status strip (the kit's corner cell rides on that)",
    rb.scrollbars === 'horizontal' && rb.resizable === true && rb.status === false,
    JSON.stringify({
      scrollbars: rb.scrollbars,
      resizable: rb.resizable,
      status: rb.status,
    })
  );
  // The axis lock is DECLARED, the kit's size rect (the Patterns strip's
  // idiom): min-height = max-height at the derived height, min-width at
  // the strip, the width otherwise unbounded.
  const rectDeclared = (r, h) =>
    r.minW === RING_MIN_WIDTH && r.maxW == null && r.minH === h && r.maxH === h;
  check(
    "the grow box's size rect is declared: min-width at the strip, min-height = max-height at the derived height (the axis lock), max-width unbounded",
    rectDeclared(rb, ringHeightFor(S0)),
    JSON.stringify({ minW: rb.minW, maxW: rb.maxW, minH: rb.minH, maxH: rb.maxH })
  );
  // The windoid is a DITL (the numbers shell/layout.js's): the controls
  // strip is the window's HEADER — slotted there, at the header height the
  // shell states (RING_STRIP: the controls' box over the rule), the live
  // header spanning the window inside its borders; the body's PAPER is in
  // flow — a kit pattern box FILLING the body's width (no declared width;
  // the kit measures the filled axis for its raster), the tile tall,
  // wearing a kit pattern the ring slice's paper setting names (a
  // RING_PAPERS value — white by default; nothing in the UI writes the
  // setting today, the ?ring hook seeds it below) — as wide as the plane,
  // so it covers the scroll range: the row's width or the viewport's,
  // whichever is wider (the kit sizes its plane to the grid inside the
  // paper) — under a viewport exactly the tile tall (nothing overflows
  // down); the grid inside it draws no rules; a cell is the tile's
  // declared box naming no pattern of its own (the paper is the body's,
  // not the cells').
  const ditlDeclared = (r, n, size) => {
    const d = r.ditl;
    return (
      d.controls === 'header' &&
      d.headerH === RING_STRIP &&
      !!d.header &&
      d.header.h === RING_STRIP &&
      d.header.w === r.w - 2 &&
      !!d.paper &&
      d.paper.top === null &&
      d.paper.left === null &&
      d.paper.fill === true &&
      d.paper.w === null &&
      d.paper.h === size &&
      d.paper.live === Math.max(r.clientW, ringRowWidth(n, size)) &&
      Object.values(RING_PAPERS).includes(d.paper.pattern) &&
      d.grid.top === null &&
      d.grid.left === null &&
      d.grid.rules === 'none' &&
      r.scrollW === Math.max(r.clientW, ringRowWidth(n, size)) &&
      r.clientH === size &&
      r.scrollH === r.clientH &&
      !!d.cell &&
      d.cell.w === size &&
      d.cell.h === size &&
      d.cell.pattern === null
    );
  };
  check(
    "the windoid is a DITL: the controls strip is the window's header at RING_STRIP, the body's paper in flow — a kit pattern filling the body's width, the tile tall — covers the scroll range under a viewport exactly the tile tall, the grid draws no rules, a cell is the tile's bare box",
    ditlDeclared(rb, 4, S0),
    JSON.stringify({ ditl: rb.ditl, clientW: rb.clientW, clientH: rb.clientH })
  );
  // The paper setting's default, read as the pattern the body declares
  // (no control writes the setting — the strip holds four fields and
  // nothing else; the ?ring hook below is the one writer).
  check(
    "the body's paper boots white — the slice's default — and the strip holds no control for it",
    rb.ditl.paper.pattern === RING_PAPERS[RING_DEFAULTS.paper] &&
      rb.ditl.paper.pattern === 'white' &&
      (await evaluate(
        `(() => {${DEEP} const c = __q('sm-ring-controls').shadowRoot;
          return c.querySelectorAll('vf-radio, vf-radio-group, vf-select, vf-checkbox').length; })()`
      )) === 0,
    JSON.stringify({ pattern: rb.ditl.paper.pattern })
  );
  // The declared columns against the LIVE glyphs (the kit's rule: a caption
  // wider than its column overflows rather than reflowing — the number is
  // the column): every caption's text inside its column, every item inside
  // the controls' box at the header's corner (RING_FIELDS.box — the width
  // floor's own number), the fields at the kit's 74 × 25, the captions on
  // whole px.
  const ditlFit = await evaluate(
    `(() => {${DEEP} const c = __q('sm-ring-controls').shadowRoot;
      const f = __q('#win-ring').shadowRoot.querySelector('[part="header"]').getBoundingClientRect();
      const box = ${JSON.stringify(RING_FIELDS.box)};
      const inside = (r) => r.left >= f.left - 0.5 && r.right <= f.left + box.width + 0.5 &&
        r.top >= f.top - 0.5 && r.bottom <= f.top + box.height + 0.5;
      const labels = [...c.querySelectorAll('vf-label')].map((l) => {
        const h = l.getBoundingClientRect();
        const t = l.shadowRoot.querySelector('[part="label"]').getBoundingClientRect();
        return { col: Math.round(h.width), glyphs: +t.width.toFixed(2),
          fits: t.left >= h.left - 0.5 && t.right <= h.right + 0.5 && inside(h),
          whole: Number.isInteger(h.top - f.top) && Number.isInteger(h.left - f.left) }; });
      const fields = [...c.querySelectorAll('vf-number-field')].map((n) => {
        const r = n.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), fits: inside(r) }; });
      return { labels, fields }; })()`
  );
  check(
    "…and the DITL fits the live glyphs: every caption inside its column and the controls' box on whole px, every field inside the box at the kit's field size",
    ditlFit.labels.length === 4 &&
      ditlFit.labels.every((l) => l.fits && l.whole) &&
      ditlFit.fields.length === 4 &&
      ditlFit.fields.every(
        (f) => f.fits && f.w === RING_FIELD.width && f.h === RING_FIELD.height
      ),
    JSON.stringify(ditlFit)
  );
  await sleep(400);
  let cells = await cellPixels();
  check(
    'every cell holds a rendered frame of the model at the tile size — the backing AND the box, 1:1 — each facing its own',
    F0 === S0 &&
      cells.length === 4 &&
      cells.every((c) => c.w === F0 && c.h === F0 && c.opaque > 0) &&
      new Set(cells.map((c) => c.hash)).size === 4 &&
      rb.cell === S0,
    JSON.stringify({ S0, F0, cell: rb.cell, cells })
  );
  check(
    'four default cells fit the seeded width: the row does not overflow (the rail idles)',
    rb.scrollW != null && rb.scrollW <= rb.clientW,
    JSON.stringify({ scrollW: rb.scrollW, clientW: rb.clientW })
  );
  // The strip's views stepper ▲ (the properties section's recipe — autorepeat
  // can land more than one step, so assert direction): cells are added, the
  // windoid's box HOLDS (its width is the user's now), and the row outgrows
  // the viewport — the kit's rail goes live on the overflow.
  const ringStepper = await evaluate(
    `(() => {${DEEP} const st = __q('.ring-views')
        .shadowRoot.querySelector('[part="stepper"]').getBoundingClientRect();
      return { x: st.left + st.width / 2, y: st.top + st.height * 0.25 }; })()`
  );
  const ringLeft0 = rb.left;
  const ringW0 = rb.w;
  await click(ringStepper.x, ringStepper.y);
  await sleep(600);
  rb = await ringBox();
  check(
    "the strip's views stepper adds cells while the windoid's box holds — the row overflows into the rail instead",
    rb.cells > 4 &&
      rb.cells === rb.views &&
      rb.w === ringW0 &&
      rb.left === ringLeft0 &&
      rb.h === ringHeightFor(S0) &&
      rb.scrollW > rb.clientW,
    JSON.stringify({ rb, ringLeft0, ringW0 })
  );
  check(
    "…the row's own width is the scroll range (the in-flow grid sizes the kit's plane), the header untouched",
    ditlDeclared(rb, rb.cells, S0),
    JSON.stringify({ ditl: rb.ditl, scrollW: rb.scrollW, clientW: rb.clientW })
  );
  cells = await cellPixels();
  check(
    '…and every new cell renders',
    cells.length === rb.cells && cells.every((c) => c.w === F0 && c.opaque > 0),
    JSON.stringify(cells)
  );
  // Drag the windoid up by its dot bar first (the kit's gesture — no check
  // of its own): a size change holds the windoid's TOP-LEFT and moves its
  // bottom edge alone, so the placed windoid, docked on the bottom margin,
  // would carry its rail and grow box below the raster at 128 — up here the
  // grow box stays reachable for the drags below, and the held top reads
  // as the user's position, not the placement's.
  const ringTopPlaced = rb.top;
  const ringBar = await evaluate(
    `(() => {${DEEP} const r = __q('#win-ring').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 6 }; })()`
  );
  await mouse('mousePressed', ringBar.x, ringBar.y);
  await mouse('mouseMoved', ringBar.x, ringBar.y - 60, { buttons: 1 });
  await mouse('mouseMoved', ringBar.x, ringBar.y - 120, { buttons: 1 });
  await mouse('mouseReleased', ringBar.x, ringBar.y - 120, { buttons: 0 });
  await sleep(300);
  rb = await ringBox();
  const ringTop0 = rb.top;
  // The size field: the tile's edge. Typed to 128, the windoid's HEIGHT
  // follows (the chrome over one row of 128-px cells) with its top-left
  // held — the bottom edge is what moves — its width holds, and every cell
  // — backing and box — is 128.
  await evaluate(
    `(() => {${DEEP} __q('.ring-size').shadowRoot.querySelector('input').focus(); })()`
  );
  await keyPress('Backspace');
  await keyPress('Backspace');
  await typeText('128');
  await keyPress('Enter');
  await sleep(600);
  rb = await ringBox();
  cells = await cellPixels();
  check(
    "a tile size typed in the strip re-derives the windoid's height with its top-left held (the bottom edge moves, the width holds) and re-sizes every cell 1:1",
    rb.size === 128 &&
      rb.h === ringHeightFor(128) &&
      rb.top === ringTop0 &&
      rb.left === ringLeft0 &&
      rb.w === ringW0 &&
      rb.cell === 128 &&
      cells.length === rb.cells &&
      cells.every((c) => c.w === 128 && c.h === 128 && c.opaque > 0),
    JSON.stringify({ rb, cells, ringTop0, ringTopPlaced })
  );
  check(
    '…and the declared rect follows the new height (the lock moves with the tile)',
    rectDeclared(rb, ringHeightFor(128)),
    JSON.stringify({ minW: rb.minW, maxW: rb.maxW, minH: rb.minH, maxH: rb.maxH })
  );
  check(
    "…as do the cells' declared boxes and the viewport's height under the header",
    ditlDeclared(rb, rb.cells, 128),
    JSON.stringify({ ditl: rb.ditl, clientH: rb.clientH })
  );
  // The grow box moves the WIDTH alone — the kit clamps the drag into the
  // declared rect: a +30/+20 drag lands +30/0, the viewport widening with
  // it; a drag far past the strip stops at the declared min-width
  // (RING_MIN_WIDTH), not the kit's general 80.
  const ringGrow = () =>
    evaluate(
      `(() => {${DEEP} const g = __q('#win-ring').shadowRoot
          .querySelector('[part="grow-box"]').getBoundingClientRect();
        return { x: g.left + g.width / 2, y: g.top + g.height / 2 }; })()`
    );
  let gp = await ringGrow();
  await mouse('mousePressed', gp.x, gp.y);
  await mouse('mouseMoved', gp.x + 15, gp.y + 10, { buttons: 1 });
  await mouse('mouseMoved', gp.x + 30, gp.y + 20, { buttons: 1 });
  await mouse('mouseReleased', gp.x + 30, gp.y + 20, { buttons: 0 });
  await sleep(400);
  const ringGrown = await ringBox();
  check(
    'the grow box resizes the windoid on the horizontal axis alone: a +30/+20 drag lands +30/0, the viewport widening with it',
    ringGrown.w === ringW0 + 30 &&
      ringGrown.h === ringHeightFor(128) &&
      ringGrown.left === ringLeft0 &&
      ringGrown.top === rb.top &&
      ringGrown.clientW === rb.clientW + 30,
    JSON.stringify({ before: rb, after: ringGrown })
  );
  gp = await ringGrow();
  await mouse('mousePressed', gp.x, gp.y);
  await mouse('mouseMoved', gp.x - 200, gp.y, { buttons: 1 });
  await mouse('mouseMoved', gp.x - 400, gp.y, { buttons: 1 });
  await mouse('mouseReleased', gp.x - 400, gp.y, { buttons: 0 });
  await sleep(400);
  rb = await ringBox();
  check(
    'a shrink past the strip stops at the declared min-width (RING_MIN_WIDTH), the height still derived',
    rb.w === RING_MIN_WIDTH && rb.h === ringHeightFor(128) && rb.left === ringLeft0,
    JSON.stringify({ rb, floor: RING_MIN_WIDTH })
  );
  // File → Export Sprite Atlas…: the dialog reads the strip's settings, and
  // edits them LIVE (the readouts are parsed by their numbers' positions).
  const ringDialog = () =>
    evaluate(
      `(() => {${DEEP} const nums = (el) => (el.textContent.match(/[0-9]+/g) || []).map(Number);
        return {
          open: __q('#dlg-export-atlas').open,
          views: __q('#atlas-views').value, elevation: __q('#atlas-elevation').value,
          offset: __q('#atlas-offset').value, size: __q('#atlas-size').value,
          step: nums(__q('#atlas-step')), dims: nums(__q('#atlas-dims')),
          exportEnabled: !__q('#btn-export-atlas-ok').disabled }; })()`
    );
  await pickMenu('#menu-file', 'export-atlas');
  let dlg = await ringDialog();
  check(
    'File → Export Sprite Atlas… opens seeded from the strip, Export enabled (a model exists)',
    dlg.open === true &&
      dlg.views === String(rb.cells) &&
      dlg.elevation === '45' &&
      dlg.offset === '0' &&
      dlg.size === '128' &&
      dlg.exportEnabled === true,
    JSON.stringify(dlg)
  );
  check(
    '…its readouts derive the step and the sheet from the same numbers',
    dlg.step[0] === 360 / rb.cells &&
      JSON.stringify(dlg.dims) === JSON.stringify([ringSheet(rb.cells, 128).width, 128]),
    JSON.stringify({ step: dlg.step, dims: dlg.dims, cells: rb.cells })
  );
  await evaluate(
    `(() => {${DEEP} __q('#atlas-views').shadowRoot.querySelector('input').focus(); })()`
  );
  await keyPress('Backspace');
  await keyPress('Backspace');
  await typeText('8');
  await keyPress('Enter');
  await sleep(600);
  rb = await ringBox();
  dlg = await ringDialog();
  check(
    "a view count typed in the dialog moves the strip behind the modal at once (live, not pending) — the windoid's width holding",
    rb.cells === 8 &&
      rb.w === RING_MIN_WIDTH &&
      dlg.views === '8' &&
      dlg.step[0] === 45 &&
      dlg.dims[0] === ringSheet(8, 128).width,
    JSON.stringify({ rb, dlg })
  );
  const atlasCancel = await centreOf('#btn-export-atlas-cancel');
  await click(atlasCancel.x, atlasCancel.y);
  await sleep(300);
  rb = await ringBox();
  dlg = await ringDialog();
  check(
    'Cancel closes the dialog and keeps the setting (nothing pending to revert)',
    dlg.open === false && rb.cells === 8 && rb.views === 8,
    JSON.stringify({ open: dlg.open, cells: rb.cells, views: rb.views })
  );
  // Export = the strip's sheet: the download lands in the run's temp dir
  // (Browser.setDownloadBehavior names it by guid), and the file's IHDR and
  // text chunks are read back — the sheet's size, the ring's metadata.
  await send('Browser.setDownloadBehavior', {
    behavior: 'allowAndName',
    downloadPath: userDir,
    eventsEnabled: true,
  });
  downloads.clear();
  await pickMenu('#menu-file', 'export-atlas');
  const atlasExport = await centreOf('#btn-export-atlas-ok');
  await click(atlasExport.x, atlasExport.y);
  let exported = null;
  for (let i = 0; i < 50 && !exported; i++) {
    await sleep(100);
    exported = [...downloads.values()].find((d) => d.state === 'completed') || null;
  }
  dlg = await ringDialog();
  check('Export closes the dialog', dlg.open === false);
  check(
    'the export download completes (Browser.setDownloadBehavior)',
    !!exported,
    JSON.stringify([...downloads.values()])
  );
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
    check(
      'the exported file is the sheet: views·size × size px, named «slug»-atlas.png',
      ihdr.w === ringSheet(8, 128).width &&
        ihdr.h === 128 &&
        /-atlas\.png$/.test(exported.name),
      JSON.stringify({ ihdr, want: ringSheet(8, 128), name: exported.name })
    );
    check(
      '…carrying the sprite-machine:ring chunk (settings, frame, the derived scale, anchor, yaws) beside Title and Software',
      !!ringMeta &&
        ringMeta.views === 8 &&
        ringMeta.elevation === 45 &&
        ringMeta.size === 128 &&
        ringMeta.frame === 128 &&
        typeof ringMeta.scale === 'number' &&
        ringMeta.scale > 0 &&
        ringMeta.yaws.length === 8 &&
        ringMeta.yaws[1] === 45 &&
        typeof ringMeta.anchor.y === 'number' &&
        typeof meta.Title === 'string' &&
        typeof meta.Software === 'string',
      JSON.stringify({ ringMeta, Title: meta.Title, Software: meta.Software })
    );
    if (KEEP_DOWNLOADS) {
      mkdirSync(KEEP_DOWNLOADS, { recursive: true });
      copyFileSync(file, join(KEEP_DOWNLOADS, exported.name));
    }
  }
  // The close box — the kit's, kept on this one windoid — is the View
  // item's uncheck; the item brings it back where it was, cells intact.
  const ringClose = await evaluate(
    `(() => {${DEEP} const r = __q('#win-ring').shadowRoot
        .querySelector('[part="close-box"]').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
  );
  const ringPos = { left: rb.left, top: rb.top };
  await click(ringClose.x, ringClose.y);
  await sleep(300);
  s = await probe();
  check(
    "the windoid's close box hides it and unchecks the View item",
    s.ringShown === false && s.menuChecks.ring === false,
    JSON.stringify({ shown: s.ringShown, checked: s.menuChecks.ring })
  );
  await pickMenu('#menu-view', 'ring');
  s = await probe();
  rb = await ringBox();
  check(
    "View → 3D Sprite Atlas brings it back where it was, eight cells, at the user's width",
    s.ringShown === true &&
      rb.cells === 8 &&
      rb.left === ringPos.left &&
      rb.top === ringPos.top &&
      rb.w === RING_MIN_WIDTH,
    JSON.stringify({ rb, ringPos })
  );
  // It hides with the application like every windoid (the item stays
  // checked — greyed, document-scoped) and returns with it.
  const ringBare = await bareSpot();
  check(
    'found a bare patch of desktop beside the strip',
    !!ringBare,
    JSON.stringify(ringBare)
  );
  await click(ringBare.x, ringBare.y);
  await sleep(300);
  s = await probe();
  check(
    'a desktop click hides the atlas windoid with the application (its item checked, greyed)',
    s.ringShown === false && s.menuChecks.ring === true && s.menuEnabled.ring === false,
    JSON.stringify({
      shown: s.ringShown,
      checked: s.menuChecks.ring,
      live: s.menuEnabled.ring,
    })
  );
  const ringDocBar = await evaluate(
    `(() => {${DEEP} const r = __doc().getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 9 }; })()`
  );
  await click(ringDocBar.x, ringDocBar.y);
  await sleep(300);
  s = await probe();
  check('…and clicking the document brings it back', s.ringShown === true);
  // Arrange makes room: the doc box gives up the strip's band while it is
  // shown — its bottom plus the cascade room lands a gap above the strip.
  await pickMenu('#menu-view', 'arrange');
  rb = await ringBox();
  const room = (CASCADE_SLOTS - 1) * CASCADE_STEP;
  // Arrange re-seeds the width too: the placement's — the natural row (eight
  // 128s), capped at this raster's vacant middle (the oracle, from the live
  // tools box).
  const seeded = initialPlacement(
    rb.dw,
    rb.dh,
    { width: rb.toolsW, height: rb.toolsH },
    { ringViews: 8, ringSize: 128, ringShown: true }
  ).ring.width;
  check(
    "View → Arrange Windows shortens the document to clear the strip (bottom + the cascade room = the strip's top − 8) and re-seeds the strip's width",
    rb.docTop + rb.docH + room === rb.top - 8 &&
      rb.left === rb.docLeft &&
      rb.top === rb.dh - 8 - ringHeightFor(128) &&
      rb.w === seeded &&
      seeded < ringWidthFor(8, 128),
    JSON.stringify({ rb, room, seeded, natural: ringWidthFor(8, 128) })
  );
  // A browser resize keeps it docked: the y axis a fixed size (the bottom
  // edge a far strut, the top following), the x axis resizable — the left
  // edge a near strut, the right springing with the middle, inside the
  // vacancy and never under the floor — and the pin cache round-trips it
  // home exactly, width included.
  const ringMetrics = (width, height) =>
    send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  const docked = (r) =>
    r.left === r.docLeft && r.top + r.h === r.dh - 8 && r.h === ringHeightFor(128);
  const ringW1 = rb.w;
  await ringMetrics(780, 640);
  await sleep(400);
  let rr = await ringBox();
  check(
    "a browser shrink keeps the strip docked — the document's left, the bottom margin, its derived height — while its width follows the middle (inside the vacancy, never under the floor)",
    docked(rr) &&
      rr.w >= RING_MIN_WIDTH &&
      rr.w < ringW1 &&
      rr.left + rr.w <= rr.dw - 14 - 214 - 14,
    JSON.stringify({ rr, ringW1 })
  );
  await ringMetrics(1000, 850);
  await sleep(400);
  rr = await ringBox();
  check(
    '…and a grow back brings it exactly home, width included (the pin cache round-trips)',
    docked(rr) && rr.w === ringW1,
    JSON.stringify({ rr, ringW1 })
  );
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(300);
  // The capture hook: ?ring=<views>,<elevation>,<offset>,<size>,<paper>
  // boots the windoid shown with those settings — the paper's one writer
  // today (the slice's gray is the kit's dots dither).
  await send('Page.navigate', { url: `${URL}&ring=6,30,45,100,gray` });
  await waitForApp();
  await sleep(400);
  s = await probe();
  rb = await ringBox();
  cells = await cellPixels();
  check(
    '?ring=6,30,45,100,gray boots the windoid shown: six views at 30°, from 45°, a 100 px tile on the gray (dots) paper — the height and the cells its own',
    s.ringShown === true &&
      s.menuChecks.ring === true &&
      rb.cells === 6 &&
      rb.elev === 30 &&
      rb.offset === 45 &&
      rb.size === 100 &&
      rb.ditl.paper.pattern === RING_PAPERS.gray &&
      rb.ditl.paper.pattern === 'dots' &&
      rb.h === ringHeightFor(100) &&
      rb.w === ringWidthFor(6, 100) &&
      rb.cell === 100 &&
      cells.length === 6 &&
      cells.every((c) => c.w === 100 && c.h === 100 && c.opaque > 0) &&
      ditlDeclared(rb, 6, 100),
    JSON.stringify({ shown: s.ringShown, rb, cells })
  );
  // A window WIDER than its row: the header is window chrome and spans
  // the window at any width, white to the right of the last tile below
  // it, the rail idle.
  gp = await ringGrow();
  await mouse('mousePressed', gp.x, gp.y);
  await mouse('mouseMoved', gp.x + 20, gp.y, { buttons: 1 });
  await mouse('mouseMoved', gp.x + 40, gp.y, { buttons: 1 });
  await mouse('mouseReleased', gp.x + 40, gp.y, { buttons: 0 });
  await sleep(400);
  rb = await ringBox();
  check(
    'grown wider than its row, the header spans the window and the rail idles',
    rb.w === ringWidthFor(6, 100) + 40 &&
      rb.clientW > ringRowWidth(6, 100) &&
      rb.ditl.header.w === rb.w - 2 &&
      rb.scrollW === rb.clientW &&
      ditlDeclared(rb, 6, 100),
    JSON.stringify({ rb })
  );

  section('desktop patterns');
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
        dw: d.width,
        dh: d.height,
        desktop: d.pattern,
        open: !!w,
        active: !!w && w.hasAttribute('active'),
        heading: w ? w.heading : null,
        // The template's statements (what the kit draws for them is its own):
        // closable (the kit's default, left on), neither resizable nor zoomable.
        closable: w ? w.closable : null,
        resizable: !!w && w.hasAttribute('resizable'),
        zoomable: !!w && w.hasAttribute('zoomable'),
        // The inset is the CONTENT's — a vf-stack pad wrapping the body
        // (vintage-frames 0.6.0: a window body carries none of its own).
        pad: w && body && body.parentElement.localName === 'vf-stack'
          ? body.parentElement.getAttribute('pad') : null,
        well: well ? well.getAttribute('pattern') : null,
        cells: cells.length,
        ringed: cells.filter((c) => c.querySelector('.ring.on')).map((c) => c.title),
        box: w ? { left: w.left, top: w.top, width: w.width, height: w.height } : null,
      };
    })()`);
  let pp = await patternsProbe();
  check(
    'the desktop boots on the dither with no panel open',
    pp.desktop === 'gray-50' && !pp.open,
    JSON.stringify(pp)
  );
  await pickMenu('#menu-app', 'desktop-patterns');
  pp = await patternsProbe();
  s = await probe();
  check(
    'Sprite Machine → Desktop Patterns opens the panel: a titled, closable, fixed-size document-tier window',
    pp.open &&
      pp.active &&
      pp.heading === 'Desktop Patterns' &&
      pp.closable === true &&
      !pp.resizable &&
      !pp.zoomable,
    JSON.stringify(pp)
  );
  check(
    "…its 12px inset is the content's own: the body wrapped in a vf-stack pad (a 0.6.0 window body carries none)",
    pp.pad === '12',
    JSON.stringify({ pad: pp.pad })
  );
  check(
    "…it is the Finder's window: the application deactivates (windoids + strip hide, doc-scoped menus grey)",
    s.docActive === false &&
      !s.windows.tools &&
      !s.windows.sprite &&
      !s.windows.stage &&
      s.optionsStrip === false &&
      s.menuEnabled.save === false &&
      s.menuEnabled.newDoc === true,
    JSON.stringify({
      docActive: s.docActive,
      windows: s.windows,
      strip: s.optionsStrip,
      menus: s.menuEnabled,
    })
  );
  const panelWant = centeredBox(pp.dw, pp.dh, {
    width: pp.box.width,
    height: pp.box.height,
  });
  check(
    '…centered in the open area below the strip (layout.js centeredBox, the oracle)',
    pp.box.left === panelWant.left && pp.box.top === panelWant.top,
    JSON.stringify({ got: pp.box, want: panelWant })
  );
  check(
    '…the well previews the current pattern, every kit pattern has a cell, the current one ringed',
    pp.well === 'gray-50' &&
      pp.cells === 38 &&
      JSON.stringify(pp.ringed) === '["gray-50"]',
    JSON.stringify({ well: pp.well, cells: pp.cells, ringed: pp.ringed })
  );
  // A cell picks on the click. The desktop is untouched until Set.
  const cellCentre = (name) =>
    evaluate(`(() => {${DEEP}
      const r = __q('.cell[title="${name}"]').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
  const bricks = await cellCentre('bricks');
  await click(bricks.x, bricks.y);
  await sleep(100);
  pp = await patternsProbe();
  check(
    'clicking a cell previews it in the well and rings it — the desktop untouched',
    pp.well === 'bricks' &&
      JSON.stringify(pp.ringed) === '["bricks"]' &&
      pp.desktop === 'gray-50',
    JSON.stringify({ well: pp.well, ringed: pp.ringed, desktop: pp.desktop })
  );
  const setBtn = await centreOf('.set');
  await click(setBtn.x, setBtn.y);
  await sleep(400);
  pp = await patternsProbe();
  check(
    'Set Desktop Pattern writes the pending pattern onto the desktop (the panel stays up)',
    pp.desktop === 'bricks' && pp.open,
    JSON.stringify({ desktop: pp.desktop, open: pp.open })
  );
  const panelCloseBox = () =>
    evaluate(`(() => {${DEEP}
      const w = document.querySelector('#win-patterns');
      const r = w.shadowRoot.querySelector('[part="close-box"]').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
  let cb = await panelCloseBox();
  await click(cb.x, cb.y);
  await sleep(400);
  pp = await patternsProbe();
  s = await probe();
  check(
    'the close box removes the panel and the application comes back (document active, windoids up)',
    !pp.open && s.docActive && s.windows.tools && s.windows.sprite && s.windows.stage,
    JSON.stringify({ open: pp.open, docActive: s.docActive, windows: s.windows })
  );
  check('…the set pattern stays on the desktop', pp.desktop === 'bricks', pp.desktop);
  await freshPage();
  pp = await patternsProbe();
  check(
    'a reload restores the set pattern (desktop-state.js)',
    pp.desktop === 'bricks' && !pp.open,
    JSON.stringify({ desktop: pp.desktop, open: pp.open })
  );
  // Reopen: the pending selection seeds from the CURRENT pattern. A pick
  // left unset is discarded by the close box; a second open seeds afresh.
  await pickMenu('#menu-app', 'desktop-patterns');
  pp = await patternsProbe();
  check(
    'reopening seeds the well and the ring from the current desktop pattern',
    pp.well === 'bricks' && JSON.stringify(pp.ringed) === '["bricks"]',
    JSON.stringify({ well: pp.well, ringed: pp.ringed })
  );
  const waves = await cellCentre('waves');
  await click(waves.x, waves.y);
  await sleep(100);
  cb = await panelCloseBox();
  await click(cb.x, cb.y);
  await sleep(400);
  pp = await patternsProbe();
  check(
    'a pick without Set is discarded by the close box',
    !pp.open && pp.desktop === 'bricks',
    JSON.stringify({ open: pp.open, desktop: pp.desktop })
  );
  await pickMenu('#menu-app', 'desktop-patterns');
  pp = await patternsProbe();
  check(
    '…and the next open seeds from the desktop again, not the discarded pick',
    pp.well === 'bricks' && JSON.stringify(pp.ringed) === '["bricks"]',
    JSON.stringify({ well: pp.well, ringed: pp.ringed })
  );
  // A second pick while it's open brings the same window forward — never a
  // second panel.
  await pickMenu('#menu-app', 'desktop-patterns');
  const panelCount = await evaluate(
    `document.querySelectorAll('#win-patterns, vf-window[heading="Desktop Patterns"]').length`
  );
  check(
    'a second menu pick brings the open panel forward — one panel, ever',
    panelCount === 1,
    String(panelCount)
  );
  // Back to the dither, through the panel — the round trip the later
  // sections rely on (their profile persists).
  const gray = await cellCentre('gray-50');
  await click(gray.x, gray.y);
  await sleep(100);
  const setAgain = await centreOf('.set');
  await click(setAgain.x, setAgain.y);
  await sleep(400);
  cb = await panelCloseBox();
  await click(cb.x, cb.y);
  await sleep(400);
  await freshPage();
  pp = await patternsProbe();
  check(
    'setting the dither back restores the default across a reload',
    pp.desktop === 'gray-50' && !pp.open,
    JSON.stringify({ desktop: pp.desktop, open: pp.open })
  );

  section('multiple documents');
  await freshPage(); // the Car sample, one window
  s = await probe();
  check(
    'one document window at boot',
    s.docWindows === 1 && s.heading === 'Car',
    `${s.docWindows} windows, "${s.heading}"`
  );
  // The View menu's open-windows section against the document windows on
  // screen: one item per window — its value the window's key, its label
  // the window's heading — in CREATION order (the key's own count, never
  // the stacking order a raise changes), the ACTIVE window's item checked
  // and no other's, every item live; a separator before the first, nothing
  // after the last, and with none open no dangling rule.
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
  check(
    'the View menu lists the one open window after a separator, checked (the active one)',
    windowListTrue(s.viewWindows) &&
      s.viewWindows.items.length === 1 &&
      s.viewWindows.items[0].checked === true,
    JSON.stringify(s.viewWindows)
  );
  await newBlankDoc();
  s = await probe();
  check(
    'File → New… (dialog OK) opens a SECOND window, active and untitled',
    s.docWindows === 2 && s.docActive && s.heading === 'untitled',
    `${s.docWindows} windows, "${s.heading}"`
  );
  check(
    '…and the View menu lists both in creation order, the newcomer last and checked',
    windowListTrue(s.viewWindows) &&
      s.viewWindows.items.length === 2 &&
      s.viewWindows.items[1].checked === true &&
      s.viewWindows.items[0].checked === false,
    JSON.stringify(s.viewWindows)
  );
  check('…the 3D view empties for the blank untitled', s.voxels === 0, s.buildStats);
  // Draw one texel in the untitled — ITS history, not Car's.
  const at2 = (px, py) => texelPos(s.rect, s.tileW, px, py);
  await keyPress('b');
  await click(at2(3, 3).x, at2(3, 3).y);
  await sleep(500);
  check('a stroke lands in the untitled document', (await texelAt(3, 3))[3] === 255);
  s = await probe();
  check(
    '…enables Undo for THIS document and rebuilds the stage from it',
    // The blank untitled read 0 voxels a moment ago; a single face on a
    // blank sheet builds a voxel (the status tooltip's stats), so a nonzero
    // count IS the proof this doc reached the stage — the status LINE stays
    // its fixed "3D Model View" label whatever the build says.
    s.menuChecks.undoEnabled === true && s.voxels > 0 && s.buildLine === '3D Model View',
    JSON.stringify({
      undo: s.menuChecks.undoEnabled,
      voxels: s.voxels,
      buildLine: s.buildLine,
    })
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
    '…and the View menu moves the check to Car — the items stay in creation order (a raise reorders nothing)',
    windowListTrue(s.viewWindows) &&
      s.viewWindows.items[0].checked === true &&
      s.viewWindows.items[1].checked === false,
    JSON.stringify(s.viewWindows)
  );
  check(
    '…and the 3D View rebuilds the car (the stage follows the active document)',
    s.voxels > 100,
    s.buildStats
  );
  // Two windows on the cascade, the upper-left one (Car, on the first
  // slot) just RAISED: which document sits on which slot is stacking
  // bookkeeping, so the screen still reads arranged and the ⌘J item is
  // Zoom Window — the reported case, where the item read Arrange and the
  // chord SWAPPED the two windows instead of zooming. ⌘J zooms Car from
  // its slot, the untitled untouched; ⌘J again restores it (the zoom
  // box's toggle), the untitled still untouched.
  const docBoxes = () =>
    evaluate(
      `(() => {${DEEP}
        const out = {}; const d = __q('#desktop');
        for (const w of document.querySelectorAll('vf-window')) {
          if (w.id.startsWith('win-doc-'))
            out[w.heading] = { left: w.left, top: w.top, w: w.width, h: w.height };
        }
        out.desk = { w: d.width, h: d.height };
        return out; })()`
    );
  const twoUp = await docBoxes();
  s = await probe();
  check(
    'two documents on the cascade, the upper-left one raised: the ⌘J item reads Zoom Window (a permutation of the slots is still the arrangement)',
    s.menuEnabled.arrange === true && s.menuEnabled.arrangeValue === 'zoom',
    JSON.stringify({ item: s.menuEnabled, twoUp })
  );
  await keyPress('j', META);
  await sleep(600);
  const carZoomed = await docBoxes();
  const carZoomWant = zoomedBox(twoUp.desk.w, twoUp.desk.h, twoUp.Car);
  s = await probe();
  check(
    '⌘J zooms the raised Car from its slot — no swap — and the untitled does not move; the item stays Zoom Window',
    carZoomed.Car.left === twoUp.Car.left &&
      carZoomed.Car.top === twoUp.Car.top &&
      carZoomed.Car.w === carZoomWant.width &&
      carZoomed.Car.h === carZoomWant.height &&
      JSON.stringify(carZoomed.untitled) === JSON.stringify(twoUp.untitled) &&
      s.menuEnabled.arrangeValue === 'zoom',
    JSON.stringify({ twoUp, carZoomed, carZoomWant, item: s.menuEnabled })
  );
  await keyPress('j', META);
  await sleep(600);
  const carBack = await docBoxes();
  check(
    '⌘J again restores Car to its slot, the untitled still untouched — the toggle moves one window',
    JSON.stringify(carBack.Car) === JSON.stringify(twoUp.Car) &&
      JSON.stringify(carBack.untitled) === JSON.stringify(twoUp.untitled),
    JSON.stringify({ twoUp, carBack })
  );
  // View → Arrange Windows cascades in STACKING order: Car, just raised to
  // the front, takes the second slot and the untitled drops to the first —
  // the two swap places (both at the doc box size). The item offers
  // Arrange only once something is off its placement (the state rule), so
  // Car is nudged off its slot by its bar first — the slots are read
  // before the nudge.
  const docSlots = () =>
    evaluate(
      `(() => {${DEEP}
        const out = {};
        for (const w of document.querySelectorAll('vf-window')) {
          if (w.id.startsWith('win-doc-')) out[w.heading] = { left: w.left, top: w.top };
        }
        return out; })()`
    );
  const slotsBefore = await docSlots();
  await mouse('mousePressed', carBar.x, carBar.y);
  await mouse('mouseMoved', carBar.x + 10, carBar.y + 6, { buttons: 1 });
  await mouse('mouseMoved', carBar.x + 20, carBar.y + 12, { buttons: 1 });
  await mouse('mouseReleased', carBar.x + 20, carBar.y + 12, { buttons: 0 });
  await sleep(300);
  await pickMenu('#menu-view', 'arrange');
  const slotsAfter = await docSlots();
  check(
    'Arrange Windows cascades in stacking order: the raised Car tops the cascade',
    slotsAfter.Car.left === slotsBefore.untitled.left &&
      slotsAfter.Car.top === slotsBefore.untitled.top &&
      slotsAfter.untitled.left === slotsBefore.Car.left &&
      slotsAfter.untitled.top === slotsBefore.Car.top,
    JSON.stringify({ slotsBefore, slotsAfter })
  );
  s = await probe();
  check(
    '…and changes no focus: Car stays the active document',
    s.heading === 'Car' && s.docActive === true,
    JSON.stringify({ heading: s.heading, active: s.docActive })
  );
  check(
    '…nor the View menu list: still creation order under the re-stack (Car first, checked)',
    windowListTrue(s.viewWindows) &&
      s.viewWindows.items[0].label === 'Car' &&
      s.viewWindows.items[0].checked === true,
    JSON.stringify(s.viewWindows)
  );
  // A pick from the View menu's section brings that window forward: the
  // untitled (under the raised Car) activates — the title, the focus and
  // the check follow — and a pick of Car brings it back.
  const untitledItem = windowItemOf(s.viewWindows, 'untitled');
  const carItem = windowItemOf(s.viewWindows, 'Car');
  await pickMenu('#menu-view', untitledItem);
  s = await probe();
  check(
    'picking a window from the View menu activates it: the untitled comes forward, its item checked',
    s.heading === 'untitled' &&
      s.docActive === true &&
      windowListTrue(s.viewWindows) &&
      windowItemOf(s.viewWindows, 'untitled') === untitledItem &&
      s.viewWindows.items.find((i) => i.value === untitledItem)?.checked === true,
    JSON.stringify({ heading: s.heading, list: s.viewWindows })
  );
  await pickMenu('#menu-view', carItem);
  s = await probe();
  check(
    '…and picking Car brings it back, the check with it',
    s.heading === 'Car' &&
      s.docActive === true &&
      windowListTrue(s.viewWindows) &&
      s.viewWindows.items.find((i) => i.value === carItem)?.checked === true,
    JSON.stringify({ heading: s.heading, list: s.viewWindows })
  );
  // From the Finder role the section stays live with no item checked (no
  // document window is active), and a pick brings the application back
  // with that window — the windoids return, the item checks.
  const bare2 = await bareSpot();
  check(
    'found a bare patch of desktop to click (the window list from the Finder)',
    !!bare2
  );
  await click(bare2.x, bare2.y);
  await sleep(300);
  s = await probe();
  check(
    'in the Finder role the View menu still lists the windows, live, none checked',
    s.docActive === false &&
      windowListTrue(s.viewWindows) &&
      s.viewWindows.items.length === 2 &&
      s.viewWindows.items.every((i) => i.enabled && !i.checked),
    JSON.stringify({ docActive: s.docActive, list: s.viewWindows })
  );
  await pickMenu('#menu-view', carItem);
  s = await probe();
  check(
    'picking Car from the Finder role reactivates the application on it: windoids back, item checked',
    s.heading === 'Car' &&
      s.docActive === true &&
      s.windows.tools &&
      s.windows.sprite &&
      s.windows.stage &&
      windowListTrue(s.viewWindows) &&
      s.viewWindows.items.find((i) => i.value === carItem)?.checked === true,
    JSON.stringify({ heading: s.heading, windows: s.windows, list: s.viewWindows })
  );
  // Close the dirty untitled: activate it, File → Close, No (don't save). The
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
    'No (don’t save) closes the window; Car remains and takes the active state',
    s.docWindows === 1 && s.heading === 'Car' && s.docActive === true,
    JSON.stringify({ docWindows: s.docWindows, heading: s.heading })
  );
  check(
    '…and the View menu drops the closed window’s item: Car alone, checked',
    windowListTrue(s.viewWindows) &&
      s.viewWindows.items.length === 1 &&
      s.viewWindows.items[0].value === carItem &&
      s.viewWindows.items[0].checked === true,
    JSON.stringify(s.viewWindows)
  );
  // The quit cascade: a fresh dirty untitled, then Quit — Cancel aborts the
  // whole walk; a second Quit answered No closes everything (the clean
  // Car goes silently) and leaves the bare desktop focused.
  await newBlankDoc();
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
  check(
    '…and the View menu’s open-windows section is gone, separator included',
    windowListTrue(s.viewWindows) &&
      s.viewWindows.items.length === 0 &&
      s.viewWindows.trailingSeparator === false,
    JSON.stringify(s.viewWindows)
  );

  // --- desktop: the New Document dialog ---------------------------------------
  // File → New… raises the template dialog: Empty Document plus the built-ins
  // (the same SAMPLES that seeded the library), over a tile-size field that
  // is live for Empty Document only — a template's art has a NATIVE tile
  // size (a retile crops/pads rather than scales), so its row locks the
  // field at it. Create — or double-clicking a row — opens a fresh untitled
  // window.
  section('the New Document dialog');
  await freshPage();
  await pickMenu('#menu-file', 'new');
  const newForm = () =>
    evaluate(`(() => {${DEEP}
      return {
        open: !!__q('#dlg-new').open,
        rows: [...__q('#new-list').querySelectorAll('vf-list-item')].map((r) =>
          r.textContent.trim()),
        value: __q('#new-list').value,
        tile: String(__q('#new-tile').value),
        tileDisabled: !!__q('#new-tile').disabled,
        dims: __q('#new-dims').textContent.trim(),
      };
    })()`);
  let nf = await newForm();
  check('File → New… raises the New Document dialog', nf.open === true);
  check(
    'it lists Empty Document plus the built-in templates',
    nf.rows.join(',') === 'Empty Document,Car,Cube',
    JSON.stringify(nf.rows)
  );
  check(
    'Empty Document is preselected: 40px tiles, field live, dims 120 × 80',
    nf.value === 'blank' &&
      nf.tile === '40' &&
      !nf.tileDisabled &&
      nf.dims === 'atlas 120 × 80 px',
    JSON.stringify(nf)
  );
  // Rows are found by TEXT: vf-list-item's `value` is a property (only
  // `selected` reflects), so an attribute selector can't reach it.
  const newRowCentre = (text) =>
    evaluate(`(() => {${DEEP}
      const i = [...__q('#new-list').querySelectorAll('vf-list-item')]
        .find((r) => r.textContent.trim() === '${text}');
      const r = i.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
  const cubeRow = await newRowCentre('Cube');
  await click(cubeRow.x, cubeRow.y);
  await sleep(250);
  nf = await newForm();
  check(
    'a template row locks the tile field at its native size',
    nf.tileDisabled && nf.tile === '8' && nf.dims === 'atlas 24 × 16 px',
    JSON.stringify(nf)
  );
  const emptyRow = await newRowCentre('Empty Document');
  await click(emptyRow.x, emptyRow.y);
  await sleep(250);
  nf = await newForm();
  check('returning to Empty Document re-enables the field', !nf.tileDisabled);
  // Type a custom size, then Create: clicking the button blurs the field,
  // which commits the typed value (the native change) before the click lands.
  await evaluate(
    `(() => {${DEEP} const f = __q('#new-tile'); f.value = '';
      f.shadowRoot.querySelector('input').focus(); })()`
  );
  await typeText('12');
  const createBtn = await centreOf('#btn-new-ok');
  await click(createBtn.x, createBtn.y);
  await sleep(650);
  s = await probe();
  check(
    'Create opens a fresh untitled at the chosen tile size',
    s.heading === 'untitled' &&
      s.docWindows === 2 &&
      s.tileW === 12 &&
      s.anyModalOpen === false,
    JSON.stringify({ heading: s.heading, docWindows: s.docWindows, tileW: s.tileW })
  );
  await pickMenu('#menu-file', 'new');
  const carRow = await newRowCentre('Car');
  await dblclick(carRow.x, carRow.y);
  await sleep(900);
  s = await probe();
  check(
    'double-clicking the Car template opens a fresh untitled copy of it',
    s.heading === 'Car' && s.docWindows === 3 && s.voxels > 100,
    JSON.stringify({ heading: s.heading, docWindows: s.docWindows, voxels: s.voxels })
  );

  // --- desktop: save / open round-trip ---------------------------------------
  // The full persistence loop on real input: draw → ⌘S → name it → File → New
  // → double-click the saved doc's icon → the pixels come back. (IndexedDB is
  // fully available to headless Chrome; this run's profile carries exactly
  // the two docs the virgin-boot section seeded.)
  section('save / open round-trip');
  await freshPage();
  s = await probe();
  check(
    'the library still holds only the two seeded docs',
    s.docIcons === 2,
    `${s.docIcons}`
  );
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
  check(
    '…and its View menu item relabels with the window (the name follows the save)',
    windowListTrue(s.viewWindows) &&
      s.viewWindows.items.length === 1 &&
      s.viewWindows.items[0].label === s.heading &&
      s.viewWindows.items[0].checked === true,
    JSON.stringify(s.viewWindows)
  );
  check('a desktop icon appears for the saved doc', s.docIcons === 3, `${s.docIcons}`);
  um = await urlMirror();
  check(
    'the first save mirrors the new identity into the address bar',
    um.hash === '#Test%20Doc',
    JSON.stringify(um)
  );
  await newBlankDoc();
  s = await probe();
  check('File → New… opens a blank untitled', s.heading === 'untitled', s.heading);
  um = await urlMirror();
  check(
    'an untitled active document clears the fragment (nothing to restore)',
    um.hash === '',
    JSON.stringify(um)
  );
  const blankTexel = await texelAt(1, 1);
  check('…with an empty canvas', blankTexel[3] === 0, `${blankTexel}`);
  const iconPos = await evaluate(
    `(() => {${DEEP}
      const i = __qa('vf-icon').find((el) => el.label === 'Test Doc');
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
  check(
    '…and the double-click deselects the icon (focus is the window now)',
    (await selectedIcons()).length === 0,
    JSON.stringify(await selectedIcons())
  );
  const restored = await texelAt(1, 1);
  check('…with its pixels restored from storage', restored[3] === 255, `${restored}`);
  um = await urlMirror();
  check(
    '…and the address bar follows the re-opened doc',
    um.hash === '#Test%20Doc',
    JSON.stringify(um)
  );

  // --- desktop: browser resize — the nine-slice pin, one rule for every box
  // A viewport change re-fits the raster, and ONE rule moves every window
  // and icon, placed or dragged alike (shell/layout.js pinOf/pinTo — its
  // header is the design): the open area is cut by a ring of
  // outer bands around a middle that grows and shrinks, and each edge keeps
  // its place in its slice — a strut in a band (its offset from that raster
  // edge holds), a spring in the middle (its fraction holds). The window
  // frame's top and right bands are sized to the rail, so the placed
  // windoids are all struts and a resize lands them exactly where Arrange
  // would; a document window's right and bottom edges spring with the
  // vacancy. Nothing clamps, so growing back round-trips home exactly. The
  // desktop icons ride the same rule in THEIR frame (the desktop below the
  // 20px menu bar, uniform bands; the options strip is application chrome,
  // no part of the Finder's furniture). Emulation.setDeviceMetricsOverride
  // changes the layout viewport and fires a real `resize` — the same path a
  // user's window drag takes. The expectations below come from the pure
  // module itself: at DSF 1 the placement lattice is 1 system px, so the
  // shell's snap is the rounding pinTo already does, and the only thing
  // layered over it is the oversize intervention (a resizable window never
  // wider or taller than the open area).
  section('browser resize');
  const STAGE_MIN = { width: 164, height: 160 }; // windows.js STAGE_MIN_*
  const KIT_MIN = { width: 80, height: 54 }; // vf-window's own grow floor
  const raster = (snap) => ({ width: snap.dw, height: snap.dh });
  const expectWin = (w, from, to) => {
    const pin = pinOf(
      { left: w.left, top: w.top, width: w.w, height: w.h },
      from,
      WINDOW_FRAME
    );
    const g = pinTo(
      pin,
      to,
      WINDOW_FRAME,
      w.r
        ? { min: w.id === 'win-stage' ? STAGE_MIN : KIT_MIN }
        : { size: { width: w.w, height: w.h } }
    );
    if (w.r) {
      g.width = Math.min(g.width, to.width);
      g.height = Math.min(g.height, Math.max(0, to.height - 56));
    }
    return { id: w.id, left: g.left, top: g.top, w: g.width, h: g.height, r: w.r };
  };
  const expectIcon = (i, from, to) => {
    const cell = { width: ICON_CELL, height: ICON_CELL };
    const g = pinTo(
      pinOf({ left: i.left, top: i.top, ...cell }, from, ICON_FRAME),
      to,
      ICON_FRAME,
      {
        size: cell,
      }
    );
    return { id: i.id, left: g.left, top: g.top };
  };
  await freshPage();
  const layoutSnap = () =>
    evaluate(`(() => {
      const d = document.querySelector('#desktop');
      const wins = [...document.querySelectorAll('vf-window')]
        .filter((w) => !w.hidden)
        .map((w) => ({
          id: w.id,
          left: w.left,
          top: w.top,
          w: w.width,
          h: w.height,
          r: w.resizable,
        }));
      const icons = [...document.querySelectorAll('#desktop-icons vf-icon')].map(
        (i) => ({ id: i.dataset.key, left: i.left, top: i.top })
      );
      return { dw: d.width, dh: d.height, wins, icons };
    })()`);
  const metrics = (width, height) =>
    send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  // Establish the wide state through the SAME override the round trip ends
  // on: the native headless client height is smaller than --window-size (the
  // window chrome is taken out of it), so a bare boot snapshot would compare
  // a 743-tall raster against the override's true 850-tall one and read the
  // windows' correct relative re-pin as drift.
  await metrics(1000, 850);
  await sleep(400);
  // Arrange at the wide raster: the boot happened on the native viewport,
  // so the override above was itself a resize and the document window's
  // pin was read THERE. Arrange drops every record, so the shrink below
  // reads each pin on the wide raster — exactly where the oracle reads it.
  // (The ⌘J item is Arrange Windows only while something is off its
  // placement — here the document window, sprung by that resize; already
  // arranged, there would be nothing to pick and nothing to do.)
  async function arrangeIfNeeded() {
    const v = await evaluate(
      `document.querySelector('#item-arrange').getAttribute('value')`
    );
    if (v === 'arrange') await pickMenu('#menu-view', 'arrange');
  }
  await arrangeIfNeeded();
  const placedWide = await layoutSnap();
  await metrics(780, 640);
  await sleep(400);
  const placedNarrow = await layoutSnap();
  check(
    'the raster re-fits to the smaller viewport',
    placedNarrow.dw < placedWide.dw && placedNarrow.dh < placedWide.dh,
    JSON.stringify({
      before: [placedWide.dw, placedWide.dh],
      after: [placedNarrow.dw, placedNarrow.dh],
    })
  );
  // THE PLACEMENT IS A FIXED POINT of the rule for the windoids: all struts,
  // so the resize lands them exactly where Arrange Windows puts them on the
  // new raster, and the rail is right-flush and full-height there (a
  // proportional pin would have scaled the inset and left the stage short).
  await arrangeIfNeeded();
  const arrangedNarrow = await layoutSnap();
  const windoids = (snap) => snap.wins.filter((w) => !w.id.startsWith('win-doc-'));
  check(
    'a resize lands the windoids where Arrange would (the placement is a fixed point)',
    windoids(placedNarrow).length === 3 &&
      JSON.stringify(windoids(placedNarrow)) === JSON.stringify(windoids(arrangedNarrow)),
    JSON.stringify({
      resized: windoids(placedNarrow),
      arranged: windoids(arrangedNarrow),
    })
  );
  const railN = placedNarrow.wins.find((w) => w.id === 'win-sprite');
  const stageN = placedNarrow.wins.find((w) => w.id === 'win-stage');
  check(
    '…the rail is right-flush and full-height on the new raster',
    railN.left + railN.w === placedNarrow.dw - 14 &&
      stageN.w === railN.w &&
      stageN.top + stageN.h === placedNarrow.dh - 8,
    JSON.stringify({ dw: placedNarrow.dw, dh: placedNarrow.dh, railN, stageN })
  );
  // The document window is content, not furniture: its top-left (the
  // cascade slot, struts in the left and top bands) is a fixed point too,
  // while its right and bottom edges SPRING with the vacancy — it keeps
  // filling the middle proportionally rather than keeping Arrange's
  // absolute cascade room. The oracle says exactly what it gets.
  const docOf = (snap) => snap.wins.find((w) => w.id.startsWith('win-doc-'));
  const docWant = expectWin(docOf(placedWide), raster(placedWide), raster(placedNarrow));
  check(
    'the document window keeps its cascade slot and springs with the middle',
    docOf(placedNarrow).left === docOf(arrangedNarrow).left &&
      docOf(placedNarrow).top === docOf(arrangedNarrow).top &&
      JSON.stringify(docOf(placedNarrow)) === JSON.stringify(docWant),
    JSON.stringify({
      resized: docOf(placedNarrow),
      want: docWant,
      arranged: docOf(arrangedNarrow),
    })
  );
  // Drag every window a step off its placement (title bar / dot bars):
  // from here on `home` is this dragged arrangement at 780×640, every pin
  // re-read from where the drag left it, and the contracts below are the
  // rule's for boxes that sit anywhere at all.
  await dragBar(`__doc()`, 9);
  await dragBar(`__q('#win-tools')`, 6);
  // The stage BEFORE the sprite: dragged down-right first, the sprite
  // windoid would sit over the stage's dot bar and take its press.
  await dragBar(`__q('#win-stage')`, 6);
  await dragBar(`__q('#win-sprite')`, 6);
  const home = await layoutSnap();
  // The drags are the kit's gesture; that every window left its placement
  // is the precondition folded into the pin check below (a pin test over
  // the placement itself would only re-prove the fixed point above).
  const draggedOff = home.wins.every((w) => {
    const o = placedNarrow.wins.find((x) => x.id === w.id);
    return o && (w.left !== o.left || w.top !== o.top);
  });
  // VIEWPORT CHOICE for the shrink: under emulation the OUTER window never
  // changes, so the kit's zoom tracker can't rebase on it — a shrink whose
  // two axis ratios land on ONE zoom ladder level reads as page zoom and
  // re-scales the desktop for the rest of the run (780×640 → 520×430 is
  // 1.5×/1.49×, both quantizing to the 1.5 rung, and --vf-scale stuck at
  // 4/3). 520×360 is 1.5×/1.78× — two different rungs, so the tracker
  // rebases instead. (Its 284px open area is shorter than the window
  // frame's top + bottom bands — a degenerate span, where the middle
  // collapses to a seam; the oracle covers that case like any other.)
  await metrics(520, 360);
  await sleep(300);
  const tiny = await layoutSnap();
  // Every window lands exactly where the nine-slice pin read at `home`
  // puts it on the tiny raster — struts holding their offsets, springs
  // their fractions, fixed-size windoids through the anchor rule, the
  // resizable ones floored and capped at the open area. Deliberately NO
  // on-raster assertion beyond that: the re-pin doesn't clamp — a window
  // near an edge may hang partly off the shrunk raster so the round trip
  // below can be exact.
  const wantTiny = home.wins.map((w) => expectWin(w, raster(home), raster(tiny)));
  check(
    'every window (dragged off its placement) lands exactly on its nine-slice pin on the shrunk raster',
    draggedOff &&
      tiny.wins.length === home.wins.length &&
      JSON.stringify(tiny.wins) === JSON.stringify(wantTiny),
    JSON.stringify({
      draggedOff,
      placed: placedNarrow.wins,
      home: home.wins,
      tiny: tiny.wins,
      want: wantTiny,
    })
  );
  // The icons' frame is the whole desktop below the MENU BAR alone
  // (shell/layout.js ICON_FRAME — uniform bands, the 64px cell a fixed
  // size) — deliberately not the windows'.
  const wantIcons = home.icons.map((i) => expectIcon(i, raster(home), raster(tiny)));
  check(
    'every desktop icon lands exactly on its nine-slice pin (below the menu bar) too',
    tiny.icons.length > 0 && JSON.stringify(tiny.icons) === JSON.stringify(wantIcons),
    JSON.stringify({ home: home.icons, tiny: tiny.icons, want: wantIcons })
  );
  // The ONE size intervention past the pin: a resizable window BIGGER than
  // the open area shrinks to fit it (otherwise its grow-box corner is
  // unreachable at any position — the title bar can't leave the raster
  // upward); the pin itself is untouched, so the round trip below restores
  // the size exactly.
  check(
    'every resizable window fits the shrunk open area (grow box reachable)',
    tiny.wins.filter((w) => w.r).every((w) => w.w <= tiny.dw && w.h <= tiny.dh - 56),
    JSON.stringify(tiny)
  );
  // Wiggle the height up and down a few times before coming home — the
  // ratchet regression (re-deriving the pin from the just-snapped geometry
  // each event) crept windows DOWN one notch per event and never back up,
  // so a wiggle run is what catches it; the pin cache maps the same pin
  // every event, so home must be EXACT — position AND size (the wiggle's
  // smaller heights re-map and re-clamp sizes mid-run; the truth cache
  // must bring them back whole).
  for (const h of [700, 560, 760, 620, 800]) {
    await metrics(780, h);
    await sleep(150);
  }
  await metrics(780, 640); // back home
  await sleep(400);
  const back = await layoutSnap();
  check(
    'a resize wiggle round-trips every window exactly home (position and size)',
    back.wins.every((w) => {
      const o = home.wins.find((x) => x.id === w.id);
      return o && w.left === o.left && w.top === o.top && w.w === o.w && w.h === o.h;
    }),
    JSON.stringify({ before: home.wins, after: back.wins })
  );
  // The icons ride the same truth cache (icons.js `pins`), so home must be
  // exact for them too — the ratchet regression would show here first (an
  // icon is small enough that one notch per event marches it visibly).
  check(
    '…and every desktop icon exactly home',
    back.icons.every((i) => {
      const o = home.icons.find((x) => x.id === i.id);
      return o && i.left === o.left && i.top === o.top;
    }),
    JSON.stringify({ before: home.icons, after: back.icons })
  );
  // A CORNER WIDGET IS RIGID — the rule's win over the old proportional
  // pin, which slid an edge-hugging window inward on every shrink. Drag
  // the fixed-size Sprite View 10px inside the bottom-right corner (both
  // its edges per axis in the far bands), shrink: its offsets from the
  // corner hold to the pixel; grow back: exactly home.
  const spriteHome = home.wins.find((w) => w.id === 'win-sprite');
  const cornerTarget = {
    left: home.dw - spriteHome.w - 10,
    top: home.dh - spriteHome.h - 10,
  };
  const spriteBar = await evaluate(
    `(() => {${DEEP} const r = __q('#win-sprite').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 6 }; })()`
  );
  const dx = cornerTarget.left - spriteHome.left;
  const dy = cornerTarget.top - spriteHome.top;
  await mouse('mousePressed', spriteBar.x, spriteBar.y);
  await mouse('mouseMoved', spriteBar.x + dx / 2, spriteBar.y + dy / 2, { buttons: 1 });
  await mouse('mouseMoved', spriteBar.x + dx, spriteBar.y + dy, { buttons: 1 });
  await mouse('mouseReleased', spriteBar.x + dx, spriteBar.y + dy, { buttons: 0 });
  await sleep(300);
  const cornered = await layoutSnap();
  const spriteC = cornered.wins.find((w) => w.id === 'win-sprite');
  check(
    'the Sprite View dragged 10px inside the bottom-right corner',
    spriteC.left === cornerTarget.left && spriteC.top === cornerTarget.top,
    JSON.stringify({ cornerTarget, spriteC })
  );
  // 780×640 → 600×440: 1.3×/1.45×, two different zoom rungs (see above).
  await metrics(600, 440);
  await sleep(300);
  const shrunk = await layoutSnap();
  const spriteS = shrunk.wins.find((w) => w.id === 'win-sprite');
  check(
    'a corner widget is rigid: the same 10px offsets from the corner on the shrunk raster',
    shrunk.dw - (spriteS.left + spriteS.w) === 10 &&
      shrunk.dh - (spriteS.top + spriteS.h) === 10 &&
      spriteS.w === spriteC.w &&
      spriteS.h === spriteC.h,
    JSON.stringify({ dw: shrunk.dw, dh: shrunk.dh, spriteS })
  );
  await metrics(780, 640);
  await sleep(300);
  const cornerBack = await layoutSnap();
  check(
    '…and exactly home again on the way back',
    JSON.stringify(cornerBack.wins) === JSON.stringify(cornered.wins),
    JSON.stringify({ before: cornered.wins, after: cornerBack.wins })
  );

  // The reported case: the browser is resized WHILE the About box is up (a
  // greeted boot — windoids hidden, nothing open), then OK, File → New…,
  // Create. The hidden windoids are untouched, so the resize re-placed
  // them; the new window places on the live raster — so everything lands
  // exactly where Arrange Windows would put it on the squished raster, not
  // on a scaled-down copy of the boot layout. (A one-axis squish: the
  // kit's zoom tracker can't read it as page zoom.)
  await send('Page.navigate', { url: SEED_URL });
  await waitForGreet();
  await metrics(780, 500);
  await sleep(400);
  let made = null;
  for (let attempt = 0; attempt < 3 && made?.docWindows !== 1; attempt++) {
    await dismissGreet();
    await newBlankDoc();
    made = await probe();
  }
  const afterCreate = await layoutSnap();
  s = await probe();
  // "Where Arrange would" is the app's own question now: the ⌘J item reads
  // the zoom state exactly when every window on screen sits on the box its
  // placement would write (windows.js arranged()).
  check(
    'a resize behind the About box: Create lands every window where Arrange would — the ⌘J item reads the zoom state',
    made?.docWindows === 1 &&
      afterCreate.wins.length === 4 &&
      s.menuEnabled.arrange === true &&
      s.menuEnabled.arrangeValue === 'zoom',
    JSON.stringify({ created: afterCreate.wins, item: s.menuEnabled })
  );
  const railD = afterCreate.wins.find((w) => w.id === 'win-sprite');
  const stageD = afterCreate.wins.find((w) => w.id === 'win-stage');
  check(
    '…with the rail right-flush and full-height on the squished raster',
    railD.left + railD.w === afterCreate.dw - 14 &&
      stageD.top + stageD.h === afterCreate.dh - 8,
    JSON.stringify({ dw: afterCreate.dw, dh: afterCreate.dh, railD, stageD })
  );
  await send('Emulation.clearDeviceMetricsOverride');

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
