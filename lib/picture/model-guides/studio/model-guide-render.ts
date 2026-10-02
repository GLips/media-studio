// model-guide-render.ts: a model's guides (model-guides.ts) rendered on an owner's one three/webgpu renderer and read
// back. Every mesh is drawn into float targets at once (MRT), as many passes as the device's colour attachments
// need, with a guide material made from its own: that keeps its positionNode, so skinning, morphs and any node
// deformer pose it as its own material would. Rest position is the geometry's, read before any of them.
//
// Negative space: no multisampling. A guide's texels are one surface's values each; averaging an object id or
// a field across an edge would make values no surface has.

import { FloatType, MeshBasicNodeMaterial, NearestFilter, NodeMaterial, PerspectiveCamera, RenderTarget, type Material, type Node, type Object3D, type Scene } from 'three/webgpu';
import { attribute, dot, float, mrt, normalize, normalView, normalWorld, positionGeometry, positionView, uniform, vec4 } from 'three/tsl';
import type { GpuDeviceOwner } from '#lib/platform/gpu/studio/gpu-device-owner.ts';
import { isThreeGeometryDrawable, type ThreeGeometryDrawable } from '#lib/platform/gpu/studio/studio-three-renderer.ts';
import { setThreeShotCamera } from '#lib/picture/shot-camera/studio/three-shot-camera.ts';
import type { ShotCamera } from '#lib/picture/shot-camera/models/shot-camera.ts';
import type { FrameSize } from '#lib/picture/frame/models/frame.ts';
import {
  MODEL_GUIDE_MAX_MESH_ID, MODEL_GUIDE_TEXEL_BYTES, MODEL_GUIDE_TEXEL_FLOATS, modelGuideLayout, modelGuidePasses, type ModelGuideLayout, type ModelGuides,
} from '../models/model-guides.ts';

/**
 * What a guide is of: `scene`'s visible meshes seen through `camera`, carrying `regions` (vertex attributes all of
 * them have). `objectIds` names what each mesh is: a mesh's `object` is the id of it or its nearest ancestor there,
 * an integer from 1 (0 is no mesh), so the same request gives the same ids on every run.
 */
export type ModelGuideRequest = {
  readonly camera: ShotCamera;
  readonly scene: Scene;
  readonly regions: readonly string[];
  readonly objectIds: ReadonlyMap<Object3D, number>;
};

