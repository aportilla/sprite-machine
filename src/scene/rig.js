// Light rig for the offscreen renderers (ring-renderer.js, icon-renderer.js).
// The lights are posed relative to the camera, so every yaw is lit the same way.
// No ground or shadows.

import * as THREE from 'three';

// Light directions in camera space (x right, y up, z toward the camera). They
// are the stage's key (4, 8, 3) and fill (−5, 3, −4) as seen from its default
// framing, tuned by eye.
const KEY_DIR = new THREE.Vector3(0.22, 0.52, 0.83).normalize();
const FILL_DIR = new THREE.Vector3(-0.1, 0.81, -0.57).normalize();

/**
 * Adds the rig's lights to a scene.
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
     * Aims both lights at `center` from `dist` away along their camera-space
     * directions. The camera's world matrix must be current.
     * @param {THREE.Camera} camera
     * @param {THREE.Vector3} center  what the camera looks at
     * @param {number} dist  the camera's distance from center
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
