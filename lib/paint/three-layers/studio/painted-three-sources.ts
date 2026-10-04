// painted-three-sources.ts: three.js in a painted scene, on its device's one three.js renderer (gpu-device-owner.ts).
// Each three source is a plane of the scene's camera and a lens source (stamp-lens-source.ts): its scene is rendered
// through the camera's shot camera (paint-camera-world.ts) into a texture of ours, the frame grown by the plane's
// defocus margin. Painted textures, paintings a material reads, are supplied as handles and brought up to each frame
// first (`loadPaintedThreeSources`); `loadPaintedThree` paints them with old renderers. A handle repeats on
// each axis it wraps.
//
// Texture contracts: a source's texture is rgba16float premultiplied linear colour (normal blending over a clear
// target premultiplies), its motion texture the lens's motion layer (lens-three-motion.ts); a painted texture is
// rgba16float, gamma-encoded and opaque, decoded by paintedThreeColorNode.

import { ExternalTexture, PerspectiveCamera, RepeatWrapping, type Camera, type RenderTarget, type Scene } from 'three/webgpu';
import type { FrameSize } from '#lib/picture/frame/models/frame.ts';
import type { FrameProfileStart } from '#lib/picture/profiling/studio/frame-profile.ts';
import { gpuEachInTurn } from '#lib/platform/gpu/models/gpu-in-turn.ts';
import { shotCameraGrown, type ShotCamera } from '#lib/picture/shot-camera/models/shot-camera.ts';
import { shotCameraExposed, shotLensOfFocus } from '#lib/picture/lens/models/lens-focus.ts';
import { shutterOpensAt } from '#lib/picture/lens/models/lens-shutter.ts';
import { createLensThreeMotion, LENS_THREE_MOTION_NAME } from '#lib/picture/lens/studio/lens-three-motion.ts';
import { setThreeShotCamera } from '#lib/picture/shot-camera/studio/three-shot-camera.ts';
import { paintCameraShotAt, paintCameraWorld, paintWorldPlane, type PaintCameraWorld, type PaintWorldPlane } from '#lib/paint/animation/models/paint-camera-world.ts';
import { PAINT_CAMERA_REST, paintCameraFocusAt, paintCameraPoseAt, type PaintCamera } from '#lib/paint/animation/models/paint-camera.ts';
import { paintMoment, type PaintMoment, type StampPaintFrameAt } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampLensSource, StampLensSourceExposure } from '#lib/paint/painting/studio/stamp-lens-source.ts';
import type { CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampWrapsAcross, type StampWrap } from '#lib/paint/painting/models/stamp-stage.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { createStampPaintRenderer } from '#lib/paint/painting/studio/stamp-paint-renderer.ts';
import { createStampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import { createPaintedThreeShadowing, type PaintedThreeShadows } from './painted-three-shadows.ts';

/** A source's multisampling: its edges antialiased, resolved the same each time (vid-129). */
const PAINTED_THREE_SAMPLES = 4;

/** The most taps a mip-chained painted texture's sample takes along a surface turned away, as a cylinder's sides are. */
const PAINTED_THREE_ANISOTROPY = 8;

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
 * and size what it shows by it), each painted texture by id, and `frame`, the px it renders: the stage's frame grown
 * on every side by its plane's defocus margin, which `screenUV` spans in its render.
 */
export type PaintedThreeSourceTools = { world: PaintCameraWorld; plane: PaintWorldPlane; textures: ReadonlyMap<string, ExternalTexture>; frame: FrameSize };

/**
 * A scene a source renders into a target of its own before its own scene, each time it renders, for its materials to
 * sample (a reflection drawn offscreen, say). No motion layer: what it shows moves only as what samples it does.
 */
export type PaintedThreeOffscreenPass = { readonly scene: Scene; readonly camera: Camera; readonly target: RenderTarget };

/**
 * A source's scene, built once at load. A render poses it (`poseAt`: a frame's moment or a shutter moment in it),
 * sets the exposure's camera (seeing every layer) and hands it, untouched, to `offscreen` for the passes to draw
 * first, then draws the scene; `shadows` (painted-three-shadows.ts) turns shadow maps on throughout. Materials are
 * opaque or NormalBlending transparent: renders stay premultiplied.
 */
