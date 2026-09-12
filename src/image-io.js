// Browser image decoding helpers -> ImageData (the {width,height,data} shape the
// pipeline consumes). Standalone so the loaders and the topbar's download share it.

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

// Encode an ImageData (or plain {width,height,data}) to a PNG Blob. The
// wrap-if-plain guard means a pipeline tile object (e.g. a resized atlas sheet)
// works as well as a real ImageData.
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

// The document format's byte-level pair: an atlas as finished PNG bytes (ready
// for the engine's png-chunks.js surgery), and PNG/image bytes back to ImageData.
export async function imageDataToPngBytes(imageData) {
  const blob = await imageDataToBlob(imageData);
  return new Uint8Array(await blob.arrayBuffer());
}

export async function bytesToImageData(bytes) {
  return bitmapToImageData(await createImageBitmap(new Blob([bytes])));
}

// A canvas's pixels as finished PNG bytes (the 3D Sprite Atlas export: the
// rendered sheet canvas straight to a file, ready for chunk surgery).
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

// --- desktop icon art --------------------------------------------------------
// A document's desktop icon is generated from the document itself — a render
// of its MODEL, made once per save and cached on the record
// (scene/icon-renderer.js; the seeded defaults get theirs the same way, since
// seeding IS a save). The flat FRONT-tile thumbnail that stood here until
// Sep 11 2026 went with it: an icon shows the object, not the sheet.
//
// This is what stands in where there is no model to draw — a document with
// nothing painted, or a browser with no WebGL: a generic System 7 document
// glyph (white page, 1px black border, folded corner), drawn once and cached
// — deterministic, no asset to ship.
let genericDocIcon = null;
export function genericDocIconDataUri() {
  if (genericDocIcon) return genericDocIcon;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const g = c.getContext('2d');
  const FOLD = 8;
  // Page (inset 5/1 to a classic 22×30 doc shape), fold clipped off the
  // top-right corner.
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
  // The folded-back corner.
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

// Trigger a browser download of a Blob under the given filename via a transient
// <a download>, revoking the object URL afterwards so nothing leaks.
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
