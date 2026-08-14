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
