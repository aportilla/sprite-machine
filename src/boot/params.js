// ---------------------------------------------------------------------------
// URL-param parsing → one typed boot object. Pure (string in, object out), so
// the whole dev-hook surface is Node-testable. ?file (or a bare #fragment) is
// the one USER-FACING param — the saved document a load should open instead
// of greeting with the About box. main.js APPLIES the result:
// most hooks are boot-time store actions (?edit → the boot context's face, ?pick →
// session.pickColor, ?palette → session.openPicker, ?tile → doc.resizeTiles,
// ?cursor / ?rect / ?fill / ?select's state halves → session actions, ?ring
// → prefs.setShowRing + the ring slice's setters); only the canvas-paint
// halves ride as one-shot props on <sm-draw-canvas>.
// ---------------------------------------------------------------------------

import { clampTile } from '../lib/atlas.js';
import { VIEW_NAMES } from '../lib/views.js';
import { PALETTE_168 } from '../lib/constants.js';
import { RING_DEFAULTS, RING_PAPERS } from '../state/ring.js';

/**
 * @param {string} search  location.search (with or without the leading '?')
 * @param {{sampleNames?: string[], hash?: string}} [opts]  the sample names,
 *   injected — the sample module itself imports a PNG asset, which only Vite
 *   can load, and this parser must stay Node-runnable — plus location.hash
 *   (the `#Cube` shorthand for ?file=Cube).
 */
