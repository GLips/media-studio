// three-stage-gpu.ts: what a ThreeStage keeps on its device between frames: its owner and the owner's one three.js
// renderer, the canvas it shows, the exposure and sum targets, the passes that add, average, bloom and encode, and
// its prefiltered rooms.

import {
  AddEquation, Color, CustomBlending, DirectionalLight, FloatType, HalfFloatType, InstancedMesh, NearestFilter, NodeMaterial, NoToneMapping, OneFactor, PMREMGenerator, PointLight, QuadMesh, RenderTarget, SpotLight, Texture, Vector3, type Material, type Node, type Scene, type ToneMapping,
} from 'three/webgpu';
import { clamp, float, max, mix, pow, step, texture, toneMapping, uniform, vec3, vec4 } from 'three/tsl';
import { bloom as bloomNode } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { createGpuDeviceOwner, type GpuDeviceOwner } from '#lib/platform/gpu/studio/gpu-device-owner.ts';
import { createGpuCanvasOutput, type GpuCanvasOutput } from '#lib/platform/gpu/studio/gpu-canvas-output.ts';
import { isThreeGeometryDrawable, type StudioThreeRenderer } from '#lib/platform/gpu/studio/studio-three-renderer.ts';

/** Bloom: linear light above `threshold` glows (1 is white before tone mapping), `strength` 0.3–1.5, `radius` 0..1. */
export type ThreeBloom = { strength: number; radius: number; threshold: number };

/**
 * A room for reflections and fill, prefiltered once per device and kept under `key`. `scene` builds it (the stage
 * disposes its meshes once prefiltered); `blur` softens it (0.04).
 */
export type ThreeEnvironment = { key: string; scene: () => Scene; blur?: number };

/** How a frame's average is shown: tone mapped, bloomed, and laid over `backdrop` when `transparent`. */
export type ThreeStageLook = { toneMapping: ToneMapping; exposure: number; bloom: ThreeBloom | undefined; transparent: boolean; backdrop: string };

type Disposable = { dispose(): void };

/**
 * sRGB's transfer curve, linear light to encoded. three's own (sRGBTransferOETF) is typed as an untyped node, which
 * TSL's typed vectors won't take.
 */
function encodeSrgb(linear: Node<'vec3'>): Node<'vec3'> {
  return mix(pow(linear, vec3(1 / 2.4)).mul(1.055).sub(0.055), linear.mul(12.92), step(linear, vec3(0.0031308)));
}

/** A raw full-frame pass: its fragment is `fragment` alone, with no lighting, colour space or tone mapping of three's. */
function rawPass(fragment: Node, blend?: 'add'): QuadMesh & { material: NodeMaterial } {
  const material = new NodeMaterial();
  material.fragmentNode = fragment;
  Object.assign(material, { depthTest: false, depthWrite: false });
  if (blend) {
    Object.assign(material, {
      blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneFactor, blendEquationAlpha: AddEquation, blendSrcAlpha: OneFactor, blendDstAlpha: OneFactor,
    });
  }
  return Object.assign(new QuadMesh(material), { material });
}

/** The output pass for one structure of look (tone mapping, bloom or not, transparency), and its bloom if any. */
type ThreeStageOutputPass = { key: string; pass: ReturnType<typeof rawPass>; bloom: ReturnType<typeof bloomNode> | null };

function disposeOutputPass(retired: ThreeStageOutputPass) {
  retired.pass.material.dispose();
  retired.bloom?.dispose();
}

export type ThreeStageGpu = Awaited<ReturnType<typeof createThreeStageGpu>>;

/**
 * A stage's device, renderer and canvas, `width` × `height`. Its passes are built once: what changes between frames
 * (the sample read, the average's weight, the look) goes through uniforms and textures, never a recompile.
 */
