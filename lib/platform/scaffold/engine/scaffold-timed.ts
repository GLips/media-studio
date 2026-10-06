// scaffold-timed.ts: a timed project's starting files, for new-project.ts: its timing in timeline.ts, registered
// with the retime runner by timeline.test.ts, and one file per scene, each blocked in flat pieces moving on its own
// cues (blockingScene), so the project renders and reviews as an animatic before anything is drawn.
//
// Music-led, the scenes are bars on a steady tempo, the last one's end the music's final hit (a landmark, pending
// until a fitted track replaces the tempo). Voice-led, they are voiced lines from voiceover.json, each with a
// speech cue. Mixed, a section of bars sits between a voiced opening and a voiced close. Silent, they are fixed
// spans in seconds, and the video plays no sound at all.

import type { ProjectCapability } from '#lib/platform/project/models/capability.ts';

type TimedCapability = Exclude<ProjectCapability, 'still-only'>;

/**
 * One scene as scaffolded: where its file goes, its driver as timeline.ts states it, its note, and its blocking's
 * pieces as source, each keyed to a cue of `span`.
 */
type StarterScene = { id: string; folder: 'bars' | 'scenes'; span: string; note: string; pieces: string };

const BARS: readonly StarterScene[] = [
  {
    id: 'hook', folder: 'bars', span: 'beatSpan(4, { cues: { hit: 0 } })', note: 'The hook: one image, hitting on the downbeat.',
    pieces: `{ kind: 'image', name: 'hook image', pose: { x: 360, y: 150, w: 1200, h: 675, opacity: 0, scale: 1.2 }, keys: [{ at: clock.cues.hit, to: { opacity: 1, scale: 1 }, over: 5 }] },`,
  },
  {
    id: 'turn', folder: 'bars', span: 'beatSpan(4, { cues: { reveal: 2 } })', note: 'The turn: what changes, revealed on beat 2.',
    pieces: `{ kind: 'box', name: 'before', pose: { x: 360, y: 240, w: 1200, h: 600 }, keys: [{ at: clock.cues.reveal, to: { x: -1300 }, over: 8 }] },
    { kind: 'box', name: 'after', color: '#9fb0c9', pose: { x: 1960, y: 240, w: 1200, h: 600 }, keys: [{ at: clock.cues.reveal, to: { x: 360 }, over: 8 }] },`,
  },
  {
    id: 'payoff', folder: 'bars', span: "beatSpan(4, { cues: { stop: 'end' } })", note: "The payoff: the name, held to the music's final hit.",
    pieces: `{ kind: 'type', name: 'name', text: 'The name', pose: { x: 560, y: 470, w: 800, h: 140, opacity: 0, scale: 0.8 }, keys: [{ at: clock.beat(0), to: { opacity: 1, scale: 1 }, over: 6 }] },`,
  },
];
const VOICED_OPEN: StarterScene = {
  id: 'title', folder: 'scenes', note: 'The title, as the intro line names what this is.',
  span: "voiceSpan(['intro'], { lead: 1.4, tail: 1.0, cues: { look: { line: 'intro', phrase: 'quick look' } } })",
  pieces: `{ kind: 'image', name: 'the product', pose: { x: 960, y: 160, w: 840, h: 640, opacity: 0 }, keys: [{ at: 0, to: { opacity: 1 }, over: 15 }] },
    { kind: 'type', name: 'title', text: 'The title', pose: { x: 140, y: 420, w: 700, h: 120, opacity: 0 }, keys: [{ at: clock.cues.look, to: { opacity: 1, y: 400 }, over: 10 }] },`,
};
const VOICED_CLOSE: StarterScene = {
  id: 'outro', folder: 'scenes', note: 'The takeaways, then the end card as the thanks is said.',
  span: "voiceSpan(['outro'], { lead: 0.6, tail: 3.4, crossfade: 0.5, cues: { thanks: { line: 'outro', phrase: 'thanks' } } })",
  pieces: `{ kind: 'box', name: 'takeaways', pose: { x: 360, y: 200, w: 1200, h: 560 } },
    { kind: 'box', name: 'end card', color: '#9fb0c9', pose: { x: 0, y: 0, w: 1920, h: 1080, opacity: 0 }, keys: [{ at: clock.cues.thanks, to: { opacity: 1 }, over: 12 }] },`,
};