export function parseBootParams(search, { sampleNames = [], hash = '' } = {}) {
  const params = new URLSearchParams(search);

  // ?file=<name> — or a bare #<name> fragment — asks the boot to open that
  // SAVED document instead of greeting with the About box. This just
  // carries the requested name; main.js resolves it against the refreshed
  // library listing (case-insensitive) and falls back to the About box
  // when nothing matches. ?file wins when both forms are given.
  let file = (params.get('file') ?? '').trim();
  if (!file && hash) {
    const frag = hash.replace(/^#/, '');
    try {
      file = decodeURIComponent(frag).trim();
    } catch {
      file = frag.trim(); // a malformed %-escape reads literally
    }
  }

  /** @type {{w:number,h:number}|null} */
  let tile = null;
  const tileParam = params.get('tile');
  if (tileParam) {
    const m = /^(\d+)(?:x(\d+))?$/i.exec(tileParam.trim());
    if (m) tile = { w: clampTile(+m[1]), h: clampTile(+(m[2] ?? m[1])) };
  }

  let cursor = null;
  const cursorParam = params.get('cursor');
  if (cursorParam) {
    const n = parseInt(cursorParam, 10);
    if (n > 0) cursor = n;
  }

  let pick = null;
  const pickParam = params.get('pick');
  if (pickParam != null) {
    const n = parseInt(pickParam, 10);
    if (n >= 0 && n < PALETTE_168.length) pick = n;
  }

  /** @type {{x0:number,y0:number,x1:number,y1:number,r:number,square:boolean}|null} */
  let rect = null;
  const rectParam = params.get('rect');
  if (rectParam) {
    const p = rectParam.split(',').map((s) => parseInt(s, 10));
    if (p.length >= 4 && p.slice(0, 4).every(Number.isFinite)) {
      rect = {
        x0: p[0],
        y0: p[1],
        x1: p[2],
        y1: p[3],
        r: p.length > 4 ? p[4] : 0,
        square: p.length > 5 && p[5] > 0,
      };
    }
  }

  /** @type {{x:number,y:number,contiguous:boolean,allFaces:boolean}|null} */
  let fill = null;
  const fillParam = params.get('fill');
  if (fillParam) {
    const p = fillParam.split(',').map((s) => parseInt(s, 10));
    if (p.length >= 2 && p.slice(0, 2).every(Number.isFinite)) {
      fill = {
        x: p[0],
        y: p[1],
        // The checkboxes, in UI order: contiguous defaults ON (the tool's
        // resting state), on-all-faces OFF.
        contiguous: p.length > 2 ? p[2] > 0 : true,
        allFaces: p.length > 3 && p[3] > 0,
      };
    }
  }

  // ?select=x0,y0,x1,y1[,dx,dy]: select that box with the selection tool on
  // mount, and — with an offset — lift it and float it there (a moved
  // selection over the art, the transparency rule in a shot). The canvas
  // draws the ants at phase 0 and never ticks under the hook, so a capture
  // stays byte-deterministic. Fewer than four ints → null.
  /** @type {{x0:number,y0:number,x1:number,y1:number,dx:number,dy:number}|null} */
  let select = null;
  const selectParam = params.get('select');
  if (selectParam) {
    const p = selectParam.split(',').map((s) => parseInt(s, 10));
    if (p.length >= 4 && p.slice(0, 4).every(Number.isFinite)) {
      select = {
        x0: p[0],
        y0: p[1],
        x1: p[2],
        y1: p[3],
        dx: p.length > 4 && Number.isFinite(p[4]) ? p[4] : 0,
        dy: p.length > 5 && Number.isFinite(p[5]) ? p[5] : 0,
      };
    }
  }

  // ?ring=<views>[,<elevation>[,<offset>[,<size>[,<paper>]]]]: show the 3D
  // Sprite Atlas windoid (it boots hidden) with those settings — a capture
  // hook, since the capture tool can't pull a menu or click a radio.
  // Present with a valid first integer ≥ 1 means "show"; each missing or
  // unparseable trailing field keeps its default (the slice clamps the
  // rest at seed; the paper is a RING_PAPERS key — white / black / gray —
  // or the default). ?ring=0 → null.
  /** @type {{views: number, elevation: number, offset: number, size: number, paper: string}|null} */
  let ring = null;
  const ringParam = params.get('ring');
  if (ringParam) {
    const raw = ringParam.split(',');
    const p = raw.map((s) => parseInt(s, 10));
    if (Number.isFinite(p[0]) && p[0] >= 1) {
      const at = (i, d) => (p.length > i && Number.isFinite(p[i]) ? p[i] : d);
      ring = {
        views: p[0],
        elevation: at(1, RING_DEFAULTS.elevation),
        offset: at(2, RING_DEFAULTS.offset),
        size: at(3, RING_DEFAULTS.size),
        paper: Object.hasOwn(RING_PAPERS, raw[4] ?? '') ? raw[4] : RING_DEFAULTS.paper,
      };
    }
  }

  // ?sample=<index|name>: a known name wins; else a clamped index; else 0.
  // `sampleExplicit` records whether the param was GIVEN — an explicit sample
  // is a test path and beats the boot restore of the last open document.
  let sampleIndex = 0;
  const q = params.get('sample');
  if (q != null && sampleNames.length) {
    const byName = sampleNames.findIndex((n) => n.toLowerCase() === q.toLowerCase());
    sampleIndex =
      byName >= 0 ? byName : Math.min(sampleNames.length - 1, Math.max(0, +q || 0));
  }

  const editParam = params.get('edit');

  // ?now=<when>: freeze the menu bar clock at an instant — an ISO date-time
  // (`2026-08-24T19:27`; an offset-less form reads as LOCAL time, a bare
  // date as UTC midnight) or epoch milliseconds — so a capture with the bar
  // in frame stays byte-deterministic. Unparseable → null, the live clock.
  let now = null;
  const nowParam = (params.get('now') ?? '').trim();
  if (nowParam) {
    const t = /^\d+$/.test(nowParam) ? +nowParam : Date.parse(nowParam);
    if (Number.isFinite(t)) now = t;
  }

  return {
    flat: params.get('flat') === '1',
    diag: params.get('diag') === '1',
    /** @type {string|null} camera preset name (main maps it to a direction) */
    cam: params.get('cam'),
    // No ?lowpoly and no ?rotate (gone Sep 4 2026 with their toggles): the
    // low-poly wedge pass is always on, and auto-rotate is off every load —
    // a capture's model is at rest with nothing said.
    /** @type {string|null} validated face name */
    edit: editParam && VIEW_NAMES.includes(editParam) ? editParam : null,
    tile,
    palette: params.get('palette') === '1',
    pick,
    cursor,
    rect,
    fill,
    select,
    sampleIndex,
    sampleExplicit: q != null,
    /** @type {string|null} the ?file=/#fragment saved-doc name request */
    file: file || null,
    // ?fresh=1: boot with storage ignored — no desktop-state restore, no
    // last-doc restore, no saved-doc icons, no state writes. Deterministic
    // captures on a machine with saved docs.
    fresh: params.get('fresh') === '1',
    /** @type {string[]} ?hide=<window>[,<window>] — shell window ids to hide
     *  at boot (a capture may need a window out of frame). */
    hide: (params.get('hide') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    /** @type {number|null} ?now=<when> — epoch ms the menu bar clock is
     *  frozen at (a capture hook); null = the live clock. */
    now,
    // ?patterns=1: open the Desktop Patterns control panel once the boot
    // document has landed (a capture hook — the capture tool can't pull a
    // menu). Under ?fresh the desktop is on the dither, so a shot shows the
    // panel seeded with it.
    patterns: params.get('patterns') === '1',
    // ?about=1: open the About box once the boot document has landed (a
    // capture hook — the plain boot greets with it, but that boot's virgin
    // seeding is an IndexedDB round-trip the capture tool's virtual-time
    // budget stalls on, so under ?fresh this is the way to a shot of it).
    about: params.get('about') === '1',
    // ?ring=…: the 3D Sprite Atlas windoid, shown with these settings (see
    // above); null leaves it hidden at the defaults.
    ring,
  };
}
