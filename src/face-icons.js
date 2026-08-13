// ---------------------------------------------------------------------------
// PLACEHOLDER cube-view icons for the editor's face picker — one small isometric
// cube per atlas face, with the face's quad highlighted in the accent red (per
// the System 7 UI mockup). These are stand-in inline SVGs: the real per-angle
// artwork will be dropped in later as raster assets; only `faceIcon()`'s return
// value (an element) is depended on, so swapping the art means editing this file
// alone (e.g. return a <vf-img> wrapping the provided PNGs).
//
// The cube is drawn as seen from the front-top-right corner, so three faces are
// visible: TOP (the rhombus), FRONT (lower-left quad), RIGHT (lower-right quad).
// A visible face highlights SOLID red; its hidden opposite (back / left /
// bottom) highlights the same quad with a red diagonal HATCH — "the far side of
// this one".
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';
const ACCENT = '#e0442f';

// The three visible quads of a 26×26 iso cube (points as "x,y" polygon lists).
const QUAD_POINTS = {
  top: '13,2 23,7.5 13,13 3,7.5',
  front: '3,7.5 13,13 13,24 3,18.5', // lower-left quad
  right: '23,7.5 23,18.5 13,24 13,13', // lower-right quad
};

// face -> which visible quad carries its highlight, and whether it's the hidden
// opposite (hatched) rather than the visible face itself (solid).
const FACE_QUAD = {
  front: { quad: 'front', hidden: false },
  back: { quad: 'front', hidden: true },
  right: { quad: 'right', hidden: false },
  left: { quad: 'right', hidden: true },
  top: { quad: 'top', hidden: false },
  bottom: { quad: 'top', hidden: true },
};

function poly(points, fill, stroke) {
  const p = document.createElementNS(SVG_NS, 'polygon');
  p.setAttribute('points', points);
  p.setAttribute('fill', fill);
  if (stroke) {
    p.setAttribute('stroke', stroke);
    p.setAttribute('stroke-width', '1.25');
    p.setAttribute('stroke-linejoin', 'round');
  }
  return p;
}

// One shared hatch pattern per SVG instance. The id repeats across instances in
// the document; every copy is identical, so the first-match resolution of
// url(#…) is harmless.
function hatchDefs() {
  const defs = document.createElementNS(SVG_NS, 'defs');
  const pat = document.createElementNS(SVG_NS, 'pattern');
  pat.setAttribute('id', 'sm-face-hatch');
  pat.setAttribute('width', '3');
  pat.setAttribute('height', '3');
  pat.setAttribute('patternUnits', 'userSpaceOnUse');
  pat.setAttribute('patternTransform', 'rotate(45)');
  const r = document.createElementNS(SVG_NS, 'rect');
  r.setAttribute('width', '1.5');
  r.setAttribute('height', '3');
  r.setAttribute('fill', ACCENT);
  pat.appendChild(r);
  defs.appendChild(pat);
  return defs;
}

/**
 * Build the placeholder cube icon for one atlas face.
 * @param {'left'|'right'|'front'|'back'|'top'|'bottom'} face
 * @returns {SVGSVGElement}
 */
export function faceIcon(face) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 26 26');
  svg.setAttribute('width', '26');
  svg.setAttribute('height', '26');
  svg.setAttribute('aria-hidden', 'true');
  const { quad, hidden } = FACE_QUAD[face] || FACE_QUAD.front;
  if (hidden) svg.appendChild(hatchDefs());
  for (const q of ['top', 'front', 'right']) {
    const isMark = q === quad;
    const fill = !isMark ? '#fff' : hidden ? 'url(#sm-face-hatch)' : ACCENT;
    // Hatched quads keep a white base underneath so the pattern reads on white.
    if (isMark && hidden) svg.appendChild(poly(QUAD_POINTS[q], '#fff'));
    svg.appendChild(poly(QUAD_POINTS[q], fill, '#000'));
  }
  return svg;
}
