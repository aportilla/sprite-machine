// 3D Sprite Atlas follower. Receives the rebuilder's mesh through onMesh,
// re-renders on setting changes and publishes the sheet on the ring slice.
//
// While the windoid is hidden (prefs.showRing false) a change only marks the
// sheet dirty, and showing it renders at once. While shown, renders are
// coalesced to one per animation frame. renderSheet() renders immediately in
// either case, for export. The renderer and its GL context are created on the
// first render.

import { prefs } from '../state/prefs.js';
import { ring } from '../state/ring.js';

/**
 * @param {() => ReturnType<typeof import('./ring-renderer.js').createRingRenderer>} createRenderer
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
    if (!prefs.get().showRing) return; // hidden: stay dirty
    if (!raf) raf = requestAnimationFrame(flush);
  };

  const unsubs = [
    ring.subscribe(schedule),
    // Showing the windoid renders a dirty sheet.
    prefs.subscribe((p) => {
      if (p.showRing && dirty && !raf) raf = requestAnimationFrame(flush);
    }),
  ];

  return {
    /** onMesh target: a new mesh, or null before the old one is disposed. */
    setSubject(sub) {
      subject = sub;
      renderer?.setSubject(sub);
      schedule();
    },
    /** For export: renders and publishes the strip now, shown or not. Returns
     *  the sheet canvas, or null with no model. */
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
