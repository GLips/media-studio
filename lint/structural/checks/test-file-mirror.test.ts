import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test('a spec pairs with the module it is named for, beside it; off-convention names are reported', () => {
  const findings = runCheckOnFiles('test-file-mirror', {
    'lib/timing/sound/models/mix.ts': 'export {};\n',
    'lib/timing/sound/models/mix.test.ts': 'export {};\n',
    // Legal: a qualifier before `.test`, a .tsx module, a project's retime runner.
    'lib/timing/sound/models/mix.levels.test.ts': 'export {};\n',
    'lib/picture/kit/studio/wheel.tsx': 'export {};\n',
    'lib/picture/kit/studio/wheel.test.ts': 'export {};\n',
    'work/projects/p/timeline.ts': 'export {};\n',
    'work/projects/p/timeline.test.ts': 'export {};\n',
    // Obvious: no module beside it. Adversarial: its module in another folder; a dotted folder isn't a qualifier.
    'lib/timing/sound/models/cues.test.ts': 'export {};\n',
    'lib/timing/sound/engine/mix.test.ts': 'export {};\n',
    'cli/v2.x/run.test.ts': 'export {};\n',
    'cli/v2.ts': 'export {};\n',
    // Obvious: off-convention names, even beside their module.
    'lib/timing/sound/models/mix.spec.ts': 'export {};\n',
    'web/src/shared/test_format.ts': 'export {};\n',
  });
  assert.deepEqual(caught(findings), [
    'cli/v2.x/run.test.ts:orphan',
    'lib/timing/sound/engine/mix.test.ts:orphan',
    'lib/timing/sound/models/cues.test.ts:orphan',
    'lib/timing/sound/models/mix.spec.ts:spelling',
    'web/src/shared/test_format.ts:spelling',
  ]);
});
