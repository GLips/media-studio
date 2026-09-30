import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const LIB = {
  'lib/timing/timeline/models/timeline.ts': 'export const defineTimeline = (s: unknown) => s;\n',
  'lib/timing/timeline/models/bind-timeline.ts': 'export const bindTimeline = (t: unknown, b: unknown) => [t, b];\n',
  'lib/picture/stills/studio/stills.tsx': 'export const defineStills = (d: unknown) => d;\n',
  'lib/api.ts': "export { defineStills } from '#lib/picture/stills/studio/stills.tsx';\n",
};
const declares = (capability: string) => `export default { capability: '${capability}' } satisfies { capability: string };\n`;
const timeline = (keys: string) => `import { defineTimeline } from '../../../lib/timing/timeline/models/timeline.ts';\nexport const timeline = defineTimeline({ ${keys ? `${keys}, ` : ''}scenes: {} });\n`;
const BOUND = "import { bindTimeline } from '../../../lib/timing/timeline/models/bind-timeline.ts';\nimport { timeline } from './timeline.ts';\nexport default bindTimeline(timeline, {});\n";
const STILLS = "import { defineStills } from '#studio';\nexport default defineStills({});\n";

test('a declared capability is held to the music, voice and stills the project binds, and silent to none', () => {
  const findings = runCheckOnFiles('capability-match', {
    'package.json': JSON.stringify({ imports: { '#studio': './lib/api.ts', '#lib/*': './lib/*' } }),
    ...LIB,
    // Legal: each capability, bound as declared.
    'work/projects/music/project.ts': declares('music-led'),
    'work/projects/music/timeline.ts': timeline('grid: tempoGrid(120)'),
    'work/projects/music/video.tsx': BOUND,
    'work/projects/voice/project.ts': declares('voice-led'),
    'work/projects/voice/timeline.ts': timeline('voice'),
    'work/projects/voice/video.tsx': BOUND,
    'work/projects/stills/project.ts': declares('still-only'),
    'work/projects/stills/stills.tsx': STILLS,
    'work/projects/mixed/project.ts': declares('mixed'),
    'work/projects/mixed/timeline.ts': timeline('voice'),
    'work/projects/mixed/video.tsx': BOUND,
    'work/projects/mixed/stills.tsx': STILLS,
    'work/projects/silent/project.ts': declares('silent'),
    'work/projects/silent/timeline.ts': timeline(''),
    'work/projects/silent/video.tsx': BOUND,
    // Obvious: no declaration; a video timing its own scenes.
    'work/projects/bare/stills.tsx': STILLS,
    'work/projects/legacy/project.ts': declares('voice-led'),
    'work/projects/legacy/video.tsx': 'export default { scenes: [] };\n',
    // Adversarial: a music-led project that took on a voice; a timeline no video binds; a declaration that is a
    // variable, not a literal; a still-only project that imports defineStills and never calls it; a silent project
    // that took on a voice.
    'work/projects/drifted/project.ts': declares('music-led'),
    'work/projects/drifted/timeline.ts': timeline("grid: tempoGrid(120), 'voice': voice"),
    'work/projects/drifted/video.tsx': BOUND,
    'work/projects/unbound/project.ts': declares('voice-led'),
    'work/projects/unbound/timeline.ts': timeline('voice'),
    'work/projects/unbound/video.tsx': 'export default {};\n',
    'work/projects/computed/project.ts': "const capability = 'still-only';\nexport default { capability };\n",
    'work/projects/computed/stills.tsx': STILLS,
    'work/projects/idle/project.ts': declares('still-only'),
    'work/projects/idle/stills.tsx': "import { defineStills } from '#studio';\nvoid defineStills;\nexport default {};\n",
    'work/projects/voiced/project.ts': declares('silent'),
    'work/projects/voiced/timeline.ts': timeline('voice'),
    'work/projects/voiced/video.tsx': BOUND,
  });
  assert.deepEqual(caught(findings), [
    'work/projects/bare/stills.tsx:no project.ts',
    'work/projects/computed/project.ts:capability unreadable',
    'work/projects/drifted/project.ts:music-led binds music and voice',
    'work/projects/idle/project.ts:still-only binds no music, voice or stills',
    'work/projects/idle/stills.tsx:stills unregistered',
    'work/projects/legacy/project.ts:voice-led binds no music, voice or stills',
    'work/projects/legacy/video.tsx:video without timeline',
    'work/projects/unbound/timeline.ts:timeline unbound',
    'work/projects/voiced/project.ts:silent binds voice',
  ]);
});
