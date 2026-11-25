// three-stage.tsx: a three.js scene drawn onto the frame through a real camera's lens, on the studio's one three.js
// renderer (gpu-device-owner.ts). A frame averages `samples` exposures, each at its own moment of the shutter, point
// on the aperture and sub-pixel and light offset: depth of field, motion blur, soft shadows and antialiasing from one
// loop. The lens (lens-compositor.ts) averages them and blooms the average once; tone mapping follows.
//
// Every offset comes from a fixed pattern of the exposure's index, and in a render only the device, its targets and its
// rooms outlive a frame, so a frame's bytes depend only on its props, as Remotion's tabs need. Played live, a
// stage drafts: one exposure, kept parts held for its life.

import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { getRemotionEnvironment, useDelayRender } from 'remotion';
import {
  ACESFilmicToneMapping, BackSide, BoxGeometry, DirectionalLight, Mesh, MeshBasicMaterial, MeshLambertMaterial, PCFShadowMap, PerspectiveCamera,
  Scene, SpotLight, Vector3, type Material, type Object3D, type Texture, type ToneMapping,
} from 'three/webgpu';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { fullFrameRect, type FrameSize } from '#lib/picture/frame/models/frame.ts';
import { usePictureDrawn } from '#lib/picture/frame/studio/picture-drawn.ts';
import { useVideoFormat } from '#lib/picture/frame/studio/video-format.ts';
import { unmeasuredAttrs } from '#lib/picture/measurement/studio/motion-tag.ts';
import type { ShotCamera } from '#lib/picture/shot-camera/models/shot-camera.ts';
import { setThreeShotCamera } from '#lib/picture/shot-camera/studio/three-shot-camera.ts';
import { lensExposures, type LensExposure } from '#lib/picture/lens/models/lens-exposures.ts';
import { shotCameraExposed, type LensFocusTilt, type ShotCameraLensFocus } from '#lib/picture/lens/models/lens-focus.ts';
import { shutterMomentAt } from '#lib/picture/lens/models/lens-shutter.ts';
import { createThreeKeptParts, createThreeStageGpu, threeSceneResources, type ThreeBloom, type ThreeEnvironment, type ThreeStageGpu, type ThreeStageLook } from './three-stage-gpu.ts';

export type { ThreeBloom, ThreeEnvironment } from './three-stage-gpu.ts';

/** A frame's scene and the camera it's seen through, its frame the stage's box. */
export type ThreeFrame = { scene: Scene; camera: ShotCamera };

/** One exposure of a frame, as `draw` receives it. */
export type ThreeSample = {
  /** The frame the stage draws, its box's size: the camera a draw returns makes this frame. */
  frame: FrameSize;
  /** Seconds from the frame's time to this exposure, within the shutter centred on it (lens-shutter.ts). Build the scene at t + dt. */
  dt: number;
  /** The same moment as a share of the open shutter, 0..1. */
  shutter: number;
  /** This exposure's place among the frame's `count`. */
  index: number;
  count: number;
  /** The stage's prefiltered `environment`, for a draw that gives it to some materials only. */
  environment: Texture | null;
  /**
   * The part or material `build` makes, made once under `key` and handed back for every exposure while it's kept: the
   * frame in a render, the stage's life when played live. Its materials then compile once, not per exposure. `key`
   * must name everything it's built from; a draw may move a kept part or set a kept material's uniforms, nothing more.
   */
  kept: <T extends Object3D | Material>(key: string, build: () => T) => T;
};

/**
 * A thin lens: `focus`, the distance held sharp along the view, and `aperture`, the opening's diameter, scene units.
 * The aperture is apodised (lens-exposures.ts): its sigma is a quarter of the diameter, so a point blurs about as
 * wide as a disc that diameter would. `tilt` leans the plane of sharp focus, as a tilt-shift lens does (LensFocusTilt).
 */
export type ThreeLens = { focus: number; aperture: number; tilt?: LensFocusTilt };

/**
 * Draws `draw()`'s scene through its camera over the whole frame (or `box`), averaging `samples` exposures. Holds the
 * frame until its device is made and each frame until WebGPU has checked it.
 */
