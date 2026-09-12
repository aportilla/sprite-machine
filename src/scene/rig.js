// ---------------------------------------------------------------------------
// The offscreen renderers' LIGHT RIG — what the 3D Sprite Atlas
// (scene/ring-renderer.js) and the desktop icon (scene/icon-renderer.js)
// light their model by, and the rule that makes the two agree: THE LIGHTS
// RIDE WITH THE CAMERA.
//
// In an engine the camera and the sun are fixed and the OBJECT turns, so the
// light's direction relative to the camera is constant across a rotation set;
// every angle is lit the same way. Rendering that with a camera that orbits
// means the rig orbits with it — the stage's ambient + key + fill, each
// directional light re-posed per pose at a FIXED offset in the CAMERA's own
// frame (right / up / back), expressed from the stage's world rig
// (scene/stage.js) as seen from its default three-quarter framing and tuned
// by eye so a view at 45° reads like the 3D View. World-fixed lights would
// shade each facing differently.
//
// No ground and no shadow: the ground plane is the 3D View's furniture, and
// a sprite carries none.
// ---------------------------------------------------------------------------

import * as THREE from 'three';

// The rig in the CAMERA's frame (x right, y up, z back toward the camera), as
// unit directions from the subject: the key above and a little to the right,
// mostly from the camera's side (the stage's key at (4, 8, 3) seen from its
// default framing — the top faces brightest, the front lit, the far flank in
// the ambient); the fill from above-behind the subject, a rim off the top
// edges (the stage's (−5, 3, −4) in the same frame).
const KEY_DIR = new THREE.Vector3(0.22, 0.52, 0.83).normalize();
const FILL_DIR = new THREE.Vector3(-0.1, 0.81, -0.57).normalize();

/**
 * Add the rig to a scene and hand back its one verb.
 * @param {THREE.Scene} scene
 */
export function createRig(scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  const fill = new THREE.DirectionalLight(0xcfd6ff, 0.35);
  scene.add(key, fill, key.target, fill.target);
  const offset = new THREE.Vector3();

  return {
    /**
     * Re-pose the rig for a camera pose: both lights aimed at `center`, each
     * standing off it by `dist` along its own fixed offset in the camera's
     * frame. The camera's world matrix must be current.
     * @param {THREE.Camera} camera
     * @param {THREE.Vector3} center  what the camera looks at
     * @param {number} dist  the camera's own stand-off, the rig's too
     */
    pose(camera, center, dist) {
      key.target.position.copy(center);
      fill.target.position.copy(center);
      key.position
        .copy(
          offset.copy(KEY_DIR).multiplyScalar(dist).applyQuaternion(camera.quaternion)
        )
        .add(center);
      fill.position
        .copy(
          offset.copy(FILL_DIR).multiplyScalar(dist).applyQuaternion(camera.quaternion)
        )
        .add(center);
    },
  };
}
