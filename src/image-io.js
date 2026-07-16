// Browser image decoding helpers -> ImageData (the {width,height,data} shape the
// pipeline consumes). Kept out of ui.js so main.js can load atlas URLs too.

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
