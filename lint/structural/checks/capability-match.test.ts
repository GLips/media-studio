import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const LIB = {
  'lib/timing/storyboard/models/storyboard.ts': 'export const defineStoryboard = (s: unknown) => s;\n',
  'lib/picture/video/studio/video.ts': 'export const defineVideo = (v: unknown) => v;\n',
  'lib/picture/stills/studio/stills.tsx': 'export const defineStills = (d: unknown) => d;\n',
  'lib/api.ts': "export { defineStills } from '#lib/picture/stills/studio/stills.tsx';\nexport { defineVideo } from '#lib/picture/video/studio/video.ts';\n",
};
const declares = (capability: string) => `export default { capability: '${capability}' } satisfies { capability: string };\n`;
const plan = (keys: string) => `import { defineStoryboard } from '#lib/timing/storyboard/models/storyboard.ts';\nexport const storyboard = defineStoryboard({ ${keys ? `${keys}, ` : ''}scenes: {} });\n`;
const BOUND = "import { defineVideo } from '#studio';\nimport { storyboard } from './storyboard.ts';\nexport default defineVideo({ storyboard, scenes: {} });\n";
const STILLS = "import { defineStills } from '#studio';\nexport default defineStills({});\n";

test('a declared capability is held to the music, voice and stills the project binds, and silent to none', () => {
  const findings = runCheckOnFiles('capability-match', {
    'package.json': JSON.stringify({ imports: { '#studio': './lib/api.ts', '#lib/*': './lib/*' } }),
    ...LIB,
    // Legal: each capability, bound as declared.
    'work/projects/music/project.ts': declares('music-led'),
    'work/projects/music/storyboard.ts': plan("grid: { tempo: 120 }"),
    'work/projects/music/video.tsx': BOUND,
    'work/projects/voice/project.ts': declares('voice-led'),
    'work/projects/voice/storyboard.ts': plan("voice: 'Kore'"),
    'work/projects/voice/video.tsx': BOUND,
    'work/projects/stills/project.ts': declares('still-only'),
    'work/projects/stills/stills.tsx': STILLS,
    'work/projects/mixed/project.ts': declares('mixed'),
    'work/projects/mixed/storyboard.ts': plan("voice: 'Kore'"),
    'work/projects/mixed/video.tsx': BOUND,
    'work/projects/mixed/stills.tsx': STILLS,
    'work/projects/silent/project.ts': declares('silent'),
    'work/projects/silent/storyboard.ts': plan(''),
    'work/projects/silent/video.tsx': BOUND,
    // Obvious: no declaration; a video with no plan.
    'work/projects/bare/stills.tsx': STILLS,
    'work/projects/legacy/project.ts': declares('voice-led'),
    'work/projects/legacy/video.tsx': 'export default { scenes: [] };\n',
    // Adversarial: a music-led project that took on a voice; a storyboard no video binds; a declaration that is a
    // variable, not a literal; a still-only project that imports defineStills and never calls it; a silent project
    // that took on a voice.
    'work/projects/drifted/project.ts': declares('music-led'),
    'work/projects/drifted/storyboard.ts': plan("grid: { tempo: 120 }, 'voice': 'Kore'"),
    'work/projects/drifted/video.tsx': BOUND,
    'work/projects/unbound/project.ts': declares('voice-led'),
    'work/projects/unbound/storyboard.ts': plan("voice: 'Kore'"),
    'work/projects/unbound/video.tsx': 'export default {};\n',
    'work/projects/computed/project.ts': "const capability = 'still-only';\nexport default { capability };\n",
    'work/projects/computed/stills.tsx': STILLS,
    'work/projects/idle/project.ts': declares('still-only'),
    'work/projects/idle/stills.tsx': "import { defineStills } from '#studio';\nvoid defineStills;\nexport default {};\n",
    'work/projects/voiced/project.ts': declares('silent'),
    'work/projects/voiced/storyboard.ts': plan("voice: 'Kore'"),
    'work/projects/voiced/video.tsx': BOUND,
  });
  assert.deepEqual(caught(findings), [
    'work/projects/bare/stills.tsx:no project.ts',
    'work/projects/computed/project.ts:capability unreadable',
    'work/projects/drifted/project.ts:music-led binds music and voice',
    'work/projects/idle/project.ts:still-only binds no music, voice or stills',
    'work/projects/idle/stills.tsx:stills unregistered',
    'work/projects/legacy/project.ts:voice-led binds no music, voice or stills',
    'work/projects/legacy/video.tsx:video without storyboard',
    'work/projects/unbound/storyboard.ts:storyboard unbound',
    'work/projects/voiced/project.ts:silent binds voice',
  ]);
});
