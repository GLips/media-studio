// three-stage-gpu.ts: what a ThreeStage keeps on its device between frames: its owner and the owner's one three.js
// renderer, the canvas it shows, the texture each exposure renders into, the lens (lens-compositor.ts) that averages
// and blooms the exposures, the pass that tone maps and encodes the lens's image, and its prefiltered rooms.

import {
  Color, DirectionalLight, ExternalTexture, InstancedMesh, NodeMaterial, NoToneMapping, PMREMGenerator, PointLight, QuadMesh, SpotLight, Texture, Vector3,
  type Material, type Node, type RenderTarget, type Scene, type ToneMapping,
} from 'three/webgpu';
import { clamp, float, max, mix, pow, screenUV, step, texture, toneMapping, uniform, vec3, vec4 } from 'three/tsl';
import { createGpuDeviceOwner, type GpuDeviceOwner } from '#lib/platform/gpu/studio/gpu-device-owner.ts';
import { createGpuCanvasOutput, type GpuCanvasOutput } from '#lib/platform/gpu/studio/gpu-canvas-output.ts';
import { isThreeGeometryDrawable, type StudioThreeRenderer } from '#lib/platform/gpu/studio/studio-three-renderer.ts';
import { createLensCompositor } from '#lib/picture/lens/studio/lens-compositor.ts';

/**
 * Bloom, the lens's: linear light past `threshold` (1 is white before tone mapping) spread by a gaussian `sigma`
 * frame px, times `strength`, added before tone mapping.
 */
export type ThreeBloom = { strength: number; sigma: number; threshold: number };

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

/** A full-frame pass: its fragment is `fragment` alone, with no lighting, colour space or tone mapping of three's. */
function rawPass(fragment: Node): QuadMesh & { material: NodeMaterial } {
  const material = new NodeMaterial();
  material.fragmentNode = fragment;
  Object.assign(material, { depthTest: false, depthWrite: false });
  return Object.assign(new QuadMesh(material), { material });
}

/** The output pass for one structure of look (tone mapping, transparency). */
type ThreeStageOutputPass = { key: string; pass: ReturnType<typeof rawPass> };

export type ThreeStageGpu = Awaited<ReturnType<typeof createThreeStageGpu>>;

const LINEAR_IMAGE = 'rgba16float';

/**
 * A stage's device, renderer and canvas, `width` × `height`. What changes between frames (the exposure's share, the
 * look's numbers) goes through uniforms, never a recompile.
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
  const { renderer } = three, device = owner.webgpu;
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.autoClear = false;

  const ownTexture = (label: string) => device.createTexture({
    label, size: [width, height], format: LINEAR_IMAGE, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const exposed = ownTexture('three stage exposure'), developed = ownTexture('three stage image');
  const exposedView = exposed.createView(), developedView = developed.createView();
  const lens = createLensCompositor(device, { width, height });
  const single = three.targetInto(exposed);
  let msaa: RenderTarget | null = null;
  const shown = three.targetInto(output.texture);
  const image = new ExternalTexture(developed);

  /**
   * Tone maps the lens's image and encodes it for the canvas. Encoded alone, a transparent (premultiplied) image would
   * brighten partial cover and clip added light white over a light page. So it's laid over the backdrop in linear
   * light, encoded, and the backdrop's share taken out: composited over that colour, the page shows the linear blend.
   */
  const backdrop = uniform(new Vector3()), exposure = uniform(1);
  let looked: ThreeStageOutputPass | null = null;
  const outputPass = ({ toneMapping: mapping, transparent: clear }: ThreeStageLook) => {
    const key = `${mapping}|${clear}`;
    if (looked?.key !== key) {
      looked?.pass.material.dispose();
      // Read at the pixel drawn: the lens's rows run down, as the target's do.
      const lit = texture(image, screenUV);
      // toneMapping gives a vec4 (its colour's alpha kept), whatever its types say.
      const light: Node<'vec3'> = mapping === NoToneMapping ? lit.rgb : toneMapping(mapping, exposure, lit).rgb;
      const cover: Node<'float'> = clear ? clamp(lit.a, 0, 1) : float(1);
      const uncovered = cover.oneMinus();
      const seen = encodeSrgb(light.add(backdrop.mul(uncovered)));
      looked = { key, pass: rawPass(vec4(max(seen.sub(encodeSrgb(backdrop).mul(uncovered)), vec3(0)), cover)) };
    }
    return looked.pass;
  };

  const rooms = new Map<string, Texture>();
  const keep = new Set<Texture>();

  return {
    owner, renderer, keep,
    /** The target exposure `index` of `count` renders into: multisampled for the frames too few to antialias themselves. */
    exposureTarget(count: number) {
      if (count >= 4) return single;
      msaa ??= three.targetInto(exposed, { samples: 4 });
      return msaa;
    },
    /**
     * A frame of `count` exposures: `addExposure` hands the lens each one just rendered, then `show` develops them,
     * looked at as `look` says, onto the canvas.
     */
    beginFrame(count: number) {
      const frame = lens.beginFrame(count);
      const submitted = (label: string, encode: (encoder: GPUCommandEncoder) => void) => {
        const encoder = device.createCommandEncoder({ label });
        encode(encoder);
        lens.flush();
        device.queue.submit([encoder.finish()]);
      };
      return {
        addExposure: () => submitted('three stage exposure', (encoder) => frame.exposureImage(encoder, exposedView)),
        show: (look: ThreeStageLook) => {
          const { bloom } = look;
          submitted('three stage develop', (encoder) => frame.develop(encoder, {
            bloom: bloom ? { sigma: bloom.sigma, strength: bloom.strength, glow: { threshold: bloom.threshold } } : null,
            into: developedView, format: LINEAR_IMAGE, encoding: { kind: 'linear' },
          }));
          backdrop.value.setFromColor(new Color(look.transparent ? look.backdrop : '#000000'));
          exposure.value = look.exposure;
          renderer.setRenderTarget(shown);
          outputPass(look).render(renderer);
          renderer.setRenderTarget(null);
          output.present();
        },
      };
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
      for (const t of [single, msaa, shown]) t?.dispose();
      looked?.pass.material.dispose();
      image.dispose();
      for (const t of rooms.values()) t.dispose();
      lens.dispose();
      exposed.destroy();
      developed.destroy();
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
