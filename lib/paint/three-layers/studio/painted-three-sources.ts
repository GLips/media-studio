// painted-three-sources.ts: three.js in a painted scene, on the device its stamp renderer draws on (one owner,
// stamp-paint-gpu-owner.ts). Each three source is a plane of the scene's camera: its scene is rendered through the
// camera's perspective (paint-camera-world.ts) into a frame-sized texture of ours, which the stamp renderer lays among
// the painted planes. Painted textures, paintings a material reads, are drawn first, each frame.
//
// Texture contracts: a source's texture is rgba16float, premultiplied linear colour (three renders a target in linear
// light, and its normal blending over a clear target leaves colour premultiplied); a painted texture is rgba16float,
// gamma-encoded and opaque, as a screen shows it, decoded by paintedThreeColorNode.

import { HalfFloatType, PerspectiveCamera, RenderTarget, WebGPUBackend, WebGPURenderer, ExternalTexture, type Scene } from 'three/webgpu';
import type { FrameProfileStart } from '#lib/picture/profiling/studio/frame-profile.ts';
import { paintCameraPerspectiveAt, paintCameraWorld, paintWorldPlane, type PaintCameraWorld, type PaintWorldPlane } from '#lib/paint/animation/models/paint-camera-world.ts';
import { PAINT_CAMERA_REST, paintCameraPoseAt, type PaintCamera, type PaintCameraPose } from '#lib/paint/animation/models/paint-camera.ts';
import type { StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { createStampPaintRenderer, type StampPaintRenderer } from '#lib/paint/painting/studio/stamp-paint-renderer.ts';
import { createStampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';

/** A source's multisampling: its edges antialiased, resolved the same each time (vid-129). */
const PAINTED_THREE_SAMPLES = 4;
/** The near and far planes, in depth units: a source's content lies between, and anything nearer the camera than near is cut. */
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

/** three.js loaded on an owner's device: each source's texture by its plane's id, rendered for a frame by `render`. */
export type PaintedThreeLoaded = {
  textures: ReadonlyMap<string, GPUTexture>;
  /**
   * Draws the painted textures and renders each source at scene time `t`, through the camera there. Warning: one at a
   * time, each settled before the next and before dispose: every render writes the same textures the stamp draw reads.
   */
  render: (t: number) => Promise<void>;
  /** Lets go of everything it made; the owner stays. */
  dispose: () => void;
};

/** three's WebGPU backend with r186's setXRRenderTargetTextures, which registers a GPUTexture as a target's colour. */
type OwnColourBackend = WebGPUBackend & { setXRRenderTargetTextures: (target: RenderTarget, color: GPUTexture) => void };

/**
 * Whether `backend` can render into a texture it's given. setXRRenderTargetTextures was built for WebXR and
 * @types/three leaves it out, so it's checked at load: a three upgrade that drops it fails there, not in a frame.
 */
function isOwnColourBackend(backend: unknown): backend is OwnColourBackend {
  return backend instanceof WebGPUBackend && 'setXRRenderTargetTextures' in backend && typeof backend.setXRRenderTargetTextures === 'function';
}

/** Sets `camera` as the paint camera at `pose` shows `world`'s frame (paint-camera-world.ts). */
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

/** `step` over `items` one after another: each load awaits, and the device's asynchronous checks run one at a time. */
async function oneAfterAnother<T, R>(items: readonly T[], step: (item: T) => Promise<R>): Promise<R[]> {
  return items.reduce<Promise<R[]>>(async (before, item) => [...await before, await step(item)], Promise.resolve([]));
}

/**
 * Loads `three` on `owner`'s device for `camera`'s three planes, a source for each and none else. Refuses a source
 * with no three plane in the camera, and a three plane with no source.
 */
export async function loadPaintedThree(owner: StampPaintGpuOwner, camera: PaintCamera, three: PaintedThree, profile: FrameProfileStart | null): Promise<PaintedThreeLoaded> {
  const depths = new Map(camera.planes.nearer.flatMap((plane) => (plane.kind === 'three' ? [[plane.id, plane.depth] as const] : [])));
  const ids = new Set(three.sources.map(({ id }) => id));
  for (const id of ids) if (!depths.has(id)) throw new Error(`painted three: source ${id} isn't a three plane of the camera`);
  for (const id of depths.keys()) if (!ids.has(id)) throw new Error(`painted three: the camera's three plane ${id} has no source`);

  const { webgpu } = owner, { frame } = camera.stage;
  // Everything made, let go of last made first; our textures after all that may still hold them.
  const made: { dispose: () => void }[] = [], owned: GPUTexture[] = [];
  const release = () => {
    for (const thing of made.splice(0).toReversed()) thing.dispose();
    for (const texture of owned.splice(0)) texture.destroy();
  };
  const ownTexture = (width: number, height: number) => {
    const texture = webgpu.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
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
    const loaded = await owner.checkedAsync('loading three.js and its sources', async () => {
      const renderer = new WebGPURenderer({ device: webgpu, antialias: false, alpha: true });
      made.push(renderer);
      await renderer.init();
      renderer.setClearColor(0x000000, 0);
      const { backend } = renderer;
      if (!isOwnColourBackend(backend)) throw new Error('painted three: this three.js has no WebGPU backend that renders into a texture it\'s given (setXRRenderTargetTextures)');
      // Made after three's renderer, so let go of before it: an ExternalTexture's dispose tells its renderer.
      const textures = new Map(painted.map(({ texture, frame: paintedFrame }) => {
        const external = new ExternalTexture(paintedFrame);
        made.push(external);
        return [texture.id, external] as const;
      }));
      const sources = await oneAfterAnother(three.sources, async (source) => {
        const built = source.build({ world, plane: paintWorldPlane(world, depths.get(source.id)!), textures });
        made.push(built);
        const threeCamera = new PerspectiveCamera();
        setPaintedThreeCamera(threeCamera, world, PAINT_CAMERA_REST);
        const texture = ownTexture(frame.width, frame.height);
        const target = new RenderTarget(frame.width, frame.height, { type: HalfFloatType, depthBuffer: true, samples: PAINTED_THREE_SAMPLES });
        made.push(target);
        // three renders into our texture, where the stamp renderer reads it: three's own target texture would be
        // reachable only through its backend's private map, and recreated on a resize.
        backend.setXRRenderTargetTextures(target, texture);
        renderer.setRenderTarget(target);
        await renderer.compileAsync(built.scene, threeCamera);
        renderer.setRenderTarget(null);
        return { id: source.id, built, camera: threeCamera, target, texture };
      });
      return { renderer, sources };
    });

    return {
      textures: new Map(loaded.sources.map(({ id, texture }) => [id, texture])),
      render: async (t) => {
        await Promise.all(painted.map(({ texture, renderer }) => renderer.draw({ t, state: texture.frameAt?.(t) })));
        const pose = paintCameraPoseAt(camera, t);
        await owner.checked(`three.js rendering its sources at ${t} s`, () => {
          for (const { built, camera: threeCamera, target } of loaded.sources) {
            built.poseAt(t);
            setPaintedThreeCamera(threeCamera, world, pose);
            loaded.renderer.setRenderTarget(target);
            loaded.renderer.render(built.scene, threeCamera);
          }
          loaded.renderer.setRenderTarget(null);
        });
      },
      dispose: release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
