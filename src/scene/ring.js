// ---------------------------------------------------------------------------
// The 3D Sprite Atlas's FOLLOWER — the cadence, gating and publishing around
// scene/ring-renderer.js: it takes the rebuilder's mesh through the one
// `onMesh` seam (the rebuilder stays the pipeline's only consumer; this
// never runs buildVoxels), re-renders on any setting change, and publishes
// the sheet on the ring slice's sheet channel for the windoid's cells.
//
// NEVER RENDER WHILE HIDDEN: the rebuilder fires per stroke frame at the
// live channel's rAF rate, and rendering N frames + a canvas copy per
// stroke frame behind a hidden windoid would be pure waste — so a change
// while hidden only marks the sheet DIRTY, and the show (prefs.showRing
// flipping true) renders it at once. Shown, at most ONE render per animation
// frame, whatever fired (a setting, a rebuild, both) — the Sprite View's
// per-frame blit is the same cost class. Export's renderSheet() is the one
// deliberate exception: it renders now, shown or not — the file must be the
// strip's exact pixels, so it publishes what it rendered too.
//
// THE RENDERER IS MADE LAZILY, on the first render: the windoid boots
// hidden, and a GL context (a second one on the page, SwiftShader in a
// headless capture) is nothing to pay for at boot on a strip that may never
// be shown. The subject is held here meanwhile and handed over at creation.
// ---------------------------------------------------------------------------

import { prefs } from '../state/prefs.js';
import { ring } from '../state/ring.js';

/**
 * @param {() => ReturnType<typeof import('./ring-renderer.js').createRingRenderer>} createRenderer
 *   the renderer factory (scene/ring-renderer.js createRingRenderer),
 *   called once, on the first render
 */
export function initRing(createRenderer) {
  /** @type {ReturnType<typeof createRenderer>|null} */
  let renderer = null;
  /** @type {Parameters<ReturnType<typeof createRenderer>['setSubject']>[0]} */
  let subject = null;
  let dirty = true;
  let raf = 0;

  const rendererNow = () => {
    if (!renderer) {
      renderer = createRenderer();
      renderer.setSubject(subject);
    }
    return renderer;
  };
  const flush = () => {
    raf = 0;
    if (!dirty) return;
    dirty = false;
    ring.publishSheet(rendererNow().render(ring.get()));
  };
  const schedule = () => {
    dirty = true;
    if (!prefs.get().showRing) return; // hidden: remember, don't render
    if (!raf) raf = requestAnimationFrame(flush);
  };

  const unsubs = [
    // Any setting change re-renders (shown) or dirties (hidden).
    ring.subscribe(schedule),
    // A show with a dirty sheet renders at once.
    prefs.subscribe((p) => {
      if (p.showRing && dirty && !raf) raf = requestAnimationFrame(flush);
    }),
  ];

  return {
    /** The rebuilder's onMesh: a new mesh (the renderer takes a
     *  shared-geometry clone) or null (the old one is about to be disposed). */
    setSubject(sub) {
      subject = sub;
      renderer?.setSubject(sub);
      schedule();
    },
    /** Export: render the strip now regardless of showRing, publish it, and
     *  return the sheet canvas (null with no model). */
    renderSheet() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      dirty = false;
      const sheet = rendererNow().render(ring.get());
      ring.publishSheet(sheet);
      return sheet?.canvas ?? null;
    },
    /** HMR teardown. */
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      for (const u of unsubs) u();
      renderer?.dispose();
      renderer = null;
      subject = null;
    },
  };
}
