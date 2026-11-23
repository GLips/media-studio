// three-shot-camera.ts: a three.js PerspectiveCamera set to be a shot camera (shot-camera.ts), for the studio's
// three/webgpu renderer.

import { Matrix4, WebGPUCoordinateSystem, type PerspectiveCamera } from 'three/webgpu';
import type { ShotCamera } from '../models/shot-camera.ts';

/**
 * Sets `three` to `shot`: its place, turn, field of view over the frame, depth range, lens shift and shear, its matrices
 * updated. Its coordinate system is WebGPU's beforehand: the renderer remakes the projection of a camera set for
 * another one, which would undo the shear laid onto it here.
 */
export function setThreeShotCamera(three: PerspectiveCamera, shot: ShotCamera): PerspectiveCamera {
  const { frame, position, quaternion, fov, near, far, shift, shear } = shot;
  three.coordinateSystem = WebGPUCoordinateSystem;
  three.position.set(...position);
  three.quaternion.set(...quaternion);
  Object.assign(three, { fov, aspect: frame.width / frame.height, near, far, zoom: 1 });
  // A lens shift slides the picture: the view starts −shift into a frame-sized whole.
  if (shift.x || shift.y) three.setViewOffset(frame.width, frame.height, -shift.x, -shift.y, frame.width, frame.height);
  else three.clearViewOffset();
  three.updateProjectionMatrix();
  const { xx, xy, yx, yy } = shear;
  if (xx !== 1 || xy !== 0 || yx !== 0 || yy !== 1) {
    // The shear in clip space about the principal point p: ndc' = p + S·(ndc − p), S the px shear with y flipped and
    // rescaled to ndc, laid on clip coordinates as S·clip + (I − S)·p·w.
    const sxy = (-xy * frame.height) / frame.width, syx = (-yx * frame.width) / frame.height;
    const px = (2 * shift.x) / frame.width, py = (-2 * shift.y) / frame.height;
    const tx = (1 - xx) * px - sxy * py, ty = -syx * px + (1 - yy) * py;
    three.projectionMatrix.premultiply(new Matrix4().set(xx, sxy, 0, tx, syx, yy, 0, ty, 0, 0, 1, 0, 0, 0, 0, 1));
    three.projectionMatrixInverse.copy(three.projectionMatrix).invert();
  }
  three.updateMatrixWorld();
  return three;
}
