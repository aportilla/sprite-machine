// 3D Sprite Atlas renderer. Renders a clone of the rebuilder's mesh
// orthographically from a ring of yaws into one sheet canvas of `views` square
// frames. The sheet is both the windoid's picture and the exported file.
// scene/ring.js drives it and lib/ring.js has the geometry.
//
// - The clone shares geometry and material with the rebuilder's mesh.
// - Each frame fits the whole lattice at every yaw. The camera uses the pose's
//   own up vector, so elevation 90 is well defined.
// - No antialiasing or smoothing: every pixel is a hard sample of the mesh.
// - The offscreen canvas is never composited, so the 2D copy runs in the same
//   task as the renders, with preserveDrawingBuffer set.

import * as THREE from 'three';
import { DEFAULT_WORLD_SIZE } from 'sprite-machine';
import {
  ringYaws,
  ringFrame,
  ringSheet,
  ringCameraDir,
  ringCameraUp,
  ringCenter,
} from '../lib/ring.js';
import { createRig } from './rig.js';

/**
 * @typedef {{views: number, elevation: number, offset: number, size: number}} RingSettings
 * @typedef {{canvas: HTMLCanvasElement, frame: number, views: number}} RingSheet
 */

export function createRingRenderer() {
  const gl = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({
    canvas: gl,
    antialias: false,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = null;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  scene.add(camera);
  const rig = createRig(scene);

  // The 2D copy read by the windoid and the export.
  const sheet = document.createElement('canvas');

  /** @type {{clone: THREE.Object3D, dims: {nx: number, ny: number, nz: number}}|null} */
  let subject = null;
  const center = new THREE.Vector3();
  const dir = new THREE.Vector3();

  return {
    /**
     * Clones the rebuilder's mesh, or drops the clone on null. Called before the
     * rebuilder disposes the shared geometry.
     * @param {{mesh: THREE.Object3D, dims: {nx: number, ny: number, nz: number}}|null} sub
     */
    setSubject(sub) {
      if (subject) {
        scene.remove(subject.clone);
        subject = null;
      }
      if (!sub) return;
      const clone = sub.mesh.clone();
      clone.rotation.set(0, 0, 0);
      clone.position.set(0, 0, 0);
      clone.traverse((o) => {
        o.castShadow = false;
        o.receiveShadow = false;
      });
      scene.add(clone);
      subject = { clone, dims: sub.dims };
    },

    /**
     * Renders the strip synchronously: `views` frames of `size` px at
     * `elevation`, at the yaws from ringYaws(views, offset). Null with no subject.
     * @param {RingSettings} settings
     * @returns {RingSheet|null}
     */
    render({ views, elevation, offset: first, size }) {
      if (!subject) return null;
      const { dims } = subject;
      const n = Math.max(1, Math.floor(views));
      // World units per voxel, as wedgeMesh scales with its default worldSize.
      const s = DEFAULT_WORLD_SIZE / Math.max(dims.nx, dims.ny, dims.nz);
      const { px: F, half } = ringFrame(dims, elevation, size);
      const { width, height } = ringSheet(n, F);
      if (gl.width !== width || gl.height !== height)
        renderer.setSize(width, height, false);

      center.set(...ringCenter(dims)).multiplyScalar(s);
      // Orthographic: the distance only has to keep the box past the near plane.
      const dist = 2 * Math.hypot(dims.nx, dims.ny, dims.nz) * s;
      camera.left = -half * s;
      camera.right = half * s;
      camera.top = half * s;
      camera.bottom = -half * s;
      camera.near = 0.1;
      camera.far = 3 * dist;
      camera.updateProjectionMatrix(); // the same frustum for every yaw

      const yaws = ringYaws(n, first);
      renderer.setScissorTest(true);
      for (let i = 0; i < n; i++) {
        const yaw = yaws[i];
        camera.up.set(...ringCameraUp(yaw, elevation));
        dir.set(...ringCameraDir(yaw, elevation));
        camera.position.copy(center).addScaledVector(dir, dist);
        camera.lookAt(center);
        camera.updateMatrixWorld();
        rig.pose(camera, center, dist);
        renderer.setViewport(i * F, 0, F, F);
        renderer.setScissor(i * F, 0, F, F);
        renderer.render(scene, camera);
      }
      renderer.setScissorTest(false);

      // Copy out in the same task as the renders. Setting the size clears the
      // 2D canvas.
      sheet.width = width;
      sheet.height = height;
      const g = sheet.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(gl, 0, 0);
      return { canvas: sheet, frame: F, views: n };
    },

    /** HMR teardown: release the GL context. */
    dispose() {
      if (subject) scene.remove(subject.clone);
      subject = null;
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
