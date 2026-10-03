// lens-three-motion.ts: a three.js render's motion layer (lens-passes.ts), drawn beside its colour through setMRT:
// each fragment's motion over the shutter in frame px, its distance, and its cover. Where the shutter opens and closes,
// every object's world matrix and the camera are recorded, and a fragment's point is projected through both.
//
// A geometry whose vertices move of themselves (a posed mesh: positions written each moment) brings its own open and
// close positions: it holds LENS_THREE_OPEN_POSITION and LENS_THREE_CLOSE_POSITION beside `position`, and `record`
// copies its posed positions into them. Negative space: three's own skinning, morphs and instance matrices aren't
// read, so a mesh deformed by those moves with its object alone.

import { BufferAttribute, Matrix4, type BufferGeometry, type Camera, type NodeBuilder, type Object3D, type Scene } from 'three/webgpu';
import { attribute, Fn, mrt, output, positionLocal, positionView, uniform, varying, vec2, vec4 } from 'three/tsl';
import { isThreeGeometryDrawable } from '#lib/platform/gpu/studio/studio-three-renderer.ts';

/** The name a target's motion attachment takes (targetInto), the colour's being 'output'. */
export const LENS_THREE_MOTION_NAME = 'lensMotion';

/** The attributes a self-moving geometry keeps its positions in as the shutter opens and closes. */
export const LENS_THREE_OPEN_POSITION = 'lensOpenPosition';
export const LENS_THREE_CLOSE_POSITION = 'lensClosePosition';

/**
 * Makes `geometry` one that moves of itself: open and close positions beside its `position`, the same size, which
 * `record` fills. Call it again after replacing `position` with one of another size.
 */
export function lensThreeMovesOfItself(geometry: BufferGeometry): void {
  const { array, itemSize } = geometry.getAttribute('position');
  for (const name of [LENS_THREE_OPEN_POSITION, LENS_THREE_CLOSE_POSITION]) {
    if (geometry.getAttribute(name)?.array.length !== array.length) geometry.setAttribute(name, new BufferAttribute(new Float32Array(array), itemSize));
  }
}

export type LensThreeMotion = {
  /** The MRT node to set on the renderer while rendering into a target with a LENS_THREE_MOTION_NAME attachment. */
  mrt: ReturnType<typeof mrt>;
  /**
   * Records where `scene`'s objects and `camera` are (their world matrices updated), and a self-moving geometry's
   * posed positions, as the shutter opens or closes.
   */
  record: (moment: 'open' | 'close', scene: Scene, camera: Camera) => void;
  /**
   * Once both are recorded: whether anything in `scene` or its camera moved between them. If nothing did, its motion
   * is still, as `still` leaves it.
   */
  moved: (scene: Scene) => boolean;
  /** Forgets the records: every fragment's motion is 0, as a frame with its shutter shut. */
  still: () => void;
};

/** `object`'s geometry when it moves of itself, else null. */
function selfMoving(object: Object3D): BufferGeometry | null {
  return isThreeGeometryDrawable(object) && object.geometry.getAttribute(LENS_THREE_OPEN_POSITION) ? object.geometry : null;
}

/** Whether two attributes hold the same numbers. */
function sameArrays(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Each object's local point at a moment: a self-moving geometry's own (its attribute `name`), else where it is now. */
const lensThreeLocalAt = (name: string) => Fn(({ geometry }: NodeBuilder) => (geometry?.getAttribute(name) ? attribute(name, 'vec3') : positionLocal))();

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
  const opened = varying(openView.mul(openWorld).mul(vec4(lensThreeLocalAt(LENS_THREE_OPEN_POSITION), 1))), closed = varying(closeView.mul(closeWorld).mul(vec4(lensThreeLocalAt(LENS_THREE_CLOSE_POSITION), 1)));
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
        const geometry = selfMoving(object);
        if (!geometry) return;
        const into = geometry.getAttribute(moment === 'open' ? LENS_THREE_OPEN_POSITION : LENS_THREE_CLOSE_POSITION), { array } = geometry.getAttribute('position');
        if (into.array.length !== array.length) throw new Error(`lens motion: a self-moving geometry's position holds ${array.length} numbers and its ${moment} position ${into.array.length}; call lensThreeMovesOfItself after resizing it`);
        // SAFETY: lensThreeMovesOfItself made both moments' attributes Float32Arrays, and the size was checked above.
        (into.array as Float32Array).set(array);
        into.needsUpdate = true;
      });
      (moment === 'open' ? openView : closeView).value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      moving.value = 1;
    },
    moved: (scene) => {
      let any = !openView.value.equals(closeView.value);
      scene.traverse((object) => {
        any ||= !opens.get(object)!.equals(closes.get(object)!);
        const geometry = selfMoving(object);
        if (geometry) any ||= !sameArrays(geometry.getAttribute(LENS_THREE_OPEN_POSITION).array, geometry.getAttribute(LENS_THREE_CLOSE_POSITION).array);
      });
      if (!any) moving.value = 0;
      return any;
    },
    still: () => {
      moving.value = 0;
    },
  };
}
