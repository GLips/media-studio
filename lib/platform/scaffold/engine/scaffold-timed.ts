// scaffold-timed.ts: a timed project's starting files, for new-project.ts: its plan in storyboard.ts, a row per
// scene, and a file per scene blocked in flat pieces on its cues (blockingScene), so it renders and reviews as an
// animatic before anything is drawn. The workspace retime check times every storyboard, so it needs no test.
//
// Music-led, the scenes are bars on a steady tempo, the last ending on the music's final hit (a landmark, pending
// until a fitted track replaces the tempo). Voice-led, they are lines with a word cue each, timed by word count until
// `studio voice` reads them. Mixed puts bars between a voiced open and close. Silent, they are fixed seconds, and the
// video plays no sound at all.

import type { ProjectCapability } from '#lib/platform/project/models/capability.ts';
import { voiceManifestModule } from '#lib/timing/voice/engine/voice-project.ts';

type TimedCapability = Exclude<ProjectCapability, 'still-only'>;

/**
 * One scene as scaffolded: where its file goes, its storyboard row's fields as source (`onScreen`, `motion`, then
 * its driver and cues, a line each), and its blocking's pieces as source, each keyed to one of those cues.
 */
type StarterScene = { id: string; folder: 'bars' | 'scenes'; driver: 'beats' | 'lines' | 'seconds'; row: readonly string[]; pieces: string };

const BARS: readonly StarterScene[] = [
  {
    id: 'hook', folder: 'bars', driver: 'beats',
    row: ["onScreen: 'The hook: one image.'", "motion: 'It hits on the downbeat.'", 'beats: 4,', 'cues: { hit: 0 },'],
    pieces: `{ kind: 'image', name: 'hook image', pose: { x: 360, y: 150, w: 1200, h: 675, opacity: 0, scale: 1.2 }, keys: [{ at: clock.cues.hit, to: { opacity: 1, scale: 1 }, over: 5 }] },`,
  },
  {
    id: 'turn', folder: 'bars', driver: 'beats',
    row: ["onScreen: 'The turn: what changes.'", "motion: 'The after slides over the before on beat 2.'", 'beats: 4,', 'cues: { reveal: 2 },'],
    pieces: `{ kind: 'box', name: 'before', pose: { x: 360, y: 240, w: 1200, h: 600 }, keys: [{ at: clock.cues.reveal, to: { x: -1300 }, over: 8 }] },
    { kind: 'box', name: 'after', color: '#9fb0c9', pose: { x: 1960, y: 240, w: 1200, h: 600 }, keys: [{ at: clock.cues.reveal, to: { x: 360 }, over: 8 }] },`,
  },
  {
    id: 'payoff', folder: 'bars', driver: 'beats',
    row: ["onScreen: 'The payoff: the name.'", 'motion: "The name comes up and holds to the music\'s final hit."', 'beats: 4,', "cues: { stop: 'end' },"],
    pieces: `{ kind: 'type', name: 'name', text: 'The name', pose: { x: 560, y: 470, w: 800, h: 140, opacity: 0, scale: 0.8 }, keys: [{ at: clock.beat(0), to: { opacity: 1, scale: 1 }, over: 6 }] },`,
  },
];
const voicedOpen = (title: string): StarterScene => ({
  id: 'title', folder: 'scenes', driver: 'lines',
  row: [
    "onScreen: 'The title, beside the product.'", "motion: 'The title comes up as the line names what this is.'",
    `lines: { intro: { text: ${JSON.stringify(`Here's a quick look at ${title}.`)}, cues: { look: 'quick look' } } },`,
    'timing: { lead: 1.4, tail: 1.0 },',
  ],
  pieces: `{ kind: 'image', name: 'the product', pose: { x: 960, y: 160, w: 840, h: 640, opacity: 0 }, keys: [{ at: 0, to: { opacity: 1 }, over: 15 }] },
    { kind: 'type', name: 'title', text: 'The title', pose: { x: 140, y: 420, w: 700, h: 120, opacity: 0 }, keys: [{ at: clock.cues.look, to: { opacity: 1, y: 400 }, over: 10 }] },`,
});
const VOICED_CLOSE: StarterScene = {
  id: 'outro', folder: 'scenes', driver: 'lines',
  row: [
    "onScreen: 'The takeaways, then the end card.'", "motion: 'The end card fades in as the thanks is said.'",
    "lines: { outro: { text: 'That’s it. Thanks for watching.', paragraph: true, cues: { thanks: 'thanks' } } },",
    'timing: { lead: 0.6, tail: 3.4, crossfade: 0.5 },',
  ],
  pieces: `{ kind: 'box', name: 'takeaways', pose: { x: 360, y: 200, w: 1200, h: 560 } },
    { kind: 'box', name: 'end card', color: '#9fb0c9', pose: { x: 0, y: 0, w: 1920, h: 1080, opacity: 0 }, keys: [{ at: clock.cues.thanks, to: { opacity: 1 }, over: 12 }] },`,
};

