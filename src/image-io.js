// Browser image helpers: decode to ImageData, encode to PNG and download files.
// PNGs decode and encode through the engine's browser entry, because privacy
// browsers perturb canvas readback.

import { isPng } from 'sprite-machine';
import { decodePng, encodePng } from 'sprite-machine/browser';

// The canvas decode, for an image that is not a PNG.
async function bitmapToImageData(bmp) {
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(bmp, 0, 0);
  return g.getImageData(0, 0, bmp.width, bmp.height);
}

/** @param {string} url @returns {Promise<Uint8Array>} */
export async function urlToBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** An ImageData, or a plain {width, height, data} object, as PNG bytes. */
export const imageDataToPngBytes = (imageData) => encodePng(imageData);

/** Image bytes as an ImageData. A PNG's holds the decoder's buffer. */
export async function bytesToImageData(bytes) {
  if (isPng(bytes)) {
    const { width, height, data } = await decodePng(bytes);
    return new ImageData(data, width, height);
  }
  return bitmapToImageData(await createImageBitmap(new Blob([bytes])));
}

export function canvasToPngBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('canvas toBlob returned null'));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });
}

export const downloadPngBytes = (bytes, filename) =>
  downloadBlob(new Blob([bytes], { type: 'image/png' }), filename);

// Generic 32×32 document icon: a page with a folded corner, drawn once and
// cached. Used when a document has no model to render or WebGL is unavailable
// (see scene/icon-renderer.js).
let genericDocIcon = null;
export function genericDocIconDataUri() {
  if (genericDocIcon) return genericDocIcon;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const g = c.getContext('2d');
  const FOLD = 8;
  // A 22×30 page at (5, 1), with the top-right corner cut off for the fold.
  g.fillStyle = '#000';
  g.beginPath();
  g.moveTo(5, 1);
  g.lineTo(27 - FOLD, 1);
  g.lineTo(27, 1 + FOLD);
  g.lineTo(27, 31);
  g.lineTo(5, 31);
  g.closePath();
  g.fill();
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(6, 2);
  g.lineTo(26 - FOLD, 2);
  g.lineTo(26, 2 + FOLD);
  g.lineTo(26, 30);
  g.lineTo(6, 30);
  g.closePath();
  g.fill();
  // Folded corner.
  g.fillStyle = '#000';
  g.beginPath();
  g.moveTo(27 - FOLD, 1);
  g.lineTo(27 - FOLD, 1 + FOLD);
  g.lineTo(27, 1 + FOLD);
  g.closePath();
  g.fill();
  // Ruled lines.
  g.fillStyle = '#888';
  for (let y = 10; y <= 26; y += 4) g.fillRect(9, y, 14, 1);
  genericDocIcon = c.toDataURL('image/png');
  return genericDocIcon;
}

// Download a Blob as filename through a temporary <a download>.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
