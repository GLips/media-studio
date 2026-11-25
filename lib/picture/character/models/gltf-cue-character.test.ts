import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defineLookCatalog } from '#lib/paint/looks/models/look-catalog.ts';
import { compileCueScore } from '#lib/timing/character-cues/models/cue-tracks.ts';
import { defineTimeline, fixedSpan } from '#lib/timing/timeline/models/timeline.ts';
import { checkGltfCueManifest, gltfCueCharacter } from './gltf-cue-character.ts';

const manifest = {
  clips: { Idle: 3.3333, Wave: 1.8333 },
  morphs: { surprised: { mesh: 'Head', target: 'Surprised' } },
} as const;
const robot = gltfCueCharacter(manifest, {
  rest: 'Idle', poses: { still: { clip: 'Idle', time: 0 } }, moves: { idle: { clip: 'Idle', loop: true }, wave: { clip: 'Wave', fade: 0.5 } }, expressions: {},
});
const clock = defineTimeline({ scenes: { a: fixedSpan(6, { cues: { go: 0, hi: 2 } }) } }).clock('a');
const cast = { character: robot, looks: defineLookCatalog({ own: { palettes: ['own'], sampling: 'live' } }), camera: {} };

test('a crossfade between two clips keeps each clip on its own time, its weights summing to 1', () => {
  const score = compileCueScore(clock, cast, [{ at: 'go', move: { name: 'idle' } }, { at: 'hi', move: { name: 'wave' } }]);
  const { Idle, Wave } = score.sample(2.25).character.animation;
  // A quarter second into the wave's half-second fade: the wave plays from its own start, the idle holds where it was.
  assert.ok(Math.abs(Wave.time - 0.25) < 1e-9 && Math.abs(Idle.time - 2) < 1e-9);
  assert.ok(Math.abs(Wave.weight - 0.5) < 1e-9 && Math.abs(Idle.weight + Wave.weight - 1) < 1e-9);
  // Looping: the idle wraps; once faded, the wave alone counts, and holds its last frame.
  assert.ok(Math.abs(compileCueScore(clock, cast, [{ at: 'go', move: { name: 'idle' } }]).sample(4).character.animation.Idle.time - (4 - 3.3333)) < 1e-9);
  assert.deepEqual(score.sample(5).character.animation.Wave, { time: 1.8333, weight: 1 });
  // A returning wave fades its weight back to the idle, its playhead held on its last frame rather than rewound.
  const back = compileCueScore(clock, cast, [{ at: 'hi', move: { name: 'wave', end: { return: { ease: { seconds: 0.4 } } } } }]);
  const fading = back.sample(2 + 1.8333 + 0.2).character.animation;
  assert.ok(Math.abs(fading.Wave.time - 1.8333) < 1e-9 && fading.Wave.weight > 0 && fading.Wave.weight < 1);
});

test('a file missing a declared clip or morph target fails to load, naming each', () => {
  assert.throws(
    () => checkGltfCueManifest('robot.glb', manifest, { clips: [{ name: 'Idle', seconds: 3.3333 }], morphs: [{ mesh: 'Head', targets: ['Angry'] }] }),
    /no clip Wave.*morph surprised: mesh Head has no target Surprised/,
  );
});
