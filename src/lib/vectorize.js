// ---------------------------------------------------------------------------
// Vectorize a binary mask into clean polygon loops, and the 2D helpers the
// low-poly builder needs. Pure (no THREE/DOM); the correctness of the whole
// low-poly pipeline rests on rasterize(trace(mask)) === mask, tested in Node.
//
// Coordinates: cells are (x,y) in [0,w)x[0,h); polygon vertices live on the
// pixel-CORNER lattice, integer (i,j) in [0,w]x[0,h]. Marching squares traces
// the filled/empty boundary as closed loops of corner vertices.
// ---------------------------------------------------------------------------

const vid = (i, j, w) => i + (w + 1) * j;

/**
 * Marching squares on the corner lattice. Returns closed loops (arrays of
 * [i,j] integer corner coords, no repeated closing vertex). Filled regions and
 * their holes come out as separate loops.
 * @param {ArrayLike<number>} mask length w*h, nonzero = filled
 */
export function marchingSquares(mask, w, h) {
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x];

  // Directed boundary half-edges, one per filled-cell side whose neighbor is
  // empty, emitted in a consistent (cell) rotational order so they chain up.
  // Key an edge by its from-vertex for the walk.
  const outByFrom = new Map(); // fromVid -> [{to:[i,j], toVid, used:false}]
  const add = (fi, fj, ti, tj) => {
    const f = vid(fi, fj, w);
    let arr = outByFrom.get(f);
    if (!arr) outByFrom.set(f, (arr = []));
    arr.push({ from: [fi, fj], to: [ti, tj], toVid: vid(ti, tj, w), used: false });
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue;
      // interior-on-right convention (see notes); order is consistent per cell.
      if (!solid(x - 1, y)) add(x, y, x, y + 1); // left  side  down
      if (!solid(x, y + 1)) add(x, y + 1, x + 1, y + 1); // bottom right
      if (!solid(x + 1, y)) add(x + 1, y + 1, x + 1, y); // right up
      if (!solid(x, y - 1)) add(x + 1, y, x, y); // top   left
    }
  }

  // Walk the half-edges into closed loops. At a "pinch" (diagonal touch) a
  // vertex has >1 outgoing edge; pick the most-clockwise continuation so the
  // two diagonally-touching regions stay SEPARATE (consistent, watertight).
  const loops = [];
  const angle = (dx, dy) => Math.atan2(dy, dx);
  for (const [, arr] of outByFrom) {
    for (const start of arr) {
      if (start.used) continue;
      const loop = [];
      let e = start;
      while (e && !e.used) {
        e.used = true;
        loop.push(e.from);
        const outs = (outByFrom.get(e.toVid) || []).filter((o) => !o.used);
        if (outs.length === 0) { e = null; break; }
        if (outs.length === 1) { e = outs[0]; continue; }
        // choose continuation: smallest clockwise turn from incoming heading
        const inA = angle(e.to[0] - e.from[0], e.to[1] - e.from[1]);
        let best = outs[0], bestT = Infinity;
        for (const o of outs) {
          const outA = angle(o.to[0] - o.from[0], o.to[1] - o.from[1]);
          let t = inA - outA; // clockwise turn amount
          while (t <= 0) t += Math.PI * 2;
          while (t > Math.PI * 2) t -= Math.PI * 2;
          if (t < bestT) { bestT = t; best = o; }
        }
        e = best;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

/** Even-odd point-in-polygon over ALL loops (handles holes via parity). */
function insideLoops(px, py, loops) {
  let inside = false;
  for (const loop of loops) {
    for (let i = 0, n = loop.length; i < n; i++) {
      const a = loop[i], b = loop[(i + 1) % n];
      const ay = a[1], by = b[1];
      if ((ay > py) !== (by > py)) {
        const t = (py - ay) / (by - ay);
        if (px < a[0] + t * (b[0] - a[0])) inside = !inside;
      }
    }
  }
  return inside;
}

/** Rasterize loops back to a w*h mask (cell centers), for the fidelity test. */
export function rasterizeLoops(loops, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (insideLoops(x + 0.5, y + 0.5, loops)) out[y * w + x] = 1;
  return out;
}

/** Sutherland-Hodgman clip of a single loop against one axis-aligned half-plane.
 *  side: 'xlo'|'xhi'|'ylo'|'yhi' with bound b (keep x>=b, x<=b, y>=b, y<=b). */
function clipHalf(poly, side, b) {
  if (poly.length === 0) return poly;
  const inside = (p) =>
    side === 'xlo' ? p[0] >= b : side === 'xhi' ? p[0] <= b : side === 'ylo' ? p[1] >= b : p[1] <= b;
  const isect = (a, p) => {
    const t =
      side === 'xlo' || side === 'xhi'
        ? (b - a[0]) / (p[0] - a[0])
        : (b - a[1]) / (p[1] - a[1]);
    return [a[0] + t * (p[0] - a[0]), a[1] + t * (p[1] - a[1])];
  };
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], p = poly[(i + 1) % poly.length];
    const ain = inside(a), pin = inside(p);
    if (ain) out.push(a);
    if (ain !== pin) out.push(isect(a, p));
  }
  return out;
}

/** Clip a loop to the axis-aligned box [xlo,xhi]x[ylo,yhi]. */
export function clipLoopBox(loop, xlo, xhi, ylo, yhi) {
  let p = loop;
  p = clipHalf(p, 'xlo', xlo);
  p = clipHalf(p, 'xhi', xhi);
  p = clipHalf(p, 'ylo', ylo);
  p = clipHalf(p, 'yhi', yhi);
  return p;
}

export const signedArea = (loop) => {
  let a = 0;
  for (let i = 0, n = loop.length; i < n; i++) {
    const p = loop[i], q = loop[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};
