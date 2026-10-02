// Document names and the file names made from them.

export const UNTITLED = 'untitled';

/** "Cargo Ship" -> "cargo-ship". Also the atlas JSON's frame key prefix. */
export const slugOf = (name) => {
  const slug = (name || UNTITLED)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || UNTITLED;
};

/** "Cargo Ship" -> "cargo-ship.png" (File → Download). */
export const docFilename = (name) => `${slugOf(name)}.png`;

/** "Cargo Ship" -> "cargo-ship-atlas": the base name of the atlas zip and the
 *  files in it. */
export const ringBasename = (name) => `${slugOf(name)}-atlas`;
/** "Cargo Ship" -> "cargo-ship-atlas.zip". */
export const ringFilename = (name) => `${ringBasename(name)}.zip`;
/** "Cargo Ship" -> "cargo-ship.glb" (File → Export 3D Model…). */
export const modelFilename = (name) => `${slugOf(name)}.glb`;