export function ThreeStage({
  draw, samples = 1, shutter = 0.5, lens, softShadows = 0, bloom, transparent = false, backdrop = '#000000',
  box: given, shadows = false, environment = false, toneMapping = ACESFilmicToneMapping, exposure = 1,
}: {
  draw: (sample: ThreeSample) => ThreeFrame;
  /**
   * 1 is a plain render; `lens`, motion blur and `softShadows` need 8 or more, and a smear longer than about 10 px an
   * exposure strobes. Played live, a stage draws one, so a blockout plays at its pace.
   */
  samples?: number;
  /** How long the shutter is open, as a fraction of a frame: 0.5 is film's 180°. */
  shutter?: number;
  lens?: ThreeLens;
  /** The angular radius in degrees of every shadow-casting directional and spot light. */
  softShadows?: number;
  bloom?: ThreeBloom;
  /** Keeps the canvas clear where nothing is drawn. */
  transparent?: boolean;
  /** The colour of the page a transparent stage sits on (black): partly covered pixels and glow blend with it in linear light. */
  backdrop?: string;
  box?: { x: number; y: number; w: number; h: number };
  shadows?: boolean;
  /** Lights the scene with a room (`true`: a soft studio, which metal needs) unless the scene sets its own. */
  environment?: boolean | ThreeEnvironment;
  toneMapping?: ToneMapping;
  exposure?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [gpu, setGpu] = useState<ThreeStageGpu | null>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const { fps, ...size } = useVideoFormat(), pictureDrawn = usePictureDrawn();
  const box = given ?? fullFrameRect(size);
  const { w, h } = box;

  // A device and canvas output for each size; let go of with it. Scrubbing the Studio mounts a stage per scene. A pass
  // drawing no picture makes none, so draws nothing.
  useLayoutEffect(() => {
    if (!pictureDrawn) return undefined;
    const handle = delayRender('making the three.js stage\'s GPU device');
    let open = true, live = true;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    const drawnOn = canvas.current!;
    const making = threeStageCanvasFreed(drawnOn).then(() => createThreeStageGpu(drawnOn, { width: w, height: h, transparent }));
    making.then((made) => {
      if (!live) return undefined;
      // Set within the hold, so the frame's own hold starts before this one lets go.
      flushSync(() => setGpu(made));
      return release();
    }, (error: Error) => {
      if (live) cancelRender(error);
    });
    return () => {
      live = false;
      threeStageCanvasesInUse.set(drawnOn, making.then((made) => made.dispose(), () => {}));
      setGpu(null);
      release();
    };
  }, [w, h, transparent, pictureDrawn, delayRender, continueRender, cancelRender]);

  useLayoutEffect(() => {
    if (!gpu) return undefined;
    const handle = delayRender('checking the three.js stage drew without a GPU error');
    let open = true, live = true;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    gpu.owner.checked('drawing a three.js stage\'s frame', () => drawThreeStageFrame(gpu, {
      draw, samples: THREE_STAGE_LIVE ? 1 : samples, live: THREE_STAGE_LIVE, shutter, lens, softShadows, shadows, environment, fps, w, h,
      look: { toneMapping, exposure, bloom, transparent, backdrop },
    })).then(release, (error: Error) => {
      if (live) cancelRender(error);
    });
    return () => {
      live = false;
      release();
    };
  });

  return <canvas ref={canvas} {...unmeasuredAttrs('three.js scene')} width={w} height={h} style={{ position: 'absolute', left: box.x, top: box.y, width: w, height: h }} />;
}

/** Whether stages here are played live rather than rendered: read once, since a page is one or the other. */
const THREE_STAGE_LIVE = !getRemotionEnvironment().isRendering;

/**
 * Each canvas's last stage, settling once it has let go of the canvas. A stage made for a new size waits for it: one
 * still being made would otherwise configure the canvas after its successor, and its dispose unconfigure the successor's.
 */
const threeStageCanvasesInUse = new WeakMap<HTMLCanvasElement, Promise<void>>();
const threeStageCanvasFreed = (canvas: HTMLCanvasElement) => threeStageCanvasesInUse.get(canvas) ?? Promise.resolve();

type ThreeStageFrame = {
  draw: (sample: ThreeSample) => ThreeFrame; samples: number; live: boolean; shutter: number; lens: ThreeLens | undefined; softShadows: number; shadows: boolean;
  environment: boolean | ThreeEnvironment; fps: number; w: number; h: number; look: ThreeStageLook;
};

/** One frame: every exposure drawn and added, then the average shown. */
function drawThreeStageFrame(stage: ThreeStageGpu, { draw, samples, live, shutter, lens, softShadows, shadows, environment, fps, w, h, look }: ThreeStageFrame) {
  const { renderer } = stage;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = PCFShadowMap;
  const room = environment === false ? null : stage.room(environment === true ? ROOM : environment);

  const count = Math.max(1, Math.round(samples));
  const exposures = lensExposures(count), threeLens = lens && threeShotLens(lens);
  const target = stage.exposureTarget(count), frame = stage.beginFrame(count);
  const camera = new PerspectiveCamera();
  let previous = new Set<{ dispose(): void }>();
  // A render keeps parts for its frame alone, so no frame's pixels depend on one drawn before it.
  const parts = live ? stage.parts : createThreeKeptParts(stage.keep);
  const { part: kept } = parts;

  for (const exposure of exposures) {
    const { index, shutter: share } = exposure;
    const { scene, camera: shot } = draw({ frame: { width: w, height: h }, dt: shutterMomentAt(0, shutter / fps, share), shutter: share, index, count, environment: room, kept });
    if (room && !scene.environment) scene.environment = room;
    setThreeShotCamera(camera, shotCameraExposed(shot, threeLens ?? null, exposure));
    const restore = softShadows > 0 ? jitterLights(scene, exposure.light, softShadows) : () => {};

    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, look.transparent ? 0 : 1);
    renderer.clear();
    renderer.render(scene, camera);
    restore();
    frame.addExposure();

    // Freed as soon as the next exposure stops using them: a draw that shares its scene across exposures keeps its
    // shadow maps and buffers, and one that builds afresh holds no more than two exposures' worth.
    const current = threeSceneResources(scene, stage.keep);
    for (const r of previous) if (!current.has(r)) r.dispose();
    previous = current;
  }
  frame.show(look);
  for (const r of previous) r.dispose();
  if (parts !== stage.parts) parts.dispose();
}

