// painted-three-sources.ts: three.js in a painted scene, on the device its stamp renderer draws on and that device's
// one three.js renderer (gpu-device-owner.ts). Each three source is a plane of the scene's camera and a lens source of
// the renderer's (stamp-lens-source.ts): its scene is rendered through the camera's shot camera (paint-camera-world.ts)
// into a texture of ours, the frame grown by the plane's defocus margin. Painted textures, paintings a material reads,
// are drawn first, once a frame.
//
// Texture contracts: a source's texture is rgba16float premultiplied linear colour (normal blending over a clear
// target premultiplies), its motion texture the lens's motion layer (lens-three-motion.ts); a painted texture is
// rgba16float, gamma-encoded and opaque, decoded by paintedThreeColorNode.

import { ExternalTexture, PerspectiveCamera, type Scene } from 'three/webgpu';
import type { FrameProfileStart } from '#lib/picture/profiling/studio/frame-profile.ts';
import { shotCameraGrown, type ShotCamera } from '#lib/picture/shot-camera/models/shot-camera.ts';
import { shotCameraExposed, shotLensOfFocus } from '#lib/picture/lens/models/lens-focus.ts';
import { shutterOpensAt } from '#lib/picture/lens/models/lens-shutter.ts';
import { createLensThreeMotion, LENS_THREE_MOTION_NAME } from '#lib/picture/lens/studio/lens-three-motion.ts';
import { setThreeShotCamera } from '#lib/picture/shot-camera/studio/three-shot-camera.ts';
import { paintCameraShotAt, paintCameraWorld, paintWorldPlane, type PaintCameraWorld, type PaintWorldPlane } from '#lib/paint/animation/models/paint-camera-world.ts';
import { PAINT_CAMERA_REST, paintCameraFocusAt, paintCameraPoseAt, type PaintCamera } from '#lib/paint/animation/models/paint-camera.ts';
import { paintMoment, type StampPaintFrameAt } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampLensSource, StampLensSourceExposure } from '#lib/paint/painting/studio/stamp-lens-source.ts';
import type { CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { createStampPaintRenderer, type StampPaintRenderer } from '#lib/paint/painting/studio/stamp-paint-renderer.ts';
import { createStampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';

/** A source's multisampling: its edges antialiased, resolved the same each time (vid-129). */
const PAINTED_THREE_SAMPLES = 4;

/**
 * A painting drawn each frame into a texture three samples: a painting on a 3D object. `width` × `height` of its own
 * px; `frameAt`, its groups' state at a frame's moment (as painted when left out), held through the frame's shutter.
 * A material reads it through paintedThreeColorNode.
 */
export type PaintedThreeTexture = {
  id: string;
  painting: CompiledStampPaint;
  width: number;
  height: number;
  frameAt?: StampPaintFrameAt;
};

/**
 * What a source's scene is built with: the world it shares with the planes, its own plane there (at its depth: place
 * and size what it shows by it), and each painted texture by id.
 */
export type PaintedThreeSourceTools = { world: PaintCameraWorld; plane: PaintWorldPlane; textures: ReadonlyMap<string, ExternalTexture> };

/**
 * A source's scene, built once at load; `poseAt` poses it at scene time t. Materials are opaque, or NormalBlending
 * transparent: the render stays premultiplied.
 */
export type PaintedThreeSourceScene = { scene: Scene; poseAt: (t: number) => void; dispose: () => void };

/** A three plane's source: `id` the plane's in the camera, `build` its scene. */
export type PaintedThreeSource = { id: string; build: (tools: PaintedThreeSourceTools) => PaintedThreeSourceScene };

/** What a painted scene renders with three.js: a source for each of its camera's three planes, and the painted textures they read. */
export type PaintedThree = { sources: readonly PaintedThreeSource[]; paintedTextures?: readonly PaintedThreeTexture[] };

/** three.js loaded on an owner's device: a lens source for each three plane, by its id. */
export type PaintedThreeLoaded = {
  sources: ReadonlyMap<string, StampLensSource>;
  /** Lets go of everything it made; the owner stays. */
  dispose: () => void;
};

/** `step` over `items` one after another: each load awaits, and the device's asynchronous checks run one at a time. */
async function oneAfterAnother<T, R>(items: readonly T[], step: (item: T) => Promise<R>): Promise<R[]> {
  return items.reduce<Promise<R[]>>(async (before, item) => [...await before, await step(item)], Promise.resolve([]));
}

/**
 * Loads `three` on `owner`'s device for `camera`'s three planes, a source for each and none else. Refuses a source
 * with no three plane in the camera, and a three plane with no source.
 */
export async function loadPaintedThree(owner: StampPaintGpuOwner, camera: PaintCamera, three: PaintedThree, profile: FrameProfileStart | null): Promise<PaintedThreeLoaded> {
  const threePlanes = new Map(camera.planes.flatMap((plane) => (plane.kind === 'three' ? [[plane.id, plane] as const] : [])));
  const sourced = three.sources.map((source) => {
    const plane = threePlanes.get(source.id);
    if (!plane) throw new Error(`painted three: source ${source.id} isn't a three plane of the camera`);
    return { source, plane };
  });
  const ids = new Set(three.sources.map(({ id }) => id));
  for (const id of threePlanes.keys()) if (!ids.has(id)) throw new Error(`painted three: the camera's three plane ${id} has no source`);

  const { webgpu } = owner, { frame } = camera.stage;
  // Everything made, let go of last made first; our textures after all that may still hold them.
  const made: { dispose: () => void }[] = [], owned: GPUTexture[] = [];
  const release = () => {
    for (const thing of made.splice(0).toReversed()) thing.dispose();
    for (const texture of owned.splice(0)) texture.destroy();
  };
  const ownTexture = (width: number, height: number) => {
    const texture = webgpu.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    owned.push(texture);
    return texture;
  };
  try {
    const painted = await oneAfterAnother(three.paintedTextures ?? [], async (texture): Promise<{ texture: PaintedThreeTexture; renderer: StampPaintRenderer; frame: GPUTexture }> => {
      const target = ownTexture(texture.width, texture.height);
      const surface = await createStampPaintSurface(owner, { frame: target });
      made.push(surface);
      const renderer = await createStampPaintRenderer(surface, texture.painting, { profile });
      made.push(renderer);
      return { texture, renderer, frame: target };
    });

    const world = paintCameraWorld(camera.stage, { fov: camera.fov });
    // Asked for outside the load's check: the owner makes its renderer in an asynchronous check of its own.
    const { renderer, targetInto } = await owner.three();
    const loaded = await owner.checkedAsync('loading three.js sources', async () => {
      // Made after three's renderer, so let go of before it: an ExternalTexture's dispose tells its renderer.
      const textures = new Map(painted.map(({ texture, frame: paintedFrame }) => {
        const external = new ExternalTexture(paintedFrame);
        made.push(external);
        return [texture.id, external] as const;
      }));
      return oneAfterAnother(sourced, async ({ source, plane: { depth, margin } }) => {
        const built = source.build({ world, plane: paintWorldPlane(world, depth), textures });
        made.push(built);
        // The frame grown on every side by the plane's margin, so its defocus has what lies past the frame's edge.
        const shotAt = (pose: Parameters<typeof paintCameraShotAt>[1]) => shotCameraGrown(paintCameraShotAt(world, pose), margin);
        const threeCamera = setThreeShotCamera(new PerspectiveCamera(), shotAt(PAINT_CAMERA_REST));
        const w = frame.width + 2 * margin, h = frame.height + 2 * margin;
        const texture = ownTexture(w, h), motionTexture = ownTexture(w, h);
        // three renders into our textures, where the stamp renderer reads them.
        const target = targetInto([{ name: 'output', texture }, { name: LENS_THREE_MOTION_NAME, texture: motionTexture }], { samples: PAINTED_THREE_SAMPLES });
        made.push(target);
        const motion = createLensThreeMotion({ width: w, height: h, distanceUnit: world.depthUnit });
        renderer.setRenderTarget(target);
        renderer.setMRT(motion.mrt);
        await renderer.compileAsync(built.scene, threeCamera);
        renderer.setMRT(null);
        renderer.setRenderTarget(null);
        return { id: source.id, built, shotAt, camera: threeCamera, target, motion, picture: { texture, motion: motionTexture, at: { x: -margin, y: -margin } } };
      });
    });

    // The frame time the painted textures were last drawn for: they're held through a frame, so drawn once for all its sources and exposures.
    let paintedFor: number | null = null;
    const render = async ({ built, shotAt, camera: threeCamera, target, motion }: (typeof loaded)[number], t: number, exposure: StampLensSourceExposure | null) => {
      if (paintedFor !== t) {
        await Promise.all(painted.map(({ texture, renderer: paintedRenderer }) => paintedRenderer.draw({ kind: 'once', t, state: texture.frameAt?.(paintMoment(t)) })));
        paintedFor = t;
      }
      const at = exposure?.at ?? t, pose = paintCameraPoseAt(camera, paintMoment(at, t)), focus = exposure && paintCameraFocusAt(camera, paintMoment(at, t));
      // The exposure's camera: moved over the aperture by the world size of the paint camera's (frame px) opening.
      const seen = (shot: ShotCamera) => {
        if (!exposure) return shot;
        const distance = focus && focus.focus - pose.dolly;
        const lens = focus && distance ? shotLensOfFocus(shot, { focus: distance, aperture: focus.aperture }, distance * world.depthUnit) : null;
        return shotCameraExposed(shot, lens, { aperture: exposure.aperture, pixel: [0, 0] });
      };
      // A fast frame's motion over the camera's shutter, centred on t; a reference exposure's is its own exposure.
      const shutter = exposure ? 0 : camera.lens.shutter, opens = shutterOpensAt(t, shutter);
      return owner.checked(`three.js rendering a source at ${at} s`, () => {
        motion.still();
        let moved = false;
        if (shutter > 0) {
          for (const [moment, when] of [['open', opens], ['close', opens + shutter]] as const) {
            built.poseAt(when);
            setThreeShotCamera(threeCamera, shotAt(paintCameraPoseAt(camera, paintMoment(when, t))));
            motion.record(moment, built.scene, threeCamera);
          }
          moved = motion.moved(built.scene);
        }
        built.poseAt(at);
        setThreeShotCamera(threeCamera, seen(shotAt(pose)));
        renderer.setMRT(motion.mrt);
        renderer.setRenderTarget(target);
        renderer.render(built.scene, threeCamera);
        renderer.setMRT(null);
        renderer.setRenderTarget(null);
        return { moved };
      });
    };
    return {
      sources: new Map(loaded.map((source) => [source.id, { picture: source.picture, render: (t, exposure) => render(source, t, exposure) }])),
      dispose: release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
