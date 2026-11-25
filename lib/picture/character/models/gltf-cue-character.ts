// gltf-cue-character.ts: an imported rigged model (glTF, a Mixamo export) as a character a score can direct, declared
// from its clips and morph targets, nothing rebuilt. A pose is a still frame of a clip, a move a clip playing, a slider
// a morph weight; a robot without brow shapes has no brow slider.
//
// The animation is a `{ time, weight }` per clip. Blending lerps weights, as three.js's mixer mixes clips, and a clip's
// time is only ever its own. A move fades its clip in inside `sample`, so its time is exact through the fade: leave
// its cue's `by` a cut. What it fades out holds at the time it had when the move began.

import { defineCueCharacter, type CueCharacter, type CueMove, type CueSlider } from '#lib/timing/character-cues/models/cue-character.ts';
import type { CuePatch, CuePath } from '#lib/timing/character-cues/models/cue-state.ts';

/**
 * What a model file is declared to hold: each clip's length in seconds, and each morph by the name a score uses, as
 * the mesh and target it lives on. Checked against the loaded file (checkGltfCueManifest), so a renamed clip fails
 * at load, naming it.
 */
export type GltfCueManifest = {
  readonly clips: { readonly [clip: string]: number };
  readonly morphs: { readonly [morph: string]: { readonly mesh: string; readonly target: string } };
};

/** One clip's place in a frame: how far into it, and how much it counts in the mix. */
export type GltfClipSample = { readonly time: number; readonly weight: number };

export type GltfClipName<M extends GltfCueManifest> = keyof M['clips'] & string;
export type GltfMorphName<M extends GltfCueManifest> = keyof M['morphs'] & string;

/** A model's whole state: every clip's sample, and every morph's weight. */
export type GltfCueState<M extends GltfCueManifest> = {
  readonly animation: { readonly [C in GltfClipName<M>]: GltfClipSample };
  readonly morphs: { readonly [K in GltfMorphName<M>]: number };
};

/** A still: `clip` held at `time` seconds. */
export type GltfClipPose<M extends GltfCueManifest> = { readonly clip: GltfClipName<M>; readonly time: number };

/**
 * A clip played from its start: once (holding its last frame) or looping, faded in over `fade` seconds (0.25 unless
 * given). `markers` name moments in it a cue can align on, as a jump's `land`.
 */
export type GltfClipMove<M extends GltfCueManifest> = {
  readonly clip: GltfClipName<M>;
  readonly loop?: boolean;
  readonly fade?: number;
  readonly markers?: { readonly [name: string]: number };
};

/** Some morphs' weights together: an expression, as VRM names `happy` or `blink`. */
export type GltfMorphPatch<M extends GltfCueManifest> = { readonly [K in GltfMorphName<M>]?: number };

const DEFAULT_FADE_SECONDS = 0.25;

type GltfDeclaration<M extends GltfCueManifest, P, V, E> = {
  readonly poses: { readonly [K in keyof P]: CuePatch<GltfCueState<M>> };
  readonly expressions: { readonly [K in keyof E]: CuePatch<GltfCueState<M>> };
  readonly sliders: { readonly [K in GltfMorphName<M>]: CueSlider<GltfCueState<M>> };
  readonly moves: { readonly [K in keyof V]: CueMove<GltfCueState<M>> & Pick<V[K], 'markers' & keyof V[K]> };
};

const mapValues = <K extends string, A, B>(record: { readonly [key in K]: A }, f: (value: A, key: K) => B): { [key in K]: B } =>
  // SAFETY: fromEntries over a record's own entries keeps exactly its keys.
  Object.fromEntries(Object.entries<A>(record).map(([key, value]) => [key, f(value, key as K)])) as { [key in K]: B };

/**
 * A model as a CueCharacter: it starts in `rest`'s first frame; `poses` are clip stills, `moves` clips playing,
 * `expressions` morph patches, and every morph is a 0–1 slider by its manifest name.
 */
export function gltfCueCharacter<
  const M extends GltfCueManifest,
  const P extends { readonly [name: string]: GltfClipPose<M> },
  const V extends { readonly [name: string]: GltfClipMove<M> },
  const E extends { readonly [name: string]: GltfMorphPatch<M> },
