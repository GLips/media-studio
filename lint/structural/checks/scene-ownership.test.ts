import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test("a scene reaches only its own folder, shared modules and the timeline; nothing shared reaches back", () => {
  const findings = runCheckOnFiles('scene-ownership', {
    // Each project lists its shared modules in its project.ts.
    'work/projects/p/project.ts': "export default { capability: 'music-led', shared: ['look.ts', './palette.ts'] } satisfies ProjectDeclaration;\n",
    'work/projects/p/timeline.ts': 'export const t = 0;\n',
    'work/projects/p/look.ts': "export const ink = '#000';\n",
    'work/projects/p/sfx/hit.ts': 'export default {};\n',
    'work/projects/p/bars/ink/needle.ts': 'export const n = 1;\n',
    'work/projects/p/bars/ink/needle-model.ts': 'export const pose = 1;\n',
    // Legal: its own folder (a helper and a model), shared, timeline, sound.
    'work/projects/p/bars/ink.tsx': [
      "import { n } from './ink/needle.ts';", "import { pose } from './ink/needle-model.ts';", "import { ink } from '../look.ts';",
      "import { t } from '../timeline.ts';", "import hit from '../sfx/hit.ts';",
    ].join('\n'),
    // Obvious: another scene. Adversarial: another scene's folder, by a type-only import, and an unclassified helper.
    'work/projects/p/bars/finale.tsx': [
      "import { x } from './ink.tsx';", "import type { n } from './ink/needle.ts';", "import { s } from '../stray.ts';",
    ].join('\n'),
    // Adversarial: a declared shared module importing back into a scene, and a scene's helper reaching another scene.
    'work/projects/p/palette.ts': "import { n } from './bars/ink/needle.ts';\n",
    'work/projects/p/bars/finale/replay.ts': "import { x } from '../ink.tsx';\n",
    // Adversarial: an unclassified file a scene already reaches, used as a path into another scene.
    'work/projects/p/stray.ts': "import { n } from './bars/ink/needle.ts';\nexport const s = 1;\n",
    // Legal neighbour: the composition binds every scene.
    'work/projects/p/video.tsx': "import { a } from './bars/ink.tsx';\nimport { b } from './bars/finale.tsx';\n",
  });
  assert.deepEqual(caught(findings), [
    'work/projects/p/bars/finale.tsx:../stray.ts',
    'work/projects/p/bars/finale.tsx:./ink.tsx',
    'work/projects/p/bars/finale.tsx:./ink/needle.ts',
    'work/projects/p/bars/finale/replay.ts:../ink.tsx',
    'work/projects/p/palette.ts:./bars/ink/needle.ts',
    'work/projects/p/stray.ts:./bars/ink/needle.ts',
  ]);
});

test('a finale replays other scenes only as the composition hands them over', () => {
  const findings = runCheckOnFiles('scene-ownership', {
    'lib/timing/timeline/models/bind-timeline.ts': 'export const bindTimeline = (t: unknown, b: unknown) => [t, b];\n',
    'work/projects/p/project.ts': "export default { capability: 'music-led', shared: ['replayed.ts'] };\n",
    'work/projects/p/timeline.ts': 'export const t = 0;\n',
    'work/projects/p/bars/ink.tsx': 'export const ink = (clock: unknown) => clock;\n',
    // Legal: the finale takes its replays as arguments, and the composition injects them.
    'work/projects/p/bars/finale.tsx': "import type { bindTimeline } from '../../../../lib/timing/timeline/models/bind-timeline.ts';\nexport const finale = (clock: unknown, replays: unknown) => [clock, replays];\n",
    'work/projects/p/video.tsx': [
      "import { bindTimeline } from '../../../lib/timing/timeline/models/bind-timeline.ts';", "import { t } from './timeline.ts';",
      "import { ink } from './bars/ink.tsx';", "import { finale } from './bars/finale.tsx';", 'bindTimeline(t, { ink, finale });',
    ].join('\n'),
    // Adversarial: a shared registry of scenes the finale could read its replays from.
    'work/projects/p/replayed.ts': "import { ink } from './bars/ink.tsx';\nexport const replayed = { ink };\n",
  });
  assert.deepEqual(caught(findings), ['work/projects/p/replayed.ts:./bars/ink.tsx']);
});

test("a shared list is read as written: an entry built at runtime, or outside the project, declares nothing", () => {
  const findings = runCheckOnFiles('scene-ownership', {
    'work/projects/p/project.ts': [
      "const extra = 'palette.ts';",
      "export default { capability: 'silent', shared: ['look.ts', extra, '../q/look.ts', 'bars/../../q/x.ts'] };",
    ].join('\n'),
    'work/projects/p/look.ts': "export const ink = '#000';\n",
    'work/projects/p/palette.ts': "export const paper = '#fff';\n",
    // The entry that reads still declares look.ts; the one that doesn't leaves palette.ts unclassified.
    'work/projects/p/bars/ink.tsx': "import { ink } from '../look.ts';\nimport { paper } from '../palette.ts';\n",
    'work/projects/q/project.ts': "const shared = ['look.ts'];\nexport default { capability: 'silent', shared };\n",
  });
  assert.deepEqual(caught(findings), [
    'work/projects/p/bars/ink.tsx:../palette.ts',
    'work/projects/p/project.ts:shared ../q/look.ts',
    'work/projects/p/project.ts:shared bars/../../q/x.ts',
    'work/projects/p/project.ts:shared unreadable',
    'work/projects/q/project.ts:shared unreadable',
  ]);
});

test("a painting source is its scene's, beside it or in its folder, or every scene's when project.ts shares it", () => {
  const findings = runCheckOnFiles('scene-ownership', {
    'work/projects/p/project.ts': "export default { capability: 'silent', shared: ['paintings/pond.painting.ts'] };\n",
    'work/projects/p/scenes/meadow/meadow.painting.ts': 'export default () => ({});\n',
    // Legal: its own source, and the shared one.
    'work/projects/p/scenes/meadow.tsx': "import meadow from './meadow/meadow.painting.ts';\nimport pond from '../paintings/pond.painting.ts';\n",
    // Adversarial: another scene's source, and a shared source reaching back into a scene's.
    'work/projects/p/scenes/finale.tsx': "import meadow from './meadow/meadow.painting.ts';\n",
    'work/projects/p/paintings/pond.painting.ts': "import meadow from '../scenes/meadow/meadow.painting.ts';\nexport default meadow;\n",
  });
  assert.deepEqual(caught(findings), [
    'work/projects/p/paintings/pond.painting.ts:../scenes/meadow/meadow.painting.ts',
    'work/projects/p/scenes/finale.tsx:./meadow/meadow.painting.ts',
  ]);
});