const FIXED: readonly StarterScene[] = [
  {
    id: 'open', folder: 'scenes', span: 'fixedSpan(3, { cues: { name: 0.4, promise: 1.4 } })', note: 'The open: the name, then what it promises.',
    pieces: `{ kind: 'type', name: 'name', text: 'The name', pose: { x: 160, y: 380, w: 900, h: 130, opacity: 0 }, keys: [{ at: clock.cues.name, to: { opacity: 1, y: 360 }, over: 10 }] },
    { kind: 'type', name: 'promise', text: 'What it does for you', color: '#6d737d', pose: { x: 166, y: 540, w: 900, h: 56, opacity: 0 }, keys: [{ at: clock.cues.promise, to: { opacity: 1 }, over: 10 }] },`,
  },
  {
    id: 'show', folder: 'scenes', span: 'fixedSpan(4, { crossfade: 0.5, cues: { reveal: 1.5 } })', note: 'The show: the product, then what changes, revealed.',
    pieces: `{ kind: 'image', name: 'before', pose: { x: 360, y: 240, w: 1200, h: 600 }, keys: [{ at: clock.cues.reveal, to: { x: -1300 }, over: 8 }] },
    { kind: 'image', name: 'after', color: '#9fb0c9', pose: { x: 1960, y: 240, w: 1200, h: 600 }, keys: [{ at: clock.cues.reveal, to: { x: 360 }, over: 8 }] },`,
  },
  {
    id: 'close', folder: 'scenes', span: 'fixedSpan(3, { crossfade: 0.5, cues: { card: 0.8 } })', note: 'The close: the end card.',
    pieces: `{ kind: 'box', name: 'end card', color: '#9fb0c9', pose: { x: 0, y: 0, w: 1920, h: 1080, opacity: 0 }, keys: [{ at: clock.cues.card, to: { opacity: 1 }, over: 12 }] },`,
  },
];

const SCENES: Record<TimedCapability, readonly StarterScene[]> = {
  'music-led': BARS,
  'voice-led': [VOICED_OPEN, VOICED_CLOSE],
  mixed: [VOICED_OPEN, ...BARS, VOICED_CLOSE],
  silent: FIXED,
};

const LANDMARK = "  // The music's final hit ends the last bar: pending on a tempo grid, checked against a fitted track.\n  landmarks: [{ name: 'the final hit', cue: 'payoff.stop', downbeat: -1 }],\n";

export function timedStarterFiles(slug: string, title: string, capability: TimedCapability): Record<string, string> {
  const scenes = SCENES[capability];
  const music = scenes.some((scene) => scene.folder === 'bars');
  const voice = scenes.some((scene) => scene.span.startsWith('voiceSpan'));
  const files: Record<string, string> = {
    'timeline.ts': timelineModule(slug, title, scenes, { music, voice }),
    'timeline.test.ts': retimeTest({ music, voice }),
    'video.tsx': videoModule(title, scenes, { music, voice }),
  };
  for (const scene of scenes) files[`${scene.folder}/${scene.id}.tsx`] = sceneModule(scene);
  if (voice) {
    files['voiceover.json'] = `${JSON.stringify({
      voice: 'Callirrhoe',
      lines: [
        { id: 'intro', text: `Here's a quick look at ${title}.` },
        { id: 'outro', text: 'That’s it. Thanks for watching.', paragraph: true },
      ],
    }, null, 2)}\n`;
  }
  return files;
}

function timelineModule(slug: string, title: string, scenes: readonly StarterScene[], { music, voice }: { music: boolean; voice: boolean }) {
  const fixed = scenes.some((scene) => scene.span.startsWith('fixedSpan'));
  const constructors = ['defineTimeline', ...(music ? ['beatSpan', 'tempoGrid'] : []), ...(voice ? ['voiceSpan'] : []), ...(fixed ? ['fixedSpan'] : [])].toSorted();
  const about = [
    music && "Until there's a track the bars run on a steady tempo: `studio music add` (or `gen`),\n// then `studio music fit --bars`, gives one to cut to, and `recordedGrid(music['<name>'])` from its music/index.ts\n// replaces tempoGrid.",
    voice && 'The voiced scenes last as their lines were read (voiceover.json, `studio voice`), so a re-read line\n// re-times its scene, every later one and each speech cue on its words.',
    fixed && 'Each scene lasts the seconds it states. The video plays no voice, music or sound, and delivers\n// with no audio track: project.ts declares it silent.',
  ].filter(Boolean).join('\n// ');
  return `// The ${title} video's timing, stated once: each scene's driver and the cues its picture moves on. \`studio clock ${slug}\`
