// three-stage.tsx: a three.js scene drawn onto the frame through a real camera's lens. A frame is an accumulation:
// `draw` builds the scene for each of `samples` exposures, each at its own moment of the shutter, point on the
// aperture and sub-pixel and light offset, and the stage averages them in one WebGL context: true depth of field,
// motion blur, soft shadows and antialiasing from one loop. Bloom and tone mapping apply once, to the average.
//
// Every offset comes from a fixed pattern of the exposure's index, and only the renderer, its targets and its
// prefiltered rooms outlive a frame, so a frame's bytes depend only on its props, as Remotion's parallel tabs need.

import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { fullFrameRect } from '#lib/picture/frame/models/frame.ts';
import { useVideoFormat } from '#lib/picture/frame/studio/video-format.ts';
import { unmeasuredAttrs } from '#lib/picture/measurement/studio/motion-tag.ts';

export type ThreeFrame = { scene: THREE.Scene; camera: THREE.PerspectiveCamera };

/** One exposure of a frame, as `draw` receives it. */
export type ThreeSample = {
  /** Seconds from the frame's time to this exposure: 0 for the last, back to −shutter/fps. Build the scene at t + dt. */
  dt: number;
  /** This exposure's place among the frame's `count`. */
  index: number;
  count: number;
  /** The stage's prefiltered `environment`, for a draw that gives it to some materials only. */
  environment: THREE.Texture | null;
};

/**
 * A thin lens. `focus` is the distance along the view in scene units that's sharp; `aperture` the lens's opening in
 * scene units. A point at distance d blurs to a disc f·aperture·|1/focus − 1/d| px across, f being the focal length in
 * px ((h/2)/tan(fov/2), h the stage's height), in front of the focus as behind it.
 */
export type ThreeLens = { focus: number; aperture: number };
/** Bloom: linear light above `threshold` glows (1 is white before tone mapping), `strength` 0.3–1.5, `radius` 0..1. */
export type ThreeBloom = { strength: number; radius: number; threshold: number };
/**
 * A room for reflections and fill, prefiltered once per renderer and kept under `key`. `scene` builds it (the stage
 * disposes its meshes once prefiltered); `blur` softens it (0.04).
 */
export type ThreeEnvironment = { key: string; scene: () => THREE.Scene; blur?: number };

