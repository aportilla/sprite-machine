// Layers: a document's 3×2 blocks of tiles, stacked down its sheet, and their
// names. The block copies, the default names and the underlay compositor.

/** The fade of the art behind the canvas, shared by the Full Sprite View. */
export const ONION_ALPHA = 0.22;

/** The default name of the layer at block `index`: "Layer 1" for 0.
 *  @param {number} index */
export const defaultLayerName = (index) => `Layer ${index + 1}`;

/**
 * The name New Layer gives: the first "Layer n" not in use, counting up from
 * the new layer's own number.
 * @param {string[]} names  the document's layer names
 */
export function nextLayerName(names) {
  const used = new Set(names);
  for (let i = names.length; ; i++) {
    const name = defaultLayerName(i);
    if (!used.has(name)) return name;
  }
}

/**
 * `count` layer names from a chunk's: its names in block order, cut to the
 * count, with the default name for each one missing or blank.
 * @param {string[]|null|undefined} names  @param {number} count
 * @returns {string[]}
 */
export function fitLayerNames(names, count) {
  return Array.from({ length: count }, (_, i) => {
    const name = names?.[i];
    return typeof name === 'string' && name.trim() ? name : defaultLayerName(i);
  });
}

/**
 * A copy of a sheet with a transparent block of `blockHeight` rows added at the
 * bottom.
 * @param {{width:number, height:number, data:Uint8ClampedArray}} image
 * @param {number} blockHeight
 * @returns {{width:number, height:number, data:Uint8ClampedArray}}
 */
export function appendBlock(image, blockHeight) {
  const { width, height } = image;
  const data = new Uint8ClampedArray(width * (height + blockHeight) * 4);
  data.set(image.data.subarray(0, width * height * 4));
  return { width, height: height + blockHeight, data };
}

/**
 * A copy of a sheet without block `index`, the `blockHeight` rows from
 * index · blockHeight.
 * @param {{width:number, height:number, data:Uint8ClampedArray}} image
 * @param {number} index  @param {number} blockHeight
 * @returns {{width:number, height:number, data:Uint8ClampedArray}}
 */
export function removeBlock(image, index, blockHeight) {
  const { width, height } = image;
  const start = index * blockHeight * width * 4;
  const end = start + blockHeight * width * 4;
  const data = new Uint8ClampedArray(width * (height - blockHeight) * 4);
  data.set(image.data.subarray(0, start));
  data.set(image.data.subarray(end, width * height * 4), start);
  return { width, height: height - blockHeight, data };
}

/**
 * A copy of a sheet with block `from` moved to index `to`, the blocks between
 * shifted one place toward `from`.
 * @param {{width:number, height:number, data:Uint8ClampedArray}} image
 * @param {number} from  @param {number} to  @param {number} blockHeight
 * @returns {{width:number, height:number, data:Uint8ClampedArray}}
 */
export function moveBlock(image, from, to, blockHeight) {
  const { width, height } = image;
  const size = blockHeight * width * 4;
  const block = (k) => image.data.subarray(k * size, (k + 1) * size);
  const data = new Uint8ClampedArray(image.data);
  const step = from < to ? 1 : -1;
  for (let k = from; k !== to; k += step) data.set(block(k + step), k * size);
  data.set(block(from), to * size);
  return { width, height, data };
}

/**
 * Composite same-size tiles in order, each over the ones before it, with
 * straight alpha. Null entries are skipped.
 * @param {({width:number, height:number, data:ArrayLike<number>}|null)[]} tiles
 * @returns {{width:number, height:number, data:Uint8ClampedArray}|null}  a new
 *   tile, or null when every entry is null
 */
export function compositeTiles(tiles) {
  const present = tiles.filter((t) => t != null);
  if (present.length === 0) return null;
  const { width, height } = present[0];
  const out = new Uint8ClampedArray(width * height * 4);
  for (const { data: src } of present) {
    for (let i = 0; i < out.length; i += 4) {
      const sa = src[i + 3];
      if (sa === 0) continue;
      const keep = out[i + 3] * (1 - sa / 255);
      const a = sa + keep;
      for (let c = 0; c < 3; c++) out[i + c] = (src[i + c] * sa + out[i + c] * keep) / a;
      out[i + 3] = a;
    }
  }
  return { width, height, data: out };
}