>(manifest: M, options: { readonly rest: GltfClipName<M>; readonly poses: P; readonly moves: V; readonly expressions: E }): CueCharacter<GltfCueState<M>, GltfDeclaration<M, P, V, E>> {
  type S = GltfCueState<M>;
  // SAFETY: M's clip keys are GltfClipName<M> by definition; the readonly record only loses that literal view.
  const clips = manifest.clips as { readonly [C in GltfClipName<M>]: number };
  const still = (clip: GltfClipName<M>, time: number): S['animation'] => mapValues(clips, (_, name) => ({ time: name === clip ? time : 0, weight: name === clip ? 1 : 0 }));
  // SAFETY: as clips above: M's morph keys are GltfMorphName<M>.
  const morphNames = manifest.morphs as { readonly [K in GltfMorphName<M>]: GltfCueManifest['morphs'][string] };
  const initial: S = { animation: still(options.rest, 0), morphs: mapValues(morphNames, () => 0) };
  // SAFETY: each clip of M is a key of S's animation, and every clip sample holds a weight.
  const weightPaths = Object.keys(clips).map((name) => `animation.${name}.weight`) as readonly CuePath<S>[];
  const move = (play: GltfClipMove<M>): CueMove<S> => {
    const length = manifest.clips[play.clip], fade = play.fade ?? DEFAULT_FADE_SECONDS;
    return {
      // A return fades weights back; each clip's playhead holds, never scrubbing backwards.
      writes: ['animation'], returns: weightPaths, ...(play.markers && { markers: play.markers }), ...(!play.loop && { seconds: length }),
      sample: (s, entry) => {
        const own = play.loop ? s % length : Math.min(s, length), into = fade > 0 ? Math.min(1, s / fade) : 1;
        const animation = mapValues(entry.animation, (was, name) => (name === play.clip
          ? { time: own, weight: into + (1 - into) * was.weight }
          : { time: was.time, weight: (1 - into) * was.weight }));
        // SAFETY: the whole animation subtree, clip for clip, is a patch of S; TypeScript can't see through the mapped M.
        return { animation } as CuePatch<S>;
      },
    };
  };
  // SAFETY: each table is mapped key for key from the options and manifest it is typed by.
  return defineCueCharacter<S, GltfDeclaration<M, P, V, E>>(initial, {
    poses: mapValues(options.poses, (pose) => ({ animation: still(pose.clip, pose.time) })),
    expressions: mapValues(options.expressions, (patch) => ({ morphs: patch })),
    sliders: mapValues(morphNames, (_, name) => ({ path: `morphs.${name}`, min: 0, max: 1 })),
    moves: mapValues(options.moves, move),
  } as GltfDeclaration<M, P, V, E>);
}

/** What a loaded file holds, as checkGltfCueManifest compares it: its clips' lengths, and each mesh's morph targets. */
export type GltfFileContents = {
  readonly clips: readonly { readonly name: string; readonly seconds: number }[];
  readonly morphs: readonly { readonly mesh: string; readonly targets: readonly string[] }[];
};

/** How far a clip's length may drift from its manifest's, in seconds: under a frame at 60. */
const CLIP_LENGTH_TOLERANCE = 0.01;

/** Throws naming every clip or morph the manifest declares that `found` lacks, or a clip whose length differs. */
export function checkGltfCueManifest(name: string, manifest: GltfCueManifest, found: GltfFileContents): void {
  const problems: string[] = [];
  for (const [clip, seconds] of Object.entries(manifest.clips)) {
    const there = found.clips.find((c) => c.name === clip);
    if (!there) problems.push(`no clip ${clip} (it has ${found.clips.map((c) => c.name).join(', ') || 'none'})`);
    else if (Math.abs(there.seconds - seconds) > CLIP_LENGTH_TOLERANCE) problems.push(`clip ${clip} lasts ${there.seconds.toFixed(3)} s, not ${seconds}`);
  }
  for (const [morph, { mesh, target }] of Object.entries(manifest.morphs)) {
    const meshes = found.morphs.filter((m) => m.mesh === mesh);
    if (!meshes.length) problems.push(`morph ${morph}: no mesh ${mesh} with morph targets (those with some: ${[...new Set(found.morphs.map((m) => m.mesh))].join(', ') || 'none'})`);
    else if (!meshes.some((m) => m.targets.includes(target))) problems.push(`morph ${morph}: mesh ${mesh} has no target ${target} (it has ${[...new Set(meshes.flatMap((m) => m.targets))].join(', ')})`);
  }
  if (problems.length) throw new Error(`${name} doesn't match its manifest: ${problems.join('; ')}`);
}
