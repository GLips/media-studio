import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test("a scene reaches only its own folder, shared modules and the timeline; nothing shared reaches back", () => {
  const findings = runCheckOnFiles('scene-ownership', {
    'projects/p/timeline.ts': 'export const t = 0;\n',
    'projects/p/look.ts': "export const ink = '#000';\n",
    'projects/p/sfx/hit.ts': 'export default {};\n',
    'projects/p/bars/ink/needle.ts': 'export const n = 1;\n',
    'projects/p/bars/ink/needle-model.ts': 'export const pose = 1;\n',
    // Legal: its own folder (a helper and a model), shared, timeline, sound.
    'projects/p/bars/ink.tsx': [
      "import { n } from './ink/needle.ts';", "import { pose } from './ink/needle-model.ts';", "import { ink } from '../look.ts';",
      "import { t } from '../timeline.ts';", "import hit from '../sfx/hit.ts';",
    ].join('\n'),
    // Obvious: another scene. Adversarial: another scene's folder, by a type-only import, and an unclassified helper.
    'projects/p/bars/finale.tsx': [
      "import { x } from './ink.tsx';", "import type { n } from './ink/needle.ts';", "import { s } from '../stray.ts';",
    ].join('\n'),
    // Adversarial: a declared shared module importing back into a scene, and a scene's helper reaching another scene.
    'projects/p/palette.ts': "import { n } from './bars/ink/needle.ts';\n",
    'projects/p/bars/finale/replay.ts': "import { x } from '../ink.tsx';\n",
    // Adversarial: an unclassified file a scene already reaches, used as a path into another scene.
    'projects/p/stray.ts': "import { n } from './bars/ink/needle.ts';\nexport const s = 1;\n",
    // Legal neighbour: the composition binds every scene.
    'projects/p/video.tsx': "import { a } from './bars/ink.tsx';\nimport { b } from './bars/finale.tsx';\n",
  }, { p: ['look.ts', 'palette.ts'] });
  assert.deepEqual(caught(findings), [
    'projects/p/bars/finale.tsx:../stray.ts',
    'projects/p/bars/finale.tsx:./ink.tsx',
    'projects/p/bars/finale.tsx:./ink/needle.ts',
    'projects/p/bars/finale/replay.ts:../ink.tsx',
    'projects/p/palette.ts:./bars/ink/needle.ts',
    'projects/p/stray.ts:./bars/ink/needle.ts',
  ]);
});
