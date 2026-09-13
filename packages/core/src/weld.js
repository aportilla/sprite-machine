// Vertex weld for the mesher. Indexes flat triangle buffers, merging the
// vertices whose position, normal and uv agree. A component's key is its value
// scaled by ten thousand, offset by a half and truncated, the rule three's
// mergeVertices applies at its default tolerance, so the welded buffers match
// what it produced. Vertices keep first-seen order.

const SCALE = 1e4;
const key = (v) => ~~(v * SCALE + 0.5);

/**
 * @param {Float32Array} position  xyz per vertex, three vertices per triangle
 * @param {Float32Array} normal  xyz per vertex
 * @param {Float32Array} uv  uv per vertex
 * @returns {{position:Float32Array, normal:Float32Array, uv:Float32Array, index:Uint32Array}}
 *   the unique vertices and a triangle index into them
 */
export function weldVertices(position, normal, uv) {
  const count = position.length / 3;
  if (!Number.isInteger(count) || normal.length !== count * 3 || uv.length !== count * 2)
    throw new Error('weldVertices: one normal and one uv per position');
  const outPosition = new Float32Array(position.length);
  const outNormal = new Float32Array(normal.length);
  const outUv = new Float32Array(uv.length);
  const index = new Uint32Array(count);
  const seen = new Map();
  let next = 0;
  for (let i = 0; i < count; i++) {
    const p = i * 3;
    const t = i * 2;
    const k =
      `${key(position[p])},${key(position[p + 1])},${key(position[p + 2])},` +
      `${key(normal[p])},${key(normal[p + 1])},${key(normal[p + 2])},` +
      `${key(uv[t])},${key(uv[t + 1])}`;
    let j = seen.get(k);
    if (j === undefined) {
      j = next++;
      seen.set(k, j);
      const q = j * 3;
      outPosition[q] = position[p];
      outPosition[q + 1] = position[p + 1];
      outPosition[q + 2] = position[p + 2];
      outNormal[q] = normal[p];
      outNormal[q + 1] = normal[p + 1];
      outNormal[q + 2] = normal[p + 2];
      outUv[j * 2] = uv[t];
      outUv[j * 2 + 1] = uv[t + 1];
    }
    index[i] = j;
  }
  return {
    position: outPosition.slice(0, next * 3),
    normal: outNormal.slice(0, next * 3),
    uv: outUv.slice(0, next * 2),
    index,
  };
}
