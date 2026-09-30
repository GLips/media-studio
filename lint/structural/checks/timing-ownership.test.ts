import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const STUDIO = {
  'package.json': JSON.stringify({ imports: { '#studio': './lib/api.ts', '#lib/*': './lib/*' } }),
  'lib/picture/video/studio/video.ts': 'export const defineVideo = (v: unknown) => v;\n',
  'lib/timing/timeline/models/timeline.ts': 'export const fixedSpan = (s: number) => s;\n',
  'lib/timing/timeline/models/beat-grid.ts': 'export const beatGrid = () => 0;\n',
  'lib/api.ts': "export * from '#lib/timing/timeline/models/beat-grid.ts';\nexport { defineVideo } from '#lib/picture/video/studio/video.ts';\nexport { fixedSpan } from '#lib/timing/timeline/models/timeline.ts';\n",
};

test('a timing constructor imported outside timeline.ts is caught, however it is spelled', () => {
  const findings = runCheckOnFiles('timing-ownership', {
    ...STUDIO,
    'work/projects/p/timeline.ts': "import { beatGrid, fixedSpan } from '#studio';\nexport const g = beatGrid();\n",
    // Obvious: through the barrel alias.
    'work/projects/p/video.tsx': "import { fixedSpan, defineVideo } from '#studio';\n",
    // Adversarial: a namespace import of the barrel by relative path, read by member and by destructuring.
    'work/projects/p/bars/intro.tsx': "import * as S from '../../../../lib/api.ts';\nS.fixedSpan({});\nconst { beatGrid } = S;\n",
    // Adversarial: a project helper re-exporting it under another name, and a scene importing that name.
    'work/projects/p/helpers.ts': "export { fixedSpan as scene } from '#studio';\n",
    'work/projects/p/bars/outro.tsx': "import { scene } from '../helpers.ts';\n",
    // Adversarial: a kit renaming it, read off a namespace; a kit's `export * as`; a `.js` spelling; a computed import.
    'lib/picture/kit/studio/kit.ts': "export { fixedSpan as scene } from '../../../timing/timeline/models/timeline.ts';\nexport * as S from '../../../api.ts';\n",
    'work/projects/p/bars/kit.tsx': "import * as K from '#lib/picture/kit/studio/kit.ts';\nK.scene({});\n",
    'work/projects/p/bars/nested.tsx': "import { S } from '../../../../lib/picture/kit/studio/kit.ts';\nS.fixedSpan({});\n",
    'work/projects/p/bars/js.tsx': "import { fixedSpan } from '../../../../lib/timing/timeline/models/timeline.js';\n",
    'work/projects/p/bars/computed.tsx': "const m = await import(`${'#'}studio`);\nconst { hud } = await import(`${'x'}`);\n",
    // Legal neighbour: a type-only import builds nothing.
    'work/projects/p/stills.tsx': "import type { fixedSpan } from '#studio';\n",
  });
  assert.deepEqual(caught(findings), [
    'work/projects/p/bars/computed.tsx:computed import',
    'work/projects/p/bars/intro.tsx:beatGrid from ../../../../lib/api.ts',
    'work/projects/p/bars/intro.tsx:fixedSpan from ../../../../lib/api.ts',
    'work/projects/p/bars/js.tsx:fixedSpan from ../../../../lib/timing/timeline/models/timeline.js',
    'work/projects/p/bars/kit.tsx:scene from #lib/picture/kit/studio/kit.ts',
    'work/projects/p/bars/nested.tsx:fixedSpan from ../../../../lib/picture/kit/studio/kit.ts',
    'work/projects/p/bars/outro.tsx:scene from ../helpers.ts',
    'work/projects/p/helpers.ts:fixedSpan from #studio',
    'work/projects/p/video.tsx:fixedSpan from #studio',
  ]);
});

test('the timeline\'s constructors stay in timeline.ts, and binding it is the composition\'s', () => {
  const findings = runCheckOnFiles('timing-ownership', {
    ...STUDIO,
    'lib/timing/timeline/models/timeline.ts': 'export const defineTimeline = (s: unknown) => s; export const beatSpan = (n: number) => n;\n',
    'lib/timing/timeline/models/bind-timeline.ts': 'export const bindTimeline = (t: unknown, b: unknown) => [t, b];\n',
    'work/projects/p/timeline.ts': "import { beatSpan, defineTimeline } from '../../../lib/timing/timeline/models/timeline.ts';\nexport const t = defineTimeline({ a: beatSpan(4) });\n",
    // Legal: the composition binds the resolved timeline.
    'work/projects/p/video.tsx': "import { bindTimeline } from '../../../lib/timing/timeline/models/bind-timeline.ts';\nimport { t } from './timeline.ts';\nbindTimeline(t, {});\n",
    // Obvious: a scene sizing itself with a driver.
    'work/projects/p/bars/intro.tsx': "import { beatSpan } from '../../../../lib/timing/timeline/models/timeline.ts';\nexport const span = beatSpan(8);\n",
  });
  assert.deepEqual(caught(findings), ['work/projects/p/bars/intro.tsx:beatSpan from ../../../../lib/timing/timeline/models/timeline.ts']);
});