const FIXED: readonly StarterScene[] = [
  {
    id: 'open', folder: 'scenes', driver: 'seconds',
    row: ["onScreen: 'The open: the name, then what it promises.'", "motion: 'The name rises in, then the promise under it.'", 'seconds: 3,', 'cues: { name: 0.4, promise: 1.4 },'],
    pieces: `{ kind: 'type', name: 'name', text: 'The name', pose: { x: 160, y: 380, w: 900, h: 130, opacity: 0 }, keys: [{ at: clock.cues.name, to: { opacity: 1, y: 360 }, over: 10 }] },
    { kind: 'type', name: 'promise', text: 'What it does for you', color: '#6d737d', pose: { x: 166, y: 540, w: 900, h: 56, opacity: 0 }, keys: [{ at: clock.cues.promise, to: { opacity: 1 }, over: 10 }] },`,
  },
  {
    id: 'show', folder: 'scenes', driver: 'seconds',
    row: ["onScreen: 'The show: the product, before and after.'", "motion: 'The after slides over the before.'", 'seconds: 4,', 'cues: { reveal: 1.5 },', 'timing: { crossfade: 0.5 },'],
    pieces: `{ kind: 'image', name: 'before', pose: { x: 360, y: 240, w: 1200, h: 600 }, keys: [{ at: clock.cues.reveal, to: { x: -1300 }, over: 8 }] },
    { kind: 'image', name: 'after', color: '#9fb0c9', pose: { x: 1960, y: 240, w: 1200, h: 600 }, keys: [{ at: clock.cues.reveal, to: { x: 360 }, over: 8 }] },`,
  },
  {
    id: 'close', folder: 'scenes', driver: 'seconds',
    row: ["onScreen: 'The close: the end card.'", "motion: 'It fades in.'", 'seconds: 3,', 'cues: { card: 0.8 },', 'timing: { crossfade: 0.5 },'],
    pieces: `{ kind: 'box', name: 'end card', color: '#9fb0c9', pose: { x: 0, y: 0, w: 1920, h: 1080, opacity: 0 }, keys: [{ at: clock.cues.card, to: { opacity: 1 }, over: 12 }] },`,
  },
];

const scenesOf = (capability: TimedCapability, title: string): readonly StarterScene[] => ({
  'music-led': BARS,
  'voice-led': [voicedOpen(title), VOICED_CLOSE],
  mixed: [voicedOpen(title), ...BARS, VOICED_CLOSE],
  silent: FIXED,
})[capability];

/** The length each starter is planned to, in seconds: about what its scenes run. */
const TARGET_SECONDS: Record<TimedCapability, number> = { 'music-led': 6, 'voice-led': 9, mixed: 15, silent: 10 };

export function timedStarterFiles(slug: string, title: string, capability: TimedCapability): Record<string, string> {
  const scenes = scenesOf(capability, title);
  const music = scenes.some((scene) => scene.driver === 'beats');
  const voice = scenes.some((scene) => scene.driver === 'lines');
  const files: Record<string, string> = {
    'storyboard.ts': storyboardModule(slug, title, scenes, { music, voice, target: TARGET_SECONDS[capability] }),
    'video.tsx': videoModule(title, scenes, { music, voice }),
  };
  for (const scene of scenes) files[`${scene.folder}/${scene.id}.tsx`] = sceneModule(scene);
  // No line is read yet: until `studio voice` is, the storyboard times each from its word count.
  if (voice) files['audio/manifest.ts'] = voiceManifestModule({});
  return files;
}

