import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const LIB = {
  'lib/models/timeline/timeline.ts': 'export const defineTimeline = (s: unknown) => s;\n',
  'lib/models/timeline/bind-timeline.ts': 'export const bindTimeline = (t: unknown, b: unknown) => [t, b];\n',
  'lib/studio/stills/stills.tsx': 'export const defineStills = (d: unknown) => d;\n',
  'lib/studio/api.ts': "export { defineStills } from './stills/stills.tsx';\n",
};
const declares = (capability: string) => `export default { capability: '${capability}' } satisfies { capability: string };\n`;
const timeline = (keys: string) => `import { defineTimeline } from '../../lib/models/timeline/timeline.ts';\nexport const timeline = defineTimeline({ ${keys ? `${keys}, ` : ''}scenes: {} });\n`;
const BOUND = "import { bindTimeline } from '../../lib/models/timeline/bind-timeline.ts';\nimport { timeline } from './timeline.ts';\nexport default bindTimeline(timeline, {});\n";
const STILLS = "import { defineStills } from '#studio';\nexport default defineStills({});\n";

test('a declared capability is held to the music, voice and stills the project binds, and silent to none', () => {
  const findings = runCheckOnFiles('capability-match', {
    'package.json': JSON.stringify({ imports: { '#studio': './lib/studio/api.ts' } }),
    ...LIB,
    // Legal: each capability, bound as declared.
    'projects/music/project.ts': declares('music-led'),
    'projects/music/timeline.ts': timeline('grid: tempoGrid(120)'),
    'projects/music/video.tsx': BOUND,
    'projects/voice/project.ts': declares('voice-led'),
    'projects/voice/timeline.ts': timeline('voice'),
    'projects/voice/video.tsx': BOUND,
    'projects/stills/project.ts': declares('still-only'),
    'projects/stills/stills.tsx': STILLS,
    'projects/mixed/project.ts': declares('mixed'),
    'projects/mixed/timeline.ts': timeline('voice'),
    'projects/mixed/video.tsx': BOUND,
    'projects/mixed/stills.tsx': STILLS,
    'projects/silent/project.ts': declares('silent'),
    'projects/silent/timeline.ts': timeline(''),
    'projects/silent/video.tsx': BOUND,
    // Obvious: no declaration; a video timing its own scenes.
    'projects/bare/stills.tsx': STILLS,
    'projects/legacy/project.ts': declares('voice-led'),
    'projects/legacy/video.tsx': 'export default { scenes: [] };\n',
    // Adversarial: a music-led project that took on a voice; a timeline no video binds; a declaration that is a
    // variable, not a literal; a still-only project that imports defineStills and never calls it; a silent project
    // that took on a voice.
    'projects/drifted/project.ts': declares('music-led'),
    'projects/drifted/timeline.ts': timeline("grid: tempoGrid(120), 'voice': voice"),
    'projects/drifted/video.tsx': BOUND,
    'projects/unbound/project.ts': declares('voice-led'),
    'projects/unbound/timeline.ts': timeline('voice'),
    'projects/unbound/video.tsx': 'export default {};\n',
    'projects/computed/project.ts': "const capability = 'still-only';\nexport default { capability };\n",
    'projects/computed/stills.tsx': STILLS,
    'projects/idle/project.ts': declares('still-only'),
    'projects/idle/stills.tsx': "import { defineStills } from '#studio';\nvoid defineStills;\nexport default {};\n",
    'projects/voiced/project.ts': declares('silent'),
    'projects/voiced/timeline.ts': timeline('voice'),
    'projects/voiced/video.tsx': BOUND,
  });
  assert.deepEqual(caught(findings), [
    'projects/bare/stills.tsx:no project.ts',
    'projects/computed/project.ts:capability unreadable',
    'projects/drifted/project.ts:music-led binds music and voice',
    'projects/idle/project.ts:still-only binds no music, voice or stills',
    'projects/idle/stills.tsx:stills unregistered',
    'projects/legacy/project.ts:voice-led binds no music, voice or stills',
    'projects/legacy/video.tsx:video without timeline',
    'projects/unbound/timeline.ts:timeline unbound',
    'projects/voiced/project.ts:silent binds voice',
  ]);
});
