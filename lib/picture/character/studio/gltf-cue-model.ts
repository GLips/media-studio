// gltf-cue-model.ts: an imported model posed from a cue frame, the same picture whichever frame is drawn first. Each
// frame clones the loaded scene, sets every weighted clip's time and weight on a fresh mixer, evaluates it once with
// no time passing, and sets the morph weights. No mixer, action or pose survives between frames, so nothing
// accumulates. The clone shares the source's geometry and materials; ThreeStage freeing them after a frame only
// drops their GPU copies, which the next frame uploads again.

import { AnimationClip, AnimationMixer, type Mesh, type Object3D, VectorKeyframeTrack } from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  checkGltfCueManifest, type GltfClipName, type GltfCueManifest, type GltfCueState, type GltfFileContents,
} from '#lib/picture/character/models/gltf-cue-character.ts';

/**
 * What becomes of a clip's movement of the whole model. `'keep'`: as authored. `{ inPlace: node }`: that node's
 * sideways travel is dropped and its rise kept, so a walk stays on its mark and `position` cues alone move it.
 */
export type GltfRootMotion = 'keep' | { readonly inPlace: string };

/** A model file loaded and checked against its manifest, ready to pose. */
export type GltfCueModel<M extends GltfCueManifest> = {
  readonly manifest: M;
  readonly scene: Object3D;
  readonly clips: ReadonlyMap<string, AnimationClip>;
};

/** A .glb's bytes from the base64 a generated module holds (a scene can't read a file, so models ship as modules). */
export const gltfCueGlbBytes = (base64: string): ArrayBuffer => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)).buffer;

// three's own test: GLTFLoader builds its meshes from 'three', a different module from 'three/webgpu' in a bundle, so
// instanceof Mesh fails on them.
// SAFETY: Partial only reads isMesh, which every Object3D lacks or sets to true for a mesh.
const isMesh = (node: Object3D): node is Mesh => (node as Partial<Mesh>).isMesh === true;

// A mesh of several primitives loads as one mesh each, and GLTFLoader keeps names unique with a `_<n>` suffix (Head
// becomes Head_1 to Head_4), so a manifest's mesh answers to its name with any such suffix dropped. A mesh whose own
// name ends `_<digits>` can't be told apart from a renamed one.
const gltfMeshName = (name: string) => name.replace(/_\d+$/, '');

const inPlace = (clip: AnimationClip, node: string): AnimationClip => new AnimationClip(clip.name, clip.duration, clip.tracks.map((track) => {
  if (track.name !== `${node}.position` || track.ValueTypeName !== 'vector') return track;
  // x and z held at the first key's, y as authored.
  const values = Float32Array.from(track.values, (value, k) => (k % 3 === 1 ? value : track.values[k % 3]));
  return new VectorKeyframeTrack(track.name, Array.from(track.times), Array.from(values));
}));

/** Parses `glb`, checks it holds what `manifest` declares (throwing, named `name`, if not), and readies its clips. */
export async function loadGltfCueModel<const M extends GltfCueManifest>(name: string, glb: ArrayBuffer, manifest: M, rootMotion: GltfRootMotion = 'keep'): Promise<GltfCueModel<M>> {
  const gltf = await new GLTFLoader().parseAsync(glb, '');
  const morphs: { mesh: string; targets: string[] }[] = [];
  gltf.scene.traverse((node) => {
    if (!isMesh(node) || !node.morphTargetDictionary) return;
    morphs.push({ mesh: gltfMeshName(node.name), targets: Object.keys(node.morphTargetDictionary) });
  });
  const found: GltfFileContents = { clips: gltf.animations.map((clip) => ({ name: clip.name, seconds: clip.duration })), morphs };
  checkGltfCueManifest(name, manifest, found);
  if (rootMotion !== 'keep' && !gltf.animations.some((clip) => clip.tracks.some((track) => track.name === `${rootMotion.inPlace}.position`))) {
    throw new Error(`${name}: no clip moves a node ${rootMotion.inPlace}, so it can't be held in place (GLTFLoader may have renamed it)`);
  }
  const clips = new Map(gltf.animations.map((clip) => [clip.name, rootMotion === 'keep' ? clip : inPlace(clip, rootMotion.inPlace)]));
  return { manifest, scene: gltf.scene, clips };
}

/** `model` posed as `state` says: a fresh copy each call, with its clips mixed by weight and its morphs set. */
export function gltfCueModelPosed<M extends GltfCueManifest>(model: GltfCueModel<M>, state: GltfCueState<M>): Object3D {
  const posed = clone(model.scene), mixer = new AnimationMixer(posed);
  // SAFETY: a state's animation holds one sample per clip of M, keyed by its name.
  for (const [name, sample] of Object.entries(state.animation) as [GltfClipName<M>, GltfCueState<M>['animation'][GltfClipName<M>]][]) {
    if (sample.weight <= 0) continue;
    const action = mixer.clipAction(model.clips.get(name)!);
    action.play();
    action.setEffectiveWeight(sample.weight);
    action.time = sample.time;
  }
  mixer.update(0);
  for (const [morph, weight] of Object.entries<number>(state.morphs)) {
    const { mesh, target } = model.manifest.morphs[morph];
    posed.traverse((node) => {
      if (!isMesh(node) || !node.morphTargetDictionary || !node.morphTargetInfluences) return;
      if (gltfMeshName(node.name) !== mesh) return;
      const index = node.morphTargetDictionary[target];
      if (index !== undefined) node.morphTargetInfluences[index] = weight;
    });
  }
  return posed;
}
