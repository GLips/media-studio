import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test('each import inside a feature cycle, at any depth, is a finding; a chain is not a cycle', () => {
  const findings = runCheckOnFiles('feature-cycles', {
    'package.json': JSON.stringify({ imports: { '#lib/*': './lib/*', '#studio': './lib/api.ts' } }),
    // Obvious: two features importing each other, once by alias and once by a relative climb.
    'lib/picture/brush/models/brush.ts': "import { paint } from '#lib/picture/paint/models/paint.ts';\nexport const brush = 1;\n",
    'lib/picture/paint/models/paint.ts': "import { brush } from '../../brush/models/brush.ts';\nexport const paint = 1;\n",
    // Adversarial: a three-feature loop across areas and roles, closed by a type-only import.
    'lib/timing/clock/models/clock.ts': "import { beat } from '#lib/timing/beat/models/beat.ts';\nexport const clock = 1;\n",
    'lib/timing/beat/engine/beat.ts': "import { cue } from '#lib/output/cue/models/cue.ts';\n",
    'lib/timing/beat/models/beat.ts': 'export const beat = 1;\n',
    'lib/output/cue/models/cue.ts': "import type { clock } from '#lib/timing/clock/models/clock.ts';\nexport const cue = 1;\n",
    'web/src/features/f/ui/page.tsx': "import { G } from '../../g/index.ts';\n",
    'web/src/features/g/index.ts': "export { page } from '../f/ui/page.tsx';\nexport const G = 1;\n",
    // Legal: a chain, and the barrel and a project closing what would be a loop through them.
    'lib/picture/paper/models/paper.ts': "import { brush } from '#lib/picture/brush/models/brush.ts';\nimport { studio } from '#studio';\n",
    'lib/api.ts': "export { paper } from '#lib/picture/paper/models/paper.ts';\nexport const studio = 1;\n",
  });
  assert.deepEqual(caught(findings), [
    'lib/output/cue:→ lib/timing/clock',
    'lib/picture/brush:→ lib/picture/paint',
    'lib/picture/paint:→ lib/picture/brush',
    'lib/timing/beat:→ lib/output/cue',
    'lib/timing/clock:→ lib/timing/beat',
    'web/src/features/f:→ web/src/features/g',
    'web/src/features/g:→ web/src/features/f',
  ]);
});