// prints it. ${about}

import { ${constructors.join(', ')} } from '#lib/timing/timeline/models/timeline.ts';
${voice ? "import { voice } from './audio/manifest.ts';\n" : ''}
export const timeline = defineTimeline({
${music ? '  grid: tempoGrid(120),\n' : ''}${voice ? '  voice,\n' : ''}  scenes: {
${scenes.map((scene) => `    ${scene.id}: ${scene.span},`).join('\n')}
  },
${music ? LANDMARK : ''}});
`;
}

function retimeTest({ music, voice }: { music: boolean; voice: boolean }) {
  const reads = [voice && 'the voice from audio/manifest.ts', music && 'its fitted track, once it has one, from music/index.ts'].filter(Boolean).join(' and ');
  const load = reads
    ? `// The timeline reads ${reads}, which import the audio: the hooks load it as URLs.
await import('#lib/output/render/engine/tsx-test-hooks.ts');
const { timeline } = await import('./timeline.ts');`
    : "import { timeline } from './timeline.ts';";
  return `import { test } from 'node:test';
import { assertTimelineRetimes } from '#lib/timing/timeline/models/retime.ts';
${load}

test('the video retimes: a longer scene moves every later one and its cues, and nothing before', () => {
  assertTimelineRetimes(timeline);
});
`;
}

const binderName = (scene: StarterScene) => `${scene.id}${scene.folder === 'bars' ? 'Bar' : 'Scene'}`;

function sceneModule(scene: StarterScene) {
  return `// ${scene.folder === 'bars' ? 'Bar' : 'Scene'} ${scene.id}. ${scene.note} Blocked: flat pieces moving on its cues, at the real
// timing, placed in px of the default 1920×1080 frame. Block what the scene shows, then build it to final; that changes
// this binding only, never timeline.ts. Its helpers go in ${scene.folder}/${scene.id}/.
import type { TimelineSceneClock } from '#lib/timing/timeline/models/bind-timeline.ts';
import { blockingScene } from '#studio';
import type { timeline } from '../timeline.ts';

export const ${binderName(scene)} = (clock: TimelineSceneClock<typeof timeline, '${scene.id}'>) => blockingScene(clock, {
  note: ${JSON.stringify(scene.note)},
  pieces: [
    ${scene.pieces}
  ],
});
`;
}

function videoModule(title: string, scenes: readonly StarterScene[], { music, voice }: { music: boolean; voice: boolean }) {
  const soundNote = music
    ? "\n// Until then a click marks each beat, a draft the render warns of. Once a fitted track replaces the tempo grid, it\n// plays as `music: { track }` here."
    : '';
  return `// The ${title} video: each scene bound to its clock on timeline.ts, drawn in its own file.${soundNote}

import { bindTimeline } from '#lib/timing/timeline/models/bind-timeline.ts';
import { defineVideo } from '#studio';
${voice ? "import { voice } from './audio/manifest.ts';\n" : ''}${scenes.map((scene) => `import { ${binderName(scene)} } from './${scene.folder}/${scene.id}.tsx';`).join('\n')}
import { timeline } from './timeline.ts';

export default defineVideo({
  title: ${JSON.stringify(title)},
  timeline,
  voice${voice ? '' : ': {}'},
  scenes: bindTimeline(timeline, { ${scenes.map((scene) => `${scene.id}: ${binderName(scene)}`).join(', ')} }),
});
`;
}
