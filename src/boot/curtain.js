// Startup curtain. index.html's #curtain is styled inline so it covers the first
// paint. liftCurtain removes it once fonts load and the desktop has painted.

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Removes the curtain. A no-op once it is gone.
 */
export async function liftCurtain() {
  const el = document.getElementById('curtain');
  if (!el) return;
  // The kit's embedded 'VF Display' font is still loading here. Without the
  // wait, the first frame uses the fallback face and the chrome reflows.
  await document.fonts.ready;
  // Two frames, so the desktop has painted behind the curtain before it goes.
  await nextFrame();
  await nextFrame();
  el.remove();
}

// Also lifts on load, so a boot that throws still shows the page. main.js must
// import this module first.
addEventListener(
  'load',
  () => {
    liftCurtain();
  },
  { once: true }
);
