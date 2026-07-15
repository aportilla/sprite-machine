// Dev preview for the 45° diagonalizer: for each face view of the car atlas,
// draw the raw pixels next to the cleaned (diagonalized) color polygons.
// Served at /diag.html.

import carAtlasUrl from './assets/car-atlas.png';
import { urlToImageData } from './image-io.js';
import { sliceAtlas } from './lib/atlas.js';
import { diagonalizeView } from './lib/diagonalize.js';

const SC = 11; // pixels per sprite texel
const PAD = 46;
const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');

function drawRaw(g, v, ox, oy) {
  for (let y = 0; y < v.height; y++)
    for (let x = 0; x < v.width; x++) {
      const i = (y * v.width + x) * 4;
      if (v.data[i + 3] < 128) continue;
      g.fillStyle = `rgb(${v.data[i]},${v.data[i + 1]},${v.data[i + 2]})`;
      g.fillRect(ox + x * SC, oy + y * SC, SC, SC);
    }
  // faint grid
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  g.lineWidth = 1;
  for (let x = 0; x <= v.width; x++) { g.beginPath(); g.moveTo(ox + x * SC, oy); g.lineTo(ox + x * SC, oy + v.height * SC); g.stroke(); }
  for (let y = 0; y <= v.height; y++) { g.beginPath(); g.moveTo(ox, oy + y * SC); g.lineTo(ox + v.width * SC, oy + y * SC); g.stroke(); }
}

function drawDiag(g, v, ox, oy) {
  for (const { color, polys } of diagonalizeView(v)) {
    g.beginPath();
    for (const poly of polys) {
      poly.forEach((p, i) => {
        const X = ox + p[0] * SC, Y = oy + p[1] * SC;
        i ? g.lineTo(X, Y) : g.moveTo(X, Y);
      });
      g.closePath();
    }
    g.fillStyle = hex(color);
    g.fill('evenodd');
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 1.5;
    g.stroke();
  }
}

export async function run() {
  const img = await urlToImageData(carAtlasUrl);
  const { views } = sliceAtlas(img);
  const order = ['front', 'right', 'top', 'back'].filter((n) => views[n]);

  const colW = 40 * SC * 0 + (Math.max(...order.map((n) => views[n].width)) * SC + PAD);
  const rowH = Math.max(...order.map((n) => views[n].height)) * SC;
  const canvas = document.createElement('canvas');
  canvas.width = order.length * colW + PAD;
  canvas.height = rowH * 2 + PAD * 4;
  document.getElementById('app').appendChild(canvas);
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#4a4a52';
  g.fillRect(0, 0, canvas.width, canvas.height);

  g.fillStyle = '#e8e8ea';
  g.font = '18px ui-monospace, monospace';
  g.fillText('raw pixels', PAD, 28);
  g.fillText('45° diagonalized (per color region)', PAD, rowH + PAD * 2 + 8);

  let ox = PAD;
  for (const name of order) {
    const v = views[name];
    g.fillStyle = '#9a9aa6';
    g.font = '13px ui-monospace, monospace';
    g.fillText(name, ox, 46);
    drawRaw(g, v, ox, 56);
    drawDiag(g, v, ox, rowH + PAD * 2 + 20);
    ox += colW;
  }
}

run();
