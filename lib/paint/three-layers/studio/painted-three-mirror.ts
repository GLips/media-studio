// painted-three-mirror.ts: a planar mirror's camera for a three source's offscreen pass (PaintedThreeSourceScene's
// `offscreen`, handed the exposure's camera), so a reflection follows a moving shot and the lens's aperture.
//
// The mirror image of a camera is turned inside out, which would cull every face three draws as front. This camera
// is the mirror image flipped back across its own x, a proper camera; its picture is the reflection flipped across x,
// so a material reads it at `screenUV.flipX()`. Its projection is flipped likewise, so a shifted lens stays registered.

import { Matrix4, Vector4, WebGPUCoordinateSystem, type PerspectiveCamera, type Plane } from 'three/webgpu';

/** x negated: in the camera's view space on the right, in clip space on the left. */
const PAINTED_THREE_FLIP_X = new Matrix4().makeScale(-1, 1, 1);

/**
 * Sets `into` to see what `seen` sees in a mirror lying on `mirror` (a world plane, its normal toward what it
 * reflects), clipped at the mirror so nothing behind it shows: read its picture at `screenUV.flipX()` in a render
 * through `seen`, at the size `seen` renders. Set `into` after `seen` is, each render. `into` has no parent.
 */
export function paintedThreeMirrorCamera(seen: PerspectiveCamera, mirror: Plane, into: PerspectiveCamera): PerspectiveCamera {
  const { normal: n, constant: c } = mirror;
  // The reflection across n · x + c = 0, row by row.
  const reflection = new Matrix4().set(
    1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.z, -2 * c * n.x,
    -2 * n.y * n.x, 1 - 2 * n.y * n.y, -2 * n.y * n.z, -2 * c * n.y,
    -2 * n.z * n.x, -2 * n.z * n.y, 1 - 2 * n.z * n.z, -2 * c * n.z,
    0, 0, 0, 1,
  );
  reflection.multiply(seen.matrixWorld).multiply(PAINTED_THREE_FLIP_X).decompose(into.position, into.quaternion, into.scale);
  // Set before the projection: three remakes the projection of a camera set for another system.
  into.coordinateSystem = WebGPUCoordinateSystem;
  into.near = seen.near;
  into.far = seen.far;
  into.updateMatrixWorld();
  const projection = into.projectionMatrix.copy(PAINTED_THREE_FLIP_X).multiply(seen.projectionMatrix).multiply(PAINTED_THREE_FLIP_X);

  // The near plane moved onto the mirror (Lengyel's oblique clip, as three's ReflectorNode moves it, depth 0..1).
  const onMirror = mirror.clone().applyMatrix4(into.matrixWorldInverse);
  const clip = new Vector4(onMirror.normal.x, onMirror.normal.y, onMirror.normal.z, onMirror.constant), p = projection.elements;
  const corner = new Vector4((Math.sign(clip.x) + p[8]) / p[0], (Math.sign(clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
  clip.multiplyScalar(1 / clip.dot(corner));
  [p[2], p[6], p[10], p[14]] = [clip.x, clip.y, clip.z, clip.w];
  into.projectionMatrixInverse.copy(projection).invert();
  return into;
}
