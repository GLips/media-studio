// lens-three-motion.ts: a three.js render's motion layer (lens-passes.ts), drawn beside its colour through setMRT:
// each fragment's motion over the shutter in frame px, its distance, and its cover. Where the shutter opens and closes,
// every object's world matrix and the camera are recorded, and a fragment's point is projected through both.
//
// A geometry whose vertices move of themselves (a posed mesh: positions written each moment) is made by
// createLensThreeSelfMovingGeometry, which keeps open and close positions beside `position`, always its size; `record`
// copies the posed positions into them. Negative space: three's own skinning, morphs and instance matrices aren't
// read, so a mesh deformed by those moves with its object alone.

import { BufferAttribute, BufferGeometry, Matrix4, type Camera, type NodeBuilder, type Object3D, type Scene } from 'three/webgpu';
import { attribute, Fn, mrt, output, positionLocal, positionView, uniform, varying, vec2, vec4 } from 'three/tsl';
import { isThreeGeometryDrawable } from '#lib/platform/gpu/studio/studio-three-renderer.ts';

/** The name a target's motion attachment takes (targetInto), the colour's being 'output'. */
export const LENS_THREE_MOTION_NAME = 'lensMotion';

/** The attributes a self-moving geometry keeps its positions in as the shutter opens and closes. */
const LENS_THREE_OPEN_POSITION = 'lensOpenPosition';
const LENS_THREE_CLOSE_POSITION = 'lensClosePosition';

/** A position attribute and its array, held as the Float32Array it was made with. */
type Positions = { readonly attribute: BufferAttribute; readonly array: Float32Array };
const positionsOf = (count: number): Positions => {
  const array = new Float32Array(count * 3);
  return { attribute: new BufferAttribute(array, 3), array };
};
/** Each self-moving geometry's three position attributes, by geometry: the only way to make one. */
const selfMovingPositions = new WeakMap<BufferGeometry, { now: Positions; open: Positions; close: Positions }>();

/** A geometry whose vertices move of themselves, and `positions`, its posed points' array (x, y, z each) to write. */
export type LensThreeSelfMovingGeometry = { readonly geometry: BufferGeometry; readonly positions: (count: number) => Float32Array };

/**
 * A geometry that moves of itself: `positions(count)` hands back its `position` array for `count` vertices, its open
 * and close positions (which `record` fills) remade with it when the count changes, the old buffers let go.
 */
export function createLensThreeSelfMovingGeometry(): LensThreeSelfMovingGeometry {
  const geometry = new BufferGeometry();
  return {
    geometry,
    positions: (count) => {
      const held = selfMovingPositions.get(geometry);
      if (held?.now.attribute.count === count) return held.now.array;
      // Disposing frees every attribute's GPU buffer; three makes them again on the next draw.
      if (held) geometry.dispose();
      const made = { now: positionsOf(count), open: positionsOf(count), close: positionsOf(count) };
      geometry.setAttribute('position', made.now.attribute);
      geometry.setAttribute(LENS_THREE_OPEN_POSITION, made.open.attribute);
      geometry.setAttribute(LENS_THREE_CLOSE_POSITION, made.close.attribute);
      selfMovingPositions.set(geometry, made);
      return made.now.array;
    },
  };
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

/** `object`'s geometry's positions when it moves of itself, else undefined. */
const selfMoving = (object: Object3D) => (isThreeGeometryDrawable(object) ? selfMovingPositions.get(object.geometry) : undefined);

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
        const positions = selfMoving(object);
        if (!positions) return;
        const into = moment === 'open' ? positions.open : positions.close;
        into.array.set(positions.now.array);
        into.attribute.needsUpdate = true;
      });
      (moment === 'open' ? openView : closeView).value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      moving.value = 1;
    },
    moved: (scene) => {
      let any = !openView.value.equals(closeView.value);
      scene.traverse((object) => {
        any ||= !opens.get(object)!.equals(closes.get(object)!);
        const positions = selfMoving(object);
        if (positions) any ||= !sameArrays(positions.open.array, positions.close.array);
      });
      if (!any) moving.value = 0;
      return any;
    },
    still: () => {
      moving.value = 0;
    },
  };
}
