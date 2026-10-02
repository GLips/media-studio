// three-shot-camera.ts: a three.js PerspectiveCamera set to be a shot camera (shot-camera.ts), for the studio's
// three/webgpu renderer.

import { WebGPUCoordinateSystem, type PerspectiveCamera } from 'three/webgpu';
import type { ShotCamera } from '../models/shot-camera.ts';

/**
 * Sets `three` to `shot`: its place, turn, field of view over the frame, depth range and lens shift, its matrices
 * updated. Its coordinate system is WebGPU's beforehand: the renderer remakes the projection of a camera set for
 * another one, which would undo any change a caller makes to it after this (ThreeStage's aperture shear).
 */
export function setThreeShotCamera(three: PerspectiveCamera, shot: ShotCamera): PerspectiveCamera {
  const { frame, position, quaternion, fov, near, far, shift } = shot;
  three.coordinateSystem = WebGPUCoordinateSystem;
  three.position.set(...position);
  three.quaternion.set(...quaternion);
  Object.assign(three, { fov, aspect: frame.width / frame.height, near, far, zoom: 1 });
  // A lens shift slides the picture: the view starts −shift into a frame-sized whole.
  if (shift.x || shift.y) three.setViewOffset(frame.width, frame.height, -shift.x, -shift.y, frame.width, frame.height);
  else three.clearViewOffset();
  three.updateProjectionMatrix();
  three.updateMatrixWorld();
  return three;
}
