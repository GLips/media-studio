// lens-three-motion.ts: a three.js render's motion layer (lens-passes.ts), drawn beside its colour through setMRT:
// each fragment's motion over the shutter in frame px, its distance, and its cover. Where the shutter opens and closes,
// every object's world matrix and the camera are recorded, and a fragment's point is projected through both.
//
// Negative space: an object's motion is rigid, its matrices' alone. A skinned or morphed vertex moves with its
// object, not its bones, and an InstancedMesh's instances with the mesh, not their instance matrices: a deforming or
// instanced source (vid-150) brings its own open and close positions.

import { Matrix4, type Camera, type Object3D, type Scene } from 'three/webgpu';
import { mrt, output, positionLocal, positionView, uniform, varying, vec2, vec4 } from 'three/tsl';

/** The name a target's motion attachment takes (targetInto), the colour's being 'output'. */
export const LENS_THREE_MOTION_NAME = 'lensMotion';

export type LensThreeMotion = {
  /** The MRT node to set on the renderer while rendering into a target with a LENS_THREE_MOTION_NAME attachment. */
  mrt: ReturnType<typeof mrt>;
  /** Records where `scene`'s objects and `camera` are (their world matrices updated) as the shutter opens or closes. */
  record: (moment: 'open' | 'close', scene: Scene, camera: Camera) => void;
  /**
   * Once both are recorded: whether anything in `scene` or its camera moved between them. If nothing did, its motion
   * is still, as `still` leaves it.
   */
  moved: (scene: Scene) => boolean;
  /** Forgets the records: every fragment's motion is 0, as a frame with its shutter shut. */
  still: () => void;
};

/**
 * A motion layer for a target `width` × `height` px, its distances camera depth over `distanceUnit` (a painted scene's
 * depth unit, so they compare with its planes'). Its node premultiplies by cover through the material's own blending:
 * an opaque fragment writes cover 1, a NormalBlending one its alpha, which scales what it writes.
 */
export function createLensThreeMotion({ width, height, distanceUnit }: { width: number; height: number; distanceUnit: number }): LensThreeMotion {
  const opens = new WeakMap<Object3D, Matrix4>(), closes = new WeakMap<Object3D, Matrix4>();
  const openView = uniform(new Matrix4()), closeView = uniform(new Matrix4()), moving = uniform(0);
  const openWorld = uniform(new Matrix4()).onObjectUpdate(({ object }) => (object && opens.get(object)) ?? object?.matrixWorld);
  const closeWorld = uniform(new Matrix4()).onObjectUpdate(({ object }) => (object && closes.get(object)) ?? object?.matrixWorld);
  const point = vec4(positionLocal, 1);
  const opened = varying(openView.mul(openWorld).mul(point)), closed = varying(closeView.mul(closeWorld).mul(point));
  // Clip space to frame px: x right, y down.
  const px = vec2(width / 2, -height / 2);
  const travel = closed.xy.div(closed.w).sub(opened.xy.div(opened.w)).mul(px).mul(moving);
  const distance = positionView.z.negate().div(distanceUnit);
  const node = mrt({ output, [LENS_THREE_MOTION_NAME]: vec4(travel, distance, output.a) });
  return {
    mrt: node,
    record: (moment, scene, camera) => {
      const kept = moment === 'open' ? opens : closes;
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      scene.traverse((object) => {
        const had = kept.get(object);
        if (had) had.copy(object.matrixWorld);
        else kept.set(object, object.matrixWorld.clone());
      });
      (moment === 'open' ? openView : closeView).value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      moving.value = 1;
    },
    moved: (scene) => {
      let any = !openView.value.equals(closeView.value);
      scene.traverse((object) => {
        any ||= !opens.get(object)!.equals(closes.get(object)!);
      });
      if (!any) moving.value = 0;
      return any;
    },
    still: () => {
      moving.value = 0;
    },
  };
}
