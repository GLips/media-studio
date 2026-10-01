// painted-three-gpu.ts: a painted scene with three.js in it, on one GPU device (vid-129's round trip, as lib), which
// the scene makes (stamp paint's needs are the stricter) and lends to every stamp renderer and to three. Each frame:
// painted textures are drawn; each three layer is posed and rendered into its outside layer's texture
// (setXRRenderTargetTextures); then the painting is drawn, three's layers laid in its order, planes and layers seen
// through one camera step (paintCameraDepthLook). No frame reads an earlier one.
//
// Warning: error scopes are one stack per device. Every step pushes, works and pops before the next starts, loads run
// one after another, and frames go through one queue, which dispose drains before letting anything go.

import { HalfFloatType, PerspectiveCamera, RenderTarget, WebGPUBackend, WebGPURenderer, ExternalTexture, type Scene } from 'three/webgpu';
import type { FrameProfileStart } from '#lib/picture/profiling/studio/frame-profile.ts';
import { paintCameraPerspectiveAt, paintCameraWorld, paintWorldPlane, type PaintCameraWorld, type PaintWorldPlane } from '#lib/paint/animation/models/paint-camera-world.ts';
import {
  PAINT_CAMERA_REST, paintCameraDepthLook, paintCameraFrameStateAt, paintCameraViewAt, type PaintCamera, type PaintCameraPose,
} from '#lib/paint/animation/models/paint-camera.ts';
import type { StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { StampOutsideLayerSlot, StampOutsideLayerState } from '#lib/paint/painting/models/stamp-outside-layer.ts';
import type { StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { createStampPaintDevice } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import { createStampPaintRenderer } from '#lib/paint/painting/studio/stamp-paint-renderer.ts';
import { createStampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import { stampPaintAssetUrl } from '#lib/paint/style/studio/stamp-paint-styles.ts';

const GPU_ERROR_SCOPES = ['validation', 'out-of-memory', 'internal'] as const;
/** A three layer's multisampling: its edges antialiased, resolved the same each time (vid-129). */
const PAINTED_THREE_SAMPLES = 4;
/** The near and far planes, in depth units: a layer's content lies between, and a plane nearer the camera than near is cut. */
const PAINTED_THREE_DEPTH_RANGE = { near: 0.02, far: 200 };

/**
 * A painting drawn each frame into a texture three samples: a painting on a 3D object. `width` × `height` of its own
 * px; `frameAt`, its groups' state at scene time t (as painted when left out). A material reads it through
 * paintedThreeColorNode.
 */
export type PaintedThreeTexture = {
  id: string;
  painting: CompiledStampPaint;
  width: number;
  height: number;
  frameAt?: (t: number) => StampPaintFrameState;
};

/**
 * What a three layer's scene is built with: the world it shares with the planes, its own plane there (at the layer's
 * depth: place and size what it shows by it), and each painted texture by id.
 */
export type PaintedThreeLayerTools = { world: PaintCameraWorld; plane: PaintWorldPlane; textures: ReadonlyMap<string, ExternalTexture> };

/**
 * A three layer's scene, built once at load. `poseAt` poses it at scene time t and returns its content's key (the
 * camera's pose and painted textures aside). Warning: it must change whenever the render does, or a checkpoint past
 * the layer restores a stale frame; nothing checks it. Materials are opaque, or NormalBlending transparent: the
 * render stays premultiplied.
 */
export type PaintedThreeLayerScene = { scene: Scene; poseAt: (t: number) => string; dispose: () => void };

/**
 * A three.js layer in the painted scene: an outside layer (its `id`, and the group it lies `beneath`) whose scene
 * `build` makes, on a plane at `depth`, which the camera is built with (buildPaintCamera's outsideLayers) and shows as
 * a plane there. `stateAt`: its own visibility, defocus or glow at t, in anchor px, which the camera grows.
 */
export type PaintedThreeLayer = StampOutsideLayerSlot & {
  build: (tools: PaintedThreeLayerTools) => PaintedThreeLayerScene;
  depth: number;
  stateAt?: (t: number) => Omit<StampOutsideLayerState, 'content'>;
};

/** What a painted three scene draws: its painting, the stage, three's vertical fov at rest, its layers and textures. */
export type PaintedThreeSpec = {
  painting: CompiledStampPaint;
  stage: StampStage;
  fov: number;
  threeLayers: readonly PaintedThreeLayer[];
  paintedTextures: readonly PaintedThreeTexture[];
};

/**
 * One frame: scene time `t`, the painting's groups in `frame`'s state before the camera step, and the multiplane
 * `camera` the planes and three's layers are seen through (null for none: at rest, all sharp).
 */
export type PaintedThreeFrame = { t: number; frame?: StampPaintFrameState; camera: PaintCamera | null };

/** A loaded painted three scene: frames drawn one at a time in the order asked; dispose waits for the one in hand. */
export type PaintedThreeScene = { draw: (frame: PaintedThreeFrame) => Promise<void>; dispose: () => Promise<void> };

/** three's WebGPU backend with r186's setXRRenderTargetTextures, which registers a GPUTexture as a target's colour. */
type OwnColourBackend = WebGPUBackend & { setXRRenderTargetTextures: (target: RenderTarget, color: GPUTexture) => void };

/**
 * Whether `backend` can render into a texture it's given. setXRRenderTargetTextures was built for WebXR and
 * @types/three leaves it out, so it's checked at load: a three upgrade that drops it fails there, not in a frame.
 */
function isOwnColourBackend(backend: unknown): backend is OwnColourBackend {
  return backend instanceof WebGPUBackend && 'setXRRenderTargetTextures' in backend && typeof backend.setXRRenderTargetTextures === 'function';
}

function ownColourBackend(three: WebGPURenderer): OwnColourBackend {
  const { backend } = three;
  if (!isOwnColourBackend(backend)) throw new Error('painted three: this three.js has no WebGPU backend that renders into a texture it\'s given (setXRRenderTargetTextures)');
  return backend;
}

/** Runs `work` within error scopes on `device`, pushed and popped around it alone, and throws naming `what` on an error. */
async function checkedOnPaintedThreeDevice<T>(device: GPUDevice, what: string, work: () => Promise<T> | T): Promise<T> {
  for (const scope of GPU_ERROR_SCOPES) device.pushErrorScope(scope);
  // Every scope is popped before anything is thrown: one left pushed would swallow the next step's errors.
  const popped = () => Promise.all(GPU_ERROR_SCOPES.map(() => device.popErrorScope()));
  let result: T;
  try {
    result = await work();
  } catch (error) {
    await popped();
    throw error;
  }
  const error = (await popped()).find(Boolean);
  if (error) throw new Error(`painted three: ${what} failed: ${error.message}`);
  return result;
}

/** A three layer loaded: its scene, its camera, the render target writing into its outside texture. */
type LoadedThreeLayer = { layer: PaintedThreeLayer; built: PaintedThreeLayerScene; camera: PerspectiveCamera; target: RenderTarget; texture: GPUTexture };

/** Sets `camera` as the multiplane camera at `pose` shows `world`'s stage (paint-camera-world.ts). */
function setPaintedThreeCamera(camera: PerspectiveCamera, world: PaintCameraWorld, pose: PaintCameraPose) {
  const { position, rotationZ, fov, aspect } = paintCameraPerspectiveAt(world, pose);
  camera.position.set(position.x, position.y, position.z);
  camera.rotation.set(0, 0, rotationZ);
  camera.fov = fov;
  camera.aspect = aspect;
  camera.zoom = 1;
  camera.near = PAINTED_THREE_DEPTH_RANGE.near * world.depthUnit;
  camera.far = PAINTED_THREE_DEPTH_RANGE.far * world.depthUnit;
  camera.updateProjectionMatrix();
}

/** Times `work` under `label` when profiling, waiting for the GPU so the time is the drawing, not its queueing. */
async function timed<T>(profile: FrameProfileStart | null, device: GPUDevice, label: string, work: () => Promise<T>): Promise<T> {
  const stop = profile?.(label);
  const result = await work();
  if (stop) {
    await device.queue.onSubmittedWorkDone();
    stop();
  }
  return result;
}

/** `step` over `items` one after another, never two at once: the device has one error-scope stack. */
async function oneAfterAnother<T, R>(items: readonly T[], step: (item: T) => Promise<R> | R): Promise<R[]> {
  return items.reduce<Promise<R[]>>(async (before, item) => {
    const done = await before;
    return [...done, await step(item)];
  }, Promise.resolve([]));
}

/** Loads `spec` to draw onto `canvas` (the frame's size), its parts made one after another on one device. */
export async function loadPaintedThreeScene(canvas: HTMLCanvasElement, spec: PaintedThreeSpec, profile: FrameProfileStart | null): Promise<PaintedThreeScene> {
  const { stage, threeLayers, paintedTextures } = spec;
  const device = await createStampPaintDevice();
  // Everything lent the device, in the order made; let go of the last made first, before the device is destroyed.
  const made: { dispose: () => void | Promise<void> }[] = [];
  // Our textures go after everything that may still hold them (three's targets and ExternalTextures among them).
  const owned: GPUTexture[] = [];
  const release = async () => {
    await oneAfterAnother(made.splice(0).toReversed(), (thing) => thing.dispose());
    for (const texture of owned.splice(0)) texture.destroy();
    device.destroy();
  };
  try {
    const ownTexture = (width: number, height: number) => {
      const texture = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      owned.push(texture);
      return texture;
    };
    const painted = await timed(profile, device, 'painted textures load', () => oneAfterAnother(paintedTextures, async (texture) => {
      const frame = ownTexture(texture.width, texture.height);
      const surface = await createStampPaintSurface({ device, frame }, stampPaintAssetUrl);
      made.push(surface);
      const renderer = await createStampPaintRenderer(surface, texture.painting, { profile });
      made.push(renderer);
      return { texture, renderer, frame };
    }));

    const world = paintCameraWorld(stage, { fov: spec.fov });
    const { width: stageWidth, height: stageHeight } = stage;
    const { three, layers } = await timed(profile, device, 'three load', () => checkedOnPaintedThreeDevice(device, 'loading three.js and its layers', async () => {
      const renderer = new WebGPURenderer({ device, antialias: false, alpha: true });
      made.push(renderer);
      await renderer.init();
      renderer.setClearColor(0x000000, 0);
      const backend = ownColourBackend(renderer);
      // Made after three's renderer, so let go of before it: an ExternalTexture's dispose tells its renderer.
      const textures = new Map(painted.map(({ texture, frame }) => {
        const external = new ExternalTexture(frame);
        made.push(external);
        return [texture.id, external] as const;
      }));
      const loaded = await oneAfterAnother(threeLayers, async (layer): Promise<LoadedThreeLayer> => {
        const built = layer.build({ world, plane: paintWorldPlane(world, layer.depth), textures });
        made.push(built);
        const camera = new PerspectiveCamera();
        setPaintedThreeCamera(camera, world, PAINT_CAMERA_REST);
        const texture = ownTexture(stageWidth, stageHeight);
        const target = new RenderTarget(stageWidth, stageHeight, { type: HalfFloatType, depthBuffer: true, samples: PAINTED_THREE_SAMPLES });
        made.push(target);
        // three renders into our texture, where the stamp renderer reads it: three's own target texture would be
        // reachable only through its backend's private map, and recreated on a resize.
        backend.setXRRenderTargetTextures(target, texture);
        renderer.setRenderTarget(target);
        await renderer.compileAsync(built.scene, camera);
        renderer.setRenderTarget(null);
        return { layer, built, camera, target, texture };
      });
      return { three: renderer, layers: loaded };
    }));

    const main = await timed(profile, device, 'stamp paint load', async () => {
      const surface = await createStampPaintSurface({ canvas, width: stage.frame.width, height: stage.frame.height, device }, stampPaintAssetUrl);
      made.push(surface);
      const renderer = await createStampPaintRenderer(surface, spec.painting, {
        profile, stage, outsideLayers: layers.map(({ layer: { id, beneath }, texture }) => ({ id, beneath, texture })),
      });
      made.push(renderer);
      return renderer;
    });

    const drawFrame = async ({ t, frame, camera }: PaintedThreeFrame) => {
      const view = camera && paintCameraViewAt(camera, t), pose: PaintCameraPose = view?.pose ?? PAINT_CAMERA_REST;
      await timed(profile, device, 'painted textures', async () => {
        await oneAfterAnother(painted, ({ texture, renderer }) => renderer.draw({ t, state: texture.frameAt?.(t) }));
      });
      // The painted textures' paint changes with t: a layer that reads one is keyed by it.
      const paintedKey = painted.length ? `|painted@${t}` : '';
      const outside = await timed(profile, device, 'three render', async () => new Map(await oneAfterAnother(layers, async ({ layer, built, camera: threeCamera, target }) => {
        const content = `${built.poseAt(t)}|camera ${JSON.stringify(pose)}${paintedKey}`;
        setPaintedThreeCamera(threeCamera, world, pose);
        await checkedOnPaintedThreeDevice(device, `three.js rendering layer ${layer.id}`, () => {
          three.setRenderTarget(target);
          three.render(built.scene, threeCamera);
          three.setRenderTarget(null);
        });
        const { defocus: ownDefocus = 0, glow: ownGlow, ...own } = layer.stateAt?.(t) ?? {};
        const { defocus, glow } = view ? paintCameraDepthLook(view, `3D layer ${layer.id}`, layer.depth, { defocus: ownDefocus, glow: ownGlow }) : { defocus: ownDefocus, glow: ownGlow };
        const state: StampOutsideLayerState = { ...own, ...(defocus > 0 && { defocus }), ...(glow && { glow }), content };
        return [layer.id, state] as const;
      })));
      const state = camera ? paintCameraFrameStateAt(camera, frame ?? new Map(), t) : frame;
      await timed(profile, device, 'stamp paint', () => main.draw({ t, state, outside }));
    };

    let frames = Promise.resolve(), closed = false;
    return {
      draw: (frame) => {
        const drawn = frames.then(() => (closed ? undefined : drawFrame(frame)));
        // A failed frame fails its own render; the next waits only for it to settle.
        frames = drawn.catch(() => {});
        return drawn;
      },
      dispose: async () => {
        closed = true;
        await frames;
        await release();
      },
    };
  } catch (error) {
    await release();
    throw error;
  }
}