const ROOM: ThreeEnvironment = { key: 'three-stage-room', scene: () => new RoomEnvironment(), blur: 0.04 };

/**
 * A dark studio for gloss and metal in a dark scene, lit as the reference reel's red ball: a big warm softbox
 * overhead, two small hard cards on the camera's side (+z), a magenta strip behind at the left, an amber one at the
 * right. The rest reflects near-black, so metal reads lit, not grey.
 */
export const softboxEnvironment: ThreeEnvironment = {
  key: 'three-stage-softbox',
  blur: 0.02,
  scene: () => {
    const scene = new Scene();
    const box = new BoxGeometry();
    const room = new Mesh(box, new MeshBasicMaterial({ color: '#0d0a0c', side: BackSide }));
    room.scale.set(44, 32, 44);
    room.position.y = 10;
    scene.add(room);
    // Emissive-only panels: an unlit material's colour stays under 1, and a light source must be brighter than white.
    const panel = (color: string, intensity: number, at: [number, number, number], size: [number, number, number]) => {
      const mesh = new Mesh(box, new MeshLambertMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity }));
      mesh.position.set(...at);
      mesh.scale.set(...size);
      scene.add(mesh);
    };
    panel('#fff0e0', 7, [0, 17, 1], [18, 0.2, 13]);
    panel('#ffffff', 20, [-9, 7, 13], [2.6, 3.6, 0.2]);
    panel('#ffffff', 16, [8, 9, 12], [1.6, 1.6, 0.2]);
    panel('#ff4fd0', 8, [-15, 10, -9], [0.2, 13, 1.3]);
    panel('#ffae48', 7, [16, 5, -2], [0.2, 9, 1.1]);
    return scene;
  },
};

/**
 * Moves each shadow-casting directional and spot light to point `at` of its disc, `softShadows` degrees across as seen
 * from its target; returns what puts them back, so a draw may hand the same objects to every exposure.
 */
function jitterLights(scene: Scene, at: LensExposure['light'], softShadows: number) {
  const lights: [Object3D, Vector3][] = [];
  scene.updateMatrixWorld();
  const tan = Math.tan((softShadows * Math.PI) / 180);
  scene.traverse((light) => {
    if (!((light instanceof DirectionalLight || light instanceof SpotLight) && light.castShadow && light.parent)) return;
    const from = light.getWorldPosition(new Vector3()), to = light.target.getWorldPosition(new Vector3());
    const axis = from.clone().sub(to);
    const reach = axis.length() * tan;
    const u = new Vector3(0, 1, 0).cross(axis);
    if (u.lengthSq() < 1e-9) u.set(1, 0, 0);
    u.normalize();
    const v = axis.clone().cross(u).normalize();
    lights.push([light, light.position.clone()]);
    from.addScaledVector(u, at[0] * reach).addScaledVector(v, at[1] * reach);
    light.position.copy(light.parent.worldToLocal(from));
  });
  return () => {
    for (const [light, was] of lights) light.position.copy(was);
  };
}

/** A ThreeLens as the shot camera's: its opening's diameter is four sigmas of the apodised aperture. */
const threeShotLens = ({ focus, aperture, tilt }: ThreeLens): ShotCameraLensFocus => ({ focus, aperture: aperture / 4, ...(tilt && { tilt }) });