export type PaintedThreeSourceScene = {
  scene: Scene;
  poseAt: (moment: PaintMoment) => void;
  offscreen?: (camera: PerspectiveCamera) => readonly PaintedThreeOffscreenPass[];
  shadows?: PaintedThreeShadows;
  dispose: () => void;
};

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

/**
 * A painted texture a material reads, by id: rgba16float, gamma-encoded and opaque; `wrap` as its painting wraps, u
 * repeating along x, v along y (null: neither). Whoever supplies it draws every mip level its `texture` has, each past
 * the first the one above downsampled, and lets it go after the sources loaded over it.
 */
export type PaintedThreeTextureHandle = { readonly id: string; readonly texture: GPUTexture; readonly wrap: StampWrap | null };

/**
 * The painted textures three's sources read: their handles, and `update`, which brings them all up to frame time `t`,
 * called once a frame before any source renders.
 */
export type PaintedThreeTexturesSupplied = { readonly handles: readonly PaintedThreeTextureHandle[]; readonly update: (t: number) => Promise<void> };

/**
 * Loads `three` on `owner`'s device for `camera`'s three planes, its painted textures each drawn by an old renderer of
 * its compiled painting. Refuses as loadPaintedThreeSources does.
 */
export async function loadPaintedThree(owner: StampPaintGpuOwner, camera: PaintCamera, three: PaintedThree, profile: FrameProfileStart | null): Promise<PaintedThreeLoaded> {
  // Let go of last made first, the textures after the renderers drawing into them.
  const made: { dispose: () => void }[] = [], owned: GPUTexture[] = [];
  const release = () => {
    for (const thing of made.splice(0).toReversed()) thing.dispose();
    for (const texture of owned.splice(0)) texture.destroy();
  };
  try {
    const painted = await gpuEachInTurn(three.paintedTextures ?? [], async (texture) => {
      const target = owner.webgpu.createTexture({ size: [texture.width, texture.height], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
      owned.push(target);
      const surface = await createStampPaintSurface(owner, { frame: target });
      made.push(surface);
      const renderer = await createStampPaintRenderer(surface, texture.painting, { profile });
      made.push(renderer);
      // An old renderer paints a sheet flat: none wraps.
      return { texture, renderer, handle: { id: texture.id, texture: target, wrap: null } };
    });
    const update = async (t: number) => {
      await Promise.all(painted.map(({ texture, renderer }) => renderer.draw({ kind: 'once', t, state: texture.frameAt?.(paintMoment(t)) })));
    };
    const loaded = await loadPaintedThreeSources(owner, camera, three.sources, { handles: painted.map(({ handle }) => handle), update });
    return {
      sources: loaded.sources,
      dispose: () => {
        loaded.dispose();
        release();
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}

/**
 * Loads `sources` on `owner`'s device for `camera`'s three planes, a source for each and none else, their materials
 * reading the `supplied` painted textures. Refuses a source with no three plane in the camera, and a three plane with
 * no source.
 */
export async function loadPaintedThreeSources(owner: StampPaintGpuOwner, camera: PaintCamera, sources: readonly PaintedThreeSource[], supplied: PaintedThreeTexturesSupplied): Promise<PaintedThreeLoaded> {
  const threePlanes = new Map(camera.planes.flatMap((plane) => (plane.kind === 'three' ? [[plane.id, plane] as const] : [])));
  const sourced = sources.map((source) => {
    const plane = threePlanes.get(source.id);
    if (!plane) throw new Error(`painted three: source ${source.id} isn't a three plane of the camera`);
    return { source, plane };
  });
  const ids = new Set(sources.map(({ id }) => id));
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
    const world = paintCameraWorld(camera.stage, { fov: camera.fov });
    // Asked for outside the load's check: the owner makes its renderer in an asynchronous check of its own.
    const { renderer, targetInto } = await owner.three();
    const loaded = await owner.checkedAsync('loading three.js sources', async () => {
      // Made after three's renderer, so let go of before it: an ExternalTexture's dispose tells its renderer.
      const textures = new Map(supplied.handles.map(({ id, texture, wrap }) => {
        const external = new ExternalTexture(texture);
        if (stampWrapsAcross(wrap, 'x')) external.wrapS = RepeatWrapping;
        if (stampWrapsAcross(wrap, 'y')) external.wrapT = RepeatWrapping;
        // three samples an ExternalTexture's every level trilinearly by default and never makes levels for one, so a
        // chained handle needs only anisotropy. A one-level handle (an old renderer's) is read without it: anisotropy
        // would move the old path's renders.
        if (texture.mipLevelCount > 1) external.anisotropy = PAINTED_THREE_ANISOTROPY;
        made.push(external);
        return [id, external] as const;
      }));
      return gpuEachInTurn(sourced, async ({ source, plane: { depth, margin } }) => {
        // The frame grown on every side by the plane's margin, so its defocus has what lies past the frame's edge.
        const w = frame.width + 2 * margin, h = frame.height + 2 * margin;
        const built = source.build({ world, plane: paintWorldPlane(world, depth), textures, frame: { width: w, height: h } });
        made.push(built);
        const shadowing = createPaintedThreeShadowing(source.id, built.scene, built.shadows);
        const shotAt = (pose: Parameters<typeof paintCameraShotAt>[1]) => shotCameraGrown(paintCameraShotAt(world, pose), margin);
        const threeCamera = setThreeShotCamera(new PerspectiveCamera(), shotAt(PAINT_CAMERA_REST));
        // Every layer, so an offscreen camera leaving a layer out hides what's on it from its pass alone.
        threeCamera.layers.enableAll();
        const texture = ownTexture(w, h), motionTexture = ownTexture(w, h);
        // three renders into our textures, where the stamp renderer reads them.
        const target = targetInto([{ name: 'output', texture }, { name: LENS_THREE_MOTION_NAME, texture: motionTexture }], { samples: PAINTED_THREE_SAMPLES });
        made.push(target);
        const motion = createLensThreeMotion({ width: w, height: h, distanceUnit: world.depthUnit });
        // Posed once first: a source may make its meshes as it poses, and they compile here, not in the first frame.
        built.poseAt(paintMoment(0));
        const restore = shadowing.on(renderer);
        try {
          await gpuEachInTurn(built.offscreen?.(threeCamera) ?? [], (pass) => {
            renderer.setRenderTarget(pass.target);
            return renderer.compileAsync(pass.scene, pass.camera);
          });
          renderer.setRenderTarget(target);
          renderer.setMRT(motion.mrt);
          await renderer.compileAsync(built.scene, threeCamera);
        } finally {
          renderer.setMRT(null);
          renderer.setRenderTarget(null);
          restore();
        }
        return { id: source.id, built, shadowing, shotAt, camera: threeCamera, target, motion, picture: { texture, motion: motionTexture, at: { x: -margin, y: -margin } } };
      });
    });

    // The frame time the painted textures were last drawn for: they're held through a frame, so drawn once for all its sources and exposures.
    let paintedFor: number | null = null;
    const render = async ({ built, shadowing, shotAt, camera: threeCamera, target, motion }: (typeof loaded)[number], t: number, exposure: StampLensSourceExposure | null) => {
      if (paintedFor !== t) {
        await supplied.update(t);
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
            built.poseAt(paintMoment(when, t));
            setThreeShotCamera(threeCamera, shotAt(paintCameraPoseAt(camera, paintMoment(when, t))));
            motion.record(moment, built.scene, threeCamera);
          }
          moved = motion.moved(built.scene);
        }
        built.poseAt(paintMoment(at, t));
        setThreeShotCamera(threeCamera, seen(shotAt(pose)));
        // three draws a light's shadow map once a frame for each camera, its frames advanced by its animation loop,
        // which a render here doesn't wait on: each render is a moment of its own, so a frame of its own.
        renderer.inspector.nodeFrame.update();
        const restore = shadowing.on(renderer);
        try {
          for (const pass of built.offscreen?.(threeCamera) ?? []) {
            renderer.setRenderTarget(pass.target);
            renderer.render(pass.scene, pass.camera);
          }
          renderer.setMRT(motion.mrt);
          renderer.setRenderTarget(target);
          renderer.render(built.scene, threeCamera);
        } finally {
          renderer.setMRT(null);
          renderer.setRenderTarget(null);
          restore();
        }
        return { moved };
      });
    };
    return {
      sources: new Map(loaded.map((source) => [source.id, { kind: 'three' as const, picture: source.picture, render: (t, exposure) => render(source, t, exposure) }])),
      dispose: release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
