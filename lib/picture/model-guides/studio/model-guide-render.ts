// model-guide-render.ts: a model's guides (model-guides.ts) rendered on an owner's one three/webgpu renderer and read
// back. Every mesh of a guide scene is drawn with one guide material into float targets at once (MRT), as many
// passes as the device's colour attachments need; skinning and morphs pose it as three would, and rest position
// is the geometry's own, read before either.
//
// Negative space: no multisampling. A guide's texels are one surface's values each; averaging an object id or
// a field across an edge would make values no surface has.

import { FloatType, MeshBasicNodeMaterial, NearestFilter, PerspectiveCamera, RenderTarget, type Node, type Scene } from 'three/webgpu';
import { attribute, dot, float, mrt, normalize, normalView, normalWorld, positionGeometry, positionView, uniform, vec4 } from 'three/tsl';
import type { GpuDeviceOwner } from '#lib/platform/gpu/studio/gpu-device-owner.ts';
import { isThreeGeometryDrawable } from '#lib/platform/gpu/studio/studio-three-renderer.ts';
import { setThreeShotCamera } from '#lib/picture/shot-camera/studio/three-shot-camera.ts';
import type { ShotCamera } from '#lib/picture/shot-camera/models/shot-camera.ts';
import type { FrameSize } from '#lib/picture/frame/models/frame.ts';
import {
  MODEL_GUIDE_TEXEL_BYTES, MODEL_GUIDE_TEXEL_FLOATS, modelGuideLayout, modelGuidePasses, type ModelGuideLayout, type ModelGuides,
} from '../models/model-guides.ts';

/** What a guide is of: `scene`'s visible meshes seen through `camera`, carrying `regions` (vertex attributes all of them have). */
export type ModelGuideRequest = { readonly camera: ShotCamera; readonly scene: Scene; readonly regions: readonly string[] };

export type ModelGuideRenderer = {
  /**
   * The guides of `request`, read back. The scene is drawn as it stands (its meshes' world matrices, skeletons and
   * morph weights); its background, and every mesh's own material, are set aside while it's drawn.
   */
  renderModelGuides: (request: ModelGuideRequest) => Promise<ModelGuides>;
  /** Lets go of the targets and the material; the owner and its renderer are the caller's. */
  dispose: () => void;
};

/**
 * The MRT outputs for `layout`, each target named as the layout names it and cleared to 0 (a target past the first
 * otherwise clears to opaque black, an `object` of 0 but a field of 0 too).
 */
function guideOutputs({ regions, targets }: ModelGuideLayout, objectId: Node<'float'>) {
  const toEye = normalize(positionView.negate());
  const fields: Node<'float'>[] = [objectId, ...regions.map((name) => attribute<'float'>(name, 'float'))];
  while (fields.length % MODEL_GUIDE_TEXEL_FLOATS) fields.push(float(0));
  const outputs: Record<string, Node> = {
    surface: vec4(normalize(normalWorld), dot(normalize(normalView), toEye)),
    place: vec4(positionGeometry, positionView.z.negate()),
  };
  for (let k = 0; k < fields.length / MODEL_GUIDE_TEXEL_FLOATS; k++) {
    const [x, y, z, w] = fields.slice(k * 4, k * 4 + 4);
    outputs[`fields${k}`] = vec4(x, y, z, w);
  }
  const node = mrt(outputs);
  for (const name of targets) node.setClearColor(name, 0, 0);
  return node;
}

/** `read`'s rows, padded to 256 bytes as a read back is, laid tight as a guide's are. */
function modelGuideRowsUnpadded(read: Float32Array, { width, height }: FrameSize): Float32Array {
  const row = width * MODEL_GUIDE_TEXEL_FLOATS, stride = Math.ceil((row * 4) / 256) * 64;
  if (stride === row) return read;
  const out = new Float32Array(row * height);
  for (let j = 0; j < height; j++) out.set(read.subarray(j * stride, j * stride + row), j * row);
  return out;
}