/** Draws `draw()`'s scene through its camera over the whole frame (or `box`), averaging `samples` exposures. */
export function ThreeStage({
  draw, samples = 1, shutter = 0.5, lens, softShadows = 0, bloom, transparent = false, backdrop = '#000000',
  box: given, shadows = false, environment = false, toneMapping = THREE.ACESFilmicToneMapping, exposure = 1,
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
  /** The colour of the page a transparent stage sits on (black): partly covered pixels, glow and glass blend with it in linear light. */
  backdrop?: string;
  box?: { x: number; y: number; w: number; h: number };
  shadows?: boolean;
  /** Lights the scene with a room (`true`: a soft studio, which metal needs) unless the scene sets its own. */
  environment?: boolean | ThreeEnvironment;
  toneMapping?: THREE.ToneMapping;
  exposure?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const gl = useRef<StageGl | null>(null);
  const { fps, ...size } = useVideoFormat();
  const box = given ?? fullFrameRect(size);

  useLayoutEffect(() => {
    gl.current ??= createStageGl(canvas.current!, transparent);
    const stage = gl.current;
    const { renderer } = stage;
    stage.resize(box.w, box.h);
    renderer.shadowMap.enabled = shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = toneMapping;
    renderer.toneMappingExposure = exposure;
    const room = environment === false ? null : stage.room(environment === true ? ROOM : environment);
    const behind = new THREE.Color(transparent ? backdrop : '#000000');

    const count = Math.max(1, Math.round(samples));
    const exposures = exposurePattern(count);
    const target = count < 4 ? stage.sampleMsaa() : stage.sample;
    let previous = new Set<Disposable>();
    renderer.setRenderTarget(stage.sum);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);

    for (const [index, e] of exposures.entries()) {
      const { scene, camera } = draw({ dt: -(1 - e.time) * (shutter / fps), index, count, environment: room });
      if (room && !scene.environment) scene.environment = room;
      camera.aspect = box.w / box.h;
      camera.updateProjectionMatrix();
      const restore = count > 1 ? jitterExposure(scene, camera, e, { lens, softShadows, w: box.w, h: box.h }) : () => {};

      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, transparent ? 0 : 1);
      renderer.clear();
      // Three clears the target that glass refracts to the clear colour, or to half-white when that is see-through:
      // an opaque backdrop there makes a transparent stage's glass show the page it will sit on.
      renderer.setClearColor(behind, 1);
      renderer.render(scene, camera);
      restore();

      stage.add.uniforms.tSample.value = target.texture;
      renderer.setRenderTarget(stage.sum);
      stage.quad.material = stage.add;
      stage.quad.render(renderer);

      // Freed as soon as the next exposure stops using them: a draw that shares its scene across exposures keeps its
      // shadow maps and buffers, and one that builds afresh holds no more than two exposures' worth.
      const current = sceneResources(scene, stage.keep);
      for (const r of previous) if (!current.has(r)) r.dispose();
      previous = current;
    }

    stage.resolve.uniforms.tSum.value = stage.sum.texture;
    stage.resolve.uniforms.weight.value = 1 / count;
    renderer.setRenderTarget(stage.image);
    stage.quad.material = stage.resolve;
    stage.quad.render(renderer);
    if (bloom) {
      const pass = stage.bloom();
      Object.assign(pass, { strength: bloom.strength, radius: bloom.radius, threshold: bloom.threshold });
      pass.render(renderer, null as never, stage.image, 0, false);
    }
    const { uniforms } = stage.output;
    uniforms.tImage.value = stage.image.texture;
    uniforms.backdrop.value.copy(behind);
    uniforms.transparent.value = transparent ? 1 : 0;
    renderer.setRenderTarget(null);
    stage.quad.material = stage.output;
    stage.quad.render(renderer);
    for (const r of previous) r.dispose();
  });
  // Scrubbing the Studio mounts a stage per scene, and Chrome drops contexts past about 16 live ones.
  useLayoutEffect(() => () => {
    gl.current?.dispose();
    gl.current = null;
  }, []);

  return <canvas ref={canvas} {...unmeasuredAttrs('three.js scene')} width={box.w} height={box.h} style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h }} />;
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
    const scene = new THREE.Scene();
    const box = new THREE.BoxGeometry();
    const room = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: '#0d0a0c', side: THREE.BackSide }));
    room.scale.set(44, 32, 44);
    room.position.y = 10;
    scene.add(room);
    // Emissive-only panels: an unlit material's colour stays under 1, and a light source must be brighter than white.
    const panel = (color: string, intensity: number, at: [number, number, number], size: [number, number, number]) => {
      const mesh = new THREE.Mesh(box, new THREE.MeshLambertMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity }));
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
function jitterExposure(scene: THREE.Scene, camera: THREE.PerspectiveCamera, e: Exposure, o: { lens?: ThreeLens; softShadows: number; w: number; h: number }) {
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

  const lights: [THREE.Object3D, THREE.Vector3][] = [];
  if (o.softShadows > 0) {
    scene.updateMatrixWorld();
    const tan = Math.tan((o.softShadows * Math.PI) / 180);
    scene.traverse((light) => {
      if (!((light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) && light.castShadow && light.parent)) return;
      const from = light.getWorldPosition(new THREE.Vector3()), to = light.target.getWorldPosition(new THREE.Vector3());
      const axis = from.clone().sub(to);
      const reach = axis.length() * tan;
      const u = new THREE.Vector3(0, 1, 0).cross(axis);
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

// ---------- GPU state kept across frames ----------

/**
 * Tone maps the average and encodes it for the canvas. Encoded alone, a transparent (premultiplied) average would
 * brighten partial cover and clip added light white over a light page. So it's laid over the backdrop in linear
 * light, encoded, and the backdrop's share taken out: composited over that colour, the page shows the linear blend.
 */
const STAGE_OUTPUT = /* glsl */ `
uniform sampler2D tImage;
uniform vec3 backdrop;
uniform float transparent;
varying vec2 vUv;
void main() {
	vec4 image = texture2D( tImage, vUv );
	vec3 light = image.rgb;
	#ifdef TONE_MAPPING
	light = toneMapping( light );
	#endif
	float cover = transparent > 0.5 ? clamp( image.a, 0.0, 1.0 ) : 1.0;
	vec3 seen = linearToOutputTexel( vec4( light + backdrop * ( 1.0 - cover ), 1.0 ) ).rgb;
	gl_FragColor = vec4( max( seen - linearToOutputTexel( vec4( backdrop, 1.0 ) ).rgb * ( 1.0 - cover ), 0.0 ), cover );
}
`;

type StageGl = ReturnType<typeof createStageGl>;

function createStageGl(canvas: HTMLCanvasElement, transparent: boolean) {
  // preserveDrawingBuffer: Remotion screenshots the page after the effect, and a cleared buffer would come out blank.
  // No context antialiasing: every exposure renders into a target, and the canvas only ever gets a full-screen quad.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: transparent, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Every pass clears by hand, if at all: the sum adds up the exposures, and an exposure's clear isn't its glass's.
  renderer.autoClear = false;
  // A 32-bit sum where float blending exists: sixteen half-float adds can drift by a count in the final 8 bits.
  const sumType = renderer.extensions.has('EXT_float_blend') ? THREE.FloatType : THREE.HalfFloatType;
  const exact = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false };
  const sample = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, ...exact });
  let msaa: THREE.WebGLRenderTarget | null = null;
  const sum = new THREE.WebGLRenderTarget(1, 1, { type: sumType, depthBuffer: false, ...exact });
  const image = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const quadVertex = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const add = new THREE.ShaderMaterial({
    uniforms: { tSample: { value: null } },
    vertexShader: quadVertex,
    fragmentShader: 'uniform sampler2D tSample; varying vec2 vUv; void main() { gl_FragColor = texture2D(tSample, vUv); }',
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor, depthTest: false, depthWrite: false,
  });
  const resolve = new THREE.ShaderMaterial({
    uniforms: { tSum: { value: null }, weight: { value: 1 } },
    vertexShader: quadVertex,
    fragmentShader: 'uniform sampler2D tSum; uniform float weight; varying vec2 vUv; void main() { gl_FragColor = texture2D(tSum, vUv) * weight; }',
    blending: THREE.NoBlending, depthTest: false, depthWrite: false,
  });
  const quad = new FullScreenQuad(add);
  // Three prefixes a ShaderMaterial drawn to the canvas with the renderer's toneMapping() and linearToOutputTexel().
  const output = new THREE.ShaderMaterial({
    uniforms: { tImage: { value: null }, backdrop: { value: new THREE.Color() }, transparent: { value: 0 } },
    vertexShader: quadVertex,
    fragmentShader: STAGE_OUTPUT,
    blending: THREE.NoBlending, depthTest: false, depthWrite: false,
  });
  let bloomPass: UnrealBloomPass | null = null;
  const rooms = new Map<string, THREE.Texture>();
  const keep = new Set<unknown>();
  let size = [0, 0];

  return {
    renderer, sample, sum, image, add, resolve, quad, output, keep,
    resize(w: number, h: number) {
      if (size[0] === w && size[1] === h) return;
      size = [w, h];
      renderer.setSize(w, h, false);
      for (const t of [sample, msaa, sum, image]) t?.setSize(w, h);
      bloomPass?.setSize(w, h);
    },
    /** A multisampled target, for the frames whose few exposures can't antialias themselves. */
    sampleMsaa() {
      msaa ??= new THREE.WebGLRenderTarget(size[0], size[1], { type: THREE.HalfFloatType, samples: 4, ...exact });
      return msaa;
    },
    bloom() {
      bloomPass ??= new UnrealBloomPass(new THREE.Vector2(size[0], size[1]), 1, 0, 1);
      return bloomPass;
    },
    /** The room prefiltered for this renderer, built on first use: it's the same every frame, and costly to make. */
    room(env: ThreeEnvironment) {
      let texture = rooms.get(env.key);
      if (!texture) {
        const pmrem = new THREE.PMREMGenerator(renderer);
        const scene = env.scene();
        texture = pmrem.fromScene(scene, env.blur ?? 0.04).texture;
        for (const r of sceneResources(scene, keep)) r.dispose();
        pmrem.dispose();
        rooms.set(env.key, texture);
        keep.add(texture);
      }
      return texture;
    },
    dispose() {
      for (const t of [sample, msaa, sum, image]) t?.dispose();
      for (const m of [add, resolve, output]) m.dispose();
      quad.dispose();
      bloomPass?.dispose();
      for (const t of rooms.values()) t.dispose();
      renderer.forceContextLoss();
      renderer.dispose();
    },
  };
}

type Disposable = { dispose(): void };

/** What a drawn scene holds on the GPU, but for `keep` (the stage's rooms). */
function sceneResources(scene: THREE.Scene, keep: Set<unknown>): Set<Disposable> {
  const out = new Set<Disposable>();
  const addTexture = (value: unknown) => {
    if (value instanceof THREE.Texture && !keep.has(value)) out.add(value);
  };
  const addMaterial = (m: THREE.Material | undefined) => {
    if (!m) return;
    out.add(m);
    for (const value of Object.values(m)) addTexture(value);
    if (m instanceof THREE.ShaderMaterial) for (const u of Object.values(m.uniforms)) addTexture(u.value);
  };
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line) {
      out.add(object.geometry);
      for (const m of Array.isArray(object.material) ? object.material : [object.material]) addMaterial(m);
      addMaterial(object.customDepthMaterial);
      addMaterial(object.customDistanceMaterial);
      // An instanced mesh's matrices and colours are its own buffers, not its geometry's.
      if (object instanceof THREE.InstancedMesh) out.add(object);
    }
    if ((object instanceof THREE.DirectionalLight || object instanceof THREE.SpotLight || object instanceof THREE.PointLight) && object.castShadow) out.add(object.shadow);
  });
  addTexture(scene.environment);
  addTexture(scene.background);
  return out;
}
