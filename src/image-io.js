// Browser image helpers: decode to ImageData, encode to PNG and download files.

async function bitmapToImageData(bmp) {
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(bmp, 0, 0);
  return g.getImageData(0, 0, bmp.width, bmp.height);
}

export async function fileToImageData(file) {
  return bitmapToImageData(await createImageBitmap(file));
}

export async function urlToImageData(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return bitmapToImageData(await createImageBitmap(await res.blob()));
}

// Encode an ImageData, or a plain {width, height, data} object, to a PNG Blob.
export function imageDataToBlob(imageData) {
  const id =
    imageData instanceof ImageData
      ? imageData
      : new ImageData(
          new Uint8ClampedArray(imageData.data),
          imageData.width,
          imageData.height
        );
  const c = document.createElement('canvas');
  c.width = id.width;
  c.height = id.height;
  c.getContext('2d').putImageData(id, 0, 0);
  return new Promise((resolve, reject) => {
    c.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas toBlob returned null'))),
      'image/png'
    );
  });
}

// ImageData to PNG bytes, and image bytes back to ImageData.
export async function imageDataToPngBytes(imageData) {
  const blob = await imageDataToBlob(imageData);
  return new Uint8Array(await blob.arrayBuffer());
}

export async function bytesToImageData(bytes) {
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
