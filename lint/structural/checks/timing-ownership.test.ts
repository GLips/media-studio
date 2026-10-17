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

test('a timing constructor imported in a project is caught, however it is spelled', () => {
  const findings = runCheckOnFiles('timing-ownership', {
    ...STUDIO,
    // Obvious: the storyboard building a timeline beside its plan.
    'work/projects/p/storyboard.ts': "import { beatGrid } from '#studio';\nexport const g = beatGrid();\n",
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
    'work/projects/p/storyboard.ts:beatGrid from #studio',
    'work/projects/p/video.tsx:fixedSpan from #studio',
  ]);
});

test('defineStoryboard is storyboard.ts\'s alone, and resolving and binding it are defineVideo\'s', () => {
  const findings = runCheckOnFiles('timing-ownership', {
    ...STUDIO,
    'lib/timing/storyboard/models/storyboard.ts': 'export const defineStoryboard = (s: unknown) => s;\n',
    'lib/timing/storyboard/models/resolve-storyboard.ts': 'export const resolveStoryboard = (s: unknown) => s;\n',
    'lib/timing/timeline/models/bind-timeline.ts': 'export const bindTimeline = (t: unknown, b: unknown) => [t, b];\n',
    'work/projects/p/storyboard.ts': "import { defineStoryboard } from '#lib/timing/storyboard/models/storyboard.ts';\nexport const storyboard = defineStoryboard({});\n",
    // Legal: the composition hands the storyboard to defineVideo, and a helper may bind a resolved timeline.
    'work/projects/p/video.tsx': "import { defineVideo } from '#studio';\nimport { bindTimeline } from '#lib/timing/timeline/models/bind-timeline.ts';\nimport { storyboard } from './storyboard.ts';\ndefineVideo({ storyboard }); bindTimeline;\n",
    // Obvious: a scene re-stating the plan, and one resolving it for itself.
    'work/projects/p/bars/intro.tsx': "import { defineStoryboard } from '#lib/timing/storyboard/models/storyboard.ts';\nexport const plan = defineStoryboard({});\n",
    'work/projects/p/bars/outro.tsx': "import { resolveStoryboard } from '#lib/timing/storyboard/models/resolve-storyboard.ts';\nexport const resolved = resolveStoryboard({});\n",
  });
  assert.deepEqual(caught(findings), [
    'work/projects/p/bars/intro.tsx:defineStoryboard from #lib/timing/storyboard/models/storyboard.ts',
    'work/projects/p/bars/outro.tsx:resolveStoryboard from #lib/timing/storyboard/models/resolve-storyboard.ts',
  ]);
});
