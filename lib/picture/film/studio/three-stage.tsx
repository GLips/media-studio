// three-stage.tsx: a three.js scene drawn onto the frame through a real camera's lens, on the studio's one three.js
// renderer (gpu-device-owner.ts). A frame averages `samples` exposures, each at its own moment of the shutter, point
// on the aperture and sub-pixel and light offset: depth of field, motion blur, soft shadows and antialiasing from one
// loop. Bloom and tone mapping apply once, to the average. The lens and bloom are the stage's own until vid-141.
//
// Every offset comes from a fixed pattern of the exposure's index, and only the device, its targets and its
// prefiltered rooms outlive a frame, so a frame's bytes depend only on its props, as Remotion's parallel tabs need.

import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useDelayRender } from 'remotion';
import {
  ACESFilmicToneMapping, BackSide, BoxGeometry, DirectionalLight, Mesh, MeshBasicMaterial, MeshLambertMaterial, PCFShadowMap, PerspectiveCamera,
  Scene, SpotLight, Vector3, type Object3D, type Texture, type ToneMapping,
} from 'three/webgpu';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { fullFrameRect } from '#lib/picture/frame/models/frame.ts';
import { useVideoFormat } from '#lib/picture/frame/studio/video-format.ts';
import { unmeasuredAttrs } from '#lib/picture/measurement/studio/motion-tag.ts';
import type { ShotCamera } from '#lib/picture/shot-camera/models/shot-camera.ts';
import { setThreeShotCamera } from '#lib/picture/shot-camera/studio/three-shot-camera.ts';
import { createThreeStageGpu, threeSceneResources, type ThreeBloom, type ThreeEnvironment, type ThreeStageGpu } from './three-stage-gpu.ts';

export type { ThreeBloom, ThreeEnvironment } from './three-stage-gpu.ts';

/** A frame's scene and the camera it's seen through, its frame the stage's box. */
export type ThreeFrame = { scene: Scene; camera: ShotCamera };

/** One exposure of a frame, as `draw` receives it. */
export type ThreeSample = {
  /** Seconds from the frame's time to this exposure: 0 for the last, back to −shutter/fps. Build the scene at t + dt. */
  dt: number;
  /** This exposure's place among the frame's `count`. */
  index: number;
  count: number;
  /** The stage's prefiltered `environment`, for a draw that gives it to some materials only. */
  environment: Texture | null;
};

/**
 * A thin lens. `focus` is the distance along the view in scene units that's sharp; `aperture` the lens's opening in
 * scene units. A point at distance d blurs to a disc f·aperture·|1/focus − 1/d| px across, f being the focal length in
 * px ((h/2)/tan(fov/2), h the stage's height), in front of the focus as behind it.
 */
