import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const STUDIO = {
  'package.json': JSON.stringify({ imports: { '#studio': './lib/studio/api.ts' } }),
  'lib/studio/timeline.ts': 'export const defineScene = (s: unknown) => s; export const defineVideo = (v: unknown) => v;\n',
  'lib/studio/beats.ts': 'export const beatGrid = () => 0;\n',
  'lib/studio/api.ts': "export * from './beats.ts';\nexport { defineScene, defineVideo } from './timeline.ts';\n",
};

test('a timing constructor imported outside timeline.ts is caught, however it is spelled', () => {
  const findings = runCheckOnFiles('timing-ownership', {
    ...STUDIO,
    'projects/p/timeline.ts': "import { beatGrid, defineScene } from '#studio';\nexport const g = beatGrid();\n",
    // Obvious: through the barrel alias.
    'projects/p/video.tsx': "import { defineScene, defineVideo } from '#studio';\n",
    // Adversarial: a namespace import of the barrel by relative path, read by member and by destructuring.
    'projects/p/bars/intro.tsx': "import * as S from '../../../lib/studio/api.ts';\nS.defineScene({});\nconst { beatGrid } = S;\n",
    // Adversarial: a project helper re-exporting it under another name, and a scene importing that name.
    'projects/p/helpers.ts': "export { defineScene as scene } from '#studio';\n",
    'projects/p/bars/outro.tsx': "import { scene } from '../helpers.ts';\n",
    // Adversarial: a kit renaming it, read off a namespace; a kit's `export * as`; a `.js` spelling; a computed import.
    'lib/kit.ts': "export { defineScene as scene } from './studio/timeline.ts';\nexport * as S from './studio/api.ts';\n",
    'projects/p/bars/kit.tsx': "import * as K from '../../../lib/kit.ts';\nK.scene({});\n",
    'projects/p/bars/nested.tsx': "import { S } from '../../../lib/kit.ts';\nS.defineScene({});\n",
    'projects/p/bars/js.tsx': "import { defineScene } from '../../../lib/studio/timeline.js';\n",
    'projects/p/bars/computed.tsx': "const m = await import(`${'#'}studio`);\nconst { hud } = await import(`${'x'}`);\n",
    // Legal neighbour: a type-only import builds nothing.
    'projects/p/stills.tsx': "import type { defineScene } from '#studio';\n",
  });
  assert.deepEqual(caught(findings), [
    'projects/p/bars/computed.tsx:computed import',
    'projects/p/bars/intro.tsx:beatGrid from ../../../lib/studio/api.ts',
    'projects/p/bars/intro.tsx:defineScene from ../../../lib/studio/api.ts',
    'projects/p/bars/js.tsx:defineScene from ../../../lib/studio/timeline.js',
    'projects/p/bars/kit.tsx:scene from ../../../lib/kit.ts',
    'projects/p/bars/nested.tsx:defineScene from ../../../lib/kit.ts',
    'projects/p/bars/outro.tsx:scene from ../helpers.ts',
    'projects/p/helpers.ts:defineScene from #studio',
    'projects/p/video.tsx:defineScene from #studio',
  ]);
});