export type ModelGuideRenderer = {
  /**
   * The guides of `request`, read back. The scene is drawn as it stands (its meshes' world matrices, skeletons and
   * morph weights); its background, and every mesh's own material, are set aside while it's drawn. Requests run
   * one after another, each drawn and read back whole: they share the targets.
   */
  renderModelGuides: (request: ModelGuideRequest) => Promise<ModelGuides>;
  /** Lets go of the targets and materials once the requests made before it finish; the owner and its renderer are the caller's. */
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

const meshName = (object: Object3D) => object.name || `mesh ${object.id}`;

/**
 * The meshes `request` draws, each with its guide id, or a thrown error naming those lacking a region (it would
 * read as a field of 0) or an id, and any id that isn't a whole number from 1 that a float holds exactly.
 */
function modelGuideDrawnMeshes({ scene, regions, objectIds }: ModelGuideRequest): Map<ThreeGeometryDrawable, number> {
  const bad = [...objectIds.values()].filter((id) => !(Number.isInteger(id) && id >= 1 && id <= MODEL_GUIDE_MAX_MESH_ID));
  if (bad.length) throw new Error(`model guides: an object id is a whole number from 1 to ${MODEL_GUIDE_MAX_MESH_ID}, not ${bad.join(', ')}`);
  const drawn = new Map<ThreeGeometryDrawable, number>(), problems: string[] = [];
  scene.traverseVisible((object) => {
    if (!isThreeGeometryDrawable(object)) return;
    const lacks = regions.filter((name) => !object.geometry.hasAttribute(name));
    if (lacks.length) problems.push(`${meshName(object)} lacks ${lacks.join(', ')}`);
    let named: Object3D | null = object;
    while (named && !objectIds.has(named)) named = named.parent;
    const id = named && objectIds.get(named);
    if (id) drawn.set(object, id);
    else problems.push(`${meshName(object)} has no object id`);
  });
  if (problems.length) throw new Error(`model guides: every mesh drawn carries the regions asked for and has an object id: ${problems.join('; ')}`);
  return drawn;
}

/**
 * The guide material drawing in `source`'s stead: its place (positionNode) and sides are the source's, so whatever
 * deforms the mesh deforms its guide. Made once per source and kept in `made`, its node rebuilt if the source's changed.
 */
function guideMaterialFor(source: Material, made: Map<Material, MeshBasicNodeMaterial>): MeshBasicNodeMaterial {
  let guide = made.get(source);
  if (!guide) {
    guide = new MeshBasicNodeMaterial();
    made.set(source, guide);
  }
  const positionNode = source instanceof NodeMaterial ? source.positionNode : null;
  if (guide.positionNode !== positionNode || guide.side !== source.side) {
    Object.assign(guide, { positionNode, side: source.side, needsUpdate: true });
  }
  return guide;
}

/** A guide renderer on `owner`'s three.js renderer, keeping its targets between renders of the same frame and regions. */
export async function createModelGuideRenderer(owner: GpuDeviceOwner): Promise<ModelGuideRenderer> {
  const { renderer } = await owner.three();
  const { maxColorAttachments, maxColorAttachmentBytesPerSample } = owner.webgpu.limits;
  const perPass = Math.min(maxColorAttachments, Math.floor(maxColorAttachmentBytesPerSample / MODEL_GUIDE_TEXEL_BYTES));
  const threeCamera = new PerspectiveCamera();
  // The guide id of the mesh being drawn, looked up per draw from the request being drawn.
  let drawnIds: ReadonlyMap<Object3D, number> = new Map();
  const objectId = uniform(0).onObjectUpdate(({ object }) => (object && drawnIds.get(object)) ?? 0);
  const guideMaterials = new Map<Material, MeshBasicNodeMaterial>();

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

  const draw = (scene: Scene, drawn: Map<ThreeGeometryDrawable, number>, { outputs, passes }: Setup) => {
    const saved = { target: renderer.getRenderTarget(), mrt: renderer.getMRT(), autoClear: renderer.autoClear, background: scene.background, override: scene.overrideMaterial };
    const ownMaterials = new Map([...drawn.keys()].map((mesh) => [mesh, mesh.material]));
    try {
      renderer.setMRT(outputs);
      renderer.autoClear = true;
      // A scene's own override would draw in place of every guide material.
      Object.assign(scene, { background: null, overrideMaterial: null });
      drawnIds = drawn;
      for (const [mesh, own] of ownMaterials) {
        mesh.material = Array.isArray(own) ? own.map((m) => guideMaterialFor(m, guideMaterials)) : guideMaterialFor(own, guideMaterials);
      }
      for (const target of passes) {
        renderer.setRenderTarget(target);
        renderer.render(scene, threeCamera);
      }
    } finally {
      renderer.setRenderTarget(saved.target);
      renderer.setMRT(saved.mrt);
      renderer.autoClear = saved.autoClear;
      Object.assign(scene, { background: saved.background, overrideMaterial: saved.override });
      for (const [mesh, own] of ownMaterials) mesh.material = own;
      drawnIds = new Map();
    }
  };

  // The requests made so far, each run whole before the next starts; dispose waits its turn too.
  let queue: Promise<unknown> = Promise.resolve(), disposed = false;
  const inTurn = <T,>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work);
    queue = run.catch(() => {});
    return run;
  };

  const renderInTurn = async (request: ModelGuideRequest): Promise<ModelGuides> => {
    const { camera, scene, regions } = request;
    const drawn = modelGuideDrawnMeshes(request);
    const made = setupFor(camera.frame, regions), { width, height } = camera.frame;
    setThreeShotCamera(threeCamera, camera);
    await owner.checked('rendering model guides', () => draw(scene, drawn, made));
    const reads = await owner.checkedAsync('reading model guides back', () => Promise.all(made.passes.flatMap((target) => target.textures.map((_, k) => renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height, k)))));
    const targets = reads.map((read) => {
      if (!(read instanceof Float32Array)) throw new Error(`model guides: a float target read back as ${read.constructor.name}`);
      return modelGuideRowsUnpadded(read, camera.frame);
    });
    return { frame: camera.frame, layout: made.layout, targets };
  };

  return {
    renderModelGuides: (request) => (disposed ? Promise.reject(new Error('model guides: this guide renderer was disposed')) : inTurn(() => renderInTurn(request))),
    dispose: () => {
      disposed = true;
      void inTurn(async () => {
        for (const target of setup?.passes ?? []) target.dispose();
        for (const guide of guideMaterials.values()) guide.dispose();
        guideMaterials.clear();
      });
    },
  };
}
