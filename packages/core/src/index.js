// Public API of the sprite-machine package. Exports are listed by name: with
// export *, a name exported by two modules is silently dropped. The Node adapter
// is sprite-machine/node.

export {
  packRGBA,
  unpackRGBA,
  flip,
  applyTransform,
  ingestSprite,
  placeView,
} from './ingest.js';
export {
  voxIndex,
  unvoxIndex,
  reconcileDims,
  gridViews,
  carve,
  extractSurface,
} from './carve.js';
export { buildPalette, makeSnapper, colorize } from './colorize.js';
export { buildVoxels } from './pipeline.js';
export {
  VIEW_TO_FACE,
  FACE_TO_VIEW,
  FACE_NORMAL,
  FACE_KEYS,
  FACE_INDEX,
  AXIS_INDEX,
  faceKeyOf,
  FACE_AXIS,
  FACE_OPPOSITE,
  VIEWS,
  VIEW_NAMES,
  VIEW_DISPLAY_ORDER,
  VIEW_FRONT_EDGE,
  VIEW_OPPOSITE,
  MIRROR_AXIS,
  VIEW_AXES,
  VIEW_IMAGE_AXES,
} from './views.js';
export { FACE_GEO, idxFor, pointOf } from './faces.js';
export {
  DEFAULT_ATLAS_LAYOUT,
  TILE_MIN,
  TILE_MAX,
  clampTile,
  layoutSize,
  deriveTileSize,
  isBlank,
  contentBounds,
  validateSheet,
  sliceAtlas,
  blitTile,
  resizeTileTo,
  resizeTile,
  splitLow,
  resizeAtlas,
  cellOf,
} from './atlas.js';
export { traceRegions, planeKey, faceRegions } from './regions.js';
export { eliminateTJunctions } from './t-junction.js';
export { bakeSkin, uvOfLattice, swatchUV } from './skin.js';
export { skinTexture, finishVoxelMesh } from './mesh-util.js';
export { wedgeMesh } from './wedge-mesh.js';
export {
  PNG_SIGNATURE,
  isPng,
  crc32,
  readChunks,
  buildChunk,
  readTextChunks,
  setTextChunks,
} from './png-chunks.js';
export { adler32, zlibStored, encodePng } from './png-encode.js';
export { glbFromModel, glbParts, glbViewBytes } from './gltf.js';
export { computeDiag } from './diag.js';
export { DEFAULT_MIRROR, DEFAULT_WORLD_SIZE } from './constants.js';
export { buildModel, modelToGlb } from './model.js';
