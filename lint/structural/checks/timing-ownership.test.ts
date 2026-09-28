import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const STUDIO = {
  'package.json': JSON.stringify({ imports: { '#studio': './lib/studio/api.ts', '#studio/*': './lib/studio/*' } }),
  'lib/studio/composition/timeline.ts': 'export const defineScene = (s: unknown) => s; export const defineVideo = (v: unknown) => v;\n',
  'lib/models/timeline/beat-grid.ts': 'export const beatGrid = () => 0;\n',
  'lib/studio/api.ts': "export * from '../models/timeline/beat-grid.ts';\nexport { defineScene, defineVideo } from './composition/timeline.ts';\n",
};

test('a timing constructor imported outside timeline.ts is caught, however it is spelled', () => {
  const findings = runCheckOnFiles('timing-ownership', {
    ...STUDIO,
    'work/projects/p/timeline.ts': "import { beatGrid, defineScene } from '#studio';\nexport const g = beatGrid();\n",
    // Obvious: through the barrel alias.
    'work/projects/p/video.tsx': "import { defineScene, defineVideo } from '#studio';\n",
    // Adversarial: a namespace import of the barrel by relative path, read by member and by destructuring.
    'work/projects/p/bars/intro.tsx': "import * as S from '../../../../lib/studio/api.ts';\nS.defineScene({});\nconst { beatGrid } = S;\n",
    // Adversarial: a project helper re-exporting it under another name, and a scene importing that name.
    'work/projects/p/helpers.ts': "export { defineScene as scene } from '#studio';\n",
    'work/projects/p/bars/outro.tsx': "import { scene } from '../helpers.ts';\n",
    // Adversarial: a kit renaming it, read off a namespace; a kit's `export * as`; a `.js` spelling; a computed import.
    'lib/studio/kit/kit.ts': "export { defineScene as scene } from '../composition/timeline.ts';\nexport * as S from '../api.ts';\n",
    'work/projects/p/bars/kit.tsx': "import * as K from '#studio/kit/kit.ts';\nK.scene({});\n",
    'work/projects/p/bars/nested.tsx': "import { S } from '../../../../lib/studio/kit/kit.ts';\nS.defineScene({});\n",
    'work/projects/p/bars/js.tsx': "import { defineScene } from '../../../../lib/studio/composition/timeline.js';\n",
    'work/projects/p/bars/computed.tsx': "const m = await import(`${'#'}studio`);\nconst { hud } = await import(`${'x'}`);\n",
    // Legal neighbour: a type-only import builds nothing.
    'work/projects/p/stills.tsx': "import type { defineScene } from '#studio';\n",
  });
  assert.deepEqual(caught(findings), [
    'work/projects/p/bars/computed.tsx:computed import',
    'work/projects/p/bars/intro.tsx:beatGrid from ../../../../lib/studio/api.ts',
    'work/projects/p/bars/intro.tsx:defineScene from ../../../../lib/studio/api.ts',
    'work/projects/p/bars/js.tsx:defineScene from ../../../../lib/studio/composition/timeline.js',
    'work/projects/p/bars/kit.tsx:scene from #studio/kit/kit.ts',
    'work/projects/p/bars/nested.tsx:defineScene from ../../../../lib/studio/kit/kit.ts',
    'work/projects/p/bars/outro.tsx:scene from ../helpers.ts',
    'work/projects/p/helpers.ts:defineScene from #studio',
    'work/projects/p/video.tsx:defineScene from #studio',
  ]);
});

test('the timeline\'s constructors stay in timeline.ts, and binding it is the composition\'s', () => {
  const findings = runCheckOnFiles('timing-ownership', {
    ...STUDIO,
    'lib/models/timeline/timeline.ts': 'export const defineTimeline = (s: unknown) => s; export const beatSpan = (n: number) => n;\n',
    'lib/models/timeline/bind-timeline.ts': 'export const bindTimeline = (t: unknown, b: unknown) => [t, b];\n',
    'work/projects/p/timeline.ts': "import { beatSpan, defineTimeline } from '../../../lib/models/timeline/timeline.ts';\nexport const t = defineTimeline({ a: beatSpan(4) });\n",
    // Legal: the composition binds the resolved timeline.
    'work/projects/p/video.tsx': "import { bindTimeline } from '../../../lib/models/timeline/bind-timeline.ts';\nimport { t } from './timeline.ts';\nbindTimeline(t, {});\n",
    // Obvious: a scene sizing itself with a driver.
    'work/projects/p/bars/intro.tsx': "import { beatSpan } from '../../../../lib/models/timeline/timeline.ts';\nexport const span = beatSpan(8);\n",
  });
  assert.deepEqual(caught(findings), ['work/projects/p/bars/intro.tsx:beatSpan from ../../../../lib/models/timeline/timeline.ts']);
});