export async function createThreeStageGpu(canvas: HTMLCanvasElement, { width, height, transparent }: { width: number; height: number; transparent: boolean }) {
  const owner: GpuDeviceOwner = await createGpuDeviceOwner();
  let three: StudioThreeRenderer, output: GpuCanvasOutput;
  try {
    three = await owner.three();
    output = await createGpuCanvasOutput(owner, canvas, { width, height, transparent });
  } catch (error) {
    owner.dispose();
    throw error;
  }
  const { renderer } = three;
  renderer.setPixelRatio(1);
  // Sizes what follows the drawing buffer (the bloom's targets); nothing renders to the renderer's own canvas.
  renderer.setSize(width, height, false);
  // Every pass clears by hand, if at all: the sum adds up the exposures.
  renderer.autoClear = false;

  const exact = { minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false };
  const sample = new RenderTarget(width, height, { type: HalfFloatType, depthBuffer: true, ...exact });
  let msaa: RenderTarget | null = null;
  // A 32-bit sum: sixteen half-float adds can drift by a count in the final 8 bits. Studio devices blend float32.
  const sum = new RenderTarget(width, height, { type: FloatType, depthBuffer: false, ...exact });
  const image = new RenderTarget(width, height, { type: HalfFloatType, depthBuffer: false });
  const shown = three.targetInto(output.texture);

  const added = texture(sample.texture);
  const add = rawPass(added, 'add');
  const weight = uniform(1);
  const resolve = rawPass(texture(sum.texture).mul(weight));

  /**
   * Tone maps the average and encodes it for the canvas. Encoded alone, a transparent (premultiplied) average would
   * brighten partial cover and clip added light white over a light page. So it's laid over the backdrop in linear
   * light, encoded, and the backdrop's share taken out: composited over that colour, the page shows the linear blend.
   */
  const backdrop = uniform(new Vector3()), exposure = uniform(1);
  // The pass for the look's structure, its bloom's numbers uniforms; a pass of another structure is let go of.
  let looked: ThreeStageOutputPass | null = null;
  const outputPass = ({ toneMapping: mapping, bloom, transparent: clear }: ThreeStageLook) => {
    const key = `${mapping}|${bloom ? 'bloom' : '-'}|${clear}`;
    if (looked?.key !== key) {
      if (looked) disposeOutputPass(looked);
      const average = texture(image.texture);
      const glow = bloom ? bloomNode(average) : null;
      const lit = glow ? average.add(glow) : average;
      // toneMapping gives a vec4 (its colour's alpha kept), whatever its types say.
      const light: Node<'vec3'> = mapping === NoToneMapping ? lit.rgb : toneMapping(mapping, exposure, lit).rgb;
      const cover: Node<'float'> = clear ? clamp(lit.a, 0, 1) : float(1);
      const uncovered = cover.oneMinus();
      const seen = encodeSrgb(light.add(backdrop.mul(uncovered)));
      looked = { key, bloom: glow, pass: rawPass(vec4(max(seen.sub(encodeSrgb(backdrop).mul(uncovered)), vec3(0)), cover)) };
    }
    if (looked.bloom && bloom) {
      looked.bloom.strength.value = bloom.strength;
      looked.bloom.radius.value = bloom.radius;
      looked.bloom.threshold.value = bloom.threshold;
    }
    return looked.pass;
  };

  const rooms = new Map<string, Texture>();
  const keep = new Set<Texture>();

  return {
    owner, renderer, sample, sum, keep,
    /** A multisampled target, for the frames whose few exposures can't antialias themselves. */
    sampleMsaa() {
      msaa ??= new RenderTarget(width, height, { type: HalfFloatType, samples: 4, depthBuffer: true, ...exact });
      return msaa;
    },
    /** Adds `target`, an exposure, into the sum. */
    addExposure(target: RenderTarget) {
      added.value = target.texture;
      renderer.setRenderTarget(sum);
      add.render(renderer);
    },
    /** The sum over `count` exposures, looked at as `look` says, onto the canvas. */
    show(count: number, look: ThreeStageLook) {
      weight.value = 1 / count;
      renderer.setRenderTarget(image);
      resolve.render(renderer);
      backdrop.value.setFromColor(new Color(look.transparent ? look.backdrop : '#000000'));
      exposure.value = look.exposure;
      renderer.setRenderTarget(shown);
      outputPass(look).render(renderer);
      renderer.setRenderTarget(null);
      output.present();
    },
    /** The room prefiltered for this device, built on first use: it's the same every frame, and costly to make. */
    room(env: ThreeEnvironment) {
      let made = rooms.get(env.key);
      if (!made) {
        const pmrem = new PMREMGenerator(renderer);
        const scene = env.scene();
        made = pmrem.fromScene(scene, env.blur ?? 0.04).texture;
        for (const r of threeSceneResources(scene, keep)) r.dispose();
        pmrem.dispose();
        rooms.set(env.key, made);
        keep.add(made);
      }
      return made;
    },
    dispose() {
      for (const t of [sample, msaa, sum, image, shown]) t?.dispose();
      for (const pass of [add, resolve]) pass.material.dispose();
      if (looked) disposeOutputPass(looked);
      for (const t of rooms.values()) t.dispose();
      output.dispose();
      owner.dispose();
    },
  };
}

const isThreeTexture = (value: unknown): value is Texture => value instanceof Texture;

/** What a drawn scene holds on the GPU, but for `keep` (the stage's rooms). */
export function threeSceneResources(scene: Scene, keep: ReadonlySet<Texture>): Set<Disposable> {
  const out = new Set<Disposable>();
  const addTexture = (value: Texture) => {
    if (!keep.has(value)) out.add(value);
  };
  const addMaterial = (m: Material | undefined) => {
    if (!m) return;
    out.add(m);
    // A material's maps are its own fields, under names that differ by kind.
    for (const value of Object.values(m)) if (isThreeTexture(value)) addTexture(value);
  };
  scene.traverse((object) => {
    if (isThreeGeometryDrawable(object)) {
      out.add(object.geometry);
      for (const m of Array.isArray(object.material) ? object.material : [object.material]) addMaterial(m);
      // An instanced mesh's matrices and colours are its own buffers, not its geometry's.
      if (object instanceof InstancedMesh) out.add(object);
    }
    if ((object instanceof DirectionalLight || object instanceof SpotLight || object instanceof PointLight) && object.castShadow) out.add(object.shadow);
  });
  for (const value of [scene.environment, scene.background]) if (isThreeTexture(value)) addTexture(value);
  return out;
}
