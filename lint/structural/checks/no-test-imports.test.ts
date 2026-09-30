import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test('only a spec imports a spec, whatever the spelling', () => {
  const findings = runCheckOnFiles('no-test-imports', {
    'package.json': JSON.stringify({ imports: { '#lib/*': './lib/*' } }),
    'lib/timing/timeline/models/clock.test.ts': 'export const fixtureClock = 1;\n',
    'lib/timing/timeline/models/clock.ts': 'export const clock = 1;\n',
    'lib/platform/git/engine/fixture-git.ts': 'export const isolatedGitEnv = 1;\n',
    'lib/timing/timeline/models/cue.ts': [
      "import { fixtureClock } from './clock.test.ts';",
      // Adversarial: an alias, a type, a dynamic import and a re-export of the same spec.
      "import { fixtureClock as again } from '#lib/timing/timeline/models/clock.test.ts';",
      "import type { fixtureClock as T } from './clock.test.ts';",
      "const lazy = () => import('./clock.test.ts');",
      "export { fixtureClock as shared } from './clock.test.ts';",
      // Legal neighbours: the module itself, and a module named for fixtures that isn't a spec.
      "import { clock } from './clock.ts';",
      "import { isolatedGitEnv } from '#lib/platform/git/engine/fixture-git.ts';",
    ].join('\n'),
    // Legal neighbour: a spec importing another spec.
    'lib/timing/timeline/models/cue.test.ts': "import { fixtureClock } from './clock.test.ts';\n",
  });
  assert.deepEqual(caught(findings), [
    'lib/timing/timeline/models/cue.ts:#lib/timing/timeline/models/clock.test.ts',
    'lib/timing/timeline/models/cue.ts:./clock.test.ts',
    'lib/timing/timeline/models/cue.ts:./clock.test.ts',
    'lib/timing/timeline/models/cue.ts:./clock.test.ts',
    'lib/timing/timeline/models/cue.ts:./clock.test.ts',
  ]);
});
