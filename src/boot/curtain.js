// ---------------------------------------------------------------------------
// The startup curtain — the black screen the page boots behind.
//
// index.html declares it: an opaque #curtain over the whole viewport, in an
// INLINE <style>, so it is there on the first frame the browser paints —
// before src/style.css exists (main.js imports it, so in dev it arrives with
// the module) and before the vf-* / sm-* elements are defined (until then the
// document's markup lays its text children out as plain prose, sheet or no
// sheet). This is the other half: the boot lifts the curtain once the desktop
// is COMPOSED — the elements upgraded and wired by main.js's top level, the
// kit's embedded display face loaded, and one frame of the real desktop
// painted behind the black. It never comes back down.
//
// The lift deliberately does NOT wait for the boot documents (main.js's
// bootDocuments): the library listing is an IndexedDB round-trip, and the
// desktop should appear as soon as it is the desktop — the document icons and
// the About box arrive as storage answers. A dialog wouldn't be covered
// anyway: vf-dialog opens in the browser's top layer, above every z-index.
//
// If the module graph never loads at all, the screen stays black: the app
// didn't start, and a black screen says so more honestly than a page of
// unstyled prose.
// ---------------------------------------------------------------------------

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Lift the curtain. Idempotent, and a no-op once it's gone (an HMR re-run).
 */
export async function liftCurtain() {
  const el = document.getElementById('curtain');
  if (!el) return;
  // The kit registers 'VF Display' as an embedded woff2 the moment it is
  // imported, so that load is still pending here: without the wait, the first
  // frame lands in the fallback face and the whole chrome reflows as the real
  // one swaps in.
  await document.fonts.ready;
  // Two frames: the first is the composed desktop painted behind the black,
  // the second is the one the user sees.
  await nextFrame();
  await nextFrame();
  el.remove();
}

// The net under a boot that throws: `load` fires whatever main.js's top level
// did, so a broken boot shows its broken page instead of black forever. This
// module is imported first for that reason. A healthy boot's own lift starts
// its wait earlier and wins the race; both paths run the same one.
addEventListener(
  'load',
  () => {
    liftCurtain();
  },
  { once: true }
);
