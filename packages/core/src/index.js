// ---------------------------------------------------------------------------
// The engine's public surface — what `import … from 'sprite-machine'` gives:
// the pipeline (ingest → carve → colorize), the mesher (regions, wedges, the
// T-junction repair, the skin), the atlas's slicing and resizing, the file
// formats (PNG chunks, the PNG encoder, glb) and the vocabularies. Explicit
// names, never `export *`: two modules re-exporting one name through a star
// would silently export neither. The headless entry is model.js; the Node
// adapter (a PNG's pixels in, a glb file out) is `sprite-machine/node`.
// ---------------------------------------------------------------------------

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