export type ThreeLens = { focus: number; aperture: number };

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
   * exposure strobes.
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
  const { fps, ...size } = useVideoFormat();
  const box = given ?? fullFrameRect(size);
  const { w, h } = box;

  // A device and canvas output for each size; let go of with it. Scrubbing the Studio mounts a stage per scene.
  useLayoutEffect(() => {
    const handle = delayRender('making the three.js stage\'s GPU device');
    let open = true, live = true;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    const making = createThreeStageGpu(canvas.current!, { width: w, height: h, transparent });
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
      void making.then((made) => made.dispose(), () => {});
      setGpu(null);
      release();
    };
  }, [w, h, transparent, delayRender, continueRender, cancelRender]);

  useLayoutEffect(() => {
    if (!gpu) return undefined;
    const handle = delayRender('checking the three.js stage drew without a GPU error');
    let open = true, live = true;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    gpu.owner.checked('drawing a three.js stage\'s frame', () => drawThreeStageFrame(gpu, {
      draw, samples, shutter, lens, softShadows, shadows, environment, fps, w, h,
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

type ThreeStageFrame = {
  draw: (sample: ThreeSample) => ThreeFrame; samples: number; shutter: number; lens: ThreeLens | undefined; softShadows: number; shadows: boolean;
  environment: boolean | ThreeEnvironment; fps: number; w: number; h: number; look: Parameters<ThreeStageGpu['show']>[1];
};

/** One frame: every exposure drawn and added, then the average shown. */
function drawThreeStageFrame(stage: ThreeStageGpu, { draw, samples, shutter, lens, softShadows, shadows, environment, fps, w, h, look }: ThreeStageFrame) {
  const { renderer } = stage;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = PCFShadowMap;
  const room = environment === false ? null : stage.room(environment === true ? ROOM : environment);

  const count = Math.max(1, Math.round(samples));
  const exposures = exposurePattern(count);
  const target = count < 4 ? stage.sampleMsaa() : stage.sample;
  const camera = new PerspectiveCamera();
  let previous = new Set<{ dispose(): void }>();
  renderer.setRenderTarget(stage.sum);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, false, false);

  for (const [index, e] of exposures.entries()) {
    const frame = draw({ dt: -(1 - e.time) * (shutter / fps), index, count, environment: room });
    if (frame.camera.frame.width !== w || frame.camera.frame.height !== h) {
      throw new Error(`three stage: its camera makes a ${frame.camera.frame.width} × ${frame.camera.frame.height} frame, and its box is ${w} × ${h}`);
    }
    const { scene } = frame;
    if (room && !scene.environment) scene.environment = room;
    setThreeShotCamera(camera, frame.camera);
    const restore = count > 1 ? jitterExposure(scene, camera, e, { lens, softShadows, w, h }) : () => {};

    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, look.transparent ? 0 : 1);
    renderer.clear();
    renderer.render(scene, camera);
    restore();
    stage.addExposure(target);

    // Freed as soon as the next exposure stops using them: a draw that shares its scene across exposures keeps its
    // shadow maps and buffers, and one that builds afresh holds no more than two exposures' worth.
    const current = threeSceneResources(scene, stage.keep);
    for (const r of previous) if (!current.has(r)) r.dispose();
    previous = current;
  }
  stage.show(count, look);
  for (const r of previous) r.dispose();
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

// ---------- the exposure pattern ----------

/** Where exposure `index` sits: its moment in the shutter (0..1, 1 the frame's time) and its offsets. */
type Exposure = { time: number; lens: readonly [number, number]; pixel: readonly [number, number]; light: readonly [number, number] };

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Stratified shutter times, a golden-angle spiral over the aperture, Halton sub-pixel offsets and a second spiral for
 * the lights. The spirals are walked in strides coprime to the count so that no exposure's time tracks its place on
 * the lens: otherwise a moving, defocused edge would smear sharp at one end and soft at the other.
 */
function exposurePattern(count: number): Exposure[] {
  if (count === 1) return [{ time: 1, lens: [0, 0], pixel: [0, 0], light: [0, 0] }];
  const spiral = (j: number): [number, number] => {
    const r = Math.sqrt((j + 0.5) / count), a = j * GOLDEN_ANGLE;
    return [r * Math.cos(a), r * Math.sin(a)];
  };
  const lensStride = coprimeNear(count, 0.618), lightStride = coprimeNear(count, 0.382);
  return Array.from({ length: count }, (_, k) => ({
    time: (k + 1) / count,
    lens: spiral((k * lensStride) % count),
    pixel: [halton(k + 1, 2) - 0.5, halton(k + 1, 3) - 0.5],
    light: spiral((k * lightStride + 1) % count),
  }));
}

function coprimeNear(n: number, share: number) {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const want = Math.max(1, Math.round(n * share));
  for (let d = 0; d < n; d++) for (const s of [want + d, want - d]) if (s >= 1 && s < n && gcd(s, n) === 1) return s;
  return 1;
}

function halton(i: number, base: number) {
  let f = 1, r = 0;
  for (; i > 0; i = Math.floor(i / base)) {
    f /= base;
    r += f * (i % base);
  }
  return r;
}

/**
 * Moves this exposure's camera over the aperture and its lights over their discs; returns what puts them back, so a
 * draw may hand the same objects to every exposure. The frustum is sheared so the focal plane stays put while the eye
 * moves (an off-axis thin lens): turning the camera toward the focus would blur the frame's edges.
 */
function jitterExposure(scene: Scene, camera: PerspectiveCamera, e: Exposure, o: { lens?: ThreeLens; softShadows: number; w: number; h: number }) {
  const cameraAt = camera.position.clone();
  const m = camera.projectionMatrix.elements;
  if (o.lens && o.lens.aperture > 0) {
    const [ox, oy] = [e.lens[0] * o.lens.aperture / 2, e.lens[1] * o.lens.aperture / 2];
    camera.translateX(ox);
    camera.translateY(oy);
    m[8] -= (m[0] * ox) / o.lens.focus;
    m[9] -= (m[5] * oy) / o.lens.focus;
  }
  m[8] -= (2 * e.pixel[0]) / o.w;
  m[9] -= (2 * e.pixel[1]) / o.h;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.updateMatrixWorld();

  const lights: [Object3D, Vector3][] = [];
  if (o.softShadows > 0) {
    scene.updateMatrixWorld();
    const tan = Math.tan((o.softShadows * Math.PI) / 180);
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
      from.addScaledVector(u, e.light[0] * reach).addScaledVector(v, e.light[1] * reach);
      light.position.copy(light.parent.worldToLocal(from));
    });
  }
  return () => {
    camera.position.copy(cameraAt);
    camera.updateMatrixWorld();
    for (const [light, at] of lights) light.position.copy(at);
  };
}