function storyboardModule(slug: string, title: string, scenes: readonly StarterScene[], { music, voice, target }: { music: boolean; voice: boolean; target: number }) {
  const fixed = scenes.some((scene) => scene.driver === 'seconds');
  const about = [
    music && "Until there's a track the bars run on a steady tempo: `studio music add` (or `gen`), then\n// `studio music fit --bars`, gives one to cut to, and `grid: { music: '<fit>' }` replaces the tempo.",
    voice && 'The voiced scenes last as their lines are read: by their word counts until `studio voice` reads them,\n// so a reworded line re-times its scene, every later one and each cue on its words.',
    fixed && 'Each scene lasts the seconds it states. The video plays no voice, music or sound, and delivers\n// with no audio track: project.ts declares it silent.',
  ].filter(Boolean).join('\n// ');
  const landmark = "  // The music's final hit ends the last bar: pending on a tempo grid, checked against a fitted track.\n  landmarks: [{ name: 'the final hit', cue: 'payoff.stop', downbeat: -1 }],\n";
  return `// The ${title} video's plan: the brief, then a row per scene, what's on screen, the motion and what times it, with the
// cues its picture moves on. \`studio clock ${slug}\` prints its frames.
// ${about}

import { defineStoryboard } from '#lib/timing/storyboard/models/storyboard.ts';

export const storyboard = defineStoryboard({
  title: ${JSON.stringify(title)},
  target: { seconds: ${target} },
${voice ? "  voice: 'Callirrhoe',\n" : ''}${music ? '  grid: { tempo: 120 },\n' : ''}  brief: {
    For: 'Who watches it, and where.',
    Takeaway: 'The one thing they should leave knowing.',
  },
  scenes: {
${scenes.map((scene) => `    ${scene.id}: {\n${scene.row.map((field) => `      ${field.endsWith(',') ? field : `${field},`}`).join('\n')}\n    },`).join('\n')}
  },
${music ? landmark : ''}});
`;
}

const binderName = (scene: StarterScene) => `${scene.id}${scene.folder === 'bars' ? 'Bar' : 'Scene'}`;

function sceneModule(scene: StarterScene) {
  return `// ${scene.folder === 'bars' ? 'Bar' : 'Scene'} ${scene.id}, as its storyboard row states it. Blocked: flat pieces moving on its cues, at the
// real timing, placed in px of the default 1920×1080 frame. Block what the scene shows, then build it to final; that
// changes this binding only, never storyboard.ts. Its helpers go in ${scene.folder}/${scene.id}/.
import type { StoryboardSceneClock } from '#lib/timing/storyboard/models/storyboard.ts';
import { blockingScene } from '#studio';
import type { storyboard } from '../storyboard.ts';

export const ${binderName(scene)} = (clock: StoryboardSceneClock<typeof storyboard, '${scene.id}'>) => blockingScene(clock, {
  pieces: [
    ${scene.pieces}
  ],
});
`;
}

function videoModule(title: string, scenes: readonly StarterScene[], { music, voice }: { music: boolean; voice: boolean }) {
  const soundNote = music
    ? "\n// Until a fitted track replaces the tempo grid a click marks each beat, a draft the render warns of; then the track\n// plays as `bed: { track: music['<fit>'] }` here, beside `music` from music/index.ts."
    : '';
  return `// The ${title} video: each scene of storyboard.ts bound to its clock, drawn in its own file.${soundNote}

import { defineVideo } from '#studio';
${voice ? "import { voice } from './audio/manifest.ts';\n" : ''}${scenes.map((scene) => `import { ${binderName(scene)} } from './${scene.folder}/${scene.id}.tsx';`).join('\n')}
import { storyboard } from './storyboard.ts';

export default defineVideo({
  title: ${JSON.stringify(title)},
  storyboard,
${voice ? '  voice,\n' : ''}  scenes: { ${scenes.map((scene) => `${scene.id}: ${binderName(scene)}`).join(', ')} },
});
`;
}