/** The meshes `scene` will draw that lack one of `regions`, named: a missing attribute would read as a field of 0. */
function meshesMissingRegions(scene: Scene, regions: readonly string[]): string[] {
  const missing: string[] = [];
  scene.traverseVisible((object) => {
    if (!isThreeGeometryDrawable(object)) return;
    const lacks = regions.filter((name) => !object.geometry.hasAttribute(name));
    if (lacks.length) missing.push(`${object.name || `mesh ${object.id}`} (${lacks.join(', ')})`);
  });
  return missing;
}

/** A guide renderer on `owner`'s three.js renderer, keeping its targets between renders of the same frame and regions. */
export async function createModelGuideRenderer(owner: GpuDeviceOwner): Promise<ModelGuideRenderer> {
  const { renderer } = await owner.three();
  const { maxColorAttachments, maxColorAttachmentBytesPerSample } = owner.webgpu.limits;
  const perPass = Math.min(maxColorAttachments, Math.floor(maxColorAttachmentBytesPerSample / MODEL_GUIDE_TEXEL_BYTES));
  const threeCamera = new PerspectiveCamera();
  // three's Object3D.id of the mesh being drawn, set per draw, so one material serves every mesh.
  const objectId = uniform(0).onObjectUpdate(({ object }) => object?.id ?? 0);
  const material = new MeshBasicNodeMaterial();

  type Setup = { key: string; layout: ModelGuideLayout; outputs: ReturnType<typeof guideOutputs>; passes: RenderTarget[] };
  let setup: Setup | null = null;
  const setupFor = ({ width, height }: FrameSize, regions: readonly string[]): Setup => {
    const key = `${width}x${height}|${regions.join(',')}`;
    if (setup?.key === key) return setup;
    for (const target of setup?.passes ?? []) target.dispose();
    const layout = modelGuideLayout(regions);
    const passes = modelGuidePasses(layout, perPass).map((indices) => {
      const target = new RenderTarget(width, height, { count: indices.length, type: FloatType, depthBuffer: true, minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false });
      indices.forEach((index, k) => { target.textures[k].name = layout.targets[index]; });
      return target;
    });
    setup = { key, layout, outputs: guideOutputs(layout, objectId), passes };
    return setup;
  };

  const draw = (scene: Scene, { outputs, passes }: Setup) => {
    const saved = { target: renderer.getRenderTarget(), mrt: renderer.getMRT(), autoClear: renderer.autoClear, override: scene.overrideMaterial, background: scene.background };
    try {
      renderer.setMRT(outputs);
      renderer.autoClear = true;
      Object.assign(scene, { overrideMaterial: material, background: null });
      for (const target of passes) {
        renderer.setRenderTarget(target);
        renderer.render(scene, threeCamera);
      }
    } finally {
      renderer.setRenderTarget(saved.target);
      renderer.setMRT(saved.mrt);
      renderer.autoClear = saved.autoClear;
      Object.assign(scene, { overrideMaterial: saved.override, background: saved.background });
    }
  };

  return {
    renderModelGuides: async ({ camera, scene, regions }) => {
      const missing = meshesMissingRegions(scene, regions);
      if (missing.length) throw new Error(`model guides: every mesh carries the regions asked for; these lack some: ${missing.join('; ')}`);
      const made = setupFor(camera.frame, regions), { width, height } = camera.frame;
      setThreeShotCamera(threeCamera, camera);
      await owner.checked('rendering model guides', () => draw(scene, made));
      const reads = await owner.checkedAsync('reading model guides back', () => Promise.all(made.passes.flatMap((target) => target.textures.map((_, k) => renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height, k)))));
      const targets = reads.map((read) => {
        if (!(read instanceof Float32Array)) throw new Error(`model guides: a float target read back as ${read.constructor.name}`);
        return modelGuideRowsUnpadded(read, camera.frame);
      });
      return { frame: camera.frame, layout: made.layout, targets };
    },
    dispose: () => {
      for (const target of setup?.passes ?? []) target.dispose();
      material.dispose();
    },
  };
}
